import pytest

from hippowiki.demo import main, slugify, word_count


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Hello, World!", "hello-world"),
        ("  Extra   spaces  ", "extra-spaces"),
        ("already-a-slug", "already-a-slug"),
        ("Python 3.13 Notes", "python-3-13-notes"),
        ("", ""),
        ("!!!", ""),
    ],
)
def test_slugify(title: str, expected: str) -> None:
    assert slugify(title) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", 0),
        ("one", 1),
        ("two words", 2),
        ("  spaced   out\nacross\tlines  ", 4),
    ],
)
def test_word_count(text: str, expected: int) -> None:
    assert word_count(text) == expected


def test_main_prints_demo(capsys: pytest.CaptureFixture[str]) -> None:
    main()
    out = capsys.readouterr().out
    assert "Title: Hippocampus & Memory" in out
    assert "Slug:  hippocampus-memory" in out
    assert "Words: 10" in out
