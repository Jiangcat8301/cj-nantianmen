package conf

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
)

var (
	ConfPath string
	DbPath   string
	conf     *Config
)

type Config struct {
	Initialized        bool        `json:"initialized"`
	ServerHost         string      `json:"server_host"`
	ServerPort         int         `json:"server_port"`
	Password           string      `json:"password"`
	Salt               string      `json:"salt"`
	LogEnabled         bool        `json:"log_enabled"`
	LogRotationEnabled bool        `json:"log_rotation_enabled"`
	LogRotationMax     int         `json:"log_rotation_max"`
	Proxy              string      `json:"proxy"`
	ProxyURL           string      `json:"proxy_url"`
	Database           DatabaseCfg `json:"database"`
	UIFilters          interface{} `json:"ui_filters"`
	WindowState        interface{} `json:"window_state"`
	// ponytail: v0.5.0 — FRPC reverse-proxy (公网穿透). Desktop/CLI manage the child process;
	// server only persists config so multi-process stays in sync via shared nantianmen-conf.json.
	Frpc *FrpcConfig `json:"frpc,omitempty"`
}

// FrpcConfig is read by desktop/CLI; server itself does not touch frpc.
// JSON tag-only struct — no validation here (process managers do their own).
type FrpcConfig struct {
	// ponytail: v0.5.0 — enabled is the user's "should this run?" toggle.
	// It is independent from auto_start: enabled=false means "do not start
	// frpc at all", while auto_start only governs whether desktop boot
	// triggers an automatic spawn. Disabling preserves the rest of the config.
	Enabled    bool   `json:"enabled"`
	AutoStart  bool   `json:"auto_start"`
	ServerAddr string `json:"server_addr,omitempty"` // FRPS public host
	ServerPort int    `json:"server_port,omitempty"` // FRPS bindPort
	Token      string `json:"token,omitempty"`       // FRPS auth token
	RemotePort int    `json:"remote_port,omitempty"` // exposed port on FRPS
	LocalPort  int    `json:"local_port,omitempty"`  // 南天门 listen port (default 38271)
}

type DatabaseCfg struct {
	Type string `json:"type"`
	Path string `json:"path"`
}

func DefaultBaseDir() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".cj-nantianmen")
}

func GetConfDir() string {
	return filepath.Dir(GetConfPath())
}

func GetConfPath() string {
	if ConfPath != "" {
		return ConfPath
	}
	ConfPath = filepath.Join(DefaultBaseDir(), "nantianmen-conf.json")
	return ConfPath
}

func GetDefaultDbPath() string {
	if DbPath != "" {
		return DbPath
	}
	DbPath = filepath.Join(DefaultBaseDir(), "nantianmen.db")
	return DbPath
}

func DefaultConf() Config {
	return Config{
		Initialized: true,
		ServerHost:  "127.0.0.1",
		ServerPort:  38271,
		Password:    "",
		Salt:        "",
		LogEnabled:  false,
		Proxy:       "system",
		ProxyURL:    "",
		Database: DatabaseCfg{
			Type: "sqlite3",
			Path: GetDefaultDbPath(),
		},
	}
}

func RandomSalt() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	s := make([]byte, 6)
	for i := range s {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		s[i] = chars[n.Int64()]
	}
	return string(s)
}

func Md5(s string) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(s)))
}

func LoadConf() Config {
	cp := GetConfPath()
	data, err := os.ReadFile(cp)
	if err == nil {
		json.Unmarshal(data, &conf)
		if conf != nil {
			// Resolve relative DB path
			if conf.Database.Path != "" && !filepath.IsAbs(conf.Database.Path) {
				conf.Database.Path = filepath.Join(GetConfDir(), conf.Database.Path)
			}
			return *conf
		}
	}
	c := DefaultConf()
	if c.Salt == "" {
		c.Salt = RandomSalt()
	}
	if c.Password == "" {
		c.Password = Md5(Md5("admin") + c.Salt)
	}
	conf = &c
	SaveConf()
	return c
}

func GetConf() Config {
	if conf == nil {
		return LoadConf()
	}
	return *conf
}

func UpdateConf(patch map[string]interface{}) {
	if conf == nil {
		c := LoadConf()
		conf = &c
	}
	// Simple merge
	data, _ := json.Marshal(patch)
	json.Unmarshal(data, conf)
	SaveConf()
}

func SaveConf() {
	if conf == nil {
		return
	}
	data, _ := json.MarshalIndent(conf, "", "  ")
	os.MkdirAll(filepath.Dir(GetConfPath()), 0700)
	os.WriteFile(GetConfPath(), data, 0600)
}

func SetPaths(cfgPath, dbPath string) {
	if cfgPath != "" {
		ConfPath = cfgPath
	}
	if dbPath != "" {
		DbPath = dbPath
	}
}
