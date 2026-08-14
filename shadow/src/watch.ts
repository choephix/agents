import { statSync } from "node:fs";
import { type ArtifactScan, scanArtifactTree } from "./sources";
import { type TailHandle, tailJsonl } from "./tail";
import { createTurnAssembler } from "./turns";
import type { SourceKind, TurnRecord, TurnSource } from "./types";

export type WatchOptions = {
	/** The main session transcript. Its artifact tree holds subagent work. */
	sessionFile: string;
	/** Which transcripts to observe. */
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

/**
 * Observe a whole session tree: the main transcript, every subagent transcript
 * (including ones spawned mid-run), and every subagent's final output artifact.
 *
 * Each transcript gets its own assembler, since records are per-conversation.
 * Transcripts present at startup follow `replay`; ones appearing later are new
 * work and are always read from the start, so a subagent spawned while the
 * shadow runs is never observed from its middle.
 */
export function watchSessionTree(options: WatchOptions): WatchHandle {
	const tails = new Map<string, TailHandle>();
	const outputSizes = new Map<string, number>();
	const reportedOutputs = new Set<string>();
	let stopped = false;
	let sweeping = false;

	function attach(file: string, source: TurnSource, fromEnd: boolean): void {
		if (stopped || tails.has(file)) return;
		tails.set(file, tailJsonl(file, { fromEnd }, createTurnAssembler(source, options.onTurn)));
		options.onSourceAttached?.(source);
	}

	/**
	 * Report agents whose output artifact has stopped growing. Waiting for a
	 * stable size across two passes avoids handing a shadow a half-written result.
	 */
	async function sweepOutputs(outputs: ArtifactScan["outputs"]): Promise<void> {
		for (const { file, source } of outputs) {
			if (reportedOutputs.has(file)) continue;
			let size: number;
			let mtime: Date;
			try {
				const stat = statSync(file);
				size = stat.size;
				mtime = stat.mtime;
			} catch {
				continue;
			}
			const previous = outputSizes.get(file);
			outputSizes.set(file, size);
			if (previous !== size) continue;

			reportedOutputs.add(file);
			let result: string;
			try {
				result = await Bun.file(file).text();
			} catch {
				continue;
			}
			options.onTurn({
				source,
				event: "done",
				timestamp: mtime.toISOString(),
				userText: "",
				assistantText: "",
				toolCalls: [],
				result: result.length > MAX_OUTPUT_CHARS ? `${result.slice(0, MAX_OUTPUT_CHARS)}…` : result,
			});
		}
	}

	if (options.sources.includes("main")) {
		attach(options.sessionFile, { kind: "main", agent: "main", depth: 0 }, !options.replay);
	}

	let rescan: Timer | undefined;
	if (options.sources.includes("subagent")) {
		const initial = scanArtifactTree(options.sessionFile);
		for (const found of initial.transcripts) attach(found.file, found.source, !options.replay);
		if (!options.replay) {
			// Outputs already on disk are history, not work finishing now.
			for (const found of initial.outputs) reportedOutputs.add(found.file);
		}

		rescan = setInterval(() => {
			if (stopped || sweeping) return;
			sweeping = true;
			const scan = scanArtifactTree(options.sessionFile);
			for (const found of scan.transcripts) attach(found.file, found.source, false);
			void sweepOutputs(scan.outputs).finally(() => {
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
