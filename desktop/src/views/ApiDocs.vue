<template>
  <div class="p-6 max-w-4xl">
    <h2 class="text-xl font-bold mb-6">API 文档</h2>

    <h3 class="text-lg font-semibold text-emerald-400 mb-3">LLM Proxy API</h3>
    <div class="space-y-4 mb-8">
      <div v-for="ep in proxyEndpoints" :key="ep.path" class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div class="flex items-center gap-3 mb-2">
          <span class="px-2 py-0.5 text-xs font-mono rounded" :class="methodColor(ep.method)">{{ ep.method }}</span>
          <code class="text-sm text-gray-300 whitespace-nowrap">{{ ep.path }}</code>
        </div>
        <p class="text-sm text-gray-500 mb-2">{{ ep.desc }}</p>
        <div class="bg-gray-900 rounded relative">
          <button @click="copyText(ep.example)" :title="t ? t('copy') : 'Copy'" class="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-gray-200 inline-flex items-center justify-center">
            <span class="iconfont icon-copy"></span>
          </button>
          <pre class="p-3 pr-12 text-xs text-gray-300 overflow-x-auto whitespace-pre">{{ ep.example }}</pre>
        </div>
      </div>
    </div>

    <h3 class="text-lg font-semibold text-emerald-400 mb-3">Admin API</h3>
    <div class="space-y-4">
      <div v-for="ep in adminEndpoints" :key="ep.path" class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div class="flex items-center gap-3 mb-2">
          <span class="px-2 py-0.5 text-xs font-mono rounded" :class="methodColor(ep.method)">{{ ep.method }}</span>
          <code class="text-sm text-gray-300 whitespace-nowrap">{{ ep.path }}</code>
        </div>
        <p class="text-sm text-gray-500 mb-2">{{ ep.desc }}</p>
        <div class="bg-gray-900 rounded relative">
          <button @click="copyText(ep.example)" :title="t ? t('copy') : 'Copy'" class="absolute top-2 right-2 text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-gray-200 inline-flex items-center justify-center">
            <span class="iconfont icon-copy"></span>
          </button>
          <pre class="p-3 pr-12 text-xs text-gray-300 overflow-x-auto whitespace-pre">{{ ep.example }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { inject } from 'vue'

const t = inject('t', null)
const methodColor = (m) => ({
  GET: 'bg-blue-900 text-blue-300',
  POST: 'bg-emerald-900 text-emerald-300',
  PUT: 'bg-yellow-900 text-yellow-300',
  DELETE: 'bg-red-900 text-red-300',
}[m] || 'bg-gray-700')

const copyText = (text) => { navigator.clipboard?.writeText(text || '') }

// ponytail: every endpoint gets an example. Use ${ENV_ADMIN_PW} placeholder
// when admin auth is needed; the proxy endpoints use Bearer SKM-XXX for the
// local key. Examples are copy-paste runnable.
const proxyEndpoints = [
  {
    method: 'POST', path: '/v1/chat/completions', desc: 'OpenAI Chat Completions 协议入站',
    example: `curl http://127.0.0.1:38271/v1/chat/completions \\
  -H "Authorization: Bearer skm-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Nantianmen-default",
    "messages": [{"role":"user","content":"用一句话回答：今天北京的天气怎么样？"}],
    "stream": false
  }'`
  },
  {
    method: 'POST', path: '/v1/messages', desc: 'Anthropic Messages 协议入站',
    example: `curl http://127.0.0.1:38271/v1/messages \\
  -H "x-api-key: skm-your-api-key" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Nantianmen-default",
    "max_tokens": 1024,
    "messages": [{"role":"user","content":"Hello, who are you?"}]
  }'`
  },
  {
    method: 'GET', path: '/v1/models', desc: '获取可用模型列表（带 Bearer 时按 key 授权过滤；不带或 key 无效时返回全量）',
    example: `curl http://127.0.0.1:38271/v1/models \\\\\n  -H "Authorization: Bearer ***"`
  },
  {
    method: 'GET', path: '/v1/health', desc: 'Server 健康检查',
    example: `curl http://127.0.0.1:38271/v1/health`
  },
]

// ponytail: admin endpoints require X-Admin-Password header (md5(password))
// ponytail: every endpoint below ships a working curl example.
const adminEndpoints = [
  { method: 'GET', path: '/api/admin/providers', desc: '列出所有 Provider',
    example: `curl http://127.0.0.1:38271/api/admin/providers \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'POST', path: '/api/admin/providers', desc: '新增 Provider',
    example: `curl -X POST http://127.0.0.1:38271/api/admin/providers \\
  -H "X-Admin-Password: <md5(your-admin-password)>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "MyProvider",
    "protocol": "openai",
    "base_url": "https://api.example.com/v1",
    "api_key": "sk-xxxxxxxx"
  }'` },
  { method: 'PUT', path: '/api/admin/providers/{id}', desc: '编辑 Provider',
    example: `curl -X PUT http://127.0.0.1:38271/api/admin/providers/1 \\
  -H "X-Admin-Password: <md5(your-admin-password)>" \\
  -H "Content-Type: application/json" \\
  -d '{"base_url":"https://new-api.example.com/v1"}'` },
  { method: 'DELETE', path: '/api/admin/providers/{id}', desc: '删除 Provider',
    example: `curl -X DELETE http://127.0.0.1:38271/api/admin/providers/1 \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'POST', path: '/api/admin/providers/{id}/health', desc: 'Provider 健康检测',
    example: `curl -X POST http://127.0.0.1:38271/api/admin/providers/1/health \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'GET', path: '/api/admin/providers/{id}/models', desc: '获取 Provider 模型列表',
    example: `curl http://127.0.0.1:38271/api/admin/providers/1/models \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'POST', path: '/api/admin/providers/{id}/models/refresh', desc: '从上游拉取最新模型列表',
    example: `curl -X POST http://127.0.0.1:38271/api/admin/providers/1/models/refresh \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'PUT', path: '/api/admin/providers/{id}/models/{mid}/toggle', desc: '启用/停用模型',
    example: `curl -X PUT http://127.0.0.1:38271/api/admin/providers/1/models/5/toggle \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'PUT', path: '/api/admin/providers/{id}/models/{mid}/default', desc: '设置默认模型',
    example: `curl -X PUT http://127.0.0.1:38271/api/admin/providers/1/models/5/default \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'PUT', path: '/api/admin/providers/{id}/models/{mid}', desc: '编辑模型价格',
    example: `curl -X PUT http://127.0.0.1:38271/api/admin/providers/1/models/5 \\
  -H "X-Admin-Password: <md5(your-admin-password)>" \\
  -H "Content-Type: application/json" \\
  -d '{"input_price":1.0,"output_price":2.0,"cache_hit_price":0.02}'` },
  { method: 'GET', path: '/api/admin/api-keys', desc: '列出所有 API Key（含 assigned_model_id、authorized_models）',
    example: `curl http://127.0.0.1:38271/api/admin/api-keys \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'POST', path: '/api/admin/api-keys', desc: '生成新 API Key（model_ids 可选，授权该 key 可用的模型）',
    example: `curl -X POST http://127.0.0.1:38271/api/admin/api-keys \\
  -H "X-Admin-Password: <md5(your-admin-password)>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "MyAgent",
    "note": "claude-code on win11",
    "model_ids": [1, 3]
  }'` },
  { method: 'PUT', path: '/api/admin/api-keys/{id}', desc: '编辑 API Key (name/note/old_name + assigned_model_id + model_ids 全量替换)',
    example: `curl -X PUT http://127.0.0.1:38271/api/admin/api-keys/1 \\
  -H "X-Admin-Password: <md5(your-admin-password)>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "RenamedAgent",
    "note": "updated",
    "old_name": "MyAgent",
    "assigned_model_id": 1,
    "model_ids": [1, 2]
  }'` },
  { method: 'GET', path: '/api/admin/api-keys/available-models', desc: '列出所有可用 model（用于前端多选授权）',
    example: `curl http://127.0.0.1:38271/api/admin/api-keys/available-models \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'DELETE', path: '/api/admin/api-keys/{id}', desc: '删除 API Key',
    example: `curl -X DELETE http://127.0.0.1:38271/api/admin/api-keys/1 \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'GET', path: '/api/admin/stats', desc: '查询统计数据（支持 ?range=today|7d|30d|all）',
    example: `curl "http://127.0.0.1:38271/api/admin/stats?range=today" \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'GET', path: '/api/admin/default-model', desc: '获取默认路由模型',
    example: `curl http://127.0.0.1:38271/api/admin/default-model \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'GET', path: '/api/admin/communication-log', desc: '查询通信日志（?page=1&per_page=20&provider_id=&model_name=&user_id=）',
    example: `curl "http://127.0.0.1:38271/api/admin/communication-log?page=1&per_page=20" \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'DELETE', path: '/api/admin/communication-log', desc: '清空通信日志',
    example: `curl -X DELETE http://127.0.0.1:38271/api/admin/communication-log \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'GET', path: '/api/admin/communication-log/config', desc: '获取日志开关状态',
    example: `curl http://127.0.0.1:38271/api/admin/communication-log/config \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'PUT', path: '/api/admin/communication-log/config', desc: '设置日志开关/滚动',
    example: `curl -X PUT http://127.0.0.1:38271/api/admin/communication-log/config \\
  -H "X-Admin-Password: <md5(your-admin-password)>" \\
  -H "Content-Type: application/json" \\
  -d '{"log_enabled":true,"log_rotation_enabled":true,"log_rotation_max":500}'` },
  { method: 'GET', path: '/api/admin/database/info', desc: '查询数据库体积/记录数',
    example: `curl http://127.0.0.1:38271/api/admin/database/info \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'POST', path: '/api/admin/database/move', desc: '迁移 DB 文件到新路径',
    example: `curl -X POST http://127.0.0.1:38271/api/admin/database/move \\
  -H "X-Admin-Password: <md5(your-admin-password)>" \\
  -H "Content-Type: application/json" \\
  -d '{"new_path":"D:/data/nantianmen.db"}'` },
  { method: 'POST', path: '/api/admin/server/shutdown', desc: '关闭 Server',
    example: `curl -X POST http://127.0.0.1:38271/api/admin/server/shutdown \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
  { method: 'POST', path: '/api/admin/server/restart', desc: '重启 Server',
    example: `curl -X POST http://127.0.0.1:38271/api/admin/server/restart \\
  -H "X-Admin-Password: <md5(your-admin-password)>"` },
]
</script>