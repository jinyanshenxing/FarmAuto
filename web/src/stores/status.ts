import type { Socket } from 'socket.io-client'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { io } from 'socket.io-client'
import { ref, shallowRef } from 'vue'
import api from '@/api'

// Define interfaces for better type checking
interface DailyGift {
  key: string
  label: string
  enabled?: boolean
  doneToday: boolean
  lastAt?: number
  completedCount?: number
  totalCount?: number
  tasks?: any[]
}

interface DailyGiftsResponse {
  date: string
  growth: DailyGift
  gifts: DailyGift[]
}

export const useStatusStore = defineStore('status', () => {
  const status = shallowRef<any>(null)
  const logs = ref<any[]>([])
  const accountLogs = ref<any[]>([])
  const dailyGifts = ref<DailyGiftsResponse | null>(null)
  const loading = ref(false)
  const error = ref('')
  const realtimeConnected = ref(false)
  const realtimeLogsEnabled = ref(true)
  const currentRealtimeAccountId = ref('')
  let fetchingStatusAccountId = ''
  const tokenRef = useStorage('admin_token', '')

  let socket: Socket | null = null

  function normalizeStatusPayload(input: any) {
    return (input && typeof input === 'object') ? { ...input } : {}
  }

  function normalizeLogEntry(input: any) {
    const entry = (input && typeof input === 'object') ? { ...input } : {}
    const ts = Number(entry.ts) || Date.parse(String(entry.time || '')) || Date.now()
    return {
      ...entry,
      ts,
      time: entry.time || new Date(ts).toISOString().replace('T', ' ').slice(0, 19),
    }
  }

  let pendingStatusFetchTimer: ReturnType<typeof setTimeout> | null = null

  function pushRealtimeLog(entry: any) {
    const next = normalizeLogEntry(entry)
    logs.value.push(next)
    if (logs.value.length > 400)
      logs.value = logs.value.slice(-400)
  }

  function pushRealtimeAccountLog(entry: any) {
    const next = (entry && typeof entry === 'object') ? entry : {}
    accountLogs.value.push(next)
    if (accountLogs.value.length > 150)
      accountLogs.value = accountLogs.value.slice(-150)
  }

  function handleRealtimeStatus(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const accountId = String(body.accountId || '')
    if (!accountId)
      return
    if (currentRealtimeAccountId.value !== accountId)
      return
    if (pendingStatusFetchTimer) {
      clearTimeout(pendingStatusFetchTimer)
      pendingStatusFetchTimer = null
    }
    if (body.status && typeof body.status === 'object') {
      status.value = normalizeStatusPayload(body.status)
      error.value = ''
    }
  }

  function handleRealtimeLog(payload: any) {
    if (!realtimeLogsEnabled.value)
      return
    pushRealtimeLog(payload)
  }

  function handleRealtimeAccountLog(payload: any) {
    pushRealtimeAccountLog(payload)
  }

  function handleRealtimeLogsSnapshot(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const list = Array.isArray(body.logs) ? body.logs : []
    logs.value = list.map((item: any) => normalizeLogEntry(item))
  }

  function handleRealtimeAccountLogsSnapshot(payload: any) {
    const body = (payload && typeof payload === 'object') ? payload : {}
    const list = Array.isArray(body.logs) ? body.logs : []
    accountLogs.value = list
  }

  function ensureRealtimeSocket() {
    if (socket)
      return socket

    socket = io('/', {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket'],
      auth: {
        token: tokenRef.value,
      },
    })

    socket.on('connect', () => {
      realtimeConnected.value = true
      if (currentRealtimeAccountId.value) {
        socket?.emit('subscribe', { accountId: currentRealtimeAccountId.value })
      }
      else {
        socket?.emit('subscribe', { accountId: 'all' })
      }
    })

    socket.on('disconnect', () => {
      realtimeConnected.value = false
    })

    socket.on('connect_error', (err) => {
      realtimeConnected.value = false
      console.error('[realtime] 连接失败:', err.message)
    })

    socket.on('status:update', handleRealtimeStatus)
    socket.on('log:new', handleRealtimeLog)
    socket.on('account-log:new', handleRealtimeAccountLog)
    socket.on('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.on('account-logs:snapshot', handleRealtimeAccountLogsSnapshot)
    return socket
  }

  async function fetchStatusQuiet(accountId: string) {
    if (!accountId) return
    try {
      const { data } = await api.get('/api/status', { headers: { 'x-account-id': accountId } })
      if (currentRealtimeAccountId.value !== accountId) return
      if (data?.ok) {
        status.value = normalizeStatusPayload(data.data)
        error.value = ''
      } else {
        error.value = data?.error || ''
      }
    } catch {
      if (currentRealtimeAccountId.value === accountId) error.value = '获取状态失败'
    }
  }

  function connectRealtime(accountId: string) {
    const id = String(accountId || '').trim()
    const prevId = currentRealtimeAccountId.value
    currentRealtimeAccountId.value = id
    if (pendingStatusFetchTimer) {
      clearTimeout(pendingStatusFetchTimer)
      pendingStatusFetchTimer = null
    }
    if (!id) {
      status.value = null
    } else if (prevId !== id) {
      status.value = null
    }
    if (!tokenRef.value)
      return

    const client = ensureRealtimeSocket()
    client.auth = {
      token: tokenRef.value,
      accountId: currentRealtimeAccountId.value || 'all',
    }

    if (client.connected) {
      client.emit('subscribe', { accountId: currentRealtimeAccountId.value || 'all' })
      pendingStatusFetchTimer = setTimeout(() => {
        pendingStatusFetchTimer = null
        if (currentRealtimeAccountId.value === id) fetchStatusQuiet(id)
      }, 1500)
      return
    }
    client.connect()
    pendingStatusFetchTimer = setTimeout(() => {
      pendingStatusFetchTimer = null
      if (currentRealtimeAccountId.value === id) fetchStatusQuiet(id)
    }, 1500)
  }

  function disconnectRealtime() {
    if (pendingStatusFetchTimer) {
      clearTimeout(pendingStatusFetchTimer)
      pendingStatusFetchTimer = null
    }
    if (!socket)
      return
    socket.off('connect')
    socket.off('disconnect')
    socket.off('connect_error')
    socket.off('status:update', handleRealtimeStatus)
    socket.off('log:new', handleRealtimeLog)
    socket.off('account-log:new', handleRealtimeAccountLog)
    socket.off('logs:snapshot', handleRealtimeLogsSnapshot)
    socket.off('account-logs:snapshot', handleRealtimeAccountLogsSnapshot)
    socket.disconnect()
    socket = null
    realtimeConnected.value = false
  }

  async function fetchStatus(accountId: string) {
    if (!accountId)
      return
    if (loading.value && fetchingStatusAccountId === accountId)
      return
    loading.value = true
    fetchingStatusAccountId = accountId
    try {
      const { data } = await api.get('/api/status', {
        headers: { 'x-account-id': accountId },
      })
      if (currentRealtimeAccountId.value !== accountId)
        return
      if (data.ok) {
        status.value = normalizeStatusPayload(data.data)
        error.value = ''
      }
      else {
        error.value = data.error
      }
    }
    catch (e: any) {
      if (currentRealtimeAccountId.value !== accountId)
        return
      error.value = e.message
    }
    finally {
      loading.value = false
      fetchingStatusAccountId = ''
    }
  }

  async function fetchLogs(accountId: string, options: any = {}) {
    if (!accountId && options.accountId !== 'all')
      return
    const params: any = { limit: 100, ...options }
    const headers: any = {}
    if (accountId && accountId !== 'all') {
      headers['x-account-id'] = accountId
    }
    else {
      params.accountId = 'all'
    }

    try {
      const { data } = await api.get('/api/logs', { headers, params })
      if (data.ok) {
        logs.value = data.data
        error.value = ''
      }
    }
    catch (e: any) {
      console.error(e)
    }
  }

  async function fetchDailyGifts(accountId: string) {
    if (!accountId)
      return
    try {
      const { data } = await api.get('/api/daily-gifts', {
        headers: { 'x-account-id': accountId },
      })
      if (data.ok) {
        dailyGifts.value = data.data
      }
    }
    catch (e) {
      console.error('获取每日奖励失败', e)
    }
  }

  async function fetchAccountLogs(limit = 100) {
    try {
      const res = await api.get(`/api/account-logs?limit=${Math.max(1, Number(limit) || 100)}`)
      if (Array.isArray(res.data)) {
        accountLogs.value = res.data
      }
    }
    catch (e) {
      console.error(e)
    }
  }

  function setRealtimeLogsEnabled(enabled: boolean) {
    realtimeLogsEnabled.value = !!enabled
  }

  function clearLogs() {
    logs.value = []
    accountLogs.value = []
  }

  return {
    status,
    logs,
    accountLogs,
    dailyGifts,
    loading,
    error,
    realtimeConnected,
    realtimeLogsEnabled,
    currentRealtimeAccountId,
    fetchStatus,
    fetchLogs,
    fetchAccountLogs,
    fetchDailyGifts,
    setRealtimeLogsEnabled,
    clearLogs,
    connectRealtime,
    disconnectRealtime,
  }
})
