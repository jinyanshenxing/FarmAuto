import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface AutomationConfig {
  farm?: boolean
  farm_push?: boolean
  land_upgrade?: boolean
  farm_water?: boolean
  farm_weed?: boolean
  farm_bug?: boolean
  friend?: boolean
  task?: boolean
  sell?: boolean
  fertilizer?: string
  /** 普通肥料施肥间隔（毫秒），默认 50 */
  fertilizer_interval_normal_ms?: number
  /** 有机肥料施肥间隔（毫秒），默认 100 */
  fertilizer_interval_organic_ms?: number
  fertilizer_gift?: boolean
  fertilizer_buy?: boolean
  /** 自动普通肥料（种植后第一时间施普通肥） */
  farm_fertilizer_normal?: boolean
  /** 自动施一次有机肥料（种植后施一次有机肥） */
  farm_fertilizer_organic_once?: boolean
  /** 防偷：剩余成熟秒数内施一次有机肥加速 */
  farm_fertilizer_anti_steal?: boolean
  /** 防偷识别秒数（0–86400），默认 300 */
  farm_fertilizer_anti_steal_sec?: number
  /** 连续施有机肥（按策略间隔） */
  farm_fertilizer_organic_loop?: boolean
  /** 自动使用化肥礼包（打开背包中的化肥礼包） */
  farm_fertilizer_use_gift_pack?: boolean
  friend_steal?: boolean
  friend_water?: boolean
  friend_weed?: boolean
  friend_bug?: boolean
  friend_bad?: boolean
  friend_help_exp_limit?: boolean
  open_server_gift?: boolean
}

export interface IntervalsConfig {
  farm?: number
  friend?: number
  farmMin?: number
  farmMax?: number
  friendMin?: number
  friendMax?: number
}

export interface FriendQuietHoursConfig {
  enabled?: boolean
  start?: string
  end?: string
}

export interface OfflineConfig {
  channel: string
  reloginUrlMode: string
  endpoint: string
  token: string
  title: string
  msg: string
  offlineDeleteSec: number
}

export interface UIConfig {
  theme?: string
}

/** 好友操作类型：help=帮助(除草/除虫/浇水) steal=偷菜 bad=捣乱(放虫/放草) */
export type FriendOpStep = 'help' | 'steal' | 'bad'

export interface SettingsState {
  plantingStrategy: string
  preferredSeedId: number
  intervals: IntervalsConfig
  friendQuietHours: FriendQuietHoursConfig
  automation: AutomationConfig
  stealDelaySeconds: number
  /** 好友操作执行顺序，如 ['help','steal','bad'] */
  friendOpOrder: FriendOpStep[]
  plantOrderRandom: boolean
  fertilizerOrderRandom: boolean
  plantDelaySeconds: number
  ui: UIConfig
  offlineReminder: OfflineConfig
}

export const useSettingStore = defineStore('setting', () => {
  const settings = ref<SettingsState>({
    plantingStrategy: 'preferred',
    preferredSeedId: 0,
    intervals: {},
    friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
    automation: {},
    stealDelaySeconds: 0,
    friendOpOrder: ['help', 'steal', 'bad'],
    plantOrderRandom: false,
    fertilizerOrderRandom: false,
    plantDelaySeconds: 0,
    ui: {},
    offlineReminder: {
      channel: 'webhook',
      reloginUrlMode: 'none',
      endpoint: '',
      token: '',
      title: '账号下线提醒',
      msg: '账号下线',
      offlineDeleteSec: 120,
    },
  })
  const loading = ref(false)

  async function fetchSettings(accountId: string) {
    if (!accountId)
      return
    loading.value = true
    try {
      const { data } = await api.get('/api/settings', {
        headers: { 'x-account-id': accountId },
      })
      if (data && data.ok && data.data) {
        const d = data.data
        settings.value.plantingStrategy = d.strategy || 'preferred'
        settings.value.preferredSeedId = d.preferredSeed || 0
        settings.value.intervals = d.intervals || {}
        settings.value.friendQuietHours = d.friendQuietHours || { enabled: false, start: '23:00', end: '07:00' }
        settings.value.automation = d.automation || {}
        settings.value.stealDelaySeconds = typeof d.stealDelaySeconds === 'number' ? d.stealDelaySeconds : 0
        const rawOrder = Array.isArray(d.friendOpOrder) ? d.friendOpOrder : ['help', 'steal', 'bad']
        const valid = ['help', 'steal', 'bad'] as const
        settings.value.friendOpOrder = rawOrder.filter((x: string) => valid.includes(x as any)) as FriendOpStep[]
        if (settings.value.friendOpOrder.length !== 3) settings.value.friendOpOrder = ['help', 'steal', 'bad']
        settings.value.plantOrderRandom = !!d.plantOrderRandom
        settings.value.fertilizerOrderRandom = !!d.fertilizerOrderRandom
        settings.value.plantDelaySeconds = typeof d.plantDelaySeconds === 'number' ? d.plantDelaySeconds : 0
        settings.value.ui = d.ui || {}
        settings.value.offlineReminder = d.offlineReminder || {
          channel: 'webhook',
          reloginUrlMode: 'none',
          endpoint: '',
          token: '',
          title: '账号下线提醒',
          msg: '账号下线',
          offlineDeleteSec: 120,
        }
      }
    }
    finally {
      loading.value = false
    }
  }

  async function saveSettings(accountId: string, newSettings: any) {
    if (!accountId)
      return { ok: false, error: '未选择账号' }
    loading.value = true
    try {
      // 1. Save general settings
      const settingsPayload = {
        plantingStrategy: newSettings.plantingStrategy,
        preferredSeedId: newSettings.preferredSeedId,
        intervals: newSettings.intervals,
        friendQuietHours: newSettings.friendQuietHours,
        stealDelaySeconds: newSettings.stealDelaySeconds,
        friendOpOrder: Array.isArray(newSettings.friendOpOrder) ? newSettings.friendOpOrder : ['help', 'steal', 'bad'],
        plantOrderRandom: newSettings.plantOrderRandom,
        fertilizerOrderRandom: newSettings.fertilizerOrderRandom,
        plantDelaySeconds: newSettings.plantDelaySeconds,
      }

      await api.post('/api/settings/save', settingsPayload, {
        headers: { 'x-account-id': accountId },
      })

      // 2. Save automation settings
      if (newSettings.automation) {
        await api.post('/api/automation', newSettings.automation, {
          headers: { 'x-account-id': accountId },
        })
      }

      // Refresh settings
      await fetchSettings(accountId)
      return { ok: true }
    }
    finally {
      loading.value = false
    }
  }

  async function saveOfflineConfig(config: OfflineConfig) {
    loading.value = true
    try {
      const { data } = await api.post('/api/settings/offline-reminder', config)
      if (data && data.ok) {
        settings.value.offlineReminder = config
        return { ok: true }
      }
      return { ok: false, error: '保存失败' }
    }
    finally {
      loading.value = false
    }
  }

  async function changeAdminPassword(oldPassword: string, newPassword: string) {
    loading.value = true
    try {
      const res = await api.post('/api/admin/change-password', { oldPassword, newPassword })
      return res.data
    }
    finally {
      loading.value = false
    }
  }

  return { settings, loading, fetchSettings, saveSettings, saveOfflineConfig, changeAdminPassword }
})
