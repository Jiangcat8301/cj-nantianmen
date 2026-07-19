<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-xl font-bold">{{ t('users') }}</h2>
      <button @click="openCreate" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition">
        {{ t('generate_apikey') }}
      </button>
    </div>

    <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-750 border-b border-gray-700 text-gray-400">
          <tr>
            <th class="text-left px-4 py-3 whitespace-nowrap">{{ t('th_key') }}</th>
            <th class="text-left px-4 py-3 whitespace-nowrap">{{ t('th_name') }}</th>
            <th class="text-right px-4 py-3 whitespace-nowrap">{{ t('th_requests') }}</th>
            <th class="text-right px-4 py-3 whitespace-nowrap">{{ t('th_input') }}</th>
            <th class="text-right px-4 py-3 whitespace-nowrap">{{ t('th_output') }}</th>
            <th class="text-right px-4 py-3 whitespace-nowrap">{{ t('th_cached') }}</th>
            <th class="text-left px-4 py-3 whitespace-nowrap">{{ t('th_created') }}</th>
            <th class="text-left px-4 py-3 whitespace-nowrap">{{ t('th_last_used') }}</th>
            <th class="text-left px-4 py-3 whitespace-nowrap">{{ t('th_actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="k in keys" :key="k.id">
            <tr class="border-b border-gray-700/50">
              <td class="px-4 py-3 font-mono text-gray-400">
                <div class="flex items-center gap-2">
                  <span v-if="!k._revealed" class="whitespace-nowrap">{{ k.key.slice(0, 12) }}...{{ k.key.slice(-4) }}</span>
                  <span v-else class="break-all">{{ k.key }}</span>
                  <!-- ponytail: v0.2.14 — show/hide + copy buttons sit side-by-side here in the key column. -->
                  <button @click="toggleReveal(k.id)" class="text-xs px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 rounded inline-flex items-center justify-center" :title="k._revealed ? t('hide') : t('show')">
                    <span :class="['iconfont', k._revealed ? 'icon-hide' : 'icon-show']"></span>
                  </button>
                  <button @click="copyKey(k.key)" :title="t('copy')" class="text-xs px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 rounded inline-flex items-center justify-center">
                    <span class="iconfont icon-copy"></span>
                  </button>
                </div>
                <!-- ponytail: assigned model hint under key (icon-assign + name in accent color, small text) -->
                <div v-if="k.assigned_model" class="mt-1 text-[10px] text-emerald-400 whitespace-nowrap inline-flex items-center gap-1">
                  <span class="iconfont icon-assign"></span>
                  {{ k.assigned_model }}
                </div>
                <!-- ponytail: v0.2.14 — show authorization count badge -->
                <div v-if="k.authorized_models?.length" class="mt-1 text-[10px] text-gray-500 whitespace-nowrap inline-flex items-center gap-1">
                  <span class="iconfont icon-key"></span>
                  {{ k.authorized_models.length }} {{ t('auth_count_label') }}
                </div>
              </td>
              <td class="px-4 py-3 align-top">
                <div>{{ k.name }}</div>
                <!-- ponytail: note moves below name, smaller and dimmer -->
                <div v-if="k.note" class="text-[11px] text-gray-500 mt-0.5 whitespace-nowrap">{{ k.note }}</div>
              </td>
              <td class="px-4 py-3 text-right text-gray-300 whitespace-nowrap">{{ k._stats?.request_count ?? 0 }}</td>
              <td class="px-4 py-3 text-right text-gray-300 whitespace-nowrap">{{ fmt(k._stats?.input_tokens) }}</td>
              <td class="px-4 py-3 text-right text-gray-300 whitespace-nowrap">{{ fmt(k._stats?.output_tokens) }}</td>
              <td class="px-4 py-3 text-right text-cyan-400 whitespace-nowrap">{{ fmt(k._stats?.cached_tokens) }}</td>
              <td class="px-4 py-3 text-gray-500 whitespace-nowrap">{{ formatDate(k.created_at) }}</td>
              <td class="px-4 py-3 text-gray-500 whitespace-nowrap">{{ k.last_used_at ? formatDateTime(k.last_used_at) : t('not_used') }}</td>
              <td class="px-4 py-3">
                <div class="flex gap-2">
                  <button v-if="k._stats?.rows?.length" @click="toggleDetail(k.id)" :title="expandedId === k.id ? t('collapse') : t('details')" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded whitespace-nowrap inline-flex items-center gap-1">
                    <span class="iconfont icon-view"></span>
                  </button>
                  <button @click="openEdit(k)" :title="t('edit')" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded whitespace-nowrap inline-flex items-center gap-1">
                    <span class="iconfont icon-edit"></span>
                  </button>
                  <button @click="openAssign(k)" :title="t('assign_model')" class="text-xs px-2 py-1 bg-amber-900/40 hover:bg-amber-800/60 rounded whitespace-nowrap inline-flex items-center gap-1" :class="k.assigned_model ? 'ring-1 ring-emerald-500/40' : ''">
                    <span class="iconfont icon-assign"></span>
                  </button>
                  <button @click="deleteKey(k.id)" :title="t('delete')" class="text-xs px-2 py-1 bg-red-900 hover:bg-red-800 rounded whitespace-nowrap inline-flex items-center gap-1">
                    <span class="iconfont icon-delete"></span>
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="expandedId === k.id && k._stats?.rows?.length" class="bg-gray-900/50">
              <td colspan="10" class="px-8 py-3">
                <table class="w-full text-xs">
                  <thead class="text-gray-500">
                    <tr>
                      <th class="text-left py-1">{{ t('th_provider') }}</th>
                      <th class="text-left py-1">{{ t('th_model') }}</th>
                      <th class="text-right py-1">{{ t('th_requests') }}</th>
                      <th class="text-right py-1">{{ t('th_input') }}</th>
                      <th class="text-right py-1">{{ t('th_output') }}</th>
                      <th class="text-right py-1">{{ t('th_cached') }}</th>
                      <th class="text-right py-1">{{ t('stats_cost') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in k._stats.rows" :key="i" class="text-gray-400">
                      <td class="py-1">{{ r.provider ?? '-' }}</td>
                      <td class="py-1 font-mono">{{ r.model_name }}</td>
                      <td class="py-1 text-right">{{ r.request_count }}</td>
                      <td class="py-1 text-right">{{ fmt(r.input_tokens) }}</td>
                      <td class="py-1 text-right">{{ fmt(r.output_tokens) }}</td>
                      <td class="py-1 text-right text-cyan-400">{{ fmt(r.cached_tokens) }}</td>
                      <td class="py-1 text-right text-amber-400">{{ costRow(r) }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-if="keys.length === 0" class="text-center py-8 text-gray-500">{{ t('no_keys') }}</div>
    </div>

    <!-- Create / Edit Modal — both share the authorization multi-select. -->
    <div v-if="showCreate || showEdit" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="closeFormModal">
      <div class="bg-gray-800 rounded-lg p-6 w-[40.5rem] border border-gray-700 max-h-[85vh] flex flex-col">
        <h3 class="text-lg font-bold mb-4">{{ showEdit ? t('edit') : t('modal_generate_key') }}</h3>
        <div class="space-y-3">
          <input v-model="form.name" :placeholder="t('fld_key_name')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          <input v-model="form.note" :placeholder="t('fld_key_note')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />

          <!-- ponytail: v0.2.14 — 授权使用的模型 (multi-select, optional). Default model is implicitly available. -->
          <div class="border border-gray-700 rounded p-3 bg-gray-900">
            <div class="flex justify-between items-center mb-2">
              <div>
                <div class="text-sm font-medium">{{ t('authorized_models') }}</div>
                <div class="text-[11px] text-gray-500 mt-0.5">{{ t('authorized_models_hint') }}</div>
              </div>
              <div class="flex gap-1.5">
                <button type="button" @click="selectAllModels" class="text-[11px] px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_select_all') }}</button>
                <button type="button" @click="selectNoneModels" class="text-[11px] px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_select_none') }}</button>
              </div>
            </div>
            <div class="space-y-1 max-h-56 overflow-y-auto pr-1">
              <label v-for="m in availableModels" :key="m.id" class="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-700/50 text-sm">
                <input type="checkbox" :value="m.id" v-model="form.model_ids" class="accent-emerald-500" />
                <span class="font-mono text-xs">{{ m.provider_name }}_{{ m.model_name }}</span>
                <span v-if="m.is_default" class="text-[10px] text-emerald-400">★</span>
                <span v-if="m.deleted_at" class="text-[10px] text-red-400">{{ t('deleted_badge') }}</span>
                <span v-else-if="m.is_disabled" class="text-[10px] text-red-400">{{ t('disabled_badge') }}</span>
              </label>
              <div v-if="availableModels.length === 0" class="text-xs text-gray-500 px-2 py-1.5">—</div>
            </div>
            <div class="text-[10px] text-gray-500 mt-2">
              {{ form.model_ids.length }} {{ t('auth_selected_label') }}
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="closeFormModal" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_cancel') }}</button>
          <button @click="saveFormModal" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">{{ t('btn_confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- Assign Model Modal — single-select from authorized models only (v0.2.14). -->
    <div v-if="showAssign" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showAssign = false">
      <div class="bg-gray-800 rounded-lg p-6 w-[40.5rem] border border-gray-700 max-h-[80vh] flex flex-col">
        <h3 class="text-lg font-bold mb-2">{{ t('assign_model') }}: {{ assignForm.keyName }}</h3>
        <p class="text-xs text-gray-500 mb-3">{{ t('assign_model_v2_hint') }}</p>
        <div class="flex-1 overflow-y-auto space-y-1 mb-4 bg-gray-900 rounded p-2 max-h-96">
          <label v-for="m in assignCandidates" :key="m.id" class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-700/50 text-sm">
            <input type="radio" :value="m.full_id" v-model="assignForm.model" class="accent-emerald-500" />
            <span class="font-mono">{{ m.full_id }}</span>
            <span v-if="m.is_default" class="text-xs text-emerald-400">★</span>
          </label>
          <div v-if="assignCandidates.length === 0" class="text-xs text-gray-500 px-2 py-1.5">{{ t('assign_no_authorized') }}</div>
        </div>
        <div class="flex justify-between gap-2">
          <button v-if="assignForm.model" @click="assignForm.model = ''" class="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded">{{ t('assign_clear') }}</button>
          <div class="flex gap-2 ml-auto">
            <button @click="showAssign = false" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_cancel') }}</button>
            <button @click="saveAssign" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">{{ t('btn_confirm') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted, computed } from 'vue'
import api from '../lib/api'
import { formatToken } from '../lib/format.js'

const t = inject('t')
const keys = ref([])
const expandedId = ref(null)

// form modal (create / edit)
const showCreate = ref(false)
const showEdit = ref(false)
const form = ref({ id: null, name: '', note: '', oldName: '', model_ids: [] })
const availableModels = ref([])

// assign modal
const showAssign = ref(false)
const assignForm = ref({ id: null, keyName: '', model: '' })
// assignCandidates derived from the current row's authorized_models — pop only when modal opens.
const assignCandidates = ref([])

const fmt = formatToken

// ponytail: extract yyyy-mm-dd only. Backend stores localtime, so no TZ shift.
const formatDate = (s) => (s && typeof s === 'string') ? s.split(' ')[0].split('T')[0] : '-'
// ponytail: full datetime yyyy-mm-dd hh:mm:ss for last_used_at
const formatDateTime = (s) => {
  if (!s || typeof s !== 'string') return '-'
  const t = s.split('T')
  if (t.length === 2) return t[0] + ' ' + t[1].split('.')[0].substring(0, 8)  // ISO
  const parts = s.split(' ')
  if (parts.length >= 2) return parts[0] + ' ' + parts[1]  // "2026-01-15 14:30:00"
  return parts[0]  // "2026-01-15" only
}

const costRow = (r) => {
  const c = ((r.input_tokens||0)*(r.input_price||0) + (r.output_tokens||0)*(r.output_price||0) + (r.cached_tokens||0)*(r.cache_hit_price||0)) / 1_000_000
  return '¥' + c.toFixed(4)
}

const load = async () => {
  try {
    const [{ data: keyList }, { data: stats }] = await Promise.all([
      api.listApiKeys(), api.getStats()
    ])
    const byKey = {}
    const rows = Array.isArray(stats) ? stats : (stats?.breakdown || [])
    for (const r of rows) {
      const kid = r.api_key_id
      if (!byKey[kid]) byKey[kid] = { request_count: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, rows: [] }
      byKey[kid].request_count += r.request_count || 0
      byKey[kid].input_tokens += r.input_tokens || 0
      byKey[kid].output_tokens += r.output_tokens || 0
      byKey[kid].cached_tokens += r.cached_tokens || 0
      byKey[kid].rows.push(r)
    }
    keys.value = keyList.map(k => ({ ...k, _stats: byKey[k.id] || null, _revealed: false }))
  } catch (e) {
    console.error('load keys error:', e)
  }
}
onMounted(load)

const loadAvailableModels = async () => {
  if (availableModels.value.length > 0) return
  try {
    const { data } = await api.listAvailableModels()
    availableModels.value = data
  } catch (e) {
    console.error('load available models failed:', e)
  }
}

const toggleDetail = (id) => { expandedId.value = expandedId.value === id ? null : id }
const toggleReveal = (id) => {
  const k = keys.value.find(x => x.id === id)
  if (k) k._revealed = !k._revealed
}

const copyKey = (key) => {
  navigator.clipboard?.writeText(key)
}

const selectAllModels = () => { form.value.model_ids = availableModels.value.map(m => m.id) }
const selectNoneModels = () => { form.value.model_ids = [] }

const openCreate = async () => {
  form.value = { id: null, name: '', note: '', oldName: '', model_ids: [] }
  showCreate.value = true
  await loadAvailableModels()
}

const openEdit = async (k) => {
  form.value = {
    id: k.id,
    name: k.name,
    note: k.note || '',
    oldName: k.name,
    model_ids: (k.authorized_models || []).map(m => m.model_id),
  }
  showEdit.value = true
  await loadAvailableModels()
}

const closeFormModal = () => {
  showCreate.value = false
  showEdit.value = false
  form.value = { id: null, name: '', note: '', oldName: '', model_ids: [] }
}

const saveFormModal = async () => {
  try {
    const payload = {
      name: form.value.name,
      note: form.value.note,
      old_name: form.value.oldName || undefined,
      model_ids: form.value.model_ids,
    }
    if (showEdit.value && form.value.id != null) {
      await api.updateApiKey(form.value.id, payload)
    } else {
      await api.createApiKey(payload)
    }
    closeFormModal()
    await load()
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}

const deleteKey = async (id) => {
  if (!confirm(t('delete') + '?')) return
  await api.deleteApiKey(id); await load()
}

// ponytail: v0.2.14 — assign only picks from this key's authorized models.
const openAssign = (k) => {
  assignForm.value = { id: k.id, keyName: k.name, model: k.assigned_model || '' }
  assignCandidates.value = (k.authorized_models || []).map(m => ({
    id: m.model_id,
    full_id: `${m.provider_name}_${m.model_name}`,
    is_default: false,  // ponytail: could query is_default from /api-keys/available-models; not needed for assign UX
  }))
  showAssign.value = true
}

const saveAssign = async () => {
  try {
    // ponytail: convert 南天门对外 model id (ProviderName_modelname) back to model_id (FK).
    // assignCandidates has the id, so just look up.
    const selected = assignCandidates.value.find(c => c.full_id === assignForm.value.model)
    await api.updateApiKey(assignForm.value.id, {
      assigned_model_id: selected ? selected.id : null,
    })
    showAssign.value = false
    await load()
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}
</script>