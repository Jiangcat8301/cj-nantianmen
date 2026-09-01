//go:build windows

// ponytail: Windows-only frpc process attributes.
// Sets CREATE_NEW_PROCESS_GROUP so Ctrl+C in the user's terminal doesn't kill frpc
// (it runs detached as a child of the CLI process tree).
package main

import (
	"os/exec"
	"syscall"
)

// CREATE_NEW_PROCESS_GROUP = 0x00000200
const createNewProcessGroup = 0x00000200

func configureSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
}
