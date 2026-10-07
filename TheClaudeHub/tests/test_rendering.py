"""Messages as formatted pages (#190): structure kept, nothing unsafe let in."""
import pytest

from theclaudehub.rendering import describe_code_block, markdown_to_html, message_page
from theclaudehub.speech import SpeechSettings


def test_headings_lists_and_tables_keep_their_structure():
    out = markdown_to_html("## Result\n\n- one\n- two\n\n| Name | Value |\n|---|---|\n| a | 1 |")
    assert "<h2>Result</h2>" in out
    assert "<ul>\n<li>one</li>\n<li>two</li>\n</ul>" in out
    assert "<th>Name</th>" in out and "<td>1</td>" in out


def test_code_blocks_are_named_regions():
    out = markdown_to_html("```python\ndef f():\n    return 1\n```\n\n```\nplain\n```")
    assert '<section role="region" aria-label="Code block, Python, 2 lines">' in out
    assert '<section role="region" aria-label="Code block, 1 line">' in out
    assert "def f():" in out


@pytest.mark.parametrize("language,code,words", [
    ("py", "a\nb\nc\n", "Code block, Python, 3 lines"),
    ("", "x", "Code block, 1 line"),
    ("zig", "x\ny", "Code block, zig, 2 lines"),
    ("ps1", "", "Code block, PowerShell, 0 lines"),
])
def test_describe_code_block(language, code, words):
    assert describe_code_block(language, code) == words


def test_raw_html_and_images_are_text_and_bad_links_are_dropped():
    out = markdown_to_html("<script>alert(1)</script>\n\nhi <b>x</b> ![p](http://x/p.png) "
                           "[ok](https://example.com) [bad](javascript:alert(1)) "
                           "[file](file:///C:/x)")
    assert "<script" not in out and "&lt;script&gt;" in out
    assert "<b>" not in out and "&lt;b&gt;" in out
    assert "<img" not in out
    assert '<a href="https://example.com">ok</a>' in out
    assert "javascript:" not in out and "file:" not in out
    assert "<a>bad</a>" in out


def test_page_allows_nothing_remote():
    page = message_page('Claude "says"', "Hello")
    assert "default-src 'none'" in page
    assert "<title>Claude &quot;says&quot;</title>" in page
    assert '<main aria-label="Claude &quot;says&quot;"><p>Hello</p></main>' in page


def test_formatted_setting_round_trips(tmp_path):
    path = tmp_path / "speech.json"
    assert SpeechSettings.load(path).formatted_messages  # on by default
    SpeechSettings(formatted_messages=False).save(path)
    assert not SpeechSettings.load(path).formatted_messages
