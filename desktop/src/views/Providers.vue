<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-xl font-bold">Provider 管理</h2>
      <button @click="showAdd = true" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition">
        + 新增 Provider
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
            <span v-if="p.default_model" class="text-xs text-emerald-400">默认: {{ p.default_model }}</span>
            <button @click.stop="checkHealth(p.id)" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded">Health</button>
            <button @click.stop="editProvider(p)" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded">编辑</button>
            <button @click.stop="deleteProvider(p.id)" class="px-3 py-1 text-xs bg-red-900 hover:bg-red-800 rounded">删除</button>
          </div>
        </div>
        <!-- Expanded Model List -->
        <div v-if="expandedId === p.id" class="border-t border-gray-700 p-4">
          <div class="flex justify-between mb-2">
            <span class="text-sm text-gray-400">模型列表</span>
            <button @click="fetchModels(p.id)" class="text-xs text-emerald-400">刷新</button>
          </div>
          <div class="space-y-1">
            <div v-for="m in (p.models || [])" :key="m.id" class="flex items-center justify-between py-1.5 px-3 bg-gray-750 rounded text-sm">
              <span>{{ m.model_name }}</span>
              <div class="flex items-center gap-2">
                <span v-if="m.is_default" class="text-xs text-emerald-400">★ 默认</span>
                <button v-else @click="setDefault(p.id, m.id)" class="text-xs text-gray-500 hover:text-emerald-400">设为默认</button>
                <span class="text-xs text-gray-600" v-if="m.is_manual">手动</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="providers.length === 0" class="text-center py-8 text-gray-500">
        暂无 Provider，点击右上角添加
      </div>
    </div>

    <!-- Add/Edit Modal -->
    <div v-if="showAdd || editing" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="closeModal">
      <div class="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700">
        <h3 class="text-lg font-bold mb-4">{{ editing ? '编辑 Provider' : '新增 Provider' }}</h3>
        <div class="space-y-3">
          <input v-model="form.name" placeholder="名称" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          <select v-model="form.protocol" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input v-model="form.base_url" placeholder="Endpoint URL" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          <input v-model="form.api_key" placeholder="API Key" type="password" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="closeModal" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">取消</button>
          <button @click="saveProvider" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../lib/api'

const providers = ref([])
const expandedId = ref(null)
const showAdd = ref(false)
const editing = ref(null)
const form = ref({ name: '', protocol: 'openai', base_url: '', api_key: '' })

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

const checkHealth = async (id) => {
  try { const { data } = await api.checkHealth(id); await load() } catch {}
}

const setDefault = async (providerId, modelId) => {
  try { await api.setDefaultModel(providerId, modelId); await load() } catch {}
}

const editProvider = (p) => {
  editing.value = p.id
  form.value = { name: p.name, protocol: p.protocol, base_url: p.base_url, api_key: '' }
}

const saveProvider = async () => {
  if (editing.value) {
    await api.updateProvider(editing.value, form.value)
  } else {
    await api.createProvider(form.value)
  }
  closeModal(); await load()
}

const deleteProvider = async (id) => {
  if (!confirm('确认删除？')) return
  await api.deleteProvider(id); await load()
}

const closeModal = () => { showAdd.value = false; editing.value = null; form.value = { name: '', protocol: 'openai', base_url: '', api_key: '' } }
</script>
