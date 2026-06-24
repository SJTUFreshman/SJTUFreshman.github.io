from __future__ import annotations

import copy
import json
import sys
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

import site_renderer

ROOT = Path(__file__).resolve().parent
CONTENT_FILE = ROOT / "site_content.json"
LANGS = ("en", "zh-CN", "zh-TW")


def load_content() -> dict[str, Any]:
    return json.loads(CONTENT_FILE.read_text(encoding="utf-8"))


def save_content(content: dict[str, Any]) -> None:
    CONTENT_FILE.write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    site_renderer.render_site(ROOT, write=True)


def path_parts(path: str) -> list[str | int]:
    parts: list[str | int] = []
    for part in path.split("."):
        parts.append(int(part) if part.isdigit() else part)
    return parts


def get_path(data: Any, path: str, default: Any = "") -> Any:
    cur = data
    for part in path_parts(path):
        try:
            cur = cur[part]
        except (KeyError, IndexError, TypeError):
            return default
    return cur


def set_path(data: Any, path: str, value: Any) -> None:
    cur = data
    parts = path_parts(path)
    for part in parts[:-1]:
        if isinstance(part, int):
            while len(cur) <= part:
                cur.append({})
            cur = cur[part]
        else:
            cur = cur.setdefault(part, {})
    last = parts[-1]
    if isinstance(last, int):
        while len(cur) <= last:
            cur.append("")
        cur[last] = value
    else:
        cur[last] = value


def as_float(value: str) -> float | str:
    try:
        return float(value)
    except ValueError:
        return value


