#!/bin/bash
input=$(cat)

# Colors
RED=$'\033[01;31m'
YEL=$'\033[01;33m'
GRN=$'\033[01;32m'
CYN=$'\033[01;36m'
MAG=$'\033[01;35m'
BLU=$'\033[01;34m'
DIM=$'\033[90m'
RST=$'\033[00m'
DCY=$'\033[00;36m'

parts=()

# Message count
transcript=$(echo "$input" | jq -r '.transcript_path // empty')
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  msg_count=$(grep -c '"role"' "$transcript" 2>/dev/null || echo "")
  if [ -n "$msg_count" ] && [ "$msg_count" -gt 0 ]; then
    parts+=("${BLU}${msg_count} msgs${RST}")
  fi
fi

used_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
max_tokens=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

if [ -n "$used_pct" ] && [ -n "$used_tokens" ] && [ -n "$max_tokens" ]; then
  pct_int=$(printf '%.0f' "$used_pct")
  used_k=$(awk "BEGIN {printf \"%.1fk\", $used_tokens/1000}")
  max_k=$(awk "BEGIN {printf \"%.0fk\", $max_tokens/1000}")
  if [ "$used_tokens" -lt 60000 ]; then
    TOK_COLOR="$GRN"
  elif [ "$used_tokens" -lt 120000 ]; then
    TOK_COLOR="$YEL"
  else
    TOK_COLOR="$RED"
  fi
  parts+=("${TOK_COLOR}${used_k}/${max_k}${RST} ${TOK_COLOR}(${pct_int}%)${RST}")
fi

# Rate limits
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

rate_str=""
if [ -n "$five_pct" ]; then
  five_int=$(printf '%.0f' "$five_pct")
  rate_str="${CYN}${five_int}%${RST} ${DCY}5h${RST}"
fi
if [ -n "$week_pct" ]; then
  week_int=$(printf '%.0f' "$week_pct")
  if [ -n "$rate_str" ]; then
    rate_str="${rate_str} ${CYN}${week_int}%${RST} ${DCY}7d${RST}"
  else
    rate_str="${CYN}${week_int}%${RST} ${DCY}7d${RST}"
  fi
fi
if [ -n "$rate_str" ]; then
  parts+=("$rate_str")
fi

# Session/worktree name
worktree_name=$(echo "$input" | jq -r '.worktree.name // empty')
session_name=$(echo "$input" | jq -r '.session_name // empty')

identity=""
if [ -n "$worktree_name" ]; then
  identity="${MAG}${worktree_name}${RST}"
elif [ -n "$session_name" ]; then
  identity="${MAG}${session_name}${RST}"
fi

if [ -n "$identity" ]; then
  parts+=("$identity")
fi

sep=" ${DIM}|${RST} "
result=""
for part in "${parts[@]}"; do
  if [ -z "$result" ]; then
    result="$part"
  else
    result="${result}${sep}${part}"
  fi
done
printf "%s" "$result"
