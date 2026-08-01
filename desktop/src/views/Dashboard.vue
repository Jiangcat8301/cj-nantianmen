<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-xl font-bold">{{ t('dashboard') }}</h2>
      <button @click="loadStats" class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition">
        ↻ {{ t('refresh') }}
      </button>
    </div>

    <!-- Server Status & Control -->
    <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="w-3 h-3 rounded-full" :class="online ? 'bg-emerald-500' : 'bg-red-500'"></span>
          <div>
            <p class="text-sm font-semibold">{{ t('server_status') }}</p>
            <p class="text-xs text-gray-500">http://127.0.0.1:38271</p>
          </div>
        </div>
        <div class="flex gap-2">
          <button v-if="!online" @click="startServer" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium">
            ▶ {{ t('server_start') }}
          </button>
          <button v-if="online" @click="stopServer" class="px-4 py-2 text-sm bg-red-900 hover:bg-red-800 rounded-lg font-medium">
            ■ {{ t('server_stop') }}
          </button>
          <button @click="restartServer" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg font-medium">
            ↻ {{ t('server_restart') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Default Provider/Model -->
    <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6">
      <h3 class="text-sm font-semibold text-gray-400 mb-2">{{ t('default_provider_model') }}</h3>
      <p v-if="defaultModel" class="text-sm">
        <span class="text-gray-300">{{ defaultModel.provider_name }}</span>
        <span class="text-gray-600 mx-2">→</span>
        <code class="text-emerald-400 font-mono">{{ defaultModel.model_name }}</code>
        <span class="ml-2 px-1.5 py-0.5 text-xs rounded font-mono"
          :class="defaultModel.protocol === 'openai' ? 'bg-blue-500/20 text-blue-300' : 'bg-orange-500/20 text-orange-300'">{{ defaultModel.protocol }}</span>
      </p>
      <p v-else class="text-sm text-gray-500">—</p>
    </div>

    <!-- Server Endpoints -->
    <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6">
      <h3 class="text-sm font-semibold text-gray-400 mb-3">{{ t('server_endpoints') }}</h3>
      <div class="space-y-2">
        <div v-for="ep in endpoints" :key="ep.url" class="flex items-center justify-between bg-gray-900 rounded px-3 py-2">
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.5 text-xs font-mono rounded" :class="ep.method === 'POST' ? 'bg-emerald-900 text-emerald-300' : 'bg-blue-900 text-blue-300'">{{ ep.method }}</span>
            <code class="text-sm text-gray-300">{{ ep.url }}</code>
            <span class="px-1.5 py-0.5 text-xs rounded font-mono"
              :class="ep.protocol === 'openai' ? 'bg-blue-500/20 text-blue-300' : ep.protocol === 'anthropic' ? 'bg-orange-500/20 text-orange-300' : 'bg-gray-700 text-gray-400'">{{ ep.tag }}</span>
          </div>
          <button @click="copy(ep.url)" :title="t('copy')" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded whitespace-nowrap inline-flex items-center justify-center">
            <span class="iconfont icon-copy"></span>
          </button>
        </div>
      </div>
    </div>

    <!-- Stats Cards (#2): 6 cards in one flex row, flex-1 average-distributed, no wrap at >=1000px. -->
    <!-- ponytail: DB Volume lives in the SAME flex container as the 5 stats — same type, same row. -->
    <!-- ponytail: v0.3.15 — 7th card「今日 Embedding 请求」;embedding 计 req_count 不计 token (蒋老师 2026-08-01 拍板)。 -->
    <div class="flex gap-4 mb-6 [&>*]:flex-1 [&>*]:min-w-0 max-[999px]:flex-wrap max-[999px]:[&>*]:basis-[calc(25%-12px)] max-[999px]:[&>*]:flex-none">
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2 truncate">{{ t('provider_count') }}</p>
        <p class="text-2xl font-bold text-emerald-400">{{ providerCount }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2 truncate">{{ t('apikey_count') }}</p>
        <p class="text-2xl font-bold text-emerald-400">{{ keyCount }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2 truncate">{{ t('today_requests') }}</p>
        <p class="text-2xl font-bold text-emerald-400">{{ todayReqs }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2 truncate">{{ t('today_tokens') }}</p>
        <p class="text-2xl font-bold text-emerald-400">{{ formatNum(todayTokens) }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2 truncate">{{ t('today_cost') }}</p>
        <p class="text-2xl font-bold text-emerald-400">¥{{ todayCost.toFixed(4) }}</p>
      </div>
      <div v-if="hasEmbeddingModel" class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2 truncate">{{ t('today_embedding_requests') || '今日 Embedding 请求' }}</p>
        <p class="text-2xl font-bold text-emerald-400">{{ todayEmbedReqs }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2">{{ t('db_volume') }}</p>
        <p class="text-2xl font-bold text-emerald-400">{{ dbSize }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import api from '../lib/api'
import { calcCost, formatToken } from '../lib/format.js'

const t = inject('t')
const win = typeof window !== 'undefined' ? window.win : null
const online = ref(false)
const providerCount = ref(0)
const keyCount = ref(0)
const todayReqs = ref(0)
const todayTokens = ref(0)
const todayCost = ref(0)
// ponytail: v0.3.15 — embedding 调用的今日次数单独展示。蒋老师:token 不计,调用次数要计。
const todayEmbedReqs = ref(0)
const defaultModel = ref(null)
const dbSize = ref('—')
const dbLogCount = ref(0)
// ponytail: v0.3.15 — when at least one capability='embedding' model is registered, show the /v1/embeddings
// endpoint row in the Server Endpoints list. Loaded alongside stats via the existing available-models endpoint.
const hasEmbeddingModel = ref(false)
let statsPoll = null

// ponytail: /v1/embeddings is conditionally appended — only when an embedding model exists in the system.
const endpoints = computed(() => {
  const base = [
    { method: 'POST', url: 'http://127.0.0.1:38271/v1/chat/completions', tag: 'OpenAI', protocol: 'openai' },
    { method: 'POST', url: 'http://127.0.0.1:38271/v1/messages', tag: 'Anthropic', protocol: 'anthropic' },
    { method: 'GET', url: 'http://127.0.0.1:38271/v1/models', tag: 'Models', protocol: '' },
    { method: 'GET', url: 'http://127.0.0.1:38271/v1/health', tag: 'Health', protocol: '' },
  ]
  if (hasEmbeddingModel.value) {
    base.splice(2, 0, { method: 'POST', url: 'http://127.0.0.1:38271/v1/embeddings', tag: 'Embeddings', protocol: 'openai' })
  }
  return base
})

const loadStatus = async () => {
  if (!win) return
  const r = await win.serverStatus()
  online.value = r.online
}

const loadStats = async () => {
  try {
    const [{ data: providers }, { data: keys }, { data: stats }, { data: dm }] = await Promise.all([
      api.listProviders(), api.listApiKeys(), api.getStats({ range: 'today' }), api.getDefaultModel(),
    ])
    providerCount.value = providers.length
    keyCount.value = keys.length
    todayReqs.value = stats.total_requests || 0
    todayTokens.value = (stats.total_input_tokens || 0) + (stats.total_output_tokens || 0)
    let cost = 0
    for (const r of (stats.breakdown || [])) cost += calcCost(r)
    todayCost.value = cost
    // ponytail: 累加 capability='embedding' 行的请求数,用于 Dashboard 单独展示。
    // 不动 todayReqs (它应该包含全部调用,chat+embedding);卡片明示"embedding"以示区分。
    todayEmbedReqs.value = (stats.breakdown || [])
      .filter(r => r.capability === 'embedding')
      .reduce((s, r) => s + (r.request_count || 0), 0)
    defaultModel.value = dm
    // ponytail: listProviders returns nested models with capability; check there to avoid
    // a second round-trip (蒋老师: 「顾头不顾尾」批评 — 不再依赖 available-models endpoint).
    hasEmbeddingModel.value = Array.isArray(providers) && providers.some(p =>
      Array.isArray(p.models) && p.models.some(m => m.capability === 'embedding'),
    )
    // ponytail: also load DB info
    const { data: db } = await api.getDbInfo()
    dbSize.value = formatBytes(db.size)
    dbLogCount.value = db.log_count || 0
  } catch {}
}

const startServer = async () => {
  if (!win) return
  await win.serverStart()
  await loadStatus()
  await loadStats()
}
const stopServer = async () => {
  if (!win) return
  await win.serverStop()
  await loadStatus()
}
const restartServer = async () => {
  if (!win) return
  await win.serverRestart()
  await loadStatus()
  await loadStats()
}

const copy = (text) => {
  navigator.clipboard?.writeText(text)
}

const formatNum = formatToken

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0, s = bytes
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++ }
  // ponytail: strip trailing zeros, keep 0-2 decimals
  const fixed = s % 1 === 0 ? s.toFixed(0) : parseFloat(s.toFixed(2)).toString()
  return fixed + ' ' + units[i]
}

onMounted(async () => {
  await loadStatus()
  if (online.value) await loadStats()
  setInterval(loadStatus, 3000)
  // ponytail: auto-refresh stats every 10s
  statsPoll = setInterval(() => { if (online.value) loadStats() }, 10000)
})
onUnmounted(() => { if (statsPoll) clearInterval(statsPoll) })
</script>
