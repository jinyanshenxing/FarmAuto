import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import api from '@/api'
import { useAccountStore } from '@/stores/account'

const USER_ROLE_KEY = 'user_role'
const USER_NAME_KEY = 'user_name'
const THEME_KEY = 'app_color_theme'

/** 有效的主题 ID，与 style.css 中 [data-theme="..."] 及 main.ts 同步 */
const VALID_THEME_IDS = new Set(['default', 'ocean', 'sunset', 'amethyst', 'sakura'])

export interface ColorTheme {
  id: string
  name: string
  description: string
  gradientFrom: string
  gradientTo: string
  accentRgb: string
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'default', name: '翡翠森林', description: '清新自然的绿色调，灵感来自晨光中的翠绿山谷', gradientFrom: '#10b981', gradientTo: '#34d399', accentRgb: '16 185 129' },
  { id: 'ocean', name: '海洋深邃', description: '沉稳优雅的蓝青渐变，仿佛置身深海与天空之间', gradientFrom: '#3b82f6', gradientTo: '#06b6d4', accentRgb: '59 130 246' },
  { id: 'sunset', name: '落日熔金', description: '温暖热烈的橙红渐变，如同傍晚天边的绚烂霞光', gradientFrom: '#f97316', gradientTo: '#f43f5e', accentRgb: '249 115 22' },
  { id: 'amethyst', name: '紫晶幻梦', description: '神秘浪漫的紫色光芒，营造出魔法般的梦幻氛围', gradientFrom: '#8b5cf6', gradientTo: '#a855f7', accentRgb: '139 92 246' },
  { id: 'sakura', name: '樱花绯色', description: '甜美柔和的粉色系，如同春风中飘落的樱花花瓣', gradientFrom: '#ec4899', gradientTo: '#f472b6', accentRgb: '236 72 153' },
]

export const useAppStore = defineStore('app', () => {
  const sidebarOpen = ref(false)
  const isDark = ref(false)
  const colorTheme = ref(localStorage.getItem(THEME_KEY) || 'default')
  /** 当前账号的自定义背景图（data URL 或 外链），按账号独立、跨端同步 */
  const customBackgroundUrl = ref('')
  const userRole = ref(localStorage.getItem(USER_ROLE_KEY) || '')
  const userName = ref(localStorage.getItem(USER_NAME_KEY) || '')
  /** 用户最后一次通过 UI 切换主题的时间，用于避免 fetchTheme 覆盖用户选择 */
  let lastUserSetThemeAt = 0

  function setUser(username: string, role: string) {
    userName.value = username || ''
    userRole.value = role || ''
    if (username) localStorage.setItem(USER_NAME_KEY, username)
    else localStorage.removeItem(USER_NAME_KEY)
    if (role) localStorage.setItem(USER_ROLE_KEY, role)
    else localStorage.removeItem(USER_ROLE_KEY)
  }

  function setUserRole(role: string) {
    userRole.value = role || ''
    if (role) localStorage.setItem(USER_ROLE_KEY, role)
    else localStorage.removeItem(USER_ROLE_KEY)
  }

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function closeSidebar() {
    sidebarOpen.value = false
  }

  function openSidebar() {
    sidebarOpen.value = true
  }

  /** 拉取指定账号的 UI 配置（主题+背景），用于切换账号时同步；不传则用当前选中账号 */
  async function fetchTheme(accountId?: string) {
    const id = accountId ?? useAccountStore().currentAccountId ?? ''
    const fetchStartedAt = Date.now()
    try {
      const headers = id ? { 'x-account-id': id } : {}
      const { data } = await api.get<{ ok: boolean; data?: { ui?: { colorTheme?: string; customBackgroundUrl?: string } } }>('/api/settings/ui', { headers })
      if (data?.ok && data.data?.ui) {
        const ui = data.data.ui
        if (ui.colorTheme && lastUserSetThemeAt < fetchStartedAt) {
          const theme = VALID_THEME_IDS.has(ui.colorTheme) ? ui.colorTheme : 'default'
          colorTheme.value = theme
          localStorage.setItem(THEME_KEY, theme)
        }
        customBackgroundUrl.value = typeof ui.customBackgroundUrl === 'string' ? ui.customBackgroundUrl : ''
      }
    }
    catch {
      if (!id) {
        const fallback = localStorage.getItem(THEME_KEY) || 'default'
        if (VALID_THEME_IDS.has(fallback)) colorTheme.value = fallback
      }
    }
  }

  async function setTheme(_theme: 'light' | 'dark') {
    // 主题固定为浅色，忽略切换
  }

  function setColorTheme(themeId: string, accountId?: string) {
    const id = themeId && VALID_THEME_IDS.has(themeId) ? themeId : 'default'
    lastUserSetThemeAt = Date.now()
    colorTheme.value = id
    localStorage.setItem(THEME_KEY, id)
    applyColorTheme(id)
    const accId = accountId ?? useAccountStore().currentAccountId ?? ''
    const headers = accId ? { 'x-account-id': accId } : {}
    api.post('/api/settings/color-theme', { colorTheme: id }, { headers }).catch(() => {})
  }

  function setCustomBackground(url: string, accountId?: string) {
    customBackgroundUrl.value = typeof url === 'string' ? url : ''
    const accId = accountId ?? useAccountStore().currentAccountId ?? ''
    if (!accId) return
    api.post('/api/settings/custom-background', { customBackgroundUrl: customBackgroundUrl.value }, { headers: { 'x-account-id': accId } }).catch(() => {})
  }

  function applyColorTheme(themeId: string) {
    const id = themeId && VALID_THEME_IDS.has(themeId) ? themeId : 'default'
    const el = document.documentElement
    if (id === 'default') {
      el.removeAttribute('data-theme')
    } else {
      el.setAttribute('data-theme', id)
    }
  }

  watch(isDark, (val) => {
    if (val)
      document.documentElement.classList.add('dark')
    else
      document.documentElement.classList.remove('dark')
  }, { immediate: true })

  watch(colorTheme, (val) => {
    applyColorTheme(val)
  }, { immediate: true })

  return {
    sidebarOpen,
    isDark,
    colorTheme,
    customBackgroundUrl,
    userRole,
    userName,
    setUser,
    setUserRole,
    toggleSidebar,
    closeSidebar,
    openSidebar,
    fetchTheme,
    setTheme,
    setColorTheme,
    setCustomBackground,
    applyColorTheme,
  }
})
