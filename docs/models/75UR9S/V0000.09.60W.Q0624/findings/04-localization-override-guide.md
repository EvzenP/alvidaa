# 04 — Overriding TV menu localization (i18n bundle guide)

> A reusable guide for changing **any** label in the TV's menus — Settings,
> Quick Menu, home screen, live-TV UI, browser, error pages. Measured 2026-11-14
> over the root SSH lane on **75UR9S / V0000.09.60W.Q0624** (MT9655); the
> shadow-package override (§5.2) measured and cold-reboot-verified 2026-11-18.
> Reversible; verified boot stays green. Companion to
> [01 — OS exploration](01-os-exploration.md),
> [02 — SFTP lane](02-file-transfer-sftp.md), and
> [03 — Quick Menu reference](03-quickmenu-on-screen-menu.md).

## 1. TL;DR

- Every menu label is **data**, not code: it lives in a JSON/JS **i18n bundle**
  shipped inside a package. There is no string table in the binary.
- **5 bundles, 3 formats.** Two sit on the read-only `/opt` (override with a
  **shadow package** in `/APPS/pkgs`, §5.2); three sit on writable `/APPS`
  (edit **in place**).
- To change a label: find its **key** (search the value in the bundle the
  screen loads) → patch the value at that key → **restart SystemUI** only if it
  is already running (at cold boot the shadow is loaded at first launch, §5.5).
- **Ownership trap — read §5.2 before touching anything:** every file in the
  shadow must be owned `305:909`, mode `640`. Files created as `root:root` are
  unreadable by the UI process and the menu renders **raw string ids**
  (`SE0002`, …) instead of strings.
- **Reversible:** `rm -r` the shadow (or restore the file). **Persistence**
  across reboot is **native** — the shadow sits on writable `/APPS`, needs no
  re-arm and no SystemUI restart, so the TV's boot state (Live TV resume) is
  preserved (§7.1, verified with a cold reboot 2026-11-18).
- Changing a string **never** corrupts saved menu layouts — those are stored as
  item **ids**, not strings (§6).
- The former **bind-mount** override (postinst re-arm + SystemUI restart at
  every boot) is preserved as a documented alternative (§5.3, §7.2).

## 2. How the menu gets its strings

The "native" UI is a set of **web apps** rendered by the **cobalt/starboard**
engine (SystemUI). Each app package ships a `language/` directory of i18n
bundles. At startup the engine loads the bundle for the **active UI language**
(`curLang` in the starboard storage, e.g. `eng`) and resolves each
label by **key**.

**Key-scoping trap — read this first.** Keys are **not global**. The same key
(e.g. `ACG0104`) exists in several bundles with *different* values (293 keys
overlap between system-ui and operationui, 76 between operationui and hisenseUI).
A key resolves **within the bundle the rendering context loaded**. So:
identify *which* bundle owns the screen you are editing, and scope your search
to that bundle. Never assume a key means the same thing everywhere.

### The three bundle formats

| Format | Files | Used by |
|---|---|---|
| **A — parallel arrays** | `keys.json` = `["K1","K2",…]` + `language_<loc>.json` = `["v1","v2",…]`, **index-aligned** | hisenseUI, system-ui, operationui |
| **B — flat object** | `language_<loc>.json` = `{"K1":"v1","K2":"v2"}` (no `keys.json`) | tvbrowser |
| **C — per-locale JS** | `language_<loc>.js` = `var language = { K1: "v1", … }` | webengine errorPage |

## 3. All string providers (complete list)

