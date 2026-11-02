"""Small demo of HippoWiki helper functions."""

import re


def slugify(title: str) -> str:
    """Turn a page title into a URL-friendly slug, e.g. "Hello, World!" -> "hello-world"."""
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def word_count(text: str) -> int:
    """Count the whitespace-separated words in a text."""
    return len(text.split())


def main() -> None:
    """Print a short demo of the helper functions."""
    title = "Hippocampus & Memory"
    body = "The hippocampus plays a key role in forming new memories."
    print(f"Title: {title}")
    print(f"Slug:  {slugify(title)}")
    print(f"Words: {word_count(body)}")


if __name__ == "__main__":
    main()
