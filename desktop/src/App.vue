<template>
  <div class="flex flex-col h-screen bg-gray-900 text-gray-100">
    <!-- Custom Titlebar (30px) -->
    <div class="titlebar flex items-center justify-between select-none" style="height:30px;-webkit-app-region:drag">
      <div class="flex items-center gap-2 px-3">
        <img src="/nantianmen-logo.png" class="w-4 h-4" @error="$event.target.style.display='none'" />
        <span class="text-xs font-semibold text-emerald-400">南天门</span>
      </div>
      <div class="flex items-center" style="-webkit-app-region:no-drag">
        <!-- Server status indicator -->
        <div class="flex items-center gap-1.5 px-3 text-xs">
          <span class="w-2 h-2 rounded-full" :class="serverOnline ? 'bg-emerald-500' : 'bg-red-500'"></span>
          <span :class="serverOnline ? 'text-emerald-400' : 'text-red-400'">{{ serverOnline ? t('online') : t('offline') }}</span>
          <span class="text-gray-600">v0.2.7</span>
        </div>
        <!-- Window controls -->
        <button @click="win?.minimize" class="titlebar-btn" :title="t('minimize')">
          <svg width="10" height="10" viewBox="0 0 12 12"><rect y="5.5" width="12" height="1" fill="currentColor"/></svg>
        </button>
        <button @click="toggleMax" class="titlebar-btn" :title="t('maximize')">
          <svg v-if="!isMax" width="10" height="10" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" stroke="currentColor" fill="none" stroke-width="1"/></svg>
          <svg v-else width="10" height="10" viewBox="0 0 12 12">
            <rect x="1" y="3" width="8" height="8" stroke="currentColor" fill="none" stroke-width="1"/>
            <path d="M3 3 V1 H11 V9 H9" stroke="currentColor" fill="none" stroke-width="1"/>
          </svg>
        </button>
        <button @click="win?.close" class="titlebar-btn titlebar-close" :title="t('close')">
          <svg width="10" height="10" viewBox="0 0 12 12"><path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Sidebar -->
      <div class="w-56 bg-gray-800 border-r border-gray-700 flex flex-col">
        <nav class="flex-1 py-2">
          <router-link v-for="item in navItems" :key="item.path" :to="item.path"
            class="flex items-center px-4 py-2.5 text-sm transition-colors"
            :class="$route.path === item.path ? 'bg-emerald-500/10 text-emerald-400 border-r-2 border-emerald-500' : 'text-gray-400 hover:bg-gray-700/50'">
            <span class="mr-3">{{ item.icon }}</span>
            {{ t(item.labelKey) }}
          </router-link>
        </nav>
        <!-- Language switcher -->
        <div class="p-3 border-t border-gray-700">
          <select v-model="lang" @change="changeLang" class="w-full px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300">
            <option value="zh">🇨🇳 中文</option>
            <option value="en">🇺🇸 English</option>
            <option value="ja">🇯🇵 日本語</option>
          </select>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto">
        <router-view />
      </div>
    </div>
    <Modal ref="modalRef" />
  </div>
</template>

<script setup>
import { ref, provide, onMounted, onUnmounted } from 'vue'
import api from './lib/api'
import Modal from './components/Modal.vue'

const serverOnline = ref(false)
const isMax = ref(false)
const modalRef = ref(null)
const lang = ref(localStorage.getItem('ntm-lang') || 'zh')
const win = typeof window !== 'undefined' ? window.win : null

// ponytail: expose modal globally via provide
provide('modal', modalRef)

