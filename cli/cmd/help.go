package cmd

const helpTop = `Nantianmen - LLM Proxy Gateway CLI

Usage:
  nantianmen <command> [subcommand] [flags]
  nantianmen help [command]

Commands:
  server     Manage the Nantianmen server process (start/stop/status)
  provider   Manage upstream LLM providers (list/add/edit/delete/health/models/set-default)
  apikey     Manage API keys for client access (list/create/delete)
  stats      Query usage statistics (by provider/model/user/date)

Global Flags:
  --server URL   Override server address (default: http://127.0.0.1:7300)
                 Can also be set via NANTIANMEN_SERVER env var.

Examples:
  nantianmen server start
  nantianmen provider list
  nantianmen provider add --name OpenAI --protocol openai --base-url https://api.openai.com/v1 --api-key sk-xxx
  nantianmen apikey create --name "Production Key" --note "for prod env"
  nantianmen stats query --provider 1 --from 2025-01-01

Use "nantianmen help <command>" for detailed help on a specific command.
`

const helpServer = `nantianmen server - Manage the Nantianmen server process

Usage:
  nantianmen server <subcommand> [flags]

Subcommands:
  start    Start the server (spawns uvicorn, writes PID file)
  stop     Stop the running server (SIGTERM, then SIGKILL after 5s)
  status   Check if the server is running

Flags:
  --dir PATH     Override server directory (default: ../server relative to CLI)
  --host HOST    Server bind host (default: 127.0.0.1)
  --port PORT    Server bind port (default: 7300)

Examples:
  nantianmen server start
  nantianmen server start --host 0.0.0.0 --port 8080
  nantianmen server stop
  nantianmen server status
`

const helpProvider = `nantianmen provider - Manage upstream LLM providers

Usage:
  nantianmen provider <subcommand> [flags]

Subcommands:
  list          List all configured providers
  add           Add a new provider
  edit          Edit an existing provider
  delete        Delete a provider
  health        Check provider connectivity
  models        List available models for a provider
  set-default   Set the default model for a provider

Flags for "add":
  --name NAME         Provider name (required)
  --protocol TYPE     Protocol: openai|anthropic (required)
  --base-url URL      API base URL (required)
  --api-key KEY       API key for the provider (required)

Flags for "edit":
  --id N              Provider ID (required)
  --name NAME         New name
  --protocol TYPE     New protocol
  --base-url URL      New base URL
  --api-key KEY       New API key

Flags for "delete":
  --id N              Provider ID (required)

Flags for "health":
  --id N              Provider ID (required)

Flags for "models":
  --id N              Provider ID (required)

Flags for "set-default":
  --id N              Provider ID (required)
  --model-id M        Model ID to set as default (required)

Global Flags:
  --server URL        Override server address

Examples:
  nantianmen provider list
  nantianmen provider add --name OpenAI --protocol openai --base-url https://api.openai.com/v1 --api-key sk-xxx
  nantianmen provider edit --id 1 --name "OpenAI Prod"
  nantianmen provider delete --id 2
  nantianmen provider health --id 1
  nantianmen provider models --id 1
  nantianmen provider set-default --id 1 --model-id gpt-4o
`

const helpApiKey = `nantianmen apikey - Manage API keys for client access

Usage:
  nantianmen apikey <subcommand> [flags]

Subcommands:
  list      List all API keys
  create    Create a new API key
  delete    Delete an API key

Flags for "create":
  --name NAME    Key name/label (required)
  --note NOTE    Optional description

Flags for "delete":
  --id N         Key ID (required)

Global Flags:
  --server URL   Override server address

Examples:
  nantianmen apikey list
  nantianmen apikey create --name "Production" --note "for prod"
  nantianmen apikey delete --id 3
`

const helpStats = `nantianmen stats - Query usage statistics

Usage:
  nantianmen stats query [flags]

Subcommands:
  query    Query statistics with optional filters

Flags for "query":
  --provider N    Filter by provider ID
  --model X       Filter by model name
  --user N        Filter by user ID
  --from DATE     Start date (YYYY-MM-DD)
  --to DATE       End date (YYYY-MM-DD)

Global Flags:
  --server URL    Override server address

Examples:
  nantianmen stats query
  nantianmen stats query --provider 1
  nantianmen stats query --from 2025-01-01 --to 2025-01-31
  nantianmen stats query --provider 1 --model gpt-4o --user 5
`
