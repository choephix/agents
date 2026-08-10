# Hacks

## The path leak

Derive your own OMP session identity with no ID in context: `local://` URIs resolve into the current session's directory, whose name ends in the session ID. Works before anything was ever written to `local://` (`realpath -m` resolves lexically):

```bash
p=$(realpath -m -- local://.probe)   # …/sessions/<cwd-slug>/<timestamp>_<SESSION-ID>/local/.probe
sdir=${p%/local/*}                   # session directory
sid=${sdir##*_}                      # session ID
```

Useful where the ID isn't injected: older harnesses, subagents, foreign setups.
