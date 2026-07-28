#!/usr/bin/env python3
"""
SCORM 1.2 packer
----------------
Положи этот файл в корень веб-проекта и запусти:  python3 scorm_pack.py
Рядом появится готовый к загрузке в LMS ZIP.

  identifier курса — из ИМЕНИ ПАПКИ (кириллица транслитерируется);
  title          — из course.json, если он есть, иначе имя папки.

Если в проекте УЖЕ есть свой SCORM-рантайм (например, js/ku-scorm.js),
упаковщик это распознаёт и НЕ подмешивает свой API — два рантайма в одном
SCO конфликтуют: первый же LMSFinish закрывает сессию, и записи второго
рантайма молча теряются.

Для проектов без рантайма API подмешивается автоматически. Кнопка завершения:
    <button onclick="SCORM.complete()">Завершить</button>

Флаги:
  --id NAME       переопределить identifier
  --title TEXT    переопределить заголовок
  --no-inject     не подмешивать API (даже если рантайм не найден)
  --force-inject  подмешать API принудительно
"""

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

# ── SCORM 1.2 API (подмешивается в index.html внутри ZIP) ─────────────────
SCORM_API_JS = """\
/* SCORM 1.2 API wrapper — auto-injected by scorm_pack.py */
(function () {
  var api = null, ready = false, finished = false, startedAt = Date.now();

  /* Поиск API: до 10 уровней вверх по parent (как рекомендует SCORM 1.2),
     затем opener и opener верхнего окна. */
  function findAPI(win) {
    for (var d = 0; d < 10 && win; d++) {
      if (win.API) return win.API;
      if (!win.parent || win.parent === win) break;
      win = win.parent;
    }
    return null;
  }
  function getAPI() {
    var a = findAPI(window);
    if (!a && window.opener) { try { a = findAPI(window.opener); } catch (e) {} }
    if (!a) { try { if (window.top && window.top.opener) a = findAPI(window.top.opener); } catch (e) {} }
    return a;
  }

  /* Диагностика: без неё ошибки LMS проглатываются молча. */
  function checkErr(op) {
    if (!api || !api.LMSGetLastError) return true;
    var code = String(api.LMSGetLastError() || "0");
    if (code === "0") return true;
    var msg = api.LMSGetErrorString ? api.LMSGetErrorString(code) : "";
    console.warn("[SCORM] " + op + " -> error " + code + " " + msg);
    return false;
  }

  /* cmi.core.session_time в формате CMITimespan: HHHH:MM:SS.SS */
  function timespan(ms) {
    var total = Math.max(0, ms) / 1000;
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
    return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s.toFixed(2), 5);
  }

  var SCORM = {
    init: function () {
      if (ready) return true;
      api = getAPI();
      if (!api) { console.warn("[SCORM] LMS API not found - running outside LMS"); return false; }
      var r = api.LMSInitialize("");
      ready = (r === "true" || r === true);
      if (!ready) { checkErr("LMSInitialize"); return false; }
      startedAt = Date.now();
      return true;
    },

    set: function (key, value) {
      if (!ready || finished) return false;
      api.LMSSetValue(key, String(value));
      return checkErr("LMSSetValue(" + key + ")");
    },

    get: function (key) {
      if (!ready || finished) return "";
      var v = api.LMSGetValue(key);
      checkErr("LMSGetValue(" + key + ")");
      return v;
    },

    commit: function () {
      if (!ready || finished) return;
      api.LMSCommit("");
      checkErr("LMSCommit");
    },

    /* Время сессии пишем перед завершением — иначе в отчётах LMS будет 0. */
    saveTime: function () {
      this.set("cmi.core.session_time", timespan(Date.now() - startedAt));
    },

    /* Идемпотентно: повторный LMSFinish в SCORM 1.2 - ошибка. */
    finish: function () {
      if (!ready || finished) return;
      var st = this.get("cmi.core.lesson_status");
      if (st !== "passed" && st !== "completed" && st !== "failed") {
        // Попытку можно возобновить: LMS сохранит suspend_data и вернёт entry=resume.
        this.set("cmi.core.exit", "suspend");
      } else {
        // Нормальный выход в SCORM 1.2 - ПУСТАЯ строка ("normal" из 2004 здесь невалиден).
        this.set("cmi.core.exit", "");
      }
      this.saveTime();
      api.LMSCommit("");
      api.LMSFinish("");
      finished = true;
    },

    /* Завершение курса. Без аргумента - "completed" без оценки.
       С числом - "passed" и балл (0..100). */
    complete: function (score) {
      if (!ready) return;
      if (typeof score === "number") {
        this.set("cmi.core.score.min", "0");
        this.set("cmi.core.score.max", "100");
        this.set("cmi.core.score.raw", score);
        this.set("cmi.core.lesson_status", "passed");
      } else {
        this.set("cmi.core.lesson_status", "completed");
      }
      this.commit();
      this.finish();
    }
  };

  window.addEventListener("load", function () { SCORM.init(); });

  /* Уход со страницы - фиксируем и закрываем сессию. */
  window.addEventListener("beforeunload", function () { SCORM.finish(); });

  /* pagehide срабатывает и при уходе в bfcache (свернул вкладку на мобильном).
     В этом случае сессию НЕ закрываем: пользователь может вернуться, и после
     LMSFinish писать было бы уже некуда. */
  window.addEventListener("pagehide", function (e) {
    if (e.persisted) { SCORM.saveTime(); SCORM.commit(); }
    else SCORM.finish();
  });

  /* Вернулись из bfcache - перезапускаем отсчёт времени сессии. */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) { startedAt = Date.now(); if (!ready) SCORM.init(); }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { SCORM.saveTime(); SCORM.commit(); }
  });

  window.SCORM = SCORM;
})();
"""

