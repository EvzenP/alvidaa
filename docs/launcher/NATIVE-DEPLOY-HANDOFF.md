# Handoff — lane-3 native Home parity, and the deploy that did not happen

Session date: 2026-11-09/10. Written for resuming on the m2 Mac. Delete this
file once the deploy is done and the checklist is walked.

## Where things stand

The parity work is **finished, reviewed and on main**. The deploy is **not
done**: the TV never became reachable from the machine the session ran on.

| Item | State |
| --- | --- |
| Parity work (7 tasks) | landed on `main`, pushed to origin |
| `node --test tools/launcher-host/native-alvidaa.test.cjs` | 32 pass, 0 fail |
| `./scripts/check.sh` | exit 0 |
| Deploy to TV | **blocked — TV not on the network** |
| Hardware verification | **not started** (every behaviour is still a claim) |

## What landed

| Commit | Change |
| --- | --- |
| `bdeaebe` | toast HUD replaces the raw status line |
| `0c139ef` | storage-backed preferences: hidden/only apps, custom names, last-used |
| `40c638f` | remote number hotkeys 1–9 and 0 |
| `1b4977c` | pinned favorites row in view 2 |
| `d89eecf` | opt-in auto-switch countdown on boot |
| `eeb96dc` | per-input wallpaper art, two-layer cross-fade |
| `3d914f3` | parity audit table + on-TV verification checklist in `NATIVE-ALVIDAA.md` |

All seven were reviewed at diff level (tests re-run by the supervisor in a
non-`/tmp` worktree), rebased where a later task had landed first, and
fast-forwarded. Nothing was merged on a worker's word.

## Why the deploy stopped

The TV was reported on, but from the session host:

- `192.168.0.11` ARP-fails (the old lease);
- a full `/24` scan found 19 hosts up and **none** listening on dropbear
  `2222`, MQTT `36669`, `8008` or `8770`;
- SSDP `M-SEARCH` got exactly one responder — the router at `192.168.0.1`.

So the TV is on another SSID/VLAN, or its network is down. Nothing else is
blocking: the root key was restored to `server/keys/` (pulled from m2, which
already has it), and the install path was verified against the code.

## The deploy, exactly

Run this on a host that can reach the TV. m2 already holds
`~/repos/alvidaa/server/keys/`, so it is the natural place.

```sh
cd ~/repos/alvidaa
export TV_HOST=<tv-ip>          # Settings -> Network -> Network Information

# 0. the TV must answer, and the lane must be root
./server/tv 'id'                                   # uid=0(root)

# 1. the launcher bundle is operation-ui on this build, NOT hisenseUI
./server/tv 'ls -ld /APPS/channelA/operation-ui/apps/launcher/js'

# 2. pin the stock bundle before touching it
./server/tv 'sha256sum /APPS/channelA/operation-ui/apps/launcher/js/app.js'
# expect 046b41aee0242ced3d3fcd9d5e0c0adb68e17ea3bfe14efa13d6225b6050bfad
# a mismatch means the bundle moved: re-pin, do not build against it

# 3. pull it and build the candidate (output stays in firmware/ or /tmp)
./server/tv 'cat /APPS/channelA/operation-ui/apps/launcher/js/app.js' > firmware/stock-app.js
node tools/launcher-host/build-native-alvidaa.cjs \
  firmware/stock-app.js 046b41aee0242ced3d3fcd9d5e0c0adb68e17ea3bfe14efa13d6225b6050bfad \
  firmware/candidate-alvidaa.js

# 4. the installer requires the on-TV bridge alive at 127.0.0.1:8770
./server/tv 'curl -s http://127.0.0.1:8770/api/debug | head -c 200'
# if it is down, start /var/local/alvidaa/alvidaa-bridge first
# (see docs/launcher/BRIDGE_DEPLOY.md)

# 5. stage the candidate and install (atomic swap, stock backup, cache reset)
scp -P 2222 -i server/keys/tv_root_ed25519 firmware/candidate-alvidaa.js \
  root@$TV_HOST:/var/local/alvidaa/native-home/candidate.js
./server/tv 'LD_LIBRARY_PATH=/lib:/usr/local/lib:/basic/lib /opt/pkgs/tv.vidaa.app.phoenix/bin/phoenix /var/local/alvidaa/native-home/native-home.cjs install /var/local/alvidaa/native-home/candidate.js'

# 6. verify
./server/tv '... /var/local/alvidaa/native-home/native-home.cjs status'
tools/screenshot.sh /tmp/native-home.png
```

Notes that save a debugging round:

- **The watcher is handled.** The install path sets
  `config.watcher.enabled = false` itself (`native-trial.cjs:152`), so issue
  #47's manual `sed` is not needed for this installer.
- **Rollback** is `native-home.cjs restore` on the TV (root, no host argument):
  it restores from the state manifest in `/var/local/alvidaa/native-home/` and
  restarts the engine.
- **Do not** copy the audit's old `hisenseUI/dist/app.js` path — it was wrong
  and is corrected in this handoff's commit.

## Open items

1. **Deploy + walk the checklist** (`NATIVE-ALVIDAA.md`, steps 1–14). Every
   claim there is unverified until observed.
2. **Preferences cannot be set on hardware.** No in-launcher UI, and no
   reachable JS console in the hisenseUI origin on `09.01O.P0813` (port 9666
   is on the cmdline but does not listen). So checklist steps 3, 12 and 13
   cannot be exercised yet, and auto-switch/filtering/custom names/favorites
   all sit at defaults. Recorded as a high-confidence team finding; it wants a
   GitHub issue and a decision: a settings surface, or a supported way to seed
   `sdk.storage`.
3. **Hardware-only gaps the audit already names:** favorites render a star
   glyph rather than the app icon; focusing an input with no art holds the
   outgoing art for 300 ms and then cuts to the wallpaper.

## Team state (this machine)

Team `alvidaa`, ID `b1ce9793-08ea-44a8-bdb0-cd98960c0352`. All seven tasks are
`done`; workers `worker` and `worker2` were stood down. The team store is
session-adjacent — it does not travel to m2, and the board here is history
only. The durable record is this file plus the commits.
