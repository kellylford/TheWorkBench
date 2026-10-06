"""Automatic updates through Velopack, adapted from GHManage's ``updater.py``.

How it fits together
--------------------
* ``bootstrap()`` runs first thing in ``main()``, before the single-instance
  check or any window. Velopack's Update.exe starts the app with hook
  arguments when it installs, updates or uninstalls; ``bootstrap()`` handles
  those and exits. A source run does nothing here.
* ``UpdateService.check()`` asks GitHub for a newer release and says what it
  found, as a ``CheckResult`` the UI turns into words. Nothing is downloaded
  until Kelly agrees: ``download()`` then ``apply_and_restart()``.

TheWorkBench is a monorepo with other apps' releases in it, so TheClaudeHub
publishes to its own Velopack channel, ``theclaudehub``: its feed files are
``releases.theclaudehub.json`` and ``assets.theclaudehub.json``, and the
updater reads only those. Hyper-V Manage's releases, which have no such file,
are never mistaken for TheClaudeHub's. Releases before 1.0 are GitHub
pre-releases, so the source is told to include them.

Updating never touches TheClaudeHub's data. Velopack installs and replaces
the app under ``%LOCALAPPDATA%\\TheClaudeHub``; sessions, settings and logs live
in ``%APPDATA%\\TheClaudeHub`` (roaming), which neither an update nor an
uninstall goes near. ``data_is_outside_install_dir`` checks that.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from . import platform_paths

logger = logging.getLogger("theclaudehub.updater")

REPO_URL = "https://github.com/kellylford/TheWorkBench"
RELEASES_API = "https://api.github.com/repos/kellylford/TheWorkBench/releases?per_page=100"
TAG_PREFIX = "theclaudehub-v"
CHANNEL = "theclaudehub"
INCLUDE_PRERELEASES = True

# CheckResult.status values
AVAILABLE = "available"
CURRENT = "current"
NO_RELEASES = "no releases"
NOT_INSTALLED = "not installed"
FAILED = "failed"


def release_url(version: str) -> str:
    return f"{REPO_URL}/releases/tag/{TAG_PREFIX}{version}"


def releases_page() -> str:
    return f"{REPO_URL}/releases"


def configure_logging() -> None:
    """Update activity goes to %APPDATA%\\TheClaudeHub\\update.log, because a
    silently broken updater can't be diagnosed any other way."""
    try:
        path = platform_paths.app_data_dir() / "update.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(path, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    except Exception:  # noqa: BLE001 - logging must never stop the app starting
        pass


def bootstrap() -> None:
    """Run Velopack's install/update/uninstall hooks. Call first in main()."""
    if not getattr(sys, "frozen", False):
        return
    try:
        import velopack
    except ImportError:
        return
    try:
        # A package Kelly agreed to, downloaded but not yet applied (say the
        # restart failed), is applied here before any window appears.
        velopack.App().set_auto_apply_on_startup(True).run()
    except Exception as exc:  # noqa: BLE001
        logger.error("Velopack bootstrap failed: %s", exc)


def data_is_outside_install_dir(data_dir: Optional[Path] = None,
                                install_root: Optional[Path] = None) -> bool:
    """True when TheClaudeHub's data folder is outside the folder Velopack
    replaces on update and deletes on uninstall."""
    data_dir = Path(data_dir or platform_paths.app_data_dir()).resolve()
    if install_root is None:
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            return True
        install_root = Path(local) / "TheClaudeHub"
    install_root = Path(install_root).resolve()
    return install_root != data_dir and install_root not in data_dir.parents


@dataclass
class CheckResult:
    status: str
    current: str
    version: str = ""          # the newer version, or the latest published one
    detail: str = ""

    @property
    def url(self) -> str:
        return release_url(self.version) if self.version else releases_page()

    def describe(self) -> str:
        """The result in words, for the status bar and speech."""
        if self.status == AVAILABLE:
            return (f"TheClaudeHub {self.version} is available. You have {self.current}.")
        if self.status == CURRENT:
            return f"TheClaudeHub is up to date (version {self.current})."
        if self.status == NO_RELEASES:
            return (f"No TheClaudeHub release has been published yet. You have version "
                    f"{self.current}.")
        if self.status == NOT_INSTALLED:
            latest = (f" The latest release is {self.version}." if self.version else
                      " No release has been published yet.")
            return ("This copy of TheClaudeHub isn't the installed one (it's running from "
                    f"source or the portable zip), so it can't update itself.{latest}")
        return f"Couldn't check for updates: {self.detail or 'unknown error'}."


