#!/bin/sh
# 50A51HUV / V0000.09.01O.P0813 — supervised hisenseUI restart.
#
# Same shape as switch-home-75u8qtuk.sh, adapted to this build:
#   - the UI engine is `hisenseUI`, not `SystemUI`
#   - the launcher bundle lives at /APPS/channelA/operation-ui/...
#   - app.js is 305:305 mode 0755 (not 305:909 / 0640)
#   - the cache is /var/local/hisenseUI/cobalt_home/.cache/cobalt
#
# Run detached, as root, over the SSH lane. /var/local is mounted seclabel,
# so a direct shebang exec fails ("bad interpreter: Permission denied"):
# invoke through /bin/sh explicitly.
#   /bin/sh -c 'trap "" HUP; exec /bin/sh /var/local/alvidaa/native-home/switch-home.sh MODE' \
#     >/dev/null 2>&1 </dev/null &
#
# MODES:
#   status    print the current bundle hash and engine pid; changes nothing
#   dry       stock-only restart; no file or cache changes (the gate)
#   install   atomic launcher swap + JS-cache reset, then restart
#   rollback  restore stock app.js + JS-cache, then restart
#
# Teardown: MODE=rollback restores everything. Files are written only under
# the writable /APPS operation-ui module and /var/local; / stays read-only
# with dm-verity green.
PATH=/usr/local/bin:/usr/local/scripts:/bin:/usr/bin:/sbin:/usrbin:/opt/bin
export PATH
trap "" HUP

MODE="${1:-status}"
DIR=/var/local/alvidaa/native-home
APP=/APPS/channelA/operation-ui/apps/launcher/js/app.js
CACHE=/var/local/hisenseUI/cobalt_home/.cache/cobalt
BACKUP=$DIR/backup
CANDIDATE=$DIR/candidate-native-home.js
ENVF=$DIR/engine.env
LOG=$DIR/switch.log
DONE=$DIR/switch.done
STOCK_MD5=2f175841081b9c20efd03c0c38b5b839
CANDIDATE_MD5=$(/bin/cat "$DIR/candidate.md5" 2>/dev/null)

log() { printf '%s\n' "$*" >> "$LOG"; }
fail() { log "FAIL $*"; printf '%s\n' "FAIL $*" > "$DONE"; exit 1; }
md5of() { /bin/md5sum "$1" | /bin/sed 's/[^0-9a-f].*//'; }

# Non-zombie engine pids, matched on the binary rather than the process name.
# `pidof hisenseUI` also catches short-lived children, which made the first
# dry run signal the wrong pid and then refuse to continue (correctly).
live_engine() {
  out=""
  for d in /proc/[0-9]*; do
    p=${d#/proc/}
    [ -e "$d/exe" ] || continue
    /bin/ls -l "$d/exe" 2>/dev/null | /bin/grep -q "/opt/hisenseUI/bin/hisenseUI$" || continue
    st=$(/bin/grep '^State:' "$d/status" 2>/dev/null)
    case "$st" in *Z*) continue ;; esac
    out="$out $p"
  done
  set -- $out
  printf '%s\n' "$*"
}

if [ "$MODE" = status ]; then
  printf 'app.js md5 %s\n' "$(md5of "$APP")"
  printf 'stock md5  %s\n' "$STOCK_MD5"
  printf 'engine pid %s\n' "$(live_engine)"
  printf 'phase      %s\n' "$(/bin/cat "$DIR/phase" 2>/dev/null || echo unknown)"
  exit 0
fi

/bin/rm -f "$DONE"
log "=== switch-home mode=$MODE ==="

case "$MODE" in
  dry)
    [ "$(md5of "$APP")" = "$STOCK_MD5" ] || fail "dry run requires stock app.js"
    ;;
  install)
    [ "$(md5of "$APP")" = "$STOCK_MD5" ] || fail "install requires stock app.js"
    [ "$(md5of "$CANDIDATE")" = "$CANDIDATE_MD5" ] || fail "candidate hash mismatch"
    [ -f "$BACKUP/app.js.stock" ] || fail "stock backup missing"
    [ ! -e "$BACKUP/compiled_js" ] || fail "cache backup already present"
    ;;
  rollback)
    [ -f "$BACKUP/app.js.stock" ] || fail "stock backup missing"
    ;;
  *) fail "unknown mode: $MODE" ;;
esac

old=$(live_engine)
set -- $old
old=$1
[ -n "$old" ] && [ -r "/proc/$old/environ" ] || fail "no live engine to capture"

