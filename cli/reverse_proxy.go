// ponytail: v0.5.0 — FRPC reverse-proxy (公网穿透) manager for CLI.
// Mirrors desktop/electron/frpc.cjs in pure-Go style: download / start / stop / status / config.
// Config persists into ~/.cj-nantianmen/config.json (CLI's own file, separate from server's
// nantianmen-conf.json; we keep both so CLI users on machines without server still work).
package main

import (
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const frpcVersion = "v0.71.0"

// ponytail: paths the same way the desktop manager picks them — under userHome.
func frpcDir() string {
	return filepath.Join(cfgDir, "frpc")
}
func frpcBin() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(frpcDir(), "frpc.exe")
	}
	return filepath.Join(frpcDir(), "frpc")
}
func frpcTomlPath() string {
	return filepath.Join(frpcDir(), "frpc.toml")
}
func frpcPidPath() string {
	return filepath.Join(frpcDir(), "frpc.pid")
}

// FrpcBlock — what we persist under cfg["frpc"] in config.json.
type FrpcBlock struct {
	// ponytail: v0.5.0 — Enabled is the user's "should this run?" toggle.
	// Disabling preserves the rest of the block; the process is stopped
	// and future boots (auto_start) skip it entirely.
	Enabled    bool   `json:"enabled"`
	AutoStart  bool   `json:"auto_start"`
	ServerAddr string `json:"server_addr"`
	ServerPort int    `json:"server_port"`
	Token      string `json:"token"`
	RemotePort int    `json:"remote_port"`
	LocalPort  int    `json:"local_port"`
}

func loadFrpcBlock() FrpcBlock {
	cfg := loadCfg()
	raw, ok := cfg["frpc"].(map[string]interface{})
	if !ok {
		return FrpcBlock{LocalPort: 38271, ServerPort: 7000}
	}
	b, _ := json.Marshal(raw)
	var blk FrpcBlock
	json.Unmarshal(b, &blk)
	if blk.LocalPort == 0 {
		blk.LocalPort = 38271
	}
	if blk.ServerPort == 0 {
		blk.ServerPort = 7000
	}
	return blk
}

func saveFrpcBlock(b FrpcBlock) {
	cfg := loadCfg()
	cfg["frpc"] = b
	saveCfg(cfg)
}

// platformAsset picks the upstream release archive for current OS/arch.
// Returns "" when unsupported (e.g. linux/arm).
func platformAsset() string {
	ver := strings.TrimPrefix(frpcVersion, "v")
	goos := runtime.GOOS
	arch := runtime.GOARCH
	switch {
	case goos == "windows" && arch == "amd64":
		return fmt.Sprintf("frp_%s_windows_amd64.zip", ver)
	case goos == "windows" && arch == "arm64":
		return fmt.Sprintf("frp_%s_windows_arm64.zip", ver)
	case goos == "darwin" && arch == "amd64":
		return fmt.Sprintf("frp_%s_darwin_amd64.tar.gz", ver)
	case goos == "darwin" && arch == "arm64":
		return fmt.Sprintf("frp_%s_darwin_arm64.tar.gz", ver)
	case goos == "linux" && arch == "amd64":
		return fmt.Sprintf("frp_%s_linux_amd64.tar.gz", ver)
	case goos == "linux" && arch == "arm64":
		return fmt.Sprintf("frp_%s_linux_arm64.tar.gz", ver)
	}
	return ""
}

// renderToml — hand-rolled subset, same as desktop/electron/frpc.cjs.
func renderToml(b FrpcBlock) string {
	if b.ServerAddr == "" {
		return ""
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("serverAddr = %q\n", b.ServerAddr))
	sb.WriteString(fmt.Sprintf("serverPort = %d\n", b.ServerPort))
	if b.Token != "" {
		sb.WriteString(fmt.Sprintf("auth.token = %q\n", b.Token))
	}
	sb.WriteString("\n[[proxies]]\n")
	sb.WriteString("name = \"nantianmen\"\n")
	sb.WriteString("type = \"tcp\"\n")
	sb.WriteString("localIP = \"127.0.0.1\"\n")
	sb.WriteString(fmt.Sprintf("localPort = %d\n", b.LocalPort))
	sb.WriteString(fmt.Sprintf("remotePort = %d\n", b.RemotePort))
	return sb.String()
}

