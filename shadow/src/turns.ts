import type { ShadowToolCall, TerminalStopReason, TurnEvent, TurnRecord, TurnSource } from "./types";

const CONTINUABLE_STOP_REASONS: Record<string, true> = { stop: true, length: true };

/** The tool a subagent calls to hand its result back to its parent. */
const YIELD_TOOL = "yield";

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
	arguments?: unknown;
	intent?: string;
};

type SessionMessage = {
	role?: string;
	stopReason?: string | null;
	content?: ContentBlock[];
};

type SessionEntry = {
	type?: string;
	timestamp?: string;
	message?: SessionMessage;
	/** `custom_message` payload: injected context rendered into the conversation. */
	content?: unknown;
	customType?: string;
	/** `custom` record payload, e.g. `session_exit`. */
	data?: unknown;
};

/**
 * Whether an assistant message ends the agent loop, mirroring pi-agent-core.
 *
 * - `aborted` / `error` always stop, tool calls or not: the loop pairs placeholder
 *   results and ends the turn (`agent-loop.ts` `isAbortedOrError`).
 * - `stop` / `length` stop only with no tool calls left to run — `runnableStop`
 *   covers `stop`, and `length` continues while tool results exist.
 * - `toolUse` never stops.
 */
function isTurnEnd(message: SessionMessage): boolean {
	if (message.role !== "assistant") return false;
	const reason = message.stopReason;
	if (!reason) return false;
	if (reason === "aborted" || reason === "error") return true;
	if (!CONTINUABLE_STOP_REASONS[reason]) return false;
	return !message.content?.some(block => block.type === "toolCall");
}

