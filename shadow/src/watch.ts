import { existsSync, statSync } from "node:fs";
import { type ArtifactScan, scanArtifactTree } from "./sources";
import { type TailHandle, tailJsonl } from "./tail";
import { createTurnAssembler } from "./turns";
import type { ExitFact } from "./turns";
import type { GoneReason, SourceKind, TurnRecord, TurnSource } from "./types";

export type WatchOptions = {
	/** The main session transcript. Its artifact tree holds subagent work. */
	sessionFile: string;
	/** Which transcripts produce records. */
	sources: SourceKind[];
	/** Process work already recorded at startup. */
	replay: boolean;
	/** How often to look for work that appeared after startup. Default 1000ms. */
	rescanMs?: number;
	onTurn: (turn: TurnRecord) => void;
	onSourceAttached?: (source: TurnSource) => void;
};

export type WatchHandle = {
	stop: () => void;
	/** Transcripts currently attached. */
	attached: () => number;
};

/** Longest output artifact fed to a shadow; the rest is elided. */
const MAX_OUTPUT_CHARS = 4000;

/** Lifecycle of one observed subagent, as far as its files reveal it. */
type AgentState = {
	source: TurnSource;
	/** Where its final output would land. */
	outputFile: string;
	/** Kill marker the harness writes beside a transcript. */
	tombstoneFile: string;
	/** Last observed artifact size, for settle detection. */
	lastSize?: number;
	delivered: boolean;
	exit?: ExitFact;
	reported: boolean;
};

/**
 * Observe a whole session tree: the main transcript, every subagent transcript
 * (including ones spawned mid-run), every subagent's final output, and the
 * terminal facts that say an agent finished with nothing.
 *
 * Each transcript gets its own assembler, since records are per-conversation.
 * Transcripts present at startup follow `replay`; ones appearing later are new
 * work and are always read from the start, so a subagent spawned while the
 * shadow runs is never observed from its middle.
 *
 * The main transcript is always tailed even when it produces no records: its
 * `session_exit` is what makes "this agent will never deliver" decidable.
 */
export function watchSessionTree(options: WatchOptions): WatchHandle {
	const tails = new Map<string, TailHandle>();
	const agents = new Map<string, AgentState>();
	const watchSubagents = options.sources.includes("subagent");
	let stopped = false;
	let sweeping = false;
	let sessionExited = false;

	function attach(file: string, source: TurnSource, fromEnd: boolean, emitRecords: boolean): void {
		if (stopped || tails.has(file)) return;
		const assemble = createTurnAssembler(source, {
			onTurn: turn => {
				if (emitRecords) options.onTurn(turn);
			},
			onExit: fact => {
				if (source.kind === "main") {
					// The observed session tore down: nothing more can be delivered, so
					// every agent still without output is decidably gone.
					sessionExited = true;
					return;
				}
				const state = agents.get(file);
				if (state) state.exit = fact;
			},
		});
		tails.set(file, tailJsonl(file, { fromEnd }, assemble));
		if (emitRecords) options.onSourceAttached?.(source);
	}

	function register(found: ArtifactScan["transcripts"][number]): void {
		if (agents.has(found.file)) return;
		agents.set(found.file, {
			source: found.source,
			outputFile: found.file.replace(/\.jsonl$/, ".md"),
			tombstoneFile: `${found.file}.tombstone`,
			delivered: false,
			reported: false,
		});
	}

	/**
	 * Report an agent that produced no result. Every reason is a definitive
	 * observation, never a timeout — a merely slow agent is left alone.
	 */
	function reportGone(state: AgentState, reason: GoneReason): void {
		state.reported = true;
		options.onTurn({
			source: state.source,
			event: "gone",
			timestamp: state.exit?.timestamp ?? new Date().toISOString(),
			userText: "",
			assistantText: "",
			toolCalls: [],
			gone: {
				reason,
				exitKind: state.exit?.kind,
				exitReason: state.exit?.reason,
				pendingToolCalls: state.exit?.pendingToolCalls?.length ? state.exit.pendingToolCalls : undefined,
			},
		});
	}

	/**
	 * Settle each agent's outcome. Output artifacts are only read once their size
	 * stops changing, so a shadow never receives a half-written result.
	 */
	async function sweep(): Promise<void> {
		for (const state of agents.values()) {
			if (state.reported) continue;

			if (existsSync(state.outputFile)) {
				let size: number;
				let mtime: Date;
				try {
					const stat = statSync(state.outputFile);
					size = stat.size;
					mtime = stat.mtime;
				} catch {
					continue;
				}
				const settled = state.lastSize === size;
				state.lastSize = size;
				if (!settled) continue;

				let result: string;
				try {
					result = await Bun.file(state.outputFile).text();
				} catch {
					continue;
				}
				state.delivered = true;
				state.reported = true;
				options.onTurn({
					source: state.source,
					event: "done",
					timestamp: mtime.toISOString(),
					userText: "",
					assistantText: "",
					toolCalls: [],
					result: result.length > MAX_OUTPUT_CHARS ? `${result.slice(0, MAX_OUTPUT_CHARS)}…` : result,
				});
				continue;
			}

			// No output. Report only on a terminal fact, in order of directness.
			if (existsSync(state.tombstoneFile)) reportGone(state, "killed");
			else if (state.exit) reportGone(state, "exited");
			else if (sessionExited) reportGone(state, "abandoned");
		}
	}

	// Always tail the main transcript: even when it emits no records, its
	// `session_exit` is the signal that resolves outstanding agents.
	attach(options.sessionFile, { kind: "main", agent: "main", depth: 0 }, !options.replay, options.sources.includes("main"));

	let rescan: Timer | undefined;
	if (watchSubagents) {
		const initial = scanArtifactTree(options.sessionFile);
		for (const found of initial.transcripts) {
			register(found);
			attach(found.file, found.source, !options.replay, true);
		}
		if (!options.replay) {
			// Work already finished before we attached is history, not news.
			for (const state of agents.values()) {
				if (existsSync(state.outputFile)) state.reported = true;
			}
		}

		rescan = setInterval(() => {
			if (stopped || sweeping) return;
			sweeping = true;
			const scan = scanArtifactTree(options.sessionFile);
			for (const found of scan.transcripts) {
				register(found);
				attach(found.file, found.source, false, true);
			}
			void sweep().finally(() => {
				sweeping = false;
			});
		}, options.rescanMs ?? 1000);
	}

	return {
		attached: () => tails.size,
		stop: () => {
			stopped = true;
			clearInterval(rescan);
			for (const tail of tails.values()) tail.stop();
			tails.clear();
		},
	};
}
