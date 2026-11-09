#!/usr/bin/env python3
"""Gather git statistics and commit details since a given tag for release drafting.

Extracts commit count, PR references, diff stats, author attributions, and
groups commits into subsystem buckets for the Hermes 'Hearth' release format.
"""

import argparse
import re
import subprocess
import sys


def run_git(args: list[str]) -> str:
    """Run a git command and return stripped stdout."""
    res = subprocess.run(["git"] + args, capture_output=True, text=True, check=True)
    return res.stdout.strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract release metrics and commit groups since previous tag."
    )
    parser.add_argument(
        "--prev",
        help="Previous tag to compare against (defaults to most recent tag).",
    )
    parser.add_argument(
        "--head",
        default="HEAD",
        help="Target commit/branch to release (default: HEAD).",
    )
    return parser.parse_args()


def get_previous_tag(target: str) -> str:
    try:
        # Get tag preceding target
        return run_git(["describe", "--tags", "--abbrev=0", f"{target}^"])
    except subprocess.CalledProcessError:
        tags = run_git(["tag", "-l"]).splitlines()
        return tags[-1] if tags else "v1.0"


def main() -> None:
    args = parse_args()
    target = args.head
    prev_tag = args.prev or get_previous_tag(target)

    rev_range = f"{prev_tag}..{target}"

    # Commit count
    commits_raw = run_git(["rev-list", "--count", rev_range])
    commit_count = int(commits_raw) if commits_raw else 0

    # Shortstat
    stat_raw = run_git(["diff", "--shortstat", rev_range])
    # e.g.: "677 files changed, 69024 insertions(+), 1283 deletions(-)"
    files_changed = 0
    insertions = 0
    deletions = 0
    m_files = re.search(r"(\d+)\s+file", stat_raw)
    m_ins = re.search(r"(\d+)\s+insertion", stat_raw)
    m_del = re.search(r"(\d+)\s+deletion", stat_raw)
    if m_files:
        files_changed = int(m_files.group(1))
    if m_ins:
        insertions = int(m_ins.group(1))
    if m_del:
        deletions = int(m_del.group(1))

    # Log entries
    log_raw = run_git(
        ["log", rev_range, "--pretty=format:%h%x09%an%x09%ae%x09%s"]
    ).splitlines()

    authors: set[str] = set()
    prs: set[str] = set()
    commits_by_category: dict[str, list[tuple[str, str, str]]] = {
        "Highlights": [],
        "Launcher & UI": [],
        "Research & Root": [],
        "Bridge & Protocol": [],
        "Security & Sanitization": [],
        "Tooling & CI": [],
        "Bug Fixes": [],
        "General": [],
    }

    pr_pattern = re.compile(r"\(#(\d+)\)|#(\d+)")

    for line in log_raw:
        if not line:
            continue
        parts = line.split("\t", 3)
        if len(parts) < 4:
            continue
        sha, author, email, subject = parts
        authors.add(f"{author} <{email}>")

        for m in pr_pattern.finditer(subject):
            pr_num = m.group(1) or m.group(2)
            prs.add(pr_num)

        subj_lower = subject.lower()
        if "fix" in subj_lower or "bug" in subj_lower or "repair" in subj_lower:
            commits_by_category["Bug Fixes"].append((sha, author, subject))
        elif "lane 3" in subj_lower or "launcher" in subj_lower or "ui" in subj_lower:
            commits_by_category["Launcher & UI"].append((sha, author, subject))
        elif any(k in subj_lower for k in ("root", "recon", "findings", "eval", "dropbear")):
            commits_by_category["Research & Root"].append((sha, author, subject))
        elif any(k in subj_lower for k in ("bridge", "mqtt", "websocket", "ws", "daemon")):
            commits_by_category["Bridge & Protocol"].append((sha, author, subject))
        elif any(k in subj_lower for k in ("sanitize", "security", "psirt", "secret")):
            commits_by_category["Security & Sanitization"].append((sha, author, subject))
        elif any(k in subj_lower for k in ("check", "script", "tool", "ci", "test", "gen-")):
            commits_by_category["Tooling & CI"].append((sha, author, subject))
        else:
            commits_by_category["General"].append((sha, author, subject))

    pr_count = len(prs)
    contributor_count = len(authors)

    print("=" * 72)
    print(f"RELEASE METRICS: {prev_tag} -> {target}")
    print("=" * 72)
    print(
        f"Since {prev_tag}: ~{commit_count} commits · ~{pr_count} merged PRs · "
        f"{files_changed} files changed · ~{insertions:,} insertions · ~{deletions:,} deletions · "
        f"{contributor_count} contributors"
    )
    print("-" * 72)
    print(f"Identified PRs: {', '.join(sorted(prs, key=int)) if prs else 'None'}")
    print(f"Unique git authors ({contributor_count}):")
    for a in sorted(authors):
        print(f"  - {a}")
    print("-" * 72)
    print("COMMIT CATEGORIZATION SUMMARY:")
    for cat, items in commits_by_category.items():
        if items:
            print(f"  [{cat}]: {len(items)} commits")
    print("=" * 72)


if __name__ == "__main__":
    main()
