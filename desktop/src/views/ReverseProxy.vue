<template>
  <div class="p-6 max-w-3xl">
    <h2 class="text-xl font-bold mb-3">{{ t('reverse_proxy') }}</h2>

    <!-- Intro + GitHub link -->
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6">
      <p class="text-sm text-gray-300 leading-relaxed">{{ t('frpc_intro') }}</p>
      <a href="https://github.com/fatedier/frp" target="_blank" rel="noreferrer"
        class="inline-flex items-center gap-1.5 mt-3 text-sm text-emerald-400 hover:text-emerald-300">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        {{ t('frpc_github') }}
      </a>
    </div>

    <!-- Download section (only when binary missing) -->
    <div v-if="!status.hasBinary" class="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6">
      <p class="text-sm text-gray-300 mb-3">
        {{ t('frpc_download_btn') }} <span class="text-gray-500">· v0.71.0 · 13.9 MB</span>
      </p>
      <div class="flex items-center gap-3">
        <button v-if="!downloading" @click="download"
          class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium">
          {{ t('frpc_download_btn') }}
        </button>
        <button v-else @click="cancel"
          class="px-5 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium">
          {{ t('frpc_btn_cancel') }}
        </button>
        <span v-if="downloading" class="text-xs text-gray-400">
          {{ t('frpc_downloading') }} <span class="text-emerald-400 font-mono">{{ progress }}%</span>
          <span class="text-gray-600">·</span>
          <span class="text-gray-500">{{ t('frpc_keep_alive_hint') }}</span>
        </span>
      </div>
      <div v-if="downloading" class="mt-3 h-1.5 bg-gray-700 rounded overflow-hidden">
        <div class="h-full bg-emerald-500 transition-all" :style="{ width: progress + '%' }"></div>
      </div>
      <p v-if="downloadError" class="mt-3 text-xs text-red-400">{{ downloadError }}</p>
    </div>

    <!-- Config form (shown when binary present) -->
    <div v-else class="bg-gray-800 rounded-lg border border-gray-700 p-5 mb-6 space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label class="block">
          <span class="block text-xs text-gray-500 mb-1">{{ t('frpc_field_server_addr') }}</span>
          <input v-model="conf.server_addr" type="text" placeholder="frp.example.com"
            class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm font-mono text-emerald-400 focus:border-emerald-500 focus:outline-none" />
        </label>
        <label class="block">
          <span class="block text-xs text-gray-500 mb-1">{{ t('frpc_field_server_port') }}</span>
          <input v-model.number="conf.server_port" type="number" min="1" max="65535"
            class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm font-mono text-emerald-400 focus:border-emerald-500 focus:outline-none" />
        </label>
        <label class="block md:col-span-2">
          <span class="block text-xs text-gray-500 mb-1">{{ t('frpc_field_token') }}</span>
          <input v-model="conf.token" type="password" placeholder="••••••"
            class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm font-mono text-emerald-400 focus:border-emerald-500 focus:outline-none" />
        </label>
        <label class="block">
          <span class="block text-xs text-gray-500 mb-1">{{ t('frpc_field_subdomain') }}</span>
          <input v-model="conf.subdomain" type="text" placeholder="jiangcat"
            class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm font-mono text-emerald-400 focus:border-emerald-500 focus:outline-none" />
        </label>
        <label class="block">
          <span class="block text-xs text-gray-500 mb-1">{{ t('frpc_field_local_port') }}</span>
          <input v-model.number="conf.local_port" type="number" min="1" max="65535"
            class="w-full px-3 py-2 bg-gray-900 rounded border border-gray-700 text-sm font-mono text-emerald-400 focus:border-emerald-500 focus:outline-none" />
        </label>
      </div>

      <!-- Auto-start toggle -->
      <div class="flex items-center justify-between pt-3 border-t border-gray-700">
        <label class="text-sm text-gray-300">{{ t('frpc_auto_start') }}</label>
        <button @click="conf.auto_start = !conf.auto_start" type="button"
          class="relative w-12 h-6 rounded-full transition-colors duration-200"
          :class="conf.auto_start ? 'bg-emerald-600' : 'bg-gray-600'">
          <span class="absolute left-0.5 top-0.5 w-5 h-5 rounded-full transition-transform duration-200"
            :class="conf.auto_start ? 'bg-white translate-x-6' : 'bg-gray-300'" />
        </button>
      </div>

      <!-- Action row -->
      <div class="flex items-center gap-3 pt-3 border-t border-gray-700 flex-wrap">
        <button @click="save" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium">
          {{ t('frpc_btn_save') }}
        </button>
        <button v-if="conf.enabled"
          @click="disable"
          class="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium border border-gray-600">
          {{ t('frpc_btn_disable') }}
        </button>
        <button v-else
          @click="enable"
          class="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 rounded-lg text-sm font-medium">
          {{ t('frpc_btn_enable') }}
        </button>
        <button v-if="conf.enabled && !status.running" @click="start"
          class="px-5 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium">
          {{ t('frpc_btn_start') }}
        </button>
        <button v-if="conf.enabled && status.running" @click="stop"
          class="px-5 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium">
          {{ t('frpc_btn_stop') }}
        </button>
        <span class="ml-auto text-xs flex items-center gap-2">
          <span class="w-2 h-2 rounded-full"
            :class="!conf.enabled ? 'bg-gray-500' : status.running ? 'bg-emerald-500' : 'bg-amber-500'"></span>
          <span :class="!conf.enabled ? 'text-gray-500' : status.running ? 'text-emerald-400' : 'text-amber-400'">
            {{ !conf.enabled ? t('frpc_status_disabled')
                : status.running ? `${t('frpc_status_running')} · pid ${status.pid}`
                : t('frpc_status_stopped') }}
          </span>
        </span>
      </div>

      <p v-if="actionError" class="text-xs text-red-400">{{ actionError }}</p>
      <p class="text-xs text-gray-600 break-all">{{ t('frpc_binary_path') }}: {{ status.binary }}</p>

      <!-- FRPC log pane (ring-buffered tail, newest at bottom) -->
      <div class="pt-3 border-t border-gray-700">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs text-gray-500">{{ t('frpc_log_title') }}</span>
          <span class="text-[10px] text-gray-600">{{ logLines.length }}/100</span>
        </div>
        <div ref="logEl"
          class="h-40 overflow-y-auto bg-black/40 rounded border border-gray-700 p-2 font-mono text-[11px] leading-relaxed">
          <div v-if="!logLines.length" class="text-gray-600">{{ t('frpc_log_empty') }}</div>
          <div v-for="(l, i) in logLines" :key="i"
            class="whitespace-pre-wrap break-all" :class="logLevelClass(l)">{{ l }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted, onUnmounted } from 'vue'

