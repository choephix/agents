import { type FSWatcher, watch } from "node:fs";

export type TailHandle = { stop: () => void };

export type TailOptions = {
	/** Start at end of file, ignoring existing history. */
	fromEnd: boolean;
	/** Poll interval backing up fs.watch. Default 500ms. */
	pollMs?: number;
};

/**
 * Follow an append-only JSONL file, emitting one parsed object per complete line.
 *
 * Session files are appended incrementally but can also be atomically rewritten
 * (migrations, rename, move/fork) — a rename-over swaps the inode out from under
 * `fs.watch`, so a path-reopening poll backs it up and a shrunken file resets the
 * read offset. Unparseable lines are skipped, matching the lenient session loader.
 */
export function tailJsonl(file: string, options: TailOptions, onEntry: (entry: unknown) => void): TailHandle {
	let offset = options.fromEnd ? Bun.file(file).size : 0;
	let remainder = "";
	let reading = false;
	let pending = false;
	let stopped = false;

	async function pump(): Promise<void> {
		if (stopped) return;
		if (reading) {
			pending = true;
			return;
		}
		reading = true;
		try {
			const handle = Bun.file(file);
			const size = handle.size;
			if (size < offset) {
				// Truncated or rewritten underneath us: restart from the top.
				offset = 0;
				remainder = "";
			}
			if (size > offset) {
				const chunk = await handle.slice(offset, size).text();
				offset = size;
				const lines = (remainder + chunk).split("\n");
				// Last element is either "" or a partial line still being written.
				remainder = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					let parsed: unknown;
					try {
						parsed = JSON.parse(trimmed);
					} catch {
						continue;
					}
					onEntry(parsed);
				}
			}
		} finally {
			reading = false;
			if (pending) {
				pending = false;
				void pump();
			}
		}
	}

	let watcher: FSWatcher | undefined;
	try {
		watcher = watch(file, () => void pump());
	} catch {
		// File may not exist yet; the poll below picks it up.
	}
	const timer = setInterval(() => void pump(), options.pollMs ?? 500);
	void pump();

	return {
		stop: () => {
			stopped = true;
			watcher?.close();
			clearInterval(timer);
		},
	};
}
