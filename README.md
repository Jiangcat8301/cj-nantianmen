# 南天门 Nantianmen

> 多协议 LLM 代理网关，统一管理多 Provider、多模型的请求转发与协议转换。

## 项目简介

南天门是一个本地运行的 LLM 代理网关服务。它接收来自不同 Agent 的大模型请求（兼容 OpenAI 和 Anthropic 协议），根据用户选择的模型将请求转发到对应的 LLM Provider，并将结果返回给 Agent。在此过程中，如 Agent 使用协议与 Provider 协议不同，南天门会自动进行协议转换。

## 架构

```
cj-nantianmen/
├── server/       # Python FastAPI 后端，可独立运行
│   └── app/
│       ├── api/       # 路由：admin API + LLM 代理
│       ├── core/      # 配置、安全、PID 锁
│       ├── db/        # SQLite 初始化 + WAL
│       ├── models/    # Pydantic schema
│       └── services/  # Provider 管理、协议转换、统计
├── desktop/      # Electron + Vue3 + Vite + Tailwind CSS 桌面管理界面
│   └── src/
│       ├── components/
│       ├── views/
│       └── lib/
├── cli/          # Go 静态编译 CLI，功能与 UI 对等
│   └── cmd/
└── build/        # 构建产物（不入 repo）
```

### 三组件职责

| 组件 | 语言 | 职责 |
|------|------|------|
| **server** | Python (FastAPI) | HTTP 代理网关 + 管理 API + SQLite 数据存储 + PID 文件锁 |
| **desktop** | TypeScript (Electron+Vue3) | 图形化管理界面，通过 Admin API 控制 server |
| **cli** | Go (stdlib) | 命令行管理工具，功能与 desktop 对等 |

### 通信流程

```
Agent ──(skm-xxx key)──► Server ──(provider key)──► LLM Provider
                         │
                    ┌────┴────┐
                    │ 协议转换  │ OpenAI ⇄ Anthropic
                    │ 流式透传  │ SSE pipe-through
                    │ 统计计数  │ token / 请求次数
                    └─────────┘
```

desktop / cli ──(admin API)──► Server (启动/停止/配置/查询)

## 功能

- **Provider 管理**：注册多个 LLM Provider（OpenAI / Anthropic / 兼容服务），配置 endpoint、API Key、通讯协议
- **Health 检测**：通过 `/models` 端点探测 Provider 连通性与 API Key 有效性
- **模型列表**：自动获取 Provider 可用模型列表，也可手动填写
- **默认模型**：设置某个 Provider + Model 为默认，Agent 可选 `auto` 使用
- **用户管理**：生成南天门 API Key（`skm-` 前缀），记录名称与备注
- **双协议入站**：兼容 OpenAI Chat Completions 和 Anthropic Messages 协议
- **协议转换**：Agent 与 Provider 协议不同时自动转换（4 条转换路径）
- **流式透传**：SSE 响应边收边发，不缓冲
- **统计**：记录模型使用次数、请求次数、上传/下载 Token 数（区分 cached）

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.11+ / FastAPI / uvicorn / httpx / SQLite (WAL) |
| 前端 | Electron / Vue 3 / Vite / Tailwind CSS |
| CLI | Go 1.21+ / stdlib (无第三方依赖，CGO_ENABLED=0 静态编译) |
| 数据库 | SQLite (WAL 模式，跨平台) |

## 快速开始

### Server

```bash
cd server
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
python -m app.main
```

Server 默认监听 `http://127.0.0.1:7300`。

### Desktop

```bash
cd desktop
npm install
npm run dev
```

### CLI

```bash
cd cli
go build -o nantianmen .
./nantianmen help
```

## API Key

Agent 使用南天门 API Key 与 Server 通信，格式为 `skm-` 前缀。Provider 的 API Key 仅存储在 Server 端，不会暴露给 Agent。

## 兼容性

- Windows / Linux / macOS 全平台支持
- Go CLI 静态编译，无外部依赖
- Python Server 需 Python 3.11+
- Electron Desktop 需 Node.js 18+

## License

MIT
