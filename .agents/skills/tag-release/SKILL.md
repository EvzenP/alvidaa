---
name: tag-release
description: Tag new releases for alvidaa and draft canonical release notes in the Hermes "Hearth" release format. Use whenever preparing a new release, tagging a version in git, compiling changelogs from git history and inventory.json, or rolling up merged PRs, community reports, and architectural milestones.
---

# Tagging a Release (`tag-release`)

This skill documents the complete, rigorous procedure for compiling release
notes, executing pre-flight integrity verification, and cutting an annotated git
tag for `alvidaa` following the poetic, high-density **Hermes "Hearth"**
release format.

---

## Skill Architecture

```text
.agents/skills/tag-release/
├── SKILL.md                                 # This workflow guide
├── scripts/
│   ├── gather_metrics.py                    # Automated git diff/PR/author metrics & bucketing
│   └── verify_release.sh                    # Pre-flight repo health, AST & sanitizer verification
├── resources/
│   └── release-template.md                  # Boilerplate Markdown release notes template
├── examples/
│   └── v2.0-hearth-release.md               # Canonical reference release notes for v2.0
└── references/
    ├── hermes-format-spec.md                # Specification of the Hermes "Hearth" changelog format
    └── alvidaa-safety-invariants.md         # Ethical and technical safety boundaries (boot, secrets)
```

---

## 1. Pre-flight Verification Gate

A release tag is an immutable checkpoint. Never tag a dirty, broken, or unverified tree.

Execute the automated verification runner:

```sh
./.agents/skills/tag-release/scripts/verify_release.sh
```

This runs three strict verification stages:
1. **Working Tree Cleanliness**: Ensures no uncommitted or untracked changes exist (`git status --porcelain`).
2. **Repository Integrity Suite (`scripts/check.sh`)**:
   - Generated tables match `docs/research/inventory.json` and `docs/research/exploits.json`.
   - Every tracked Python file passes `ast.parse`.
   - Every tracked Shell script passes `bash -n`.
   - All relative Markdown links resolve to real files on disk.
   - All model guides are indexed in `docs/models/README.md`.
   - Capability status vocabulary is strictly enforced repo-wide (`working | gated | closed | open | armed | achieved | blocked | untested | n-a`).
3. **Secret & PII Sanitizer (`tools/sanitize/scan.py`)**:
   - Zero committed private keys, certificates, device serials, MAC addresses, or raw RFC 1918 LAN IPs.

> [!CRITICAL]
> If any check fails, do not proceed with tagging. Resolve the failures, commit the fix, and re-run `./scripts/check.sh`.

---

## 2. Extract Release Metrics & Categorize Commits

Run the metric collection script against the previous tag:

```sh
python3 .agents/skills/tag-release/scripts/gather_metrics.py --prev v1.0 --head HEAD
```

The script automatically computes:
- Exact commit count (`git rev-list --count <prev>..HEAD`).
- Merged pull requests and issue citations extracted from squash headers and merge commits.
- File diff statistics (`files changed`, `insertions`, `deletions`).
- Deduplicated list of git authors and contributors.
- Initial classification of commits into subsystem lanes (`Launcher & UI`, `Research & Root`, `Bridge & Protocol`, `Security & Sanitization`, `Tooling & CI`, `Bug Fixes`).

---

## 3. Draft Release Notes in the Hermes "Hearth" Format

Copy the template from [`resources/release-template.md`](./resources/release-template.md) or review the reference release [`examples/v2.0-hearth-release.md`](./examples/v2.0-hearth-release.md).

For deep structural criteria, consult [`references/hermes-format-spec.md`](./references/hermes-format-spec.md).

### Required Document Sections

1. **Header & Metadata Block**:
   - Project name, version, and poetic release title.
   - Immutability disclaimer and commit SHA link.
   - Release date and precise metric summary.
2. **Thematic Dedication Narrative**:
   - 1–2 paragraphs framing the conceptual transition from the previous release to the present milestone (e.g. from single-device prototype to multi-lane living room).
3. **✨ Highlights**:
   - 6–10 major breakthroughs with bold titles, concise mechanical summaries, and contributor/@mention citations.
4. **⚠️ Upgrade Notes**:
   - Breaking path migrations, schema updates, and non-negotiable safety rules ([`references/alvidaa-safety-invariants.md`](./references/alvidaa-safety-invariants.md)).
5. **Subsystem Breakdowns**:
   - `📺 Launcher, Native UI & Display Lanes`
   - `🧠 Research, Exploits & Root Chains`
   - `🔌 Bridge, Daemons & RemoteNow Protocol`
   - `🛡️ Security, Disclosure & Privacy`
   - `🛠️ Developer Tooling, CI & Integrity`
6. **🐛 Notable Bug Fixes**:
   - Discrete operational and kernel-level fixes with PR/commit links.
7. **👥 Contributors**:
   - Tiered breakdown: Core Team, Major Contributors, and Community Researchers.
8. **Full Changelog**:
   - Direct GitHub comparison link (`<prev>...<curr>`).

---

## 4. Git Tagging & Publication

Once the release notes are drafted and verified:

```sh
# 1. Stage and commit any release documentation or tooling changes
git add .
git commit -m "release: v2.0 — The Three Lanes Release notes and tooling"

# 2. Run final pre-flight verification
./scripts/check.sh

# 3. Create the annotated git tag
git tag -a v2.0 -m "alvidaa v2.0 — The Three Lanes Release

Lane 3 native launcher inside the vendor engine, on-TV Go bridge daemon,
16 model guides across 5 SoC architectures, automated zero-leak
sanitization, and verified boot-safe teardowns."

# 4. Verify tag creation
git tag -n99 -l v2.0
git show v2.0 --stat
```

---

## 5. Safety Guardrails

- **Immutable Releases**: Never modify or force-push an existing release tag.
- **Verified Boot Invariant**: All modifications stay on volatile storage or `/var/local`. Verified boot must remain locked and green.
- **Teardown Paths**: Every feature must provide an uninstallation or rollback mechanism.
- **Zero Secrets**: Release announcements must never contain private keys, certificates, or unsanitized network identifiers.
