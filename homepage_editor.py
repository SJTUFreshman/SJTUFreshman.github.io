from __future__ import annotations

import copy
import json
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

import site_renderer

ROOT = Path(__file__).resolve().parent
CONTENT_FILE = ROOT / "site_content.json"
LANGS = ("en", "zh-CN", "zh-TW")

BG = "#f5f7fb"
PANEL = "#ffffff"
TEXT = "#1f2937"
MUTED = "#6b7280"
PRIMARY = "#2563eb"
PRIMARY_DARK = "#1d4ed8"
BORDER = "#dbe3ef"
FIELD_BG = "#fbfdff"


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
        self.title("Homepage Studio")
        self.geometry("1240x800")
        self.minsize(1060, 680)
        self.configure(bg=BG)
        self.content = load_content()
        self.current_section = tk.StringVar(value=next(iter(SECTION_SPECS)))
        self.active_section = self.current_section.get()
        self.current_index: int | None = None
        self.form_widgets: dict[str, tk.Widget] = {}
        self.hero_widgets: dict[str, tk.Widget] = {}
        self.label_page = tk.StringVar(value="home")
        self.active_label_page = self.label_page.get()
        self.label_key: str | None = None
        self.selection_event_paused = False
        self.dirty = False

        self.configure_style()
        self.create_widgets()
        self.load_hero_form()
        self.load_section()
        self.load_label_keys()

    def configure_style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        self.option_add("*Font", ("Segoe UI", 10))
        self.option_add("*Listbox.Font", ("Segoe UI", 10))
        self.option_add("*Text.Font", ("Segoe UI", 10))

        style.configure("App.TFrame", background=BG)
        style.configure("Panel.TFrame", background=PANEL)
        style.configure("Card.TFrame", background=PANEL, relief="flat")
        style.configure("Muted.TLabel", background=PANEL, foreground=MUTED)
        style.configure("Title.TLabel", background=PANEL, foreground=TEXT, font=("Segoe UI", 15, "bold"))
        style.configure("HeaderTitle.TLabel", background=BG, foreground=TEXT, font=("Segoe UI", 18, "bold"))
        style.configure("HeaderSub.TLabel", background=BG, foreground=MUTED, font=("Segoe UI", 10))
        style.configure("Status.TLabel", background=BG, foreground=MUTED, font=("Segoe UI", 9))
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", padding=(18, 9), background="#eaf0f8", foreground=MUTED)
        style.map("TNotebook.Tab", background=[("selected", PANEL)], foreground=[("selected", TEXT)])
        style.configure("TButton", padding=(11, 7), background="#edf2f7", foreground=TEXT, borderwidth=0)
        style.map("TButton", background=[("active", "#e2e8f0")])
        style.configure("Primary.TButton", padding=(16, 9), background=PRIMARY, foreground="#ffffff", font=("Segoe UI", 10, "bold"))
        style.map("Primary.TButton", background=[("active", PRIMARY_DARK)], foreground=[("active", "#ffffff")])
        style.configure("Danger.TButton", padding=(11, 7), background="#fee2e2", foreground="#991b1b", borderwidth=0)
        style.map("Danger.TButton", background=[("active", "#fecaca")])
        style.configure("TEntry", fieldbackground=FIELD_BG, bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER, padding=6)
        style.configure("TCombobox", fieldbackground=FIELD_BG, background=FIELD_BG, padding=6)

    def create_widgets(self) -> None:
        shell = ttk.Frame(self, style="App.TFrame", padding=(18, 16, 18, 14))
        shell.pack(fill="both", expand=True)

        top = ttk.Frame(shell, style="App.TFrame")
        top.pack(fill="x", pady=(0, 14))
        title_box = ttk.Frame(top, style="App.TFrame")
        title_box.pack(side="left", fill="x", expand=True)
        ttk.Label(title_box, text="Homepage Studio", style="HeaderTitle.TLabel").pack(anchor="w")
        ttk.Label(
            title_box,
            text="编辑内容，点击蓝色按钮后会同时更新 site_content.json、index.html 和 life.html",
            style="HeaderSub.TLabel",
        ).pack(anchor="w", pady=(2, 0))

        action_box = ttk.Frame(top, style="App.TFrame")
        action_box.pack(side="right")
        ttk.Button(action_box, text="保存到网站", style="Primary.TButton", command=self.save_all).pack(side="left")
        ttk.Button(action_box, text="预览首页", command=lambda: webbrowser.open((ROOT / "index.html").as_uri())).pack(side="left", padx=(8, 0))
        ttk.Button(action_box, text="重新载入", command=self.reload_all).pack(side="left", padx=(8, 0))

        notebook = ttk.Notebook(shell)
        notebook.pack(fill="both", expand=True)

        self.hero_tab = ttk.Frame(notebook, style="Panel.TFrame")
        self.list_tab = ttk.Frame(notebook, style="Panel.TFrame")
        self.label_tab = ttk.Frame(notebook, style="Panel.TFrame")
        self.help_tab = ttk.Frame(notebook, style="Panel.TFrame")
        notebook.add(self.hero_tab, text="主页资料")
        notebook.add(self.list_tab, text="列表板块")
        notebook.add(self.label_tab, text="导航/标题")
        notebook.add(self.help_tab, text="使用说明")
        self.build_hero_tab()
        self.build_list_tab()
        self.build_label_tab()
        self.build_help_tab()

        self.status = ttk.Label(shell, text=str(CONTENT_FILE), style="Status.TLabel")
        self.status.pack(fill="x", pady=(10, 0))

    def build_hero_tab(self) -> None:
        canvas = tk.Canvas(self.hero_tab, highlightthickness=0, background=PANEL)
        scrollbar = ttk.Scrollbar(self.hero_tab, orient="vertical", command=canvas.yview)
        frame = ttk.Frame(canvas, padding=22, style="Panel.TFrame")
        frame.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        ttk.Label(frame, text="主页资料", style="Title.TLabel").grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 4))
        ttk.Label(frame, text="这些字段会写入首页个人资料、联系方式和 Life 卡片。", style="Muted.TLabel").grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 16))

        for row, (label, path, kind) in enumerate(HERO_FIELDS, start=2):
            ttk.Label(frame, text=label, style="Muted.TLabel").grid(row=row, column=0, sticky="nw", pady=6, padx=(0, 14))
            widget = self.make_field(frame, path, kind)
            widget.grid(row=row, column=1, sticky="ew", pady=6)
            if kind == "file":
                ttk.Button(frame, text="选择", command=lambda p=path: self.pick_file(self.hero_widgets[p])).grid(row=row, column=2, padx=(6, 0))
            self.hero_widgets[path] = widget
        frame.columnconfigure(1, weight=1)
        ttk.Button(frame, text="保存到网站", style="Primary.TButton", command=self.save_all).grid(row=len(HERO_FIELDS) + 2, column=1, sticky="e", pady=18)

    def build_list_tab(self) -> None:
        left = ttk.Frame(self.list_tab, padding=18, style="Panel.TFrame")
        left.pack(side="left", fill="y")
        right = ttk.Frame(self.list_tab, padding=22, style="Panel.TFrame")
        right.pack(side="left", fill="both", expand=True)

        ttk.Label(left, text="列表板块", style="Title.TLabel").pack(anchor="w")
        ttk.Label(left, text="选择一个板块后编辑右侧表单。", style="Muted.TLabel").pack(anchor="w", pady=(2, 14))
        section_box = ttk.Combobox(left, textvariable=self.current_section, values=list(SECTION_SPECS), state="readonly", width=28)
        section_box.pack(fill="x", pady=(4, 10))
        section_box.bind("<<ComboboxSelected>>", self.on_section_changed)

        self.item_list = tk.Listbox(
            left,
            width=34,
            height=24,
            exportselection=False,
            borderwidth=0,
            highlightthickness=1,
            highlightbackground=BORDER,
            selectbackground=PRIMARY,
            selectforeground="#ffffff",
            background=FIELD_BG,
            foreground=TEXT,
            activestyle="none",
            relief="flat",
        )
        self.item_list.pack(fill="both", expand=True)
        self.item_list.bind("<<ListboxSelect>>", self.on_item_selected)

        btns = ttk.Frame(left, style="Panel.TFrame")
        btns.pack(fill="x", pady=(10, 0))
        ttk.Button(btns, text="新增", command=self.add_item).grid(row=0, column=0, sticky="ew")
        ttk.Button(btns, text="复制", command=self.duplicate_item).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(btns, text="删除", style="Danger.TButton", command=self.delete_item).grid(row=0, column=2, sticky="ew")
        ttk.Button(btns, text="上移", command=lambda: self.move_item(-1)).grid(row=1, column=0, sticky="ew", pady=(4, 0))
        ttk.Button(btns, text="下移", command=lambda: self.move_item(1)).grid(row=1, column=1, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(btns, text="保存到网站", style="Primary.TButton", command=self.save_all).grid(row=1, column=2, sticky="ew", pady=(4, 0))
        for col in range(3):
            btns.columnconfigure(col, weight=1)

        self.form_title = ttk.Label(right, text="", style="Title.TLabel")
        self.form_title.pack(anchor="w")
        ttk.Label(right, text="改完后点击蓝色按钮，会立即写回网页文件。", style="Muted.TLabel").pack(anchor="w", pady=(2, 14))
        self.form_frame = ttk.Frame(right, style="Panel.TFrame")
        self.form_frame.pack(fill="both", expand=True)

    def build_label_tab(self) -> None:
        left = ttk.Frame(self.label_tab, padding=18, style="Panel.TFrame")
        left.pack(side="left", fill="y")
        right = ttk.Frame(self.label_tab, padding=22, style="Panel.TFrame")
        right.pack(side="left", fill="both", expand=True)
        ttk.Label(left, text="导航 / 标题", style="Title.TLabel").pack(anchor="w")
        ttk.Label(left, text="维护页面上的固定标签文本。", style="Muted.TLabel").pack(anchor="w", pady=(2, 14))
        box = ttk.Combobox(left, textvariable=self.label_page, values=["home", "life"], state="readonly", width=16)
        box.pack(fill="x", pady=(4, 10))
        box.bind("<<ComboboxSelected>>", self.on_label_page_changed)
        self.label_list = tk.Listbox(
            left,
            width=28,
            height=28,
            exportselection=False,
            borderwidth=0,
            highlightthickness=1,
            highlightbackground=BORDER,
            selectbackground=PRIMARY,
            selectforeground="#ffffff",
            background=FIELD_BG,
            foreground=TEXT,
            activestyle="none",
            relief="flat",
        )
        self.label_list.pack(fill="both", expand=True)
        self.label_list.bind("<<ListboxSelect>>", self.on_label_selected)

        self.label_vars: dict[str, tk.Text] = {}
        for row, lang in enumerate(LANGS):
            ttk.Label(right, text=lang, style="Muted.TLabel").grid(row=row, column=0, sticky="nw", pady=6, padx=(0, 10))
            txt = tk.Text(right, height=4, wrap="word")
            self.style_text(txt)
            txt.grid(row=row, column=1, sticky="ew", pady=6)
            self.label_vars[lang] = txt
        ttk.Button(right, text="保存到网站", style="Primary.TButton", command=self.save_all).grid(row=len(LANGS), column=1, sticky="e", pady=14)
        right.columnconfigure(1, weight=1)

    def build_help_tab(self) -> None:
        text = tk.Text(self.help_tab, wrap="word", padx=24, pady=22, background=PANEL, foreground=TEXT, borderwidth=0, highlightthickness=0)
        text.pack(fill="both", expand=True)
        text.insert("1.0", (
            "流程：在界面里改内容 -> 点击“保存到网站” -> 本程序会更新 site_content.json、index.html、life.html -> 你检查页面后 git push。\n\n"
            "现在保存按钮会先收集当前正在编辑的表单，再写 JSON，再生成网页，不需要先点“应用”。\n\n"
            "列表板块支持新增、复制、删除、上移、下移。切换板块或条目前，会自动把当前表单写入内存；最终点击“保存到网站”。\n\n"
            "图片或 PDF 路径建议放在 images/ 或 documents/ 里，字段里使用相对路径，例如 images/new-photo.jpg 或 documents/paper.pdf。\n\n"
            "随笔正文可以直接写文字，在输入框里按回车就会在网页里换行，不需要手写 <br>。论文作者字段允许 HTML，例如 <b>Runde Yang</b>。"
        ))
        text.configure(state="disabled")

    def style_text(self, widget: tk.Text) -> None:
        widget.configure(
            background=FIELD_BG,
            foreground=TEXT,
            insertbackground=TEXT,
            relief="flat",
            borderwidth=0,
            highlightthickness=1,
            highlightbackground=BORDER,
            highlightcolor=PRIMARY,
            padx=8,
            pady=7,
        )

    def make_field(self, parent: tk.Widget, path: str, kind: str) -> tk.Widget:
        if kind == "textarea":
            widget = tk.Text(parent, height=5, wrap="word")
            self.style_text(widget)
            return widget
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

    def collection(self, section: str | None = None) -> list[Any]:
        section_name = section or self.active_section
        return get_path(self.content, SECTION_SPECS[section_name]["path"], [])

    def load_hero_form(self) -> None:
        for _label, path, _kind in HERO_FIELDS:
            self.write_widget(self.hero_widgets[path], get_path(self.content, path, ""))

    def write_hero_form(self, silent: bool = False) -> None:
        for _label, path, kind in HERO_FIELDS:
            set_path(self.content, path, self.read_widget(self.hero_widgets[path], kind))
        self.dirty = True
        if not silent:
            self.status.configure(text="主页资料已写入内存，点击“保存到网站”会更新网页文件。")

    def on_section_changed(self, _event: Any = None) -> None:
        self.write_current_item(silent=True)
        self.active_section = self.current_section.get()
        self.load_section()

    def load_section(self, select_index: int | None = 0) -> None:
        self.selection_event_paused = True
        try:
            self.current_index = None
            self.item_list.delete(0, "end")
            for item in self.collection():
                self.item_list.insert("end", self.display_item(item))
            self.build_item_form()
            items = self.collection()
            if items and select_index is not None:
                index = max(0, min(select_index, len(items) - 1))
                self.item_list.selection_clear(0, "end")
                self.item_list.selection_set(index)
                self.current_index = index
                self.load_item_form(items[index])
        finally:
            self.selection_event_paused = False

    def display_item(self, item: Any) -> str:
        spec = SECTION_SPECS[self.active_section]
        if spec.get("string_item"):
            return str(item)
        return str(get_path(item, spec.get("display", ""), "") or item.get("id") or item.get("title") or "Untitled")

    def build_item_form(self) -> None:
        for child in self.form_frame.winfo_children():
            child.destroy()
        self.form_widgets.clear()
        spec = SECTION_SPECS[self.active_section]
        self.form_title.configure(text=self.active_section)
        for row, (label, path, kind) in enumerate(spec["fields"]):
            ttk.Label(self.form_frame, text=label, style="Muted.TLabel").grid(row=row, column=0, sticky="nw", pady=6, padx=(0, 14))
            widget = self.make_field(self.form_frame, path, "textarea" if kind == "textarea" else kind)
            widget.grid(row=row, column=1, sticky="ew", pady=6)
            if kind == "file":
                ttk.Button(self.form_frame, text="选择", command=lambda p=path: self.pick_file(self.form_widgets[p])).grid(row=row, column=2, padx=(6, 0))
            self.form_widgets[path] = widget
        self.form_frame.columnconfigure(1, weight=1)

    def on_item_selected(self, _event: Any = None) -> None:
        if self.selection_event_paused:
            return
        selection = self.item_list.curselection()
        if not selection:
            return
        next_index = selection[0]
        if self.current_index is not None and self.current_index != next_index:
            self.write_current_item(silent=True)
        self.current_index = next_index
        self.load_item_form(self.collection()[next_index])

    def load_item_form(self, item: Any) -> None:
        spec = SECTION_SPECS[self.active_section]
        if spec.get("string_item"):
            self.write_widget(self.form_widgets[""], item)
            return
        for _label, path, _kind in spec["fields"]:
            self.write_widget(self.form_widgets[path], get_path(item, path, ""))

    def write_current_item(self, silent: bool = False) -> None:
        if self.current_index is None:
            return
        spec = SECTION_SPECS[self.active_section]
        items = self.collection()
        if self.current_index < 0 or self.current_index >= len(items):
            return
        if spec.get("string_item"):
            items[self.current_index] = self.read_widget(self.form_widgets[""], "entry")
        else:
            item = items[self.current_index]
            for _label, path, kind in spec["fields"]:
                value: Any = self.read_widget(self.form_widgets[path], kind)
                if kind == "number":
                    value = as_float(value)
                set_path(item, path, value)
        selected = self.item_list.curselection()
        self.selection_event_paused = True
        try:
            self.item_list.delete(self.current_index)
            self.item_list.insert(self.current_index, self.display_item(items[self.current_index]))
            self.item_list.selection_clear(0, "end")
            for index in selected:
                if index < self.item_list.size():
                    self.item_list.selection_set(index)
        finally:
            self.selection_event_paused = False
        self.dirty = True
        if not silent:
            self.status.configure(text="当前条目已写入内存，点击“保存到网站”会更新网页文件。")

    def add_item(self) -> None:
        self.write_current_item(silent=True)
        spec = SECTION_SPECS[self.active_section]
        self.collection().append(copy.deepcopy(spec["default"]))
        self.load_section(select_index=len(self.collection()) - 1)

    def duplicate_item(self) -> None:
        if self.current_index is None:
            return
        self.write_current_item(silent=True)
        duplicate_index = self.current_index + 1
        items = self.collection()
        items.insert(duplicate_index, copy.deepcopy(items[self.current_index]))
        self.load_section(select_index=duplicate_index)

    def delete_item(self) -> None:
        if self.current_index is None:
            return
        if not messagebox.askyesno("确认删除", "确定删除当前条目吗？"):
            return
        items = self.collection()
        old_index = self.current_index
        del items[old_index]
        self.load_section(select_index=min(old_index, len(items) - 1) if items else None)

    def move_item(self, delta: int) -> None:
        if self.current_index is None:
            return
        self.write_current_item(silent=True)
        items = self.collection()
        new_index = self.current_index + delta
        if new_index < 0 or new_index >= len(items):
            return
        items[self.current_index], items[new_index] = items[new_index], items[self.current_index]
        self.load_section(select_index=new_index)

    def on_label_page_changed(self, _event: Any = None) -> None:
        self.write_label(silent=True)
        self.active_label_page = self.label_page.get()
        self.load_label_keys()

    def load_label_keys(self) -> None:
        self.label_key = None
        self.label_list.delete(0, "end")
        labels = self.content[self.active_label_page]["labels"]["en"]
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
        page = self.active_label_page
        for lang in LANGS:
            self.write_widget(self.label_vars[lang], self.content[page]["labels"][lang].get(self.label_key, ""))

    def write_label(self, silent: bool = False) -> None:
        if not self.label_key:
            return
        page = self.active_label_page
        for lang in LANGS:
            self.content[page]["labels"][lang][self.label_key] = self.read_widget(self.label_vars[lang], "textarea")
        self.dirty = True
        if not silent:
            self.status.configure(text="标题/导航文本已写入内存，点击“保存到网站”会更新网页文件。")

    def collect_current_edits(self) -> None:
        self.write_hero_form(silent=True)
        self.write_current_item(silent=True)
        self.write_label(silent=True)

    def save_json_only(self) -> None:
        self.collect_current_edits()
        CONTENT_FILE.write_text(json.dumps(self.content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.status.configure(text="已保存数据草稿；网页文件尚未更新。")

    def save_all(self) -> None:
        try:
            self.collect_current_edits()
            save_content(self.content)
        except Exception as exc:  # pragma: no cover - UI guard
            messagebox.showerror("保存失败", str(exc))
            return
        self.dirty = False
        self.status.configure(text="已保存：site_content.json、index.html、life.html 都已更新。")
        messagebox.showinfo("完成", "网站内容已写回 index.html 和 life.html。")

    def reload_all(self) -> None:
        if not messagebox.askyesno("重新载入", "重新载入会丢弃未保存改动，继续吗？"):
            return
        self.content = load_content()
        self.active_section = self.current_section.get()
        self.active_label_page = self.label_page.get()
        self.load_hero_form()
        self.load_section()
        self.load_label_keys()
        self.dirty = False
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