// ponytail: i18n - three languages (zh/en/ja), inline dict, no lib.
// ponytail: nav labels do NOT include emoji here - emoji is in navItems[].icon to avoid double icon.
const i18n = {
  zh: {
    dashboard: '系统概览', models: '模型管理', users: '用户管理', stats: '数据统计', docs: 'API 文档', logs: '日志管理', settings: '系统设置',
    server: 'Server', online: '在线', offline: '离线',
    minimize: '最小化', maximize: '最大化', restore: '还原', close: '关闭',
    add_provider: '新增大模型供应商', health: '健康检查', edit: '编辑', delete: '删除', set_default: '设为默认', default_badge: '★ 默认', manual: '手动',
    fld_name: '名称', fld_name_hint: '⚠ 不能包含空格或下划线', fld_protocol: '协议', fld_base_url: 'API Base URL', fld_api_key: 'API Key',
    btn_cancel: '取消', btn_confirm: '确认', refresh_models: '刷新模型列表', add_model: '添加模型',
    fld_model_hint: '输入上游供应商支持的模型名称，如 gpt-4o-mini', no_providers: '暂无供应商，点击右上角添加',
    settings_title: '系统设置', set_listen_port: '监听端口', set_port_hint: '范围 1024-65535，默认 38271',
    set_autostart: '开机自动启动', set_autostart_desc: '系统启动时自动运行南天门', set_autostart_on: '已开启', set_autostart_off: '已关闭', set_save: '保存设置',
    tray_menu_preview: '系统托盘右键菜单预览', tray_show: '显示窗口', tray_hide: '隐藏窗口', tray_quit: '退出',
    server_status: '服务状态', server_start: '启动', server_stop: '停止', server_restart: '重启',
    provider_count: '供应商数量', apikey_count: 'API Key 数量', today_requests: '今日请求', today_tokens: '今日总Token', today_cost: '今日总花费', recent_activity: '最近活动',
    server_endpoints: '服务端点', copy: '复制',
    // ApiKeys
    generate_apikey: '生成 API Key', modal_generate_key: '生成新 API Key',
    fld_key_name: 'Key 名称', fld_key_note: '备注 (可选)', btn_generate: '生成',
    th_key: 'API Key', th_name: '名称', th_note: '备注', th_requests: '请求数',
    th_input: '输入 Token', th_output: '输出 Token', th_cached: '缓存 Token',
    th_created: '创建时间', th_last_used: '最后使用', th_actions: '操作',
    th_provider: '供应商', th_model: '模型',
    not_used: '未使用', details: '详情', collapse: '收起', no_keys: '暂无 API Key',
    refresh: '刷新', default_provider_model: '默认模型',
    stats_title: '统计', stats_all_providers: '全部 Provider', stats_all_models: '全部模型',
    stats_today: '今天', stats_7d: '最近7天', stats_30d: '最近30天', stats_all: '全部',
    stats_total_requests: '总请求数', stats_input_tokens: '输入 Token', stats_output_tokens: '输出 Token', stats_cached_tokens: '已缓存', stats_total_cost: '总消费',
    stats_table_provider: '供应商', stats_table_model: '模型', stats_table_requests: '请求数', stats_table_input: '输入 Token', stats_table_output: '输出 Token', stats_table_cached: '已缓存', stats_cost: '消费',
 stats_no_data: '暂无数据', stats_top_models: 'Top 5 模型请求量', stats_top_users: 'Top 5 请求用户',
 edit_model: '编辑定价', fld_input_price: '输入价格', fld_output_price: '输出价格', fld_cache_price: '缓存命中价格',
 per_million: '/百万Token', deleted_badge: '已删除',
 log_title: '通信日志', log_toggle: '启用日志', log_clear: '清空日志', log_clear_confirm: '确认清空所有通信日志?',
 log_time: '时间', log_user: '用户', log_provider: '供应商', log_model: '模型',
 log_tokens_in: '输入Token', log_tokens_out: '输出Token', log_tokens_cached: '缓存命中', log_status: '状态', log_count: '记录数',
 log_rotation: '滚动记录', log_rotation_off: '未启用', log_rotation_hint: '保留最新', log_rotation_unit: '条',
 stats_all_users: '全部用户', db_volume: '数据库体积',
 },
  en: {
    dashboard: 'System Overview', models: 'Models', users: 'API Keys', stats: 'Statistics', docs: 'API Docs', logs: 'Comm Log', settings: 'Settings',
    server: 'Server', online: 'Online', offline: 'Offline',
    minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close',
    add_provider: 'Add Provider', health: 'Health Check', edit: 'Edit', delete: 'Delete', set_default: 'Set Default', default_badge: '★ Default', manual: 'Manual',
    fld_name: 'Name', fld_name_hint: '⚠ No spaces or underscores allowed', fld_protocol: 'Protocol', fld_base_url: 'API Base URL', fld_api_key: 'API Key',
    btn_cancel: 'Cancel', btn_confirm: 'Confirm', refresh_models: 'Refresh Models', add_model: 'Add Model',
    fld_model_hint: 'Enter a model name supported by the upstream provider, e.g. gpt-4o-mini', no_providers: 'No providers yet. Click + to add one.',
    settings_title: 'Settings', set_listen_port: 'Listen Port', set_port_hint: 'Range 1024-65535, default 38271',
    set_autostart: 'Auto Start', set_autostart_desc: 'Launch Nantianmen on system startup', set_autostart_on: 'Enabled', set_autostart_off: 'Disabled', set_save: 'Save',
    tray_menu_preview: 'Tray Context Menu Preview', tray_show: 'Show Window', tray_hide: 'Hide Window', tray_quit: 'Quit',
    server_status: 'Server Status', server_start: 'Start', server_stop: 'Stop', server_restart: 'Restart',
    provider_count: 'Providers', apikey_count: 'API Keys', today_requests: 'Requests Today', today_tokens: 'Tokens Today', today_cost: 'Cost Today', recent_activity: 'Recent Activity',
    server_endpoints: 'Server Endpoints', copy: 'Copy',
    // ApiKeys
    generate_apikey: 'Generate API Key', modal_generate_key: 'Generate New API Key',
    fld_key_name: 'Key Name', fld_key_note: 'Note (optional)', btn_generate: 'Generate',
    th_key: 'API Key', th_name: 'Name', th_note: 'Note', th_requests: 'Requests',
    th_input: 'Input Tokens', th_output: 'Output Tokens', th_cached: 'Cached Tokens',
    th_created: 'Created', th_last_used: 'Last Used', th_actions: 'Actions',
    th_provider: 'Provider', th_model: 'Model',
    not_used: 'Never used', details: 'Details', collapse: 'Collapse', no_keys: 'No API keys',
    refresh: 'Refresh', default_provider_model: 'Default Model',
    stats_title: 'Statistics', stats_all_providers: 'All Providers', stats_all_models: 'All Models',
    stats_today: 'Today', stats_7d: 'Last 7 Days', stats_30d: 'Last 30 Days', stats_all: 'All',
    stats_total_requests: 'Total Requests', stats_input_tokens: 'Input Tokens', stats_output_tokens: 'Output Tokens', stats_cached_tokens: 'Cached', stats_total_cost: 'Total Cost',
    stats_table_provider: 'Provider', stats_table_model: 'Model', stats_table_requests: 'Requests', stats_table_input: 'Input Tokens', stats_table_output: 'Output Tokens', stats_table_cached: 'Cached', stats_cost: 'Cost',
 stats_no_data: 'No data', stats_top_models: 'Top 5 Models by Requests', stats_top_users: 'Top 5 Users',
 edit_model: 'Edit Pricing', fld_input_price: 'Input Price', fld_output_price: 'Output Price', fld_cache_price: 'Cache Hit Price',
 per_million: '/M tokens', deleted_badge: 'Deleted',
 log_title: 'Communication Log', log_toggle: 'Enable Logging', log_clear: 'Clear Log', log_clear_confirm: 'Clear all communication logs?',
 log_time: 'Time', log_user: 'User', log_provider: 'Provider', log_model: 'Model',
 log_tokens_in: 'Input Tokens', log_tokens_out: 'Output Tokens', log_tokens_cached: 'Cached', log_status: 'Status', log_count: 'Records',
 log_rotation: 'Rotation', log_rotation_off: 'Disabled', log_rotation_hint: 'Keep latest', log_rotation_unit: 'entries',
 stats_all_users: 'All Users', db_volume: 'DB Volume',
  },
  ja: {
    dashboard: 'システム概要', models: 'モデル管理', users: 'ユーザー管理', stats: '統計', docs: 'APIドキュメント', logs: '通信ログ', settings: '設定',
    server: 'Server', online: 'オンライン', offline: 'オフライン',
    minimize: '最小化', maximize: '最大化', restore: '元に戻す', close: '閉じる',
    add_provider: 'プロバイダー追加', health: 'ヘルスチェック', edit: '編集', delete: '削除', set_default: 'デフォルト設定', default_badge: '★ デフォルト', manual: '手動',
    fld_name: '名称', fld_name_hint: '⚠ スペース・アンダースコア不可', fld_protocol: 'プロトコル', fld_base_url: 'API Base URL', fld_api_key: 'API Key',
    btn_cancel: 'キャンセル', btn_confirm: '確認', refresh_models: 'モデル更新', add_model: 'モデル追加',
    fld_model_hint: '上流プロバイダーがサポートするモデル名を入力（例: gpt-4o-mini）', no_providers: 'プロバイダーがありません。右上の+をクリックして追加。',
    settings_title: '設定', set_listen_port: 'リッスンポート', set_port_hint: '範囲 1024-65535、デフォルト 38271',
    set_autostart: '自動起動', set_autostart_desc: 'システム起動時に南天門を自動実行', set_autostart_on: 'オン', set_autostart_off: 'オフ', set_save: '保存',
    tray_menu_preview: 'トレイ右クリックメニュー', tray_show: 'ウィンドウ表示', tray_hide: 'ウィンドウ非表示', tray_quit: '終了',
    server_status: 'サーバー状態', server_start: '起動', server_stop: '停止', server_restart: '再起動',
    provider_count: 'プロバイダー数', apikey_count: 'API Key 数', today_requests: '本日リクエスト', today_tokens: '本日Token', today_cost: '本日コスト', recent_activity: '最近のアクティビティ',
    server_endpoints: 'サーバーエンドポイント', copy: 'コピー',
    // ApiKeys
    generate_apikey: 'API Key 生成', modal_generate_key: '新規 API Key 生成',
    fld_key_name: 'Key 名', fld_key_note: '備考 (任意)', btn_generate: '生成',
    th_key: 'API Key', th_name: '名前', th_note: '備考', th_requests: 'リクエスト数',
    th_input: '入力 Token', th_output: '出力 Token', th_cached: 'キャッシュ Token',
    th_created: '作成日時', th_last_used: '最終使用', th_actions: '操作',
    th_provider: 'プロバイダー', th_model: 'モデル',
    not_used: '未使用', details: '詳細', collapse: '折りたたむ', no_keys: 'API Key なし',
    refresh: '更新', default_provider_model: 'デフォルトモデル',
    stats_title: '統計', stats_all_providers: '全プロバイダー', stats_all_models: '全モデル',
    stats_today: '今日', stats_7d: '過去7日', stats_30d: '過去30日', stats_all: '全て',
    stats_total_requests: '総リクエスト数', stats_input_tokens: '入力 Token', stats_output_tokens: '出力 Token', stats_cached_tokens: 'キャッシュ', stats_total_cost: '総コスト',
    stats_table_provider: 'プロバイダー', stats_table_model: 'モデル', stats_table_requests: 'リクエスト数', stats_table_input: '入力 Token', stats_table_output: '出力 Token', stats_table_cached: 'キャッシュ', stats_cost: 'コスト',
 stats_no_data: 'データなし', stats_top_models: 'Top 5 リクエスト数', stats_top_users: 'Top 5 ユーザー',
 edit_model: '価格編集', fld_input_price: '入力価格', fld_output_price: '出力価格', fld_cache_price: 'キャッシュ価格',
 per_million: '/百万Token', deleted_badge: '削除済',
 log_title: '通信ログ', log_toggle: 'ログ有効化', log_clear: 'ログ消去', log_clear_confirm: 'すべての通信ログを消去しますか?',
 log_time: '時刻', log_user: 'ユーザー', log_provider: 'プロバイダー', log_model: 'モデル',
 log_tokens_in: '入力Token', log_tokens_out: '出力Token', log_tokens_cached: 'キャッシュ', log_status: '状態', log_count: '件数',
 log_rotation: 'ローテーション', log_rotation_off: '無効', log_rotation_hint: '最新', log_rotation_unit: '件',
 stats_all_users: '全ユーザー', db_volume: 'DB容量',
  },
}
const t = (key) => i18n[lang.value]?.[key] || key
provide('t', t)
provide('lang', lang)

