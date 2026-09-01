package main

import (
	"bufio"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const ClientVersion = "0.5.1"
const ServerBinary = "nantianmen-server.exe"

var cfgDir string
var cfgFile string

func init() {
	// ponytail: v0.5.0 — unified nantianmen config. Server / Desktop / CLI all read
	// ~/.cj-nantianmen/nantianmen-conf.json; layout is partitioned:
	//   server_port, password, salt, log_rotation_*, database, proxy_url       → server
	//   window_state, autostart                                                → desktop
	//   host, port, password_md5, frpc                                         → cli / desktop / server-shared
	// Old ~/.cj-nantianmen/config.json (CLI-only) is auto-migrated on first read.
	h, _ := os.UserHomeDir()
	cfgDir = filepath.Join(h, ".cj-nantianmen")
	cfgFile = filepath.Join(cfgDir, "nantianmen-conf.json")
	oldCfg := filepath.Join(cfgDir, "config.json")
	migrateLegacyCliConf(oldCfg)
}

// migrateLegacyCliConf copies host/port/password_md5 from the old CLI-only
// config.json into the unified nantianmen-conf.json. One-time, idempotent.
func migrateLegacyCliConf(oldPath string) {
	data, err := os.ReadFile(oldPath)
	if err != nil {
		return // no legacy file, nothing to do
	}
	var old map[string]interface{}
	if json.Unmarshal(data, &old) != nil {
		return
	}
	uni, _ := loadUnified()
	migrated := false
	for _, k := range []string{"host", "port", "password_md5"} {
		if _, present := uni[k]; !present {
			if v, ok := old[k]; ok && v != nil {
				uni[k] = v
				migrated = true
			}
		}
	}
	if migrated {
		saveUnified(uni)
	}
	os.Rename(oldPath, oldPath+".migrated")
}

func loadUnified() (map[string]interface{}, error) {
	data, err := os.ReadFile(cfgFile)
	if err != nil {
		return map[string]interface{}{}, err
	}
	var m map[string]interface{}
	if json.Unmarshal(data, &m) != nil {
		return map[string]interface{}{}, err
	}
	return m, nil
}

func saveUnified(m map[string]interface{}) {
	os.MkdirAll(cfgDir, 0700)
	b, _ := json.MarshalIndent(m, "", "  ")
	os.WriteFile(cfgFile, b, 0600)
}

type CLIArgs struct {
	Host       string
	Port       int
	PasswordMD string
}

func loadCfg() map[string]interface{} {
	data, err := os.ReadFile(cfgFile)
	if err != nil {
		return map[string]interface{}{}
	}
	var c map[string]interface{}
	json.Unmarshal(data, &c)
	return c
}

func saveCfg(c map[string]interface{}) {
	os.MkdirAll(cfgDir, 0700)
	b, _ := json.MarshalIndent(c, "", "  ")
	os.WriteFile(cfgFile, b, 0600)
}

func flagValue(names ...string) string {
	for i := 0; i < len(os.Args); i++ {
		for _, n := range names {
			if os.Args[i] == n && i+1 < len(os.Args) {
				return os.Args[i+1]
			}
			if strings.HasPrefix(os.Args[i], n+"=") {
				return strings.TrimPrefix(os.Args[i], n+"=")
			}
		}
	}
	return ""
}

func resolveArgs() CLIArgs {
	cfg := loadCfg()
	host := flagValue("-H", "--host")
	if host == "" { host = os.Getenv("NANTIANMEN_SERVER_HOST") }
	if host == "" { if h, ok := cfg["host"].(string); ok { host = h } }
	if host == "" { host = "127.0.0.1" }

	port := 0
	if p := flagValue("--port"); p != "" { port, _ = strconv.Atoi(p) }
	if port == 0 { if p := os.Getenv("NANTIANMEN_SERVER_PORT"); p != "" { port, _ = strconv.Atoi(p) } }
	if port == 0 { if p, ok := cfg["port"].(float64); ok { port = int(p) } }
	if port == 0 { port = 38271 }

	pwd := flagValue("-P", "--password")
	if pwd == "" { pwd = os.Getenv("NANTIANMEN_ADMIN_PASSWORD") }
	if pwd == "" { if p, ok := cfg["password_md5"].(string); ok { pwd = p } }

	var pwdMD string
	if pwd != "" {
		if len(pwd) == 32 && isHex(pwd) { pwdMD = pwd } else if pwd == fmt.Sprint(cfg["password_md5"]) { pwdMD = pwd } else { pwdMD = md5Hash(pwd) }
	}
	return CLIArgs{Host: host, Port: port, PasswordMD: pwdMD}
}

func isHex(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) { return false }
	}
	return true
}

