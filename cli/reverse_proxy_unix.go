//go:build !windows

// ponytail: Unix frpc process attributes. No-op — frpc forks itself when invoked
// as a long-running daemon and we don't Wait() in the caller, so it survives CLI
// exit without OS-level detach flags.
package main

import "os/exec"

func configureSysProcAttr(cmd *exec.Cmd) {
	// no-op on darwin/linux.
	_ = cmd
}
