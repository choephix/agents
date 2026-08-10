---
name: omp-meta
description: Operate on OMP sessions — read, list, slice, compare transcripts, resolve session IDs. Use only when the user explicitly asks for this; NEVER infer.
---

# omp-meta

Renders any OMP session's active branch, including your own: a metadata header, then one XML-like block per message — `<user>`, `<assistant>`, `<reasoning>`, `<bash-execution>`, `<file-mention>`, `<tool-call>`, `<tool-result>`. Any markdown heading you see inside a block is that message's own content; the structure never uses headings. Work **narrow-first**: every widening multiplies tokens, so escalate only when the answer isn't in view.

## Addressing a session

Anywhere a path is expected, a session id — full or a 4+ character prefix — works: `omp-transcript 019fd76e -m -1`. An ambiguous prefix lists its candidates and fails.

## Find the session

```bash
omp-transcript list [--cwd <dir>] [-n <count>]
# e.g. omp-transcript list --cwd "$PWD" -n 12
```

TSV, newest first: `mtime  id  title  cwd  path`. Default n=10.

- **Skip-self:** drop the row whose id (column 2) equals your own session ID.
- `--cwd` is an exact realpath match — a parent dir never matches its subdirectories' sessions.
- Already holding an id? Skip `list` and pass the id straight to the tool.
- Need the last message? Use `-n -1`.

Done when: you hold the `.jsonl` path of every target session.

## Read it

```bash
omp-transcript <path> -m -5        # slice: last 5 messages
```

`-m` is a py/js slice: `-5` = last five, `5` = first five; clamped, never errors. One message = one branch record, so an assistant's reasoning, text, and tool calls count once.

Reasoning, tool calls, and tool results are all omitted by default — in a typical session they dwarf the conversation, and hiding them keeps `-m` slicing what was actually said.

Widen in order, only on need:

1. Bigger slice, or drop `-m` — the whole conversation.
2. `--reasoning` — the author's thinking. Roughly doubles the bytes.
3. `--with-tools` — tool calls with arguments, one stub per result carrying the `result` command that hydrates it, and the contents of any `<file-mention>` (paths and sizes are always shown).
4. `omp-transcript result --session <path> --message-id <id>` — hydrate ONE output.
5. `--hydrate` — every result body inline. Hundreds of KB; last resort.

Exit 3 from `result` = that output was never recorded in the session. Report it; do not retry or work around.

Done when: every claim you make about another session cites its path and the message it came from.

## Sidecar anatomy

A session's sidecar directory is its path minus `.jsonl` (`sdir=$(echo ~/.omp/agent/sessions/*/*_"$sid")`). Inside: spilled outputs as `<N>.bash-original.log` (artifact://N) and `<N>.shake.log` (shaken regions); subagent transcripts as `<Name>.jsonl` + `<Name>.md`. The tool's hydration already reads these — go direct only when bypassing it.

Full CLI detail: `README.md` in this skill's directory.

## Notes

Don't read more than you are asked to. If the user requests specific sessions or messages, assume they are trying to protect your context window from getting filled with bloat. 
