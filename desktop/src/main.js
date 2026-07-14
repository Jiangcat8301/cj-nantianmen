import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Providers from './views/Providers.vue'
import ApiKeys from './views/ApiKeys.vue'
import Stats from './views/Stats.vue'
import ApiDocs from './views/ApiDocs.vue'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/providers' },
    { path: '/providers', component: Providers },
    { path: '/apikeys', component: ApiKeys },
    { path: '/stats', component: Stats },
    { path: '/docs', component: ApiDocs },
  ],
})

createApp(App).use(router).mount('#app')
