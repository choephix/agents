import { mkdirSync } from "node:fs";
import path from "node:path";
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { newShadowSessionFile, shadowSessionDir } from "./paths";
import { renderWakeup } from "./turns";
import type { ShadowDef, TurnRecord } from "./types";

const DEFAULT_TOOLS = ["read", "grep", "glob", "bash"];

const dim = (text: string): string => `\x1b[2m${text}\x1b[0m`;
const bold = (text: string): string => `\x1b[1m${text}\x1b[0m`;

/**
 * The shadow's standing context. Goes through `appendSystemPrompt`, so it is
 * rebuilt from options on every prompt and is untouched by compaction.
 */
function buildShadowPrompt(instruction: string): string {
	return [
		"## Shadow agent role",
		"",
		'You are a shadow agent. You observe another live session (the "main session") that you do not control and cannot talk to. You are not conversing with a human: never ask questions, never offer follow-ups, never request approval.',
		"",
		"Every time you are prompted, a deterministic filter has already matched one or more finished turns of the main session, and the prompt carries a digest of them. Nothing else can wake you, and turns that did not match are never shown to you. Between wakeups you do not run at all, so never plan to wait, poll, or check back later — do the work now and end your turn.",
		"",
		"The main session may still be running and changing files while you work. Treat the digest as a record of what happened, not as the current state: verify anything that matters with your own tools before acting on it.",
		"",
		"### Standing instruction",
		"",
		instruction,
	].join("\n");
}

export type Shadow = {
	/** Offer a finished record; ignored unless the filter matches. */
	enqueue: (turn: TurnRecord) => void;
	dispose: () => Promise<void>;
	/** Resolved model id, for the startup banner. */
	model: string;
	/** The shadow's own session file, resumable with `omp --session`. */
	sessionFile: string | undefined;
};

export type ShadowOptions = {
	/**
	 * The budget ran out: this shadow will not wake again. Called once, after the
	 * turn that crossed the ceiling has finished.
	 */
	onExhausted?: () => void;
};

export async function createShadow(def: ShadowDef, cwd: string, options: ShadowOptions = {}): Promise<Shadow> {
	const sessionFile = newShadowSessionFile(cwd);
	mkdirSync(path.dirname(sessionFile), { recursive: true });
	// `open` on a not-yet-existing path creates the session there. Explicit dir keeps
	// shadows out of the project's session list; suppressed breadcrumb keeps them out
	// of this terminal's `omp --continue`.
	const sessionManager = await SessionManager.open(sessionFile, shadowSessionDir(cwd), undefined, {
		initialCwd: cwd,
		suppressBreadcrumb: true,
	});
	const { session, modelFallbackMessage } = await createAgentSession({
		cwd,
		sessionManager,
		modelPattern: def.model,
		toolNames: def.tools ?? DEFAULT_TOOLS,
		restrictToolNames: true,
		hasUI: false,
		enableLsp: false,
		appendSystemPrompt: buildShadowPrompt(def.instruction),
	});
	if (modelFallbackMessage) process.stderr.write(`${dim(`model fallback: ${modelFallbackMessage}`)}\n`);

	// Accumulate as turns finish rather than summing `session.messages`: compaction
	// drops entries, so a running total taken from the message list silently shrinks
	// and a ceiling taken from it would never trip.
	let tokensSpent = 0;
	let costSpent = 0;

	session.subscribe(event => {
		if (event.type === "message_update") {
			if (event.assistantMessageEvent.type === "text_delta") {
				process.stdout.write(event.assistantMessageEvent.delta);
			}
			return;
		}
		if (event.type === "tool_execution_start") {
			const args = event.args as Record<string, unknown> | undefined;
			const detail = typeof args?.command === "string" ? args.command : typeof args?.path === "string" ? args.path : "";
			const suffix = detail ? ` ${detail.replace(/\s+/g, " ").slice(0, 100)}` : "";
			process.stdout.write(dim(`\n  · ${event.toolName}${suffix}\n`));
			return;
		}
		if (event.type === "turn_end" && event.message.role === "assistant") {
			const usage = event.message.usage;
			if (!usage) return;
			tokensSpent += usage.totalTokens ?? 0;
			costSpent += usage.cost?.total ?? 0;
		}
	});

	function overBudget(): boolean {
		return (
			(def.maxTokens !== undefined && tokensSpent >= def.maxTokens) ||
			(def.maxCostUsd !== undefined && costSpent >= def.maxCostUsd)
		);
	}

	function spentLabel(): string {
		const tokens = `${(tokensSpent / 1000).toFixed(1)}k tok`;
		const cost = costSpent > 0 ? `, $${costSpent.toFixed(4)}` : "";
		return `${tokens}${cost}`;
	}

	const queue: TurnRecord[] = [];
	let busy = false;
	let timer: Timer | undefined;

	let exhausted = false;

	async function flush(): Promise<void> {
		if (busy || exhausted || queue.length === 0) return;
		// Checked between wakeups, never mid-turn: the crossing turn runs to completion
		// rather than being cut off halfway through its work.
		if (overBudget()) {
			exhausted = true;
			queue.length = 0;
			process.stdout.write(`\n${bold("▪ budget spent")} ${dim(`${spentLabel()} — not waking again`)}\n`);
			options.onExhausted?.();
			return;
		}
		busy = true;
		const batch = queue.splice(0);
		const label = `${batch.length} event${batch.length === 1 ? "" : "s"}`;
		process.stdout.write(`\n${bold(`▸ waking on ${label}`)} ${dim(new Date().toLocaleTimeString())}\n`);
		try {
			await session.prompt(renderWakeup(batch));
		} catch (error) {
			process.stderr.write(`\nshadow: prompt failed: ${error instanceof Error ? error.message : String(error)}\n`);
		} finally {
			busy = false;
		}
		process.stdout.write(`\n${dim(`— idle — ${spentLabel()}`)}\n`);
		// Records that matched while we were prompting batch into the next wakeup.
		await flush();
	}

	function enqueue(turn: TurnRecord): void {
		if (exhausted) return;
		let matched: boolean;
		try {
			matched = def.filter ? def.filter(turn) === true : true;
		} catch (error) {
			process.stderr.write(`shadow: filter threw, skipping turn: ${error instanceof Error ? error.message : String(error)}\n`);
			return;
		}
		if (!matched) return;
		queue.push(turn);
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			void flush();
		}, def.debounceMs ?? 0);
	}

	return {
		enqueue,
		model: session.model?.id ?? def.model ?? "unknown",
		sessionFile: sessionManager.getSessionFile(),
		dispose: async () => {
			clearTimeout(timer);
			await session.dispose();
		},
	};
}
