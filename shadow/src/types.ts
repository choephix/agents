/** Terminal stop reasons. `toolUse` is never terminal: the agent loop continues. */
export type TerminalStopReason = "stop" | "length" | "error" | "aborted";

/** A tool call an observed agent made during a turn. */
export type ShadowToolCall = {
	name: string;
	/** Raw tool arguments, exactly as persisted in the session JSONL. */
	args: Record<string, unknown>;
	/** The observed agent's own one-line intent for the call, when present. */
	intent?: string;
};

/** Which transcripts in a session tree to observe. */
export type SourceKind = "main" | "subagent";

/** Which agent produced a record. */
export type TurnSource = {
	kind: SourceKind;
	/** "main", or the agent name from its transcript filename (dot-qualified when nested). */
	agent: string;
	/** 0 for the main session, 1 for its subagents, 2 for theirs. */
	depth: number;
};

/**
 * What ended.
 *
 * - `turn` — the agent settled: spoke, paused, aborted, or errored.
 * - `yield` — the agent called the hidden `yield` tool. Not universal (it is
 *   opt-in per agent) and can repeat: the task executor re-demands a fresh yield
 *   when an async result supersedes an earlier one.
 * - `done` — the agent's final-output artifact appeared. This is the reliable
 *   "finished work" signal for every subagent, including those that never yield.
 *   Fires once per agent.
 */
export type TurnEvent = "turn" | "yield" | "done";

/** One finished unit of observed work. This is what a filter sees. */
export type TurnRecord = {
	source: TurnSource;
	event: TurnEvent;
	/** Timestamp of the entry, or artifact mtime, that closed the record. */
	timestamp: string;
	/** Text that opened the turn; "" when nothing opened it (auto-continued work). */
	userText: string;
	/** Every assistant text block emitted during the turn, concatenated. */
	assistantText: string;
	/**
	 * `toolUse` on a `yield` record, whose message is mid-loop by construction.
	 * Absent on `done`, which is derived from an artifact rather than a message.
	 */
	stopReason?: TerminalStopReason | "toolUse";
	/** Every tool call made during the turn, in order. Empty for `done`. */
	toolCalls: ShadowToolCall[];
	/** The `yield` argument, or the final output for a `done` record. */
	result?: string;
};

/** A shadow definition: the default export of a shadow file. */
export type ShadowDef = {
	/** Model selector resolved by ModelRegistry, e.g. "haiku". Omit for the session default. */
	model?: string;
	/** Tools the shadow may use. Default: read, grep, glob, bash. */
	tools?: string[];
	/**
	 * Standing instruction. Injected through `appendSystemPrompt`, so it survives
	 * compaction: compaction rewrites conversation entries, never the system prompt.
	 */
	instruction: string;
	/**
	 * Transcripts to observe. Default `["main"]` — a fan-out session can hold
	 * hundreds of subagent transcripts, so watching them is opt-in.
	 */
	sources?: SourceKind[];
	/** Pure predicate over a finished record. Omit to match everything observed. */
	filter?: (turn: TurnRecord) => boolean;
	/**
	 * Hold a matched wakeup this long before prompting; each further match resets
	 * the timer. Guards against acting on a half-finished burst of work. Default 0.
	 */
	debounceMs?: number;
};
