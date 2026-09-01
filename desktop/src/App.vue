<template>
  <div class="flex flex-col h-screen bg-gray-900 text-gray-100">
    <!-- Custom Titlebar (40px) -->
    <div class="titlebar flex items-center justify-between select-none" style="height:40px;-webkit-app-region:drag">
      <div class="flex items-center gap-2 px-3">
        <img src="/nantianmen-logo-pixel-rc-32.png" class="w-[20px] h-[20px]" @error="$event.target.style.display='none'" />
        <span class="text-sm font-semibold text-emerald-400">南天门</span>
      </div>
      <div class="flex items-center h-full" style="-webkit-app-region:no-drag">
        <!-- FRPC status indicator -->
        <div class="flex items-center gap-1.5 px-3 text-xs h-full border-r border-gray-700/50" :title="t('frpc_titlebar_hint')">
          <span class="w-1.5 h-1.5 rounded-full" :class="frpcDotClass"></span>
          <span class="text-gray-400">FRPC</span>
          <span :class="frpcTextClass">{{ frpcLabel }}</span>
        </div>
        <!-- Server status indicator -->
        <div class="flex items-center gap-1.5 px-3 text-xs h-full border-r border-gray-700/50">
          <span class="w-1.5 h-1.5 rounded-full" :class="serverMismatch ? 'bg-amber-500' : serverOnline ? 'bg-emerald-500' : 'bg-red-500'"></span>
          <span class="text-gray-400">Server</span>
          <span :class="serverMismatch ? 'text-amber-400' : serverOnline ? 'text-emerald-400' : 'text-red-400'">
            {{ serverMismatch ? t('version_mismatch_short') : serverOnline ? t('online') : t('offline') }}
          </span>
        </div>
        <!-- Version -->
        <div class="flex items-center gap-1 px-3 text-xs h-full">
          <span class="text-gray-400">{{ t('version_label') }}</span>
          <span class="font-mono text-gray-500">v{{ clientVersion }}</span>
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
            class="flex items-center px-4 py-2.5 text-sm transition-colors whitespace-nowrap"
            :class="$route.path === item.path ? 'bg-emerald-500/10 text-emerald-400 border-r-2 border-emerald-500' : 'text-gray-400 hover:bg-gray-700/50'">
            <span :class="['iconfont', 'mr-3', 'text-base', item.icon]"></span>
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
        <div v-if="serverMismatch" class="h-full flex items-center justify-center p-8">
          <div class="max-w-xl w-full bg-gray-800 border border-amber-700 rounded-lg p-6 text-center">
            <h2 class="text-lg font-bold text-amber-400 mb-3">{{ t('version_mismatch_title') }}</h2>
            <p class="text-sm text-gray-300 mb-5">{{ t('version_mismatch_desc') }}</p>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div class="bg-gray-900 rounded p-3"><div class="text-gray-500">Desktop</div><div class="font-mono text-emerald-400">v{{ serverMismatch.clientVersion }}</div></div>
              <div class="bg-gray-900 rounded p-3"><div class="text-gray-500">Server</div><div class="font-mono text-red-400">v{{ serverMismatch.serverVersion || 'unknown' }}</div></div>
            </div>
          </div>
        </div>
        <router-view v-else-if="serverStatusReady" />
      </div>
    </div>
    <Modal ref="modalRef" />
  </div>
</template>

<script setup>
import { ref, computed, provide, onMounted, onUnmounted } from 'vue'
import api from './lib/api'
import Modal from './components/Modal.vue'
import desktopPackage from '../package.json'