def latest_published_version(fetch: Optional[Callable[[str], bytes]] = None) -> Optional[str]:
    """The newest theclaudehub-v* release on GitHub, or None if there is none.
    Raises on network errors (the caller reports them)."""
    fetch = fetch or _fetch
    releases = json.loads(fetch(RELEASES_API).decode("utf-8"))
    versions = []
    for release in releases if isinstance(releases, list) else []:
        tag = str(release.get("tag_name") or "") if isinstance(release, dict) else ""
        if release.get("draft") or not tag.startswith(TAG_PREFIX):
            continue
        versions.append(tag[len(TAG_PREFIX):])
    if not versions:
        return None
    return max(versions, key=_version_key)


def _version_key(version: str):
    parts = []
    for piece in version.split("-", 1)[0].split("."):
        try:
            parts.append(int(piece))
        except ValueError:
            parts.append(0)
    return parts


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json", "User-Agent": "TheClaudeHub-updater"})
    with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310
        return response.read()


class UpdateService:
    """Checks for, downloads and applies updates. Every method is safe to
    call from a worker thread and never raises."""

    def __init__(self, current_version: str, feed: Optional[str] = None,
                 manager_factory: Optional[Callable[[], object]] = None,
                 latest: Callable[[], Optional[str]] = latest_published_version) -> None:
        self.current_version = current_version
        self._feed = feed
        self._factory = manager_factory or self._velopack_manager
        self._latest = latest
        self._manager = None
        self._resolved = False
        self._pending = None
        self._downloaded = False
        self._lock = threading.Lock()

    # -- the manager --------------------------------------------------------------

    def _velopack_manager(self):
        import velopack

        source = self._feed or velopack.GithubSource(REPO_URL, None, INCLUDE_PRERELEASES)
        options = velopack.UpdateOptions(False, 10, CHANNEL)
        return velopack.UpdateManager(source, options)

    def _get_manager(self):
        """An UpdateManager, or None if this copy can't update itself."""
        with self._lock:
            if self._resolved:
                return self._manager
            self._resolved = True
            if not getattr(sys, "frozen", False) and self._factory == self._velopack_manager:
                logger.info("running from source; updates are for the installed app")
                return None
            try:
                manager = self._factory()
            except Exception as exc:  # noqa: BLE001 - not installed, or no velopack
                logger.info("update manager unavailable: %s", exc)
                return None
            try:
                if manager.get_is_portable():
                    logger.info("portable copy; updates disabled")
                    return None
            except Exception as exc:  # noqa: BLE001
                logger.info("couldn't tell whether this copy is installed: %s", exc)
                return None
            self._manager = manager
            return manager

    @property
    def can_update(self) -> bool:
        return self._get_manager() is not None

    # -- checking ------------------------------------------------------------------

    def check(self) -> CheckResult:
        manager = self._get_manager()
        if manager is None:
            try:
                latest = self._latest()
            except Exception:  # noqa: BLE001 - only used for the wording
                latest = None
            return CheckResult(NOT_INSTALLED, self.current_version, latest or "")
        try:
            update = manager.check_for_updates()
        except Exception as exc:  # noqa: BLE001
            text = str(exc)
            logger.error("update check failed: %s", text)
            if _means_no_releases(text):
                return CheckResult(NO_RELEASES, self.current_version)
            return CheckResult(FAILED, self.current_version, detail=_short(text))
        if update:
            version = str(update.TargetFullRelease.Version)
            logger.info("update %s available", version)
            self._pending = update
            self._downloaded = False
            return CheckResult(AVAILABLE, self.current_version, version)
        # Velopack says "nothing newer" both when this is the newest release
        # and when there are no releases at all; GitHub tells them apart.
        try:
            latest = self._latest()
        except Exception as exc:  # noqa: BLE001
            logger.info("couldn't list releases: %s", exc)
            latest = self.current_version
        if latest is None:
            logger.info("no releases published yet")
            return CheckResult(NO_RELEASES, self.current_version)
        logger.info("up to date")
        return CheckResult(CURRENT, self.current_version, latest)

    # -- applying --------------------------------------------------------------------

    def download(self) -> bool:
        """Download the update found by check(). Blocks; run it off the UI thread."""
        manager = self._get_manager()
        if manager is None or self._pending is None:
            return False
        try:
            manager.download_updates(self._pending)
            self._downloaded = True
            logger.info("update downloaded")
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("download failed: %s", exc)
            return False

    def apply_and_restart(self) -> bool:
        """Install the downloaded update and start the new version. The
        process exits on success, so a True return is rarely seen."""
        manager = self._get_manager()
        if manager is None or self._pending is None or not self._downloaded:
            return False
        if not data_is_outside_install_dir():
            logger.error("refusing to update: the data folder is inside the install folder")
            return False
        try:
            manager.apply_updates_and_restart(self._pending)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("apply and restart failed: %s", exc)
            return False


def _means_no_releases(text: str) -> bool:
    lowered = text.lower()
    return any(phrase in lowered for phrase in (
        "no releases", "not found", "404", "no release", "releases.theclaudehub.json"))


def _short(text: str, limit: int = 160) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"
