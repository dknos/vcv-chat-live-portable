#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
READER="${YT_CHAT_READER:-${PROJECT_ROOT}/scripts/youtube-chat-reader.py}"
PYTHON="$(command -v python3 || true)"
LOCK_FILE="${YT_CHAT_LOCK_FILE:-/tmp/vcv-chat-live-reader.lock}"
BROADCAST_FILE="${YT_BROADCAST_FILE:-${PROJECT_ROOT}/state/broadcast-id}"
SESSION_FILE="${CHAT_SESSION_FILE:-${PROJECT_ROOT}/state/live-session.json}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}/vcv-chat-live-reader"
PID_FILE="${RUNTIME_DIR}/reader.pid"
MANAGED_BROADCAST_FILE="${RUNTIME_DIR}/broadcast-id"
LOG_FILE="${RUNTIME_DIR}/reader.log"
MANAGER_LOCK="${RUNTIME_DIR}/manager.lock"
START_TIMEOUT=75
STOP_TIMEOUT=12

usage() {
  cat <<'EOF'
Usage: manage-chat-reader.sh [start|stop|status] [--broadcast VIDEO_ID]

Actions:
  start   Start the canonical read-only YouTube chat reader (default).
  stop    Stop only the reader recorded in this manager's PID file.
  status  Show the managed reader and exclusive-lock state.

The broadcast ID defaults to state/broadcast-id for start. Set
CHAT_SESSION_FILE or YT_CHAT_READER in the environment to override paths.
EOF
}

fail() {
  printf 'chat-reader: ERROR: %s\n' "$*" >&2
  exit 1
}

is_video_id() {
  [[ "$1" =~ ^[A-Za-z0-9_-]{11}$ ]]
}

process_exists() {
  local pid="$1"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && [[ -d "/proc/${pid}" ]]
}

process_is_canonical_reader() {
  local pid="$1"
  local process_exe python_exe
  local -a argv=()

  process_exists "$pid" || return 1
  process_exe="$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)"
  python_exe="$(readlink -f "$PYTHON" 2>/dev/null || true)"
  [[ -n "$process_exe" && "$process_exe" == "$python_exe" ]] || return 1

  mapfile -d '' -t argv < "/proc/${pid}/cmdline" 2>/dev/null || return 1
  [[ "${#argv[@]}" -eq 2 ]] || return 1
  [[ "${argv[1]}" == "$READER" ]]
}

process_broadcast() {
  local pid="$1"
  local entry

  process_exists "$pid" || return 1
  while IFS= read -r -d '' entry; do
    if [[ "$entry" == YT_VIDEO_ID=* ]]; then
      printf '%s\n' "${entry#YT_VIDEO_ID=}"
      return 0
    fi
  done < "/proc/${pid}/environ" 2>/dev/null
  return 1
}

read_pid_file() {
  local pid=""
  [[ -f "$PID_FILE" ]] || return 1
  IFS= read -r pid < "$PID_FILE" || true
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 2
  printf '%s\n' "$pid"
}

inspect_reader_lock() {
  LOCK_STATE="absent"
  LOCK_PID=""
  [[ -e "$LOCK_FILE" ]] || return 0

  LOCK_STATE="invalid"
  IFS= read -r LOCK_PID < "$LOCK_FILE" 2>/dev/null || LOCK_PID=""
  if [[ "$LOCK_PID" =~ ^[1-9][0-9]*$ ]]; then
    if process_exists "$LOCK_PID"; then
      LOCK_STATE="live"
    else
      LOCK_STATE="stale"
    fi
  fi
}

session_fingerprint() {
  stat --printf='%i:%Y:%s' "$SESSION_FILE" 2>/dev/null || true
}

session_targets_broadcast() {
  local broadcast="$1"
  "$PYTHON" - "$SESSION_FILE" "$broadcast" <<'PY' >/dev/null 2>&1
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    state = json.load(stream)
raise SystemExit(0 if state.get("videoId") == sys.argv[2] else 1)
PY
}

clear_managed_state() {
  rm -f -- "$PID_FILE" "$MANAGED_BROADCAST_FILE"
}

stop_exact_reader() {
  local pid="$1"
  local elapsed

  process_is_canonical_reader "$pid" || return 1
  kill -TERM "$pid" 2>/dev/null || return 1

  for ((elapsed = 0; elapsed < STOP_TIMEOUT; elapsed++)); do
    process_is_canonical_reader "$pid" || return 0
    sleep 1
  done

  # Recheck the full command line immediately before escalating. This prevents
  # signaling an unrelated process if the PID was recycled during shutdown.
  if process_is_canonical_reader "$pid"; then
    kill -KILL "$pid" 2>/dev/null || return 1
  fi
  for ((elapsed = 0; elapsed < 3; elapsed++)); do
    process_is_canonical_reader "$pid" || return 0
    sleep 1
  done
  return 1
}

