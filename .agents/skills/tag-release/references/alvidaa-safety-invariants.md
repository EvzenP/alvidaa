# alvidaa Safety & Release Invariants

Every release of `alvidaa` must strictly preserve the core architectural and ethical invariants established during initial research.

---

## 1. Verified Boot Stays Green

- **Read-Only Partition Protection**: We never mount `/`, `/system`, `/vendor`, or `/product` as read-write, nor flash custom partitions.
- **OTA Staging Isolation**: Never write to `/OAD` staging directories.
- **Volatile & Local Execution**: All persistent assets reside exclusively within writable user data mounts (such as `/var/local`) that can be cleared by a factory reset.

---

## 2. Reversibility & Teardown Paths

Every capability introduced in a release must have an explicit, documented rollback procedure:
- Root hooks maintain rolling backups (e.g., `/var/local/otaTest.v1.bak`).
- Launcher route swaps inside the vendor engine must restore stock routing simply by unlinking `/var/local/native-entry.js` or reverting `config.json`.
- Dropping or disabling the local bridge daemon must return the TV to default standby state without hanging the browser.

---

## 3. Zero-Secret & Privacy Policy

- **No Device Credentials**: Client certificates (`client_mobile_android.p12`), generated private keys (`vidaa_key.pem`), and device pairing tokens must never be committed to git.
- **Identifier Redaction**: Serial numbers, MAC addresses, ESNs, and real RFC 1918 private LAN IP addresses must be scrubbed before committing documentation or test outputs.
- **Automated Verification**: Releases must be verified against `tools/sanitize/scan.py` with `tools/sanitize/rules.toml`.