function textOf(message: SessionMessage): string {
	const parts: string[] = [];
	for (const block of message.content ?? []) {
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n").trim();
}

function asText(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	return JSON.stringify(value);
}

/** What a transcript's `session_exit` record says. */
export type ExitFact = {
	kind?: string;
	reason?: string;
	pendingToolCalls?: string[];
	timestamp: string;
};

export type AssemblerHandlers = {
	onTurn: (turn: TurnRecord) => void;
	/**
	 * The transcript recorded `session_exit`: its session tore down. Reported as a
	 * fact rather than a record, because whether it means "finished and delivered"
	 * or "gone with nothing" depends on the output artifact, which the watcher owns.
	 */
	onExit?: (fact: ExitFact) => void;
};

/**
 * Fold one transcript's entries into finished records.
 *
 * One assembler per transcript file: interleaving entries from different agents
 * through a single assembler would splice unrelated work into one record.
 *
 * A user message resets the accumulator, so an interrupted turn cannot leak into
 * the next record — mid-turn steering also resets, which intentionally scopes the
 * record to post-steer work. Turns triggered by injected context rather than a
 * user message take their opener from the `custom_message` entry.
 */
export function createTurnAssembler(source: TurnSource, handlers: AssemblerHandlers): (entry: unknown) => void {
	const onTurn = handlers.onTurn;
	let userText = "";
	let assistantText = "";
	let toolCalls: ShadowToolCall[] = [];

	function emit(event: TurnEvent, entry: SessionEntry, message: SessionMessage, result?: string): void {
		onTurn({
			source,
			event,
			timestamp: entry.timestamp ?? new Date().toISOString(),
			userText,
			assistantText,
			stopReason: (message.stopReason ?? "stop") as TerminalStopReason | "toolUse",
			toolCalls,
			result,
		});
		userText = "";
		assistantText = "";
		toolCalls = [];
	}

	return (raw: unknown) => {
		const entry = raw as SessionEntry | null;
		if (!entry) return;

		if (entry.type === "custom" && entry.customType === "session_exit") {
			const data = (entry.data ?? {}) as {
				kind?: unknown;
				reason?: unknown;
				pendingToolCalls?: { toolName?: unknown }[];
			};
			handlers.onExit?.({
				kind: typeof data.kind === "string" ? data.kind : undefined,
				reason: typeof data.reason === "string" ? data.reason : undefined,
				pendingToolCalls: data.pendingToolCalls
					?.map(call => (typeof call?.toolName === "string" ? call.toolName : ""))
					.filter(name => name.length > 0),
				timestamp: entry.timestamp ?? new Date().toISOString(),
			});
			return;
		}

		if (entry.type === "custom_message") {
			// An injected message can open a turn (`triggerTurn`) or land mid-turn
			// (reminders, TTSR, async-result). Only adopt it as the opener when nothing
			// has accumulated yet, so a mid-turn injection cannot drop tool calls.
			if (userText || assistantText || toolCalls.length > 0) return;
			const content = asText(entry.content).trim();
			if (content) userText = `${entry.customType ? `[${entry.customType}] ` : ""}${content}`;
			return;
		}

		if (entry.type !== "message" || !entry.message) return;
		const message = entry.message;

		// Everything that is not the assistant or a tool result is user-side input:
		// `user`, plus `developer` (injected instructions), `bashExecution` (`!cmd`),
		// and `fileMention` (`@file`). Consecutive user-side entries belong to the
		// same opener; one arriving mid-turn is a steer and starts a new turn.
		if (message.role !== "assistant") {
			if (message.role === "toolResult") return;
			const label = message.role === "user" ? "" : `[${message.role}] `;
			const text = textOf(message);
			if (assistantText || toolCalls.length > 0) {
				assistantText = "";
				toolCalls = [];
				userText = text ? `${label}${text}` : "";
				return;
			}
			if (text) userText = userText ? `${userText}\n${label}${text}` : `${label}${text}`;
			return;
		}

		const text = textOf(message);
		if (text) assistantText = assistantText ? `${assistantText}\n${text}` : text;

		let yieldResult: string | undefined;
		for (const block of message.content ?? []) {
			if (block.type !== "toolCall") continue;
			const args = (block.arguments ?? {}) as Record<string, unknown>;
			const name = typeof block.name === "string" ? block.name : "unknown";
			toolCalls.push({
				name,
				args,
				intent: typeof block.intent === "string" ? block.intent : undefined,
			});
			if (name === YIELD_TOOL) yieldResult = asText(args.result);
		}

		// A yield closes a unit of work even though the message is mid-loop
		// (`stopReason: "toolUse"`), which is why subagent completion is invisible
		// to turn-end detection alone.
		if (yieldResult !== undefined) {
			emit("yield", entry, message, yieldResult);
			return;
		}
		if (isTurnEnd(message)) emit("turn", entry, message);
	};
}

/** Argument keys worth showing in a digest, most identifying first. */
const DIGEST_ARG_KEYS = ["path", "command", "pattern", "file", "url", "query", "name"];

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function summarizeCall(call: ShadowToolCall): string {
	for (const key of DIGEST_ARG_KEYS) {
		const value = call.args[key];
		if (typeof value === "string" && value.length > 0) {
			return `${call.name}(${truncate(value.replace(/\s+/g, " "), 120)})`;
		}
	}
	return call.name;
}

/** How a record's origin reads in a digest. */
export function sourceLabel(source: TurnSource): string {
	return source.kind === "main" ? "main session" : `subagent ${source.agent}`;
}

const EVENT_HEADLINES: Record<string, string> = {
	done: "finished, output available",
	yield: "handed back a result (yield)",
};

const GONE_HEADLINES: Record<string, string> = {
	killed: "was killed without producing a result",
	exited: "exited without producing a result",
	abandoned: "never produced a result before the observed session ended",
};

function headline(turn: TurnRecord): string {
	if (turn.event === "gone" && turn.gone) {
		const detail = turn.gone.exitKind ? ` [${turn.gone.exitKind}/${turn.gone.exitReason ?? "?"}]` : "";
		// A stuck agent can leave dozens of pending calls; distinct names carry the
		// diagnostic value, the repetition does not.
		const names = [...new Set(turn.gone.pendingToolCalls ?? [])];
		const shown = names.slice(0, 5).join(", ");
		const rest = names.length > 5 ? ` +${names.length - 5} more` : "";
		const count = turn.gone.pendingToolCalls?.length ?? 0;
		const pending = count > 0 ? ` mid-flight: ${shown}${rest} (${count} call${count === 1 ? "" : "s"})` : "";
		return `${sourceLabel(turn.source)} ${GONE_HEADLINES[turn.gone.reason]}${detail}${pending} — ${turn.timestamp}`;
	}
	const what = EVENT_HEADLINES[turn.event] ?? `settled (${turn.stopReason ?? "unknown"})`;
	return `${sourceLabel(turn.source)} ${what} — ${turn.timestamp}`;
}

/** Render the prompt that wakes the shadow for a batch of matched records. */
export function renderWakeup(turns: TurnRecord[]): string {
	const lines: string[] = [];
	lines.push(
		turns.length === 1
			? "One matching event in the session you are observing."
			: `${turns.length} matching events in the session you are observing. They queued while you were busy; oldest first.`,
	);
	lines.push("");

	for (const [index, turn] of turns.entries()) {
		lines.push(`### ${index + 1}/${turns.length} — ${headline(turn)}`);
		if (turn.userText) lines.push(`Asked: ${truncate(turn.userText, 400)}`);
		if (turn.toolCalls.length > 0) {
			lines.push(`Tools: ${truncate(turn.toolCalls.map(summarizeCall).join(", "), 900)}`);
		}
		if (turn.assistantText) lines.push(`Said: ${truncate(turn.assistantText, 600)}`);
		if (turn.result) lines.push(`Result: ${truncate(turn.result, 800)}`);
		lines.push("");
	}

	lines.push("Act on your standing instruction now, then end your turn.");
	return lines.join("\n");
}