// ----- download ------------------------------------------------------------

func downloadFrpc() error {
	asset := platformAsset()
	if asset == "" {
		return fmt.Errorf("no FRPC release asset for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	if err := os.MkdirAll(frpcDir(), 0o755); err != nil {
		return err
	}
	url := fmt.Sprintf("https://github.com/fatedier/frp/releases/download/%s/%s", frpcVersion, asset)
	tmp := filepath.Join(frpcDir(), asset)
	fmt.Printf("downloading %s\n", url)
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download HTTP %d", resp.StatusCode)
	}
	total := resp.ContentLength
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, &progressReader{r: resp.Body, total: total}); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	f.Close()
	defer os.Remove(tmp)
	fmt.Println("extracting…")
	bin, err := extractFrpcBinary(tmp)
	if err != nil {
		return err
	}
	if err := os.Rename(bin, frpcBin()); err != nil {
		return err
	}
	os.Chmod(frpcBin(), 0o755)
	fmt.Printf("installed → %s\n", frpcBin())
	return nil
}

// progressReader prints percentage every ~5% to stderr so the user sees progress
// on slow links; non-fatal if total is unknown.
type progressReader struct {
	r     io.Reader
	total int64
	done  int64
	last  int
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.done += int64(n)
	if p.total > 0 {
		pct := int(p.done * 100 / p.total)
		if pct >= p.last+5 {
			fmt.Fprintf(os.Stderr, "  %d%%\r", pct)
			p.last = pct
		}
	}
	return n, err
}

func extractFrpcBinary(archive string) (string, error) {
	if strings.HasSuffix(archive, ".zip") {
		return extractZip(archive)
	}
	return extractTarGz(archive)
}

func extractZip(archive string) (string, error) {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return "", err
	}
	defer r.Close()
	want := "frpc"
	if runtime.GOOS == "windows" {
		want = "frpc.exe"
	}
	extractDir := filepath.Join(frpcDir(), "_extract")
	os.RemoveAll(extractDir)
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return "", err
	}
	for _, f := range r.File {
		if filepath.Base(f.Name) != want {
			continue
		}
		dst := filepath.Join(extractDir, want)
		in, err := f.Open()
		if err != nil {
			return "", err
		}
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			in.Close()
			return "", err
		}
		_, err = io.Copy(out, in)
		in.Close()
		out.Close()
		if err != nil {
			return "", err
		}
		return dst, nil
	}
	return "", fmt.Errorf("frpc binary not in archive")
}

// extractTarGz — minimal .tar.gz reader; only walks the top-level to find frpc.
// (Standard library has no tar reader; we hand-roll enough for FRP's layout.)
func extractTarGz(archive string) (string, error) {
	zr, err := gzip.NewReader(openFile(archive))
	if err != nil {
		return "", err
	}
	defer zr.Close()
	extractDir := filepath.Join(frpcDir(), "_extract")
	os.RemoveAll(extractDir)
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return "", err
	}
	want := "frpc"
	if runtime.GOOS == "windows" {
		want = "frpc.exe"
	}
	// ponytail: tar header layout — name(100) + mode(8) + uid(8) + gid(8) + size(12) + mtime(12) + chksum(8) + type(1) + linkname(100) + magic(6) + ...
	for {
		hdr := make([]byte, 512)
		n, err := io.ReadFull(zr, hdr)
		if err == io.EOF || (n == 0 && err == io.ErrUnexpectedEOF) {
			return "", fmt.Errorf("frpc binary not in archive")
		}
		if err != nil && err != io.ErrUnexpectedEOF {
			return "", err
		}
		name := strings.TrimRight(string(hdr[0:100]), "\x00")
		if name == "" {
			return "", fmt.Errorf("frpc binary not in archive")
		}
		sizeStr := strings.TrimRight(string(hdr[124:136]), "\x00")
		size, _ := strconv.ParseUint(strings.TrimSpace(sizeStr), 8, 64)
		base := filepath.Base(name)
		// round size up to 512-byte blocks
		blocks := (size + 511) / 512
		if base == want {
			dst := filepath.Join(extractDir, want)
			out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
			if err != nil {
				return "", err
			}
			if _, err := io.CopyN(out, zr, int64(size)); err != nil {
				out.Close()
				return "", err
			}
			out.Close()
			return dst, nil
		}
		// skip this entry's data
		if _, err := io.CopyN(io.Discard, zr, int64(blocks*512)); err != nil {
			return "", err
		}
	}
}

