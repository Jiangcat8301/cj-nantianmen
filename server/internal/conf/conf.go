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
	Initialized         bool        `json:"initialized"`
	ServerHost          string      `json:"server_host"`
	ServerPort          int         `json:"server_port"`
	Password            string      `json:"password"`
	Salt                string      `json:"salt"`
	LogEnabled          bool        `json:"log_enabled"`
	LogRotationEnabled  bool        `json:"log_rotation_enabled"`
	LogRotationMax      int         `json:"log_rotation_max"`
	Proxy               string      `json:"proxy"`
	ProxyURL            string      `json:"proxy_url"`
	Database            DatabaseCfg `json:"database"`
	UIFilters           interface{} `json:"ui_filters"`
	WindowState         interface{} `json:"window_state"`
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
