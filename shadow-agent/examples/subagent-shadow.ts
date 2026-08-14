import type { ShadowDef } from "../src/types";

/**
 * Keeps a journal of delegated work: one line per subagent that finished, and
 * one per subagent that finished with nothing. Ignores the main session.
 */
export default {
	model: "haiku",
	tools: ["read", "bash"],
	sources: ["subagent"],
	instruction: [
		"You keep the delegated-work journal at .shadow-agent/subagents.md.",
		"",
		"For each event in the digest, append exactly one line to that file:",
		"`- <ISO timestamp> <agent name> — <what it did, one clause> — <outcome>`",
		"",
		"Create .shadow-agent/ and the file if missing. Append only; never rewrite or",
		"reorder existing lines. Report nothing but a one-line confirmation.",
		"",
		"An event reading \"finished, output available\" carries that agent's final",
		"output — summarize what it actually accomplished, not what it was asked to do.",
		"Anything else means the agent produced no result at all: record it as LOST,",
		"quote the reason verbatim, and name any mid-flight tools the digest lists.",
	].join("\n"),
	// `done` fires once per agent when its output artifact lands — the only universal
	// completion signal, since `yield` is a hidden opt-in tool (measured 126/159
	// agents). `gone` is its complement, and every one of its reasons is a definitive
	// observation rather than a timeout. Deliberately not filtering on
	// `stopReason: "aborted"`: that is routine executor steering, not death — 34/34
	// agents with an aborted message still delivered their output.
	filter: turn => turn.event === "done" || turn.event === "gone",
} satisfies ShadowDef;
