import copy
import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("site_renderer", ROOT / "site_renderer.py")
renderer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(renderer)


class ReadingTests(unittest.TestCase):
    def setUp(self):
        self.content = renderer.load_content(ROOT)
        self.collection = self.content["life"]["reading"]["collections"][0]

    def test_pending_source_is_not_presented_as_an_archive(self):
        self.collection["articles"] = []
        rendered = renderer.render_reading(self.content)
        self.assertEqual(renderer.validate_reading(self.content), [])
        self.assertIn('data-portal-content="reading"', rendered)
        self.assertIn('data-key="reading_following"', rendered)
        self.assertIn('data-key="reading_pending_body"', rendered)
        self.assertIn(renderer.esc(self.collection["source_url"]), rendered)
        self.assertNotIn('class="reading-article"', rendered)
        self.assertNotIn('data-thought-reader', rendered)

    def test_scoped_render_preserves_other_sections_and_translations(self):
        with tempfile.TemporaryDirectory() as directory:
            test_root = Path(directory)
            data_path = test_root / "assets/life/scripts/01-content-data.js"
            data_path.parent.mkdir(parents=True)
            translations = {lang: {"custom_text": "Keep & preserve", "reading_retired": "Remove"} for lang in renderer.LANGS}
            data_path.write_text("const i18n = " + json.dumps(translations) + ";\nconst keptRuntime = true;", encoding="utf-8")
            shell = '<p id="keep">Existing content</p>\n<!-- SITEGEN:LIFE_READING_START -->\n<section id="reading"></section>\n<!-- SITEGEN:LIFE_READING_END -->\n<p>After</p>'
            for filename in ("life.html", "observatory.html"):
                (test_root / filename).write_text(shell, encoding="utf-8")
            artifacts = renderer.render_reading_updates(test_root, self.content, write=False)
            for path, rendered in artifacts.items():
                if path.suffix == ".html":
                    self.assertTrue(rendered.startswith('<p id="keep">Existing content</p>'))
                    self.assertTrue(rendered.endswith("<p>After</p>"))
                else:
                    self.assertIn('"custom_text": "Keep & preserve"', rendered)
                    self.assertNotIn('reading_retired', rendered)
                    self.assertTrue(rendered.endswith("const keptRuntime = true;"))
            self.assertEqual((test_root / "life.html").read_text(encoding="utf-8"), shell)

    def test_article_preserves_text_images_captions_and_source_order(self):
        article = {
            "id": "sample",
            "title": "原文标题 <script>",
            "author": "作者 & 署名",
            "source_url": "https://example.com/original?one=1&two=2",
            "published": "2026-11-05",
            "body": [
                {"type": "heading", "text": "小标题"},
                {"type": "text", "text": "第一段\n仍在第一段 <script>alert(1)</script>"},
                {"type": "image", "src": "images/reading/example.gif", "width": 32,
                 "height": 24, "alt": "图像描述", "caption": "原图注 & 署名"},
                {"type": "quote", "text": "引用原文"},
                {"type": "text", "text": "最后一段"},
            ],
        }
        thoughts = copy.deepcopy(self.content["life"]["thoughts"])
        self.collection["articles"] = [article]
        with tempfile.TemporaryDirectory() as directory:
            test_root = Path(directory)
            image = test_root / "images/reading/example.gif"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"GIF89a")
            with patch.object(renderer, "ROOT", test_root):
                self.assertEqual(renderer.validate_reading(self.content), [])
        rendered = renderer.render_reading(self.content)
        positions = [rendered.index(value) for value in
                     ["小标题", "第一段", "images/reading/example.gif", "原图注 &amp; 署名", "引用原文", "最后一段"]]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("第一段\n仍在第一段 &lt;script&gt;", rendered)
        self.assertIn("作者 &amp; 署名", rendered)
        self.assertIn("https://example.com/original?one=1&amp;two=2", rendered)
        self.assertIn('lang="zh-CN"', rendered)
        self.assertNotIn("<script>", rendered)
        self.assertNotIn('data-key="reading_pending_body"', rendered)
        self.assertEqual(self.content["life"]["thoughts"], thoughts)

    def test_invalid_sources_and_unsupported_content_fail_validation(self):
        for url in ["javascript:alert(1)", "https://user:secret@example.com/", "https://["]:
            with self.subTest(url=url):
                self.collection["source_url"] = url
                self.assertTrue(renderer.validate_reading(self.content))
        self.collection["source_url"] = "https://example.com/"
        self.collection["articles"] = [{
            "id": "sample", "title": "Test", "source_url": "https://example.com/article",
            "body": [{"type": "video", "src": "movie.mp4"}],
        }]
        self.assertTrue(any("尚不支持" in error for error in renderer.validate_reading(self.content)))
        self.collection["articles"][0]["body"] = [
            {"type": "image", "src": "images/reading/../../private.png", "width": 10, "height": 10}
        ]
        self.assertTrue(any("images/reading/" in error for error in renderer.validate_reading(self.content)))

    def test_archived_articles_preserve_text_and_exclude_placeholder_metrics(self):
        articles = self.collection["articles"]
        self.assertEqual(len(articles), 31)
        self.assertEqual(len({article["source_url"] for article in articles}), 31)
        self.assertEqual(articles[0]["title"], "横流")
        self.assertEqual(articles[-1]["title"], "渐渐")
        for article in articles:
            with self.subTest(title=article["title"]):
                source = (ROOT / article["archive_file"]).read_text(encoding="utf-8")
                self.assertNotIn("- 互动：", source)
                expected = source.split("\n## 正文\n", 1)[1]
                expected = re.sub(r"!\[[^\]]*\]\([^\n]+\)", "", expected)
                expected = re.sub(r"^(?:#{1,6} |>[ ]?)", "", expected, flags=re.M)
                actual = "".join(block["text"] for block in article["body"] if block["type"] != "link")
                self.assertEqual(re.sub(r"\s", "", actual), re.sub(r"\s", "", expected))
                self.assertEqual(article.get("author", ""), "")

    def test_external_article_files_stay_within_the_site(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "site_content.json").write_text(json.dumps({
                "life": {"reading": {"collections": [{"articles_file": "../outside.json"}]}}
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "站点目录内"):
                renderer.load_content(root)

    def test_media_links_are_escaped_and_validated(self):
        self.collection["articles"] = [{
            "id": "media", "title": "Media", "source_url": "https://example.com/article",
            "body": [{"type": "link", "text": "<script> & music", "url": "https://example.com/music?a=1&b=2"}],
        }]
        self.assertEqual(renderer.validate_reading(self.content), [])
        rendered = renderer.render_reading(self.content)
        self.assertIn("&lt;script&gt; &amp; music", rendered)
        self.assertIn("music?a=1&amp;b=2", rendered)
        self.collection["articles"][0]["body"][0]["url"] = "javascript:alert(1)"
        self.assertTrue(renderer.validate_reading(self.content))


if __name__ == "__main__":
    unittest.main()
