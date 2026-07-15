<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold">{{ t('log_title') }}</h2>
      <div class="flex gap-2">
        <label class="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-800 rounded-lg border cursor-pointer"
          :class="logEnabled ? 'border-emerald-500/50 text-emerald-400' : 'border-gray-700 text-gray-400'">
          <input type="checkbox" v-model="logEnabled" @change="toggleLog" class="sr-only" />
          <span class="w-3 h-3 rounded-full" :class="logEnabled ? 'bg-emerald-500' : 'bg-gray-600'"></span>
          {{ t('log_toggle') }}
        </label>
        <button @click="clearLogs" class="px-3 py-1.5 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition">
          {{ t('log_clear') }}
        </button>
        <button @click="load" class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition">
          ↻ {{ t('refresh') }}
        </button>
      </div>
    </div>

    <div class="flex gap-3 mb-4">
      <select v-model="filters.provider_id" @change="applyFilter" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">全部供应商</option>
        <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select v-model="filters.model_name" @change="applyFilter" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">{{ t('stats_all_models') }}</option>
        <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
      </select>
      <select v-model="filters.user_id" @change="applyFilter" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">全部用户</option>
        <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
      </select>
    </div>

    <div class="text-xs text-gray-500 mb-2">{{ t('log_count') }}: {{ logs.length }} / 1000</div>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-gray-400 border-b border-gray-700">
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_time') }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_user') }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_provider') }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_model') }}</th>
            <th class="py-2 px-2 whitespace-nowrap text-right">{{ t('log_tokens_in') }}</th>
            <th class="py-2 px-2 whitespace-nowrap text-right">{{ t('log_tokens_out') }}</th>
            <th class="py-2 px-2 whitespace-nowrap text-right">缓存命中</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_status') }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('th_actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(l, i) in logs" :key="i">
            <tr class="border-b border-gray-800 hover:bg-gray-800/50">
              <td class="py-2 px-2 text-gray-400 text-xs font-mono whitespace-nowrap">{{ l.time }}</td>
              <td class="py-2 px-2">{{ l.user_name || l.user_id || '-' }}</td>
              <td class="py-2 px-2">{{ l.provider_name }}</td>
              <td class="py-2 px-2 text-xs">{{ l.model_name }}</td>
              <td class="py-2 px-2 text-right font-mono text-xs">{{ fmt(l.tokens_input) }}</td>
              <td class="py-2 px-2 text-right font-mono text-xs">{{ fmt(l.tokens_output) }}</td>
              <td class="py-2 px-2 text-right font-mono text-xs">{{ fmt(l.tokens_cached) }}</td>
              <td class="py-2 px-2">
                <span v-if="l.error" class="text-red-400 text-xs" :title="l.error.message">✕ {{ l.error.code }}</span>
                <span v-else class="text-emerald-400 text-xs">✓</span>
              </td>
              <td class="py-2 px-2">
                <button @click="selected.delete(i) ? selected.delete(i) : selected.add(i)" class="text-xs text-blue-400 hover:underline">
                  {{ selected.has(i) ? t('collapse') : t('details') }}
                </button>
              </td>
            </tr>
            <!-- Inline detail panel -->
            <tr v-if="selected.has(i)">
              <td colspan="9" class="bg-gray-800/50 border-b border-gray-700 p-4">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <h4 class="text-xs text-gray-500 mb-1">📥 Input</h4>
                    <pre class="text-xs text-gray-300 whitespace-pre-wrap max-h-64 overflow-auto bg-gray-900 p-2 rounded">{{ pretty(l.input) }}</pre>
                  </div>
                  <div>
                    <h4 class="text-xs text-gray-500 mb-1">📤 Output</h4>
                    <pre class="text-xs text-gray-300 whitespace-pre-wrap max-h-64 overflow-auto bg-gray-900 p-2 rounded">{{ pretty(l.output) }}</pre>
                  </div>
                </div>
                <div v-if="l.error" class="mt-3 p-2 bg-red-500/10 rounded text-xs text-red-400">
                  Error {{ l.error.code }}: {{ l.error.message }}
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, inject } from 'vue'
import api from '../lib/api'

const t = inject('t')
const logs = ref([])
const logEnabled = ref(false)
const selected = ref(new Set())
const providers = ref([])
const models = ref([])
const users = ref([])
const filters = ref({ provider_id: '', model_name: '', user_id: '' })

const fmt = (n) => n ? n.toLocaleString() : '0'
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }

async function load() {
  try {
    const p = {}
    if (filters.value.provider_id) p.provider_id = filters.value.provider_id
    if (filters.value.model_name) p.model_name = filters.value.model_name
    if (filters.value.user_id) p.user_id = filters.value.user_id
    const data = (await api.getCommLog(p)).data || []
    logs.value = data.reverse()
  } catch {}
}

async function loadFilters() {
  try {
    const pr = await api.listProviders()
    providers.value = pr.data || []
    const all = (await api.getCommLog({})).data || []
    models.value = [...new Set(all.map(l => l.model_name).filter(Boolean))].sort()
    const userMap = new Map()
    all.forEach(l => { if (l.user_id) userMap.set(l.user_id, { id: l.user_id, name: l.user_name || l.user_id }) })
    users.value = [...userMap.values()]
  } catch {}
}

async function loadConfig() {
  try {
    const r = await api.getCommLogConfig()
    logEnabled.value = r.data.log_enabled
  } catch {}
}

async function toggleLog() {
  try {
    await api.setCommLogConfig(logEnabled.value)
  } catch { logEnabled.value = !logEnabled.value }
}

async function clearLogs() {
  if (!confirm(t('log_clear_confirm') || '确认清空所有日志?')) return
  try {
    await api.clearCommLog()
    logs.value = []
  } catch {}
}

async function applyFilter() { await load(); await saveFilters() }

// ponytail: persist filters so they survive page navigation
async function saveFilters() {
  try {
    const { data: current } = await api.getUiFilters()
    await api.saveUiFilters({ ...current, logs: { provider_id: filters.value.provider_id, model_name: filters.value.model_name, user_id: filters.value.user_id } })
  } catch {}
}

onMounted(async () => {
  await loadConfig()
  await loadFilters()
  // ponytail: restore saved filters from conf
  try {
    const { data } = await api.getUiFilters()
    if (data?.logs) {
      if (data.logs.provider_id) filters.value.provider_id = data.logs.provider_id
      if (data.logs.model_name) filters.value.model_name = data.logs.model_name
      if (data.logs.user_id) filters.value.user_id = data.logs.user_id
    }
  } catch {}
  await load()
})
</script>
