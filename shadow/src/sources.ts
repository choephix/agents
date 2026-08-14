import { readdirSync } from "node:fs";
import path from "node:path";
import type { TurnSource } from "./types";

/** A file in the artifact tree plus the agent it belongs to. */
export type ObservedSource = {
	file: string;
	source: TurnSource;
};

/** One pass over a session's artifact tree. */
export type ArtifactScan = {
	/** Subagent transcripts (`<Agent>.jsonl`). */
	transcripts: ObservedSource[];
	/**
	 * Subagent final-output artifacts (`<Agent>.md`). Their appearance is the
	 * universal completion signal: measured 159/159 transcripts had one, while
	 * only 126 called the hidden, opt-in `yield` tool.
	 */
	outputs: ObservedSource[];
};

const JSONL = ".jsonl";
const OUTPUT = ".md";

/**
 * Scan a session's artifact tree for subagent transcripts and outputs.
 *
 * Depth-1 files are direct subagents (`Worker.jsonl`); nested directories hold
 * subagents of subagents with dot-qualified names (`Worker/Worker.Child.jsonl`).
 *
 * Excluded: `local/` (that is `local://` payload storage, not agent output) and
 * `__advisor*` (observability records, not agents whose work you can act on).
 */
export function scanArtifactTree(sessionFile: string): ArtifactScan {
	// The artifact tree sits beside the session file, at its path minus `.jsonl`.
	const dir = sessionFile.endsWith(JSONL) ? sessionFile.slice(0, -JSONL.length) : sessionFile;
	let names: string[];
	try {
		names = readdirSync(dir, { recursive: true, encoding: "utf8" });
	} catch {
		// No artifact directory yet: this session has not spawned any subagent.
		return { transcripts: [], outputs: [] };
	}

	const scan: ArtifactScan = { transcripts: [], outputs: [] };
	for (const name of names) {
		const parts = name.split(path.sep);
		if (parts[0] === "local") continue;
		const base = path.basename(name);
		if (base.startsWith("__advisor")) continue;

		const suffix = base.endsWith(JSONL) ? JSONL : base.endsWith(OUTPUT) ? OUTPUT : undefined;
		if (!suffix) continue;
		const found: ObservedSource = {
			file: path.join(dir, name),
			source: { kind: "subagent", agent: base.slice(0, -suffix.length), depth: parts.length },
		};
		if (suffix === JSONL) scan.transcripts.push(found);
		else scan.outputs.push(found);
	}
	return scan;
}
