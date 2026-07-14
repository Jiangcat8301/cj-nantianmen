# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 项目初始化：三目录架构（server / desktop / cli）
- Server: Python FastAPI 后端骨架
- Desktop: Electron + Vue3 + Vite + Tailwind CSS 前端骨架
- CLI: Go 静态编译命令行工具骨架
- SQLite 数据库 schema 设计（providers / api_keys / models / usage_stats / settings）
- Provider 管理：CRUD + health 检测 + 模型列表获取/缓存 + 默认模型设置
- 用户管理：南天门 API Key 生成（`skm-` 前缀）/ 列表 / 删除
- LLM 代理核心：OpenAI Chat Completions + Anthropic Messages 双协议入站
- 协议转换：4 条互转路径 + 流式透传
- 统计：请求次数 / Token 用量 / cached token 区分
- PID 文件锁：确保 Server 运行唯一性
- 跨平台支持：Windows / Linux / macOS
