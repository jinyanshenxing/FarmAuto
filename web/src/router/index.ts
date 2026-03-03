import { useStorage } from '@vueuse/core'
import axios from 'axios'
import { createRouter, createWebHistory } from 'vue-router'
import { menuRoutes } from './menu'
import { useAppStore } from '@/stores/app'

let nprogressReady: Promise<{ start: () => void; done: () => void; configure: (o: { showSpinner: boolean }) => void }> | null = null
let nprogressConfigured = false
async function getNProgress() {
  if (!nprogressReady) {
    nprogressReady = Promise.all([
      import('nprogress'),
      import('nprogress/nprogress.css'),
    ]).then(([np]) => (np as { default: { start: () => void; done: () => void; configure: (o: object) => void } }).default)
  }
  const NProgress = await nprogressReady
  if (!nprogressConfigured) {
    NProgress.configure({ showSpinner: false })
    nprogressConfigured = true
  }
  return NProgress
}

const adminToken = useStorage('admin_token', '')
let validatedToken = ''
type ValidateResult = { username?: string; role?: string } | false
let validatingPromise: Promise<ValidateResult> | null = null

async function ensureTokenValid(): Promise<ValidateResult> {
  const token = String(adminToken.value || '').trim()
  if (!token)
    return false

  if (validatedToken && validatedToken === token) {
    const appStore = useAppStore()
    return { username: appStore.userName, role: appStore.userRole }
  }

  if (validatingPromise)
    return validatingPromise

  const promise = axios.get<{ ok?: boolean; data?: { username?: string; role?: string } }>('/api/auth/validate', {
    headers: { 'x-admin-token': token },
    timeout: 6000,
  }).then((res): ValidateResult => {
    const ok = !!(res.data && res.data.ok)
    const data = res.data?.data
    if (ok) {
      validatedToken = token
      return (data && typeof data === 'object')
        ? { username: data.username, role: data.role }
        : { username: '', role: '' }
    }
    return false
  }).catch((): ValidateResult => false).finally(() => {
    validatingPromise = null
  })

  validatingPromise = promise
  return promise
}

/** 登录成功后调用，避免进入首页时重复请求 /api/auth/validate */
export function setValidatedToken(token: string) {
  validatedToken = String(token || '').trim()
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/DefaultLayout.vue'),
      children: [
        ...menuRoutes.map(route => ({
          path: route.path,
          name: route.name,
          component: route.component,
        })),
        { path: 'friends', redirect: () => ({ name: 'dashboard', query: { farm: 'friends' } }) },
        { path: 'settings', redirect: () => ({ name: 'dashboard', query: { farm: 'settings' } }) },
        { path: 'crop-steal', redirect: () => ({ name: 'dashboard', query: { farm: 'settings', tab: 'cropSteal' } }) },
      ],
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/Register.vue'),
    },
  ],
})

router.beforeEach(async (to, _from) => {
  getNProgress().then((np) => np.start())

  if (to.name === 'login' || to.name === 'register') {
    if (to.name === 'register')
      return true
    if (!adminToken.value) {
      validatedToken = ''
      return true
    }
    const data = await ensureTokenValid()
    if (data) {
      const appStore = useAppStore()
      appStore.setUser(data.username || '', data.role || '')
      return { name: 'dashboard' }
    }
    adminToken.value = ''
    validatedToken = ''
    useAppStore().setUser('', '')
    return true
  }

  if (!adminToken.value) {
    validatedToken = ''
    return { name: 'login' }
  }

  const token = String(adminToken.value || '').trim()
  if (validatedToken && validatedToken === token) {
    const appStore = useAppStore()
    if ((to.name === 'cards' || to.name === 'userManage') && appStore.userRole !== 'admin')
      return { name: 'dashboard' }
    return true
  }

  const data = await ensureTokenValid()
  if (!data) {
    adminToken.value = ''
    validatedToken = ''
    useAppStore().setUser('', '')
    return { name: 'login' }
  }

  const appStore = useAppStore()
  appStore.setUser(data.username || '', data.role || '')

  if ((to.name === 'cards' || to.name === 'userManage') && appStore.userRole !== 'admin')
    return { name: 'dashboard' }

  return true
})

router.afterEach(() => {
  getNProgress().then((np) => np.done())
})

export default router
