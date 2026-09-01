import axios from 'axios'

const SERVER_URL = 'http://127.0.0.1:38271'

const api = axios.create({
  baseURL: `${SERVER_URL}/api/admin`,
  timeout: 10000,
})

export default {
  // Providers
  listProviders: () => api.get('/providers'),
  createProvider: (data) => api.post('/providers', data),
  updateProvider: (id, data) => api.put(`/providers/${id}`, data),
  deleteProvider: (id) => api.delete(`/providers/${id}`),
  checkHealth: (id) => api.post(`/providers/${id}/health`),
  // Models
  getModels: (id) => api.get(`/providers/${id}/models`),
  refreshModels: (id) => api.post(`/providers/${id}/models/refresh`),
  addModel: (id, name, capability) => api.post(`/providers/${id}/models`, { model_name: name, capability: capability || 'chat' }),
  updateModel: (providerId, modelId, data) => api.put(`/providers/${providerId}/models/${modelId}`, data),
  setDefaultModel: (providerId, modelId) => api.put(`/providers/${providerId}/models/${modelId}/default`),
  // ponytail: v0.5.1 — set/get default embedding model (separate from chat default).
  setDefaultEmbeddingModel: (providerId, modelId) => api.put(`/providers/${providerId}/models/${modelId}/default-embedding`),
  getDefaultEmbeddingModel: () => api.get('/default-embedding-model'),
  // ponytail: toggle is_disabled on a model — rebuilds modelMap so /v1/models reflects the change.
  toggleModel: (providerId, modelId) => api.put(`/providers/${providerId}/models/${modelId}/toggle`),
  // ponytail: hard-delete a model. Schema cascades: removes from every api_key's authorized list,
  // clears api_keys.assigned_model_id (proxy falls back to Nantianmen-default), keeps history rows.
  deleteModel: (providerId, modelId) => api.delete(`/providers/${providerId}/models/${modelId}`),

  // API Keys
  listApiKeys: () => api.get('/api-keys'),
  createApiKey: (data) => api.post('/api-keys', data),
  updateApiKey: (id, data) => api.put(`/api-keys/${id}`, data),
  deleteApiKey: (id) => api.delete(`/api-keys/${id}`),
  // ponytail: v0.2.14 — available models for the create/edit authorization multi-select
  listAvailableModels: () => api.get('/api-keys/available-models'),

  // Stats
  getStats: (params) => api.get('/stats', { params }),

  // Server status (from /api/admin/status - whitelisted, no auth needed)
  getServerStatus: () => axios.get(`${SERVER_URL}/api/admin/status`),

  // Database info
  getDbInfo: () => api.get('/database/info'),

  // ponytail: change DB file path; server closes handle, moves file, updates conf
  moveDatabase: (newPath) => api.post('/database/move', { path: newPath }),
  // Default model
  getDefaultModel: () => api.get('/default-model'),

  // Communication log
  getCommLog: (params) => api.get('/communication-log', { params }),
  clearCommLog: () => api.delete('/communication-log'),
  getCommLogConfig: () => api.get('/communication-log/config'),
  setCommLogConfig: (data) => api.put('/communication-log/config', data),

  // UI filter persistence
  getUiFilters: () => api.get('/ui-filters'),
  saveUiFilters: (filters) => api.put('/ui-filters', filters),

  // ponytail: outbound proxy settings (server reads conf.proxy at request time)
  getProxy: () => api.get('/proxy'),
  setProxy: (body) => api.put('/proxy', body),
}