const clientVersion = desktopPackage.version
const serverOnline = ref(false)
const serverMismatch = ref(null)
const serverStatusReady = ref(false)
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
    dashboard: '系统概览', models: '模型管理', users: '用户管理', stats: '数据统计', docs: 'API 文档', logs: '日志管理', settings: '系统设置', reverse_proxy: '反向代理', online: '在线', offline: '离线', version_mismatch_short: '版本不匹配', version_mismatch_title: 'Server 与 Desktop 版本不匹配', version_mismatch_desc: '已拒绝连接。请停止当前 Server，然后启动与 Desktop 相同版本的 Server。',
    // ponytail: v0.5.0 — FRPC reverse-proxy (公网穿透) i18n
    frpc_intro: '南天门仅在本地监听。如需从公网访问，通过 FRP Client 将本地端口映射到你的公网 FRP Server。',
    frpc_github: 'FRP 项目主页',
    frpc_download_btn: '下载最新版 FRPC',
    frpc_downloading: '下载中',
    frpc_field_server_addr: 'FRPS 公网地址',
    frpc_field_server_port: 'FRPS 端口',
    frpc_field_token: 'FRPS 认证 Token',
    frpc_field_remote_port: '公网端口（HTTP模式无需填）',
    frpc_field_subdomain: '自定义域名（完整，如 b.net）',
    frpc_field_local_port: '本地南天门端口',
    frpc_auto_start: '随南天门启动',
    frpc_btn_save: '保存配置',
    frpc_btn_start: '启动 FRPC',
    frpc_btn_stop: '停止 FRPC',
    frpc_btn_enable: '启用',
    frpc_btn_disable: '停用',
    frpc_btn_cancel: '取消下载',
    frpc_err_config_incomplete: '请先在下方填写 FRPC 服务器配置',
    frpc_status_running: '运行中',
    frpc_status_stopped: '已停止',
    frpc_status_disabled: '已停用',
    frpc_log_title: 'FRPC 日志',
    frpc_log_empty: '暂无日志（启动 FRPC 后这里会显示）',
    frpc_keep_alive_hint: '切到其他页面不影响下载',
    frpc_binary_path: 'FRPC 二进制路径',
    frpc_titlebar_hint: '点击侧栏「反向代理」管理 FRPC',
    version_label: '版本',
    minimize: '最小化', maximize: '最大化', close: '关闭',
    add_provider: '新增大模型供应商', health: '健康检查', edit: '编辑', delete: '删除', set_default_chat: '设为默认Chat模型', default_chat_badge: '★ 默认Chat', set_default_embedding: '设为默认Embedding模型', default_embedding_badge: '★ 默认Embedding', manual: '手动', disable_model: '停用模型', enable_model: '启用模型',
    fld_name: '名称', fld_name_hint: '⚠ 不能包含空格或下划线', fld_name_dup: '已存在同名供应商', fld_base_url: 'API Base URL', fld_api_key: 'API Key',
    btn_cancel: '取消', btn_confirm: '确认', refresh_models: '刷新模型列表', add_model: '添加模型', bulk_enable_all: '全部启用', bulk_disable_all: '全部禁用', fld_capability: '模型用途', cap_chat: '对话', cap_embedding: '向量',
    fld_model_hint: '输入上游供应商支持的模型名称，如 gpt-4o-mini', no_providers: '暂无供应商，点击右上角添加',
    settings_title: '系统设置', set_listen_port: '监听端口', set_port_hint: '范围 1024-65535，默认 38271',
    set_autostart: '开机自动启动', set_autostart_desc: '系统启动时自动运行南天门', set_autostart_on: '已开启', set_autostart_off: '已关闭', set_save: '保存设置', set_saving: '保存中',
    set_proxy: '代理设置', set_proxy_system: '使用系统默认', set_proxy_system_desc: '通过系统环境变量中的代理配置发送请求（如 HTTPS_PROXY）', set_proxy_direct: '不适用代理', set_proxy_direct_desc: '绕过系统代理，直接连接模型', set_proxy_custom: '自定义', set_proxy_custom_desc: '使用指定 host:port 的代理（支持 http(s)/socks5）', set_proxy_url: '代理地址', set_proxy_url_placeholder: 'http://localhost:8080', set_proxy_url_hint: '示例：http://127.0.0.1:7890  或  socks5://127.0.0.1:1080',
    server_status: '服务状态', server_start: '启动', server_stop: '停止', server_restart: '重启',
    provider_count: '供应商数量', apikey_count: 'API Key 数量', today_requests: '今日请求', today_tokens: '今日总Token', today_cost: '今日总花费', today_embedding_requests: '今日Embedding请求',
    server_endpoints: '服务端点', copy: '复制',
    // ApiKeys
    generate_apikey: '生成 API Key', modal_generate_key: '生成新 API Key',
    fld_key_name: 'Key 名称', fld_key_note: '备注 (可选)',
    th_key: 'API Key', th_name: '名称', th_requests: '请求数',
    th_input: '输入 Token', th_output: '输出 Token', th_cached: '缓存 Token',
    th_created: '创建时间', th_last_used: '最后使用', th_actions: '操作',
    th_provider: '供应商', th_model: '模型',
    not_used: '未使用', details: '详情', collapse: '收起', no_keys: '暂无 API Key', show: '显示', hide: '隐藏',
    assign_model: '指定模型', assign_model_v2_hint: '只能从该 API Key 已授权的模型中选择。', assign_clear: '清除指定', assign_no_authorized: '该 Key 尚未授权任何模型，请先在编辑中授权。',
    // ponytail: v0.2.14 — 授权列表 (multi-select)
    authorized_models: '授权使用的模型', authorized_models_hint: '系统默认模型对所有用户可用；非必选，未授权任何模型时该用户仅可使用系统默认模型。',
    btn_select_all: '全选', btn_select_none: '取消全选', auth_selected_label: '个已选',
    refresh: '刷新', default_provider_model: '默认Chat模型', default_embedding_model: '默认Embedding模型', default_chat_model: '默认Chat模型', default_chat_hint: '选择该模型将自动路由到系统当前设置的默认Chat模型。', default_embedding_hint: '选择该模型将自动路由到系统当前设置的默认Embedding模型。',
    stats_title: '统计', stats_all_providers: '全部供应商', stats_all_models: '全部模型',
    stats_today: '今天', stats_7d: '最近7天', stats_30d: '最近30天', stats_all: '全部',
    capability_all: '全部类型', capability_chat: '对话', capability_embedding: 'Embedding',
    stats_total_requests: '总请求数', stats_input_tokens: '输入 Token', stats_output_tokens: '输出 Token', stats_cached_tokens: '已缓存', stats_total_cost: '总消费', stats_embedding_requests: 'Embedding 请求',
    stats_table_provider: '供应商', stats_table_requests: '请求数', stats_table_input: '输入 Token', stats_table_output: '输出 Token', stats_table_cached: '已缓存', stats_cost: '消费',
 stats_no_data: '暂无数据', stats_top_models: 'Top 3 模型请求量', stats_top_users: 'Top 3 请求用户',
 edit_model: '编辑模型设置', fld_input_price: '输入价格', fld_output_price: '输出价格', fld_cache_price: '缓存命中价格',
 per_million: '/百万Token', deleted_badge: '已删除', disabled_badge: '已停用',
 delete_default_forbidden: '默认模型不可删除（Chat 或 Embedding）',
 log_title: '通信日志', log_toggle: '启用日志', log_clear: '清空日志', log_clear_confirm: '确认清空所有通信日志?',
 log_time: '时间', log_user: '用户', log_provider: '供应商', log_model: '模型',
 log_tokens_in: '输入Token', log_tokens_out: '输出Token', log_tokens_cached: '缓存命中', log_status: '状态', log_duration: '耗时', log_loading: '加载中...',
 log_rotation: '滚动记录', log_rotation_off: '未启用', log_rotation_hint: '保留最新', log_rotation_unit: '条', log_cache_hit_pct: '命中%', log_cost: '花费',
 stats_all_users: '全部用户', db_volume: '数据库体积',
 },
  en: {
    dashboard: 'System Overview', models: 'Models', users: 'API Keys', stats: 'Statistics', docs: 'API Docs', logs: 'Comm Log', settings: 'Settings', reverse_proxy: 'Reverse Proxy', online: 'Online', offline: 'Offline', version_mismatch_short: 'Version mismatch', version_mismatch_title: 'Server/Desktop Version Mismatch', version_mismatch_desc: 'Connection refused. Stop the current Server, then start the same version as this Desktop client.',
    // ponytail: v0.5.0 — FRPC reverse-proxy i18n
    frpc_intro: 'Nantianmen only listens locally. To expose it to the public internet, use FRP Client to tunnel your local port through a public FRP Server.',
    frpc_github: 'FRP project page',
    frpc_download_btn: 'Download latest FRPC',
    frpc_downloading: 'Downloading',
    frpc_field_server_addr: 'FRPS public address',
    frpc_field_server_port: 'FRPS port',
    frpc_field_token: 'FRPS auth token',
    frpc_field_remote_port: 'Public port (not needed for HTTP)',
    frpc_field_subdomain: 'Custom domain (full, e.g. b.net)',
    frpc_field_local_port: 'Local Nantianmen port',
    frpc_auto_start: 'Start with Nantianmen',
    frpc_btn_save: 'Save config',
    frpc_btn_start: 'Start FRPC',
    frpc_btn_stop: 'Stop FRPC',
    frpc_btn_enable: 'Enable',
    frpc_btn_disable: 'Disable',
    frpc_btn_cancel: 'Cancel download',
    frpc_err_config_incomplete: 'Please fill in the FRP server fields below first',
    frpc_status_running: 'Running',
    frpc_status_stopped: 'Stopped',
    frpc_status_disabled: 'Disabled',
    frpc_log_title: 'FRPC log',
    frpc_log_empty: 'No log yet (starts filling after FRPC launches)',
    frpc_keep_alive_hint: 'navigating away does not interrupt the download',
    frpc_binary_path: 'FRPC binary path',
    frpc_titlebar_hint: 'Open the Reverse Proxy sidebar to manage FRPC',
    version_label: 'Version',
    minimize: 'Minimize', maximize: 'Maximize', close: 'Close',
    add_provider: 'Add Provider', health: 'Health Check', edit: 'Edit', delete: 'Delete', set_default_chat: 'Set Default Chat', default_chat_badge: '★ Default Chat', set_default_embedding: 'Set Default Embedding', default_embedding_badge: '★ Default Embedding', manual: 'Manual', disable_model: 'Disable Model', enable_model: 'Enable Model',
    fld_name: 'Name', fld_name_hint: '⚠ No spaces or underscores allowed', fld_name_dup: 'A provider with this name already exists', fld_base_url: 'API Base URL', fld_api_key: 'API Key',
    btn_cancel: 'Cancel', btn_confirm: 'Confirm', refresh_models: 'Refresh Models', add_model: 'Add Model', bulk_enable_all: 'Enable All', bulk_disable_all: 'Disable All', fld_capability: 'Capability', cap_chat: 'Chat', cap_embedding: 'Embedding',
    fld_model_hint: 'Enter a model name supported by the upstream provider, e.g. gpt-4o-mini', no_providers: 'No providers yet. Click + to add one.',
    settings_title: 'Settings', set_listen_port: 'Listen Port', set_port_hint: 'Range 1024-65535, default 38271',
    set_autostart: 'Auto Start', set_autostart_desc: 'Launch Nantianmen on system startup', set_autostart_on: 'Enabled', set_autostart_off: 'Disabled', set_save: 'Save', set_saving: 'Saving',
    set_proxy: 'Proxy Settings', set_proxy_system: 'Use system default', set_proxy_system_desc: 'Send requests through system environment proxy (e.g. HTTPS_PROXY)', set_proxy_direct: 'Bypass proxy', set_proxy_direct_desc: 'Connect to the model provider directly, ignoring any system proxy', set_proxy_custom: 'Custom', set_proxy_custom_desc: 'Use a custom host:port proxy (http(s) or socks5)', set_proxy_url: 'Proxy URL', set_proxy_url_placeholder: 'http://localhost:8080', set_proxy_url_hint: 'Example: http://127.0.0.1:7890  or  socks5://127.0.0.1:1080',
    server_status: 'Server Status', server_start: 'Start', server_stop: 'Stop', server_restart: 'Restart',
    provider_count: 'Providers', apikey_count: 'API Keys', today_requests: 'Requests Today', today_tokens: 'Tokens Today', today_cost: 'Cost Today', today_embedding_requests: 'Embedding Requests Today',
    server_endpoints: 'Server Endpoints', copy: 'Copy',
    // ApiKeys
    generate_apikey: 'Generate API Key', modal_generate_key: 'Generate New API Key',
    fld_key_name: 'Key Name', fld_key_note: 'Note (optional)',
    th_key: 'API Key', th_name: 'Name', th_requests: 'Requests',
    th_input: 'Input Tokens', th_output: 'Output Tokens', th_cached: 'Cached Tokens',
    th_created: 'Created', th_last_used: 'Last Used', th_actions: 'Actions',
    th_provider: 'Provider', th_model: 'Model',
    not_used: 'Never used', details: 'Details', collapse: 'Collapse', no_keys: 'No API keys', show: 'Show', hide: 'Hide',
    assign_model: 'Assign Model', assign_model_v2_hint: 'Only models already authorized for this key can be assigned.', assign_clear: 'Clear Assignment', assign_no_authorized: 'This key has no authorized models yet. Edit the key to grant access first.',
    // ponytail: v0.2.14 — authorized models multi-select
    authorized_models: 'Authorized Models', authorized_models_hint: 'The system default model is available to all users. Optional — if none are selected, this user can only call the system default.',
    btn_select_all: 'Select All', btn_select_none: 'Clear All', auth_selected_label: ' selected',
    refresh: 'Refresh', default_provider_model: 'Default Chat Model', default_embedding_model: 'Default Embedding Model', default_chat_model: 'Default Chat Model', default_chat_hint: 'Selecting this model routes to the currently configured default chat model.', default_embedding_hint: 'Selecting this model routes to the currently configured default embedding model.',
    stats_title: 'Statistics', stats_all_providers: 'All Providers', stats_all_models: 'All Models',
    stats_today: 'Today', stats_7d: 'Last 7 Days', stats_30d: 'Last 30 Days', stats_all: 'All',
    capability_all: 'All Types', capability_chat: 'Chat', capability_embedding: 'Embedding',
    stats_total_requests: 'Total Requests', stats_input_tokens: 'Input Tokens', stats_output_tokens: 'Output Tokens', stats_cached_tokens: 'Cached', stats_total_cost: 'Total Cost', stats_embedding_requests: 'Embedding Requests',
    stats_table_provider: 'Provider', stats_table_requests: 'Requests', stats_table_input: 'Input Tokens', stats_table_output: 'Output Tokens', stats_table_cached: 'Cached', stats_cost: 'Cost',
 stats_no_data: 'No data', stats_top_models: 'Top 3 Models by Requests', stats_top_users: 'Top 3 Users',
 edit_model: 'Edit Model Settings', fld_input_price: 'Input Price', fld_output_price: 'Output Price', fld_cache_price: 'Cache Hit Price',
 per_million: '/M tokens', deleted_badge: 'Deleted', disabled_badge: 'Disabled',
 delete_default_forbidden: 'Cannot delete a default model (Chat or Embedding)',
 log_title: 'Communication Log', log_toggle: 'Enable Logging', log_clear: 'Clear Log', log_clear_confirm: 'Clear all communication logs?',
 log_time: 'Time', log_user: 'User', log_provider: 'Provider', log_model: 'Model',
 log_tokens_in: 'Input Tokens', log_tokens_out: 'Output Tokens', log_tokens_cached: 'Cached', log_status: 'Status', log_duration: 'Duration', log_loading: 'Loading...',
 log_rotation: 'Rotation', log_rotation_off: 'Disabled', log_rotation_hint: 'Keep latest', log_rotation_unit: 'entries', log_cache_hit_pct: 'Cache Hit%', log_cost: 'Cost',
 stats_all_users: 'All Users', db_volume: 'DB Volume',
  },
  ja: {
    dashboard: 'システム概要', models: 'モデル管理', users: 'ユーザー管理', stats: '統計', docs: 'APIドキュメント', logs: '通信ログ', settings: '設定', reverse_proxy: 'リバースプロキシ', online: 'オンライン', offline: 'オフライン', version_mismatch_short: 'バージョン不一致', version_mismatch_title: 'Server/Desktop バージョン不一致', version_mismatch_desc: '接続を拒否しました。現在の Server を停止し、Desktop と同じバージョンを起動してください。',
    // ponytail: v0.5.0 — FRPC reverse-proxy i18n
    frpc_intro: '南天門はローカルでのみリッスンします。インターネットからアクセスするには、FRP Client を使ってローカルポートを公衆 FRP Server にトンネルします。',
    frpc_github: 'FRP プロジェクトページ',
    frpc_download_btn: '最新 FRPC をダウンロード',
    frpc_downloading: 'ダウンロード中',
    frpc_field_server_addr: 'FRPS 公衆アドレス',
    frpc_field_server_port: 'FRPS ポート',
    frpc_field_token: 'FRPS 認証 Token',
    frpc_field_remote_port: '公開ポート（HTTPモード不要）',
    frpc_field_subdomain: 'カスタムドメイン（完全な形、例 b.net）',
    frpc_field_local_port: 'ローカル南天門ポート',
    frpc_auto_start: '南天門と一緒に起動',
    frpc_btn_save: '設定を保存',
    frpc_btn_start: 'FRPC 起動',
    frpc_btn_stop: 'FRPC 停止',
    frpc_btn_enable: '有効化',
    frpc_btn_disable: '無効化',
    frpc_btn_cancel: 'ダウンロードをキャンセル',
    frpc_err_config_incomplete: '先に下方の FRP サーバー設定を入力してください',
    frpc_status_running: '実行中',
    frpc_status_stopped: '停止中',
    frpc_status_disabled: '無効',
    frpc_log_title: 'FRPC ログ',
    frpc_log_empty: 'まだログがありません（FRPC 起動後に表示）',
    frpc_keep_alive_hint: '他のページに移動してもダウンロードは中断されません',
    frpc_binary_path: 'FRPC バイナリパス',
    frpc_titlebar_hint: 'サイドバーの「リバースプロキシ」で FRPC を管理',
    version_label: 'バージョン',
    minimize: '最小化', maximize: '最大化', close: '閉じる',
    add_provider: 'プロバイダー追加', health: 'ヘルスチェック', edit: '編集', delete: '削除', set_default_chat: 'デフォルトChat設定', default_chat_badge: '★ デフォルトChat', set_default_embedding: 'デフォルトEmbedding設定', default_embedding_badge: '★ デフォルトEmbedding', manual: '手動', disable_model: 'モデル無効化', enable_model: 'モデル有効化',
    fld_name: '名称', fld_name_hint: '⚠ スペース・アンダースコア不可', fld_name_dup: '同名のプロバイダーが既に存在します', fld_base_url: 'API Base URL', fld_api_key: 'API Key',
    btn_cancel: 'キャンセル', btn_confirm: '確認', refresh_models: 'モデル更新', add_model: 'モデル追加', bulk_enable_all: '全て有効化', bulk_disable_all: '全て無効化', fld_capability: '用途', cap_chat: 'チャット', cap_embedding: '埋め込み',
    fld_model_hint: '上流プロバイダーがサポートするモデル名を入力（例: gpt-4o-mini）', no_providers: 'プロバイダーがありません。右上の+をクリックして追加。',
    settings_title: '設定', set_listen_port: 'リッスンポート', set_port_hint: '範囲 1024-65535、デフォルト 38271',
    set_autostart: '自動起動', set_autostart_desc: 'システム起動時に南天門を自動実行', set_autostart_on: 'オン', set_autostart_off: 'オフ', set_save: '保存', set_saving: '保存中',
    set_proxy: 'プロキシ設定', set_proxy_system: 'システム既定', set_proxy_system_desc: 'システムの環境変数（例: HTTPS_PROXY）のプロキシ経由で送信', set_proxy_direct: 'プロキシを使用しない', set_proxy_direct_desc: 'システムプロキシをバイパスし、モデルに直接接続', set_proxy_custom: 'カスタム', set_proxy_custom_desc: '指定した host:port のプロキシを使用（http(s)/socks5 対応）', set_proxy_url: 'プロキシ URL', set_proxy_url_placeholder: 'http://localhost:8080', set_proxy_url_hint: '例: http://127.0.0.1:7890  または  socks5://127.0.0.1:1080',
    server_status: 'サーバー状態', server_start: '起動', server_stop: '停止', server_restart: '再起動',
    provider_count: 'プロバイダー数', apikey_count: 'API Key 数', today_requests: '本日リクエスト', today_tokens: '本日Token', today_cost: '本日コスト', today_embedding_requests: '本日のEmbeddingリクエスト',
    server_endpoints: 'サーバーエンドポイント', copy: 'コピー',
    // ApiKeys
    generate_apikey: 'API Key 生成', modal_generate_key: '新規 API Key 生成',
    fld_key_name: 'Key 名', fld_key_note: '備考 (任意)',
    th_key: 'API Key', th_name: '名前', th_requests: 'リクエスト数',
    th_input: '入力 Token', th_output: '出力 Token', th_cached: 'キャッシュ Token',
    th_created: '作成日時', th_last_used: '最終使用', th_actions: '操作',
    th_provider: 'プロバイダー', th_model: 'モデル',
    not_used: '未使用', details: '詳細', collapse: '折りたたむ', no_keys: 'API Key なし', show: '表示', hide: '非表示',
    assign_model: 'モデル指定', assign_model_v2_hint: 'このキーに既に認可されたモデルからのみ選択できます。', assign_clear: '指定解除', assign_no_authorized: 'このキーには認可されたモデルがありません。先に編集から認可してください。',
    // ponytail: v0.2.14 — 認可モデル一覧 (multi-select)
    authorized_models: '認可モデル', authorized_models_hint: 'システムデフォルトモデルは全ユーザーが利用可能です。任意 — 未選択の場合、このユーザーはデフォルトモデルのみ呼び出せます。',
    btn_select_all: '全て選択', btn_select_none: '選択解除', auth_selected_label: ' 件選択中',
    refresh: '更新', default_provider_model: 'デフォルトChatモデル', default_embedding_model: 'デフォルトEmbeddingモデル', default_chat_model: 'デフォルトChatモデル', default_chat_hint: 'このモデルを選択すると、現在設定されているデフォルトChatモデルに自動ルーティングされます。', default_embedding_hint: 'このモデルを選択すると、現在設定されているデフォルトEmbeddingモデルに自動ルーティングされます。',
    stats_title: '統計', stats_all_providers: '全プロバイダー', stats_all_models: '全モデル',
    stats_today: '今日', stats_7d: '過去7日', stats_30d: '過去30日', stats_all: '全て',
    capability_all: '全タイプ', capability_chat: 'チャット', capability_embedding: 'Embedding',
    stats_total_requests: '総リクエスト数', stats_input_tokens: '入力 Token', stats_output_tokens: '出力 Token', stats_cached_tokens: 'キャッシュ', stats_total_cost: '総コスト', stats_embedding_requests: 'Embeddingリクエスト',
    stats_table_provider: 'プロバイダー', stats_table_requests: 'リクエスト数', stats_table_input: '入力 Token', stats_table_output: '出力 Token', stats_table_cached: 'キャッシュ', stats_cost: 'コスト',
 stats_no_data: 'データなし', stats_top_models: 'Top 3 リクエスト数', stats_top_users: 'Top 3 ユーザー',
 edit_model: 'モデル設定を編集', fld_input_price: '入力価格', fld_output_price: '出力価格', fld_cache_price: 'キャッシュ価格',
 per_million: '/百万Token', deleted_badge: '削除済', disabled_badge: '無効',
 delete_default_forbidden: 'デフォルトモデルは削除できません（Chat または Embedding）',
 log_title: '通信ログ', log_toggle: 'ログ有効化', log_clear: 'ログ消去', log_clear_confirm: 'すべての通信ログを消去しますか?',
 log_time: '時刻', log_user: 'ユーザー', log_provider: 'プロバイダー', log_model: 'モデル',
 log_tokens_in: '入力Token', log_tokens_out: '出力Token', log_tokens_cached: 'キャッシュ', log_status: '状態', log_duration: '所要時間', log_loading: '読み込み中...',
 log_rotation: 'ローテーション', log_rotation_off: '無効', log_rotation_hint: '最新', log_rotation_unit: '件', log_cache_hit_pct: 'キャッシュ%', log_cost: 'コスト',
 stats_all_users: '全ユーザー', db_volume: 'DB容量',
  },
}
const t = (key) => i18n[lang.value]?.[key] || key
provide('t', t)
provide('lang', lang)

