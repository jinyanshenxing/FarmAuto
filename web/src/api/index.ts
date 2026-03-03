import { useStorage } from '@vueuse/core'
import axios from 'axios'
import { useToastStore } from '@/stores/toast'
import { useAccountStore } from '@/stores/account'

const tokenRef = useStorage('admin_token', '')
const accountIdRef = useStorage('current_account_id', '')

const api = axios.create({
  baseURL: '/',
  timeout: 60000, // 好友过多时接口可能较慢，放宽至 60 秒避免误报超时
})

api.interceptors.request.use((config) => {
  const token = tokenRef.value
  if (token) {
    config.headers['x-admin-token'] = token
  }
  const accountId = accountIdRef.value
  if (accountId) {
    config.headers['x-account-id'] = accountId
  }
  return config
}, (error) => {
  return Promise.reject(error)
})

api.interceptors.response.use((response) => {
  return response
}, (error) => {
  const toast = useToastStore()

  if (error.response) {
    if (error.response.status === 401) {
      // Avoid redirect loop or multiple redirects
      if (!window.location.pathname.includes('/login')) {
        tokenRef.value = ''
        window.location.href = '/login'
        toast.warning('登录已过期，请重新登录')
      }
    }
    else if (error.response.status >= 500) {
      const backendError = String(error.response.data?.error || error.response.data?.message || '')
      // 后端运行态可预期错误：不弹全局500，交给页面状态处理
      if (backendError === '账号未运行' || backendError === 'API Timeout') {
        return Promise.reject(error)
      }
      // 若请求的是其他账号（已切换账号后旧请求才返回），不弹 toast，避免误报
      const requestAccountId = error.config?.headers?.['x-account-id'] ?? ''
      const acc = useAccountStore()
      const currentId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
      if (requestAccountId && currentId && String(requestAccountId) !== currentId) {
        return Promise.reject(error)
      }
      toast.error(`服务器错误: ${error.response.status} ${error.response.statusText}`)
    }
    else {
      // 404 且为用户管理列表接口时由页面自行提示，避免重复 “Not Found”
      const url = (error.config?.url as string) || ''
      if (error.response?.status === 404 && (url.includes('/api/admin/users') && !url.match(/\/api\/admin\/users\/\d+/)))
        return Promise.reject(error)
      const msg = error.response.data?.error || error.response.data?.message || error.message
      toast.error(msg || `请求失败: ${error.response?.status ?? ''}`)
    }
  }
  else if (error.request) {
    const requestAccountId = error.config?.headers?.['x-account-id'] ?? ''
    const acc = useAccountStore()
    const currentId = String((acc.currentAccountId as { value?: string })?.value ?? acc.currentAccountId ?? '')
    if (requestAccountId && currentId && String(requestAccountId) !== currentId) {
      return Promise.reject(error)
    }
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      toast.error('请求超时，请稍后重试或检查脚本是否正常运行')
    } else {
      toast.error('网络错误，无法连接到服务器')
    }
  }
  else {
    toast.error(`错误: ${error.message}`)
  }

  return Promise.reject(error)
})

export default api