ACTION="start"
BROADCAST=""
if [[ $# -gt 0 && "$1" =~ ^(start|stop|status)$ ]]; then
  ACTION="$1"
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --broadcast)
      [[ $# -ge 2 ]] || fail '--broadcast requires a YouTube video ID'
      BROADCAST="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -n "$PYTHON" ]] || fail 'python3 is not installed'
[[ -f "$READER" ]] || fail "canonical reader not found: $READER"

if [[ -n "$BROADCAST" ]] && ! is_video_id "$BROADCAST"; then
  fail 'broadcast ID must be exactly 11 YouTube ID characters'
fi

umask 077
if [[ -L "$RUNTIME_DIR" ]]; then
  fail "runtime path must not be a symbolic link: $RUNTIME_DIR"
fi
mkdir -p -- "$RUNTIME_DIR" || fail "cannot create runtime directory: $RUNTIME_DIR"
[[ -d "$RUNTIME_DIR" ]] || fail "runtime path is not a directory: $RUNTIME_DIR"
[[ "$(stat -c '%u' "$RUNTIME_DIR" 2>/dev/null || true)" == "$(id -u)" ]] || \
  fail "runtime directory is not owned by the current user: $RUNTIME_DIR"
chmod 700 -- "$RUNTIME_DIR" || fail "cannot secure runtime directory: $RUNTIME_DIR"

exec 9>"$MANAGER_LOCK" || fail 'cannot open manager lock'
flock -x 9 || fail 'cannot acquire manager lock'

case "$ACTION" in
  status)
    managed_pid="$(read_pid_file 2>/dev/null || true)"
    inspect_reader_lock
    if [[ -n "$managed_pid" ]] && process_is_canonical_reader "$managed_pid"; then
      managed_broadcast="$(process_broadcast "$managed_pid" 2>/dev/null || true)"
      if [[ -n "$BROADCAST" && "$managed_broadcast" != "$BROADCAST" ]]; then
        printf 'chat-reader: running pid=%s broadcast=%s (not requested broadcast %s)\n' \
          "$managed_pid" "${managed_broadcast:-unknown}" "$BROADCAST"
        exit 3
      fi
      if [[ "$LOCK_STATE" == "live" && "$LOCK_PID" != "$managed_pid" ]]; then
        printf 'chat-reader: inconsistent: managed pid=%s, competing lock pid=%s\n' \
          "$managed_pid" "$LOCK_PID" >&2
        exit 2
      fi
      printf 'chat-reader: running pid=%s broadcast=%s session=%s log=%s\n' \
        "$managed_pid" "${managed_broadcast:-unknown}" "$SESSION_FILE" "$LOG_FILE"
      exit 0
    fi

    if [[ -n "$managed_pid" ]]; then
      printf 'chat-reader: unmanaged PID-file occupant pid=%s; refusing to signal it\n' \
        "$managed_pid" >&2
    fi
    if [[ "$LOCK_STATE" == "live" ]]; then
      printf 'chat-reader: another live reader owns %s (pid=%s); not managed here\n' \
        "$LOCK_FILE" "$LOCK_PID" >&2
      exit 2
    fi
    printf 'chat-reader: stopped'
    if [[ "$LOCK_STATE" != "absent" ]]; then
      printf ' (reader lock is %s)' "$LOCK_STATE"
    fi
    printf '\n'
    exit 3
    ;;

  stop)
    managed_pid="$(read_pid_file 2>/dev/null || true)"
    inspect_reader_lock
    if [[ -z "$managed_pid" ]]; then
      if [[ "$LOCK_STATE" == "live" ]]; then
        fail "live reader pid=$LOCK_PID owns $LOCK_FILE but is not managed by this PID file"
      fi
      clear_managed_state
      printf 'chat-reader: already stopped\n'
      exit 0
    fi
    if ! process_exists "$managed_pid"; then
      clear_managed_state
      printf 'chat-reader: removed stale managed state; reader was already stopped\n'
      exit 0
    fi
    process_is_canonical_reader "$managed_pid" || \
      fail "PID $managed_pid does not exactly match the canonical reader; refusing to signal it"
    managed_broadcast="$(process_broadcast "$managed_pid" 2>/dev/null || true)"
    [[ -n "$managed_broadcast" ]] || \
      fail "canonical reader PID $managed_pid has no YT_VIDEO_ID; refusing to signal it"
    if [[ -n "$BROADCAST" && "$managed_broadcast" != "$BROADCAST" ]]; then
      fail "managed reader targets $managed_broadcast, not requested broadcast $BROADCAST"
    fi
    if [[ "$LOCK_STATE" == "live" && "$LOCK_PID" != "$managed_pid" ]]; then
      fail "competing live reader pid=$LOCK_PID owns $LOCK_FILE; refusing to alter either reader"
    fi
    stop_exact_reader "$managed_pid" || fail "canonical reader PID $managed_pid did not stop safely"
    clear_managed_state
    printf 'chat-reader: stopped pid=%s broadcast=%s\n' "$managed_pid" "$managed_broadcast"
    ;;

  start)
    if [[ -z "$BROADCAST" ]]; then
      [[ -f "$BROADCAST_FILE" ]] || \
        fail "no broadcast ID supplied and $BROADCAST_FILE does not exist"
      IFS= read -r BROADCAST < "$BROADCAST_FILE" || true
      BROADCAST="${BROADCAST%$'\r'}"
    fi
    is_video_id "$BROADCAST" || \
      fail 'broadcast ID must be exactly 11 YouTube ID characters'

    managed_pid="$(read_pid_file 2>/dev/null || true)"
    inspect_reader_lock
    if [[ -n "$managed_pid" ]] && process_exists "$managed_pid"; then
      process_is_canonical_reader "$managed_pid" || \
        fail "PID $managed_pid does not exactly match the canonical reader; refusing to signal it"
      managed_broadcast="$(process_broadcast "$managed_pid" 2>/dev/null || true)"
      [[ -n "$managed_broadcast" ]] || \
        fail "canonical reader PID $managed_pid has no YT_VIDEO_ID; refusing to signal it"
      if [[ "$managed_broadcast" == "$BROADCAST" ]]; then
        if [[ "$LOCK_STATE" == "live" && "$LOCK_PID" != "$managed_pid" ]]; then
          fail "competing live reader pid=$LOCK_PID owns $LOCK_FILE"
        fi
        printf 'chat-reader: already running pid=%s broadcast=%s\n' \
          "$managed_pid" "$BROADCAST"
        exit 0
      fi
      if [[ "$LOCK_STATE" == "live" && "$LOCK_PID" != "$managed_pid" ]]; then
        fail "competing live reader pid=$LOCK_PID owns $LOCK_FILE; refusing to stop the managed reader"
      fi
      printf 'chat-reader: switching managed reader from %s to %s\n' \
        "$managed_broadcast" "$BROADCAST"
      stop_exact_reader "$managed_pid" || \
        fail "canonical reader PID $managed_pid did not stop safely"
      clear_managed_state
      inspect_reader_lock
    elif [[ -n "$managed_pid" ]]; then
      clear_managed_state
    elif [[ -f "$PID_FILE" ]]; then
      fail "invalid managed PID file: $PID_FILE"
    fi

    if [[ "$LOCK_STATE" == "live" ]]; then
      fail "live reader pid=$LOCK_PID already owns $LOCK_FILE and is not managed here"
    fi

    old_session_fingerprint="$(session_fingerprint)"
    {
      printf '\n[%s] starting canonical reader for broadcast %s\n' \
        "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$BROADCAST"
    } >> "$LOG_FILE"
    # The reader must not inherit the manager's flock descriptor. Keeping fd 9
    # open in the daemon makes every later status/stop command block forever.
    nohup env YT_VIDEO_ID="$BROADCAST" CHAT_SESSION_FILE="$SESSION_FILE" \
      YT_CHAT_LOCK_FILE="$LOCK_FILE" "$PYTHON" "$READER" \
      >> "$LOG_FILE" 2>&1 < /dev/null 9>&- &
    new_pid=$!
    printf '%s\n' "$new_pid" > "${PID_FILE}.tmp"
    mv -f -- "${PID_FILE}.tmp" "$PID_FILE"
    printf '%s\n' "$BROADCAST" > "${MANAGED_BROADCAST_FILE}.tmp"
    mv -f -- "${MANAGED_BROADCAST_FILE}.tmp" "$MANAGED_BROADCAST_FILE"

    ready=0
    for ((elapsed = 0; elapsed < START_TIMEOUT; elapsed++)); do
      if ! process_is_canonical_reader "$new_pid"; then
        break
      fi
      current_fingerprint="$(session_fingerprint)"
      if [[ -n "$current_fingerprint" && "$current_fingerprint" != "$old_session_fingerprint" ]] && \
          session_targets_broadcast "$BROADCAST"; then
        inspect_reader_lock
        if [[ "$LOCK_STATE" == "live" && "$LOCK_PID" == "$new_pid" ]]; then
          ready=1
          break
        fi
      fi
      sleep 1
    done

    if [[ "$ready" -ne 1 ]]; then
      if process_is_canonical_reader "$new_pid"; then
        stop_exact_reader "$new_pid" || true
      fi
      clear_managed_state
      fail "reader did not publish a fresh session for $BROADCAST within ${START_TIMEOUT}s; see $LOG_FILE"
    fi
    printf 'chat-reader: started pid=%s broadcast=%s session=%s log=%s\n' \
      "$new_pid" "$BROADCAST" "$SESSION_FILE" "$LOG_FILE"
    ;;
esac
