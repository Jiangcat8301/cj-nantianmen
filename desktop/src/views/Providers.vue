<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <div>
        <h2 class="text-xl font-bold">{{ t('models') }}</h2>
      </div>
      <button @click="showAdd = true" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition">
        {{ t('add_provider') }}
      </button>
    </div>

    <!-- ponytail: default-model info card — clarifies Nantianmen-default routing with click-to-copy. -->
    <div class="mb-6 bg-gray-800 rounded-lg border border-gray-700 px-4 py-3 flex items-center gap-3">
      <span class="text-xs text-gray-400 whitespace-nowrap">默认模型：</span>
      <code class="text-emerald-400 text-sm font-mono">Nantianmen-default</code>
      <button @click="copyDefaultModel" class="text-gray-600 hover:text-emerald-400 transition" :title="t('copy')">
        <!-- heroicons: clipboard-document (v0.2.10 inline SVG to avoid font-awesome dep) -->
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
        </svg>
      </button>
      <span class="text-xs text-gray-500 ml-2">选择该模型将自动路由到系统当前设置的默认模型中。</span>
    </div>

    <!-- Provider List -->
    <div class="space-y-3">
      <div v-for="p in providers" :key="p.id" class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="flex items-center justify-between p-4 cursor-pointer" @click="toggleExpand(p.id)">
          <div class="flex items-center gap-4">
            <span class="w-2.5 h-2.5 rounded-full" :class="p.health_status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'"></span>
            <div>
              <span class="font-medium">{{ p.name }}</span>
              <span class="ml-2 px-1.5 py-0.5 text-xs rounded font-mono"
                :class="p.protocol === 'openai' ? 'bg-blue-500/20 text-blue-300' : 'bg-orange-500/20 text-orange-300'">{{ p.protocol }}</span>
              <span class="ml-2 text-xs text-gray-500">{{ p.base_url }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="p.default_model" class="text-xs text-emerald-400">{{ t('default_badge') }}: {{ p.default_model }}</span>
            <button @click.stop="checkHealth(p.id)" :title="t('health')" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded whitespace-nowrap inline-flex items-center gap-1">
              <span class="iconfont icon-health"></span>
            </button>
            <button @click.stop="refreshModels(p.id)" :title="t('refresh_models')" class="px-3 py-1 text-xs bg-blue-900 hover:bg-blue-800 rounded whitespace-nowrap inline-flex items-center gap-1">
              <span class="iconfont icon-refresh"></span>
            </button>
            <button @click.stop="editProvider(p)" :title="t('edit')" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded whitespace-nowrap inline-flex items-center gap-1">
              <span class="iconfont icon-edit"></span>
            </button>
            <button @click.stop="deleteProvider(p.id)" :title="t('delete')" class="px-3 py-1 text-xs bg-red-900 hover:bg-red-800 rounded whitespace-nowrap inline-flex items-center gap-1">
              <span class="iconfont icon-delete"></span>
            </button>
          </div>
        </div>
        <!-- Expanded Model List -->
        <div v-if="expandedId === p.id" class="border-t border-gray-700 p-4">
          <div class="flex justify-between mb-2">
            <span class="text-sm text-gray-400">{{ t('models') }}</span>
            <div class="flex items-center gap-3">
              <!-- ponytail: bulk enable/disable toggle — single switch reflects aggregate state.
                   If all enabled → switch off + label '全部启用'; if any disabled → switch on + label '全部禁用'. -->
              <span class="text-xs" :class="allEnabled(p) ? 'text-gray-500' : 'text-emerald-400'">
                {{ allEnabled(p) ? t('bulk_enable_all') : t('bulk_disable_all') }}
              </span>
              <button @click.stop="toggleAll(p)" :title="allEnabled(p) ? t('bulk_enable_all') : t('bulk_disable_all')"
                class="relative inline-flex h-4 w-7 items-center rounded-full transition"
                :class="allEnabled(p) ? 'bg-gray-600' : 'bg-emerald-500/60'">
                <span class="inline-block h-3 w-3 transform rounded-full bg-white transition"
                  :class="allEnabled(p) ? 'translate-x-0.5' : 'translate-x-3.5'"></span>
              </button>
              <button @click="openAddModel(p.id)" class="text-xs text-emerald-400 hover:underline">{{ t('add_model') }}</button>
            </div>
          </div>
          <div class="space-y-1">
            <div v-for="m in (p.models || [])" :key="m.id" class="flex items-center justify-between py-1.5 px-3 bg-gray-750 rounded text-sm">
              <div class="flex items-center gap-2">
                <span>{{ m.model_name }}</span>
                <span v-if="m.deleted" class="text-xs text-red-400">{{ t('deleted_badge') }}</span>
                <span v-else-if="m.is_disabled" class="text-xs text-red-400">{{ t('disabled_badge') }}</span>
                <button @click="copyModelId(p.name, m.model_name)" class="text-gray-600 hover:text-emerald-400 text-xs inline-flex items-center" :title="t('copy')"><span class="iconfont icon-copy"></span></button>
                <button @click="openEditModel(p.id, m)" class="text-gray-600 hover:text-amber-400 text-xs inline-flex items-center" :title="t('edit_model')"><span class="iconfont icon-edit"></span></button>
                <span v-if="m.input_price || m.output_price || m.cache_hit_price" class="text-xs text-gray-400 whitespace-nowrap">📥¥{{ m.input_price||0 }} 📤¥{{ m.output_price||0 }} 💾¥{{ m.cache_hit_price||0 }}</span>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="m.is_default" class="text-xs text-emerald-400">{{ t('default_badge') }}</span>
                <button v-else :disabled="m.is_disabled" @click="setDefault(p.id, m.id)"
                  class="text-xs hover:text-emerald-400 disabled:text-gray-700 disabled:cursor-not-allowed"
                  :class="m.is_disabled ? 'text-gray-700' : 'text-gray-500'">{{ t('set_default') }}</button>
                <span class="text-xs text-gray-600" v-if="m.is_manual">{{ t('manual') }}</span>
                <!-- ponytail: per-model disable toggle. disabled models stay visible (badge) so user can re-enable. -->
                <button @click="toggleModel(p.id, m)" :title="m.is_disabled ? t('enable_model') : t('disable_model')"
                  class="relative inline-flex h-4 w-7 items-center rounded-full transition"
                  :class="m.is_disabled ? 'bg-red-500/40' : 'bg-emerald-500/40'">
                  <span class="inline-block h-3 w-3 transform rounded-full bg-white transition"
                    :class="m.is_disabled ? 'translate-x-3.5' : 'translate-x-0.5'"></span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="providers.length === 0" class="text-center py-8 text-gray-500">
        {{ t('no_providers') }}
      </div>
    </div>

    <!-- Add/Edit Provider Modal -->
    <div v-if="showAdd || editing" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="closeModal">
      <div class="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700">
        <h3 class="text-lg font-bold mb-4">{{ editing ? t('edit') : t('add_provider') }}</h3>
        <div class="space-y-3">
          <input v-model="form.name" :placeholder="t('fld_name')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          <p class="text-xs text-gray-600">{{ t('fld_name_hint') }}</p>
          <select v-model="form.protocol" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input v-model="form.base_url" :placeholder="t('fld_base_url')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          <input v-model="form.api_key" :placeholder="t('fld_api_key')" type="password" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="closeModal" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_cancel') }}</button>
          <button @click="saveProvider" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">{{ t('btn_confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- Add Model Modal -->
    <div v-if="showAddModel" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showAddModel = false">
      <div class="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700">
        <h3 class="text-lg font-bold mb-4">{{ t('add_model') }}</h3>
        <div class="space-y-3">
          <input v-model="modelForm.model_name" :placeholder="t('fld_model_hint')" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" @keyup.enter="confirmAddModel" />
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="showAddModel = false" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_cancel') }}</button>
          <button @click="confirmAddModel" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">{{ t('btn_confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- Edit Model Pricing Modal -->
    <div v-if="showEditModel" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showEditModel = false">
      <div class="bg-gray-800 rounded-lg p-6 w-80 border border-gray-700">
        <h3 class="text-lg font-bold mb-4">{{ t('edit_model') }}: {{ editModelForm.model_name }}</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-gray-400">{{ t('fld_input_price') }} ({{ t('per_million') }})</label>
            <input v-model.number="editModelForm.input_price" type="number" step="0.0001" min="0" class="w-full mt-1 px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          </div>
          <div>
            <label class="text-xs text-gray-400">{{ t('fld_output_price') }} ({{ t('per_million') }})</label>
            <input v-model.number="editModelForm.output_price" type="number" step="0.0001" min="0" class="w-full mt-1 px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          </div>
          <div>
            <label class="text-xs text-gray-400">{{ t('fld_cache_price') }} ({{ t('per_million') }})</label>
            <input v-model.number="editModelForm.cache_hit_price" type="number" step="0.0001" min="0" class="w-full mt-1 px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="showEditModel = false" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">{{ t('btn_cancel') }}</button>
          <button @click="saveEditModel" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">{{ t('btn_confirm') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from 'vue'
import api from '../lib/api'

const t = inject('t')
const providers = ref([])
const expandedId = ref(null)
const showAdd = ref(false)
const editing = ref(null)
const form = ref({ name: '', protocol: 'openai', base_url: '', api_key: '' })
const showAddModel = ref(false)
const modelForm = ref({ providerId: null, model_name: '' })
const showEditModel = ref(false)
const editModelForm = ref({ providerId: null, modelId: null, model_name: '', input_price: 0, output_price: 0, cache_hit_price: 0 })

const load = async () => {
  try { const { data } = await api.listProviders(); providers.value = data } catch {}
}
onMounted(load)

const toggleExpand = async (id) => {
  expandedId.value = expandedId.value === id ? null : id
  if (expandedId.value === id) await fetchModels(id)
}

const fetchModels = async (id) => {
  try {
    const { data } = await api.getModels(id)
    const p = providers.value.find(x => x.id === id)
    if (p) p.models = data
  } catch {}
}

const refreshModels = async (id) => {
  try {
    const { data } = await api.refreshModels(id)
    const p = providers.value.find(x => x.id === id)
    if (p) p.models = data.models
    alert(`${t('refresh_models')}: ${data.models?.length ?? 0} models`)
  } catch (e) {
    alert(t('refresh_models') + ': ' + (e.response?.data?.error || e.message))
  }
}

const openAddModel = (providerId) => {
  modelForm.value = { providerId, model_name: '' }
  showAddModel.value = true
}

const confirmAddModel = async () => {
  const name = modelForm.value.model_name.trim()
  if (!name) return
  try {
    await api.addModel(modelForm.value.providerId, name)
    showAddModel.value = false
    await fetchModels(modelForm.value.providerId)
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}

const checkHealth = async (id) => {
  try {
    const { data } = await api.checkHealth(id)
    alert(`${t('health')}: ${data.healthy ? '✅ OK' : '❌ Failed'}${data.status_code ? ' (' + data.status_code + ')' : ''}`)
    await load()
  } catch (e) {
    alert(t('health') + ': ' + (e.response?.data?.error || e.message))
  }
}

const setDefault = async (providerId, modelId) => {
  try {
    await api.setDefaultModel(providerId, modelId)
    await load()
    await fetchModels(providerId)
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}

// ponytail: toggle is_disabled on the model row. Server rebuilds modelMap so /v1/models + dispatch update.
// Only fetchModels needed — toggle doesn't change provider list or default model, just the model row.
const toggleModel = async (providerId, m) => {
  try {
    await api.toggleModel(providerId, m.id)
    await fetchModels(providerId)
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}

// ponytail: bulk enable/disable. If any disabled → bulk-disable all; if all enabled → bulk-enable (no-op for already-enabled).
// Uses Promise.all on existing toggleModel — no new server endpoint.
const allEnabled = (p) => (p.models || []).every(m => !m.is_disabled)
const toggleAll = async (p) => {
  const targets = (p.models || []).filter(m => allEnabled(p) ? m.is_disabled : !m.is_disabled)
  if (!targets.length) return
  try {
    await Promise.all(targets.map(m => api.toggleModel(p.id, m.id)))
    await fetchModels(p.id)
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}

const editProvider = (p) => {
  editing.value = p.id
  form.value = { name: p.name, protocol: p.protocol, base_url: p.base_url, api_key: '' }
}

const saveProvider = async () => {
  if (form.value.name.includes(' ') || form.value.name.includes('_')) {
    alert(t('fld_name_hint'))
    return
  }
  try {
    if (editing.value) {
      await api.updateProvider(editing.value, form.value)
    } else {
      await api.createProvider(form.value)
    }
    closeModal(); await load()
  } catch (e) {
    alert('Save failed: ' + (e.response?.data?.error || e.message))
  }
}

const deleteProvider = async (id) => {
  if (!confirm('确认删除？')) return
  await api.deleteProvider(id); await load()
}

const closeModal = () => { showAdd.value = false; editing.value = null; form.value = { name: '', protocol: 'openai', base_url: '', api_key: '' } }

const openEditModel = (providerId, m) => {
  editModelForm.value = { providerId, modelId: m.id, model_name: m.model_name, input_price: m.input_price || 0, output_price: m.output_price || 0, cache_hit_price: m.cache_hit_price || 0 }
  showEditModel.value = true
}

const saveEditModel = async () => {
  try {
    await api.updateModel(editModelForm.value.providerId, editModelForm.value.modelId, {
      input_price: editModelForm.value.input_price,
      output_price: editModelForm.value.output_price,
      cache_hit_price: editModelForm.value.cache_hit_price,
    })
    showEditModel.value = false
    await fetchModels(editModelForm.value.providerId)
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message))
  }
}

const copyModelId = (providerName, modelName) => {
  navigator.clipboard?.writeText(`${providerName}_${modelName}`)
}

// ponytail: copy Nantianmen-default to clipboard (the virtual default-model id).
const copyDefaultModel = () => {
  navigator.clipboard?.writeText('Nantianmen-default')
}
</script>
