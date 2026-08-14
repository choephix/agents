import type { ShadowDef } from "../src/types";

/**
 * Wakes every time a subagent finishes a unit of work, and keeps a running
 * journal of delegated work. Ignores the main session entirely.
 */
export default {
	model: "haiku",
	tools: ["read", "bash"],
	sources: ["subagent"],
	instruction: [
		"You keep the delegated-work journal at .shadow/subagents.md.",
		"",
		"For each event in the digest, append exactly one line to that file:",
		"`- <ISO timestamp> <agent name> — <what it did, one clause> — <outcome>`",
		"",
		"Create .shadow/ and the file if missing. Append only; never rewrite or",
		"reorder existing lines. Report nothing but a one-line confirmation.",
		"",
		"Each event is one completed subagent. The digest carries its final output;",
		"summarize what it actually accomplished, not what it was asked to do.",
	].join("\n"),
	// `done` fires exactly once per agent, when its output artifact lands. It is the
	// only universal completion signal: `yield` is a hidden opt-in tool (measured
	// 126/159 agents), and mid-run `stopReason: "aborted"` is routine executor
	// steering, not death — 34/34 agents with an aborted message still delivered
	// their output.
	filter: turn => turn.event === "done",
} satisfies ShadowDef;
