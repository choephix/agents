# omp-transcript

A small Bash + `jq` tool that turns OMP JSONL sessions into compact, self-hydrating transcripts. Structure is carried by XML-like tags — `<user>`, `<assistant>`, `<reasoning>`, `<bash-execution>`, `<file-mention>`, `<tool-call>`, `<tool-result>` — because message bodies contain their own markdown headings; every `#` in a transcript therefore belongs to content, never to structure. Bodies are emitted verbatim, so the output is a reading aid, not parseable XML.

## Usage

```
Usage:
  omp-transcript <session.jsonl|id> [--with-tools|--hydrate] [--reasoning] [-m <n>]
  omp-transcript result --session <session.jsonl|id> --message-id <id>
  omp-transcript list [--cwd <dir>] [-n <count>]
```

Anywhere a session is expected, pass either a `.jsonl` path or a session id — full or any prefix of at least four characters — resolved under `$OMP_SESSIONS_DIR` (default `$HOME/.omp/agent/sessions`). An existing file wins; an ambiguous prefix lists its candidates and fails.

## Render

The default mode renders only the active `parentId` branch, and only what was actually said: user and developer messages, assistant text, shell commands the user ran in the harness, the files they @-mentioned, custom messages, compaction summaries, and branch summaries. Assistant reasoning, tool calls, and tool results are all omitted — in a typical session they dwarf the conversation and distort `-m` counting.

Pass `--with-tools` for a cheap index of that tool traffic: `<tool-call>` blocks with their arguments, and `<tool-result>` blocks whose attributes carry status and UTF-8 byte count and whose body is a copy-pasteable `result` command that hydrates the exact output. The same flag inlines mentioned-file contents, which by default appear only as `<file-mention path="…" lines="…" bytes="…" />` stubs. Pass `--hydrate` to inline the hydrated result bodies too; it implies `--with-tools`. Unrecoverable results are marked `recovered="false"` and keep their placeholder.

Pass `--reasoning` to include `<reasoning>` blocks. Expect roughly double the bytes, and a higher message count: an assistant turn that only thought before calling a tool renders nothing by default, so it occupies no slice slot until this flag brings it back.

Use `-m <n>` or `--messages <n>` to slice renderable messages: `-5` keeps the last five and `5` keeps the first five, clamped like Python slices. A message is one branch record, so an assistant turn's reasoning, text, and tool calls count once — and a record that renders nothing under the current flags, such as a tool-call-only assistant turn by default, counts not at all.

`omp-transcript session.jsonl -m -5`

Fenced blocks automatically use enough backticks to contain their content safely.

## Result

`result` prints one tool result exactly, with no decoration. Hydration returns ordinary bodies as recorded, replaces raw-output markers and shaken placeholders from readable sidecar artifacts, then falls back for truncated or unresolved shaken placeholders to `displayContent.text`, `truncation.content`, and a readable `resolvedPath`, in that order. If the full output was not recorded, it prints the placeholder, reports the error, and exits 3.

## List

`list` scans `$OMP_SESSIONS_DIR`, or `$HOME/.omp/agent/sessions` when the variable is unset, and prints sessions newest first. `--cwd <dir>` is resolved with `realpath` and must exactly match the session header's `cwd`. `-n <count>` accepts a positive integer and defaults to 10.

Output is TSV with no header:

```
<mtime as UTC ISO8601 seconds>	<session id>	<title or "-">	<cwd>	<path>
```

## Exit codes

- `0`: success, including an empty list.
- `1`: fatal error, such as a missing file, sessions root, or `jq`.
- `2`: usage error.
- `3`: `result` could not recover the full output.

Requires Bash, `jq`, and `realpath`.