// ponytail: v0.5.0 — titlebar FRPC chip. 4 visual states:
//   disabled (gray) → enabled but stopped (amber) → running (emerald) → unknown (gray).
const frpcStatus = ref('unknown')  // 'unknown' | 'disabled' | 'stopped' | 'running'
const frpcDotClass = computed(() => ({
  'bg-gray-500':    frpcStatus.value === 'unknown' || frpcStatus.value === 'disabled',
  'bg-amber-500':   frpcStatus.value === 'stopped',
  'bg-emerald-500': frpcStatus.value === 'running',
}))
const frpcTextClass = computed(() => ({
  'text-gray-500':    frpcStatus.value === 'unknown' || frpcStatus.value === 'disabled',
  'text-amber-400':   frpcStatus.value === 'stopped',
  'text-emerald-400': frpcStatus.value === 'running',
}))
const frpcLabel = computed(() => {
  switch (frpcStatus.value) {
    case 'running':  return t('frpc_status_running')
    case 'stopped':  return t('frpc_status_stopped')
    case 'disabled': return t('frpc_status_disabled')
    default:         return '—'
  }
})

async function refreshFrpcStatus() {
  if (!window.win?.frpc) { frpcStatus.value = 'unknown'; return }
  try {
    const s = await window.win.frpc.status()
    if (!s.hasBinary) { frpcStatus.value = 'unknown'; return }
    const c = await window.win.frpc.getConf()
    if (c && c.enabled === false) { frpcStatus.value = 'disabled'; return }
    frpcStatus.value = s.running ? 'running' : 'stopped'
  } catch { frpcStatus.value = 'unknown' }
}

