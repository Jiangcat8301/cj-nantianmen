<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <div>
        <h2 class="text-xl font-bold">{{ t('models') }}</h2>
        <p class="text-xs text-gray-500 mt-1">默认模型: <code class="text-emerald-400">auto</code> 或 <code class="text-emerald-400">Nantianmen-default</code>
          <button @click="navigator.clipboard?.writeText('Nantianmen-default')" class="text-gray-600 hover:text-emerald-400 ml-1">📋</button>
        </p>
      </div>
      <button @click="showAdd = true" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition">
        {{ t('add_provider') }}
      </button>
    </div>

    <!-- Provider List -->
    <div class="space-y-3">
      <div v-for="p in providers" :key="p.id" class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="flex items-center justify-between p-4 cursor-pointer" @click="toggleExpand(p.id)">
          <div class="flex items-center gap-4">
            <span class="w-2.5 h-2.5 rounded-full" :class="p.health_status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'"></span>
            <div>
              <span class="font-medium">{{ p.name }}</span>
              <span class="ml-2 text-xs text-gray-500">{{ p.protocol }} · {{ p.base_url }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="p.default_model" class="text-xs text-emerald-400">{{ t('default_badge') }}: {{ p.default_model }}</span>
            <button @click.stop="checkHealth(p.id)" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded">{{ t('health') }}</button>
            <button @click.stop="refreshModels(p.id)" class="px-3 py-1 text-xs bg-blue-900 hover:bg-blue-800 rounded">{{ t('refresh_models') }}</button>
            <button @click.stop="editProvider(p)" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded">{{ t('edit') }}</button>
            <button @click.stop="deleteProvider(p.id)" class="px-3 py-1 text-xs bg-red-900 hover:bg-red-800 rounded">{{ t('delete') }}</button>
          </div>
        </div>
        <!-- Expanded Model List -->
        <div v-if="expandedId === p.id" class="border-t border-gray-700 p-4">
          <div class="flex justify-between mb-2">
            <span class="text-sm text-gray-400">{{ t('models') }}</span>
            <button @click="openAddModel(p.id)" class="text-xs text-emerald-400 hover:underline">{{ t('add_model') }}</button>
          </div>
          <div class="space-y-1">
            <div v-for="m in (p.models || [])" :key="m.id" class="flex items-center justify-between py-1.5 px-3 bg-gray-750 rounded text-sm">
              <div class="flex items-center gap-2">
                <span>{{ m.model_name }}</span>
                <span v-if="m.deleted" class="text-xs text-red-400">{{ t('deleted_badge') }}</span>
                <button @click="copyModelId(p.name, p.protocol, m.model_name)" class="text-gray-600 hover:text-emerald-400 text-xs" :title="t('copy')">📋</button>
                <button @click="openEditModel(p.id, m)" class="text-gray-600 hover:text-amber-400 text-xs" :title="t('edit_model')">💰</button>
                <span v-if="m.input_price || m.output_price || m.cache_hit_price" class="text-[10px] text-gray-500">📥¥{{ m.input_price||0 }} 📤¥{{ m.output_price||0 }} 💾¥{{ m.cache_hit_price||0 }}</span>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="m.is_default" class="text-xs text-emerald-400">{{ t('default_badge') }}</span>
                <button v-else @click="setDefault(p.id, m.id)" class="text-xs text-gray-500 hover:text-emerald-400">{{ t('set_default') }}</button>
                <span class="text-xs text-gray-600" v-if="m.is_manual">{{ t('manual') }}</span>
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

// ponytail: prompt() doesn't work in Electron contextIsolation. Use modal instead.
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

// ponytail: after setDefault, load() first, then re-fetch models so the list stays visible
const setDefault = async (providerId, modelId) => {
  try {
    await api.setDefaultModel(providerId, modelId)
    await load()
    await fetchModels(providerId)
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

const copyModelId = (providerName, protocol, modelName) => {
  navigator.clipboard?.writeText(`${providerName}_${protocol}_${modelName}`)
}
</script>
