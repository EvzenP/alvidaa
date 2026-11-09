#!/bin/bash
# Build static dropbear (2026.94) for the 55E7QTUK 09.09D chain, zig-cc
# cross-hosted on macOS. Products: dropbear, dropbearkey, dbclient,
# dropbearconvert (stripped, zero DT_NEEDED).
#
#   tools/e7qtuk/dropbear-build.sh /tmp/e7q-build/dropbear /tmp/e7q-tvtools
#   DROPBEAR_TARGET=aarch64-linux-musl tools/e7qtuk/dropbear-build.sh ...   # a6q lineage
#
# ARCH: this unit runs a 32-bit ARM (EABI5) userland — an aarch64 static-PIE
# binary is rejected with "cannot execute binary file" (ENOEXEC) and the armv7
# build is the one that runs (findings/05, "Kernel and binary format"). The
# default target is therefore arm-linux-musleabihf, the same triple that
# produced the static resolver binaries measured working on this TV
# (tools/u7q/scripts/build_dnsmasq.sh). The final ELF machine is asserted, so a
# wrong-arch build fails here instead of on the TV.
#
# Prereqs (brew):
#   zig                      # cc cross (target $DROPBEAR_TARGET)
#   binutils                 # GNU ar/ranlib/strip/readelf — LLVM ar skips ELF members
set -euo pipefail

SRC="${1:-/tmp/e7q-build/dropbear}"
OUT="${2:-/tmp/e7q-tvtools}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${DROPBEAR_TARGET:-arm-linux-musleabihf}"
ZIG_CC_TMP="$(dirname "$SRC")"
CCWRAP="$ZIG_CC_TMP/cc-wrapper.sh"
GAR="$(brew --prefix binutils)/bin/gar"
GRANLIB="$(brew --prefix binutils)/bin/granlib"
GREaDELF="$(brew --prefix binutils)/bin/greadelf"

case "$TARGET" in
  aarch64-*) WANT_MACHINE='AArch64' ;;
  arm*)      WANT_MACHINE='ARM' ;;
  *) echo "unsupported DROPBEAR_TARGET=$TARGET"; exit 1 ;;
esac

[ -d "$SRC" ] || { echo "clone first: git clone -b DROPBEAR_2026.94 github.com/mkj/dropbear"; exit 1; }
printf '#!/bin/sh\nexec zig cc -target %s "$@"\n' "$TARGET" > "$CCWRAP"
chmod +x "$CCWRAP"

cd "$SRC"
CC="$CCWRAP" ./configure --disable-zlib --host="$TARGET" 2>&1 | tail -2
# ./configure REGENERATES localoptions.h — the TV patches must land AFTER it,
# not before (a second run with pre-patched .c files would leave the flags at
# defaults and the built dropbear answers every connection with
# "Non-multiuser Dropbear requires a non-multiuser kernel").
# The a6q copies are the shared source-level TV patches (shells check, pubkey
# perms, get_user_shell) — arch-neutral, so the armv7 build reuses them.
cp "$HERE/../a6q/dropbear-aarch64/localoptions.h" localoptions.h
patch -p1 < "$HERE/../a6q/dropbear-aarch64/dropbear-tv.patch" || true
grep -q 'PATCHED' src/svr-auth.c src/svr-authpubkey.c src/common-session.c
grep -q '#define DROPBEAR_SVR_MULTIUSER 1' localoptions.h || { echo "localoptions MULTIUSER not 1"; exit 1; }
CC="$CCWRAP" LDFLAGS="-static" make -j8 2>&1 | tail -2 || true
"$CCWRAP" -c 2>/dev/null || true  # no-op warm
# the root make leaves single-member .a archives (host ar skips ELF) — rebuild
# them by mounting the loose objects directly:
( cd libtommath  && rm -f libtommath.a  && find . -name '*.o' -type f -print0 | /usr/bin/xargs -0 "$GAR" r libtommath.a )
( cd libtomcrypt && rm -f libtomcrypt.a && find . -name '*.o' -type f -print0 | /usr/bin/xargs -0 "$GAR" r libtomcrypt.a )
"$GRANLIB" "$SRC/libtommath/libtommath.a" "$SRC/libtomcrypt/libtomcrypt.a"

CC="$CCWRAP" LDFLAGS="-static" make -j8 2>&1 | tail -2

for b in dropbear dropbearkey dbclient dropbearconvert; do
  [ -f "$b" ] || exit 1
  "$(brew --prefix binutils)/bin/gstrip" "$b"
  [ -z "$("$GREaDELF" -d "$b" | grep NEEDED)" ] || { echo "NOT STATIC: $b"; exit 1; }
  MACHINE="$("$GREaDELF" -h "$b" | sed -n 's/.*Machine: *//p')"
  [ "$MACHINE" = "$WANT_MACHINE" ] \
    || { echo "WRONG ARCH: $b is '$MACHINE', this TV needs '$WANT_MACHINE' (aarch64 is ENOEXEC on 55E7QTUK)"; exit 1; }
  echo "$b: $MACHINE $(file -b "$b" | cut -d, -f1-4 | tr -d ' ') $(stat -f%z "$b")b"
done

mkdir -p "$OUT"
cp dropbear dropbearkey dbclient dropbearconvert "$OUT/"
echo "staged in $OUT"
