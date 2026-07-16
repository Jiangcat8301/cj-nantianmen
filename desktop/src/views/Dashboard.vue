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
          <button @click="copy(ep.url)" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">{{ t('copy') }}</button>
        </div>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="grid grid-cols-5 gap-4 mb-6">
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2">{{ t('provider_count') }}</p>
        <p class="text-3xl font-bold text-emerald-400">{{ providerCount }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2">{{ t('apikey_count') }}</p>
        <p class="text-3xl font-bold text-emerald-400">{{ keyCount }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2">{{ t('today_requests') }}</p>
        <p class="text-3xl font-bold text-emerald-400">{{ todayReqs }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2">{{ t('today_tokens') }}</p>
        <p class="text-3xl font-bold text-emerald-400">{{ formatNum(todayTokens) }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2">{{ t('today_cost') }}</p>
        <p class="text-3xl font-bold text-emerald-400">¥{{ todayCost.toFixed(4) }}</p>
      </div>
    </div>

    <!-- DB Volume + Commlog count -->
    <div class="grid grid-cols-2 gap-4 mb-6">
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2">{{ t('db_volume') }}</p>
        <p class="text-3xl font-bold text-emerald-400">{{ dbSize }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <p class="text-xs text-gray-500 mb-2">{{ t('log_count') }}</p>
        <p class="text-3xl font-bold text-emerald-400">{{ fmtNum(dbLogCount) }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted, onUnmounted } from 'vue'
import api from '../lib/api'

const t = inject('t')
const win = typeof window !== 'undefined' ? window.win : null
const online = ref(false)
const providerCount = ref(0)
const keyCount = ref(0)
const todayReqs = ref(0)
const todayTokens = ref(0)
const todayCost = ref(0)
const defaultModel = ref(null)
const dbSize = ref('—')
const dbLogCount = ref(0)
let statsPoll = null

const endpoints = [
  { method: 'POST', url: 'http://127.0.0.1:38271/v1/chat/completions', tag: 'OpenAI', protocol: 'openai' },
  { method: 'POST', url: 'http://127.0.0.1:38271/v1/messages', tag: 'Anthropic', protocol: 'anthropic' },
  { method: 'GET', url: 'http://127.0.0.1:38271/v1/models', tag: 'Models', protocol: '' },
  { method: 'GET', url: 'http://127.0.0.1:38271/v1/health', tag: 'Health', protocol: '' },
]

const loadStatus = async () => {
  if (!win) return
  const r = await win.serverStatus()
  online.value = r.online
}

const loadStats = async () => {
  try {
    const [{ data: providers }, { data: keys }, { data: stats }, { data: dm }] = await Promise.all([
      api.listProviders(), api.listApiKeys(), api.getStats({ range: 'today' }), api.getDefaultModel()
    ])
    providerCount.value = providers.length
    keyCount.value = keys.length
    todayReqs.value = stats.total_requests || 0
    todayTokens.value = (stats.total_input_tokens || 0) + (stats.total_output_tokens || 0)
    let cost = 0
    for (const r of (stats.breakdown || [])) {
      cost += ((r.input_tokens || 0) * (r.input_price || 0) + (r.output_tokens || 0) * (r.output_price || 0) + (r.cached_tokens || 0) * (r.cache_hit_price || 0)) / 1_000_000
    }
    todayCost.value = cost
    defaultModel.value = dm
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

const formatNum = (n) => {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let s = bytes
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++ }
  return s.toFixed(i > 0 ? 2 : 0) + ' ' + units[i]
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
