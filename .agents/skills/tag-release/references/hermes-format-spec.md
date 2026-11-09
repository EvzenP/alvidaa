# Hermes "Hearth" Release Notes Specification

The Hermes "Hearth" release format is an engineering-grade, human-centered changelog pattern designed for complex systems projects. It combines mythic/poetic thematic naming with rigorous, high-density technical accounting.

---

## 1. Philosophical Anatomy

### Thematic Dedication vs Mechanical Listing
Traditional release notes fall into two traps: dry commit lists that obscure the architecture, or vague marketing summaries that hide breaking changes. The Hearth format bridges both:
1. **Thematic Narrative**: Every major or minor release receives a named identity (e.g., *The Hearth Release*, *The Three Lanes Release*). A short 1–2 paragraph prose dedication connects the milestone to the project's evolution.
2. **Dense Accounting**: Exact metrics (commits, PRs, lines changed, active contributors) precede the prose.
3. **Layered Disclosure**: Highlights → Upgrade Warnings → Subsystem Deep Dives → Fixes → Contributor Roster.

---

## 2. Structural Requirements

### 1. Header & Metric Block
```markdown
<project> <version> — <Title> Latest
@<author> <author> released this <relative_time>
Immutable release. Only release title and notes can be modified.
<version>
<short_hash>
<project> <version>

Release Date: <Month Day, Year>
Since <prev_version>: ~<N> commits · ~<P> merged PRs · <F> files changed · ~<ins> insertions · ~<del> deletions · <C> contributors
```

### 2. Highlights (`✨ Highlights`)
- Limit to 6–10 defining achievements.
- Structure each entry with a bold headline, followed by an em-dash, a concise paragraph, and explicit issue/PR/contributor attributions:
  `**Feature Title** — Concise mechanical description explaining what was built, why it matters, and where it runs. (#PR — @author)`

### 3. Upgrade Notes (`⚠️ Upgrade notes`)
- Highlight breaking changes, deprecated scripts, or architectural migrations.
- Always restate project safety invariants (e.g., verified boot boundaries, read-only partitions, secret redactions).

### 4. Subsystem Breakdown
Group features into logical modules using descriptive emoji headers:
- `📺 Launcher, Native UI & Display Lanes`
- `🧠 Research, Exploits & Root Chains`
- `🔌 Bridge, Daemons & RemoteNow Protocol`
- `🛡️ Security, Disclosure & Privacy`
- `🛠️ Developer Tooling, CI & Integrity`

### 5. Notable Bug Fixes (`🐛 Notable Bug Fixes`)
- Discrete, impactful fixes for race conditions, leaks, edge cases, and hardware traps.
- Attribute author and issue/PR or commit hash.

### 6. Contributor Roster (`👥 Contributors`)
Split contributors into tiers to acknowledge differing levels of commitment:
- **Core Team**: Named engineers with commit/PR metrics and focus areas.
- **Top Community Contributors**: High-impact authors with specific technical domains.
- **Community Researchers & Reporters**: Triagers, bug reporters, and hardware testers.

### 7. Full Changelog
Link the git tag diff comparison:
`Full Changelog: <prev_tag>...<curr_tag>`
