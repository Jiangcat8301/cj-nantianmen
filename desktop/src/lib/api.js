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
  addModel: (id, name) => api.post(`/providers/${id}/models`, { model_name: name }),
  updateModel: (providerId, modelId, data) => api.put(`/providers/${providerId}/models/${modelId}`, data),
  setDefaultModel: (providerId, modelId) => api.put(`/providers/${providerId}/models/${modelId}/default`),

  // API Keys
  listApiKeys: () => api.get('/api-keys'),
  createApiKey: (data) => api.post('/api-keys', data),
  deleteApiKey: (id) => api.delete(`/api-keys/${id}`),

  // Stats
  getStats: (params) => api.get('/stats', { params }),

  // Server status (from /api/admin/status - whitelisted, no auth needed)
  getServerStatus: () => axios.get(`${SERVER_URL}/api/admin/status`),

  // ponytail: change DB file path; server closes handle, moves file, updates conf
  moveDatabase: (newPath) => api.post('/database/move', { path: newPath }),
  // Default model
  getDefaultModel: () => api.get('/default-model'),

  // Communication log
  getCommLog: (params) => api.get('/communication-log', { params }),
  clearCommLog: () => api.delete('/communication-log'),
  getCommLogConfig: () => api.get('/communication-log/config'),
  setCommLogConfig: (log_enabled) => api.put('/communication-log/config', { log_enabled }),
}