func openFile(p string) *os.File {
	f, _ := os.Open(p)
	return f
}

// ----- start / stop --------------------------------------------------------

func startFrpc() error {
	if _, err := os.Stat(frpcBin()); err != nil {
		return fmt.Errorf("frpc binary not installed; run `nantianmen reverse-proxy download`")
	}
	if frpcRunning() {
		return fmt.Errorf("frpc already running")
	}
	b := loadFrpcBlock()
	if b.ServerAddr == "" || b.RemotePort == 0 {
		return fmt.Errorf("config incomplete: server_addr and remote_port required")
	}
	toml := renderToml(b)
	if toml == "" {
		return fmt.Errorf("config invalid")
	}
	if err := os.WriteFile(frpcTomlPath(), []byte(toml), 0o600); err != nil {
		return err
	}
	cmd := exec.Command(frpcBin(), "-c", frpcTomlPath())
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	// ponytail: process detachment. On Windows we set CREATE_NEW_PROCESS_GROUP so
	// Ctrl+C doesn't kill frpc when the user hits ^C in their terminal. On
	// Unix we rely on frpc forking internally; we just don't Wait() below.
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000200}
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	os.WriteFile(frpcPidPath(), []byte(strconv.Itoa(cmd.Process.Pid)), 0o600)
	// don't Wait() — release the process so it survives CLI exit.
	go func() { cmd.Wait() }()
	fmt.Printf("frpc started (pid %d)\n", cmd.Process.Pid)
	return nil
}

func stopFrpc() error {
	pid, err := readFrpcPid()
	if err != nil {
		return err
	}
	if pid == 0 {
		fmt.Println("frpc not running")
		return nil
	}
	if runtime.GOOS == "windows" {
		// /T kills the whole tree; without it the cmd wrapper stays around.
		exec.Command("taskkill.exe", "/pid", strconv.Itoa(pid), "/T", "/F").Run()
	} else {
		proc, err := os.FindProcess(pid)
		if err == nil {
			proc.Signal(syscall.SIGTERM)
		}
	}
	os.Remove(frpcPidPath())
	fmt.Printf("frpc stopped (pid %d)\n", pid)
	return nil
}

func frpcStatus() {
	running := frpcRunning()
	pid, _ := readFrpcPid()
	has := false
	if _, err := os.Stat(frpcBin()); err == nil {
		has = true
	}
	fmt.Printf("binary: %s (installed=%v)\n", frpcBin(), has)
	fmt.Printf("config: %s\n", frpcTomlPath())
	fmt.Printf("running: %v (pid=%d)\n", running, pid)
	b := loadFrpcBlock()
	fmt.Printf("  server_addr  = %s\n", b.ServerAddr)
	fmt.Printf("  server_port  = %d\n", b.ServerPort)
	fmt.Printf("  remote_port  = %d\n", b.RemotePort)
	fmt.Printf("  local_port   = %d\n", b.LocalPort)
	fmt.Printf("  token        = %s\n", redact(b.Token))
	fmt.Printf("  enabled      = %v\n", b.Enabled)
	fmt.Printf("  auto_start   = %v\n", b.AutoStart)
}

func redact(s string) string {
	if s == "" {
		return ""
	}
	if len(s) <= 4 {
		return "****"
	}
	return s[:2] + "****" + s[len(s)-2:]
}

