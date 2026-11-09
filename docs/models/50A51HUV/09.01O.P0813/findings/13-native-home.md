# Native Home installed (operation-ui Launcher component)

**2026-11-09, owner-authorized, LAN-local.** The Free My TV native Home now
replaces the stock Home on the 50A51HUV. This is a component swap inside the
writable `operation-ui` module, not a SystemUI or root-page replacement. Stock
UI lifecycle, other routes, key dispatch, toasts and vendor services are
retained. Every change has a tested teardown path.

This is the **third** model with lane 3 working, and the first on the **generic**
SDK contract rather than a per-build port.

## Preconditions checked before overwriting anything

- `git log`: clean tree apart from the gitignored `firmware/` working copy, no
  other session mid-install.
- `/var/local`: the bridge and the canvas launcher were already live
  (`/var/local/alvidaa/`), so the native state lives in its own directory,
  `/var/local/alvidaa/native-home/`. No `/var/local/otaTest*` collision.
- OTA already frozen: `/OAD/AppUpgradeSwitch.json` has `upgradeFlag: "0"` for
  CAN, and `/OAD/pkgs/{download,backup}` hold no staged package. No OTA
  endpoints were poked.
- Stock baseline pinned and verified on both sides:
  - `/APPS/channelA/operation-ui/apps/launcher/js/app.js`
  - size `293317`, owner `305:305`, mode `0755`
  - md5 `2f175841081b9c20efd03c0c38b5b839`
  - sha256 `dc9836fed00d02a2b7399fd3b3daeba1f7d324a47431ccfa1a551ac5487ac01e`
  - private copy: `firmware/50a51huv/operationui/apps/launcher/js/app.js`
- Root SSH on `<tv-ip>:2222` with `server/keys/tv_root_ed25519`. No reboot was
  performed during this test.

## Architecture — and how it differs from the other two models

`hisenseUI` (`/opt/hisenseUI/bin/hisenseUI`, uid 311) is launched by
`/opt/hisenseUI/startgui.sh` with `--url=file:///hisenseUI/index.html`. The
writable UI module is **`/APPS/channelA/operation-ui/`** — not
`/APPS/pkgs/tv.vidaa.app.operationui/CHA/` as on the 75U8QTUK, and not the
`hisenseUI` tree that failed on the 55A7KAU.

`app.js` ends with
`(self._V_M_=self._V_M_||{}).launcher=()=>i("taIK").Z`, the same shape as the
75U8QTUK (`740m` there). The appended wrapper replaces **only**
`route[0].component` for `/Launcher`. `beforeEnter` guards, `meta.sourceInfo`,
the other routes, vendor key dispatch and toast/bui services are untouched.

### SDK contracts on this build: the generic set

| Concern | This build (`09.01O`) | 75U8QTUK (`09.60I`) |
|---|---|---|
| App list | `getCurrentShowApps("Launcher")` | `getAppList({sceneCode:"launcher"})` |
| Availability | `getAppInfoByAppId` | `getAppInfo({checkRange:1})` |
| Inputs | `getAllInputsData` | same |
| Input switch | `changeSourceTo` | same |
| Settings | `open("settings",{vk:"T"})` | `open("settings")`, no `vk` |
| App launch | `sdk.apc.start` + `CMDMETHOD.REMOTECONTROL` | `LAUNCHER_RECOMMEND` (`"52"`) |

So the **generic** `native-platform.js` is the correct adapter here; the
75U8QTUK port would be wrong on this unit. That is the whole per-model story in
one table: the mechanism is identical, the contracts are not.

## Two traps this build has that the 75U8QTUK does not

1. **APM supervises the launcher.** `/usr/local/etc/apm/application-config-na-sa.ini`
   has `[launcher] process_name = hisenseUI`, `isKeepAlive = true`,
   `restore_time_when_crash = 10`. But it restores on a **crash**, not after a
   clean `SIGTERM` — a deliberate stop is treated as intentional. So the
   restart still goes through `secure_exec hisenseUI /opt/hisenseUI/startgui.sh`,
   exactly as on the 75U8QTUK. Do not wait for APM after a kill.
2. **`pidof hisenseUI` is unreliable.** It also catches a short-lived child, so
   the first dry run captured the env of pid 5023, signalled it, and then
   correctly refused to continue because the real engine (352) was still alive.
   Match on `/proc/<pid>/exe` instead. This is why the dry gate exists.

