#!/usr/bin/env bun
/**
 * Offline check for record detection: replay a finished session tree — the main
 * transcript plus every subagent transcript — through the assemblers and report
 * what it found. No model, no writes.
 *
 * With a shadow def, also reports which records its filter would have woken,
 * so a filter can be dry-run against real history before spending anything.
 */
import { existsSync, statSync } from "node:fs";
import { loadDef } from "../src/def";
import { scanArtifactTree } from "../src/sources";
import { createTurnAssembler, renderWakeup, sourceLabel } from "../src/turns";
import type { ExitFact } from "../src/turns";
import type { ObservedSource } from "../src/sources";
import type { TurnRecord } from "../src/types";

const [file, defPath] = process.argv.slice(2);
if (!file) {
	process.stderr.write("usage: bun scripts/smoke-turns.ts <session.jsonl> [def.ts]\n");
	process.exit(2);
}

const def = defPath ? await loadDef(defPath) : undefined;
const scan = scanArtifactTree(file);

// Mirror what the def would actually observe, so wake counts are faithful. With
// no def, show the whole tree for exploration.
const sources = def ? (def.sources ?? ["main"]) : ["main", "subagent"];

const records: TurnRecord[] = [];
const observed: ObservedSource[] = [
	...(sources.includes("main") ? [{ file, source: { kind: "main" as const, agent: "main", depth: 0 } }] : []),
	...(sources.includes("subagent") ? scan.transcripts : []),
];

// The observed session's own exit makes outstanding agents decidably gone.
let sessionExited = false;
const exits = new Map<string, ExitFact>();

for (const { file: transcript, source } of observed) {
	const assemble = createTurnAssembler(source, {
		onTurn: turn => records.push(turn),
		onExit: fact => {
			if (source.kind === "main") sessionExited = true;
			else exits.set(transcript, fact);
		},
	});
	let text: string;
	try {
		text = await Bun.file(transcript).text();
	} catch {
		continue;
	}
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			assemble(JSON.parse(trimmed));
		} catch {
			// Lenient, matching the session loader.
		}
	}
}

// Mirror the watcher's arbitration exactly, so wake counts are faithful: an
// output artifact is `done`; its absence plus a terminal fact is `gone`.
for (const { file: transcript, source } of sources.includes("subagent") ? scan.transcripts : []) {
	const output = transcript.replace(/\.jsonl$/, ".md");
	if (existsSync(output)) {
		try {
			records.push({
				source,
				event: "done",
				timestamp: statSync(output).mtime.toISOString(),
				userText: "",
				assistantText: "",
				toolCalls: [],
				result: await Bun.file(output).text(),
			});
		} catch {
			// Unreadable artifact: nothing to report.
		}
		continue;
	}
	const exit = exits.get(transcript);
	const reason = existsSync(`${transcript}.tombstone`) ? "killed" : exit ? "exited" : sessionExited ? "abandoned" : undefined;
	if (!reason) continue;
	records.push({
		source,
		event: "gone",
		timestamp: exit?.timestamp ?? new Date().toISOString(),
		userText: "",
		assistantText: "",
		toolCalls: [],
		gone: { reason, exitKind: exit?.kind, exitReason: exit?.reason, pendingToolCalls: exit?.pendingToolCalls },
	});
}

records.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
const matches = new Set(records.filter(turn => (def?.filter ? def.filter(turn) : true)));

const byKind: Record<string, number> = {};
for (const turn of records) {
	const key = `${turn.source.kind}/${turn.event}`;
	byKind[key] = (byKind[key] ?? 0) + 1;
}

process.stdout.write(`sources:       ${sources.join(", ")}\n`);
process.stdout.write(`transcripts:   ${observed.length}\n`);
process.stdout.write(`records:       ${records.length}\n`);
for (const [key, count] of Object.entries(byKind).sort()) {
	process.stdout.write(`  ${key.padEnd(18)} ${count}\n`);
}
if (def) process.stdout.write(`filter wakes:  ${matches.size}\n`);
process.stdout.write("\n");

for (const turn of records.slice(0, 40)) {
	const mark = def ? (matches.has(turn) ? "▸" : " ") : " ";
	const tools = turn.toolCalls.length > 0 ? ` tools=${turn.toolCalls.length}` : "";
	process.stdout.write(`${mark} ${turn.timestamp} ${turn.event.padEnd(5)} ${sourceLabel(turn.source)}${tools}\n`);
}

// Preview what the shadow would actually be handed: the last matching record.
const preview = [...matches].at(-1) ?? records.at(-1);
if (preview) {
	process.stdout.write(`\n--- renderWakeup([last match]) ---\n${renderWakeup([preview])}\n`);
}
