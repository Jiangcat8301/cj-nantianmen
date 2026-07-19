# CLI Reference

The Nantianmen CLI (`nantianmen`) is a command-line wrapper over the Admin API. Every subcommand except `help` / `quit` probes `${HOST}:${PORT}/v1/health` first and auto-forks a server subprocess when one isn't running.

## Common Commands

```bash
# First-time setup
nantianmen setup

# Health check
nantianmen health

# Change password
nantianmen -P 'oldpass' password

# Provider & model management
nantianmen provider ls
nantianmen provider add
nantianmen provider models <pid>            # list models with pricing
nantianmen provider models-refresh <pid>    # refresh from upstream
nantianmen provider model-add <pid> <name>  # add manually
nantianmen provider model-edit <pid> <mid> --input=0.1 --output=0.5 --cache=0.01
nantianmen provider default <pid> <mid>     # set as default

# API Keys
nantianmen apikey new                            # interactive: name/note + model authorization multi-select
nantianmen apikey ls                             # shows auth: N (granted model count)
nantianmen apikey edit <id> --auth=1,3           # non-interactive: update authorization list only
nantianmen apikey edit <id> --assigned=2         # assign model (model_id, must be in grant list)
nantianmen apikey edit <id> --assigned=-         # clear assigned model
nantianmen apikey edit <id>                      # interactive: name/note + show current grants/assignment

# Stats (with range filter)
nantianmen stats --range=today

# Communication log
nantianmen log ls [--provider ID] [--model NAME] [--user ID]
nantianmen log enable|disable|clear|config

# Settings
nantianmen settings                        # view
nantianmen settings set --port=8380        # change port

# Global flag resolution: --flag > $NANTIANMEN_* > ~/.cj-nantianmen/config.json > error
```

**Auto-start server**: before each subcommand (except `help` / `quit`), the CLI probes `${HOST}:${PORT}/v1/health`. If not reachable, it forks a subprocess via `--server-bin` (fallback `../server/index.js`, then `$NANTIANMEN_SERVER_BIN`), detached so the server outlives the CLI. When legacy schema cleanup is running (DB migration on first boot), the CLI prints `[server] database schema cleanup running (one-time)...` / `[server] schema cleanup done.`.

## Command-Line Flags

The server accepts two path flags:

| Flag | Long form | Purpose |
|------|-----------|---------|
| `-c <path>` | `--config-path=<path>` | conf file path (absolute or relative to server binary directory) |
| `-D <path>` | `--database-path=<path>` | sqlite3 db file path (same resolution) |

When omitted, the paths fall back to the home-directory subdir `.cj-nantianmen/`:
- Windows: `C:\Users\<you>\.cj-nantianmen\`
- macOS: `/Users/<you>/.cj-nantianmen/`
- Linux: `/home/<you>/.cj-nantianmen/`

The three surfaces (CLI / Desktop / server) share the same data by default.
