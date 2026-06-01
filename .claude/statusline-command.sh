#!/bin/bash
input=$(cat)

# --- Colors (using printf %b-safe escape sequences) ---
RED=$'\033[01;31m'
YEL=$'\033[01;33m'
GRN=$'\033[01;32m'
DRED=$'\033[02;31m'
DYEL=$'\033[02;33m'
DGRN=$'\033[02;32m'
CYN=$'\033[01;36m'
MAG=$'\033[01;35m'
BLU=$'\033[01;34m'
DCY=$'\033[00;36m'
DCYN=$'\033[02;36m'
DIM=$'\033[90m'
RST=$'\033[00m'

# --- Format seconds-until-target as a concise human string (e.g. 2d, 3h, 30m, 45s) ---
human_until() {
  local target="$1" now diff
  now=$(date +%s)
  diff=$(( target - now ))
  if [ "$diff" -le 0 ]; then
    printf "now"
  elif [ "$diff" -ge 86400 ]; then
    printf "%dd" $(( diff / 86400 ))
  elif [ "$diff" -ge 3600 ]; then
    printf "%dh" $(( diff / 3600 ))
  elif [ "$diff" -ge 60 ]; then
    printf "%dm" $(( diff / 60 ))
  else
    printf "%ds" "$diff"
  fi
}

parts=()

# --- 1. Context window + message count (FIRST) ---
used_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
max_tokens=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Message count (merged into the context segment below)
msg_count=""
transcript=$(echo "$input" | jq -r '.transcript_path // empty')
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  msg_count=$(grep -c '"role"' "$transcript" 2>/dev/null || echo "")
  [ "$msg_count" = "0" ] && msg_count=""
fi

if [ -n "$used_pct" ] && [ -n "$used_tokens" ] && [ -n "$max_tokens" ]; then
  pct_int=$(printf '%.0f' "$used_pct")
  used_k=$(awk "BEGIN {printf \"%.1fk\", $used_tokens/1000}")
  max_k=$(awk "BEGIN {printf \"%.0fk\", $max_tokens/1000}")
  # Token color: green < 60k, yellow < 120k, red >= 120k
  if [ "$used_tokens" -lt 60000 ]; then
    TOK_COLOR="$GRN"; PCT_COLOR="$DGRN"
  elif [ "$used_tokens" -lt 120000 ]; then
    TOK_COLOR="$YEL"; PCT_COLOR="$DYEL"
  else
    TOK_COLOR="$RED"; PCT_COLOR="$DRED"
  fi
  ctx_seg="${PCT_COLOR}${pct_int}%${RST} ${TOK_COLOR}${used_k}/${max_k}${RST}"
  [ -n "$msg_count" ] && ctx_seg="${ctx_seg} ${DCYN}(${msg_count} msgs)${RST}"
  parts+=("$ctx_seg")
fi

# --- 3. Rate limits (5h and 7d) - share same color logic, distinct from ctx ---
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
five_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

rate_str=""
if [ -n "$five_pct" ]; then
  five_int=$(printf '%.0f' "$five_pct")
  if [ -n "$five_reset" ]; then
    five_seg="${BLU}${five_int}% $(human_until "$five_reset")${RST}"
  else
    five_seg="${BLU}${five_int}% 5h${RST}"
  fi
  rate_str="$five_seg"
fi
if [ -n "$week_pct" ]; then
  week_int=$(printf '%.0f' "$week_pct")
  if [ -n "$week_reset" ]; then
    week_seg="${BLU}${week_int}% $(human_until "$week_reset")${RST}"
  else
    week_seg="${BLU}${week_int}% 7d${RST}"
  fi
  if [ -n "$rate_str" ]; then
    rate_str="${rate_str} ${week_seg}"
  else
    rate_str="$week_seg"
  fi
fi
if [ -n "$rate_str" ]; then
  # Attach to the context segment (space, not "|") so there's no divider after (n msgs)
  if [ ${#parts[@]} -gt 0 ]; then
    parts[$((${#parts[@]}-1))]="${parts[$((${#parts[@]}-1))]} ${rate_str}"
  else
    parts+=("$rate_str")
  fi
fi

# --- 4. Session / worktree name (magenta) ---
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

# --- Output: join all parts with separator ---
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