SECTION_SPECS: dict[str, dict[str, Any]] = {
    "主页 / News": {
        "path": "home.news",
        "display": "text.en",
        "default": {"id": "news_new", "date": "2026", "text": {"en": "New update.", "zh-CN": "新的动态。", "zh-TW": "新的動態。"}},
        "fields": [
            ("ID", "id", "entry"),
            ("Date", "date", "entry"),
            ("Text EN", "text.en", "text"),
            ("Text 简中", "text.zh-CN", "text"),
            ("Text 繁中", "text.zh-TW", "text")
        ]
    },
    "主页 / Publications": {
        "path": "home.publications",
        "display": "title",
        "default": {"id": "NewPaper_2026", "title": "New paper title", "authors_html": "<b>Runde Yang</b>", "venue": "Venue", "paper_url": "#", "code_url": "#", "citation": ""},
        "fields": [
            ("Citation ID", "id", "entry"),
            ("Title", "title", "text"),
            ("Authors HTML", "authors_html", "textarea"),
            ("Venue", "venue", "entry"),
            ("Paper URL", "paper_url", "entry"),
            ("Code URL", "code_url", "entry"),
            ("BibTeX Citation", "citation", "textarea")
        ]
    },
    "主页 / Projects": {
        "path": "home.projects",
        "display": "name",
        "default": {"id": "new_project", "name": "New Project", "image": "images/example.png", "alt": "New Project", "desc": {"en": "", "zh-CN": "", "zh-TW": ""}, "paper_url": "#", "code_url": "#"},
        "fields": [
            ("ID", "id", "entry"),
            ("Name", "name", "entry"),
            ("Image path", "image", "file"),
            ("Image alt", "alt", "entry"),
            ("Description EN", "desc.en", "textarea"),
            ("Description 简中", "desc.zh-CN", "textarea"),
            ("Description 繁中", "desc.zh-TW", "textarea"),
            ("Paper URL", "paper_url", "entry"),
            ("Code URL", "code_url", "entry")
        ]
    },
    "主页 / Gallery": {
        "path": "home.gallery",
        "display": "caption.en",
        "default": {"id": "new_photo", "image": "images/example.jpg", "alt": "Photo", "caption": {"en": "New photo", "zh-CN": "新照片", "zh-TW": "新照片"}},
        "fields": [
            ("ID", "id", "entry"),
            ("Image path", "image", "file"),
            ("Alt", "alt", "entry"),
            ("Caption EN", "caption.en", "entry"),
            ("Caption 简中", "caption.zh-CN", "entry"),
            ("Caption 繁中", "caption.zh-TW", "entry")
        ]
    },
    "主页 / Notes": {
        "path": "home.notes",
        "display": "title",
        "default": {"title": "New note", "href": "documents/example.pdf", "meta": "PDF · 2026-01-01", "icon": "far fa-file-pdf"},
        "fields": [
            ("Title", "title", "entry"),
            ("File / URL", "href", "file"),
            ("Meta", "meta", "entry"),
            ("Icon class", "icon", "entry")
        ]
    },
    "生活 / Gallery": {
        "path": "life.gallery",
        "display": "caption.en",
        "default": {"id": "new_life_photo", "image": "images/example.jpg", "alt": "Photo", "caption": {"en": "New photo", "zh-CN": "新照片", "zh-TW": "新照片"}},
        "fields": [
            ("ID", "id", "entry"),
            ("Image path", "image", "file"),
            ("Alt", "alt", "entry"),
            ("Caption EN", "caption.en", "entry"),
            ("Caption 简中", "caption.zh-CN", "entry"),
            ("Caption 繁中", "caption.zh-TW", "entry")
        ]
    },
    "生活 / Shelf": {
        "path": "life.shelf",
        "display": "title",
        "default": {"id": "new_shelf_item", "icon": "fas fa-book", "title": "New item", "comment": {"en": "", "zh-CN": "", "zh-TW": ""}},
        "fields": [
            ("ID", "id", "entry"),
            ("Icon class", "icon", "entry"),
            ("Title", "title", "entry"),
            ("Comment EN", "comment.en", "textarea"),
            ("Comment 简中", "comment.zh-CN", "textarea"),
            ("Comment 繁中", "comment.zh-TW", "textarea")
        ]
    },
    "生活 / Thoughts": {
        "path": "life.thoughts",
        "display": "date.en",
        "default": {"id": "thought_new", "date": {"en": "Jan 1, 2026", "zh-CN": "2026年1月1日", "zh-TW": "2026年1月1日"}, "text": {"en": "", "zh-CN": "", "zh-TW": ""}},
        "fields": [
            ("ID", "id", "entry"),
            ("Date EN", "date.en", "entry"),
            ("Date 简中", "date.zh-CN", "entry"),
            ("Date 繁中", "date.zh-TW", "entry"),
            ("Text EN", "text.en", "textarea"),
            ("Text 简中", "text.zh-CN", "textarea"),
            ("Text 繁中", "text.zh-TW", "textarea")
        ]
    },
    "生活 / Friends": {
        "path": "life.friends",
        "display": "label",
        "default": {"label": "New friend", "href": "#"},
        "fields": [
            ("Label", "label", "entry"),
            ("URL", "href", "entry")
        ]
    },
    "生活 / Visited Cities": {
        "path": "life.footprints.visited_china",
        "display": "",
        "default": "上海市",
        "string_item": True,
        "fields": [("City name", "", "entry")]
    },
    "生活 / World Points": {
        "path": "life.footprints.world_points",
        "display": "name",
        "default": {"name": "New Place", "value": [0.0, 0.0]},
        "fields": [
            ("Name", "name", "entry"),
            ("Longitude", "value.0", "number"),
            ("Latitude", "value.1", "number")
        ]
    }
}


