import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import App from './App.vue'
import router from './router'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './style.css'

// 最早将主题应用到 <html>，避免首屏闪烁或主题不生效（不依赖 Pinia 初始化顺序）
const THEME_KEY = 'app_color_theme'
const VALID_THEMES = new Set(['default', 'ocean', 'sunset', 'amethyst', 'sakura'])
function applyThemeToDocument(themeId: string) {
  const html = document.documentElement
  const id = themeId && VALID_THEMES.has(themeId) ? themeId : 'default'
  if (id === 'default') html.removeAttribute('data-theme')
  else html.setAttribute('data-theme', id)
}
applyThemeToDocument(localStorage.getItem(THEME_KEY) || 'default')

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// Global Error Handling
const toast = useToastStore()

app.config.errorHandler = (err: any, _instance, info) => {
  console.error('全局 Vue 错误:', err, info)
  const message = err.message || String(err)
  if (message.includes('ResizeObserver loop'))
    return
  toast.error(`应用错误: ${message}`)
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  if (reason && typeof reason === 'object' && 'isAxiosError' in reason)
    return

  console.error('Unhandled Rejection:', reason)
  const message = reason?.message || String(reason)
  toast.error(`异步错误: ${message}`)
})

window.onerror = (message, _source, _lineno, _colno, error) => {
  console.error('Global Error:', message, error)
  if (String(message).includes('Script error'))
    return
  toast.error(`系统错误: ${message}`)
}

// 先应用本地主题并挂载，主题同步延后执行以优先首屏渲染（利于移动端）
const appStore = useAppStore()
applyThemeToDocument(appStore.colorTheme)

app.mount('#app')

function deferThemeSync() {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
      appStore.fetchTheme().then(() => applyThemeToDocument(appStore.colorTheme))
    }, { timeout: 2000 })
  } else {
    setTimeout(() => {
      appStore.fetchTheme().then(() => applyThemeToDocument(appStore.colorTheme))
    }, 100)
  }
}
deferThemeSync()