const t = inject('t')

// ponytail: reactive proxy for the FRPC config — we mirror what the main process
// has on disk so the UI reflects restart-only updates immediately.
const conf = ref({
  enabled: true, auto_start: false,
  server_addr: '', server_port: 7000, token: '',
  remote_port: 0, local_port: 38271, subdomain: '',
})
const status = ref({ running: false, pid: null, hasBinary: false, binary: '' })
const downloading = ref(false)
const progress = ref(0)
const downloadError = ref('')
const actionError = ref('')
const logLines = ref([])
const logEl = ref(null)
let logTimer = null

function logLevelClass(line) {
  if (/\[E\]|\[ERRO\]|error|failed|invalid|unknown/i.test(line)) return 'text-red-400'
  if (/\[W\]|warn/i.test(line)) return 'text-amber-400'
  if (/\[I\]|\[INFO\]|success|login/i.test(line)) return 'text-emerald-400'
  return 'text-gray-300'
}
async function refreshLog() {
  if (!window.win?.frpc) return
  try {
    const lines = await window.win.frpc.getLog()
    if (Array.isArray(lines)) {
      logLines.value = lines
      requestAnimationFrame(() => {
        if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
      })
    }
  } catch {}
}

const onProgress = (_e, p) => { progress.value = p.pct }
// ponytail: v0.5.0 — listen for download-state broadcasts from main. This is what
// makes the UI survive a route switch: the renderer instance on this view gets
// destroyed and rebuilt; on remount we both query the current state AND re-subscribe
// (Vue-router keeps `<router-view>` cached with default settings, but explicit
// never-hurt-anybody).
const onDownloadState = (_e, s) => {
  if (!s) return
  if (s.active) {
    downloading.value = true
    downloadError.value = ''
  } else if (s.cancelled) {
    downloading.value = false
    progress.value = 0
    downloadError.value = ''
  } else if (s.ok === false) {
    downloading.value = false
    downloadError.value = s.error || 'download failed'
  } else if (s.ok === true) {
    downloading.value = false
    progress.value = 0
    downloadError.value = ''
  }
}
const onStatus = (_e, s) => { if (s && 'running' in s) status.value = { ...status.value, ...s } }