HERO_FIELDS = [
    ("Avatar", "home.hero.avatar", "file"),
    ("Name EN HTML", "home.hero.name_html.en", "textarea"),
    ("Name 简中", "home.hero.name_html.zh-CN", "entry"),
    ("Name 繁中", "home.hero.name_html.zh-TW", "entry"),
    ("Title EN", "home.hero.title.en", "textarea"),
    ("Title 简中", "home.hero.title.zh-CN", "textarea"),
    ("Title 繁中", "home.hero.title.zh-TW", "textarea"),
    ("Bio EN", "home.hero.bio.en", "textarea"),
    ("Bio 简中", "home.hero.bio.zh-CN", "textarea"),
    ("Bio 繁中", "home.hero.bio.zh-TW", "textarea"),
    ("Location EN", "home.hero.location.en", "entry"),
    ("Location 简中", "home.hero.location.zh-CN", "entry"),
    ("Location 繁中", "home.hero.location.zh-TW", "entry"),
    ("GitHub URL", "home.hero.links.0.href", "entry"),
    ("Scholar URL", "home.hero.links.1.href", "entry"),
    ("Email user", "site.email_user", "entry"),
    ("Email domain", "site.email_domain", "entry"),
    ("Footer HTML", "site.footer", "entry"),
    ("Life Card Title EN", "home.life_card.title.en", "entry"),
    ("Life Card Title 简中", "home.life_card.title.zh-CN", "entry"),
    ("Life Card Title 繁中", "home.life_card.title.zh-TW", "entry"),
    ("Life Card Desc EN", "home.life_card.desc.en", "textarea"),
    ("Life Card Desc 简中", "home.life_card.desc.zh-CN", "textarea"),
    ("Life Card Desc 繁中", "home.life_card.desc.zh-TW", "textarea"),
    ("Notes Empty EN", "home.notes_empty.en", "entry"),
    ("Notes Empty 简中", "home.notes_empty.zh-CN", "entry"),
    ("Notes Empty 繁中", "home.notes_empty.zh-TW", "entry")
]


