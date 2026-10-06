"""The updater, with a fake Velopack manager and a fake GitHub (no network)."""
import json
import re
import sys
from pathlib import Path

import pytest

import theclaudehub
from theclaudehub import updater
from theclaudehub.updater import (AVAILABLE, CURRENT, FAILED, NO_RELEASES, NOT_INSTALLED,
                                  UpdateService, data_is_outside_install_dir,
                                  latest_published_version)


class Release:
    def __init__(self, version):
        self.Version = version


class Update:
    def __init__(self, version):
        self.TargetFullRelease = Release(version)


class FakeManager:
    def __init__(self, update=None, portable=False, check_error=None):
        self.update = update
        self.portable = portable
        self.check_error = check_error
        self.downloaded = []
        self.applied = []

    def get_is_portable(self):
        return self.portable

    def check_for_updates(self):
        if self.check_error:
            raise RuntimeError(self.check_error)
        return self.update

    def download_updates(self, update):
        self.downloaded.append(update)

    def apply_updates_and_restart(self, update):
        self.applied.append(update)


def service(manager, latest="0.2.0", urls=None):
    def latest_fn():
        if isinstance(latest, Exception):
            raise latest
        return latest

    def factory(url):
        if urls is not None:
            urls.append(url)
        return manager
    return UpdateService("0.1.0", manager_factory=factory, latest=latest_fn)


def test_update_available_is_not_downloaded_until_asked():
    manager = FakeManager(Update("0.2.0"))
    urls = []
    svc = service(manager, urls=urls)
    result = svc.check()
    assert result.status == AVAILABLE and result.version == "0.2.0"
    assert result.describe() == "TheClaudeHub 0.2.0 is available. You have 0.1.0."
    # Velopack reads the feed from that one release, not the repo's newest 10.
    assert urls[-1] == ("https://github.com/kellylford/TheWorkBench/releases/download/"
                        "theclaudehub-v0.2.0/")
    assert manager.downloaded == []            # nothing happens without a yes
    assert svc.apply_and_restart() is False   # can't apply what isn't downloaded
    assert svc.download() is True
    assert svc.apply_and_restart() is True
    assert manager.applied and manager.applied[0].TargetFullRelease.Version == "0.2.0"


def test_up_to_date_never_asks_velopack():
    manager = FakeManager(check_error="should not be called")
    result = service(manager, latest="0.1.0").check()
    assert result.status == CURRENT
    assert result.describe() == "TheClaudeHub is up to date (version 0.1.0)."


def test_no_releases_yet_is_said_plainly():
    result = service(FakeManager(None), latest=None).check()
    assert result.status == NO_RELEASES
    assert result.describe().startswith("No TheClaudeHub release has been published yet.")


def test_newer_release_whose_feed_offers_nothing_is_a_failure_not_up_to_date():
    # The bug this design fixes: other apps' releases hid TheClaudeHub's feed
    # and Velopack said "nothing newer" while 0.2.0 was out.
    result = service(FakeManager(None), latest="0.2.0").check()
    assert result.status == FAILED
    assert "0.2.0 is published" in result.describe()
    assert "up to date" not in result.describe()


def test_feed_errors_are_reported_briefly_not_hidden():
    result = service(FakeManager(check_error="404 Not Found " * 30)).check()
    assert result.status == FAILED
    assert result.describe().startswith("Couldn't check for updates: 404 Not Found")
    assert len(result.detail) <= 160


def test_github_unreachable_is_a_failure():
    result = service(FakeManager(None), latest=OSError("offline")).check()
    assert result.status == FAILED
    assert "GitHub couldn't be reached (offline)" in result.describe()


def test_portable_and_source_copies_say_they_cannot_update():
    portable = service(FakeManager(Update("9.9.9"), portable=True), latest="0.3.0").check()
    assert portable.status == NOT_INSTALLED and portable.version == "0.3.0"
    assert "can't update itself" in portable.describe() and "0.3.0" in portable.describe()

    def broken(url):
        raise RuntimeError("NotInstalled")
    source = UpdateService("0.1.0", manager_factory=broken, latest=lambda: None).check()
    assert source.status == NOT_INSTALLED
    assert "No release has been published yet" in source.describe()


