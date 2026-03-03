import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import api from '@/api'

export interface Account {
  id: string
  name: string
  nick?: string
  uin?: number
  platform?: string
  running?: boolean
  /** 是否已连接到脚本服务器正常运行（由后端根据 worker 的 connection.connected 计算） */
  connected?: boolean
  /** 是否被卡密封号禁止网页登录（封号后为 true，解封后为 false） */
  loginDisabled?: boolean
  /** 所属用户 ID（管理员查看全部账号时有值） */
  ownerId?: string
  /** 所属用户名（管理员查看全部账号时有值，用于分组展示） */
  ownerUsername?: string
  /** 后端 GET /api/accounts 返回时附带的绑定卡密信息（多卡时 code 为「多张卡密」，到期时间已叠加） */
  cardInfo?: { code: string; type: string; expiresAt: number | null; cardCount?: number } | null
}

export interface AccountLog {
  time: string
  action: string
  msg: string
  reason?: string
}

export function getPlatformLabel(p?: string) {
  if (p === 'qq')
    return 'QQ'
  if (p === 'wx')
    return '微信'
  return ''
}

export function getPlatformClass(p?: string) {
  if (p === 'qq')
    return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
  if (p === 'wx')
    return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
  return ''
}

export const useAccountStore = defineStore('account', () => {
  const accounts = ref<Account[]>([])
  const currentAccountId = useStorage('current_account_id', '')
  const loading = ref(false)
  const logs = ref<AccountLog[]>([])

  const currentAccount = computed(() =>
    accounts.value.find(a => String(a.id) === currentAccountId.value),
  )

  async function fetchAccounts() {
    loading.value = true
    try {
      // api interceptor adds x-admin-token
      const res = await api.get('/api/accounts')
      if (res.data.ok && res.data.data && res.data.data.accounts) {
        const list = res.data.data.accounts as Account[]
        // 按 id 去重，避免多端或后端历史数据导致同账号显示多条
        const byId = new Map<string, Account>()
        for (const a of list) {
          const id = a?.id != null ? String(a.id) : ''
          if (id && !byId.has(id)) byId.set(id, a)
        }
        accounts.value = Array.from(byId.values())

        if (accounts.value.length > 0) {
          const found = accounts.value.find(a => String(a.id) === currentAccountId.value)
          if (!found && accounts.value[0]) {
            currentAccountId.value = String(accounts.value[0].id)
          }
        } else {
          currentAccountId.value = ''
        }
      }
    }
    catch (e) {
      console.error('获取账号失败', e)
    }
    finally {
      loading.value = false
    }
  }

  function selectAccount(id: string) {
    currentAccountId.value = id
  }

  function setCurrentAccount(acc: Account) {
    selectAccount(acc.id)
  }

  async function startAccount(id: string) {
    await api.post(`/api/accounts/${id}/start`)
    await fetchAccounts()
  }

  async function stopAccount(id: string) {
    await api.post(`/api/accounts/${id}/stop`)
    await fetchAccounts()
  }

  async function deleteAccount(id: string) {
    await api.delete(`/api/accounts/${id}`)
    if (currentAccountId.value === id) {
      currentAccountId.value = ''
    }
    await fetchAccounts()
  }

  async function fetchLogs() {
    try {
      const res = await api.get('/api/account-logs?limit=100')
      if (Array.isArray(res.data)) {
        logs.value = res.data
      }
    }
    catch (e) {
      console.error('获取账号日志失败', e)
    }
  }

  async function addAccount(payload: any) {
    try {
      await api.post('/api/accounts', payload)
      await fetchAccounts()
    }
    catch (e) {
      console.error('添加账号失败', e)
      throw e
    }
  }

  async function updateAccount(id: string, payload: any) {
    try {
      // core uses POST /api/accounts for both add and update (if id is present)
      await api.post('/api/accounts', { ...payload, id })
      await fetchAccounts()
    }
    catch (e) {
      console.error('更新账号失败', e)
      throw e
    }
  }

  return {
    accounts,
    currentAccountId,
    currentAccount,
    loading,
    logs,
    fetchAccounts,
    selectAccount,
    startAccount,
    stopAccount,
    deleteAccount,
    fetchLogs,
    addAccount,
    updateAccount,
    setCurrentAccount,
  }
})