func md5Hash(s string) string { return fmt.Sprintf("%x", md5.Sum([]byte(s))) }

// ponytail: v0.4.24 — JSON numbers come back as float64; coerce safely for tabulation.
func toF(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int64:
		return float64(n)
	case int:
		return float64(n)
	}
	return 0
}

func call(method, path string, body interface{}, headers map[string]string, noAuth bool) (int, []byte, error) {
	args := resolveArgs()
	url := fmt.Sprintf("http://%s:%d%s", args.Host, args.Port, path)
	var bodyReader io.Reader
	hasBody := method != "GET" && body != nil
	if hasBody { b, _ := json.Marshal(body); bodyReader = strings.NewReader(string(b)) }
	req, _ := http.NewRequest(method, url, bodyReader)
	if hasBody { req.Header.Set("Content-Type", "application/json") }
	for k, v := range headers { req.Header.Set(k, v) }
	if !noAuth && args.PasswordMD != "" { req.Header.Set("Authorization", "Bearer "+args.PasswordMD) }
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil { return 0, nil, err }
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if !noAuth && resp.StatusCode >= 400 {
		fmt.Fprintf(os.Stderr, "error %d: %s\n", resp.StatusCode, string(data))
		os.Exit(1)
	}
	return resp.StatusCode, data, nil
}

func probeHealth(host string, port int) (online, compatible bool, serverVer string) {
	url := fmt.Sprintf("http://%s:%d/v1/health", host, port)
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get(url)
	if err != nil { return }
	defer resp.Body.Close()
	var data map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&data)
	online = resp.StatusCode == 200 && data["service"] == "nantianmen"
	serverVer, _ = data["version"].(string)
	compatible = online && serverVer == ClientVersion
	return
}

func resolveServerExe() string {
	if v := os.Getenv("NANTIANMEN_SERVER_BIN"); v != "" { return v }
	if v := flagValue("--server-bin"); v != "" { return v }
	exeDir := filepath.Dir(os.Args[0])
	candidates := []string{
		filepath.Join(exeDir, ServerBinary),
		filepath.Join(exeDir, "server", ServerBinary),
		filepath.Join(exeDir, "..", "server", ServerBinary),
	}
	for _, c := range candidates { if _, err := os.Stat(c); err == nil { return c } }
	return ""
}

func ensureServer(args CLIArgs) {
	online, compatible, ver := probeHealth(args.Host, args.Port)
	if compatible { return }
	if online { fmt.Fprintf(os.Stderr, "version mismatch: CLI %s, Server %s\n", ClientVersion, ver); os.Exit(1) }
	serverExe := resolveServerExe()
	if serverExe == "" { fmt.Fprintln(os.Stderr, "no server binary found"); os.Exit(1) }
	fmt.Fprintf(os.Stderr, "(launching server from %s)\n", serverExe)
	cmd := exec.Command(serverExe)
	cmd.Stdout = os.Stderr; cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil { fmt.Fprintf(os.Stderr, "failed: %v\n", err); os.Exit(1) }
	for i := 0; i < 30; i++ {
		online, compatible, _ = probeHealth(args.Host, args.Port)
		if compatible { return }
		if online { fmt.Fprintln(os.Stderr, "version mismatch after start"); os.Exit(1) }
		time.Sleep(200 * time.Millisecond)
	}
	fmt.Fprintln(os.Stderr, "server did not start within 6s"); os.Exit(1)
}

