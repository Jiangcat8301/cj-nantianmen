package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const defaultServerDir = "../server"
const pidFileName = "nantianmen.pid"

// RunServer dispatches server subcommands.
func RunServer(args []string) error {
	if len(args) == 0 || wantsHelp(args) {
		fmt.Print(helpServer)
		return nil
	}
	switch args[0] {
	case "start":
		return serverStart(args[1:])
	case "stop":
		return serverStop()
	case "status":
		return serverStatus()
	default:
		fmt.Fprintf(os.Stderr, "Unknown subcommand: server %s\n\n", args[0])
		fmt.Print(helpServer)
		os.Exit(2)
	}
	return nil
}

// resolveServerDir finds the server directory.
// Priority: --dir flag > env NANTIANMEN_SERVER_DIR > default ../server
func resolveServerDir(args []string) (string, []string) {
	var dir string
	var rest []string
	for i := 0; i < len(args); i++ {
		if args[i] == "--dir" && i+1 < len(args) {
			dir = args[i+1]
			i++
		} else if strings.HasPrefix(args[i], "--dir=") {
			dir = strings.TrimPrefix(args[i], "--dir=")
		} else {
			rest = append(rest, args[i])
		}
	}
	if dir == "" {
		dir = os.Getenv("NANTIANMEN_SERVER_DIR")
	}
	if dir == "" {
		dir = defaultServerDir
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return dir, rest
	}
	return abs, rest
}

func pidFilePath() string {
	// PID file lives in server/data/nantianmen.pid
	dir := os.Getenv("NANTIANMEN_SERVER_DIR")
	if dir == "" {
		dir = defaultServerDir
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		abs = dir
	}
	return filepath.Join(abs, "data", pidFileName)
}

func serverStart(args []string) error {
	serverDir, _ := resolveServerDir(args)

	// Parse host/port flags
	host, port := "127.0.0.1", "7300"
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--host" && i+1 < len(args):
			host = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--host="):
			host = strings.TrimPrefix(args[i], "--host=")
		case args[i] == "--port" && i+1 < len(args):
			port = args[i+1]
			i++
		case strings.HasPrefix(args[i], "--port="):
			port = strings.TrimPrefix(args[i], "--port=")
		}
	}

	// Check if already running
	pidFile := pidFilePath()
	if pid, err := readPIDFile(pidFile); err == nil && isProcessAlive(pid) {
		return fmt.Errorf("server already running (PID %d). Stop it first with: nantianmen server stop", pid)
	}

	// Find python
	pythonCmd := "python"
	if p, err := exec.LookPath("python3"); err == nil {
		pythonCmd = p
	} else if p, err := exec.LookPath("python"); err == nil {
		pythonCmd = p
	}

	// Ensure data dir exists
	dataDir := filepath.Dir(pidFile)
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}

	// Spawn uvicorn
	cmd := exec.Command(pythonCmd, "-m", "uvicorn", "app.main:app",
		"--host", host, "--port", port)
	cmd.Dir = serverDir
	cmd.Env = os.Environ()

	// Detach: redirect stdout/stderr to log file
	logFile := filepath.Join(dataDir, "nantianmen.log")
	lf, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	cmd.Stdout = lf
	cmd.Stderr = lf

	// On Windows, create a new process group so we can kill the tree
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
		}
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start server: %w", err)
	}

	// Write PID
	pid := cmd.Process.Pid
	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(pid)), 0644); err != nil {
		return fmt.Errorf("write PID file: %w", err)
	}

	// Detach the process - don't wait for it
	_ = cmd.Process.Release()

	fmt.Printf("Server started (PID %d)\n", pid)
	fmt.Printf("  Directory: %s\n", serverDir)
	fmt.Printf("  Address:   http://%s:%s\n", host, port)
	fmt.Printf("  Log:       %s\n", logFile)
	return nil
}

func serverStop() error {
	pidFile := pidFilePath()
	pid, err := readPIDFile(pidFile)
	if err != nil {
		fmt.Println("Server is not running (no PID file found)")
		return nil
	}

	if !isProcessAlive(pid) {
		os.Remove(pidFile)
		fmt.Println("Server is not running (stale PID file removed)")
		return nil
	}

	// Send SIGTERM (or equivalent)
	if err := killProcess(pid, false); err != nil {
		return fmt.Errorf("send stop signal: %w", err)
	}

	// Wait up to 5 seconds for graceful shutdown
	for i := 0; i < 50; i++ {
		if !isProcessAlive(pid) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	// Force kill if still alive
	if isProcessAlive(pid) {
		if err := killProcess(pid, true); err != nil {
			return fmt.Errorf("force kill: %w", err)
		}
		time.Sleep(200 * time.Millisecond)
	}

	os.Remove(pidFile)
	fmt.Printf("Server stopped (PID %d)\n", pid)
	return nil
}

func serverStatus() error {
	pidFile := pidFilePath()
	pid, err := readPIDFile(pidFile)
	if err != nil {
		fmt.Println("stopped")
		return nil
	}
	if isProcessAlive(pid) {
		fmt.Printf("running (PID %d)\n", pid)
	} else {
		fmt.Println("stopped (stale PID file)")
	}
	return nil
}

// --- PID file helpers ---

func readPIDFile(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, err
	}
	return pid, nil
}

// isProcessAlive checks if a process with the given PID is running.
func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Unix, signal 0 checks existence without sending a signal.
	// On Windows, os.FindProcess always succeeds, so we use a different approach.
	if runtime.GOOS == "windows" {
		// ponytail: use tasklist to check on Windows. os.FindProcess+Signal(0)
		// doesn't work on Windows. tasklist is always available.
		cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/NH")
		out, err := cmd.Output()
		if err != nil {
			return false
		}
		return strings.Contains(string(out), strconv.Itoa(pid))
	}
	// Unix: signal 0
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

// killProcess sends SIGTERM (force=false) or SIGKILL (force=true).
func killProcess(pid int, force bool) error {
	if runtime.GOOS == "windows" {
		// ponytail: Windows has no real signals. Use taskkill.
		// /T kills the process tree (uvicorn workers).
		args := []string{"/T", "/PID", strconv.Itoa(pid)}
		if force {
			args = append([]string{"/F"}, args...)
		}
		return exec.Command("taskkill", args...).Run()
	}
	// Unix
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if force {
		return proc.Signal(syscall.SIGKILL)
	}
	return proc.Signal(syscall.SIGTERM)
}
