import axios from 'axios'

const SERVER_URL = 'http://127.0.0.1:7300'

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
  getModels: (id) => api.get(`/providers/${id}/models`),
  setDefaultModel: (providerId, modelId) => api.put(`/providers/${providerId}/models/${modelId}/default`),

  // API Keys
  listApiKeys: () => api.get('/api-keys'),
  createApiKey: (data) => api.post('/api-keys', data),
  deleteApiKey: (id) => api.delete(`/api-keys/${id}`),

  // Stats
  getStats: (params) => api.get('/stats', { params }),
}
