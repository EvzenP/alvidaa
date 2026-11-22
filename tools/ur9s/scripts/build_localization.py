#!/usr/bin/env python3
"""
Build the 75UR9S / V0000.09.60W.Q0624 TV-menu localization string tables.

Usage:
    build_localization.py TREE_DIR OUT_DIR [--src eng] [--tgt cze] [--pulled DATE]

  TREE_DIR    extracted tree from pull_localization.sh (contains opt/ and APPS/)
  OUT_DIR     where to write the README, tables 01..05 and strings.json
  --src       source language code (default: eng)
  --tgt       target language code (default: cze)
  --pulled    pull date to stamp in the output (default: today)

Language codes are the 3-letter codes used in the bundle file names
(language_<code>.json / .js); the TV's full list is in the pulled tree.

For each of the five string-provider packages (findings 04, section 3), map
every bundle key to the package code file(s) that reference the key, and emit
one markdown table per package (| Source file | ID | <Src> | <Tgt> |), an
index README and strings.json.

Data sources (see pull_localization.sh, same --src/--tgt):
  - bundle values: the LIVE source (shadow /APPS/pkgs/tv.vidaa.app.ui for
    hisenseUI + system-ui; /APPS originals for the rest), plus the /opt
    factory originals for the shadow-diff marker.
  - code files: all *.js / *.json under each package root, EXCLUDING the
    language/ bundle dirs, missing_language.json (a per-locale "undefined"
    report, not a consumer) and unitedtransinfo.json (a string table).
  - `current` is a symlink to CHA and is never followed (real paths only).

Findings: docs/models/75UR9S/V0000.09.60W.Q0624/findings/05-localization-string-inventory.md
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
from collections import OrderedDict

# Language display names, keyed by the TV's bundle file codes (not all are
# ISO-639; e.g. dut/ger/fre/rum). Unknown codes fall back to the code itself.
LANG_NAMES = {
    "alb": "Albanian", "amh": "Amharic", "ara": "Arabic", "arm": "Armenian",
    "aze": "Azerbaijani", "bel": "Belarusian", "ben": "Bengali",
    "bos": "Bosnian", "bul": "Bulgarian", "bur": "Burmese",
    "chi": "Chinese (Simplified)", "cnr": "Montenegrin", "cze": "Czech",
    "dan": "Danish", "dut": "Dutch", "eng": "English", "est": "Estonian",
    "fin": "Finnish", "fre": "French", "geo": "Georgian", "ger": "German",
    "gre": "Greek", "guj": "Gujarati", "heb": "Hebrew", "hin": "Hindi",
    "hun": "Hungarian", "ice": "Icelandic", "ind": "Indonesian",
    "ita": "Italian", "jpn": "Japanese", "kan": "Kannada", "kaz": "Kazakh",
    "khm": "Khmer", "kor": "Korean", "kur": "Kurdish", "lav": "Latvian",
    "lit": "Lithuanian", "mac": "Macedonian", "mal": "Malayalam",
    "mar": "Marathi", "may": "Malay", "mon": "Mongolian", "nor": "Norwegian",
    "per": "Persian", "pol": "Polish", "por": "Portuguese", "rum": "Romanian",
    "rus": "Russian", "scc": "Serbian (Cyrillic)", "scr": "Serbian (Latin)",
    "sin": "Sinhala", "slo": "Slovak", "slv": "Slovenian", "spa": "Spanish",
    "swe": "Swedish", "tam": "Tamil", "tel": "Telugu", "tha": "Thai",
    "tur": "Turkish", "ukr": "Ukrainian", "urd": "Urdu", "uzb": "Uzbek",
    "vie": "Vietnamese", "zho": "Chinese (Traditional)",
}


def lang_name(code):
    return LANG_NAMES.get(code, code.upper())


def parse_args():
    ap = argparse.ArgumentParser(
        description="Build the 75UR9S localization string tables.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("tree", help="extracted tree from pull_localization.sh")
    ap.add_argument("out", help="output dir (README + tables 01..05 + strings.json)")
    ap.add_argument("--src", default="eng",
                    help="source language code (bundle file language_<code>)")
    ap.add_argument("--tgt", default="cze",
                    help="target language code (bundle file language_<code>)")
    ap.add_argument("--pulled", default=datetime.date.today().isoformat(),
                    help="pull date to stamp in the output")
    return ap.parse_args()


ARGS = parse_args()
ROOT = os.path.abspath(ARGS.tree)
OUT = os.path.abspath(ARGS.out)
SRC, TGT = ARGS.src, ARGS.tgt
PULLED = ARGS.pulled
SRC_NAME, TGT_NAME = lang_name(SRC), lang_name(TGT)

if not (os.path.isdir(os.path.join(ROOT, "opt"))
        and os.path.isdir(os.path.join(ROOT, "APPS"))):
    sys.exit(f"ERROR: {ROOT} does not look like a pulled tree (missing opt/ or APPS/)")

# Candidate key token in code: uppercase letter prefix + digits (all observed
# keys match [A-Z]{2,4}[0-9]{4}; keep a slightly wider net, membership in the
# bundle key set is the real filter).
TOKEN_RE = re.compile(r"(?<![A-Za-z0-9])[A-Z]{2,5}[0-9]{2,8}(?![A-Za-z0-9])")

# webengine format C: `KEY : "value",` lines inside `var language = { ... }`
JS_LINE_RE = re.compile(r'^\s*([A-Za-z0-9_]+)\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$')

EXCLUDE_BASENAMES = {"missing_language.json", "unitedtransinfo.json"}

PACKAGES = [
    dict(
        num="01", name="hisenseUI", pkg="tv.vidaa.app.ui", fmt="A",
        live_rel="APPS/pkgs/tv.vidaa.app.ui/hisenseUI/language",
        opt_rel="opt/pkgs/tv.vidaa.app.ui/hisenseUI/language",
        code_rel="opt/pkgs/tv.vidaa.app.ui/hisenseUI",
        fs="**ro** (erofs) — live via shadow `/APPS/pkgs/tv.vidaa.app.ui`",
        area="Home screen / launcher (app tiles, home labels)",
    ),
    dict(
        num="02", name="system-ui", pkg="tv.vidaa.app.ui", fmt="A",
        live_rel="APPS/pkgs/tv.vidaa.app.ui/system-ui/language",
        opt_rel="opt/pkgs/tv.vidaa.app.ui/system-ui/language",
        code_rel="opt/pkgs/tv.vidaa.app.ui/system-ui",
        fs="**ro** (erofs) — live via shadow `/APPS/pkgs/tv.vidaa.app.ui`",
        area="Main **Settings**, on-screen menus, **Quick Menu**",
    ),
    dict(
        num="03", name="operationui", pkg="tv.vidaa.app.operationui", fmt="A",
        live_rel="APPS/pkgs/tv.vidaa.app.operationui/CHA/language",
        opt_rel=None,
        code_rel="APPS/pkgs/tv.vidaa.app.operationui/CHA",
        fs="**rw** (ext4)",
        area="Live-TV operation UI: channel scan, EPG, PVR, inputs",
    ),
    dict(
        num="04", name="tvbrowser", pkg="tv.vidaa.app.tvbrowser", fmt="B",
        live_rel="APPS/pkgs/tv.vidaa.app.tvbrowser/webui/setting/static-browser/language",
        opt_rel=None,
        code_rel="APPS/pkgs/tv.vidaa.app.tvbrowser",
        fs="**rw** (ext4)",
        area="TV browser webui (Home page, Exit, Clear Cookies, browser errors)",
    ),
    dict(
        num="05", name="webengine", pkg="tv.vidaa.res.webengine", fmt="C",
        live_rel="APPS/pkgs/tv.vidaa.res.webengine/CHA/resources/errorPage/language",
        opt_rel=None,
        code_rel="APPS/pkgs/tv.vidaa.res.webengine/CHA",
        fs="**rw** (ext4)",
        area="Web-engine network-error pages (No Internet / Reconnect)",
    ),
]

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def parse_js_bundle(path):
    """Format C: var language = { KEY : "value", ... } -> ordered dict."""
    out = OrderedDict()
    with open(path, "r", encoding="utf-8-sig") as f:
        for line in f:
            m = JS_LINE_RE.match(line)
            if m:
                out[m.group(1)] = m.group(2)
    return out


def locale_path(live_dir, lang, fmt, ctx):
    """Path of language_<lang>.{json,js} in a bundle dir, or exit listing what exists."""
    ext = "js" if fmt == "C" else "json"
    path = os.path.join(live_dir, f"language_{lang}.{ext}")
    if os.path.isfile(path):
        return path
    avail = sorted(f[len("language_"):-(len(ext) + 1)] for f in os.listdir(live_dir)
                   if f.startswith("language_") and f.endswith("." + ext))
    sys.exit(f"ERROR: {path} not found ({ctx}); available locales: {', '.join(avail)}")


def load_bundle(p, src, tgt):
    """Return (keys, src_vals, tgt_vals, vda); vda maps key -> (src, tgt) or None."""
    live = os.path.join(ROOT, p["live_rel"])
    if p["fmt"] == "A":
        keys = load_json(os.path.join(live, "keys.json"))
        sv = load_json(locale_path(live, src, p["fmt"], p["name"]))
        tv = load_json(locale_path(live, tgt, p["fmt"], p["name"]))
        assert len(keys) == len(sv) == len(tv), (p["name"], len(keys), len(sv), len(tv))
        sv, tv = dict(zip(keys, sv)), dict(zip(keys, tv))
        vda = None
        vda_dir = os.path.join(live, "VDA")
        if os.path.isfile(os.path.join(vda_dir, "keys.json")):
            vk = load_json(os.path.join(vda_dir, "keys.json"))
            vs = load_json(locale_path(vda_dir, src, p["fmt"], p["name"] + "/VDA"))
            vt = load_json(locale_path(vda_dir, tgt, p["fmt"], p["name"] + "/VDA"))
            assert len(vk) == len(vs) == len(vt), (p["name"], "VDA", len(vk), len(vs), len(vt))
            vda = OrderedDict((k, (vs[i], vt[i])) for i, k in enumerate(vk))
        return keys, sv, tv, vda
    if p["fmt"] == "B":
        sv = load_json(locale_path(live, src, p["fmt"], p["name"]))
        tv = load_json(locale_path(live, tgt, p["fmt"], p["name"]))
        assert set(sv) == set(tv), (p["name"], "key sets differ")
        return list(sv.keys()), sv, tv, None
    if p["fmt"] == "C":
        sv = parse_js_bundle(locale_path(live, src, p["fmt"], p["name"]))
        tv = parse_js_bundle(locale_path(live, tgt, p["fmt"], p["name"]))
        assert set(sv) == set(tv), (p["name"], "key sets differ")
        return list(sv.keys()), sv, tv, None
    raise ValueError(p["fmt"])


def load_factory(p, tgt):
    """Factory /opt tgt values: (base_dict, vda_dict) for the shadow-diff marker."""
    if not p["opt_rel"]:
        return None, None
    opt = os.path.join(ROOT, p["opt_rel"])
    res = {}
    for sub, name in (("", "base"), ("VDA/", "vda")):
        kpath = os.path.join(opt, sub, "keys.json")
        cpath = os.path.join(opt, sub, f"language_{tgt}.json")
        if os.path.isfile(kpath) and os.path.isfile(cpath):
            res[name] = dict(zip(load_json(kpath), load_json(cpath)))
    return res.get("base"), res.get("vda")


def collect_code_files(p):
    """All consumer-searchable files under the package code root."""
    code_root = os.path.join(ROOT, p["code_rel"])
    files = []
    for dirpath, dirnames, filenames in os.walk(code_root):
        dirnames.sort()
        for fn in sorted(filenames):
            if not (fn.endswith(".js") or fn.endswith(".json")):
                continue
            if fn in EXCLUDE_BASENAMES:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, code_root)
            if "language" in rel.split(os.sep):
                continue
            files.append((rel, full))
    return files


def cross_reference(p, keys):
    """Map every key -> sorted list of (relpath, count) referencing files."""
    keyset = set(keys)
    refs = {k: [] for k in keys}
    files = collect_code_files(p)
    for rel, full in files:
        try:
            text = open(full, "r", encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        found = {}
        for tok in TOKEN_RE.findall(text):
            if tok in keyset:
                found[tok] = found.get(tok, 0) + 1
        for k, c in found.items():
            refs[k].append((rel, c))
    for k in refs:
        refs[k].sort()
    return refs, len(files)


def esc(s):
    if s is None:
        return "∅"
    return s.replace("|", "\\|")

def abs_pkg(rel):
    if rel.startswith("APPS"):
        return "/APPS/pkgs/" + rel.split("pkgs/", 1)[1]
    return "/opt/pkgs/" + rel.split("pkgs/", 1)[1]


def build():
    os.makedirs(OUT, exist_ok=True)
    all_data = {"generated": PULLED, "tv": "75UR9S / V0000.09.60W.Q0624",
                "source_language": SRC, "target_language": TGT,
                "packages": []}
    for p in PACKAGES:
        keys, srcv, tgtv, vda = load_bundle(p, SRC, TGT)
        factory_base, factory_vda = load_factory(p, TGT)
        refs, n_code_files = cross_reference(p, keys)

        live = os.path.join(ROOT, p["live_rel"])
        bundle_md5 = {}
        ext = "js" if p["fmt"] == "C" else "json"
        for fn in (["keys.json"] if p["fmt"] == "A" else []) \
                + [f"language_{l}.{ext}" for l in (SRC, TGT)]:
            fp = os.path.join(live, fn)
            if os.path.isfile(fp):
                bundle_md5[fn] = md5(fp)

        rows = []
        for i, k in enumerate(keys):
            vda_hit = vda is not None and k in vda
            src_eff, tgt_eff = (vda[k] if vda_hit else (srcv[k], tgtv[k]))
            # shadow diff is per-variant: VDA keys vs the factory VDA file,
            # base keys vs the factory base file (a merged dict would flag
            # every VDA override as a "shadow edit" in unedited locales)
            if vda_hit:
                shadow_edited = (factory_vda is not None and k in factory_vda
                                 and factory_vda[k] != vda[k][1])
            else:
                shadow_edited = (factory_base is not None and k in factory_base
                                 and factory_base[k] != tgtv[k])
            srcs = refs[k]
            rows.append(dict(
                id=k, index=i,
                src=srcv[k], tgt=tgtv[k],
                src_eff=src_eff, tgt_eff=tgt_eff,
                vda=vda_hit, shadow_edited=shadow_edited,
                sources=[s for s, _ in srcs],
                ref_count=sum(c for _, c in srcs),
            ))

        # sort: by first source file (none last), then bundle index
        rows.sort(key=lambda r: (r["sources"][0] if r["sources"] else "~", r["index"]))

        n_src = sum(1 for r in rows if r["sources"])
        n_multi = sum(1 for r in rows if len(r["sources"]) > 1)
        n_none = len(rows) - n_src
        n_vda = sum(1 for r in rows if r["vda"])
        n_shadow = sum(1 for r in rows if r["shadow_edited"])

        L = []
        L.append(f"# {p['num']} — {p['name']} ({p['pkg']})")
        L.append("")
        L.append(f"> Menu area: {p['area']}")
        L.append(f"> Bundle: `{abs_pkg(p['live_rel'])}` — {p['fs']}")
        if p["opt_rel"]:
            L.append(f"> Factory original: `{abs_pkg(p['opt_rel'])}` (erofs)")
        L.append(f"> Format {p['fmt']}; keys: **{len(rows)}**; code files searched: {n_code_files}")
        md5s = ", ".join(f"`{fn}` `{h[:12]}…`" for fn, h in bundle_md5.items())
        L.append(f"> Pulled {PULLED} (md5): {md5s}")
        L.append(">")
        L.append(f"> {SRC_NAME} / {TGT_NAME} columns show the **effective** value (active VDA variant")
        L.append(f"> applied, marked `†`). `*` on the ID = live {TGT_NAME} differs from the factory")
        L.append("> `/opt` original (shadow edit). Source file = package code file(s) referencing")
        L.append("> the key; `—` = no reference found in any package `.js`/`.json` (engine-")
        L.append("> rendered or resolved dynamically).")
        L.append("")
        L.append(f"| Source file | ID | {SRC_NAME} | {TGT_NAME} |")
        L.append("|---|---|---|---|")
        for r in rows:
            src = "<br>".join(f"`{s}`" for s in r["sources"]) if r["sources"] else "—"
            marks = ("*" if r["shadow_edited"] else "") + ("†" if r["vda"] else "")
            L.append(f"| {src} | `{r['id']}`{marks} | {esc(r['src_eff'])} | {esc(r['tgt_eff'])} |")
        L.append("")
        if vda:
            L.append(f"## VDA variant overrides ({len(vda)} keys — active variant, wins over base)")
            L.append("")
            L.append(f"| ID | Base {SRC_NAME} | Base {TGT_NAME} | VDA {SRC_NAME} | VDA {TGT_NAME} |")
            L.append("|---|---|---|---|---|")
            for k, (vs_, vt_) in vda.items():
                L.append(f"| `{k}` | {esc(srcv[k])} | {esc(tgtv[k])} | {esc(vs_)} | {esc(vt_)} |")
            L.append("")
        L.append("## Stats")
        L.append("")
        L.append(f"- keys: {len(rows)}; with code reference: {n_src}; referenced by >1 file: {n_multi}; no reference: {n_none}")
        if p["opt_rel"]:
            L.append(f"- live {TGT} differs from factory: {n_shadow}")
        L.append(f"- VDA-variant overrides: {n_vda}")
        L.append("")
        fname = f"{p['num']}-{p['name']}.md"
        with open(os.path.join(OUT, fname), "w", encoding="utf-8") as f:
            f.write("\n".join(L))

        all_data["packages"].append(dict(
            name=p["name"], pkg=p["pkg"], fmt=p["fmt"],
            bundle_path=abs_pkg(p["live_rel"]),
            code_root=abs_pkg(p["code_rel"]),
            bundle_md5=bundle_md5,
            stats=dict(total=len(rows), with_source=n_src, multi_source=n_multi,
                       no_source=n_none, vda_overrides=n_vda, shadow_edited=n_shadow,
                       code_files=n_code_files),
            strings=rows,
        ))
        print(f"{fname}: {len(rows)} keys, {n_src} with source, {n_multi} multi, "
              f"{n_none} none, {n_vda} vda, {n_shadow} shadow-edited, {n_code_files} code files")

    with open(os.path.join(OUT, "strings.json"), "w", encoding="utf-8") as f:
        json.dump(all_data, f, ensure_ascii=False, indent=1)
    write_readme(all_data)
    print(f"README.md + strings.json written to {OUT}")


def write_readme(data):
    """Generate the index README from the built data."""
    pk = data["packages"]
    FIND = "docs/models/75UR9S/V0000.09.60W.Q0624/findings"
    by_name = {p["name"]: p for p in PACKAGES}
    idx = ["| # | Package | Bundle (live source) | Fmt | Keys | With code ref | No ref | VDA overrides | Shadow-edited | Table |",
           "|---|---|---|---|---|---|---|---|---|---|"]
    for i, p in enumerate(pk, 1):
        spec = by_name[p["name"]]
        s = p["stats"]
        vda = str(s["vda_overrides"]) if spec["fmt"] == "A" else "—"
        shadow = str(s["shadow_edited"]) if spec["opt_rel"] else "—"
        bundle = p["bundle_path"] + (" (shadow)" if spec["opt_rel"] else "")
        idx.append(f"| {i} | `{p['pkg']}` ({p['name']}) | `{bundle}` | {p['fmt']} | "
                   f"{s['total']} | {s['with_source']} | {s['no_source']} | {vda} | {shadow} | "
                   f"[{spec['num']}-{p['name']}.md]({spec['num']}-{p['name']}.md) |")

    L = []
    L.append("# 75UR9S / V0000.09.60W.Q0624 — TV menu localization string inventory")
    L.append("")
    L.append("Complete list of the TV's menu localization strings: for each of the five")
    L.append("string-provider packages from")
    L.append("findings 04 §3 (`" + FIND + "/04-localization-override-guide.md`),")
    L.append(f"every bundle key with its **{SRC_NAME}** and **{TGT_NAME}** value and the **package")
    L.append("code file(s) that reference the key by ID** (the consumer — not the bundle")
    L.append("file holding the value).")
    L.append("")
    L.append(f"Pulled **{PULLED}** over the root SSH lane (key-only).")
    L.append("")
    L.append("## Files")
    L.append("")
    L.extend(idx)
    L.append("")
    L.append("`strings.json` is the machine-readable dump of everything above (single")
    L.append("source of truth; the markdown tables are generated from the same data).")
    L.append("Per-key row fields: `id`, `index` (bundle position), `src`/`tgt` (base values),")
    L.append("`src_eff`/`tgt_eff` (effective values, VDA variant applied), `vda`, `shadow_edited`,")
    L.append("`sources`, `ref_count`. Top level records `source_language`/`target_language`.")
    L.append("")
    L.append("## Reading the tables")
    L.append("")
    L.append("Each table is sorted by **source file** (so all strings consumed by one file")
    L.append("are grouped), then by bundle index. Columns:")
    L.append("")
    L.append("- **Source file** — package code file(s) (path relative to the package root)")
    L.append("  containing the key as a token. A key referenced by several files lists all")
    L.append("  of them. `—` = no reference found in any package `.js`/`.json` (the")
    L.append("  webengine keys are referenced by the C++ web engine, not by any JS).")
    L.append(f"- **ID** — the bundle key. Markers: `*` = the live {TGT_NAME} value differs from")
    L.append("  the factory `/opt` original (shadow packages only: hisenseUI, system-ui);")
    L.append("  `†` = the key is overridden by the active **VDA** variant (the effective")
    L.append("  value is shown; the base value is in the package's VDA section).")
    L.append(f"- **{SRC_NAME} / {TGT_NAME}** — the **effective** value (VDA variant applied).")
    L.append("  `∅` = the bundle value is JSON `null` (placeholder keys, e.g. the")
    L.append("  `MTK960x` chip-name entries).")
    L.append("")
    L.append("## Method (how the source files were determined)")
    L.append("")
    L.append("1. Pulled over SSH: all `*.js`/`*.json` under each package root **except**")
    L.append("   the `language/` bundle dirs, plus the bundle files (base + `VDA` variant:")
    L.append(f"   `keys.json`, `language_{SRC}`, `language_{TGT}`) from the **live** source —")
    L.append("   the shadow `/APPS/pkgs/tv.vidaa.app.ui` for hisenseUI/system-ui, the")
    L.append("   `/APPS` originals otherwise — and the `/opt` factory originals for the")
    L.append("   shadow-diff marker.")
    L.append("2. Excluded from the consumer search: `missing_language.json` (a per-locale")
    L.append('   "undefined entries" report at the app root, not a consumer — see')
    L.append(f"   findings 05 (`{FIND}/05-localization-string-inventory.md`)) and")
    L.append("   `unitedtransinfo.json` (a key→English string table in the tvbrowser")
    L.append("   language dir).")
    L.append("3. `current` → `CHA` is a symlink (operationui, webengine); only the real")
    L.append("   `CHA` paths were searched, so no key is double-counted through it.")
    L.append("4. For hisenseUI/system-ui the consumer search ran over the `/opt` code:")
    L.append("   `diff -rq` shows the shadow's non-language files are byte-identical to")
    L.append("   `/opt` (only the `language/` files were edited in the shadow).")
    L.append("5. Each code file was scanned for key tokens")
    L.append("   (`(?<![A-Za-z0-9])[A-Z]{2,5}[0-9]{2,8}(?![A-Za-z0-9])`); a token counts")
    L.append("   only if it is a key of that package's bundle (keys are bundle-scoped, not")
    L.append("   global — findings 04 §2).")
    L.append("")
    L.append("## Caveats")
    L.append("")
    L.append("- A key with `—` may still be resolved **dynamically** (constructed at")
    L.append("  runtime) or referenced by the native engine — absence of a static token is")
    L.append("  not proof of non-use. The webengine keys are the known engine case.")
    L.append("- Format A bundles are **index-aligned** (findings 04 §9): the `index` field")
    L.append("  in `strings.json` is the bundle position of each key.")
    L.append(f"- For the shadow packages (hisenseUI, system-ui) the {TGT_NAME} column is the")
    L.append("  **live shadow** value; any key whose live value differs from the factory")
    L.append("  `/opt` original is marked `*`. Regenerating after further shadow edits")
    L.append("  will change those rows.")
    L.append("- Transient OSD elements (volume bar, channel overlay, power-on logo) are")
    L.append("  engine-rendered and are not in the bundles (findings 04 §3).")
    L.append("")
    L.append("## Regenerate")
    L.append("")
    L.append("```sh")
    L.append(f"tools/ur9s/scripts/pull_localization.sh --tv <tv-ip> --src {SRC} --tgt {TGT}")
    L.append("tools/ur9s/scripts/build_localization.py /tmp/ur9s-loc/tree \\")
    L.append(f"    /tmp/ur9s-loc/tables --src {SRC} --tgt {TGT}")
    L.append("```")
    L.append("")
    L.append("Other language pairs: pass the same `--src`/`--tgt` (the TV's bundle file")
    L.append("codes, e.g. `ger`, `pol`) to both scripts; the pull keeps only the requested")
    L.append("locales. The pull is read-only on the TV (find + tar over SSH); the build")
    L.append("runs locally and rewrites this directory's README, tables and `strings.json`.")
    L.append("")
    L.append("## Related")
    L.append("")
    L.append(f"- findings 04 — overriding TV menu localization (`{FIND}/04-localization-override-guide.md`)")
    L.append("  (bundle formats, shadow package, override procedures)")
    L.append(f"- findings 05 — localization string inventory (`{FIND}/05-localization-string-inventory.md`)")
    L.append("  (this work: method, measurements, traps)")
    L.append(f"- findings 03 — Quick Menu (`{FIND}/03-quickmenu-on-screen-menu.md`)")
    L.append("  (item registry: the authoritative `settingItemTitle` key per menu item)")
    with open(os.path.join(OUT, "README.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))


if __name__ == "__main__":
    build()
