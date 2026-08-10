---
name: merge-main
description: Use when merging the latest main into a branch.
---

Bring the current branch up to date with the freshly fetched `origin/main`. Adapting the branch to main — never the reverse.

**FIRST, gate on a clean working tree.** Run `git status --porcelain`. If it prints anything, STOP immediately and alert the user — do not stash, commit, or merge. Proceed only when the tree is clean.

1. Fetch fresh, then merge the remote: `git fetch origin`, then merge `origin/main`. Never merge the local `main` branch — it is probably stale.
2. On conflicts, deeply understand both sides before you touch a single line. For each side, work out exactly what changed, the intention behind it, and the approach taken. Treat existing code — especially main's — and the intentions behind it with the utmost care; it is load-bearing and hard-won. Resolve only once both sides genuinely make sense.
3. When in doubt, main wins — absolutely. You MUST preserve main's changes and patterns; the branch adapts to main, never the other way around.
4. Stay vigilant even with zero conflicts. Main may have moved or renamed files, shifted a convention, or introduced a new way of doing something the branch must now follow. Scan the incoming changes and reflect them in the branch, not just the textual conflicts.

Be careful and diligent throughout.
