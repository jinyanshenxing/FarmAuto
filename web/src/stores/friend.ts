import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface FarmBannedItem {
  gid: number
  friendName: string
}

const DEFAULT_FRIEND_PAGE_SIZE = 100
const FRIEND_LANDS_CACHE_MS = 90 * 1000

export const useFriendStore = defineStore('friend', () => {
  const friends = ref<any[]>([])
  const friendsTotal = ref(0)
  const loading = ref(false)
  const friendLands = ref<Record<string, any[]>>({})
  const friendLandsLoading = ref<Record<string, boolean>>({})
  const friendLandsCache = ref<Record<string, { accountId: string, data: any[], at: number }>>({})
  const blacklist = ref<number[]>([])
  const farmBannedList = ref<FarmBannedItem[]>([])
  const farmBannedLoading = ref(false)

  /**
   * 拉取好友列表，支持分页以应对好友过多时的超时与卡顿
   * @param append 为 true 时追加到当前列表，否则替换
   */
  async function fetchFriends(accountId: string, options?: { page?: number, pageSize?: number, append?: boolean }) {
    if (!accountId)
      return
    const page = options?.page ?? 1
    const pageSize = options?.pageSize ?? DEFAULT_FRIEND_PAGE_SIZE
    const append = options?.append ?? false
    if (!append)
      loading.value = true
    try {
      const res = await api.get('/api/friends', {
        headers: { 'x-account-id': accountId },
        params: { page, pageSize },
      })
      if (res.data.ok) {
        const data = res.data.data
        const list = data && Array.isArray(data.friends) ? data.friends : (Array.isArray(data) ? data : [])
        const total = data && typeof data.total === 'number' ? data.total : list.length
        if (append) {
          friends.value = [...friends.value, ...list]
        } else {
          friends.value = list
        }
        friendsTotal.value = total
      } else if (!append) {
        friends.value = []
        friendsTotal.value = 0
      }
    } catch {
      if (!append) {
        friends.value = []
        friendsTotal.value = 0
      }
    } finally {
      loading.value = false
    }
  }

  async function fetchBlacklist(accountId: string) {
    if (!accountId)
      return
    try {
      const res = await api.get('/api/friend-blacklist', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        blacklist.value = res.data.data || []
      }
    }
    catch { /* ignore */ }
  }

  async function toggleBlacklist(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post('/api/friend-blacklist/toggle', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok) {
      blacklist.value = res.data.data || []
    }
  }

  async function fetchFriendLands(accountId: string, friendId: string) {
    if (!accountId || !friendId)
      return
    const cacheKey = `${accountId}:${friendId}`
    const cached = friendLandsCache.value[cacheKey]
    const now = Date.now()
    if (cached && cached.accountId === accountId && now - cached.at < FRIEND_LANDS_CACHE_MS) {
      friendLands.value[friendId] = cached.data
      return
    }
    friendLandsLoading.value[friendId] = true
    try {
      const res = await api.get(`/api/friend/${friendId}/lands`, {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok) {
        const raw = res.data.data
        const data = Array.isArray(raw) ? raw : (raw?.lands || [])
        friendLands.value[friendId] = data
        friendLandsCache.value = { ...friendLandsCache.value, [cacheKey]: { accountId, data, at: now } }
      }
    }
    finally {
      friendLandsLoading.value[friendId] = false
    }
  }

  async function operate(accountId: string, friendId: string, opType: string) {
    if (!accountId || !friendId)
      return
    await api.post(`/api/friend/${friendId}/op`, { opType }, {
      headers: { 'x-account-id': accountId },
    })
    await fetchFriends(accountId, { page: 1, pageSize: DEFAULT_FRIEND_PAGE_SIZE })
    if (friendLands.value[friendId]) {
      await fetchFriendLands(accountId, friendId)
    }
  }

  async function fetchFarmBannedList(accountId: string) {
    if (!accountId)
      return
    farmBannedLoading.value = true
    try {
      const res = await api.get<{ ok: boolean; data: FarmBannedItem[] }>('/api/friends/farm-banned', {
        headers: { 'x-account-id': accountId },
      })
      if (res.data.ok)
        farmBannedList.value = res.data.data || []
      else
        farmBannedList.value = []
    }
    catch {
      farmBannedList.value = []
    }
    finally {
      farmBannedLoading.value = false
    }
  }

  async function removeFromFarmBanned(accountId: string, gid: number) {
    if (!accountId || !gid)
      return
    const res = await api.post<{ ok: boolean; data: FarmBannedItem[] }>('/api/friends/farm-banned/remove', { gid }, {
      headers: { 'x-account-id': accountId },
    })
    if (res.data.ok)
      farmBannedList.value = res.data.data || []
  }

  return {
    friends,
    friendsTotal,
    loading,
    friendLands,
    friendLandsLoading,
    blacklist,
    farmBannedList,
    farmBannedLoading,
    fetchFriends,
    fetchBlacklist,
    toggleBlacklist,
    fetchFriendLands,
    operate,
    fetchFarmBannedList,
    removeFromFarmBanned,
  }
})
