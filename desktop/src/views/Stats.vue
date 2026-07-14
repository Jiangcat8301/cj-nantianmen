<template>
  <div class="p-6">
    <h2 class="text-xl font-bold mb-6">统计</h2>

    <!-- Filter -->
    <div class="flex gap-3 mb-6">
      <select v-model="filters.provider" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">全部 Provider</option>
      </select>
      <select v-model="filters.model" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="">全部模型</option>
      </select>
      <select v-model="filters.range" class="px-3 py-2 bg-gray-800 rounded border border-gray-700 text-sm">
        <option value="today">今天</option>
        <option value="7d">最近7天</option>
        <option value="30d">最近30天</option>
        <option value="all">全部</option>
      </select>
    </div>

    <!-- Stat Cards -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">总请求数</p>
        <p class="text-2xl font-bold text-emerald-400">{{ stats.total_requests || 0 }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">输入 Token</p>
        <p class="text-2xl font-bold">{{ formatNum(stats.total_input_tokens) }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">输出 Token</p>
        <p class="text-2xl font-bold">{{ formatNum(stats.total_output_tokens) }}</p>
      </div>
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <p class="text-xs text-gray-500 mb-1">Cached Token</p>
        <p class="text-2xl font-bold text-blue-400">{{ formatNum(stats.total_cached_tokens) }}</p>
      </div>
    </div>

    <!-- Breakdown Table -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-750 border-b border-gray-700 text-gray-400">
          <tr>
            <th class="text-left px-4 py-3">Provider</th>
            <th class="text-left px-4 py-3">模型</th>
            <th class="text-right px-4 py-3">请求数</th>
            <th class="text-right px-4 py-3">输入 Token</th>
            <th class="text-right px-4 py-3">输出 Token</th>
            <th class="text-right px-4 py-3">Cached</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in (stats.breakdown || [])" :key="i" class="border-b border-gray-700/50">
            <td class="px-4 py-3">{{ row.provider }}</td>
            <td class="px-4 py-3 font-mono text-gray-400">{{ row.model }}</td>
            <td class="px-4 py-3 text-right">{{ row.request_count }}</td>
            <td class="px-4 py-3 text-right">{{ formatNum(row.input_tokens) }}</td>
            <td class="px-4 py-3 text-right">{{ formatNum(row.output_tokens) }}</td>
            <td class="px-4 py-3 text-right text-blue-400">{{ formatNum(row.cached_tokens) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="!stats.breakdown || stats.breakdown.length === 0" class="text-center py-8 text-gray-500">暂无数据</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import api from '../lib/api'

const filters = ref({ provider: '', model: '', range: '7d' })
const stats = ref({})

const load = async () => {
  try { const { data } = await api.getStats(filters.value); stats.value = data } catch {}
}
onMounted(load)
watch(filters, load, { deep: true })

const formatNum = (n) => {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}
</script>
