# 05 — Localization string inventory: key → source-file cross-reference

> Measured 2026-11-22 over the root SSH lane on **75UR9S /
> V0000.09.60W.Q0624** (MT9655). Companion to
> [04 — localization override guide](04-localization-override-guide.md):
> 04 says *where the strings live*; this says *which code file uses each
> string* and how to build the full key → source-file inventory. The
> per-language inventory itself (per-package tables + `strings.json`) is
> generated on demand by the tools in §1 — it is not committed to the repo.

## 1. What was done

For every key of the five bundles (findings 04 §3) the package's code files
were scanned for the key token and the referencing file(s) recorded:

1. Pulled over SSH (read-only `find` + `tar`): all `*.js`/`*.json` under each
   package root except the `language/` dirs, plus the bundle files (base +
   `VDA` variant) from the **live** source (shadow for hisenseUI/system-ui)
   and the `/opt` factory originals.
2. Consumer search = token regex
   `(?<![A-Za-z0-9])[A-Z]{2,5}[0-9]{2,8}(?![A-Za-z0-9])` with membership in
   the package's own key set (keys are bundle-scoped — findings 04 §2).
3. Excluded from the search: `missing_language.json` and
   `unitedtransinfo.json` (both are string tables, not consumers — §3.1,
   §3.2); the `current` → `CHA` symlink was never followed (real paths only,
   or every key in operationui/webengine would be double-counted).
4. hisenseUI/system-ui code was searched in `/opt`: `diff -rq` of the shadow
   against `/opt` shows **no difference outside `language/`** — the shadow
   differs only in the edited bundle files, so the `/opt` code is the live
   code.

Tooling: [`tools/ur9s/scripts/pull_localization.sh`](../../../../tools/ur9s/scripts/pull_localization.sh)
+
[`tools/ur9s/scripts/build_localization.py`](../../../../tools/ur9s/scripts/build_localization.py)
(regenerates the whole inventory).

## 2. Result — who owns the strings

| Package | Keys | Code files | Top consumer(s) | No JS ref |
|---|---|---|---|---|
| hisenseUI | 535 | 71 | `static/js/sdk.js` (490), `static/js/861.js` (49) | 0 |
| system-ui | 3052 | 500 | `apps/setting/js/app.js` (1507), `apps/fte/js/app.js` (156), `apps/setting/js/6626.js` (77) | 0 |
| operationui | 2002 | 385 | `apps/ai-button/js/app.js` (385), `apps/voice/js/app.js` (236), `apps/hi-media/js/app.js` (140), `apps/live-tv/js/app.js` (129), `apps/pvr/js/app.js` (71) | 0 |
| tvbrowser | 80 | 39 | `webui/setting/static-browser/js/app.01375be.js` + `app.7c26b6c.js` (all 80 in each) | 0 |
| webengine | 3 | 39 | — (engine) | **3** |

Multi-file references are common (system-ui: 637 keys in >1 file;
operationui: 519) — shared components and the webpack chunk layout make one
key appear in several bundles. The tables list every referencing file.

## 3. Findings

### 3.1 `missing_language.json` is a QA report, not a runtime fallback

Findings 04 §3 calls it "the fallback for keys absent in the active
locale". Measured: it sits at the **app root** (e.g.
`system-ui/missing_language.json`), not under `language/`, and its content
is a per-locale-file report of entries whose value is the literal string
`"undefined"`:

```json
{ "language/language_alb.json": { "DEV0045": "undefined", "MT9655": "undefined", … } }
```

system-ui's is `{}` (nothing missing); operationui's lists gaps for several
locales. It is a translation-QA artifact shipped in the package, not
something the engine reads at runtime. (Chip names like `MT9655` appear as
"keys" here — they are not bundle keys; the bundle's `MTK960x` placeholders
are the real ones, and they are `null` in both eng and cze.)

### 3.2 `unitedtransinfo.json` is a string table

