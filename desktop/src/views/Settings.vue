<template>
  <div class="p-6 max-w-3xl">
    <h2 class="text-xl font-bold mb-6">{{ t('settings_title') }}</h2>

    <!-- 监听端口 -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6">
      <label class="block text-sm font-semibold text-gray-300 mb-3">{{ t('set_listen_port') }}</label>
      <div class="flex items-center gap-3">
        <input v-model="port" type="number" min="1024" max="65535"
          class="w-32 px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm font-mono text-emerald-400 focus:border-emerald-500 focus:outline-none" />
        <span class="text-xs text-gray-500">{{ t('set_port_hint') }}</span>
      </div>
      <p class="text-xs text-gray-600 mt-2">127.0.0.1:{{ port }}</p>
    </div>

    <!-- 开机自动启动 -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6">
      <div class="flex items-center justify-between">
        <div>
          <label class="block text-sm font-semibold text-gray-300">{{ t('set_autostart') }}</label>
          <p class="text-xs text-gray-500 mt-1">{{ t('set_autostart_desc') }}</p>
        </div>
        <button @click="toggleAutostart"
          class="relative w-12 h-6 rounded-full transition-colors duration-200"
          :class="autostart ? 'bg-emerald-600' : 'bg-gray-600'">
          <span class="absolute left-0.5 top-0.5 w-5 h-5 rounded-full transition-transform duration-200"
            :class="autostart ? 'bg-white translate-x-6' : 'bg-gray-300'" />
        </button>
      </div>
      <p class="text-xs mt-3">
        <span :class="autostart ? 'text-emerald-400' : 'text-gray-500'">{{ autostart ? t('set_autostart_on') : t('set_autostart_off') }}</span>
      </p>
    </div>

    <button @click="save" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium">{{ t('set_save') }}</button>

    <hr class="border-gray-700 my-8" />

    <!-- Database Info -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6">
      <h3 class="text-sm font-semibold text-gray-400 mb-3">Database</h3>
      <div class="space-y-3 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Type</span>
          <span class="text-gray-300 font-mono">{{ dbInfo.type || 'sqlite3' }}</span>
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Path (相对路径 = 可执行文件所在目录)</label>
          <div class="flex gap-2">
            <input v-model="dbPathInput" type="text" placeholder="./nantianmen.db"
              class="flex-1 px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm font-mono text-emerald-400 focus:border-emerald-500 focus:outline-none" />
            <button @click="saveDbPath" :disabled="dbSaving"
              class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 rounded text-sm font-medium whitespace-nowrap">
              {{ dbSaving ? '保存中...' : '保存' }}
            </button>
          </div>
          <p class="text-xs text-gray-600 mt-1 break-all">当前: {{ dbInfo.path || './nantianmen.db' }}</p>
        </div>
      </div>
    </div>

    <hr class="border-gray-700 my-8" />
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from 'vue'
import api from '../lib/api'

const t = inject('t')
const modalRef = inject('modal')
const win = typeof window !== 'undefined' ? window.win : null
const port = ref(38271)
const autostart = ref(false)
const dbInfo = ref({})
const dbPathInput = ref('')
const dbSaving = ref(false)

const toggleAutostart = async () => {
  const next = !autostart.value
  if (win && win.autostartSet) {
    try {
      await win.autostartSet(next)
      autostart.value = next
    } catch {}
  } else {
    autostart.value = next
  }
}

const save = async () => {
  if (autostart.value) {
    if (win && win.autostartSet) win.autostartSet(true).catch(() => {})
  }
  if (modalRef?.value) await modalRef.value.show({ mode: 'alert', title: t('settings_title'), message: t('set_save') + ' ✓' })
}

const saveDbPath = async () => {
  const newPath = dbPathInput.value.trim()
  if (!newPath) {
    if (modalRef?.value) await modalRef.value.show({ mode: 'alert', title: 'Error', message: '路径不能为空' })
    return
  }
  const oldPath = dbInfo.value.path || ''
  if (newPath === oldPath || (newPath === './nantianmen.db' && !oldPath)) {
    if (modalRef?.value) await modalRef.value.show({ mode: 'alert', title: 'Info', message: '路径未变化' })
    return
  }
  if (modalRef?.value) {
    const ok = await modalRef.value.show({ mode: 'confirm', title: 'Database', message: `将数据库挪到: ${newPath}`, okText: '继续', cancelText: '取消' })
    if (!ok) return
  }
  dbSaving.value = true
  try {
    const { data } = await api.moveDatabase(newPath)
    if (data.changed) {
      if (modalRef?.value) await modalRef.value.show({ mode: 'alert', title: '✓', message: `已挪到 ${data.path}\n\n请重启服务以加载新数据库` })
      dbInfo.value = { ...dbInfo.value, path: data.path }
      dbPathInput.value = ''
    } else {
      if (modalRef?.value) await modalRef.value.show({ mode: 'alert', title: 'Info', message: '路径未变化' })
      dbPathInput.value = ''
    }
  } catch (e) {
    if (modalRef?.value) await modalRef.value.show({ mode: 'alert', title: 'Error', message: '保存失败: ' + (e.response?.data?.error || e.message) })
  } finally {
    dbSaving.value = false
  }
}

onMounted(async () => {
  try {
    const { data } = await api.getServerStatus()
    if (data) {
      port.value = data.port || 38271
      dbInfo.value = data.database || { type: 'sqlite3', path: './nantianmen.db' }
    }
  } catch {}
  // ponytail: read current auto-start state from Electron
  if (win && win.autostartGet) {
    try { autostart.value = await win.autostartGet() } catch {}
  }
})
</script>
