"""A message's markdown as a small HTML page, for a screen reader's browse
mode (issue #190).

Claude writes markdown: headings, lists, tables, code. In a plain text box a
table is a run of pipes and a heading is "##". As a web page the screen
reader can move by heading (H), table and cell (T, Ctrl+Alt+arrows), list
(L) and region (R, where each code block is one, named "Code block, Python,
14 lines").

The page is built to be inert:

* Raw HTML in a message is shown as text, never rendered (Python-Markdown's
  HTML block and inline HTML handling is switched off).
* Images aren't loaded: the image syntax is switched off, so it reads as a
  link instead.
* A Content-Security-Policy allows nothing but the page's own styles, so
  nothing remote is fetched and no script in the page can run.
* Links keep only http, https and mailto targets; the viewer opens them in
  the default browser, never in itself.
"""
from __future__ import annotations

import html
import re

import markdown
from markdown.extensions.fenced_code import FencedCodeExtension
from markdown.extensions.sane_lists import SaneListExtension
from markdown.extensions.tables import TableExtension

_CODE = re.compile(r'<pre><code(?: class="language-([^"]+)")?>(.*?)</code></pre>', re.DOTALL)
_HREF = re.compile(r'<a href="([^"]*)"')
_SAFE_LINK = re.compile(r"(?i)^(https?:|mailto:)")

LANGUAGE_NAMES = {
    "py": "Python", "python": "Python", "js": "JavaScript", "javascript": "JavaScript",
    "ts": "TypeScript", "typescript": "TypeScript", "json": "JSON", "html": "HTML",
    "xml": "XML", "css": "CSS", "sh": "Shell", "bash": "Bash", "shell": "Shell",
    "powershell": "PowerShell", "ps1": "PowerShell", "pwsh": "PowerShell", "cs": "C#",
    "csharp": "C#", "c": "C", "cpp": "C++", "sql": "SQL", "yaml": "YAML", "yml": "YAML",
    "md": "Markdown", "markdown": "Markdown", "diff": "Diff", "text": "Text", "toml": "TOML",
}

_STYLE = """
body { font: 16px/1.5 "Segoe UI", sans-serif; margin: 1em 1.5em; max-width: 60em; }
pre { white-space: pre-wrap; background: #f3f3f3; padding: .6em; border-radius: 4px; }
code { font-family: Consolas, monospace; }
table { border-collapse: collapse; margin: .5em 0; }
th, td { border: 1px solid #888; padding: .25em .6em; text-align: left; vertical-align: top; }
@media (prefers-color-scheme: dark) {
  body { background: #1e1e1e; color: #e8e8e8; }
  pre { background: #2b2b2b; }
  a { color: #8ab4f8; }
}
"""


def language_name(tag: str) -> str:
    """'py' -> 'Python'; unknown tags as written."""
    tag = (tag or "").strip()
    return LANGUAGE_NAMES.get(tag.lower(), tag)


def describe_code_block(language: str, code: str) -> str:
    """'Code block, Python, 14 lines' (the name a screen reader hears)."""
    lines = len(code.rstrip("\n").split("\n")) if code.strip() else 0
    parts = ["Code block"]
    if language:
        parts.append(language_name(language))
    parts.append(f"{lines} line" + ("" if lines == 1 else "s"))
    return ", ".join(parts)


def _converter() -> markdown.Markdown:
    md = markdown.Markdown(extensions=[FencedCodeExtension(), TableExtension(),
                                       SaneListExtension()],
                           output_format="html")
    md.preprocessors.deregister("html_block")
    for name in ("html", "image_link", "image_reference", "short_image_ref"):
        md.inlinePatterns.deregister(name)
    return md


def markdown_to_html(text: str) -> str:
    """The body HTML for ``text``: code blocks as named regions, unsafe links
    made plain text."""
    body = _converter().convert(text or "")

    def code_region(match: "re.Match[str]") -> str:
        language, code = match.group(1) or "", html.unescape(match.group(2))
        label = html.escape(describe_code_block(language, code), quote=True)
        return f'<section role="region" aria-label="{label}">{match.group(0)}</section>'

    def link(match: "re.Match[str]") -> str:
        href = html.unescape(match.group(1))
        return match.group(0) if _SAFE_LINK.match(href) else "<a"

    return _HREF.sub(link, _CODE.sub(code_region, body))


def message_page(title: str, text: str) -> str:
    """A whole page: ``title`` is the window's and the page's name."""
    name = html.escape(title, quote=True)
    return ("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta http-equiv=\"Content-Security-Policy\" "
            "content=\"default-src 'none'; style-src 'unsafe-inline'\">"
            f"<title>{name}</title><style>{_STYLE}</style></head>"
            f"<body><main aria-label=\"{name}\">{markdown_to_html(text)}</main></body></html>")
