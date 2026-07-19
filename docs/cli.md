# CLI 使用文档

南天门 CLI（`nantianmen`）是对 Admin API 的命令行封装。除 `help` / `quit` 外，每个子命令执行前会先探测 `${HOST}:${PORT}/v1/health`，未就绪时自动 fork server 子进程。

## 常用命令

```bash
# 首次自动启动 server（如未运行），然后保存 host/port/db/admin password
nantianmen setup

# 健康检查（命令前探测；无 server 时 CLI 会自动 fork）
nantianmen health
nantianmen -H 127.0.0.1 --port 38271 health

# 改密码（内部 md5 后传 server；old + new ×2）
nantianmen -P 'oldpass' password

# Provider 与模型管理
nantianmen provider ls
nantianmen provider add
nantianmen provider models <pid>            # 列出模型（含定价）
nantianmen provider models-refresh <pid>    # 从上游刷新
nantianmen provider model-add <pid> <name>  # 手动添加
nantianmen provider model-edit <pid> <mid> --input=0.1 --output=0.5 --cache=0.01
nantianmen provider default <pid> <mid>     # 设为默认

# API Key
nantianmen apikey new
nantianmen apikey ls

# 统计（支持 --range=today|7d|30d）
nantianmen stats --range=today

# 通信日志
nantianmen log ls [--provider ID] [--model NAME] [--user ID]
nantianmen log enable|disable|clear|config

# 系统设置
nantianmen settings          # 查看
nantianmen settings set --port=8380  # 修改端口

# 全局 flags 解析顺序：--flag > $NANTIANMEN_* > ~/.cj-nantianmen/config.json > 报错
```

**自动启动 server**：除 `help` / `quit` 外，每个子命令执行前先探测 `${HOST}:${PORT}/v1/health`。若未就绪，按 `--server-bin`（或 fallback 到 `../server/index.js`，或 `$NANTIANMEN_SERVER_BIN`）fork 一份子进程，detached 独立存在；CLI 退出不影响 server 寿命。

## 命令行参数

server 接受两个路径 flag：

| Flag | 长名 | 作用 |
|------|------|------|
| `-c <path>` | `--config-path=<path>` | conf 文件路径（绝对或相对，相对以 server binary 目录为基准） |
| `-D <path>` | `--database-path=<path>` | sqlite3 db 文件路径（同上） |

不传：fallback 到家目录下的 `.cj-nantianmen/`（Win `C:\Users\<you>\.cj-nantianmen\`、macOS `/Users/<you>/.cj-nantianmen/`、Linux `/home/<you>/.cj-nantianmen/`）。三端统一，CLI/Desktop/server 默认共享同一份数据。