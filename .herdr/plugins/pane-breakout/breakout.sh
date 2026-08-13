#!/usr/bin/env bash
set -euo pipefail

herdr=${HERDR_BIN_PATH:-herdr}

fail() {
  "$herdr" notification show "Pane breakout failed" --body "$1" --sound none >/dev/null 2>&1 || true
  printf 'pane-breakout: %s\n' "$1" >&2
  exit 1
}

command -v jq >/dev/null || fail 'jq is not installed'

context=${HERDR_PLUGIN_CONTEXT_JSON:-null}
pane_id=$(jq -r '.focused_pane_id // empty' <<<"$context") ||
  fail 'Herdr provided invalid plugin context'
pane_id=${pane_id:-${HERDR_PANE_ID:-}}
[[ -n $pane_id ]] || fail 'no focused pane in the invocation context'

pane=$("$herdr" pane get "$pane_id") || fail "could not inspect pane $pane_id"
tab_id=$(jq -r '.result.pane.tab_id // empty' <<<"$pane")
[[ -n $tab_id ]] || fail "could not read the tab of pane $pane_id"

# Origin memory: one file per pane, holding the tab it broke out of.
state_dir=${HERDR_PLUGIN_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/herdr-pane-breakout}
mkdir -p "$state_dir"
origin_file=$state_dir/${pane_id//:/_}.origin

tab_alive() {
  [[ -n $1 ]] && "$herdr" tab get "$1" >/dev/null 2>&1
}

case ${1:-out} in
  out)
    pane_count=$("$herdr" tab get "$tab_id" | jq -r '.result.tab.pane_count // 0')
    ((pane_count > 1)) || fail 'pane already has its own tab'
    "$herdr" pane move "$pane_id" --new-tab --focus >/dev/null ||
      fail "could not move pane $pane_id to a new tab"
    printf '%s\n' "$tab_id" >"$origin_file"
    ;;
  back)
    origin=$(cat "$origin_file" 2>/dev/null || true)
    if ! tab_alive "$origin"; then
      # Origin is gone (or was never recorded): fold into the previous tab.
      origin=$("$herdr" tab list | jq -r --arg tab "$tab_id" '
        .result.tabs | sort_by(.number) | map(.tab_id) | . as $ids
        | (index($tab) // 0) as $i
        | $ids[if $i > 0 then $i - 1 else 1 end] // empty')
      [[ -n $origin && $origin != "$tab_id" ]] || fail 'no other tab to fold into'
    fi
    "$herdr" pane move "$pane_id" --tab "$origin" --split right --focus >/dev/null ||
      fail "could not fold pane $pane_id into tab $origin"
    rm -f "$origin_file"
    ;;
  *)
    fail "unknown direction: $1"
    ;;
esac
