import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface CardStats {
  totalCards: number
  activatedCards: number
  onlineCount: number
  active: number
  banned: number
  expired: number
}

export interface Card {
  id: string
  code: string
  type: string
  days: number | null
  createdAt: number
  activatedAt: number | null
  expiresAt: number | null
  boundAccountId: string | null
  /** 绑定账号的显示名称（QQ 备注/昵称），由后端根据 boundAccountId 解析 */
  boundAccountName?: string | null
  /** 绑定账号的 QQ 号（扫码添加时获取的 uin），由后端根据 boundAccountId 解析 */
  boundAccountUin?: string | null
  /** 免费领取卡：领取该卡的网站用户名，用于列表展示 */
  claimedByUsername?: string | null
  boundDeviceId: string | null
  status: string
  lastUsedAt: number | null
  remark: string
}

export const useCardStore = defineStore('card', () => {
  const stats = ref<CardStats>({
    totalCards: 0,
    activatedCards: 0,
    onlineCount: 0,
    active: 0,
    banned: 0,
    expired: 0,
  })
  const cards = ref<Card[]>([])
  const loading = ref(false)
  const statsLoading = ref(false)

  async function fetchStats() {
    statsLoading.value = true
    try {
      const res = await api.get('/api/cards/stats')
      if (res.data?.ok && res.data?.data) {
        stats.value = res.data.data
      }
    }
    catch (e) {
      console.error('获取卡密统计失败', e)
    }
    finally {
      statsLoading.value = false
    }
  }

  async function fetchCards(params?: { status?: string, type?: string, search?: string }) {
    loading.value = true
    try {
      const q = new URLSearchParams()
      if (params?.status) q.set('status', params.status)
      if (params?.type) q.set('type', params.type)
      if (params?.search) q.set('search', params.search)
      const res = await api.get(`/api/cards?${q.toString()}`)
      if (res.data?.ok && Array.isArray(res.data?.data)) {
        cards.value = res.data.data
      }
    }
    catch (e) {
      console.error('获取卡密列表失败', e)
    }
    finally {
      loading.value = false
    }
  }

  async function createBatch(payload: { type: string, count: number, prefix?: string, remark?: string }) {
    const res = await api.post('/api/cards/batch', payload)
    if (res.data?.ok) return res.data.data as Card[]
    throw new Error(res.data?.error || '制卡失败')
  }

  async function updateCard(id: string, updates: { expiresAt?: number | null, remark?: string }) {
    const res = await api.patch(`/api/cards/${id}`, updates)
    if (res.data?.ok) return res.data.data as Card
    throw new Error(res.data?.error || '更新失败')
  }

  async function banCard(id: string) {
    const res = await api.post(`/api/cards/${id}/ban`)
    if (res.data?.ok) return res.data.data as Card
    throw new Error(res.data?.error || '封号失败')
  }

  async function unbanCard(id: string) {
    const res = await api.post(`/api/cards/${id}/unban`)
    if (res.data?.ok) return res.data.data as Card
    throw new Error(res.data?.error || '解封失败')
  }

  async function forceLogout(id: string) {
    const res = await api.post(`/api/cards/${id}/force-logout`)
    if (res.data?.ok) return res.data.data as Card
    throw new Error(res.data?.error || '操作失败')
  }

  async function unbind(id: string) {
    const res = await api.post(`/api/cards/${id}/unbind`)
    if (res.data?.ok) return res.data.data as Card
    throw new Error(res.data?.error || '解绑失败')
  }

  /** 删除卡密并解除绑定，同时停止该账号脚本 */
  async function deleteCard(id: string) {
    const res = await api.delete(`/api/cards/${id}`)
    if (res.data?.ok) return res.data.data as Card
    throw new Error(res.data?.error || '删除失败')
  }

  /** 验证卡密有效性与时效性，添加账号前调用 */
  async function verifyCard(code: string): Promise<{ valid: boolean, message?: string, card?: any }> {
    const res = await api.get('/api/cards/verify', { params: { code: (code || '').trim() } })
    if (res.data?.ok && res.data?.data) return res.data.data
    return { valid: false, message: '验证失败' }
  }

  /** 校验 QQ 是否已激活且未过期，用于添加账号时跳过卡密直接扫码 */
  async function checkUinActivation(uin: string): Promise<{ canSkipCard: boolean, message?: string, accountId?: string }> {
    const res = await api.get('/api/accounts/check-uin', { params: { uin: (uin || '').trim() } })
    if (res.data?.ok && res.data?.data) return res.data.data
    return { canSkipCard: false, message: '验证失败' }
  }

  /** 添加账号成功后激活卡密并绑定账号 */
  async function activateCard(code: string, accountId: string) {
    const res = await api.post('/api/cards/activate', { code: (code || '').trim(), accountId })
    if (res.data?.ok) return res.data.data as Card
    throw new Error(res.data?.error || '激活失败')
  }

  /** 为指定账号续费：新卡密绑定到该账号，时长在原有到期时间上叠加（永久不降级） */
  async function renewCard(accountId: string, code: string) {
    const res = await api.post(`/api/accounts/${accountId}/renew-card`, { code: (code || '').trim() })
    if (res.data?.ok) return res.data.data as Card
    throw new Error(res.data?.error || '续费失败')
  }

  return {
    stats,
    cards,
    loading,
    statsLoading,
    fetchStats,
    fetchCards,
    createBatch,
    updateCard,
    banCard,
    unbanCard,
    forceLogout,
    unbind,
    deleteCard,
    verifyCard,
    checkUinActivation,
    activateCard,
    renewCard,
  }
})
