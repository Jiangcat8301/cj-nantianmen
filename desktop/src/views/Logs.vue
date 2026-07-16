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
        <button v-if="logEnabled" @click="openRotationModal"
          class="px-3 py-1.5 text-sm rounded-lg border transition"
          :class="rotationEnabled ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-red-500/10 border-red-500/50 text-red-400'">
          {{ rotationEnabled ? `${rotationCount}/${rotationMax}` : t('log_rotation_off') }}
        </button>
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
        <option value="">{{ t('stats_all_providers') || '全部供应商' }}</option>
        <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select v-model="filters.model_name" @change="applyFilter" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">{{ t('stats_all_models') }}</option>
        <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
      </select>
      <select v-model="filters.user_id" @change="applyFilter" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">{{ t('stats_all_users') || '全部用户' }}</option>
        <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
      </select>
    </div>

    <!-- Top pagination -->
    <Pagination v-if="totalPages > 1" :page="page" :totalPages="totalPages" @go="goPage" />

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-gray-400 border-b border-gray-700">
            <th class="py-2 px-2 whitespace-nowrap w-10">#</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_time') }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_user') }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_provider') }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_model') }}</th>
            <th class="py-2 px-2 whitespace-nowrap text-right">{{ t('log_tokens_in') }}</th>
            <th class="py-2 px-2 whitespace-nowrap text-right">{{ t('log_tokens_out') }}</th>
            <th class="py-2 px-2 whitespace-nowrap text-right">{{ t('log_tokens_cached') || '缓存命中' }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('log_status') }}</th>
            <th class="py-2 px-2 whitespace-nowrap">{{ t('th_actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(l, i) in logs" :key="l.request_id || i">
            <tr class="border-b border-gray-800 hover:bg-gray-800/50">
              <td class="py-2 px-2 text-gray-500 text-xs font-mono text-right">{{ l.id }}</td>
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
                <button @click="selected.has(l.request_id||i) ? selected.delete(l.request_id||i) : selected.add(l.request_id||i)" class="text-xs text-blue-400 hover:underline">
                  {{ selected.has(l.request_id||i) ? t('collapse') : t('details') }}
                </button>
              </td>
            </tr>
            <!-- Inline detail panel -->
            <tr v-if="selected.has(l.request_id||i)">
              <td colspan="10" class="bg-gray-800/50 border-b border-gray-700 p-4">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <h4 class="text-xs text-gray-500">📥 Input</h4>
                      <button @click="copy(l.input)" class="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-gray-200">📋</button>
                    </div>
                    <pre class="text-xs text-gray-300 whitespace-pre-wrap max-h-64 overflow-auto bg-gray-900 p-2 rounded">{{ pretty(l.input) }}</pre>
                  </div>
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <h4 class="text-xs text-gray-500">📤 Output</h4>
                      <button @click="copy(l.output)" class="text-xs px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-gray-200">📋</button>
                    </div>
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

    <!-- Bottom pagination -->
    <Pagination v-if="totalPages > 1" :page="page" :totalPages="totalPages" @go="goPage" />
  </div>
</template>

<script setup>
import { ref, onMounted, inject } from 'vue'
import api from '../lib/api'

const t = inject('t')
const modalRef = inject('modal')
const logs = ref([])
const logEnabled = ref(false)
const rotationEnabled = ref(false)
const rotationMax = ref(1000)
const rotationCount = ref(0)
const selected = ref(new Set())
const providers = ref([])
const models = ref([])
const users = ref([])
const filters = ref({ provider_id: '', model_name: '', user_id: '' })
const page = ref(1)
const totalPages = ref(1)
const total = ref(0)

const fmt = (n) => n ? n.toLocaleString() : '0'
const pretty = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }
const copy = (text) => { navigator.clipboard?.writeText(typeof text === 'string' ? text : '') }

async function load() {
  try {
    const p = { page: page.value, per_page: 20 }
    if (filters.value.provider_id) p.provider_id = filters.value.provider_id
    if (filters.value.model_name) p.model_name = filters.value.model_name
    if (filters.value.user_id) p.user_id = filters.value.user_id
    const { data } = await api.getCommLog(p)
    logs.value = data.rows || []
    total.value = data.total || 0
    totalPages.value = Math.max(1, Math.ceil(total.value / 20))
  } catch {}
}

function goPage(n) {
  page.value = n
  load()
}

async function loadFilters() {
  try {
    const pr = await api.listProviders()
    providers.value = pr.data || []
    // ponytail: for filter dropdowns, fetch full unfiltered list
    const { data: full } = await api.getCommLog({})
    const all = full.rows || full || []
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
    rotationEnabled.value = r.data.log_rotation_enabled || false
    rotationMax.value = r.data.log_rotation_max || 1000
    // ponytail: also load total count for rotation display
    if (logEnabled.value) {
      const { data: cnt } = await api.getCommLog({ page: 1, per_page: 1 })
      rotationCount.value = cnt.total || 0
    }
  } catch {}
}

async function toggleLog() {
  try {
    await api.setCommLogConfig({ log_enabled: logEnabled.value })
  } catch { logEnabled.value = !logEnabled.value }
}

async function openRotationModal() {
  if (!modalRef?.value) return
  const result = await modalRef.value.show({
    mode: 'prompt',
    title: t('log_rotation') || 'Log Rotation',
    message: (t('log_rotation_hint') || '保留最新') + ' N ' + (t('log_rotation_unit') || '条') + '（0=' + (t('log_rotation_off') || '关闭') + '）',
    placeholder: String(rotationMax.value),
    value: String(rotationMax.value),
    okText: t('btn_confirm'),
    cancelText: t('btn_cancel'),
  })
  if (result === null) return
  const n = parseInt(result) || 0
  const enabled = n > 0
  try {
    await api.setCommLogConfig({ log_rotation_enabled: enabled, log_rotation_max: enabled ? n : rotationMax.value })
    rotationEnabled.value = enabled
    if (enabled) rotationMax.value = n
  } catch {}
}

async function clearLogs() {
  if (!modalRef?.value) return
  const confirmed = await modalRef.value.show({
    mode: 'confirm',
    title: t('log_clear'),
    message: t('log_clear_confirm') || '确认清空所有通信日志?',
    okText: t('log_clear'),
    cancelText: t('btn_cancel'),
  })
  if (!confirmed) return
  try {
    await api.clearCommLog()
    logs.value = []
    total.value = 0
    totalPages.value = 1
  } catch {}
}

async function applyFilter() { page.value = 1; await load(); await saveFilters() }

async function saveFilters() {
  try {
    const { data: current } = await api.getUiFilters()
    await api.saveUiFilters({ ...current, logs: { provider_id: filters.value.provider_id, model_name: filters.value.model_name, user_id: filters.value.user_id } })
  } catch {}
}

onMounted(async () => {
  await loadConfig()
  await loadFilters()
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

<script>
// ponytail: inline Pagination component — top + bottom reuse, no extra import
import { h } from 'vue'
const Pagination = {
  props: { page: Number, totalPages: Number },
  emits: ['go'],
  setup(props, { emit }) {
    return () => {
      const p = props.page, tp = props.totalPages
      // ponytail: show first / prev / ... / next / last
      const btns = []
      if (p > 1) btns.push(
        h('button', { onClick: () => emit('go', 1), class: 'px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded' }, '«'),
        h('button', { onClick: () => emit('go', p-1), class: 'px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded' }, '‹'),
      )
      btns.push(h('span', { class: 'px-3 py-1 text-xs text-gray-400' }, `${p}/${tp}`))
      if (p < tp) btns.push(
        h('button', { onClick: () => emit('go', p+1), class: 'px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded' }, '›'),
        h('button', { onClick: () => emit('go', tp), class: 'px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded' }, '»'),
      )
      return h('div', { class: 'flex items-center justify-center gap-1 my-3' }, [
        h('span', { class: 'text-xs text-gray-500 mr-3' }, `共 ${props.totalPages} 页`),
        ...btns
      ])
    }
  }
}
export default { components: { Pagination } }
</script>
