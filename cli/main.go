package main

import (
	"fmt"
	"os"

	"nantianmen/cmd"
)

func main() {
	args := os.Args[1:]

	// No args -> top-level help
	if len(args) == 0 {
		cmd.PrintTopHelp()
		return
	}

	// help / -h / --help as first arg
	if args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		if len(args) < 2 {
			cmd.PrintTopHelp()
			return
		}
		cmd.PrintSubHelp(args[1], args[2:])
		return
	}

	// Dispatch to command
	if err := cmd.Dispatch(args[0], args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
