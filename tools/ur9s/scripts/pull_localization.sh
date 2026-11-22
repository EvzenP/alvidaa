#!/usr/bin/env bash
# Pull the 75UR9S localization data for the string inventory (read-only on
# the TV: find + tar over the root SSH lane).
#
#   ./scripts/pull_localization.sh --tv <tv-ip> [--src eng] [--tgt cze]
#                                  [--out <dir>] [--port 8008] [--key <ssh-key>]
#
#   --src   source language code for the tables (default: eng)
#   --tgt   target language code for the tables (default: cze)
#
# Writes <out>/pull.tar.gz and extracts it to <out>/tree/ (opt/ + APPS/).
# Feed <out>/tree to build_localization.py with the same --src/--tgt.
#
# Default --out is /tmp/ur9s-loc (ephemeral — pass --out for a persistent
# location).
#
# The remote side is minimal busybox: no mktemp/cut/tr — the file list goes
# to a fixed /tmp path on the TV. `current` -> CHA symlinks are never
# followed (real paths only), so no file is listed twice.
set -uo pipefail

TOOLROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$TOOLROOT/../.." && pwd)"
TV=""
SRC=eng
TGT=cze
OUT="/tmp/ur9s-loc"
PORT=8008
KEY="$REPO/server/keys/tv_root_ed25519"

while [ $# -gt 0 ]; do
  case "$1" in
    --tv) TV="$2"; shift 2 ;;
    --src) SRC="$2"; shift 2 ;;
    --tgt) TGT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

[ -n "$TV" ] || { echo "ERROR: --tv is required (TV LAN IP)"; exit 1; }
[ -f "$KEY" ] || { echo "ERROR: ssh key not found: $KEY"; exit 1; }
mkdir -p "$OUT"

echo "pulling $SRC/$TGT from $TV:$PORT -> $OUT/pull.tar.gz"
# Remote side (runs on the TV as root, emits tar.gz on stdout).
# $1 = src language, $2 = tgt language.
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -i "$KEY" -p "$PORT" "root@$TV" sh -s "$SRC" "$TGT" <<'REMOTE' > "$OUT/pull.tar.gz"
set -e
SRC="$1"; TGT="$2"
cd /
LIST=/tmp/loc_list.$$
{
# code files per package (real paths only - never via the `current` symlink)
find opt/pkgs/tv.vidaa.app.ui/system-ui -type f \( -name "*.js" -o -name "*.json" \) -not -path "*/language/*"
find opt/pkgs/tv.vidaa.app.ui/hisenseUI -type f \( -name "*.js" -o -name "*.json" \) -not -path "*/language/*"
find APPS/pkgs/tv.vidaa.app.operationui/CHA -type f \( -name "*.js" -o -name "*.json" \) -not -path "*/language/*"
find APPS/pkgs/tv.vidaa.app.tvbrowser -type f \( -name "*.js" -o -name "*.json" \) -not -path "*/language/*"
find APPS/pkgs/tv.vidaa.res.webengine/CHA -type f \( -name "*.js" -o -name "*.json" \) -not -path "*/language/*"
# bundle files - LIVE sources (shadow for tv.vidaa.app.ui)
find APPS/pkgs/tv.vidaa.app.ui -type f -path "*/language/*" \( -name "keys.json" -o -name "language_${SRC}.json" -o -name "language_${TGT}.json" \)
find APPS/pkgs/tv.vidaa.app.operationui/CHA/language -type f \( -name "keys.json" -o -name "language_${SRC}.json" -o -name "language_${TGT}.json" \)
find APPS/pkgs/tv.vidaa.app.tvbrowser -type f \( -name "language_${SRC}.json" -o -name "language_${TGT}.json" -o -name "unitedtransinfo.json" \)
find APPS/pkgs/tv.vidaa.res.webengine/CHA -type f \( -name "language_${SRC}.js" -o -name "language_${TGT}.js" \)
# bundle files - /opt factory originals (for the shadow-diff marker; tgt only)
find opt/pkgs/tv.vidaa.app.ui -type f -path "*/language/*" \( -name "keys.json" -o -name "language_${TGT}.json" \)
} | sort -u > "$LIST"
tar -czf - --files-from="$LIST"
rm -f "$LIST"
REMOTE

[ -s "$OUT/pull.tar.gz" ] || { echo "ERROR: empty pull — check TV reachability"; rm -f "$OUT/pull.tar.gz"; exit 1; }

rm -rf "$OUT/tree"
mkdir -p "$OUT/tree"
tar -xzf "$OUT/pull.tar.gz" -C "$OUT/tree"
echo "extracted $(find "$OUT/tree" -type f | wc -l) files to $OUT/tree"
echo "next: tools/ur9s/scripts/build_localization.py $OUT/tree <out-dir> --src $SRC --tgt $TGT"