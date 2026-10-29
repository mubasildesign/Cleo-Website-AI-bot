#!/usr/bin/env python3
"""Build Axon's public GTM Buddy knowledge index from the Webflow sitemap."""

from __future__ import annotations

import html
import json
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITEMAP = "https://gtmbuddy.ai/sitemap.xml"
OUTPUT = ROOT / "src" / "knowledge-index.js"
USER_AGENT = "AxonKnowledgeBuilder/1.0 (+https://gtmbuddy.ai)"
SKIP_PATHS = ("/pages-testimonials/", "/team/", "/integrations-categories/", "/testimonials/")


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


class ContentParser(HTMLParser):
    """Extract useful public copy while excluding page chrome and code."""

    BLOCKED = {"script", "style", "svg", "noscript", "nav", "footer", "form"}
    TEXT_TAGS = {"h1", "h2", "h3", "h4", "p", "li", "blockquote", "td", "th"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.block_depth = 0
        self.current_tag = ""
        self.buffer: list[str] = []
        self.blocks: list[tuple[str, str]] = []
        self.title = ""
        self.in_title = False
        self.description = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag in self.BLOCKED:
            self.block_depth += 1
        if self.block_depth:
            return
        if tag == "title":
            self.in_title = True
            self.buffer = []
        elif tag == "meta" and attrs_dict.get("name", "").lower() == "description":
            self.description = attrs_dict.get("content", "") or ""
        elif tag in self.TEXT_TAGS:
            self.current_tag = tag
            self.buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCKED and self.block_depth:
            self.block_depth -= 1
            return
        if self.block_depth:
            return
        text = clean(" ".join(self.buffer))
        if tag == "title" and self.in_title:
            self.title = text
            self.in_title = False
            self.buffer = []
        elif tag == self.current_tag and tag in self.TEXT_TAGS:
            if len(text) >= 18 and not looks_like_chrome(text):
                self.blocks.append((tag, text))
            self.current_tag = ""
            self.buffer = []

    def handle_data(self, data: str) -> None:
        if self.block_depth:
            return
        if self.in_title or self.current_tag:
            self.buffer.append(data)


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def looks_like_chrome(text: str) -> bool:
    normalized = text.lower()
    chrome = {
        "book a demo", "login", "contact us", "privacy policy", "terms of use",
        "all rights reserved", "follow us", "request a demo", "get started",
    }
    return normalized in chrome or len(set(text.split())) < 3


def page_type(url: str) -> str:
    path = urllib.request.urlparse(url).path if hasattr(urllib.request, "urlparse") else ""
    # urlparse lives in urllib.parse; string matching keeps this dependency-free.
    if "/blog/" in url:
        return "blog"
    if "/customers/" in url:
        return "customer"
    if "/product/" in url:
        return "product"
    if "/levers/" in url:
        return "lever"
    if "/migrate-from-" in url:
        return "comparison"
    if "/authors/" in url:
        return "author"
    if any(part in url for part in ("privacy-policy", "terms-", "data-processing")):
        return "legal"
    return "page"


def parse_page(url: str, source: str) -> dict:
    parser = ContentParser()
    parser.feed(source)
    headings = [text for tag, text in parser.blocks if tag.startswith("h")][:24]
    copy = [text for tag, text in parser.blocks if tag in {"p", "li", "blockquote", "td", "th"}]

    # Deduplicate repeated Webflow/mobile copies while preserving order.
    seen: set[str] = set()
    unique: list[str] = []
    for block in headings + copy:
        key = block.lower()
        if key not in seen:
            seen.add(key)
            unique.append(block)

    text = "\n".join(unique)
    return {
        "url": url,
        "type": page_type(url),
        "title": parser.title or (headings[0] if headings else url.rstrip("/").split("/")[-1]),
        "description": clean(parser.description),
        "headings": headings,
        "excerpt": clean(" ".join(copy[:4]))[:700],
        "text": text[:24000],
    }


def sitemap_urls(xml_source: str) -> list[str]:
    root = ET.fromstring(xml_source)
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [node.text.strip() for node in root.findall("sm:url/sm:loc", namespace) if node.text]
    return [url for url in urls if not any(path in url for path in SKIP_PATHS)]


def main() -> None:
    urls = sitemap_urls(fetch(SITEMAP))
    documents: list[dict] = []
    failures: list[dict] = []

    for number, url in enumerate(urls, start=1):
        try:
            document = parse_page(url, fetch(url))
            documents.append(document)
            print(f"[{number:03}/{len(urls):03}] {document['type']:<10} {url}")
        except Exception as error:  # Continue to retain the rest of the corpus.
            failures.append({"url": url, "error": str(error)})
            print(f"[{number:03}/{len(urls):03}] FAILED     {url}: {error}")
        time.sleep(0.06)

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": SITEMAP,
        "documents": documents,
        "failures": failures,
    }
    OUTPUT.write_text(
        "window.AXON_KNOWLEDGE = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"\nWrote {len(documents)} documents to {OUTPUT}")
    if failures:
        print(f"{len(failures)} pages failed; details are embedded in the index.")


if __name__ == "__main__":
    main()