# ── imsmanifest.xml (SCORM 1.2) ───────────────────────────────────────────
MANIFEST_TEMPLATE = """\
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="{course_id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG_{course_id}">
    <organization identifier="ORG_{course_id}">
      <title>{course_title}</title>
      <item identifier="ITEM_1" identifierref="RES_1">
        <title>{course_title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES_1" type="webcontent"
              adlcp:scormtype="sco" href="index.html">
{file_entries}
    </resource>
  </resources>
</manifest>
"""

# ── Config ─────────────────────────────────────────────────────────────────
# course.json - метаданные сборки, в рантайме не нужен.
# imsmanifest.xml и scorm_api.js генерируются: если они уже лежат в папке
# (остались от прошлой сборки), их нельзя брать как файлы - будет дубликат в ZIP.
SKIP_FILES = {"scorm_pack.py", ".DS_Store", "Thumbs.db",
              "course.json", "imsmanifest.xml", "scorm_api.js"}
SKIP_DIRS = {".git", ".svn", "__pycache__", "node_modules", ".vscode", ".claude"}
SKIP_EXTS = {".pyc", ".pyo", ".zip", ".py"}

# Признак того, что в проекте свой SCORM-рантайм
RUNTIME_MARKER = re.compile(rb"LMSInitialize")

# Транслитерация: без неё re.ASCII схлопывает кириллицу целиком
# (папка «Воппер Ниндзя» превращалась в "course").
TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify(name: str) -> str:
    """Имя папки -> стабильный SCORM identifier (ASCII, валидный XML ID)."""
    s = "".join(TRANSLIT.get(ch, ch) for ch in name.strip().lower())
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if not s:
        s = "course"
    # XML ID не может начинаться с цифры
    if s[0].isdigit():
        s = "c-" + s
    return s


def xml_escape(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace('"', "&quot;"))


def collect_files(base: Path) -> list:
    """[(arc_path, abs_path), ...] для всех файлов проекта."""
    result = []
    for abs_path in sorted(base.rglob("*")):
        if abs_path.is_dir():
            continue
        rel = abs_path.relative_to(base)
        parts = rel.parts
        if any(p.startswith(".") for p in parts):
            continue
        if any(p in SKIP_DIRS for p in parts[:-1]):
            continue
        if rel.name in SKIP_FILES:
            continue
        if abs_path.suffix.lower() in SKIP_EXTS:
            continue
        result.append((str(rel).replace("\\", "/"), abs_path))
    return result


