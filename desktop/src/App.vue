<template>
  <div class="flex h-screen bg-gray-900 text-gray-100">
    <!-- Sidebar -->
    <div class="w-56 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div class="p-4 border-b border-gray-700">
        <h1 class="text-lg font-bold text-emerald-400">南天门</h1>
        <p class="text-xs text-gray-500">Nantianmen</p>
      </div>
      <nav class="flex-1 py-2">
        <router-link v-for="item in navItems" :key="item.path" :to="item.path"
          class="flex items-center px-4 py-2.5 text-sm transition-colors"
          :class="$route.path === item.path ? 'bg-emerald-500/10 text-emerald-400 border-r-2 border-emerald-500' : 'text-gray-400 hover:bg-gray-700/50'">
          <span class="mr-3">{{ item.icon }}</span>
          {{ item.label }}
        </router-link>
      </nav>
      <div class="p-3 border-t border-gray-700 text-xs text-gray-600">
        <p>Server: <span :class="serverOnline ? 'text-emerald-400' : 'text-red-400'">{{ serverOnline ? 'Online' : 'Offline' }}</span></p>
      </div>
    </div>
    <!-- Content -->
    <div class="flex-1 overflow-auto">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from './lib/api'

const serverOnline = ref(false)
const navItems = [
  { path: '/providers', label: 'Provider 管理', icon: '🔌' },
  { path: '/apikeys', label: '用户管理', icon: '🔑' },
  { path: '/stats', label: '统计', icon: '📊' },
  { path: '/docs', label: 'API 文档', icon: '📖' },
]

onMounted(async () => {
  try {
    await api.listProviders()
    serverOnline.value = true
  } catch {
    serverOnline.value = false
  }
})
</script>