const navItems = [
  { path: '/dashboard', labelKey: 'dashboard', icon: '📊' },
  { path: '/providers', labelKey: 'models', icon: '🤖' },
  { path: '/apikeys', labelKey: 'users', icon: '🔑' },
  { path: '/stats', labelKey: 'stats', icon: '📈' },
  { path: '/docs', labelKey: 'docs', icon: '📚' },
  { path: '/logs', labelKey: 'logs', icon: '📝' },
  { path: '/settings', labelKey: 'settings', icon: '⚙️' },
]

const toggleMax = async () => {
  win?.toggleMaximize()
  isMax.value = await win?.isMaximized()
}

const changeLang = () => {
  localStorage.setItem('ntm-lang', lang.value)
  win?.setTrayLang(lang.value)
  location.reload()
}

// ponytail: poll server health every 3s for titlebar status indicator
let healthPoll = null
const checkHealth = async () => {
  try {
    const r = await fetch('http://127.0.0.1:38271/v1/health')
    serverOnline.value = r.ok
  } catch {
    serverOnline.value = false
  }
}

onMounted(async () => {
  await checkHealth()
  healthPoll = setInterval(checkHealth, 3000)
  win?.setTrayLang(lang.value)
  if (win) {
    isMax.value = await win.isMaximized()
    const maxPoll = setInterval(async () => { isMax.value = await win.isMaximized() }, 500)
    onUnmounted(() => { clearInterval(maxPoll); clearInterval(healthPoll) })
  }
})
</script>

<style scoped>
.titlebar {
  background: #1a1f2e;
  border-bottom: 1px solid #374151;
}
.titlebar-btn {
  width: 36px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  transition: background 0.15s;
  border: none;
  background: transparent;
  cursor: pointer;
}
.titlebar-btn:hover {
  background: #374151;
  color: #e5e7eb;
}
.titlebar-close:hover {
  background: #e81123;
  color: white;
}
</style>
