import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Dashboard from './views/Dashboard.vue'
import Providers from './views/Providers.vue'
import ApiKeys from './views/ApiKeys.vue'
import Stats from './views/Stats.vue'
import ApiDocs from './views/ApiDocs.vue'
import Settings from './views/Settings.vue'
import Logs from './views/Logs.vue'
import './style.css'
import './iconfont.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', component: Dashboard },
    { path: '/providers', component: Providers },
    { path: '/apikeys', component: ApiKeys },
    { path: '/stats', component: Stats },
    { path: '/docs', component: ApiDocs },
    { path: '/settings', component: Settings },
    { path: '/logs', component: Logs },
  ],
})

createApp(App).use(router).mount('#app')
