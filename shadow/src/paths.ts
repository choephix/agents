import path from "node:path";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";

/**
 * Where a shadow's own session file goes.
 *
 * Deliberately *not* the project's session directory. A shadow session written
 * there becomes the most recent session for the cwd, so `omp --continue` resumes
 * the shadow instead of the user's work, and `/resume` fills up with shadows.
 * Mirrors the harness layout one level over: `~/.omp/agent/shadow-sessions/<encoded-cwd>`,
 * reusing the harness's own cwd encoding rather than reimplementing it.
 */
export function shadowSessionDir(cwd: string): string {
	const projectDir = SessionManager.getDefaultSessionDir(cwd);
	const agentDir = path.dirname(path.dirname(projectDir));
	return path.join(agentDir, "shadow-sessions", path.basename(projectDir));
}

/** Fresh shadow session file path, named like a harness session so resume matching works. */
export function newShadowSessionFile(cwd: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
	return path.join(shadowSessionDir(cwd), `${timestamp}_shadow-${id}.jsonl`);
}
