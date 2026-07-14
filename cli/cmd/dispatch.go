package cmd

import (
	"fmt"
	"os"
)

// Top-level dispatch table
type subcommand struct {
	name string
	help string
	run  func(args []string) error
}

var commands = map[string]subcommand{
	"server": {
		name: "server",
		help: helpServer,
		run:  RunServer,
	},
	"provider": {
		name: "provider",
		help: helpProvider,
		run:  RunProvider,
	},
	"apikey": {
		name: "apikey",
		help: helpApiKey,
		run:  RunApiKey,
	},
	"stats": {
		name: "stats",
		help: helpStats,
		run:  RunStats,
	},
}

// Dispatch routes to a top-level command.
func Dispatch(name string, args []string) error {
	c, ok := commands[name]
	if !ok {
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n\n", name)
		PrintTopHelp()
		os.Exit(2)
	}
	return c.run(args)
}

// PrintTopHelp prints the top-level usage.
func PrintTopHelp() {
	fmt.Print(helpTop)
}

// PrintSubHelp prints help for a specific command.
func PrintSubHelp(name string, sub []string) {
	c, ok := commands[name]
	if !ok {
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", name)
		PrintTopHelp()
		os.Exit(2)
	}
	if len(sub) > 0 {
		// sub-subcommand help: append the subcommand name for context
		fmt.Printf(c.help, sub[0])
	} else {
		fmt.Print(c.help)
	}
}

// wantsHelp checks if -h/--help is in args.
func wantsHelp(args []string) bool {
	for _, a := range args {
		if a == "-h" || a == "--help" {
			return true
		}
	}
	return false
}