func frpcRunning() bool {
	pid, err := readFrpcPid()
	if err != nil || pid == 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// ponytail: signal 0 doesn't actually send — it just checks the process exists.
	// On Windows FindProcess always succeeds; we rely on the PID file being cleared
	// by the user (or our stop handler) when frpc exits. Cheap heuristic.
	if runtime.GOOS == "windows" {
		return true
	}
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

func readFrpcPid() (int, error) {
	data, err := os.ReadFile(frpcPidPath())
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(data)))
}

// ----- config --------------------------------------------------------------

func cmdFrpcConfig(a []string) {
	if len(a) == 0 {
		b := loadFrpcBlock()
		fmt.Printf("server_addr  = %s\n", b.ServerAddr)
		fmt.Printf("server_port  = %d\n", b.ServerPort)
		fmt.Printf("token        = %s\n", redact(b.Token))
		fmt.Printf("remote_port  = %d\n", b.RemotePort)
		fmt.Printf("local_port   = %d\n", b.LocalPort)
		fmt.Printf("enabled      = %v\n", b.Enabled)
		fmt.Printf("auto_start   = %v\n", b.AutoStart)
		return
	}
	b := loadFrpcBlock()
	for i := 0; i < len(a); i++ {
		arg := a[i]
		eq := strings.SplitN(arg, "=", 2)
		key := eq[0]
		var val string
		if len(eq) == 2 {
			val = eq[1]
		} else if i+1 < len(a) {
			val = a[i+1]
			i++
		} else {
			fmt.Fprintf(os.Stderr, "missing value for %s\n", key)
			os.Exit(1)
		}
		switch key {
		case "server_addr":
			b.ServerAddr = val
		case "server_port":
			b.ServerPort, _ = strconv.Atoi(val)
		case "token":
			b.Token = val
		case "remote_port":
			b.RemotePort, _ = strconv.Atoi(val)
		case "local_port":
			b.LocalPort, _ = strconv.Atoi(val)
		case "auto_start":
			b.AutoStart = val == "1" || strings.EqualFold(val, "true")
		case "enabled":
			b.Enabled = val == "1" || strings.EqualFold(val, "true")
		default:
			fmt.Fprintf(os.Stderr, "unknown key: %s\n", key)
			os.Exit(1)
		}
	}
	saveFrpcBlock(b)
	fmt.Println("saved.")
}

// ----- entry point ---------------------------------------------------------

func cmdReverseProxy(a []string) {
	if len(a) == 0 {
		frpcStatus()
		return
	}
	switch a[0] {
	case "download":
		if err := downloadFrpc(); err != nil {
			fmt.Fprintf(os.Stderr, "download failed: %v\n", err)
			os.Exit(1)
		}
	case "start":
		if err := startFrpc(); err != nil {
			fmt.Fprintf(os.Stderr, "start failed: %v\n", err)
			os.Exit(1)
		}
	case "stop":
		if err := stopFrpc(); err != nil {
			fmt.Fprintf(os.Stderr, "stop failed: %v\n", err)
			os.Exit(1)
		}
	case "enable":
		// ponytail: 启用 = enabled=true 持久化, 不动 auto_start, 不动进程.
		b := loadFrpcBlock()
		b.Enabled = true
		saveFrpcBlock(b)
		fmt.Println("enabled (config preserved; auto_start unchanged)")
	case "disable":
		// ponytail: 停用 = 关进程 + enabled=false 持久化. 其它字段保留, 下次启用即可恢复.
		_ = stopFrpc()
		b := loadFrpcBlock()
		b.Enabled = false
		saveFrpcBlock(b)
		fmt.Println("disabled (config preserved; process stopped)")
	case "status":
		frpcStatus()
	case "config":
		cmdFrpcConfig(a[1:])
	default:
		fmt.Fprintln(os.Stderr, "usage: nantianmen reverse-proxy [download|start|stop|enable|disable|status|config]")
		os.Exit(1)
	}
	// ponytail: keep CLI exit code from racing frpc log writes on Windows.
	if runtime.GOOS == "windows" {
		time.Sleep(50 * time.Millisecond)
	}
}