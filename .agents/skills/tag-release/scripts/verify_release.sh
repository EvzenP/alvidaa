#!/usr/bin/env bash
# Pre-flight release verification gate for alvidaa.
# Ensures the repository is 100% clean, verified, and safe to tag.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "========================================================================"
echo "RUNNING PRE-FLIGHT RELEASE VERIFICATION"
echo "========================================================================"

echo "[1/2] Checking git working tree status..."
if [ -n "$(git status --porcelain)" ]; then
    echo "ERROR: Working tree is dirty. Stash or commit changes before releasing."
    git status -s
    exit 1
fi
echo "  OK: Working tree is clean."

echo "[2/2] Executing 9-stage repository test suite (scripts/check.sh)..."
./scripts/check.sh

echo "========================================================================"
echo "ALL PRE-FLIGHT RELEASE CHECKS PASSED — REPOSITORY IS READY FOR RELEASE."
echo "========================================================================"
