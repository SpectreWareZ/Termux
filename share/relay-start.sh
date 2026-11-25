#!/data/data/com.termux/files/usr/bin/bash
# เปิด relay ถ้ายังไม่รัน (idempotent). อ่านค่าจาก ~/.claude/relay.env
# relay.env:
#   RELAY_UPSTREAM=https://host/v1
#   RELAY_MODEL=model-id
#   RELAY_KEYS=key1,key2,key3
PORT="${RELAY_PORT:-8789}"
curl -sS -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && exit 0

ENVF="$HOME/.claude/relay.env"
[ -f "$ENVF" ] || exit 1
# shellcheck disable=SC1090
. "$ENVF"
[ -n "${RELAY_UPSTREAM:-}" ] || exit 1
[ -n "${RELAY_KEYS:-}" ] || exit 1

export RELAY_UPSTREAM RELAY_KEYS
export RELAY_MODEL="${RELAY_MODEL:-deepseek-v4.1-flash-free}"
export RELAY_TRIES="${RELAY_TRIES:-6}"
export RELAY_PORT="$PORT"
export RELAY_LOG="${TMPDIR:-$HOME}/relay.log"

nohup node "$HOME/.local/bin/claude-relay.cjs" >"${TMPDIR:-$HOME}/relay.out" 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.3
  curl -sS -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && exit 0
done
exit 1