creds_before=$(/bin/grep -E '^(Uid|Gid|Groups|CapEff):' "/proc/$old/status")
/bin/cat "/proc/$old/environ" > "$ENVF" || fail "cannot capture engine env"
printf '\0' >> "$ENVF"
log "captured env from pid=$old"

/bin/kill -TERM $old 2>/dev/null

i=0
while [ "$i" -lt 20 ]; do
  [ -z "$(live_engine)" ] && break
  /bin/sleep 1
  i=$((i + 1))
done
if [ -n "$(live_engine)" ]; then
  fail "SIGTERM did not clear hisenseUI; refusing to launch a second engine"
fi
log "engine stopped (wait ${i}s)"

# Mutate files only while the UI engine is down (55A7KAU lesson).
if [ "$MODE" = install ]; then
  tmp="$APP.alvidaa-tmp"
  /bin/cp "$CANDIDATE" "$tmp" || fail "cannot stage candidate"
  /bin/chown 305:305 "$tmp" || fail "cannot set owner 305:305"
  /bin/chmod 0755 "$tmp" || fail "cannot set mode 0755"
  /bin/mv -f "$tmp" "$APP" || fail "cannot install candidate"
  for d in compiled_js uncompiled_js; do
    /bin/mv "$CACHE/$d" "$BACKUP/$d" || fail "cannot back up $d"
    /bin/mkdir "$CACHE/$d" || fail "cannot recreate $d"
    /bin/chown 311:311 "$CACHE/$d" || fail "cannot own $d"
    /bin/chmod 0751 "$CACHE/$d" || fail "cannot chmod $d"
  done
  printf '%s\n' installed > "$DIR/phase"
  log "installed candidate; JS cache dirs reset (originals in $BACKUP)"
elif [ "$MODE" = rollback ]; then
  tmp="$APP.alvidaa-tmp"
  /bin/cp -p "$BACKUP/app.js.stock" "$tmp" || fail "cannot stage stock app.js"
  /bin/chown 305:305 "$tmp" || fail "cannot set owner 305:305"
  /bin/chmod 0755 "$tmp" || fail "cannot set mode 0755"
  /bin/mv -f "$tmp" "$APP" || fail "cannot restore stock app.js"
  for d in compiled_js uncompiled_js; do
    if [ -d "$BACKUP/$d" ]; then
      /bin/rm -rf "$CACHE/$d" || fail "cannot clear $d"
      /bin/mv "$BACKUP/$d" "$CACHE/$d" || fail "cannot restore $d"
    else
      log "WARN no backup for $d; leaving regenerated cache"
    fi
  done
  printf '%s\n' restored > "$DIR/phase"
  log "restored stock app.js and JS cache dirs"
fi

respawned=$(live_engine)
if [ -n "$respawned" ]; then
  log "INFO engine respawned without our launch: $respawned"
else
  # Detached launch. The subshell ignores HUP so the engine survives the SSH
  # session closing; env is the captured vendor environment.
  (
    cd /opt/hisenseUI || exit 1
    while IFS= read -r -d '' item; do
      case "$item" in *=*) export "$item" ;; esac
    done < "$ENVF"
    trap "" HUP
    exec /usr/local/bin/secure_exec hisenseUI /opt/hisenseUI/startgui.sh \
      >/dev/null 2>&1 </dev/null
  ) >/dev/null 2>&1 </dev/null &
  log "launched secure_exec hisenseUI (bg pid $!)"
fi

i=0
new=""
while [ "$i" -lt 40 ]; do
  new=$(live_engine)
  [ -n "$new" ] && [ "$new" != "$old" ] && break
  /bin/sleep 1
  i=$((i + 1))
done
set -- $new
new=$1
[ -n "$new" ] || fail "engine did not start within ${i}s; SSH stays up, retry launch manually"

printf '%s\n' -1000 > "/proc/$new/oom_score_adj" 2>/dev/null || true
creds_after=$(/bin/grep -E '^(Uid|Gid|Groups|CapEff):' "/proc/$new/status")
[ "$creds_after" = "$creds_before" ] || log "WARN restarted credentials differ"
ppid=$(/bin/grep '^PPid:' "/proc/$new/status" | /bin/sed 's/[^0-9]*//g')
log "OK mode=$MODE old=$old new=$new ppid=$ppid wait=${i}s"
log "app.js md5 now $(md5of "$APP")"
printf '%s\n' "OK mode=$MODE new=$new" > "$DONE"
