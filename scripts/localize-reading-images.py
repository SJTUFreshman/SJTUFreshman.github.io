import hashlib
import io
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "wechat-archives/西多梅"
IMAGE_ROOT = ROOT / "images/reading/xiduomei"
FORMATS = {"JPEG": ".jpg", "PNG": ".png", "GIF": ".gif", "WEBP": ".webp"}


def clean_source_note(text):
    normalized = re.sub(r"[\u200b-\u200f\ufeff]", "", text)
    if len(normalized) > 80 or not re.search(r"[图圖]源[网網][络絡].*侵[删刪]", normalized):
        return text
    cleaned = re.sub(r"(?:底)?[图圖]源[网網][络絡]|侵[删刪]", "", normalized)
    return cleaned.strip(" \t\r\n，,。；;·｜|")


def download_image(job):
    article_id, position, source_url, article_url = job
    target_url = urlsplit(source_url)
    if target_url.scheme != "https" or target_url.hostname != "mmbiz.qpic.cn":
        raise ValueError("Expected a WeChat image URL")
    stem = f"{article_id}-{position:02d}"
    existing = list(IMAGE_ROOT.glob(stem + ".*"))
    if existing:
        image_path = existing[0]
        data = image_path.read_bytes()
    else:
        request = Request(source_url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://mp.weixin.qq.com/"})
        for attempt in range(3):
            try:
                with urlopen(request, timeout=25) as response:
                    data = response.read(25 * 1024 * 1024 + 1)
                if len(data) > 25 * 1024 * 1024:
                    raise ValueError("Image exceeds the website upload limit")
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        with Image.open(io.BytesIO(data)) as image:
            suffix = FORMATS[image.format]
            image.verify()
        image_path = IMAGE_ROOT / (stem + suffix)
        image_path.write_bytes(data)
    with Image.open(io.BytesIO(data)) as image:
        width, height = image.size
        image.verify()
    return {
        "article_id": article_id,
        "article_url": article_url,
        "source_url": source_url,
        "local_file": image_path.relative_to(ROOT).as_posix(),
        "width": width,
        "height": height,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def main():
    article_path = ARCHIVE / "articles.json"
    articles = json.loads(article_path.read_text(encoding="utf-8"))
    jobs = []
    for article in articles:
        position = 0
        for block in article["body"]:
            source_url = block.get("source_url") if block["type"] == "image" else block.get("url", "")
            if source_url and urlsplit(source_url).hostname == "mmbiz.qpic.cn":
                position += 1
                jobs.append((article["id"], position, source_url, article["source_url"]))
    IMAGE_ROOT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as executor:
        images = list(executor.map(download_image, jobs))
    by_source = {image["source_url"]: image for image in images}
    cleaned_notes = 0
    for article in articles:
        blocks = []
        for block in article["body"]:
            if block["type"] == "link" and block.get("url") in by_source:
                image = by_source[block["url"]]
                blocks.append({
                    "type": "image", "src": image["local_file"], "source_url": image["source_url"],
                    "width": image["width"], "height": image["height"], "alt": f"《{article['title']}》原文配图",
                })
            else:
                if "text" in block:
                    cleaned = clean_source_note(block["text"])
                    cleaned_notes += cleaned != block["text"]
                    if not cleaned:
                        continue
                    block["text"] = cleaned
                blocks.append(block)
        article["body"] = blocks
        markdown_path = ROOT / article["archive_file"]
        markdown = markdown_path.read_text(encoding="utf-8")
        for image in images:
            if image["article_id"] == article["id"]:
                markdown = markdown.replace(image["source_url"], "../../" + image["local_file"])
        markdown = "\n".join(clean_source_note(line) for line in markdown.splitlines())
        markdown = re.sub(r"\n{3,}", "\n\n", markdown).rstrip() + "\n"
        markdown_path.write_text(markdown, encoding="utf-8", newline="\n")
    article_path.write_text(json.dumps(articles, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    manifest = {"status": "success", "image_count": len(images), "cost_yuan": 0, "images": images}
    (ARCHIVE / "images.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Localized {len(images)} images across {len(articles)} articles; cleaned {cleaned_notes} source notes.")
    print(f"Saved {sum(image['bytes'] for image in images):,} image bytes. No paid API requests.")


if __name__ == "__main__":
    main()