def detect_runtime(files: list) -> str:
    """Вернуть путь файла со своим SCORM-рантаймом или '' если такого нет."""
    for arc, path in files:
        if path.suffix.lower() not in {".js", ".html", ".htm"}:
            continue
        try:
            if RUNTIME_MARKER.search(path.read_bytes()):
                return arc
        except OSError:
            continue
    return ""


def read_title(base: Path, fallback: str) -> str:
    """Заголовок для LMS: course.json -> title, иначе имя папки."""
    cj = base / "course.json"
    if cj.exists():
        try:
            meta = json.loads(cj.read_text(encoding="utf-8"))
            title = str(meta.get("title") or "").strip()
            if title:
                return title
        except (OSError, ValueError):
            pass
    return fallback


def inject_script(html_bytes: bytes) -> bytes:
    """Вставить <script src="scorm_api.js"> перед </head>."""
    tag = b'<script src="scorm_api.js"></script>'
    lower = html_bytes.lower()

    pos = lower.find(b"</head>")
    if pos != -1:
        return html_bytes[:pos] + b"  " + tag + b"\n" + html_bytes[pos:]

    pos = lower.find(b"<head>")
    if pos != -1:
        end = pos + len(b"<head>")
        return html_bytes[:end] + b"\n  " + tag + html_bytes[end:]

    return tag + b"\n" + html_bytes


def build(args) -> int:
    base = Path(__file__).parent.resolve()
    folder_name = base.name

    if not (base / "index.html").exists():
        print("Ошибка: в этой папке нет index.html.\n"
              "Положи scorm_pack.py в корень веб-проекта.", file=sys.stderr)
        return 1

    course_id = args.id or slugify(folder_name)
    course_title = args.title or read_title(base, folder_name)
    zip_path = base / f"{course_id}.zip"

    files = collect_files(base)
    if not files:
        print("Ошибка: не найдено ни одного файла для упаковки.", file=sys.stderr)
        return 1

    runtime = detect_runtime(files)
    if args.force_inject:
        inject, why = True, "принудительно (--force-inject)"
    elif args.no_inject:
        inject, why = False, "отключено (--no-inject)"
    elif runtime:
        inject, why = False, f"свой рантайм найден: {runtime}"
    else:
        inject, why = True, "свой рантайм не найден"

    arcs = {arc for arc, _ in files}
    if inject:
        arcs.add("scorm_api.js")
    file_entries = "\n".join(f'      <file href="{xml_escape(a)}"/>'
                             for a in sorted(arcs))

    manifest = MANIFEST_TEMPLATE.format(
        course_id=xml_escape(course_id),
        course_title=xml_escape(course_title),
        file_entries=file_entries,
    )

    existed = zip_path.exists()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("imsmanifest.xml", manifest.encode("utf-8"))
        if inject:
            zf.writestr("scorm_api.js", SCORM_API_JS.encode("utf-8"))
        for arc_name, abs_path in files:
            data = abs_path.read_bytes()
            if inject and arc_name == "index.html":
                data = inject_script(data)
            zf.writestr(arc_name, data)

    size_kb = zip_path.stat().st_size / 1024
    print(f"[SCORM] {'Перепакован' if existed else 'Упакован'}: {zip_path.name}  ({size_kb:.0f} КБ)")
    print(f"        Course ID : {course_id}   (из имени папки «{folder_name}»)")
    print(f"        Title     : {course_title}")
    print(f"        SCORM API : {'подмешан' if inject else 'НЕ подмешан'} — {why}")
    print(f"        Файлов    : {len(files)} + imsmanifest.xml" + (" + scorm_api.js" if inject else ""))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Упаковать веб-проект в SCORM 1.2 ZIP")
    ap.add_argument("--id", default="", help="переопределить identifier курса")
    ap.add_argument("--title", default="", help="переопределить заголовок курса")
    ap.add_argument("--no-inject", action="store_true", help="не подмешивать SCORM API")
    ap.add_argument("--force-inject", action="store_true", help="подмешать SCORM API принудительно")
    sys.exit(build(ap.parse_args()))
