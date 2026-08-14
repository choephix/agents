import type { ShadowDef } from "../src/types";

// A subagent's edits never reach the main transcript — it records only `task(...)`.
// `eval` and `bash` write too. Over-match on purpose: a spurious wake is one cheap
// no-op turn, a missed wake loses the commit permanently.
const WRITING_TOOLS = ["edit", "write", "ast_edit", "task", "eval", "bash"];

export default {
	model: "haiku",
	tools: ["read", "grep", "bash"],
	// Don't snapshot a half-finished burst: wait for a lull after the last edit turn.
	debounceMs: 5000,
	instruction: [
		"The main session just changed files in this repository. Commit that work.",
		"",
		"1. Inspect the actual state: `git status --porcelain=v1` and `git diff HEAD`.",
		"2. If nothing is uncommitted, say so in one line and end your turn.",
		"3. Otherwise stage everything and commit with a concise conventional-commit",
		"   subject describing what actually changed (read the diff, do not guess from",
		"   the digest).",
		"",
		"Never push. Never rewrite history. Never revert or discard changes.",
	].join("\n"),
	filter: turn => turn.toolCalls.some(call => WRITING_TOOLS.includes(call.name)),
} satisfies ShadowDef;
