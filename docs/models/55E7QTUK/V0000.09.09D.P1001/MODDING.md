# 55E7QTUK (internal 55E70QEVS_0002) V0000.09.09D.P1001 — modding notes

> **Status (2026-11-09): measured on the contributor's own TV.** The lab
> notebook is [`README.md`](README.md) and the claim ledger is
> [`EVIDENCE.md`](EVIDENCE.md). This page holds only the *operational* deltas:
> the constants that differ from the sibling guides, the traps that cost a
> boot, and where the in-repo pages and tools for this unit live.

## Where this fits

Same **`09.09` OS branch** as the 55A7KAU guide, but a different P-code letter
(`P1001` vs `P1015`) and a different SoC (`MTK9603` vs `MTK9602`). The chain
itself is the 100U7Q / 75UR9S / 55A7KAU superwatch family with `09.09`
constants measured on this unit — read the parent guides first, then this
page's deltas:

- Chain, wire, gauntlet, and the `re_sshd` persistence pattern:
  [55A7KAU README](../../55A7KAU/V0000.09.09O.P1015/README.md) ·
  [MODDING](../../55A7KAU/V0000.09.09O.P1015/MODDING.md) (same OS branch,
  nearest neighbour)
- Package/socket semantics and the installer handoff:
  [100U7Q README](../../100U7Q/V0000.09.60I.Q0813/README.md)
- Same superwatch family, different persistence history:
  [75UR9S README](../../75UR9S/V0000.09.60W.Q0624/README.md)
- Origin of the `otaTest.sh` / `rc.local` hook primitive that this branch
  blocks: [50A51HUV README](../../50A51HUV/09.01O.P0813/README.md)

## Measured state on this unit

| Item | This branch | Source |
|---|---|---|
| Pairing | `VidaaAppAndroidV01` client cert + `modern` profile + **colon-formatted `macWifi`**; the descriptor's `mac=` (ethernet) is the wrong NIC on this wireless unit — wrong MAC gives `rc=135` on all four profiles | [findings/00](findings/00-fingerprint.md) |
| `transport_protocol` | `3290`, published only in the `:18400` renderer blob (`:3366/dd.xml` is a stub); legacy `:1195` dead; `:9009` loopback-only | [findings/00](findings/00-fingerprint.md) |
| File bridge base | `/APPS/`; absolute paths join (`/APPS//etc/passwd`), one `../` escapes to `/`, dirs are `EISDIR`; the resolved path leaks in the `errno` object | [findings/02](findings/02-recon-ladder.md) |
| `fileWrite` gate | **open** — `mode 6` into the base returns `ret:true`. First 2024-generation unit in the matrix where this lane is verified; the 43A5LE `503` appconfig gate does not apply on this branch | [findings/01](findings/01-launcher-install.md) |
| Page host | phoenix **uid/gid 314** (no passwd row), groups include `616` (superwatch) + `713`, `CapEff 0`; **the phoenix binary itself lives under `/APPS`**, not `/opt` | [findings/03](findings/03-recon-v3-v4.md) |
| Superwatch ids | **install `53` / uninstall `54`** (`85` → `604`); framing is `4-byte LE length + payload`, e.g. `<sid>:53:<sid>;/APPS/installer.ipk;re.installer;` | [findings/05](findings/05-root-ssh.md) |
| Install result channel | `/tmp/ipk_install_result` is written **only on failure**; success leaves it empty — poll `/APPS/.re_sshd/installer_log.txt` | [findings/05](findings/05-root-ssh.md) |
| `opkg` | package `Architecture` must be **`mtk9603`** (builder default `mtk9655` → "incompatible architecture"); `opkg install` from a dropbear shell needs `LD_LIBRARY_PATH=/usr/local/lib` (vendored `libarchive.so.13`) | [findings/09](findings/09-device-dns-resolver.md) |
| Static binaries | **32-bit ARM (EABI5)**. An aarch64 static-PIE binary dies with `cannot execute binary file` (ENOEXEC) — despite the 64-bit-looking kernel lineage | [findings/05](findings/05-root-ssh.md) |
| Dropbear 2026.94 | keys-only on `0.0.0.0:8008` via `-D <authorized_keys dir>`; **`DROPBEAR_SVR_MULTIUSER` must stay `1`** — a second `./configure` regenerates `localoptions.h` and silently reverts the patch | [findings/05](findings/05-root-ssh.md) |
| Pre-root boot hook | the lane exists at **`/etc/rc.d/rc.local`** (not `/etc/rc.local`) with the reference unit's `otaTest.sh` stanza, but **SELinux enforces through boot** (`init_selinux.rc` calls `setenforce 1` in both branches) — the hook is written and inert | [findings/03](findings/03-recon-v3-v4.md), [findings/04](findings/04-selinux-and-hook.md) |
| euladpp untar lane | **absent** on this branch — `euladpp-init-check` is not in the init tree, so the reference arming condition cannot fire; recorded `n-a` rather than untested | [findings/07](findings/07-os-map-alternate-avenues.md) |
| Boot persistence | `re_sshd` two-file service + 4th `serviceList.json` entry (`autoStart:true`, `isKeepAlive:false`), `314:314` `640`; cold-boot verified by kernel sysrq restart (no PC in the loop) | [findings/06](findings/06-boot-persistence.md) |
| OTA + ads | one boot-timed postinst does OTA freeze first, then the adsfw block, then the DNS resolver, then dropbear — 15 OUTPUT REJECTs (3 freeze + 12 ad) measured inside the first minute of a cold boot | [findings/05](findings/05-root-ssh.md), [findings/08](findings/08-ad-removal.md) |
| Device DNS | dnsmasq 2.91 static armv7 over loopback, **lane W** (`/etc/resolv.conf` symlink → rw `/var/local/etc`), NXDOMAIN for the ad families; no nat rules needed. This static build refuses `--daemon`, so it runs `--no-daemon &` | [findings/09](findings/09-device-dns-resolver.md) |
| Verified boot | `androidboot.verifiedbootstate=green`; only `/APPS` and `/var/local` written | [findings/07](findings/07-os-map-alternate-avenues.md) |