Two smaller ones:

- **The bridge watcher fights the native Home.** With `watcher.enabled: true`
  the bridge bounces the TV to the canvas page whenever it sees the VIDAA home,
  which hides the native Home within a second. Set `watcher.enabled: false` for
  the test (`config.json` is re-read on every call, no restart needed) and put
  it back afterwards.
- **The HAL screenshot is black while the engine restarts.** `/usr/local/bin/screenshot`
  returned an 8 KB near-black frame during the restart and a 159 KB real frame
  once the engine settled. A black capture is not proof of a black screen.
  `--remote_debugging_port=9666` and `--webdriver_port=4445` are passed to the
  engine but **no listener is opened** on this build, so there is no DevTools or
  WebDriver verification lane. Owner eyes are the verification.

## Install

`tools/launcher-host/switch-home-50a51huv.sh`, same shape as the 75U8QTUK
script and run detached through `/bin/sh` (`/var/local` is `seclabel`, so a
direct shebang exec fails):

```
/bin/sh -c 'trap "" HUP; exec /bin/sh /var/local/alvidaa/native-home/switch-home.sh MODE' \
  >/dev/null 2>&1 </dev/null &
```

`MODE=dry` restarts stock-only as the gate. `MODE=install` verifies hashes,
kills the engine, stages the candidate, `chown 305:305` / `chmod 0755`, `mv -f`,
moves `compiled_js` and `uncompiled_js` into the backup and recreates them
`311:311` / `0751`, then restarts. `MODE=rollback` reverses all of it.

Candidate: `315765` bytes, md5 `eba638da2ee81a9f9d4177598881b25b`, built from
the pinned stock bundle plus `native-platform.js`, `free-my-tv-native.js` and
`native-entry.js`.

## Verification

- **Owner-confirmed: the Free My TV Home is live.** Clock, shelf and top nav,
  not the stock VIDAA home.
- `app.js` is `315765` bytes, md5 `eba638da…`, owner `305:305`, mode `0755`.
- `compiled_js` holds fresh entries written at install time, proving the new
  bundle was compiled rather than served from a stale cache.
- Engine restarted `12567 → 15010`, `PPid 1`, uid/gid unchanged, stable after
  the restart.
- Dry run before install: engine `7327 → 12567`, stock file untouched.

Not yet exercised on this unit: **Inputs**, **TV Settings** and **app launch**.
Those are the three paths that actually prove the platform adapter, so they are
the next thing to confirm.

## Our own variant, same build

After Free My TV was confirmed live, the alvidaa design was switched in with
`MODE=switch` (same swap, keeps the stock backup and the original cache backup
so rollback still works).

- Candidate `322294` bytes, md5 `df541eb3484ccff7378ce0be133f9612`, built from
  the same pinned stock plus `native-platform.js`, `native-alvidaa.js` and
  `native-entry.js`.
- Engine restarted `15010 → 17383`, `PPid 1`, stable.
- Fresh `compiled_js` entries at install time, so the new bundle compiled.
- **Rendering verified objectively** from the HAL frame, since the build has no
  DevTools/WebDriver lane: white clock text in the top-left region, nothing in
  the regions where Free My TV puts its clock and top nav, and tile edges at
  x = 112, 456, 800, 1144, 1488 (320 px wide, 24 px gaps) — the dock geometry
  as coded. The big label measured `#64748b`, the no-signal colour, which is
  correct with no HDMI source live.
- Action paths (input switch, apps overlay, Settings) still to be exercised.

The two variants are interchangeable on this build because they share the
platform adapter and the entry. Only the component file changes, which is the
shape the variant picker should preserve.

## Teardown / rollback

```
/bin/sh -c 'trap "" HUP; exec /bin/sh /var/local/alvidaa/native-home/switch-home.sh rollback'
```

restores `app.js` with `305:305` / `0755`, restores both original JS-cache
directories, and restarts the engine with the captured vendor environment.
Backups live in `/var/local/alvidaa/native-home/backup/` and, privately, in
`firmware/50a51huv/`.

## Ground rules honoured

- Owner's own TV, LAN-local, no DRM circumvention, no OTA writes.
- `/` stays read-only with dm-verity green; only `/APPS` (writable module) and
  `/var/local` were written.
- One MQTT server per TV: the existing bridge session was left alone.
- Vendor bundle and screenshots stay in gitignored `firmware/50a51huv/`.