| # | Package | `language/` path | Fmt | FS | Keys | Menu area served |
|---|---|---|---|---|---|---|
| 1 | `tv.vidaa.app.ui` (hisenseUI) | `/opt/pkgs/tv.vidaa.app.ui/hisenseUI/language` | A | **ro** (erofs) | 535 | Home screen / launcher (app tiles, home labels) |
| 2 | `tv.vidaa.app.ui` (system-ui) | `/opt/pkgs/tv.vidaa.app.ui/system-ui/language` | A | **ro** (erofs) | 3052 | Main **Settings**, on-screen menus, **Quick Menu** |
| 3 | `tv.vidaa.app.operationui` | `/APPS/pkgs/tv.vidaa.app.operationui/CHA/language` | A | **rw** (ext4) | 2002 | Live-TV operation UI: channel scan, EPG, PVR, inputs |
| 4 | `tv.vidaa.app.tvbrowser` | `/APPS/pkgs/tv.vidaa.app.tvbrowser/webui/setting/static-browser/language` | B | **rw** (ext4) | 80 | TV browser webui (Home page, Exit, Clear Cookies, browser errors) |
| 5 | `tv.vidaa.res.webengine` | `/APPS/pkgs/tv.vidaa.res.webengine/CHA/resources/errorPage/language` | C | **rw** (ext4) | ~3 | Web-engine network-error pages (No Internet / Reconnect) |

Notes:
- `current -> CHA` is a symlink (operationui, webengine): the `CHA/…` path is
  the live one.
- **Variant subdirs** (Format A only): `<language>/VDA`, `NO-TV`, `VDA-NO-TV`
  hold **sparse** per-variant overrides (parallel arrays, same key order as the
  base). The active variant on this TV is **VDA**. If the key you are editing is
  overridden in the active variant, patch the variant file too — it wins over
  the base.