async function refresh() {
  if (!window.win?.frpc) return
  status.value = await window.win.frpc.status()
  const c = await window.win.frpc.getConf()
  if (c) conf.value = {
    enabled: c.enabled !== false,  // default true for legacy configs without the field
    server_addr: c.server_addr || '',
    server_port: c.server_port || 7000,
    token: c.token || '',
    remote_port: c.remote_port || 0, subdomain: c.subdomain || '',
    local_port: c.local_port || 38271,
    auto_start: !!c.auto_start,
  }
}

async function download() {
  downloadError.value = ''
  // Don't optimistically flip `downloading` — main is the source of truth
  // and will broadcast `frpc:download:state` when it actually starts.
  try {
    await window.win.frpc.download()
    await refresh()
  } catch (e) {
    downloadError.value = String(e.message || e)
    downloading.value = false
  }
}

async function cancel() {
  try { await window.win.frpc.cancelDownload() } catch {}
  // State broadcast will set downloading=false; optimistic flip for snappy UI.
  downloading.value = false
  progress.value = 0
}

async function save() {
  actionError.value = ''
  await window.win.frpc.setConf({
    enabled: conf.value.enabled,
    server_addr: conf.value.server_addr,
    server_port: Number(conf.value.server_port) || 0,
    token: conf.value.token,
    remote_port: Number(conf.value.remote_port) || 0, subdomain: conf.value.subdomain || '',
    local_port: Number(conf.value.local_port) || 0,
    auto_start: !!conf.value.auto_start,
  })
}

async function enable() {
  actionError.value = ''
  conf.value.enabled = true
  await window.win.frpc.setConf({ enabled: true })
}

async function disable() {
  actionError.value = ''
  // ponytail: 停用 = 关进程 + 落 enabled=false. 配置(server_addr/token/...)不动.
  try { await window.win.frpc.stop() } catch {}
  conf.value.enabled = false
  await window.win.frpc.setConf({ enabled: false })
  await refresh()
}

async function start() {
  actionError.value = ''
  try {
    // ponytail: v0.5.0 — startFrpc() now returns typed errors instead of
    // throwing strings. We translate `reason` into actionable user copy;
    // the main process also fires `frpc:open-settings` IPC so we navigate
    // the user here even if they clicked Start from the tray.
    const r = await window.win.frpc.start()
    if (r && r.ok === false) {
      actionError.value = r.reason === 'config-incomplete'
        ? t('frpc_err_config_incomplete')
        : (r.message || JSON.stringify(r))
    }
    await refresh()
  } catch (e) { actionError.value = String(e.message || e) }
}

async function stop() {
  actionError.value = ''
  try {
    await window.win.frpc.stop()
    await refresh()
  } catch (e) { actionError.value = String(e.message || e) }
}

onMounted(async () => {
  if (window.win?.frpc) {
    window.win.frpc.onProgress(onProgress)
    window.win.frpc.onStatus(onStatus)
    window.win.frpc.onDownloadState(onDownloadState)
    // ponytail: v0.5.0 — when the user navigates away and back, the component
    // is destroyed/recreated. Without this rehydrate, the UI shows no download
    // even though main is still streaming bytes. Pull the current state once.
    const cur = await window.win.frpc.downloadState()
    if (cur) onDownloadState(null, cur)
  }
  await refresh()
  await refreshLog()
  logTimer = setInterval(refreshLog, 2000)
})
onUnmounted(() => {
  // ponytail: ipcRenderer listeners persist for the renderer lifetime; we deliberately
  // don't remove them — Vue's <router-view> keeps the component cached for back-nav,
  // and re-binding would leak the old callback.
  if (logTimer) clearInterval(logTimer)
  logTimer = null
})
</script>