const navItems = [
  { path: '/dashboard', labelKey: 'dashboard', icon: 'icon-dashboard' },
  { path: '/providers', labelKey: 'models', icon: 'icon-model' },
  { path: '/apikeys', labelKey: 'users', icon: 'icon-users' },
  { path: '/stats', labelKey: 'stats', icon: 'icon-static' },
  { path: '/logs', labelKey: 'logs', icon: 'icon-logs' },
  { path: '/reverse-proxy', labelKey: 'reverse_proxy', icon: 'icon-suidao' },
  { path: '/docs', labelKey: 'docs', icon: 'icon-api' },
  { path: '/settings', labelKey: 'settings', icon: 'icon-setting' },
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
    const status = win ? await win.serverStatus() : await fetch('http://127.0.0.1:38271/v1/health').then(async r => {
      const data = await r.json()
      const online = r.ok && data?.service === 'nantianmen'
      return { online, compatible: online && data.version === clientVersion, clientVersion, serverVersion: data?.version || null }
    })
    serverOnline.value = status.compatible
    serverMismatch.value = status.online && !status.compatible ? status : null
  } catch {
    serverOnline.value = false
    serverMismatch.value = null
  } finally {
    serverStatusReady.value = true
  }
}

onMounted(async () => {
  await checkHealth()
  healthPoll = setInterval(checkHealth, 3000)
  // ponytail: v0.5.0 — also poll frpc every 3s for the titlebar chip.
  await refreshFrpcStatus()
  setInterval(refreshFrpcStatus, 3000)
  // Live updates when frpc starts/stops anywhere (ReverseProxy.vue toggles or auto_start).
  if (window.win?.frpc) window.win.frpc.onStatus(() => refreshFrpcStatus())
  // ponytail: v0.5.0 — tray/main-process hint to route the user to the
  // Reverse Proxy page when frpc.start() bails on config-incomplete. We use
  // hash navigation (router is createWebHashHistory) so this works without
  // pulling vue-router into App.vue's imports.
  if (window.win?.frpc) window.win.frpc.onOpenSettings(() => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.hash = '#/reverse-proxy'
    }
  })
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
  width: 46px;
  height: 40px;
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