func main() {
	// Scan for subcommand (first non-flag arg, skipping --flag=value pairs)
	sub := ""
	subIdx := -1
	for i := 1; i < len(os.Args); i++ {
		a := os.Args[i]
		if strings.HasPrefix(a, "-") {
			if !strings.Contains(a, "=") && i+1 < len(os.Args) && !strings.HasPrefix(os.Args[i+1], "-") {
				i++
			}
			continue
		}
		sub = a
		subIdx = i
		break
	}
	if sub == "" {
		fmt.Println("nantianmen <command> [args]")
		fmt.Println("  setup health login providers apikey models stats settings server reverse-proxy shutdown")
		os.Exit(1)
	}
	args := resolveArgs()
	rest := []string{}
	if subIdx >= 0 && subIdx+1 < len(os.Args) { rest = os.Args[subIdx+1:] }
	switch sub {
	case "setup":
		reader := bufio.NewReader(os.Stdin)
		fmt.Print("Server host [127.0.0.1]: ")
		host, _ := reader.ReadString('\n'); host = strings.TrimSpace(host)
		if host == "" { host = "127.0.0.1" }
		fmt.Print("Server port [38271]: ")
		p, _ := reader.ReadString('\n'); p = strings.TrimSpace(p)
		port, _ := strconv.Atoi(p); if port == 0 { port = 38271 }
		fmt.Print("Admin password: ")
		pwd1, _ := reader.ReadString('\n'); pwd1 = strings.TrimSpace(pwd1)
		fmt.Print("Confirm: ")
		pwd2, _ := reader.ReadString('\n'); pwd2 = strings.TrimSpace(pwd2)
		if pwd1 != pwd2 { fmt.Println("passwords do not match"); os.Exit(1) }
		st, d, _ := call("POST", "/api/admin/setup", map[string]interface{}{"host":host,"port":port,"password_md5":md5Hash(pwd1),"database":map[string]interface{}{"type":"sqlite3","path":"./nantianmen.db"}}, nil, true)
		if st != 200 { fmt.Fprintf(os.Stderr, "setup failed: %d %s\n", st, d); os.Exit(1) }
		fmt.Println("server initialized")
		saveCfg(map[string]interface{}{"host":host,"port":port,"password_md5":md5Hash(pwd1)})
		fmt.Printf("saved config to %s\n", cfgFile)

	case "health":
		_, d, _ := call("GET", "/v1/health", nil, nil, true)
		fmt.Println(string(d))

	case "login":
		reader := bufio.NewReader(os.Stdin)
		fmt.Print("Admin password: ")
		pwd, _ := reader.ReadString('\n'); pwd = strings.TrimSpace(pwd)
		st, d, _ := call("POST", "/api/admin/login", map[string]string{"password_md5":md5Hash(pwd)}, nil, true)
		if st != 200 { fmt.Fprintf(os.Stderr, "login failed: %d %s\n", st, d); os.Exit(1) }
		cfg := loadCfg()
		cfg["host"] = args.Host; cfg["port"] = args.Port; cfg["password_md5"] = md5Hash(pwd)
		saveCfg(cfg)
		fmt.Printf("saved to %s\n", cfgFile)

	case "providers", "provider":
		cmdProviders(rest)

	case "apikey":
		cmdApikeys(rest)

	case "models", "model":
		cmdModels(rest)

	case "stats":
		st, d, _ := call("GET", "/api/admin/stats", nil, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d\n", st); os.Exit(1) }
		var data map[string]interface{}
		json.Unmarshal(d, &data)
		fmt.Printf("total: %v reqs   cost: $%.4f\n", data["total_requests"], data["total_cost"])
		fmt.Printf("in: %v out: %v cached: %v\n", data["total_input_tokens"], data["total_output_tokens"], data["total_cached_tokens"])
		// ponytail: v0.4.24 — dump breakdown so CLI matches desktop Stats table intent.
		if rows, ok := data["breakdown"].([]interface{}); ok && len(rows) > 0 {
			fmt.Println("\nprovider	model	reqs	in	out	cached	hit%	cost")
			for _, r := range rows {
				m := r.(map[string]interface{})
				in := toF(m["input_tokens"]); cached := toF(m["cached_tokens"])
				hit := 0.0
				if in > 0 { hit = cached / in * 100 }
				fmt.Printf("%v	%v	%v	%v	%v	%v	%.2f%%	$%.4f\n",
					m["provider"], m["model_name"], m["request_count"], in, m["output_tokens"], cached, hit, toF(m["cost"]))
			}
		}

	case "settings":
		st, d, _ := call("GET", "/api/admin/settings", nil, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d\n", st); os.Exit(1) }
		fmt.Println(string(d))

	case "server":
		cmdServer(rest, args)

	case "reverse-proxy":
		cmdReverseProxy(rest)

	case "shutdown":
		call("POST", "/api/admin/server/shutdown", map[string]string{}, nil, false)
		fmt.Println("shutdown signal sent")

	default:
		ensureServer(args)
		switch sub {
		case "status":
			st, d, _ := call("GET", "/api/admin/status", nil, nil, true)
			fmt.Println(string(d))
			if st != 200 { os.Exit(1) }
		default:
			fmt.Fprintf(os.Stderr, "unknown command: %s\n", sub); os.Exit(1)
		}
	}
}

func cmdProviders(a []string) {
	sub := ""
	if len(a) > 0 { sub = a[0] }
	switch sub {
	case "ls", "":
		st, d, _ := call("GET", "/api/admin/providers", nil, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d\n", st); os.Exit(1) }
		var list []map[string]interface{}
		json.Unmarshal(d, &list)
		for _, p := range list {
			// ponytail: count nested models so the operator can see what's there before drilling in with `models ls`.
			n := 0
			if ms, ok := p["models"].([]interface{}); ok { n = len(ms) }
			fmt.Printf("%v	%s	%s	%s	%d models\n", p["id"], p["name"], p["protocol"], p["base_url"], n)
		}
	case "add":
		reader := bufio.NewReader(os.Stdin)
		fmt.Print("Provider name: "); name, _ := reader.ReadString('\n'); name = strings.TrimSpace(name)
		if name == "" { fmt.Println("name required"); os.Exit(1) }
		fmt.Print("Protocol (openai|anthropic): "); proto, _ := reader.ReadString('\n'); proto = strings.TrimSpace(proto)
		fmt.Print("Base URL: "); base, _ := reader.ReadString('\n'); base = strings.TrimSpace(base)
		fmt.Print("API key: "); key, _ := reader.ReadString('\n'); key = strings.TrimSpace(key)
		st, d, _ := call("POST", "/api/admin/providers", map[string]string{"name":name,"protocol":proto,"base_url":base,"api_key":key}, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d %s\n", st, d); os.Exit(1) }
		var r map[string]interface{}
		json.Unmarshal(d, &r)
		fmt.Printf("added id=%v\n", r["id"])
	case "rm":
		id := ""; if len(a) > 1 { id = a[1] }
		if id == "" { fmt.Print("Provider id: "); fmt.Scanln(&id) }
		call("DELETE", "/api/admin/providers/"+id, nil, nil, false)
		fmt.Println("removed")
	}
}

func cmdApikeys(a []string) {
	sub := ""
	if len(a) > 0 { sub = a[0] }
	switch sub {
	case "ls", "":
		st, d, _ := call("GET", "/api/admin/api-keys", nil, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d\n", st); os.Exit(1) }
		var list []map[string]interface{}
		json.Unmarshal(d, &list)
		for _, k := range list { fmt.Printf("%v\t%s\t%s\t%s\n", k["id"], k["key"], k["name"], k["note"]) }
	case "new":
		reader := bufio.NewReader(os.Stdin)
		fmt.Print("Name: "); name, _ := reader.ReadString('\n'); name = strings.TrimSpace(name)
		fmt.Print("Note: "); note, _ := reader.ReadString('\n'); note = strings.TrimSpace(note)
		st, d, _ := call("POST", "/api/admin/api-keys", map[string]string{"name":name,"note":note}, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d %s\n", st, d); os.Exit(1) }
		var r map[string]interface{}
		json.Unmarshal(d, &r)
		fmt.Printf("key: %s\n", r["key"])
	case "rm":
		id := ""; if len(a) > 1 { id = a[1] }
		if id == "" { fmt.Print("Key id: "); fmt.Scanln(&id) }
		call("DELETE", "/api/admin/api-keys/"+id, nil, nil, false)
		fmt.Println("removed")
	}
}

// ponytail: model subcommand mirrors cmdApikeys style. Server routes:
//   GET    /api/admin/providers/{id}/models                      → list
//   DELETE /api/admin/providers/{id}/models/{modelId}            → hard-delete (default model 400)
func cmdModels(a []string) {
	sub := ""
	if len(a) > 0 { sub = a[0] }
	switch sub {
	case "ls":
		pid := ""; if len(a) > 1 { pid = a[1] }
		if pid == "" { fmt.Print("Provider id: "); fmt.Scanln(&pid) }
		st, d, _ := call("GET", "/api/admin/providers/"+pid+"/models", nil, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d\n", st); os.Exit(1) }
		var list []map[string]interface{}
		json.Unmarshal(d, &list)
		for _, m := range list {
			cap := m["capability"]
			def := ""
			if toF(m["is_default"]) == 1 { def = " ★default" }
			if toF(m["is_default_embedding"]) == 1 { def += " ★default-emb" }
			if toF(m["is_disabled"]) == 1 { def += " disabled" }
			fmt.Printf("%v	%s	%v%s\n", m["id"], m["model_name"], cap, def)
		}
	case "rm":
		if len(a) < 3 { fmt.Println("usage: models rm <provider-id> <model-id>"); os.Exit(1) }
		fmt.Printf("delete model %s from provider %s? [y/N] ", a[2], a[1])
		reader := bufio.NewReader(os.Stdin)
		ans, _ := reader.ReadString('\n'); ans = strings.TrimSpace(strings.ToLower(ans))
		if ans != "y" && ans != "yes" { fmt.Println("aborted"); return }
		st, d, _ := call("DELETE", "/api/admin/providers/"+a[1]+"/models/"+a[2], nil, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d %s\n", st, d); os.Exit(1) }
		fmt.Println("removed")
	// ponytail: v0.5.1 — setdefault / setdefault-embedding subcommands.
	//   models setdefault <provider-id> <model-id>          → default chat model
	//   models setdefault-embedding <provider-id> <model-id> → default embedding model
	case "setdefault":
		if len(a) < 3 { fmt.Println("usage: models setdefault <provider-id> <model-id>"); os.Exit(1) }
		st, d, _ := call("PUT", "/api/admin/providers/"+a[1]+"/models/"+a[2]+"/default", nil, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d %s\n", st, d); os.Exit(1) }
		fmt.Println("default chat model set")
	case "setdefault-embedding":
		if len(a) < 3 { fmt.Println("usage: models setdefault-embedding <provider-id> <model-id>"); os.Exit(1) }
		st, d, _ := call("PUT", "/api/admin/providers/"+a[1]+"/models/"+a[2]+"/default-embedding", nil, nil, false)
		if st != 200 { fmt.Fprintf(os.Stderr, "failed: %d %s\n", st, d); os.Exit(1) }
		fmt.Println("default embedding model set")
	default:
		fmt.Fprintf(os.Stderr, "usage: models <ls|rm|setdefault|setdefault-embedding> ...\n"); os.Exit(1)
	}
}

func cmdServer(a []string, args CLIArgs) {
	sub := ""
	if len(a) > 0 { sub = a[0] }
	switch sub {
	case "start":
		ensureServer(args)
		fmt.Printf("server started on %s:%d\n", args.Host, args.Port)
	case "status", "":
		online, compatible, ver := probeHealth(args.Host, args.Port)
		if compatible { fmt.Printf("online %s:%d v%s\n", args.Host, args.Port, ver) } else if online { fmt.Printf("mismatch server v%s client v%s\n", ver, ClientVersion) } else { fmt.Printf("offline %s:%d\n", args.Host, args.Port) }
	}
}