class HomepageEditor(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Homepage Content Editor")
        self.geometry("1180x760")
        self.minsize(980, 620)
        self.content = load_content()
        self.current_section = tk.StringVar(value=next(iter(SECTION_SPECS)))
        self.current_index: int | None = None
        self.form_widgets: dict[str, tk.Widget] = {}
        self.hero_widgets: dict[str, tk.Widget] = {}
        self.label_page = tk.StringVar(value="home")
        self.label_key: str | None = None

        self.create_widgets()
        self.load_hero_form()
        self.load_section()
        self.load_label_keys()

    def create_widgets(self) -> None:
        top = ttk.Frame(self, padding=(12, 10))
        top.pack(fill="x")
        ttk.Button(top, text="保存并生成网站", command=self.save_all).pack(side="left")
        ttk.Button(top, text="只保存 JSON", command=self.save_json_only).pack(side="left", padx=(8, 0))
        ttk.Button(top, text="预览 index.html", command=lambda: webbrowser.open((ROOT / "index.html").as_uri())).pack(side="left", padx=(8, 0))
        ttk.Button(top, text="重新载入", command=self.reload_all).pack(side="left", padx=(8, 0))
        self.status = ttk.Label(top, text=str(CONTENT_FILE))
        self.status.pack(side="right")

        notebook = ttk.Notebook(self)
        notebook.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        self.hero_tab = ttk.Frame(notebook)
        self.list_tab = ttk.Frame(notebook)
        self.label_tab = ttk.Frame(notebook)
        self.help_tab = ttk.Frame(notebook)
        notebook.add(self.hero_tab, text="主页资料")
        notebook.add(self.list_tab, text="列表板块")
        notebook.add(self.label_tab, text="导航/标题")
        notebook.add(self.help_tab, text="使用说明")
        self.build_hero_tab()
        self.build_list_tab()
        self.build_label_tab()
        self.build_help_tab()

    def build_hero_tab(self) -> None:
        canvas = tk.Canvas(self.hero_tab, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self.hero_tab, orient="vertical", command=canvas.yview)
        frame = ttk.Frame(canvas, padding=12)
        frame.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        for row, (label, path, kind) in enumerate(HERO_FIELDS):
            ttk.Label(frame, text=label).grid(row=row, column=0, sticky="nw", pady=5, padx=(0, 10))
            widget = self.make_field(frame, path, kind)
            widget.grid(row=row, column=1, sticky="ew", pady=5)
            if kind == "file":
                ttk.Button(frame, text="选择", command=lambda p=path: self.pick_file(self.hero_widgets[p])).grid(row=row, column=2, padx=(6, 0))
            self.hero_widgets[path] = widget
        frame.columnconfigure(1, weight=1)
        ttk.Button(frame, text="应用主页资料", command=self.write_hero_form).grid(row=len(HERO_FIELDS), column=1, sticky="e", pady=12)

    def build_list_tab(self) -> None:
        left = ttk.Frame(self.list_tab, padding=12)
        left.pack(side="left", fill="y")
        right = ttk.Frame(self.list_tab, padding=12)
        right.pack(side="left", fill="both", expand=True)

        ttk.Label(left, text="板块").pack(anchor="w")
        section_box = ttk.Combobox(left, textvariable=self.current_section, values=list(SECTION_SPECS), state="readonly", width=28)
        section_box.pack(fill="x", pady=(4, 10))
        section_box.bind("<<ComboboxSelected>>", lambda _e: self.load_section())

        self.item_list = tk.Listbox(left, width=34, height=24, exportselection=False)
        self.item_list.pack(fill="both", expand=True)
        self.item_list.bind("<<ListboxSelect>>", self.on_item_selected)

        btns = ttk.Frame(left)
        btns.pack(fill="x", pady=(10, 0))
        ttk.Button(btns, text="新增", command=self.add_item).grid(row=0, column=0, sticky="ew")
        ttk.Button(btns, text="复制", command=self.duplicate_item).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(btns, text="删除", command=self.delete_item).grid(row=0, column=2, sticky="ew")
        ttk.Button(btns, text="上移", command=lambda: self.move_item(-1)).grid(row=1, column=0, sticky="ew", pady=(4, 0))
        ttk.Button(btns, text="下移", command=lambda: self.move_item(1)).grid(row=1, column=1, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(btns, text="应用", command=self.write_current_item).grid(row=1, column=2, sticky="ew", pady=(4, 0))
        for col in range(3):
            btns.columnconfigure(col, weight=1)

        self.form_title = ttk.Label(right, text="", font=("Segoe UI", 12, "bold"))
        self.form_title.pack(anchor="w")
        self.form_frame = ttk.Frame(right)
        self.form_frame.pack(fill="both", expand=True, pady=(10, 0))

    def build_label_tab(self) -> None:
        left = ttk.Frame(self.label_tab, padding=12)
        left.pack(side="left", fill="y")
        right = ttk.Frame(self.label_tab, padding=12)
        right.pack(side="left", fill="both", expand=True)
        ttk.Label(left, text="页面").pack(anchor="w")
        box = ttk.Combobox(left, textvariable=self.label_page, values=["home", "life"], state="readonly", width=16)
        box.pack(fill="x", pady=(4, 10))
        box.bind("<<ComboboxSelected>>", lambda _e: self.load_label_keys())
        self.label_list = tk.Listbox(left, width=28, height=28, exportselection=False)
        self.label_list.pack(fill="both", expand=True)
        self.label_list.bind("<<ListboxSelect>>", self.on_label_selected)

        self.label_vars: dict[str, tk.Text] = {}
        for row, lang in enumerate(LANGS):
            ttk.Label(right, text=lang).grid(row=row, column=0, sticky="nw", pady=6, padx=(0, 10))
            txt = tk.Text(right, height=4, wrap="word")
            txt.grid(row=row, column=1, sticky="ew", pady=6)
            self.label_vars[lang] = txt
        ttk.Button(right, text="应用标题/导航文本", command=self.write_label).grid(row=len(LANGS), column=1, sticky="e", pady=10)
        right.columnconfigure(1, weight=1)

    def build_help_tab(self) -> None:
        text = tk.Text(self.help_tab, wrap="word", padx=18, pady=18)
        text.pack(fill="both", expand=True)
        text.insert("1.0", (
            "流程：在界面里改内容 -> 点击“保存并生成网站” -> 本程序会更新 site_content.json、index.html、life.html -> 你检查页面后 git push。\n\n"
            "列表板块支持新增、复制、删除、上移、下移。选中条目后右侧修改，切换条目前会自动把当前表单写入内存；最终仍要点击顶部保存。\n\n"
            "图片或 PDF 路径建议放在 images/ 或 documents/ 里，字段里使用相对路径，例如 images/new-photo.jpg 或 documents/paper.pdf。\n\n"
            "随笔正文可以直接写文字；如果要换段，沿用当前网站格式写 <br><br>。论文作者字段允许 HTML，例如 <b>Runde Yang</b>。"
        ))
        text.configure(state="disabled")

    def make_field(self, parent: tk.Widget, path: str, kind: str) -> tk.Widget:
        if kind == "textarea":
            return tk.Text(parent, height=5, wrap="word")
        return ttk.Entry(parent)

    def read_widget(self, widget: tk.Widget, kind: str) -> str:
        if isinstance(widget, tk.Text):
            return widget.get("1.0", "end-1c")
        return widget.get()

    def write_widget(self, widget: tk.Widget, value: Any) -> None:
        if isinstance(widget, tk.Text):
            widget.delete("1.0", "end")
            widget.insert("1.0", "" if value is None else str(value))
        else:
            widget.delete(0, "end")
            widget.insert(0, "" if value is None else str(value))

    def pick_file(self, widget: tk.Widget) -> None:
        filename = filedialog.askopenfilename(initialdir=str(ROOT))
        if not filename:
            return
        try:
            rel = Path(filename).resolve().relative_to(ROOT)
            value = rel.as_posix()
        except ValueError:
            value = filename
        self.write_widget(widget, value)

    def collection(self) -> list[Any]:
        return get_path(self.content, SECTION_SPECS[self.current_section.get()]["path"], [])

    def load_hero_form(self) -> None:
        for _label, path, _kind in HERO_FIELDS:
            self.write_widget(self.hero_widgets[path], get_path(self.content, path, ""))

    def write_hero_form(self) -> None:
        for _label, path, kind in HERO_FIELDS:
            set_path(self.content, path, self.read_widget(self.hero_widgets[path], kind))
        self.status.configure(text="主页资料已应用，记得保存。")

    def load_section(self) -> None:
        self.current_index = None
        self.item_list.delete(0, "end")
        for item in self.collection():
            self.item_list.insert("end", self.display_item(item))
        self.build_item_form()
        if self.collection():
            self.item_list.selection_set(0)
            self.on_item_selected()

    def display_item(self, item: Any) -> str:
        spec = SECTION_SPECS[self.current_section.get()]
        if spec.get("string_item"):
            return str(item)
        return str(get_path(item, spec.get("display", ""), "") or item.get("id") or item.get("title") or "Untitled")

    def build_item_form(self) -> None:
        for child in self.form_frame.winfo_children():
            child.destroy()
        self.form_widgets.clear()
        spec = SECTION_SPECS[self.current_section.get()]
        self.form_title.configure(text=self.current_section.get())
        for row, (label, path, kind) in enumerate(spec["fields"]):
            ttk.Label(self.form_frame, text=label).grid(row=row, column=0, sticky="nw", pady=5, padx=(0, 10))
            widget = self.make_field(self.form_frame, path, "textarea" if kind == "textarea" else kind)
            widget.grid(row=row, column=1, sticky="ew", pady=5)
            if kind == "file":
                ttk.Button(self.form_frame, text="选择", command=lambda p=path: self.pick_file(self.form_widgets[p])).grid(row=row, column=2, padx=(6, 0))
            self.form_widgets[path] = widget
        self.form_frame.columnconfigure(1, weight=1)

    def on_item_selected(self, _event: Any = None) -> None:
        selection = self.item_list.curselection()
        if not selection:
            return
        next_index = selection[0]
        if self.current_index is not None and self.current_index != next_index:
            self.write_current_item(silent=True)
        self.current_index = next_index
        self.load_item_form(self.collection()[next_index])

    def load_item_form(self, item: Any) -> None:
        spec = SECTION_SPECS[self.current_section.get()]
        if spec.get("string_item"):
            self.write_widget(self.form_widgets[""], item)
            return
        for _label, path, _kind in spec["fields"]:
            self.write_widget(self.form_widgets[path], get_path(item, path, ""))

    def write_current_item(self, silent: bool = False) -> None:
        if self.current_index is None:
            return
        spec = SECTION_SPECS[self.current_section.get()]
        items = self.collection()
        if spec.get("string_item"):
            items[self.current_index] = self.read_widget(self.form_widgets[""], "entry")
        else:
            item = items[self.current_index]
            for _label, path, kind in spec["fields"]:
                value: Any = self.read_widget(self.form_widgets[path], kind)
                if kind == "number":
                    value = as_float(value)
                set_path(item, path, value)
        self.item_list.delete(self.current_index)
        self.item_list.insert(self.current_index, self.display_item(items[self.current_index]))
        self.item_list.selection_set(self.current_index)
        if not silent:
            self.status.configure(text="条目已应用，记得保存。")

    def add_item(self) -> None:
        self.write_current_item(silent=True)
        spec = SECTION_SPECS[self.current_section.get()]
        self.collection().append(copy.deepcopy(spec["default"]))
        self.load_section()
        last = len(self.collection()) - 1
        self.item_list.selection_clear(0, "end")
        self.item_list.selection_set(last)
        self.on_item_selected()

    def duplicate_item(self) -> None:
        if self.current_index is None:
            return
        self.write_current_item(silent=True)
        items = self.collection()
        items.insert(self.current_index + 1, copy.deepcopy(items[self.current_index]))
        self.load_section()
        self.item_list.selection_clear(0, "end")
        self.item_list.selection_set(self.current_index + 1)
        self.on_item_selected()

    def delete_item(self) -> None:
        if self.current_index is None:
            return
        if not messagebox.askyesno("确认删除", "确定删除当前条目吗？"):
            return
        del self.collection()[self.current_index]
        self.load_section()

    def move_item(self, delta: int) -> None:
        if self.current_index is None:
            return
        self.write_current_item(silent=True)
        items = self.collection()
        new_index = self.current_index + delta
        if new_index < 0 or new_index >= len(items):
            return
        items[self.current_index], items[new_index] = items[new_index], items[self.current_index]
        self.load_section()
        self.item_list.selection_clear(0, "end")
        self.item_list.selection_set(new_index)
        self.on_item_selected()

    def load_label_keys(self) -> None:
        self.label_key = None
        self.label_list.delete(0, "end")
        labels = self.content[self.label_page.get()]["labels"]["en"]
        for key in labels:
            self.label_list.insert("end", key)
        if labels:
            self.label_list.selection_set(0)
            self.on_label_selected()

    def on_label_selected(self, _event: Any = None) -> None:
        selection = self.label_list.curselection()
        if not selection:
            return
        if self.label_key:
            self.write_label(silent=True)
        self.label_key = self.label_list.get(selection[0])
        page = self.label_page.get()
        for lang in LANGS:
            self.write_widget(self.label_vars[lang], self.content[page]["labels"][lang].get(self.label_key, ""))

    def write_label(self, silent: bool = False) -> None:
        if not self.label_key:
            return
        page = self.label_page.get()
        for lang in LANGS:
            self.content[page]["labels"][lang][self.label_key] = self.read_widget(self.label_vars[lang], "textarea")
        if not silent:
            self.status.configure(text="标题/导航文本已应用，记得保存。")

    def save_json_only(self) -> None:
        self.write_hero_form()
        self.write_current_item(silent=True)
        self.write_label(silent=True)
        CONTENT_FILE.write_text(json.dumps(self.content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.status.configure(text="已保存 site_content.json。")

    def save_all(self) -> None:
        try:
            self.write_hero_form()
            self.write_current_item(silent=True)
            self.write_label(silent=True)
            save_content(self.content)
        except Exception as exc:  # pragma: no cover - UI guard
            messagebox.showerror("保存失败", str(exc))
            return
        self.status.configure(text="已保存并生成 index.html / life.html。")
        messagebox.showinfo("完成", "网站内容已更新，可以打开 index.html 检查。")

    def reload_all(self) -> None:
        if not messagebox.askyesno("重新载入", "重新载入会丢弃未保存改动，继续吗？"):
            return
        self.content = load_content()
        self.load_hero_form()
        self.load_section()
        self.load_label_keys()
        self.status.configure(text="已重新载入。")


def main() -> int:
    try:
        app = HomepageEditor()
        app.mainloop()
    except Exception as exc:
        messagebox.showerror("启动失败", str(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
