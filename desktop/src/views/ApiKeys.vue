<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-xl font-bold">{{ t('users') }}</h2>
      <button @click="showCreate = true" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition">
        {{ t('generate_apikey') }}
      </button>
    </div>

    <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-750 border-b border-gray-700 text-gray-400">
          <tr>
            <th class="text-left px-4 py-3">{{ t('th_key') }}</th>
            <th class="text-left px-4 py-3">{{ t('th_name') }}</th>
            <th class="text-left px-4 py-3">{{ t('th_note') }}</th>
            <th class="text-right px-4 py-3">{{ t('th_requests') }}</th>
            <th class="text-right px-4 py-3">{{ t('th_input') }}</th>
            <th class="text-right px-4 py-3">{{ t('th_output') }}</th>
            <th class="text-right px-4 py-3">{{ t('th_cached') }}</th>
            <th class="text-left px-4 py-3">{{ t('th_created') }}</th>
            <th class="text-left px-4 py-3">{{ t('th_last_used') }}</th>
            <th class="text-left px-4 py-3">{{ t('th_actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="k in keys" :key="k.id">
            <tr class="border-b border-gray-700/50">
              <td class="px-4 py-3 font-mono text-gray-400">
                <div class="flex items-center gap-2">
                  <span v-if="!k._revealed">{{ k.key.slice(0, 12) }}...{{ k.key.slice(-4) }}</span>
                  <span v-else class="break-all">{{ k.key }}</span>
                  <button @click="toggleReveal(k.id)" class="text-xs px-1.5 py-0.5 bg-gray-700 hover:bg-gray-600 rounded">{{ k._revealed ? '🙈' : '👁' }}</button>
                </div>
              </td>
              <td class="px-4 py-3">{{ k.name }}</td>
              <td class="px-4 py-3 text-gray-500">{{ k.note || '-' }}</td>
              <td class="px-4 py-3 text-right text-gray-300">{{ k._stats?.request_count ?? 0 }}</td>
              <td class="px-4 py-3 text-right text-gray-300">{{ fmt(k._stats?.input_tokens) }}</td>
              <td class="px-4 py-3 text-right text-gray-300">{{ fmt(k._stats?.output_tokens) }}</td>
              <td class="px-4 py-3 text-right text-cyan-400">{{ fmt(k._stats?.cached_tokens) }}</td>
              <td class="px-4 py-3 text-gray-500">{{ k.created_at }}</td>
              <td class="px-4 py-3 text-gray-500">{{ k.last_used_at || t('not_used') }}</td>
              <td class="px-4 py-3">
                <div class="flex gap-2">
                  <button v-if="k._stats?.rows?.length" @click="toggleDetail(k.id)" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">{{ expandedId === k.id ? t('collapse') : t('details') }}</button>
                  <button @click="openEdit(k)" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">{{ t('edit') }}</button>
                  <button @click="copyKey(k.key)" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">{{ t('copy') }}</button>
                  <button @click="deleteKey(k.id)" class="text-xs px-2 py-1 bg-red-900 hover:bg-red-800 rounded">{{ t('delete') }}</button>
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

    <!-- Create Modal -->
    <div v-if="showCreate" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showCreate = false">
      <div class="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700">
        <h3 class="text-lg font-bold mb-4">{{ t('modal_generate_key') }}</h3>
        <div class="space-y-3">
          <input v-model="createForm.name" :placeholder="t('fld_key_name')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          <input v-model="createForm.note" :placeholder="t('fld_key_note')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="showCreate = false" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_cancel') }}</button>
          <button @click="createKey" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">{{ t('btn_generate') }}</button>
        </div>
      </div>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEdit" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showEdit = false">
      <div class="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700">
        <h3 class="text-lg font-bold mb-4">{{ t('edit') }}: {{ editForm.name }}</h3>
        <div class="space-y-3">
          <input v-model="editForm.name" :placeholder="t('fld_key_name')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          <input v-model="editForm.note" :placeholder="t('fld_key_note')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="showEdit = false" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_cancel') }}</button>
          <button @click="saveEdit" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">{{ t('btn_confirm') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from 'vue'
import api from '../lib/api'

const t = inject('t')
const keys = ref([])
const showCreate = ref(false)
const createForm = ref({ name: '', note: '' })
const showEdit = ref(false)
const editForm = ref({ id: null, name: '', note: '', oldName: '' })
const expandedId = ref(null)

const fmt = (n) => {
  if (!n) return '0'
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
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

const toggleDetail = (id) => { expandedId.value = expandedId.value === id ? null : id }
const toggleReveal = (id) => {
  const k = keys.value.find(x => x.id === id)
  if (k) k._revealed = !k._revealed
}

const createKey = async () => {
  try {
    await api.createApiKey(createForm.value)
    showCreate.value = false
    createForm.value = { name: '', note: '' }
    await load()
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}

const openEdit = (k) => {
  editForm.value = { id: k.id, name: k.name, note: k.note || '', oldName: k.name }
  showEdit.value = true
}

const saveEdit = async () => {
  try {
    await api.updateApiKey(editForm.value.id, { name: editForm.value.name, note: editForm.value.note, old_name: editForm.value.oldName })
    showEdit.value = false
    await load()
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}

const deleteKey = async (id) => {
  if (!confirm(t('delete') + '?')) return
  await api.deleteApiKey(id); await load()
}

const copyKey = (key) => {
  navigator.clipboard?.writeText(key)
}
</script>
