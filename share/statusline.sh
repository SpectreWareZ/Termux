#!/data/data/com.termux/files/usr/bin/bash
# statusline — หัวแชทของ Claude Code: model · provider · effort · โฟลเดอร์
# รับ JSON ทาง stdin จาก Claude Code (session_id, model, workspace, ...)
set -u

VI=$'\033[38;5;209m'; CY=$'\033[38;5;215m'; DI=$'\033[38;5;245m'
DK=$'\033[38;5;238m'; OK=$'\033[38;5;114m'; R=$'\033[0m'

IN=$(cat 2>/dev/null || echo '{}')

get() { printf '%s' "$IN" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);const p=process.argv[1].split(".");
  let v=j;for(const k of p){if(v==null){v="";break}v=v[k]}
  process.stdout.write(v==null?"":String(v));}catch(_){}
});' "$1" 2>/dev/null; }

M=$(get model.display_name)
[ -z "$M" ] && M=$(get model.id)

S="$HOME/.claude/settings.json"
ENVM=$(grep -oE '"ANTHROPIC_MODEL"[[:space:]]*:[[:space:]]*"[^"]*"' "$S" 2>/dev/null | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
[ -z "$M" ] && M="$ENVM"
URL=$(grep -oE '"ANTHROPIC_BASE_URL"[[:space:]]*:[[:space:]]*"[^"]*"' "$S" 2>/dev/null | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
EFF=$(grep -oE '"effortLevel"[[:space:]]*:[[:space:]]*"[^"]*"' "$S" 2>/dev/null | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
URL=${URL#https://}; URL=${URL#http://}; URL=${URL%%/*}
[ -z "$EFF" ] && EFF=medium

DIR=$(get workspace.current_dir)
[ -z "$DIR" ] && DIR=$PWD
DIR=${DIR/#$HOME/\~}
TOT=$(get cost.total_tokens)
PCT=""
if [ -n "$TOT" ] && [ "$TOT" != "0" ]; then
  PCT=" ${DK}·${R} ${DI}$(printf '%s' "$TOT" | awk '{ if($1>1000) printf "%.1fk", $1/1000; else printf "%d", $1 }') tok${R}"
fi

printf '%s●%s %s%s%s %s│%s %s%s%s %s│%s %s%s effort%s %s│%s %s%s%s%s\n' \
  "$OK" "$R" \
  "$CY" "$M" "$R" \
  "$DK" "$R" \
  "$VI" "$URL" "$R" \
  "$DK" "$R" \
  "$DI" "$EFF" "$R" \
  "$DK" "$R" \
  "$DI" "$DIR" "$R" \
  "$PCT"
