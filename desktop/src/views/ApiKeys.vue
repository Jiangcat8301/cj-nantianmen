<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-xl font-bold">用户管理</h2>
      <button @click="showCreate = true" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium">
        + 生成 API Key
      </button>
    </div>

    <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-750 border-b border-gray-700 text-gray-400">
          <tr>
            <th class="text-left px-4 py-3">API Key</th>
            <th class="text-left px-4 py-3">名称</th>
            <th class="text-left px-4 py-3">备注</th>
            <th class="text-left px-4 py-3">创建时间</th>
            <th class="text-left px-4 py-3">最后使用</th>
            <th class="text-left px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k.id" class="border-b border-gray-700/50">
            <td class="px-4 py-3 font-mono text-gray-400">{{ k.key.slice(0, 12) }}...{{ k.key.slice(-4) }}</td>
            <td class="px-4 py-3">{{ k.name }}</td>
            <td class="px-4 py-3 text-gray-500">{{ k.note || '-' }}</td>
            <td class="px-4 py-3 text-gray-500">{{ k.created_at }}</td>
            <td class="px-4 py-3 text-gray-500">{{ k.last_used_at || '未使用' }}</td>
            <td class="px-4 py-3">
              <div class="flex gap-2">
                <button @click="copyKey(k.key)" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">复制</button>
                <button @click="deleteKey(k.id)" class="text-xs px-2 py-1 bg-red-900 hover:bg-red-800 rounded">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="keys.length === 0" class="text-center py-8 text-gray-500">暂无 API Key</div>
    </div>

    <!-- Create Modal -->
    <div v-if="showCreate" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="showCreate = false">
      <div class="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700">
        <h3 class="text-lg font-bold mb-4">生成新 API Key</h3>
        <div class="space-y-3">
          <input v-model="createForm.name" placeholder="名称（如：Hermes Agent）" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
          <input v-model="createForm.note" placeholder="备注（可选）" class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm" />
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="showCreate = false" class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded">取消</button>
          <button @click="createKey" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">生成</button>
        </div>
      </div>
    </div>

    <!-- New Key Display -->
    <div v-if="newKey" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700">
        <h3 class="text-lg font-bold mb-2 text-emerald-400">API Key 已生成</h3>
        <p class="text-sm text-red-400 mb-3">⚠ 此 Key 仅显示一次，请立即复制保存</p>
        <div class="bg-gray-900 rounded p-3 font-mono text-sm text-emerald-400 break-all">{{ newKey }}</div>
        <div class="flex justify-end mt-4">
          <button @click="copyKey(newKey); newKey = null" class="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 rounded">已复制，关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../lib/api'

const keys = ref([])
const showCreate = ref(false)
const newKey = ref(null)
const createForm = ref({ name: '', note: '' })

const load = async () => {
  try { const { data } = await api.listApiKeys(); keys.value = data } catch {}
}
onMounted(load)

const createKey = async () => {
  try {
    const { data } = await api.createApiKey(createForm.value)
    newKey.value = data.key
    showCreate.value = false
    createForm.value = { name: '', note: '' }
    await load()
  } catch {}
}

const deleteKey = async (id) => {
  if (!confirm('确认删除此 Key？')) return
  await api.deleteApiKey(id); await load()
}

const copyKey = (key) => {
  navigator.clipboard?.writeText(key)
}
</script>