In the tvbrowser `language/` dir alongside the locale files: a flat
`{key: English value}` object covering the same 80 keys — a reference copy
of the English strings, not a consumer. Excluded from the search for that
reason.

### 3.3 Variant subdirs: what is actually sparse

| Bundle | base | `VDA/` | `NO-TV/` | `VDA-NO-TV/` |
|---|---|---|---|---|
| hisenseUI | 535 | **0** (`[]`) | 5 | 0 |
| system-ui | 3052 | 27 | 285 | 3 |
| operationui | 2002 | 53 | 88 | 6 |

The active variant is **VDA** (findings 04 §3). hisenseUI's VDA variant is
**empty** — no home-screen key is variant-overridden on this TV. The
system-ui VDA set is the rebrand/feature set (e.g. `KID0001` base "V
Account" → VDA "VIDAA Account"); 26 of its 27 cze values differ from base
(`ART0058` matches). The NO-TV variants are dormant on this TV (it has TV)
but are real: system-ui NO-TV overrides 231 of its 285 cze values vs base.

### 3.4 Live (shadow) vs factory values are diffed per key

For the two packages that run from a shadow copy (hisenseUI, system-ui —
findings 04 §3), the build tool compares each key's **live** value against
the factory `/opt` original and marks any difference with `*` in the table.
The comparison is per variant — a `VDA` key is compared against the factory
`VDA` file, a base key against the factory base file — so a key that merely
has a variant override is *not* flagged; only a value that actually differs
from factory in the same variant is. This surfaces any local edit to a shadow
bundle in the inventory without the tool assuming which keys were touched.

### 3.5 webengine keys have no JS consumer

`BR0257`/`BR0258`/`BR0259` occur **only** in the `language_*.js` bundles
themselves — the error-page strings are resolved by the C++ web engine, not
by any package JS. "No reference found" in the inventory is correct, not a
miss.

### 3.6 tvbrowser ships two full webpack bundles

`webui/setting/static-browser/js/app.01375be.js` and `app.7c26b6c.js` each
contain **all 80** browser keys — two builds of the same app coexist in the
package. A browser-webui edit must land in the bundle the webui actually
loads (check which one the page requests); the module files
(`bookmark-page.js`, `toolbar.js`, `voice-control.js`, `updater.js`) carry
only one key each.

## 4. Traps

- **Busybox grep follows directory symlinks.** `grep -r` over operationui
  reported both `CHA/…` and `current/…` for the same file — dedupe via real
  paths or every operationui/webengine key counts twice.
- **Nested `language/` dirs.** The bundle dir is not always at the package
  root (tvbrowser: `webui/setting/static-browser/language/`, webengine:
  `resources/errorPage/language/`). Excluding only a top-level `language/`
  lets the bundle files count as their own consumers — the first inventory
  run did exactly that (all 5672 keys "found", webengine included).
- **Key tokens need boundaries.** Without the lookarounds, a key that is a
  prefix of a longer identifier (or of another key) false-positives.
- **`null` bundle values are legal.** Format A arrays contain `null` for
  placeholder keys (`MTK9602`/`MTK9603`/`MTK9605`/`MT9655`…); a naive
  `value.replace()` crashes on them.
- **`mktemp`/`cut`/`tr` do not exist** on this build — the pull script uses
  a fixed `/tmp` list file, and md5 comparisons must be done on the PC.
- **The shadow is live code-identical to `/opt`** *today*; if the shadow is
  ever re-seeded with edited code, the consumer search must move to the
  shadow paths (the build script takes the tree as an argument for exactly
  this).

## 5. Output (generated on demand)

`build_localization.py` writes, into the output directory you give it
(outside the repo, e.g. `/tmp`): an index README (method + caveats),
one table per package (source file | ID | <src lang> | <tgt lang>, grouped by
source file, with a VDA-variant section per package and `*`/`†` markers), and
`strings.json` (full dump incl. bundle index, base vs effective values,
per-key source list, md5s). Run the two scripts from §1 to regenerate it for
any language pair.