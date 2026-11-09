# 55E7QTUK V0000.09.09D.P1001 — evidence ledger

Label grammar is defined in
[`docs/models/README.md`](../../README.md#how-to-read-the-labels). Nothing on
this page is a recipe; every row is a labelled claim with its basis. The lab
notebook is [`README.md`](README.md), the operational deltas are
[`MODDING.md`](MODDING.md).

The record is one session on the contributor's own TV (2026-11-08), extended
on 2026-11-09 by the DNS-resolver work and its failure states. Rows superseded
by a later date are kept with both dates, so the sequence survives.

## Fingerprint and pairing (findings 00)

| Claim | Label | Evidence | Source |
|---|---|---|---|
| Firmware id is **`V0000.09.09D.P1001`** | CONFIRMED live (recorded) | `Hisense_GetFirmWareVersion()`; UA carries the same string: `Model/VIDAA-MTK9603 … MTK9603/V0000.09.09D.P1001` | [findings/00](findings/00-fingerprint.md) |
| SoC is **MTK9603**, OS **U09.09**, browser **Chromium 111 "odin"** (`Odin/111.5563.5.1`, api 3.0.1) | CONFIRMED live (recorded) | `Hisense_GetChipSetName()` plus the browser-env readout and `navigator.userAgent` | [findings/00](findings/00-fingerprint.md) |
| Internal model **`55E70QEVS_0002`**, serial type **`55E7QE`** | CONFIRMED live (recorded) | `GetModelName()` / `GetSerialType()`; UPnP `modelName` = `55E7QE` | [findings/00](findings/00-fingerprint.md) |
| `transport_protocol=3290` (2024 generation) | CONFIRMED live (recorded) | `:18400/MediaServer/rendererdevicedesc.xml` blob (`transport_protocol`, `macWifi=`, `region=0`, `platform=1`); `:3366/dd.xml` is a `tvdevice` stub with no blob | [findings/00](findings/00-fingerprint.md) |
| LAN surface is exactly `:3366` + `:18400` + `:36669`; legacy `:1195` dead, `:9009` loopback-only | CONFIRMED live (recorded) | curated port sweep; `:1195` closed on timeout | [findings/00](findings/00-fingerprint.md) |
| Broker pins the **client-cert CA at the TLS layer** | CONFIRMED live (recorded) | self-signed stub → `tlsv1 alert unknown CA`; genuine `VidaaAppAndroidV01` pair completes | [findings/00](findings/00-fingerprint.md) |
| Pairing matrix: wrong MAC (12-hex **or** colon-formatted ethernet) → `rc=135` on **all four** credential profiles; colon-formatted **`macWifi`** + `modern` pairs | CONFIRMED live (recorded) | `server/pair.py` runs 2026-11-08; PIN → `{"result":1}` → `tokenissuance` with a 2-day access token. The unit is `net_type: wireless` (bridge `GetNetworkInfo()`), which is why the descriptor's `mac=` field is the wrong NIC | [findings/00](findings/00-fingerprint.md) |

## Launcher lane (findings 01–02)

| Claim | Label | Evidence | Source |
|---|---|---|---|
| `websdk/Appinfo.json` did not exist (factory state) | CONFIRMED live (recorded) | `fileRead mode 6` → `ret:false`, `errno:-2 ENOENT` on `/APPS/websdk/Appinfo.json` | [findings/01](findings/01-launcher-install.md) |
| **`fileWrite` mode 6 into the bridge base is open on this branch** | CONFIRMED live (recorded) | first-run create returned `ret:true "success"`; the `503` appconfig gate seen on the 43A5LE (same SoC, `U09.60A`) does not apply here | [findings/01](findings/01-launcher-install.md), [findings/02](findings/02-recon-ladder.md) |
| Tile self-install works end to end | owner-verified | after an owner mains cycle the MQTT applist went **52 → 53** with a `Home` entry and `icon /icon/vidaa-home`; the owner saw the launcher canvas render | [findings/01](findings/01-launcher-install.md) |
| Bridge surface is **75 `Hisense_*` functions + `HiUtils_createRequest`**, no `WebSDK_*` | CONFIRMED live (recorded) | `recon-e7qtuk.html` v1 enumeration | [findings/02](findings/02-recon-ladder.md) |
| Sandbox base **`/APPS/`** leaks through the error object; absolute paths join | CONFIRMED live (recorded) | missing path returns `{"errno":-2,"code":"ENOENT","syscall":"open","path":"/APPS/…"}`; `/etc/passwd` reads back as **`/APPS//etc/passwd`** | [findings/02](findings/02-recon-ladder.md) |
| A single `../` escapes to `/`; extra `../` clamps; directory reads stay listing-free | CONFIRMED live (recorded) | `../etc/passwd` returned real contents; `./` and `../etc` → `EISDIR` | [findings/02](findings/02-recon-ladder.md) |

## Boot chain and the SELinux divergence (findings 03–04)

| Claim | Label | Evidence | Source |
|---|---|---|---|
| The `otaTest` hook lane lives at **`/etc/rc.d/rc.local`** (3219 b) and carries the reference unit's hook stanza | CONFIRMED live (recorded) | read through the bridge: `[ -x /etc/rc.d/rc.local ] && /etc/rc.d/rc.local` in `rcS.utopia.linux`; the file ends with the `chmod +x /var/local/otaTest.sh; /var/local/otaTest.sh &` stanza | [findings/03](findings/03-recon-v3-v4.md) |
| `/etc/rc.local` is **absent** — the 55A7KAU "no rc.local lane" conclusion was path-shaped | CONFIRMED live (recorded) | `ENOENT` on `/etc/rc.local` | [findings/03](findings/03-recon-v3-v4.md) |
| Boot chain shape `rcS` → `rcS.OTA` gate → `rcS.utopia.linux` → `/etc/rc.d/rc.local`; UART getty live | CONFIRMED live (recorded) | dumped init scripts | [findings/03](findings/03-recon-v3-v4.md) |
| **Pre-root hook lane is closed: SELinux enforces through boot** | CONFIRMED live (recorded) | `/etc/init.d/common/init_selinux.rc` calls `setenforce 1` in **both** branches of its `androidboot.selinux=permissive` check; no `setenforce 0` anywhere in the dumped boot chain; post-boot `/sys/fs/selinux/enforce` → `1` | [findings/04](findings/04-selinux-and-hook.md) |
| The hook was really written and really inert | CONFIRMED live (recorded) | `/var/local/otaTest.sh` (4447 b) verified on disk; `proc/boottime` traces `rc.local begin` / `done` on a cold boot (61 s uptime); **zero hook output**; nothing armed on the TV afterwards | [findings/04](findings/04-selinux-and-hook.md) |
| Page host: phoenix **uid/gid 314** (no passwd row), groups include **616** (superwatch) and **713**, `CapEff 0` | CONFIRMED live (recorded) | `../proc/self/status` and `../proc/self/cmdline` | [findings/03](findings/03-recon-v3-v4.md) |
| The phoenix **binary lives under `/APPS`** (inside the writable bridge base) | CONFIRMED live (recorded) | `cmdline`: `/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix … /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/phoenix.server.js` | [findings/03](findings/03-recon-v3-v4.md) |
| `wifitest` runs as **uid 0** in `/etc/passwd` | CONFIRMED live (recorded) | dumped passwd | [findings/03](findings/03-recon-v3-v4.md) |
| **DEAD END:** the 09.01 `rc.local` / `otaTest.sh` hook lane as a pre-root root primitive | DEAD END | executed, verified on disk, never ran — SELinux exec-denial. AV evidence is unreadable pre-root, so the *mechanism* is inferred; the *outcome* is measured | [findings/04](findings/04-selinux-and-hook.md) |

## Root (findings 05)

| Claim | Label | Evidence | Source |
|---|---|---|---|
| Superwatch ids on this branch: **install `53`, uninstall `54`**; `85` replies `604` | CONFIRMED live (recorded) | wire framing `4-byte LE length + payload`; `85` is 09.60's read-only `getdirusage`, renumbered away in 09.09 as the 55A7KAU record found | [findings/05](findings/05-root-ssh.md) |
| `postinst` executes as **uid 0** with full capabilities | CONFIRMED live (recorded) | installer log: `Uid: 0 0 0 0`, `CapEff: 000001ffffffffff` | [findings/05](findings/05-root-ssh.md) |
| Key-only dropbear 2026.94 (own static ARMv7 build) on `0.0.0.0:8008`, uid-0 session with PTY | CONFIRMED live (recorded) | `ssh -p 8008 root@<tv-ip>` → `ROOT-OK`, `Uid 0`, `CapEff 000001ffffffffff`; `-D` authorized_keys dir set, `pid=5698` at the end of the session | [findings/05](findings/05-root-ssh.md) |
| OTA freeze is the **first act of the postinst** | CONFIRMED live (recorded) | `REJECT 8.8.8.8` + `8.8.4.4` (DoH/DNS hard lane) and `131.189.69.51` (ota-tv / upgrade-plc; shares the CDN host with auth/file-ul — collateral accepted by the owner) | [findings/05](findings/05-root-ssh.md) |
| An IPK's `Architecture` must be **`mtk9603`** | CONFIRMED live (recorded) | `Architecture: mtk9603` is accepted by the device's `opkg`; the builder's default `mtk9655` is rejected `incompatible architecture` (baseline package on the unit: `re.installer 1.0.0` / mtk9603) | [findings/05](findings/05-root-ssh.md), [findings/09](findings/09-device-dns-resolver.md) |
| `/tmp/ipk_install_result` is written **only on failure** | CONFIRMED live (recorded) | failure case recorded as `{"code":400,…,"msg":"ipk file … not exists"}`; success leaves the file empty — poll `/APPS/.re_sshd/installer_log.txt` instead | [findings/05](findings/05-root-ssh.md) |
| **DEAD END:** aarch64 static dropbear on this unit | DEAD END | early exit `cannot execute binary file` (ENOEXEC); the EABI5 armv7 build runs | [findings/05](findings/05-root-ssh.md) |

## Boot persistence (findings 06, 08)

| Claim | Label | Evidence | Source |
|---|---|---|---|
| `re_sshd` service re-arms root SSH at **cold boot**, unattended | CONFIRMED live (recorded) 2026-11-08 | kernel sysrq restart (no PC in the loop): uptime 241 s (fresh boot), fresh dropbear **pid 2479** (a different pid from the pre-boot daemon), `ssh` → `ROOT-OK`, `Uid 0`, `CapEff 000001ffffffffff` | [findings/06](findings/06-boot-persistence.md) |
| Record nit: the pre-reboot dropbear pid is quoted as `5698` in [findings/05](findings/05-root-ssh.md) and as `5969` in [findings/06](findings/06-boot-persistence.md) | UNVERIFIED | the two findings disagree on the pre-boot pid; the post-boot pid (`2479`) and the uid-0 result are not in dispute | [findings/05](findings/05-root-ssh.md), [findings/06](findings/06-boot-persistence.md) |
| Service deployment shape: two-file service + fourth `serviceList.json` entry `{id, autoStart:true, isKeepAlive:false}` | CONFIRMED live (recorded) | root read of `…/tv.vidaa.jsservice.basic/CHA/services/`; owner/mode `314:314` `640` preserved; **pristine copy at `/APPS/.re_sshd/serviceList.json.pristine`** | [findings/06](findings/06-boot-persistence.md) |
| Cold-boot marker files may come back **absent/empty**; verify on fresh pid + fresh `installer_log.txt` mtime + live freeze rules | CONFIRMED live (recorded) | `/tmp/re_sshd_boot.log` and `/APPS/.re_sshd/boot_marker.txt` unreadable as evidence after the boot (the uid-314 service's `log()` swallows the failure) | [findings/06](findings/06-boot-persistence.md) |
| The whole chain rides one boot-timed postinst: OTA freeze + ad block + DNS + dropbear | CONFIRMED live (recorded) 2026-11-08 | owner mains cycle: `uptime 43.94 s`, root session restored, fresh dropbear **pid 2485**, `adsfw.log` boot-native run, kernel plane measured **15 OUTPUT REJECTs** (3 freeze + 12 ad v4) inside the first minute | [findings/08](findings/08-ad-removal.md) |
| Verified boot stayed **green**; writes confined to rw partitions | CONFIRMED live (recorded) | `androidboot.verifiedbootstate=green` read as root; only `/APPS` and `/var/local` written | [findings/07](findings/07-os-map-alternate-avenues.md) |

## OS identity and alternate avenues (findings 07)

| Claim | Label | Evidence | Source |
|---|---|---|---|
| Build family: **Android-platform kernel** (AVB/vbmeta/dm-verity, SELinux, OP-TEE, Android clang/LLD) + **MStar/MTK Utopia Linux userland** — Android-secured, not Android-based | CONFIRMED live (recorded) | kernel cmdline and boot-actor markers, plus marker absence: no `/system`, `/apex`, zygote, `logcat` | [findings/07](findings/07-os-map-alternate-avenues.md) |
| The **euladpp untar lane is absent** on this branch | CONFIRMED live (recorded) | `euladpp-init-check` is not in this build's init tree (no boot-time consumer greps clean in `init.d/{common,merak,mixed,fusion}`); `/APPS/euladpp/current/` holds only `eula_dpp_status.ini(+_bak)`, so the reference arming condition cannot fire. Corrects our own pre-root probe of `/var/local/versionInfo.json` — the path is `/APPS/euladpp/current/versionInfo.json` | [findings/07](findings/07-os-map-alternate-avenues.md) |
| `adbd` is present and boot-enabled but **USB-only** (functionfs gadget, `uid=2000`) | CONFIRMED live (recorded) | `/etc/init.d/common/init_adbd.rc`; no `tcp:` listener flags | [findings/07](findings/07-os-map-alternate-avenues.md) |
| `NewUpdatedIPK.txt` symlink flipper present (`start-kilby.sh:319` → `set_ipk_path.sh`) | UNVERIFIED | present in the vendor scripts; never exercised on this unit — recorded for community pre-root work | [findings/07](findings/07-os-map-alternate-avenues.md) |
| Superwatch per-command authorization matrix | UNVERIFIED | the id→class map is runtime-built; only C++ typenames (`RunIpkInstallCommand`, `RunCheckPkgsUsdCommand`, …) are recoverable from strings on this stripped ARM build. Disassembly is the recorded method option | [findings/07](findings/07-os-map-alternate-avenues.md) |

## Device DNS resolver, and the same-day regression (findings 09)

| Claim | Label | Evidence | Source |
|---|---|---|---|
| dnsmasq 2.91 **static armv7** resolver ships from the `re.installer` postinst and answers **NXDOMAIN** for the ad/telemetry families | CONFIRMED live (recorded) 2026-11-09 | `nslookup rsc-ads… 127.0.0.1` → NXDOMAIN, benign resolve works, dnsmasq pid + log present | [findings/09](findings/09-device-dns-resolver.md) |
| Resolver uses **lane W**: `/etc/resolv.conf` symlink → rw `/var/local/etc`; no iptables required | CONFIRMED live (recorded) | measured state: 15 OUTPUT REJECTs present, **no** nat rules | [findings/09](findings/09-device-dns-resolver.md) |
| Lane B (nat `REDIRECT --to-ports 5353`, with `-m owner --uid-owner 314 -j RETURN` to stay loop-free) exists but is not what this unit runs | CONFIRMED live (recorded) | verified before use, then left unused in favour of lane W | [findings/09](findings/09-device-dns-resolver.md) |
| **Every-boot coverage is not currently reliable.** ServiceList entry loads but `start()` never runs; the `otaTest` hook stays exec-blocked; superwatch `53`/`54` reply `34:0`/`35:0` (accepted) with **no install executing** | CONFIRMED live (recorded) 2026-11-09 | root and page-lane reads: `boot_marker.txt` ENOENT, `installer_log.txt` mtimes, `/APPS/installer.ipk` md5 verified delivered, dropbear never appears, ads back and OTA lane live | [findings/09](findings/09-device-dns-resolver.md) |
| Recovery without SSH: boot to a healthy network (owner mains cycle) and re-trigger the arm page | owner-verified 2026-11-09 15:16 | full chain self-completes: `dns verified via 127.0.0.1 (lane W)` in `dnsfw.log`, NXDOMAIN confirmed, 3 freeze REJECTs, fresh dropbear pid | [findings/09](findings/09-device-dns-resolver.md) |
| Stall cause narrowed: the vendor `opkg` machinery reaches init but not execution — `/tmp/ipk_install_result` was readable through the page lane and **empty** | CONFIRMED live (recorded) | page-lane read of `/tmp/ipk_install_result`; a mains cycle + re-trigger restored it | [findings/09](findings/09-device-dns-resolver.md) |
| The v2 **thin re-arm hook** (v1 archived verbatim) is in place | UNVERIFIED | deployed, not yet observed firing on a cold boot | [findings/09](findings/09-device-dns-resolver.md) |
| A clean **remote** reboot recipe on this branch | UNVERIFIED | `busybox reboot -f` darkens the network stack; `/run/initctl` is `Permission denied` even as root under SELinux; the kernel sysrq restart (and roughly, an owner mains cycle) are the working routes | [findings/06](findings/06-boot-persistence.md), [findings/09](findings/09-device-dns-resolver.md) |

## Open

- `identity_gate` and `devtools_forge` — **UNVERIFIED** on this unit.
- The launcher's second lane (Pi/NAS bridge) — **UNVERIFIED**; only the
  on-TV canvas lane has been run here.
- Ad-host families are enumerated from the unit's own
  `/APPS/domain/domain_list.json` (`ReleaseDate 2026-08-03`); the shared-CDN
  collateral is measured on the reference unit's wiretap and generalized here
  as the documented risk ([findings/08](findings/08-ad-removal.md)).
