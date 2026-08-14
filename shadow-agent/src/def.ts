import path from "node:path";
import type { ShadowDef } from "./types";

type DefModule = { default?: ShadowDef };

/**
 * Load and validate a shadow definition file.
 *
 * The specifier is a user-supplied path from argv, so a static import cannot
 * express it: this is the plugin-loading exception to static-import-only.
 */
export async function loadDef(defPath: string): Promise<ShadowDef> {
	const resolved = path.resolve(defPath);
	// Module namespace of a local, user-authored def file; shape checked below.
	const loaded = (await import(resolved)) as DefModule;
	const def = loaded.default;
	if (!def || typeof def.instruction !== "string" || def.instruction.trim().length === 0) {
		throw new Error(`${defPath}: default export must be a ShadowDef with a non-empty "instruction"`);
	}
	if (def.filter !== undefined && typeof def.filter !== "function") {
		throw new Error(`${defPath}: "filter" must be a function`);
	}
	return def;
}
