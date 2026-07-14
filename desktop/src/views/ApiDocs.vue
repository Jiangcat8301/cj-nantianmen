<template>
  <div class="p-6 max-w-4xl">
    <h2 class="text-xl font-bold mb-6">API 文档</h2>

    <h3 class="text-lg font-semibold text-emerald-400 mb-3">LLM Proxy API</h3>
    <div class="space-y-4 mb-8">
      <div v-for="ep in proxyEndpoints" :key="ep.path" class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div class="flex items-center gap-3 mb-2">
          <span class="px-2 py-0.5 text-xs font-mono rounded" :class="methodColor(ep.method)">{{ ep.method }}</span>
          <code class="text-sm text-gray-300">{{ ep.path }}</code>
        </div>
        <p class="text-sm text-gray-500 mb-2">{{ ep.desc }}</p>
        <pre class="bg-gray-900 rounded p-3 text-xs text-gray-300 overflow-x-auto">{{ ep.example }}</pre>
      </div>
    </div>

    <h3 class="text-lg font-semibold text-emerald-400 mb-3">Admin API</h3>
    <div class="space-y-4">
      <div v-for="ep in adminEndpoints" :key="ep.path" class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div class="flex items-center gap-3 mb-2">
          <span class="px-2 py-0.5 text-xs font-mono rounded" :class="methodColor(ep.method)">{{ ep.method }}</span>
          <code class="text-sm text-gray-300">{{ ep.path }}</code>
        </div>
        <p class="text-sm text-gray-500">{{ ep.desc }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
const methodColor = (m) => ({
  GET: 'bg-blue-900 text-blue-300',
  POST: 'bg-emerald-900 text-emerald-300',
  PUT: 'bg-yellow-900 text-yellow-300',
  DELETE: 'bg-red-900 text-red-300',
}[m] || 'bg-gray-700')

const proxyEndpoints = [
  {
    method: 'POST', path: '/v1/chat/completions', desc: 'OpenAI Chat Completions 协议入站',
    example: `curl http://127.0.0.1:7300/v1/chat/completions \\
  -H "Authorization: Bearer skm-xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'`
  },
  {
    method: 'POST', path: '/v1/messages', desc: 'Anthropic Messages 协议入站',
    example: `curl http://127.0.0.1:7300/v1/messages \\
  -H "x-api-key: skm-xxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}],"max_tokens":1024}'`
  },
  {
    method: 'GET', path: '/v1/models', desc: '获取可用模型列表', example: `curl http://127.0.0.1:7300/v1/models -H "Authorization: Bearer skm-xxx"`
  },
  {
    method: 'GET', path: '/v1/health', desc: 'Server 健康检查', example: `curl http://127.0.0.1:7300/v1/health`
  },
]

const adminEndpoints = [
  { method: 'GET', path: '/api/admin/providers', desc: '列出所有 Provider' },
  { method: 'POST', path: '/api/admin/providers', desc: '新增 Provider' },
  { method: 'PUT', path: '/api/admin/providers/{id}', desc: '编辑 Provider' },
  { method: 'DELETE', path: '/api/admin/providers/{id}', desc: '删除 Provider' },
  { method: 'POST', path: '/api/admin/providers/{id}/health', desc: 'Provider Health 检测' },
  { method: 'GET', path: '/api/admin/providers/{id}/models', desc: '获取 Provider 模型列表' },
  { method: 'PUT', path: '/api/admin/providers/{id}/models/{mid}/default', desc: '设置默认模型' },
  { method: 'GET', path: '/api/admin/api-keys', desc: '列出所有 API Key' },
  { method: 'POST', path: '/api/admin/api-keys', desc: '生成新 API Key' },
  { method: 'DELETE', path: '/api/admin/api-keys/{id}', desc: '删除 API Key' },
  { method: 'GET', path: '/api/admin/stats', desc: '查询统计数据' },
]
</script>
