<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-xl font-bold">{{ t('stats_title') }}</h2>
      <button @click="load" class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition">
        ↻ {{ t('refresh') }}
      </button>
    </div>

    <!-- Filter -->
    <div class="flex gap-3 mb-6">
      <select v-model="filters.provider" @change="onProviderChange" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">全部供应商</option>
        <option v-for="p in providerList" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select v-model="filters.model" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">全部模型</option>
        <option v-for="m in modelList" :key="m" :value="m">{{ m }}</option>
      </select>
      <select v-model="filters.range" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="today">{{ t('stats_today') }}</option>
        <option value="7d">{{ t('stats_7d') }}</option>
        <option value="30d">{{ t('stats_30d') }}</option>
        <option value="">{{ t('stats_all') }}</option>
      </select>
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-5 gap-4 mb-6">
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">{{ t('stats_total_requests') }}</p>
        <p class="text-2xl font-bold text-emerald-400">{{ stats.total_requests || 0 }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">{{ t('stats_input_tokens') }}</p>
        <p class="text-2xl font-bold">{{ formatNum(stats.total_input_tokens) }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">{{ t('stats_output_tokens') }}</p>
        <p class="text-2xl font-bold">{{ formatNum(stats.total_output_tokens) }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">{{ t('stats_cached_tokens') }}</p>
        <p class="text-2xl font-bold text-blue-400">{{ formatNum(stats.total_cached_tokens) }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">{{ t('stats_total_cost') }}</p>
        <p class="text-2xl font-bold text-amber-400">¥{{ totalCost.toFixed(4) }}</p>
      </div>
    </div>

    <!-- Top 5 模型请求量 -->
    <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6">
      <h3 class="text-sm font-semibold text-gray-400 mb-4">{{ t('stats_top_models') }}</h3>
      <div class="space-y-3" v-if="topModels.length">
        <div v-for="(m, i) in topModels" :key="i" class="flex items-center gap-3">
          <span class="text-xs text-gray-400 w-48 flex-shrink-0 text-right truncate" :title="m.provider+' → '+m.model">{{ m.provider }} → {{ m.model }}</span>
          <div class="flex-1 flex flex-col gap-0.5">
            <div class="bg-gray-700 rounded-sm h-3 relative">
              <div class="bg-cyan-500 h-full rounded-sm absolute left-0 inset-y-0" :style="{ width: (m.tokens / maxModelTokens * 100) + '%' }"></div>
              <span class="absolute right-1 inset-y-0 flex items-center text-[10px] text-gray-200 leading-none">{{ formatNum(m.tokens) }} tok</span>
            </div>
            <div class="bg-gray-700 rounded-sm h-3 relative">
              <div class="bg-emerald-500 h-full rounded-sm absolute left-0 inset-y-0" :style="{ width: (m.requests / maxModelReqs * 100) + '%' }"></div>
              <span class="absolute right-1 inset-y-0 flex items-center text-[10px] text-gray-200 leading-none">{{ m.requests }} req</span>
            </div>
            <div class="bg-gray-700 rounded-sm h-3 relative">
              <div class="bg-amber-500 h-full rounded-sm absolute left-0 inset-y-0" :style="{ width: (m.cost / maxModelCost * 100) + '%' }"></div>
              <span class="absolute right-1 inset-y-0 flex items-center text-[10px] text-gray-200 leading-none">¥{{ m.cost.toFixed(4) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-center py-4 text-gray-500 text-sm">{{ t('stats_no_data') }}</div>
    </div>

    <!-- Top 5 请求用户 -->
    <div class="bg-gray-800 rounded-lg p-5 border border-gray-700 mb-6">
      <h3 class="text-sm font-semibold text-gray-400 mb-4">{{ t('stats_top_users') }}</h3>
      <div class="space-y-3" v-if="topUsers.length">
        <div v-for="(u, i) in topUsers" :key="i" class="flex items-center gap-3">
          <span class="text-xs text-gray-400 w-48 flex-shrink-0 text-right truncate" :title="u.name">{{ u.name }}</span>
          <div class="flex-1 flex flex-col gap-0.5">
            <div class="bg-gray-700 rounded-sm h-3 relative">
              <div class="bg-cyan-500 h-full rounded-sm absolute left-0 inset-y-0" :style="{ width: (u.tokens / maxUserTokens * 100) + '%' }"></div>
              <span class="absolute right-1 inset-y-0 flex items-center text-[10px] text-gray-200 leading-none">{{ formatNum(u.tokens) }} tok</span>
            </div>
            <div class="bg-gray-700 rounded-sm h-3 relative">
              <div class="bg-emerald-500 h-full rounded-sm absolute left-0 inset-y-0" :style="{ width: (u.requests / maxUserReqs * 100) + '%' }"></div>
              <span class="absolute right-1 inset-y-0 flex items-center text-[10px] text-gray-200 leading-none">{{ u.requests }} req</span>
            </div>
            <div class="bg-gray-700 rounded-sm h-3 relative">
              <div class="bg-amber-500 h-full rounded-sm absolute left-0 inset-y-0" :style="{ width: (u.cost / maxUserCost * 100) + '%' }"></div>
              <span class="absolute right-1 inset-y-0 flex items-center text-[10px] text-gray-200 leading-none">¥{{ u.cost.toFixed(4) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-center py-4 text-gray-500 text-sm">{{ t('stats_no_data') }}</div>
    </div>

    <!-- Breakdown Table -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-750 border-b border-gray-700 text-gray-400">
          <tr>
            <th class="text-left px-4 py-3">{{ t('stats_table_provider') }}</th>
            <th class="text-left px-4 py-3">{{ t('stats_table_model') }}</th>
            <th class="text-right px-4 py-3">{{ t('stats_table_requests') }}</th>
            <th class="text-right px-4 py-3">{{ t('stats_table_input') }}</th>
            <th class="text-right px-4 py-3">{{ t('stats_table_output') }}</th>
            <th class="text-right px-4 py-3">{{ t('stats_table_cached') }}</th>
            <th class="text-right px-4 py-3">{{ t('stats_cost') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in (stats.breakdown || [])" :key="i" class="border-b border-gray-700/50">
            <td class="px-4 py-3">{{ row.provider }}</td>
            <td class="px-4 py-3 font-mono text-gray-400">{{ row.model_name }}</td>
            <td class="px-4 py-3 text-right">{{ row.request_count }}</td>
            <td class="px-4 py-3 text-right">{{ formatNum(row.input_tokens) }}</td>
            <td class="px-4 py-3 text-right">{{ formatNum(row.output_tokens) }}</td>
            <td class="px-4 py-3 text-right text-blue-400">{{ formatNum(row.cached_tokens) }}</td>
            <td class="px-4 py-3 text-right text-amber-400">{{ costForRow(row) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!stats.breakdown || stats.breakdown.length === 0" class="text-center py-8 text-gray-500">{{ t('stats_no_data') }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted, onUnmounted, watch, computed } from 'vue'
import api from '../lib/api'
import { calcCost } from '../lib/format.js'

const t = inject('t')
const filters = ref({ provider: '', model: '', range: '7d' })
const stats = ref({})
const providerList = ref([])
const modelList = ref([])
let poll = null

const load = async () => {
  try {
    const p = {}
    if (filters.value.provider) p.provider_id = filters.value.provider
    if (filters.value.model) p.model_name = filters.value.model
    if (filters.value.range) p.range = filters.value.range
    const { data } = await api.getStats(p)
    stats.value = data
  } catch {}
}

const loadProviders = async () => {
  try {
    const { data } = await api.listProviders()
    providerList.value = data || []
  } catch {}
}

const onProviderChange = async () => {
  modelList.value = []
  if (filters.value.provider) {
    try {
      const { data } = await api.getModels(filters.value.provider)
      modelList.value = (data || []).filter(m => !m.deleted).map(m => m.model_name)
    } catch {}
  }
  load()
  saveFilters()
}

onMounted(async () => {
  // ponytail: restore saved filters from conf
  try {
    const { data } = await api.getUiFilters()
    if (data?.stats) {
      if (data.stats.provider) filters.value.provider = data.stats.provider
      if (data.stats.model) filters.value.model = data.stats.model
      if (data.stats.range) filters.value.range = data.stats.range
    }
  } catch {}
  await loadProviders()
  if (filters.value.provider) await onProviderChange()
  else load()
  poll = setInterval(load, 10000)
})
onUnmounted(() => { if (poll) clearInterval(poll) })
watch(() => filters.value.range, () => { load(); saveFilters() })
watch(() => filters.value.model, () => { load(); saveFilters() })

// ponytail: persist filters so they survive page navigation
async function saveFilters() {
  try {
    const { data: current } = await api.getUiFilters()
    await api.saveUiFilters({ ...current, stats: { provider: filters.value.provider, model: filters.value.model, range: filters.value.range } })
  } catch {}
}

// ponytail: cost = (input-cached)*input_price + output*output_price + cached*cache_hit_price
const totalCost = computed(() => {
  let c = 0
  for (const r of (stats.value.breakdown || [])) c += calcCost(r)
  return c
})

const costForRow = (r) => '¥' + calcCost(r).toFixed(4)

const topModels = computed(() => {
  return (stats.value.breakdown || [])
    .map(r => ({
      provider: r.provider || '?', model: r.model_name || '?',
      requests: r.request_count || 0, tokens: (r.input_tokens || 0) + (r.output_tokens || 0),
      cost: ((r.input_tokens||0)*(r.input_price||0) + (r.output_tokens||0)*(r.output_price||0) + (r.cached_tokens||0)*(r.cache_hit_price||0)) / 1_000_000,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
})
const maxModelTokens = computed(() => Math.max(1, ...topModels.value.map(m => m.tokens)))
const maxModelReqs = computed(() => Math.max(1, ...topModels.value.map(m => m.requests)))
const maxModelCost = computed(() => Math.max(0.0001, ...topModels.value.map(m => m.cost)))

const topUsers = computed(() => {
  const byKey = {}
  for (const r of (stats.value.breakdown || [])) {
    const kid = r.api_key_id; if (!kid) continue
    if (!byKey[kid]) byKey[kid] = { name: r.key_name || `Key #${kid}`, requests: 0, tokens: 0, cost: 0 }
    byKey[kid].requests += r.request_count || 0
    byKey[kid].tokens += (r.input_tokens || 0) + (r.output_tokens || 0)
    byKey[kid].cost += ((r.input_tokens||0)*(r.input_price||0) + (r.output_tokens||0)*(r.output_price||0) + (r.cached_tokens||0)*(r.cache_hit_price||0)) / 1_000_000
  }
  return Object.values(byKey).sort((a, b) => b.tokens - a.tokens).slice(0, 5)
})
const maxUserTokens = computed(() => Math.max(1, ...topUsers.value.map(u => u.tokens)))
const maxUserReqs = computed(() => Math.max(1, ...topUsers.value.map(u => u.requests)))
const maxUserCost = computed(() => Math.max(0.0001, ...topUsers.value.map(u => u.cost)))

const formatNum = (n) => {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}
</script>