## Traps that cost a boot

- **Reboot recipe.** `/sbin/reboot` and `reboot -f` darken the network stack
  on this branch, and `/run/initctl` is `Permission denied` even as root under
  SELinux. The working routes are a kernel **sysrq** restart (findings 06) or
  an owner **mains cycle** (findings 08, 09). A clean remote reboot recipe is
  still **unverified** here.
- **`serviceList.json` edits must be whole-file.** Regenerating the entry with
  `grep -v` + `printf` produced a malformed file; deliver a fully-formed,
  base64-carried document instead. A pristine copy is kept at
  `/APPS/.re_sshd/serviceList.json.pristine`.
- **Don't trust the service's own markers after a boot.**
  `/tmp/re_sshd_boot.log` and `/APPS/.re_sshd/boot_marker.txt` came back
  absent/empty even when the arm succeeded (the uid-314 service swallows its
  `log()` failures). Verify instead on: fresh dropbear pid, fresh
  `installer_log.txt` mtime, live freeze rules.
- **Never read the dropbear pidfile from the page lane** — it is unreadable to
  uid 314. The service detects a running daemon through
  `/proc/net/tcp` `:1F48 LISTEN`.
- **Rapid synchronous `fileRead` bursts jam the hiutils bridge** (shared trap
  with `09.09O`): one call per tick, then stir.
- **Every-boot coverage is not currently reliable.** On 2026-11-09 the
  serviceList service loaded but `start()` never ran and superwatch `53`/`54`
  answered `34:0`/`35:0` without executing the install. Recovery without SSH:
  boot until the network is up (owner mains cycle), then re-trigger the arm
  page — the chain completes on its own. Full failure-state table and playbook
  in [findings/09](findings/09-device-dns-resolver.md).
- **Tool arch, aligned 2026-11-09 (build still unverified):**
  [`tools/e7qtuk/dropbear-build.sh`](../../../../tools/e7qtuk/dropbear-build.sh)
  used to cross-build `aarch64-linux-musl` while this guide's measured gauntlet
  says the aarch64 build gets ENOEXEC and the **EABI5 armv7** build runs
  ([findings/05](findings/05-root-ssh.md)). Its default target is now
  `arm-linux-musleabihf` — the triple that produced the static resolver
  binaries measured working on this unit — and it asserts the ELF machine
  (`ARM`) before staging, so a wrong-arch build fails on the host instead of on
  the TV. Override with `DROPBEAR_TARGET=aarch64-linux-musl` for a set-top box.
  The contributor's working armv7 binary was never republished, so treat the
  first build as a calibration run.

## Pages and tools on this unit

| Path | What |
|---|---|
| [`source/`](source/) | the phase-3 pages for this unit (`phase3-arm*.html`, `phase3-dbe*.html`, `phase3-diag*.html`, `phase3-superprobe.html`, `selprobe.html`, `recon-e7qtuk-hook.html`, `hookrearm-e7qtuk.html`) — 41 files, evidence only, not a drop-in lane |
| `launcher/recon-e7qtuk*.html`, `launcher/hook{install,swap}-e7qtuk.html` | recon ladder and hook experiments, left in `launcher/` because they are served from there |
| `launcher/selfinstall.html` | the reversible launcher landing point (server-side) |
| [`tools/e7qtuk/dropbear-build.sh`](../../../../tools/e7qtuk/dropbear-build.sh) | per-model dropbear cross-build (armv7 default; asserts the ELF machine) |
| [`tools/u7q/scripts/make_min_installer.py`](../../../../tools/u7q/scripts/make_min_installer.py) | shared IPK builder carrying this unit's `dns` and `adsfw` stages (`re.installer` 1.0.4) |
| [`tools/u7q/scripts/build_dnsmasq.sh`](../../../../tools/u7q/scripts/build_dnsmasq.sh) | zig crossbuild for the static armv7 resolver |
| [`tools/u7q/web/`](../../../../tools/u7q/web/) | `install.html` / `trigger.html` / `rearm.html` + local server for the page lane |

## Boundary

No private keys, tokens, serials, MACs, Device IDs or vendor binaries in this
repo; the IPK builder is source-only and binaries are assembled per the
published recipe. Drop points stay gitignored (`tools/*/bin/`,
`tools/*/web/pub/`). Teardown for all three layers — launcher, root, boot
persistence — is in [`README.md`](README.md#teardown), and the residual state
left by a partial teardown is called out there too.