- `missing_language.json` (Format A) sits at the **app root** (not under
  `language/`) and is a shipped per-locale report of entries whose value is
  the literal `"undefined"` — a translation-QA artifact, not a runtime
  fallback (measured 2026-11-22; [findings 05 §3.1](05-localization-string-inventory.md#31-missing_languagejson-is-a-qa-report-not-a-runtime-fallback)).
- These five cover all **persistent** menu/setting labels. Transient OSD
  elements (volume bar, channel-number overlay) and the power-on logo are
  rendered by the engine and are not all present in the bundles.

## 4. Finding the key for a displayed string

1. Pull the bundle for the screen you are editing (see §3 for which one).
2. Search the **value** in the locale file → the **index** (Format A) or the
   **key** (Format B/C).
3. Format A: `key = keys.json[index]`. Format B/C: the key sits next to the value.
4. If the same text appears under several keys/bundles, pick the one the target
   screen actually uses. For **menu items**, the item registry maps each item to
   its `settingItemTitle` key — that is the authoritative key (see the Quick Menu
   findings).

Real examples (English, from the pulled bundles):

| Key | Value (English) | Bundle | FS |
|---|---|---|---|
| `ACF1357` | `Sleep Timer` | operationui | rw |
| `ACF1151` | `Set the sleep timer to automatically turn the device off…` | system-ui | ro |
| `OT0185` | `Programme Guide Auto Update` | system-ui | ro |
| `ACE0018` | `The channel list is already up-to-date. Do you wish to continue…` | system-ui | ro |
| `BR0001` | `Home page` | tvbrowser | rw |
| `BR0016` | `Clear Cookies` | tvbrowser | rw |
| `BR0257` | `No Internet Connection` | webengine | rw |
| `BR0259` | `Reconnect` | webengine | rw |

Note `ACF1357` ("Sleep Timer", operationui) vs `ACF1151` (the sleep-timer
*description*, system-ui): the same concept's **label** and **description** live
in **different bundles**. That is the key-scoping trap in action.

## 5. Applying an override

### 5.1 Writable bundles — edit in place (operationui, tvbrowser, webengine)

Root bypasses the `444` mode bits on the writable `/APPS` ext4, so edit in place:

```sh
L=/APPS/pkgs/tv.vidaa.app.operationui/CHA/language
cp $L/language_eng.json $L/language_eng.json.bak        # backup
# …edit the value (Format A: index; B/C: key)…
# push the edited file back (or edit on the TV directly)
```

### 5.2 Read-only bundles — shadow package (system-ui, hisenseUI) — **primary**

`/opt` is **erofs + dm-verity** — it cannot be written. The override is a
**shadow copy** of the whole package in the writable package root:
`/APPS/pkgs/tv.vidaa.app.ui`. The UI launcher (`/opt/hisenseUI/startgui.sh`)
resolves the package via `GET_PKG_DEST`, which **prefers `/APPS/pkgs` over
`/opt`** — with the shadow present, SystemUI's environment carries
`HI_UI_HOME=/APPS/pkgs/tv.vidaa.app.ui` and it loads the shadow's bundles at
first launch. No mount table, no postinst re-arm, no SystemUI restart at boot.

```sh
# 1. Create the shadow (once). ~2429 files. cp reads through any live bind
#    mounts, so a copy made while mounts are active bakes their content in.
cp -a /opt/pkgs/tv.vidaa.app.ui /APPS/pkgs/

# 2. Edit the bundles in place inside the shadow (Format A: index; B/C: key).
#    e.g. /APPS/pkgs/tv.vidaa.app.ui/system-ui/language/language_cze.json

# 3. OWNERSHIP (the trap that costs an evening): vendor language files are
#    uid 305, gid 909, mode 640 (dirs 750). SystemUI runs as uid 311 with 909
#    as a *supplementary group*, and 640 gives "other" nothing — a file you
#    create as root (root:root, 640) is a hard EACCES for the UI process and
#    the engine renders the RAW KEY (SE0002, …) instead of the string.
chown 305:909 <every file you added or replaced>
chmod 640 <files>   # 750 for directories
```

SELinux is **not** the wall here: files under `/APPS` get the `hs_apps_file`
context, which the UI reads fine (it reads every other `/APPS` package). The
failure mode is pure DAC — ownership + mode. **Symptom check:** if only one
bundle's screens show raw ids while the rest of the UI looks normal, it is
almost certainly ownership on the files you touched in that bundle.

Reversible: `rm -r /APPS/pkgs/tv.vidaa.app.ui` → `GET_PKG_DEST` falls back to
`/opt` (verified boot stays green; the shadow writes nothing to `/opt`).

### 5.3 Read-only bundles — bind-mount overlay (alternative)

The former primary method, kept as an alternative (e.g. when you want to
override a single file without copying the whole package). Stage a patched
copy in the lane's staging root and bind-mount it over the `/opt` original:

```sh
mkdir -p /var/local/alvidaa/ui-language/system-ui
cp <patched> /var/local/alvidaa/ui-language/system-ui/language_eng.json
mount --bind /var/local/alvidaa/ui-language/system-ui/language_eng.json \
            /opt/pkgs/tv.vidaa.app.ui/system-ui/language/language_eng.json
ls -i /opt/pkgs/tv.vidaa.app.ui/system-ui/language/language_eng.json   # inode changed = live
```

The staged file's **own DAC** is what SystemUI sees at the mount point —
stage it world-readable (or `305:909` mode `640`), never `root:root` 640
(§5.2 ownership trap). SELinux-compatible, partition-safe, reversible:
`umount <path>` brings the original back. Writing to `/opt` is a gray area
per `never-touch.json`; a bind mount writes **nothing** to the protected
partition and verified boot stays green — flagged and accepted.

**Verify liveness by inode, not by grepping `/proc/mounts`.** `/opt` is a
symlink to `/mnt/tvroot/opt` (erofs); the kernel resolves the bind target
through it, so `/proc/mounts` shows the *resolved* path and the block device —
never the source you mounted. `ls -i <target>` must equal `ls -i <staged file>`
(same inode) to prove the mount is live; `/proc/self/mountinfo` shows the source
path if you want to see it. The boot-persistent variant of this lane is in §7.2.

### 5.4 Variant subdirs

If the key is overridden in the active variant, patch it there too (it wins):
`grep -n '<key>' <language>/VDA/keys.json` → edit `<language>/VDA/language_eng.json`.

### 5.5 Making it take effect

The engine loads i18n **at startup**.

- **Shadow package / fresh boot:** nothing to do — SystemUI loads the shadow
  at first launch. A cold reboot applies the change *and* preserves the TV's
  startup state (Live TV resume).
- **SystemUI already running:** restart it — the running process caches the
  bundles in memory and does not re-read the JSON:

```sh
kill <SystemUI pid>          # then
/opt/hisenseUI/startgui.sh   # (busybox setsid, detached, if from a script)
```

  Note: restarting SystemUI mid-session drops the current Live TV state —
  prefer a reboot when the TV is idle.

### 5.6 Alternative for menu-item titles — `settingchange.json`

Menu items can also be retitled via the per-item `settingchange.json` cloud
override (keyed by item **id**; merges `title`/`description`). It is a separate,
id-scoped layer from the i18n bundle. Use it to change a single item's title
without touching the bundle (see the Quick Menu findings for the item registry).

## 6. Does changing a string affect saved menu layouts? (Quick Menu)

**No.** Menu layouts (e.g. the Quick Menu's two rows) are persisted as **arrays
of item ids** — never as strings:

- `setting.qsEditList` / `setting.qsBakList` = JSON arrays of **ids** (e.g.
  `MenuTree_PIC_0101`), in the SystemUI starboard storage.
- On load, each id maps through the item registry → the item's
  `settingItemTitle` **key** → resolved from the i18n bundle **at render time**.
- The edit dialog reads the same id lists; moving an item writes the ids back.

So a bundle string edit only changes the **rendered label** — it changes no id,
no key, no stored byte. **Storing, restoring, and editing the menu are all
id-based and completely unaffected.** The only things that would break the
mapping are changing an item's **id** or its **i18n key** — both are
code/registry changes, not bundle edits. (The "storage filename contains `==`"
and "edit only while SystemUI is stopped" caveats apply to editing the *layout
storage*, not the bundle.)

## 7. Persistence across reboot

### 7.1 Shadow package (primary) — native persistence, no re-arm

Everything the shadow mechanism writes is on the writable ext4 (`/APPS`), so:

- The shadow **survives reboot by itself** — no mount table, no postinst step,
  no re-arm. `GET_PKG_DEST` picks `/APPS/pkgs` on every boot.
- **No SystemUI restart at boot** — the engine loads the shadow at first
  launch, so the TV's startup state (e.g. **Live TV resume**) is preserved.
  This is why the shadow replaced the bind-mount lane: the old lane's
  boot-time `kill $(pidof SystemUI)` + relaunch destroyed the resumed Live TV
  session on every power cycle (ordering measured 2026-11-21, §7.2).
- `/APPS` edits of the writable bundles (operationui, tvbrowser, webengine)
  likewise survive reboot.

**Verified 2026-11-18 (cold reboot):** after `reboot`, the shadow was
byte-identical (md5 of every `language_*cze.json` matched pre-reboot), no bind
mounts existed, SystemUI came up from `HI_UI_HOME=/APPS/pkgs/tv.vidaa.app.ui`
and the localized menu rendered correctly.

### 7.2 Bind-mount lane (alternative) — postinst re-arm, complete

The former primary method, documented in full — the step's complete code
is inlined below. `/opt` bind mounts do not survive a power
cycle, so the `re.installer` postinst carried a `ui-language` step that
re-armed them at every boot. It was **data-driven**: the staging tree *was*
the desired state.

**The boot lane (measured 2026-11-21).** The re-arm is driven by the
dropbear lane's own boot lane: the **`re_sshd` jsservice**
(`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd`,
`serviceList.json` `autoStart: true`, runs as **uid 314**) sends the
superwatch opkg payloads over `/var/run/superwatch_socket` —
`90:83:90;re.installer` (uninstall) then
`91:82:91;/APPS/installer.ipk;re.installer;` (install) — and the install
**re-runs the postinst as uid 0** (the same root-elevation the dropbear lane
uses). It retries every 5 s, up to 36 attempts, until dropbear is up.
Timestamps from `/APPS/.re_sshd/boot_marker.txt` (ISO) + `/proc/<pid>/stat`,
2026-11-21 boot (boot ≈ 13:51:00Z):

| t since boot | Event |
|---|---|
| ~+4 s | **SystemUI starts** (pid 1531, starttime 369 jiffies) and reads the *unmounted* bundles |
| +5.4 s | `re_sshd` starts (uid 314); sends uninstall + install |
| +33…+38 s | postinst re-arm: mounts the staged bundles, then **kills and relaunches SystemUI** |

So on every cold boot the override is invisible for the first ~30 s, and the
re-arm's SystemUI restart **destroys the resumed Live TV session on every
power cycle** — the cost the shadow lane (§7.1) removes. (The postinst's own
comments disagree on this ordering — one claims SystemUI is not up yet on a
cold boot — but the timestamps settle it: SystemUI starts *before* the
re-arm, so the restart fires on **every** boot, not only on manual re-arms.)
`install=[TIMEOUT]` in the marker is the **normal success pattern**: the
install response never returns within the 15 s socket timeout, but the install
proceeds and dropbear is up by the next 5 s check.

**The step, as shipped — complete code.** The `ui-language` step of the
`re.installer` postinst (runs as **uid 0**; de-indented from the postinst):

```sh
echo "--- step: ui-language ---"
# i18n override (findings 04): bind-mount staged language bundles over the
# read-only /opt copies. Data-driven: the staging tree IS the desired state.
# Layout: $LP/<bundle>/<relpath> -> /opt/pkgs/tv.vidaa.app.ui/<bundle>/language/<relpath>
# (relpath may include variant subdirs like VDA/). No-op when the staging
# root is absent; teardown = rm -r $LP (the stale sweep unmounts on the next
# re-arm). Filenames under $LP must not contain spaces (bundles don't).
LP=/var/local/alvidaa/ui-language
# /opt is a SYMLINK to /mnt/tvroot/opt (erofs). The kernel resolves a bind
# target through it, so /proc/mounts shows the RESOLVED path
# (/mnt/tvroot/opt/...), never the /opt/... we pass. Resolve once and use
# the canonical path for both mounting and the /proc/mounts checks, or the
# idempotency grep below never matches and every re-arm stacks a fresh bind
# mount on top of the old one (mount-table leak).
OPT_REAL=$(ls -ld /opt 2>/dev/null | awk '{print $NF}')
[ -n "$OPT_REAL" ] || OPT_REAL=/opt
UIROOT="$OPT_REAL/pkgs/tv.vidaa.app.ui"
if [ -d "$LP" ]; then
    # stale sweep: unmount our bind mounts whose staged source is gone.
    # Match on the RESOLVED target (field 2 of /proc/mounts); field 1 is the
    # block device, so it can never be matched against $LP.
    awk '{print $2}' /proc/mounts | while read -r dst; do
        case "$dst" in
            "$UIROOT"/*)
                sub=${dst#"$UIROOT"/}          # <bundle>/language/<rest>
                bundle=${sub%%/*}
                case "${sub#*/}" in
                    language/*)
                        rest=${sub#"$bundle"/language/}
                        [ -f "$LP/$bundle/$rest" ] || { echo "stale umount $dst"; umount "$dst" 2>&1; }
                        ;;
                esac
                ;;
        esac
    done
    mounted=0
    for f in $(find "$LP" -type f 2>/dev/null); do
        rel=${f#"$LP"/}
        case "$rel" in
            */*) ;;
            *) echo "skip (not in a bundle dir): $rel"; continue ;;
        esac
        bundle=${rel%%/*}
        rest=${rel#*/}
        t="$UIROOT/$bundle/language/$rest"
        if [ ! -e "$t" ]; then echo "no target: $t"; continue; fi
        if grep -q " $t " /proc/mounts; then
            echo "already mounted: $t"
        elif mount --bind "$f" "$t" 2>&1; then
            echo "mounted: $t <- $f"
            mounted=1
        else
            echo "MOUNT FAILED: $t"
        fi
    done
    # If anything was (re)mounted and SystemUI is already up, restart it so
    # it re-reads the bundles. On a cold boot SystemUI is not up yet, so
    # this only fires on a manual re-arm. Detached: postinst must not hang
    # on the UI launcher.
    if [ "$mounted" = 1 ]; then
        SU=0
        for p in /proc/[0-9]*/cmdline; do
            grep -q SystemUI "$p" 2>/dev/null && SU=1
        done
        if [ "$SU" = 1 ]; then
            echo "SystemUI running: restarting"
            # pkill does not exist on this TV (verified 2026-11-16); kill by
            # pid instead. startgui.sh bails if SystemUI is still up (its
            # `pidof SystemUI` guard), so wait for it to actually die first,
            # or the relaunch below is a silent no-op and the stale strings
            # persist. SystemUI starts at boot (tick ~47) BEFORE this step,
            # so it has already read the unmounted bundles and MUST be
            # restarted to pick up the freshly-mounted ones.
            kill $(pidof SystemUI) 2>/dev/null
            i=0
            while [ "$i" -lt 10 ] && pidof SystemUI >/dev/null 2>&1; do sleep 1; i=$((i+1)); done
            busybox setsid /bin/sh -c '/opt/hisenseUI/startgui.sh' >/dev/null 2>&1 < /dev/null &
        else
            echo "SystemUI not running: nothing to restart"
        fi
    fi
else
    echo "staging root absent: no-op"
fi
```

**How it works:**

- **Staging:** `$LP=/var/local/alvidaa/ui-language`; layout
  `$LP/<bundle>/<relpath>` → `$UIROOT/<bundle>/language/<relpath>`, where
  `<bundle>` is *any* directory under `$LP` (`system-ui`, `hisenseUI`) and
  `<relpath>` may include variant subdirs (`VDA/…`). Files directly under
  `$LP` are skipped; **staged filenames must not contain spaces** — the mount
  loop is `for f in $(find "$LP" -type f)` and word-splits.
- **Target root:** `/opt` is a symlink to `/mnt/tvroot/opt`; the step resolves
  it once — `OPT_REAL=$(ls -ld /opt | awk '{print $NF}')` (fallback `/opt`),
  `UIROOT="$OPT_REAL/pkgs/tv.vidaa.app.ui"` — and uses the *resolved* path for
  the mounts **and** every `/proc/mounts` check (grep the literal `/opt/…`
  instead and the "already mounted" check never matches → every re-arm stacks
  a fresh bind mount, a mount-table leak, and the sweep never fires).
- **Stale sweep (runs first):** iterates **field 2** (target) of
  `/proc/mounts` — field 1 is the block device and can never match — and
  umounts any mount under `$UIROOT/<bundle>/language/…` whose staged source
  `$LP/<bundle>/<relpath>` is gone. This is what makes `rm -r $LP` a complete
  teardown on the next re-arm.
- **Mount loop:** per staged file, the target must exist (`[ -e "$t" ]`, else
  `no target` + skip); already-mounted targets (space-delimited
  `grep " $t " /proc/mounts`) are skipped; otherwise `mount --bind "$f" "$t"`.
  Only a **new** mount sets `mounted=1`.
- **SystemUI restart — gated on `mounted=1`:** detect SystemUI by scanning
  `/proc/[0-9]*/cmdline` (not `pidof`); `kill $(pidof SystemUI)`; wait up to
  **10 s** (1 s ticks) for it to die — `startgui.sh` has a `pidof` guard
  (line 6) and bails if SystemUI is still up, so skipping the wait makes the
  relaunch a **silent no-op** and the stale strings persist; then relaunch
  detached (`busybox setsid /bin/sh -c '/opt/hisenseUI/startgui.sh'
  >/dev/null 2>&1 < /dev/null &`) — the postinst must not hang on the UI
  launcher.
- **Audit trail:** the whole postinst (incl. this step) is redirected to
  `/APPS/.re_sshd/installer_log.txt` — `mounted:` / `already mounted:` /
  `stale umount:` / `MOUNT FAILED:` are the re-arm's log lines.
- **No-op when absent:** if `$LP` doesn't exist the step does nothing — the
  IPK was safe to ship with no override staged.
- **Ownership:** the step does **no** chown/chmod — the *staged file's* DAC is
  what SystemUI sees at the mount point. Stage world-readable (or `305:909`
  mode `640`); a `root:root` 640 staged file hits the same raw-ids trap as the
  shadow (§5.2).

**Status:** the `ui-language` step no longer ships in
`tools/ur9s/scripts/make_installer.py` (the postinst no longer touches UI
language), and the staging tree is deleted from the TV (`/var/local/alvidaa`
is empty; verified 2026-11-21). The code above is the complete archive of
the step — rebuild from it if the bind-mount lane is ever needed again.

**Verified 2026-11-15 (cold reboot, historical):** after a hard power cycle
the postinst ran at boot and all four staged language files were bind-mounted
and **still live 17+ min later**. Proof the mount is real (not just a path):
`ls -i` of the target equals `ls -i` of the staged file (same inode) — e.g.
system-ui `language_eng.json` inode 1354 on both sides.

## 8. Reversibility / teardown

- **Shadow package (§5.2, primary):** `rm -r /APPS/pkgs/tv.vidaa.app.ui` —
  `GET_PKG_DEST` falls back to `/opt` on the next SystemUI start (restart
  SystemUI or reboot to apply). No other state is involved.
- **Writable bundles:** restore the `.bak` file.
- **Bind mounts (alternative, §5.3):** `umount <path>` (the original
  reappears); then `rm -r /var/local/alvidaa/ui-language`. For the
  postinst-driven variant (§7.2): `rm -r /var/local/alvidaa/ui-language` is
  the full teardown —
  the stale sweep umounts the now-orphaned mounts on the next boot; to clear
  them *immediately* (no reboot), `umount` each target under
  `/opt/pkgs/tv.vidaa.app.ui/{system-ui,hisenseUI}{,/VDA}/language/`.
- After any teardown, verify the original inode/value is back (`ls -i`) before
  moving on.

## 9. Traps

- **Shadow file ownership is load-bearing (the 2026-11-18 raw-ids incident).**
  Vendor language files are `305:909`, mode `640` (dirs `750`). SystemUI runs
  as uid 311 with **909 as a supplementary group**; mode 640 gives "other"
  nothing. Any file you create in the shadow as root (`root:root`, 640) is a
  hard EACCES for the UI process → the engine renders the **raw i18n key**
  (`SE0002`, …) for every label that bundle serves, while all other bundles
  look normal. `chown 305:909` + `chmod 640` every file you add or replace
  (§5.2). SELinux context (`hs_apps_file` under `/APPS`) is fine — this is DAC,
  not MAC.
- **`GET_PKG_DEST` prefers `/APPS/pkgs` over `/opt`.** That is what makes the
  shadow work — and it means *any* package directory you drop into
  `/APPS/pkgs` shadows its `/opt` twin for the UI. Check
  `/proc/<SystemUI pid>/environ` (`HI_UI_HOME`) to see which copy is actually
  loaded.
- **`cp -a` reads through live bind mounts.** Copying the `/opt` package while
  bind mounts are active bakes the mounted (localized) content into the copy —
  useful (it is how the shadow was seeded), but "copy of `/opt`" is not "copy
  of the pristine package" while mounts are live.
- **Keys are bundle-scoped, not global** (293 overlap sysui/opui). Scope the
  search to the owning bundle.
- **Format A is index-aligned** — a shifted `keys.json` desyncs every value after
  it. Edit values in place; never reorder or insert.
- **Variant subdirs win over base** — patch the active variant (`VDA`) if it
  overrides the key.
- **`/opt` is erofs + dm-verity** — never write it; shadow in `/APPS/pkgs`
  (primary, §5.2) or bind-mount (alternative, §5.3).
- **`/opt` is a symlink to `/mnt/tvroot/opt`.** Bind targets resolve through it,
  so `/proc/mounts` shows the resolved path + block device, never your source.
  Verify a mount by inode match (`ls -i`), not by `grep /proc/mounts`.
- **Idempotency greps must use the resolved path.** Grep the literal `/opt/…`
  path and the "already mounted" check never matches → every re-arm stacks a bind
  mount (mount-table leak). Resolve `/opt` into `$UIROOT` first (§7.2).
- **Staged filenames must not contain spaces** (bind-mount lane): the mount
  loop is `for f in $(find "$LP" -type f)` — it word-splits. Bundle filenames
  don't have spaces; a renamed file with spaces is silently mis-split (§7.2).
- **`install=[TIMEOUT]` in `/APPS/.re_sshd/boot_marker.txt` is normal**
  (bind-mount lane): the superwatch install response never returns within the
  15 s socket timeout; the install proceeds and dropbear is up by the next 5 s
  check. Don't "fix" it (§7.2).
- **The re-arm restarts SystemUI on every cold boot** (bind-mount lane):
  measured ordering — SystemUI starts ~+4 s, the postinst re-arm runs ~+30 s
  (§7.2). The restart kills the resumed Live TV session; that is why the
  shadow lane is primary.
- **Re-arm audit trail:** `/APPS/.re_sshd/installer_log.txt` (the whole
  postinst's output, overwritten each run) — `mounted:` / `already mounted:` /
  `stale umount:` / `MOUNT FAILED:` lines; `/APPS/.re_sshd/boot_marker.txt`
  carries the ISO-timestamped `re_sshd` arm attempts (§7.2).
- **`setsid` must be `busybox setsid`.** There is no standalone `setsid` binary
  on the PATH; a bare `setsid` fails. Always invoke the busybox applet.
- **`pkill` does not exist** (only `kill` + `pidof`). Restart SystemUI with
  `kill $(pidof SystemUI)` and wait for it to die before relaunching —
  `startgui.sh` bails if the old engine is still up (§7.2).
- **superwatch socket is caller-restricted.** A non-uid-314 caller (e.g. a
  root-launched `phoenix`) gets `605` = `command unauthorized 0 acess`. Re-arm is
  reboot-only, not a live socket command (§7.2).
- **SystemUI caches i18n in memory.** After editing a bundle file (shadow or
  staged), restart SystemUI (or reboot) — the running process does not re-read
  the JSON.
- **Storage filename has `==`** (starboard) — quote/glob carefully (that is the
  *layout* storage, not the bundle).
- **Minimal busybox** — `tr`/`sed -i` are not always present; pull files locally,
  edit, push back.
- **Full-filesystem greps freeze the TV** — search the specific bundle files, not
  `/`.
- **One agent per TV** — check `/var/local` before overwriting; another session
  may be working the same TV.

## 10. Worked example (English)

**Writable path** — relabel the live-TV "Sleep Timer" (operationui, rw):

1. Pull: `scp root@TV:/APPS/pkgs/tv.vidaa.app.operationui/CHA/language/{keys.json,language_eng.json} /tmp/`
2. Find the value `Sleep Timer` → index N → `keys.json[N]` = `ACF1357`.
3. Edit `language_eng.json[N]` → `Sleep Timer (auto-off)`.
4. On the TV: `cp $L/language_eng.json $L/language_eng.json.bak`, then push the
   edited file to `$L/language_eng.json`.
5. Restart SystemUI (or reboot). Verify on the TV.
6. **Persists across reboot** (it is on `/APPS`) — no re-arm needed.

**Read-only path** — relabel `OT0185` "Programme Guide Auto Update" (system-ui, ro):

1. Ensure the shadow exists (§5.2): `cp -a /opt/pkgs/tv.vidaa.app.ui /APPS/pkgs/`
   (skip if `/APPS/pkgs/tv.vidaa.app.ui` is already there).
2. Pull `keys.json` + `language_eng.json` from the shadow's system-ui bundle.
3. Find `Programme Guide Auto Update` → index N → `OT0185`.
4. Edit the value, push the file back into the shadow, then `chown 305:909` +
   `chmod 640` it (§5.2 ownership trap).
5. Restart SystemUI (or reboot — a reboot also preserves the TV's startup
   state). Verify.
6. **Boot-persistent natively** — the shadow is on `/APPS` and is loaded at
   first launch every boot (§7.1). No re-arm, no boot-time restart.