def test_quiet_check_on_a_copy_that_cannot_update_asks_github_nothing():
    def latest():
        raise AssertionError("GitHub was asked")
    portable = UpdateService("0.1.0", manager_factory=lambda url: FakeManager(portable=True),
                             latest=latest)
    assert portable.check(manual=False).status == NOT_INSTALLED


def test_source_run_never_touches_velopack(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    svc = UpdateService("0.1.0", latest=lambda: None)
    assert svc.can_update is False
    assert svc.check().status == NOT_INSTALLED


def test_download_failure_is_reported():
    manager = FakeManager(Update("0.2.0"))

    def fail(update):
        raise OSError("disk full")
    manager.download_updates = fail
    svc = service(manager)
    svc.check()
    assert svc.download() is False
    assert svc.apply_and_restart() is False


def test_latest_published_version_filters_by_prefix():
    releases = [
        {"tag_name": "hyperv-manage-v0.9.2"},
        {"tag_name": "theclaudehub-v0.1.0"},
        {"tag_name": "theclaudehub-v0.10.0"},
        {"tag_name": "theclaudehub-v0.2.0"},
        {"tag_name": "theclaudehub-v9.0.0", "draft": True},
    ]
    assert latest_published_version(lambda url: json.dumps(releases).encode()) == "0.10.0"
    only_others = [{"tag_name": "hyperv-manage-v0.9.2"}]
    assert latest_published_version(lambda url: json.dumps(only_others).encode()) is None
    assert latest_published_version(lambda url: b"{}") is None
    odd = [None, "text", {"tag_name": "theclaudehub-v0.3.0"}]
    assert latest_published_version(lambda url: json.dumps(odd).encode()) == "0.3.0"


# -- data safety ---------------------------------------------------------------------------


def test_data_folder_is_outside_the_folder_velopack_replaces(tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local"))
    monkeypatch.setattr(updater.platform_paths.sys, "platform", "win32")
    assert data_is_outside_install_dir()
    assert not data_is_outside_install_dir(tmp_path / "Local" / "TheClaudeHub" / "data",
                                           tmp_path / "Local" / "TheClaudeHub")
    assert not data_is_outside_install_dir(tmp_path / "Local" / "TheClaudeHub",
                                           tmp_path / "Local" / "TheClaudeHub")


def test_installed_copy_checks_the_folder_it_really_runs_from(tmp_path, monkeypatch):
    root = tmp_path / "Somewhere" / "TheClaudeHub"
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(root / "current" / "TheClaudeHub.exe"))
    assert data_is_outside_install_dir(tmp_path / "Roaming" / "TheClaudeHub")
    assert not data_is_outside_install_dir(root / "data")


def test_apply_is_refused_if_data_would_be_replaced(monkeypatch):
    manager = FakeManager(Update("0.2.0"))
    svc = service(manager)
    svc.check()
    svc.download()
    monkeypatch.setattr(updater, "data_is_outside_install_dir", lambda: False)
    assert svc.apply_and_restart() is False
    assert manager.applied == []


# -- one version ---------------------------------------------------------------------------


def test_version_is_plain_semver_for_vpk():
    assert re.fullmatch(r"\d+\.\d+\.\d+", theclaudehub.__version__)


def test_release_notes_exist_for_this_version():
    notes = Path(__file__).resolve().parent.parent / "release-notes" / \
        f"v{theclaudehub.__version__}.md"
    assert notes.is_file(), f"write {notes.name} before tagging"
    text = notes.read_text(encoding="utf-8")
    for heading in ("## What's new", "## Downloads", "## Requirements"):
        assert heading in text


@pytest.mark.parametrize("tag,ok", [("theclaudehub-v0.1.0", True), ("theclaudehub-v0.1.1", False),
                                    ("v0.1.0", False)])
def test_tag_check_script(tag, ok):
    import subprocess
    script = Path(__file__).resolve().parent.parent / "tools" / "check_version.py"
    version = theclaudehub.__version__
    tag = tag.replace("0.1.0", version) if ok else tag
    result = subprocess.run([sys.executable, str(script), tag], capture_output=True, text=True)
    assert (result.returncode == 0) is ok, result.stdout + result.stderr
