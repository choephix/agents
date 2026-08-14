#!/usr/bin/env bun
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { loadDef } from "./src/def";
import { createShadow } from "./src/driver";
import { sourceLabel } from "./src/turns";
import { watchSessionTree } from "./src/watch";

const USAGE = `usage: shadow [--session <idOrPrefix>] [--replay] <def.ts>

  --session <ref>  attach to a session whose filename contains <ref>
                   (default: most recently modified session for this cwd)
  --replay         also process records already in the transcripts
                   (default: only work that finishes from now on)

A def's \`sources\` decides what is observed: the main transcript, subagent
transcripts (including ones spawned later), or both.
`;

type CliArgs = { sessionRef: string | undefined; replay: boolean; defPath: string };

function parseArgs(argv: string[]): CliArgs {
	let sessionRef: string | undefined;
	let replay = false;
	let defPath: string | undefined;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] as string;
		if (arg === "--session") sessionRef = argv[++index];
		else if (arg.startsWith("--session=")) sessionRef = arg.slice("--session=".length);
		else if (arg === "--replay") replay = true;
		else if (arg === "-h" || arg === "--help") {
			process.stdout.write(USAGE);
			process.exit(0);
		} else if (arg.startsWith("-")) {
			process.stderr.write(`shadow: unknown flag ${arg}\n\n${USAGE}`);
			process.exit(2);
		} else defPath = arg;
	}

	if (!defPath) {
		process.stderr.write(USAGE);
		process.exit(2);
	}
	return { sessionRef, replay, defPath };
}

/**
 * Pick the session to observe. Resolved before the shadow's own session exists,
 * so the newest-file default can never select the shadow itself.
 */
function resolveTarget(cwd: string, ref: string | undefined): string {
	const dir = SessionManager.getDefaultSessionDir(cwd);
	let names: string[];
	try {
		names = readdirSync(dir).filter(name => name.endsWith(".jsonl"));
	} catch {
		throw new Error(`no session directory for ${cwd} (looked in ${dir})`);
	}
	const candidates = ref ? names.filter(name => name.includes(ref)) : names;
	if (candidates.length === 0) {
		throw new Error(ref ? `no session matching "${ref}" in ${dir}` : `no sessions in ${dir}`);
	}
	const newest = candidates
		.map(name => path.join(dir, name))
		.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
	return newest as string;
}

const { sessionRef, replay, defPath } = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const target = resolveTarget(cwd, sessionRef);
const def = await loadDef(defPath);
const shadow = await createShadow(def, cwd);
const sources = def.sources ?? ["main"];
const dim = (text: string): string => `\x1b[2m${text}\x1b[0m`;

let banneredStartup = false;
const watch = watchSessionTree({
	sessionFile: target,
	sources,
	replay,
	onTurn: shadow.enqueue,
	onSourceAttached: source => {
		// Startup attachments are summarized in the banner; later ones are new
		// agents spawning while we watch, which is worth announcing.
		if (banneredStartup && source.kind === "subagent") {
			process.stdout.write(dim(`  + ${sourceLabel(source)}\n`));
		}
	},
});

process.stdout.write(
	[
		`shadow: ${path.basename(defPath)}`,
		`  observing  ${target}${replay ? " (replaying existing records)" : ""}`,
		`  sources    ${sources.join(", ")} — ${watch.attached()} transcript(s) attached`,
		`  model      ${shadow.model}`,
		`  tools      ${(def.tools ?? ["read", "grep", "glob", "bash"]).join(", ")}`,
		`  filter     ${def.filter ? "custom" : "match everything observed"}${def.debounceMs ? `, debounce ${def.debounceMs}ms` : ""}`,
		`  session    ${shadow.sessionFile ?? "(pending)"}`,
		dim(`             inspect: omp --session-dir=${path.dirname(shadow.sessionFile ?? "")} --session=${path.basename(shadow.sessionFile ?? "", ".jsonl")}`),
		dim("  waiting for matching work — Ctrl+C to stop"),
		"",
	].join("\n"),
);
banneredStartup = true;

let closing = false;
async function shutdown(): Promise<void> {
	if (closing) return;
	closing = true;
	process.stdout.write(dim("\nshadow: stopping\n"));
	watch.stop();
	await shadow.dispose();
	process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
