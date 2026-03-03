<script setup lang="ts">
import { useEventListener, useIntervalFn, useThrottleFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/LandCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useFriendStore } from '@/stores/friend'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const FarmPanel = defineAsyncComponent(() => import('@/components/FarmPanel.vue'))
const BagPanel = defineAsyncComponent(() => import('@/components/BagPanel.vue'))
const TaskPanel = defineAsyncComponent(() => import('@/components/TaskPanel.vue'))
const Settings = defineAsyncComponent(() => import('@/views/Settings.vue'))
const CropStealSettings = defineAsyncComponent(() => import('@/views/CropStealSettings.vue'))
const StrategySettings = defineAsyncComponent(() => import('@/views/StrategySettings.vue'))
const statusStore = useStatusStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const friendStore = useFriendStore()
const toast = useToastStore()

const {
  status,
  logs: statusLogs,
  accountLogs: statusAccountLogs,
  realtimeConnected,
} = storeToRefs(statusStore)
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { dashboardItems } = storeToRefs(bagStore)
const {
  friends,
  friendsTotal,
  loading: friendListLoading,
  friendLands,
  friendLandsLoading,
  blacklist,
  farmBannedList,
  farmBannedLoading,
} = storeToRefs(friendStore)
const route = useRoute()
const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const lastBagFetchAt = ref(0)
const farmPanelRef = ref<InstanceType<typeof FarmPanel> | null>(null)
const bagPanelRef = ref<InstanceType<typeof BagPanel> | null>(null)
const taskPanelRef = ref<InstanceType<typeof TaskPanel> | null>(null)
const farmRefreshing = ref(false)
const bagRefreshing = ref(false)
const taskRefreshing = ref(false)

// ---- 我的农场子 tab：土地详情 / 我的背包 / 我的任务 ----
const mineSubTab = ref<'farm' | 'bag' | 'task'>('farm')

// ---- 功能设置子 tab：自动设置 / 作物偷取设置 / 策略设置 ----
const settingsSubTab = ref<'auto' | 'cropSteal' | 'strategy'>('auto')

// ---- 好友互动 / 功能设置 ----
const farmTab = ref<'mine' | 'friends' | 'settings'>('mine')

// ---- 好友互动子 tab：好友列表 / 已封禁（时间表合并为点击好友后展开显示） ----
const friendSubTab = ref<'list' | 'banned'>('list')
const FRIEND_LIST_PAGE_SIZE = 10
const friendListPage = ref(1)
const friendSearchKeyword = ref('')
const bannedSearchKeyword = ref('')
const showFriendConfirm = ref(false)
const friendConfirmMessage = ref('')
const friendConfirmLoading = ref(false)
const pendingFriendAction = ref<(() => Promise<void>) | null>(null)
const avatarErrorKeys = ref<Set<string>>(new Set())
const expandedListFriendIds = ref<Set<string>>(new Set())

const totalFriendPages = computed(() =>
  Math.max(1, Math.ceil((friendsTotal.value ?? 0) / FRIEND_LIST_PAGE_SIZE)),
)
const filteredListFriends = computed(() => {
  const list = friends.value || []
  const kw = String(friendSearchKeyword.value || '').trim().toLowerCase()
  if (!kw) return list
  return list.filter((f: any) => String(f?.name ?? '').toLowerCase().includes(kw))
})
const filteredFarmBanned = computed(() => {
  const list = farmBannedList.value || []
  const kw = String(bannedSearchKeyword.value || '').trim().toLowerCase()
  if (!kw) return list
  return list.filter((item: { gid: number, friendName: string }) => {
    const name = String(item.friendName ?? '').toLowerCase()
    const gidStr = String(item.gid ?? '')
    return name.includes(kw) || gidStr.includes(kw)
  })
})

function friendConfirmAction(msg: string, action: () => Promise<void>) {
  friendConfirmMessage.value = msg
  pendingFriendAction.value = action
  showFriendConfirm.value = true
}

async function onFriendConfirm() {
  if (pendingFriendAction.value) {
    try {
      friendConfirmLoading.value = true
      await pendingFriendAction.value()
      pendingFriendAction.value = null
      showFriendConfirm.value = false
    } finally {
      friendConfirmLoading.value = false
    }
  } else {
    showFriendConfirm.value = false
  }
}

async function loadFriendListPage() {
  if (!currentAccountId.value) return
  avatarErrorKeys.value.clear()
  await friendStore.fetchFriends(currentAccountId.value, {
    page: friendListPage.value,
    pageSize: FRIEND_LIST_PAGE_SIZE,
  })
  await friendStore.fetchBlacklist(currentAccountId.value)
}

async function loadFarmBannedList() {
  if (!currentAccountId.value) return
  await friendStore.fetchFarmBannedList(currentAccountId.value)
}

function goToFriendPage(page: number) {
  const p = Math.max(1, Math.min(page, totalFriendPages.value))
  if (p === friendListPage.value) return
  friendListPage.value = p
}

function toggleListFriend(friendId: string) {
  if (expandedListFriendIds.value.has(friendId)) {
    expandedListFriendIds.value.delete(friendId)
    expandedListFriendIds.value = new Set(expandedListFriendIds.value)
  } else {
    expandedListFriendIds.value.clear()
    expandedListFriendIds.value.add(friendId)
    expandedListFriendIds.value = new Set(expandedListFriendIds.value)
    if (currentAccountId.value)
      friendStore.fetchFriendLands(currentAccountId.value, friendId)
  }
}

async function handleListFriendOp(friendId: string, type: string, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value) return
  friendConfirmAction('确定执行此操作吗?', async () => {
    await friendStore.operate(currentAccountId.value!, friendId, type)
    await statusStore.fetchStatus(currentAccountId.value)
    await loadFriendListPage()
    toast.success('操作完成')
  })
}

async function handleToggleBlacklist(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value) return
  await friendStore.toggleBlacklist(currentAccountId.value, Number(friend.gid))
}

async function handleRemoveFromFarmBanned(item: { gid: number, friendName: string }) {
  if (!currentAccountId.value) return
  await friendStore.removeFromFarmBanned(currentAccountId.value, item.gid)
}

function getFriendStatusText(friend: any) {
  const p = friend.plant || {}
  const info: string[] = []
  if (p.stealNum) info.push(`偷${p.stealNum}`)
  if (p.dryNum) info.push(`水${p.dryNum}`)
  if (p.weedNum) info.push(`草${p.weedNum}`)
  if (p.insectNum) info.push(`虫${p.insectNum}`)
  return info.length ? info.join(' ') : '无操作'
}

function getFriendAvatar(friend: any) {
  const direct = String(friend?.avatarUrl || friend?.avatar_url || '').trim()
  if (direct) return direct
  const uin = String(friend?.uin || '').trim()
  if (uin) return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
  return ''
}

function getFriendAvatarKey(friend: any) {
  return String(friend?.gid || friend?.uin || '').trim() || String(friend?.name || '').trim()
}

function canShowFriendAvatar(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key) return false
  return !!getFriendAvatar(friend) && !avatarErrorKeys.value.has(key)
}

function handleFriendAvatarError(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (key) avatarErrorKeys.value.add(key)
}

// 好友列表倒计时每秒更新
useIntervalFn(() => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  for (const gid in friendLands.value) {
    if (friendLands.value[gid]) {
      friendLands.value[gid] = friendLands.value[gid].map((l: any) =>
        l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
      )
    }
  }
}, 1000)

watch(friendSubTab, (tab) => {
  if (tab === 'list') {
    friendListPage.value = 1
    if (currentAccountId.value) loadFriendListPage()
  }
  if (tab === 'banned' && currentAccountId.value) loadFarmBannedList()
})

watch(friendListPage, () => {
  if (friendSubTab.value === 'list' && currentAccountId.value) loadFriendListPage()
})

watch(currentAccountId, () => {
  expandedListFriendIds.value.clear()
  if (friendSubTab.value === 'list' && currentAccountId.value) {
    friendListPage.value = 1
    loadFriendListPage()
  }
  if (friendSubTab.value === 'banned' && currentAccountId.value) loadFarmBannedList()
})

// 路由 query farm / tab 时切换 tab（friends=好友互动, settings=功能设置；tab=cropSteal 时打开作物偷取设置）
watch(() => route.query.farm, (farm) => {
  if (farm === 'friends') farmTab.value = 'friends'
  if (farm === 'settings') {
    farmTab.value = 'settings'
    if (route.query.tab === 'cropSteal') settingsSubTab.value = 'cropSteal'
    else if (route.query.tab === 'strategy') settingsSubTab.value = 'strategy'
  }
}, { immediate: true })
watch(() => route.query.tab, (tab) => {
  if (farmTab.value !== 'settings') return
  if (tab === 'cropSteal') settingsSubTab.value = 'cropSteal'
  else if (tab === 'strategy') settingsSubTab.value = 'strategy'
}, { immediate: true })

// 好友互动勾选与一键操作（与脚本逻辑一致：帮助=浇水+除草+除虫，偷取=偷菜）
const selectedFriendGids = ref<Set<number>>(new Set())
const friendScheduleBatchLoading = ref(false)
const hasSelectedFriendSchedule = computed(() => selectedFriendGids.value.size > 0)
const friendScheduleSelectionCount = computed(() => selectedFriendGids.value.size)

function toggleFriendScheduleSelect(gid: number) {
  const next = new Set(selectedFriendGids.value)
  if (next.has(gid)) next.delete(gid)
  else next.add(gid)
  selectedFriendGids.value = next
}

function toggleSelectAllFriendSchedule() {
  const list = filteredListFriends.value
  if (selectedFriendGids.value.size >= list.length) {
    selectedFriendGids.value = new Set()
  } else {
    selectedFriendGids.value = new Set(list.map((f: any) => f.gid))
  }
}

function getFriendLandsScheduleSummary(gid: number) {
  const lands = friendLands.value[gid]
  if (!Array.isArray(lands) || lands.length === 0)
    return { total: 0, due: 0, waiting: 0, earliestRemain: null as number | null }
  const total = lands.length
  const due = lands.filter((l: any) => (l.status === 'stealable' || l.status === 'harvestable') || (l.matureInSec != null && l.matureInSec <= 0)).length
  const waiting = lands.filter((l: any) => l.matureInSec != null && l.matureInSec > 0).length
  const waitingLands = lands.filter((l: any) => l.matureInSec != null && l.matureInSec > 0)
  const earliestRemain = waitingLands.length > 0
    ? Math.min(...waitingLands.map((l: any) => l.matureInSec ?? 0))
    : null
  return { total, due, waiting, earliestRemain }
}

async function batchFriendHelp() {
  if (!currentAccountId.value || !hasSelectedFriendSchedule.value || friendScheduleBatchLoading.value)
    return
  const gids = Array.from(selectedFriendGids.value)
  friendScheduleBatchLoading.value = true
  try {
    for (const gid of gids) {
      await friendStore.operate(currentAccountId.value, String(gid), 'water')
      await friendStore.operate(currentAccountId.value, String(gid), 'weed')
      await friendStore.operate(currentAccountId.value, String(gid), 'bug')
    }
    await statusStore.fetchStatus(currentAccountId.value)
    toast.success(`一键帮助完成：已对 ${gids.length} 位好友执行浇水/除草/除虫`)
  } catch (e: any) {
    toast.error(e?.message || e?.response?.data?.error || '一键帮助执行失败')
  } finally {
    friendScheduleBatchLoading.value = false
  }
}

async function batchFriendSteal() {
  if (!currentAccountId.value || !hasSelectedFriendSchedule.value || friendScheduleBatchLoading.value)
    return
  const gids = Array.from(selectedFriendGids.value)
  friendScheduleBatchLoading.value = true
  try {
    for (const gid of gids) {
      await friendStore.operate(currentAccountId.value, String(gid), 'steal')
    }
    await statusStore.fetchStatus(currentAccountId.value)
    toast.success(`一键偷取完成：已对 ${gids.length} 位好友执行偷取`)
  } catch (e: any) {
    toast.error(e?.message || e?.response?.data?.error || '一键偷取执行失败')
  } finally {
    friendScheduleBatchLoading.value = false
  }
}

function formatFriendRemain(sec: number) {
  if (sec <= 0) return '已到期'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

// ---- 好友访问日志 ----
const logTab = ref<'runtime' | 'friend'>('runtime')

interface FriendVisitLog {
  time: string
  friendName: string
  friendId: string
  action: string
  crop?: string
  stealDelaySec?: number
  farmLevel?: number
}

// 首页「好友访问日志」展示的是「好友对我进行的操作」（如偷取我的作物），而非我对好友的操作
const friendVisitLogs = computed<FriendVisitLog[]>(() => {
  const list = statusLogs.value || []
  return list
    .filter((l: any) => l.meta?.event === 'friend_visit_me' && l.meta?.result === 'ok')
    .map((l: any) => ({
      time: l.time || '',
      friendName: l.meta?.friendName ?? '',
      friendId: String(l.meta?.friendGid ?? ''),
      action: l.meta?.action ?? '偷菜',
      crop: l.meta?.cropName ?? undefined,
      stealDelaySec: undefined,
      farmLevel: undefined,
    }))
    .reverse()
})

const FRIEND_ACTION_META: Record<string, { icon: string, color: string, tagClass: string }> = {
  浇水: { icon: 'i-carbon-rain-drop', color: 'text-blue-400', tagClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  除草: { icon: 'i-carbon-cut-out', color: 'text-yellow-500', tagClass: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  除虫: { icon: 'i-carbon-warning-alt', color: 'text-red-400', tagClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  偷菜: { icon: 'i-carbon-run', color: 'text-orange-500', tagClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
}

function getFriendActionMeta(action: string) {
  return FRIEND_ACTION_META[action] || { icon: 'i-carbon-circle-dash', color: 'text-gray-400', tagClass: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300' }
}

async function refreshFarm() {
  farmRefreshing.value = true
  try {
    await farmPanelRef.value?.refresh?.()
  }
  finally {
    farmRefreshing.value = false
  }
}

async function handleRefreshBagCard() {
  bagRefreshing.value = true
  try {
    await bagPanelRef.value?.loadBag?.()
  }
  finally {
    bagRefreshing.value = false
  }
}

async function handleRefreshTaskCard() {
  taskRefreshing.value = true
  try {
    await taskPanelRef.value?.refresh?.()
  }
  finally {
    taskRefreshing.value = false
  }
}

function refreshMineCurrent() {
  if (mineSubTab.value === 'farm') refreshFarm()
  else if (mineSubTab.value === 'bag') handleRefreshBagCard()
  else handleRefreshTaskCard()
}

const throttledRefreshMineCurrent = useThrottleFn(refreshMineCurrent, 800, true, false)

const mineRefreshLoading = computed(() => {
  if (mineSubTab.value === 'farm') return farmRefreshing.value
  if (mineSubTab.value === 'bag') return bagRefreshing.value
  return taskRefreshing.value
})

const allLogs = computed(() => {
  const sLogs = statusLogs.value || []
  const aLogs = (statusAccountLogs.value || []).map((l: any) => ({
    ts: new Date(l.time).getTime(),
    time: l.time,
    tag: l.action === 'Error' ? '错误' : '系统',
    msg: l.reason ? `${l.msg} (${l.reason})` : l.msg,
    isAccountLog: true,
  }))

  return [...sLogs, ...aLogs].sort((a: any, b: any) => a.ts - b.ts).filter((l: any) => !l.isAccountLog)
})

const filter = reactive({
  module: '',
  event: '',
  keyword: '',
  isWarn: '',
})

const hasActiveLogFilter = computed(() =>
  !!(filter.module || filter.event || filter.keyword || filter.isWarn),
)

const modules = [
  { label: '所有模块', value: '' },
  { label: '农场', value: 'farm' },
  { label: '好友', value: 'friend' },
  { label: '仓库', value: 'warehouse' },
  { label: '任务', value: 'task' },
  { label: '系统', value: 'system' },
]

const events = [
  { label: '所有事件', value: '' },
  { label: '农场巡查', value: 'farm_cycle' },
  { label: '收获作物', value: 'harvest_crop' },
  { label: '清理枯株', value: 'remove_plant' },
  { label: '种植种子', value: 'plant_seed' },
  { label: '施加化肥', value: 'fertilize' },
  { label: '土地推送', value: 'lands_notify' },
  { label: '选择种子', value: 'seed_pick' },
  { label: '购买种子', value: 'seed_buy' },
  { label: '购买化肥', value: 'fertilizer_buy' },
  { label: '开启礼包', value: 'fertilizer_gift_open' },
  { label: '获取任务', value: 'task_scan' },
  { label: '完成任务', value: 'task_claim' },
  { label: '免费礼包', value: 'mall_free_gifts' },
  { label: '分享奖励', value: 'daily_share' },
  { label: '会员礼包', value: 'vip_daily_gift' },
  { label: '月卡礼包', value: 'month_card_gift' },
  { label: '开服红包', value: 'open_server_gift' },
  { label: '图鉴奖励', value: 'illustrated_rewards' },
  { label: '邮箱领取', value: 'email_rewards' },
  { label: '出售成功', value: 'sell_success' },
  { label: '土地升级', value: 'upgrade_land' },
  { label: '土地解锁', value: 'unlock_land' },
  { label: '好友巡查', value: 'friend_cycle' },
  { label: '访问好友', value: 'visit_friend' },
  { label: '好友对我的操作', value: 'friend_visit_me' },
]

const eventLabelMap: Record<string, string> = Object.fromEntries(
  events.filter(e => e.value).map(e => [e.value, e.label]),
)

function getEventLabel(event: string) {
  return eventLabelMap[event] || event
}

const logs = [
  { label: '所有等级', value: '' },
  { label: '普通', value: 'info' },
  { label: '警告', value: 'warn' },
]

const displayName = computed(() => {
  // Try to use nickname from status (game server)
  const gameName = status.value?.status?.name
  if (gameName)
    return gameName

  // Check login status
  if (!status.value?.connection?.connected) {
    const account = accountStore.currentAccount
    return account?.name || account?.nick || '未登录'
  }

  // Fallback to account name (usually ID) or '未命名'
  const account = accountStore.currentAccount
  return account?.name || account?.nick || '未命名'
})

// Exp Rate & Time to Level
const expRate = computed(() => {
  const gain = status.value?.sessionExpGained || 0
  const uptime = status.value?.uptime || 0
  if (!uptime)
    return '0/时'
  const hours = uptime / 3600
  const rate = hours > 0 ? (gain / hours) : 0
  return `${Math.floor(rate)}/时`
})

const timeToLevel = computed(() => {
  const gain = status.value?.sessionExpGained || 0
  const uptime = status.value?.uptime || 0
  const current = status.value?.levelProgress?.current || 0
  const needed = status.value?.levelProgress?.needed || 0

  if (!needed || !uptime || gain <= 0)
    return ''

  const hours = uptime / 3600
  const ratePerHour = hours > 0 ? (gain / hours) : 0
  if (ratePerHour <= 0)
    return ''

  const expNeeded = needed - current
  const minsToLevel = expNeeded / (ratePerHour / 60)

  if (minsToLevel < 60)
    return `约 ${Math.ceil(minsToLevel)} 分钟后升级`
  return `约 ${(minsToLevel / 60).toFixed(1)} 小时后升级`
})

// Fertilizer & Collection
const fertilizerNormal = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 1011))
const fertilizerOrganic = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 1012))
const collectionNormal = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 3001))
const collectionRare = computed(() => dashboardItems.value.find((i: any) => Number(i.id) === 3002))

function formatBucketTime(item: any) {
  if (!item)
    return '0.0h'
  if (item.hoursText)
    return item.hoursText.replace('小时', 'h')
  const count = Number(item.count || 0)
  return `${(count / 3600).toFixed(1)}h`
}

// Next Check Countdown
const nextFarmCheck = ref('--:--:--')
const nextFriendCheck = ref('--:--:--')
const localUptime = ref(0)
let localNextFarmRemainSec = 0
let localNextFriendRemainSec = 0

function updateCountdowns() {
  // Update uptime
  if (!status.value?.connection?.connected) {
    nextFarmCheck.value = '账号未登录'
    nextFriendCheck.value = '账号未登录'
  }
  else {
    localUptime.value++
    if (localNextFarmRemainSec > 0) {
      localNextFarmRemainSec--
      nextFarmCheck.value = formatDuration(localNextFarmRemainSec)
    }
    else {
      nextFarmCheck.value = '巡查中...'
    }

    if (localNextFriendRemainSec > 0) {
      localNextFriendRemainSec--
      nextFriendCheck.value = formatDuration(localNextFriendRemainSec)
    }
    else {
      nextFriendCheck.value = '巡查中...'
    }
  }
}

watch(status, (newVal) => {
  if (newVal?.nextChecks) {
    // Only update local counters if they are significantly different or 0
    // Actually, we should sync from server periodically.
    // Here we just take server value when it comes.
    localNextFarmRemainSec = newVal.nextChecks.farmRemainSec || 0
    localNextFriendRemainSec = newVal.nextChecks.friendRemainSec || 0
    updateCountdowns() // Update immediately
  }
  if (newVal?.uptime !== undefined) {
    localUptime.value = newVal.uptime
  }
}, { deep: true })

function formatDuration(seconds: number) {
  if (seconds <= 0)
    return '00:00:00'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  const pad = (n: number) => n.toString().padStart(2, '0')

  if (d > 0)
    return `${d}天 ${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function getLogTagClass(tag: string) {
  if (tag === '错误')
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  if (tag === '系统')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (tag === '警告')
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
}

function getLogMsgClass(tag: string) {
  if (tag === '错误')
    return 'text-red-600 dark:text-red-400'
  return 'text-gray-700 dark:text-gray-300'
}

function formatLogTime(timeStr: string) {
  // 2024/5/20 12:34:56 -> 12:34:56
  if (!timeStr)
    return ''
  const parts = timeStr.split(' ')
  return parts.length > 1 ? parts[1] : timeStr
}

const OP_META: Record<string, { label: string, icon: string, color: string }> = {
  harvest: { label: '收获', icon: 'i-carbon-crop-growth', color: 'text-green-500' },
  water: { label: '浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-400' },
  weed: { label: '除草', icon: 'i-carbon-cut-out', color: 'text-yellow-500' },
  bug: { label: '除虫', icon: 'i-carbon-warning-alt', color: 'text-red-400' },
  fertilize: { label: '施肥', icon: 'i-carbon-chemistry', color: 'text-emerald-500' },
  plant: { label: '种植', icon: 'i-carbon-tree', color: 'text-lime-500' },
  upgrade: { label: '土地升级', icon: 'i-carbon-upgrade', color: 'text-purple-500' },
  levelUp: { label: '账号升级', icon: 'i-carbon-user-certification', color: 'text-indigo-500' },
  steal: { label: '偷菜', icon: 'i-carbon-run', color: 'text-orange-500' },
  helpWater: { label: '帮浇水', icon: 'i-carbon-rain-drop', color: 'text-blue-300' },
  helpWeed: { label: '帮除草', icon: 'i-carbon-cut-out', color: 'text-yellow-400' },
  helpBug: { label: '帮除虫', icon: 'i-carbon-warning-alt', color: 'text-red-300' },
  taskClaim: { label: '任务', icon: 'i-carbon-task-complete', color: 'text-indigo-500' },
  sell: { label: '出售', icon: 'i-carbon-shopping-cart', color: 'text-pink-500' },
}

function getOpName(key: string | number) {
  return OP_META[String(key)]?.label || String(key)
}

function getOpIcon(key: string | number) {
  return OP_META[String(key)]?.icon || 'i-carbon-circle-dash'
}

function getOpColor(key: string | number) {
  return OP_META[String(key)]?.color || 'text-gray-400'
}

function getExpPercent(p: any) {
  if (!p || !p.needed)
    return 0
  return Math.min(100, Math.max(0, (p.current / p.needed) * 100))
}

async function refreshBag(force = false) {
  if (!currentAccountId.value)
    return
  if (!currentAccount.value?.running)
    return
  if (!status.value?.connection?.connected)
    return

  const now = Date.now()
  if (!force && now - lastBagFetchAt.value < 2500)
    return
  lastBagFetchAt.value = now
  await bagStore.fetchBag(currentAccountId.value)
}

async function refresh() {
  if (!currentAccountId.value)
    return
  const acc = currentAccount.value
  if (!acc)
    return
  try {
    // 首次加载、断线兜底时走 HTTP；连接正常时优先走 WS 实时推送
    if (!realtimeConnected.value) {
      await statusStore.fetchStatus(currentAccountId.value)
      await statusStore.fetchAccountLogs()
    }

    if (hasActiveLogFilter.value || !realtimeConnected.value) {
      await statusStore.fetchLogs(currentAccountId.value, {
        module: filter.module || undefined,
        event: filter.event || undefined,
        keyword: filter.keyword || undefined,
        isWarn: filter.isWarn === 'warn' ? true : filter.isWarn === 'info' ? false : undefined,
      })
    }

    // 仅在账号已运行且连接就绪后拉背包，避免启动阶段触发500
    await refreshBag()
  }
  catch (_e) {
    // 超时/网络等错误已在 axios 拦截器中提示，此处仅避免 Uncaught (in promise)
  }
}

watch(currentAccountId, () => {
  refresh()
})

watch(() => status.value?.connection?.connected, (connected) => {
  if (connected)
    refreshBag(true)
})

// 监听 operations 变化触发背包刷新，用 deep 避免每次 tick 做 JSON.stringify
watch(() => status.value?.operations, () => {
  if (!realtimeConnected.value)
    return
  refreshBag()
}, { deep: true })

watch(hasActiveLogFilter, (enabled) => {
  statusStore.setRealtimeLogsEnabled(!enabled)
  refresh()
})

function onLogScroll(e: Event) {
  const el = e.target as HTMLElement
  if (!el)
    return
  const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  autoScroll.value = isNearBottom
}

// Auto scroll logs：仅根据日志条数变化滚动，避免对整份日志做 deep 监听
watch(() => allLogs.value.length, () => {
  nextTick(() => {
    if (logContainer.value && autoScroll.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
})

onMounted(() => {
  statusStore.setRealtimeLogsEnabled(!hasActiveLogFilter.value)
  refresh()
})

// 页面重新可见时立即刷新（解决手机浏览器切回标签/从后台恢复时状态不更新）
function onPageVisible() {
  if (currentAccountId.value) {
    refresh()
    farmPanelRef.value?.refresh?.()
  }
}
useEventListener(document, 'visibilitychange', () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible')
    onPageVisible()
})
useEventListener(window, 'pageshow', (e: Event) => {
  if ((e as PageTransitionEvent).persisted)
    onPageVisible()
})

// Auto refresh fallback every 10s (WS 断开或筛选条件启用时会回退 HTTP)
useIntervalFn(refresh, 10000)
// Countdown timer (every 1s)；页面不可见时跳过以减轻性能开销
useIntervalFn(() => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    return
  updateCountdowns()
}, 1000)
</script>

<template>
  <div class="flex min-h-0 flex-col gap-6 pt-6 pb-6">
    <!-- Status Cards -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:grid-cols-2">
      <!-- Account & Exp -->
      <div class="flex flex-col card-panel p-4">
        <div class="mb-2 flex items-start justify-between">
          <div class="flex items-center gap-1.5 text-sm text-gray-500">
            <div class="i-fas-user-circle" />
            账号
          </div>
          <div class="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            Lv.{{ status?.status?.level || 0 }}
          </div>
        </div>
        <div class="mb-1 truncate text-xl font-bold" :title="displayName">
          {{ displayName }}
        </div>

        <!-- Level Progress -->
        <div class="mt-auto">
          <div class="mb-1 flex justify-between text-xs text-gray-500">
            <div class="flex items-center gap-1">
              <div class="i-fas-bolt text-blue-400" />
              <span>EXP</span>
            </div>
            <span>{{ status?.levelProgress?.current || 0 }} / {{ status?.levelProgress?.needed || '?' }}</span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              class="h-full rounded-full bg-blue-500 transition-all duration-500"
              :style="{ width: `${getExpPercent(status?.levelProgress)}%` }"
            />
          </div>
          <div class="mt-2 flex justify-between text-xs text-gray-400">
            <span>效率: {{ expRate }}</span>
            <span>{{ timeToLevel }}</span>
          </div>
        </div>
      </div>

      <!-- Assets & Status -->
      <div class="flex flex-col justify-between card-panel p-4">
        <div class="flex justify-between">
          <div>
            <div class="flex items-center gap-1.5 text-xs text-gray-500">
              <div class="i-fas-coins text-yellow-500" />
              金币
            </div>
            <div class="text-2xl text-yellow-600 font-bold dark:text-yellow-500">
              {{ status?.status?.gold || 0 }}
            </div>
            <div
              v-if="(status?.sessionGoldGained || 0) !== 0"
              class="text-[10px]"
              :class="(status?.sessionGoldGained || 0) > 0 ? 'text-green-500' : 'text-red-500'"
            >
              {{ (status?.sessionGoldGained || 0) > 0 ? '+' : '' }}{{ status?.sessionGoldGained || 0 }}
            </div>
          </div>
          <div class="text-right">
            <div class="flex items-center justify-end gap-1.5 text-xs text-gray-500">
              <div class="i-fas-ticket-alt text-emerald-400" />
              点券
            </div>
            <div class="text-2xl text-emerald-500 font-bold dark:text-emerald-400">
              {{ status?.status?.coupon || 0 }}
            </div>
            <div
              v-if="(status?.sessionCouponGained || 0) !== 0"
              class="text-[10px]"
              :class="(status?.sessionCouponGained || 0) > 0 ? 'text-green-500' : 'text-red-500'"
            >
              {{ (status?.sessionCouponGained || 0) > 0 ? '+' : '' }}{{ status?.sessionCouponGained || 0 }}
            </div>
          </div>
        </div>
        <div class="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="h-2.5 w-2.5 rounded-full" :class="status?.connection?.connected ? 'bg-green-500' : 'bg-red-500'" />
              <span class="text-xs font-bold">{{ status?.connection?.connected ? '在线' : '离线' }}</span>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-gray-400">
              <div class="i-fas-clock text-purple-400" />
              {{ formatDuration(localUptime) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Items (Fertilizer & Collection) -->
      <div class="flex flex-col justify-between card-panel p-4">
        <div class="mb-2 flex items-center gap-1.5 text-sm text-gray-500">
          <div class="i-fas-flask text-emerald-400" />
          化肥容器
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <div class="flex items-center gap-1 text-xs text-gray-400">
              <div class="i-fas-flask text-emerald-400" />
              普通
            </div>
            <div class="font-bold">
              {{ formatBucketTime(fertilizerNormal) }}
            </div>
          </div>
          <div>
            <div class="flex items-center gap-1 text-xs text-gray-400">
              <div class="i-fas-vial text-emerald-400" />
              有机
            </div>
            <div class="font-bold">
              {{ formatBucketTime(fertilizerOrganic) }}
            </div>
          </div>
        </div>
        <div class="my-2 border-t border-gray-100 dark:border-gray-700" />
        <div class="mb-1 flex items-center gap-1.5 text-sm text-gray-500">
          <div class="i-fas-star text-emerald-400" />
          收藏点
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <div class="flex items-center gap-1 text-xs text-gray-400">
              <div class="i-fas-bookmark text-emerald-400" />
              普通
            </div>
            <div class="font-bold">
              {{ collectionNormal?.count || 0 }}
            </div>
          </div>
          <div>
            <div class="flex items-center gap-1 text-xs text-gray-400">
              <div class="i-fas-gem text-emerald-400" />
              典藏
            </div>
            <div class="font-bold">
              {{ collectionRare?.count || 0 }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 首页主内容：我的农场/好友互动/功能设置 -->
    <div class="flex flex-col gap-6">
      <section class="min-w-0 flex-1 card-panel">
        <div class="flex items-center justify-between card-panel-header px-4">
          <div class="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            <button
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="farmTab === 'mine' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
              @click="farmTab = 'mine'"
            >
              <div class="i-carbon-sprout text-green-500" />
              我的农场
            </button>
            <button
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="farmTab === 'friends' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
              @click="farmTab = 'friends'"
            >
              <div class="i-carbon-user-multiple text-blue-500" />
              好友互动
            </button>
            <button
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="farmTab === 'settings' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
              @click="farmTab = 'settings'"
            >
              <div class="i-carbon-settings text-amber-500" />
              功能设置
            </button>
          </div>
          <button
            v-if="farmTab === 'mine'"
            type="button"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-green-200 bg-green-50 text-green-600 transition hover:bg-green-100 disabled:opacity-50 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
            :title="mineSubTab === 'farm' ? '刷新土地' : mineSubTab === 'bag' ? '刷新背包' : '刷新任务'"
            :disabled="mineRefreshLoading"
            @click="throttledRefreshMineCurrent"
          >
            <div class="i-carbon-renew text-lg" :class="mineRefreshLoading ? 'animate-spin' : ''" />
          </button>
        </div>

        <!-- 我的农场：土地详情 / 我的背包 / 我的任务 -->
        <div v-if="farmTab === 'mine'" class="p-4">
          <div class="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="mineSubTab === 'farm' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
              @click="mineSubTab = 'farm'"
            >
              土地详情
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="mineSubTab === 'bag' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
              @click="mineSubTab = 'bag'"
            >
              我的背包
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="mineSubTab === 'task' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
              @click="mineSubTab = 'task'"
            >
              我的任务
            </button>
          </div>
          <div v-if="mineSubTab === 'farm'" class="min-h-[200px]">
            <FarmPanel ref="farmPanelRef" />
          </div>
          <div v-else-if="mineSubTab === 'bag'" class="max-h-[560px] overflow-y-auto">
            <BagPanel ref="bagPanelRef" />
          </div>
          <div v-else-if="mineSubTab === 'task'">
            <TaskPanel ref="taskPanelRef" />
          </div>
        </div>

        <!-- 功能设置：自动设置 / 作物偷取设置 -->
        <div v-if="farmTab === 'settings'" class="p-4">
          <div class="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="settingsSubTab === 'auto' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
              @click="settingsSubTab = 'auto'"
            >
              自动设置
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="settingsSubTab === 'cropSteal' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
              @click="settingsSubTab = 'cropSteal'"
            >
              作物偷取设置
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="settingsSubTab === 'strategy' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
              @click="settingsSubTab = 'strategy'"
            >
              策略设置
            </button>
          </div>
          <div v-if="settingsSubTab === 'auto'" class="min-h-[320px] overflow-y-auto">
            <Settings embedded />
          </div>
          <div v-else-if="settingsSubTab === 'cropSteal'" class="min-h-[320px] overflow-y-auto">
            <CropStealSettings embedded />
          </div>
          <div v-else-if="settingsSubTab === 'strategy'" class="min-h-[320px] overflow-y-auto">
            <StrategySettings embedded />
          </div>
        </div>

        <!-- 好友互动：好友列表（点击展开作物与时间表）/ 已封禁 -->
        <div v-if="farmTab === 'friends'" class="p-4">
          <div class="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="friendSubTab === 'list' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
              @click="friendSubTab = 'list'"
            >
              好友列表
              <span v-if="friendsTotal > 0" class="ml-1 text-xs text-gray-400">({{ friendsTotal }})</span>
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              :class="friendSubTab === 'banned' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
              @click="friendSubTab = 'banned'"
            >
              已封禁
              <span v-if="farmBannedList.length > 0" class="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-400">{{ farmBannedList.length }}</span>
            </button>
          </div>

          <!-- 子 tab：好友列表（点击好友展开其作物与时间表信息） -->
          <template v-if="friendSubTab === 'list'">
            <div v-if="!currentAccountId" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-gray-50 p-12 text-center text-gray-500 dark:bg-gray-900/50">
              <div class="i-carbon-user-multiple text-4xl text-gray-400" />
              <div>请选择账号后查看好友</div>
            </div>
            <div v-else-if="!status?.connection?.connected" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-gray-50 p-12 text-center text-gray-500 dark:bg-gray-900/50">
              <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
              <div class="text-lg font-medium text-gray-700 dark:text-gray-300">账号未登录</div>
              <div class="mt-1 text-sm text-gray-400">请先运行账号或检查网络连接</div>
            </div>
            <div v-else-if="friendListLoading" class="flex justify-center py-12">
              <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
            </div>
            <div v-else-if="(friends || []).length === 0" class="flex flex-col items-center justify-center gap-3 rounded-lg bg-gray-50 py-16 text-center dark:bg-gray-900/50">
              <div class="i-carbon-user-multiple text-4xl text-gray-300" />
              <div class="text-gray-500">暂无好友或数据加载失败</div>
            </div>
            <div v-else class="space-y-4">
              <div class="mb-3 flex flex-wrap items-center gap-3">
                <BaseInput
                  v-model="friendSearchKeyword"
                  placeholder="按好友名字检索（当前页）"
                  class="w-40 sm:w-48"
                  clearable
                />
                <span class="text-sm text-gray-500">共 {{ friendsTotal }} 名好友 · 第 {{ friendListPage }} / {{ totalFriendPages }} 页</span>
                <button
                  type="button"
                  class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                  @click="toggleSelectAllFriendSchedule"
                >
                  {{ selectedFriendGids.size >= filteredListFriends.length ? '取消全选' : '全选当前页' }}
                </button>
                <span v-if="friendScheduleSelectionCount > 0" class="text-xs text-gray-500">已选 {{ friendScheduleSelectionCount }} 人</span>
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!hasSelectedFriendSchedule || friendScheduleBatchLoading"
                  title="对勾选的好友执行浇水、除草、除虫"
                  @click="batchFriendHelp"
                >
                  <div class="i-carbon-clean text-base" />
                  {{ friendScheduleBatchLoading ? '执行中…' : '一键帮助' }}
                </button>
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-sm text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!hasSelectedFriendSchedule || friendScheduleBatchLoading"
                  title="对勾选的好友执行偷取"
                  @click="batchFriendSteal"
                >
                  <div class="i-carbon-wheat text-base" />
                  {{ friendScheduleBatchLoading ? '执行中…' : '一键偷取' }}
                </button>
              </div>
              <p class="mb-2 text-xs text-gray-400">点击某行展开该好友的作物与时间表信息（按需加载，节省性能）</p>
              <div
                v-for="friend in filteredListFriends"
                :key="friend.gid"
                class="overflow-hidden rounded-lg border border-gray-200 transition-shadow dark:border-gray-700"
              >
                <div
                  class="flex cursor-pointer flex-col justify-between gap-4 p-4 transition sm:flex-row sm:items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  :class="blacklist.includes(Number(friend.gid)) ? 'opacity-60' : ''"
                  @click="toggleListFriend(String(friend.gid))"
                >
                  <div class="flex items-center gap-3">
                    <label class="flex shrink-0 cursor-pointer items-center" @click.stop>
                      <input
                        type="checkbox"
                        class="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:checked:bg-teal-600"
                        :checked="selectedFriendGids.has(friend.gid)"
                        @change="toggleFriendScheduleSelect(friend.gid)"
                      >
                    </label>
                    <div class="h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-1 ring-gray-100 dark:bg-gray-600 dark:ring-gray-700">
                      <img
                        v-if="canShowFriendAvatar(friend)"
                        :src="getFriendAvatar(friend)"
                        class="h-full w-full object-cover"
                        decoding="async"
                        @error="handleFriendAvatarError(friend)"
                      >
                      <div v-else class="i-carbon-user text-gray-400" />
                    </div>
                    <div>
                      <div class="flex items-center gap-2 font-bold">
                        {{ friend.name }}
                        <span v-if="friend.farmLevel != null && friend.farmLevel > 0" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Lv.{{ friend.farmLevel }}</span>
                        <span v-if="blacklist.includes(Number(friend.gid))" class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">已屏蔽</span>
                      </div>
                      <div class="text-sm" :class="getFriendStatusText(friend) !== '无操作' ? 'font-medium text-green-500' : 'text-gray-400'">
                        {{ getFriendStatusText(friend) }}
                      </div>
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2" @click.stop>
                    <button class="rounded bg-blue-100 px-3 py-2 text-sm text-blue-700 transition hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300" @click="handleListFriendOp(String(friend.gid), 'steal', $event)">偷取</button>
                    <button class="rounded bg-cyan-100 px-3 py-2 text-sm text-cyan-700 transition hover:bg-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300" @click="handleListFriendOp(String(friend.gid), 'water', $event)">浇水</button>
                    <button class="rounded bg-green-100 px-3 py-2 text-sm text-green-700 transition hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300" @click="handleListFriendOp(String(friend.gid), 'weed', $event)">除草</button>
                    <button class="rounded bg-orange-100 px-3 py-2 text-sm text-orange-700 transition hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300" @click="handleListFriendOp(String(friend.gid), 'bug', $event)">除虫</button>
                    <button class="rounded bg-red-100 px-3 py-2 text-sm text-red-700 transition hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300" @click="handleListFriendOp(String(friend.gid), 'bad', $event)">捣乱</button>
                    <button
                      class="rounded px-3 py-2 text-sm transition"
                      :class="blacklist.includes(Number(friend.gid)) ? 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700/50 dark:text-gray-400'"
                      @click="handleToggleBlacklist(friend, $event)"
                    >
                      {{ blacklist.includes(Number(friend.gid)) ? '移出黑名单' : '加入黑名单' }}
                    </button>
                  </div>
                </div>
                <div v-if="expandedListFriendIds.has(String(friend.gid))" class="border-t border-gray-100 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                  <div v-if="friendLandsLoading[friend.gid]" class="flex justify-center py-4">
                    <div class="i-svg-spinners-90-ring-with-bg text-2xl text-blue-500" />
                  </div>
                  <div v-else-if="!friendLands[friend.gid]?.length" class="py-4 text-center text-gray-500">无土地数据</div>
                  <div v-else class="space-y-3">
                    <div class="flex flex-wrap items-center gap-3 rounded-lg bg-white/80 px-3 py-2 text-sm dark:bg-gray-800/50">
                      <span class="font-medium text-gray-700 dark:text-gray-300">时间表</span>
                      <span class="text-gray-500">共 {{ getFriendLandsScheduleSummary(friend.gid).total }} 块地</span>
                      <span class="text-orange-600 dark:text-orange-400">已成熟 {{ getFriendLandsScheduleSummary(friend.gid).due }} 块</span>
                      <span class="text-green-600 dark:text-green-400">成长中 {{ getFriendLandsScheduleSummary(friend.gid).waiting }} 块</span>
                      <span v-if="getFriendLandsScheduleSummary(friend.gid).earliestRemain != null" class="text-blue-600 font-mono dark:text-blue-400">最早 {{ formatFriendRemain(getFriendLandsScheduleSummary(friend.gid).earliestRemain!) }} 后成熟</span>
                      <span v-else-if="getFriendLandsScheduleSummary(friend.gid).due > 0" class="text-amber-600 dark:text-amber-400">可偷取/帮助</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                      <LandCard
                        v-for="land in friendLands[friend.gid]"
                        :key="land.id"
                        :land="land"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                  :disabled="friendListPage <= 1"
                  @click="goToFriendPage(friendListPage - 1)"
                >
                  上一页
                </button>
                <span class="px-2 text-sm text-gray-500">第 {{ friendListPage }} / {{ totalFriendPages }} 页</span>
                <button
                  type="button"
                  class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                  :disabled="friendListPage >= totalFriendPages"
                  @click="goToFriendPage(friendListPage + 1)"
                >
                  下一页
                </button>
              </div>
            </div>
          </template>

          <!-- 子 tab：已封禁 -->
          <template v-else-if="friendSubTab === 'banned'">
            <div v-if="!currentAccountId" class="flex flex-col items-center justify-center gap-4 rounded-lg bg-gray-50 p-12 text-center text-gray-500 dark:bg-gray-900/50">
              <div class="i-carbon-security text-4xl text-gray-400" />
              <div>请选择账号后查看封禁名单</div>
            </div>
            <div v-else-if="farmBannedLoading" class="flex justify-center py-12">
              <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
            </div>
            <div v-else-if="farmBannedList.length === 0" class="flex flex-col items-center justify-center gap-3 rounded-lg bg-gray-50 py-16 text-center dark:bg-gray-900/50">
              <div class="i-carbon-security text-4xl text-gray-300" />
              <p class="text-gray-500">暂无农场封禁名单</p>
              <p class="mt-1 text-sm text-gray-400">访问或操作好友时若提示账号封禁，将自动加入此名单，脚本将不再对其巡田</p>
            </div>
            <div v-else class="space-y-4">
              <div class="flex flex-wrap items-center gap-3">
                <BaseInput
                  v-model="bannedSearchKeyword"
                  placeholder="搜索昵称或 GID"
                  class="w-40 sm:w-48"
                  clearable
                />
                <span class="text-sm text-gray-500">共 {{ filteredFarmBanned.length }}{{ bannedSearchKeyword.trim() ? ` / ${farmBannedList.length}` : '' }} 人</span>
              </div>
              <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <div class="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
                  以下好友在访问/操作时曾提示封禁，已自动加入名单；移出后脚本将恢复对其巡田
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[320px] text-left text-sm">
                    <thead class="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
                      <tr>
                        <th class="px-4 py-3 font-medium">GID</th>
                        <th class="px-4 py-3 font-medium">昵称</th>
                        <th class="px-4 py-3 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                      <tr
                        v-for="item in filteredFarmBanned"
                        :key="item.gid"
                        class="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                      >
                        <td class="px-4 py-3 font-mono text-gray-600 dark:text-gray-400">{{ item.gid }}</td>
                        <td class="px-4 py-3 text-gray-800 dark:text-gray-200">{{ item.friendName || '—' }}</td>
                        <td class="px-4 py-3 text-right">
                          <button
                            type="button"
                            class="rounded bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 transition hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
                            @click="handleRemoveFromFarmBanned(item)"
                          >
                            移出封禁
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="filteredFarmBanned.length === 0 && bannedSearchKeyword.trim()" class="p-4 text-center text-sm text-gray-500">未找到匹配的封禁记录</div>
              </div>
            </div>
          </template>
        </div>
      </section>
    </div>

    <!-- Main Content Flex -->
    <div class="flex flex-col items-stretch gap-6 md:flex-row">
      <!-- Logs (Left Column) -->
      <div class="flex flex-col gap-6 md:w-3/4">
        <!-- Logs with Tabs -->
        <div class="flex flex-col card-panel p-6">
          <!-- Tab Header -->
          <div class="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              <button
                class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                :class="logTab === 'runtime' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
                @click="logTab = 'runtime'"
              >
                <div class="i-carbon-document" />
                运行日志
              </button>
              <button
                class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                :class="logTab === 'friend' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
                @click="logTab = 'friend'"
              >
                <div class="i-carbon-user-multiple" />
                好友对我的操作
              </button>
            </div>

            <!-- Runtime log filters (only visible when runtime tab is active) -->
            <div v-if="logTab === 'runtime'" class="flex flex-wrap items-center gap-2 text-sm">
              <BaseSelect
                v-model="filter.module"
                :options="modules"
                class="w-32"
                @change="refresh"
              />

              <BaseSelect
                v-model="filter.event"
                :options="events"
                class="w-32"
                @change="refresh"
              />

              <BaseSelect
                v-model="filter.isWarn"
                :options="logs"
                class="w-32"
                @change="refresh"
              />

              <BaseInput
                v-model="filter.keyword"
                placeholder="关键词..."
                class="w-32"
                clearable
                @keyup.enter="refresh"
                @clear="refresh"
              />

              <BaseButton
                variant="primary"
                size="sm"
                @click="refresh"
              >
                <div class="i-carbon-search" />
              </BaseButton>

              <BaseButton
                variant="outline"
                size="sm"
                class="border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
                @click="statusStore.clearLogs()"
              >
                <div class="i-carbon-trash-can" />
                清空日志
              </BaseButton>
            </div>
          </div>

          <!-- Runtime Logs Panel -->
          <div v-if="logTab === 'runtime'" ref="logContainer" class="max-h-[420px] min-h-[200px] overflow-y-auto rounded bg-gray-50 p-4 text-sm leading-relaxed font-mono dark:bg-gray-900" @scroll="onLogScroll">
            <div v-if="!allLogs.length" class="py-8 text-center text-gray-400">
              暂无日志
            </div>
            <div v-for="log in allLogs" :key="log.ts + log.msg" class="mb-1 break-all">
              <span class="mr-2 select-none text-gray-400">[{{ formatLogTime(log.time) }}]</span>
              <span class="mr-2 rounded px-1.5 py-0.5 text-xs font-bold" :class="getLogTagClass(log.tag)">{{ log.tag }}</span>
              <span v-if="log.meta?.event" class="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-500 dark:bg-blue-900/20 dark:text-blue-400">{{ getEventLabel(log.meta.event) }}</span>
              <span :class="getLogMsgClass(log.tag)">{{ log.msg }}</span>
            </div>
          </div>

          <!-- Friend Visit Logs Panel -->
          <div v-if="logTab === 'friend'" class="max-h-[420px] min-h-[200px] overflow-y-auto rounded bg-gray-50 dark:bg-gray-900">
            <div v-if="!friendVisitLogs.length" class="py-8 text-center text-gray-400">
              暂无好友对你的操作记录（好友偷取/帮忙等会在此显示）
            </div>
            <table v-else class="w-full min-w-[640px] text-left text-sm">
              <thead class="sticky top-0 z-10 border-b border-gray-200 bg-gray-100 text-xs text-gray-500 uppercase dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                <tr>
                  <th class="px-4 py-3 font-medium">时间</th>
                  <th class="px-4 py-3 font-medium">好友</th>
                  <th class="px-4 py-3 font-medium">操作</th>
                  <th class="px-4 py-3 font-medium">作物</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                <tr v-for="(log, idx) in friendVisitLogs" :key="idx" class="transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/30">
                  <td class="whitespace-nowrap px-4 py-2.5 text-gray-500 font-mono dark:text-gray-400">
                    {{ formatLogTime(log.time) }}
                  </td>
                  <td class="px-4 py-2.5">
                    <div class="flex items-center gap-2">
                      <div class="i-carbon-user text-gray-400" />
                      <span class="font-medium text-gray-700 dark:text-gray-200">{{ log.friendName }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-2.5">
                    <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold" :class="getFriendActionMeta(log.action).tagClass">
                      <div :class="getFriendActionMeta(log.action).icon" />
                      {{ log.action }}
                    </span>
                  </td>
                  <td class="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                    {{ log.crop || '-' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Right Column Stack -->
      <div class="flex flex-col gap-6 md:w-1/4">
        <!-- Next Checks -->
        <div class="flex flex-col card-panel p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-medium">
            <div class="i-carbon-hourglass" />
            <span>下次巡查倒计时</span>
          </h3>
          <div class="flex flex-col justify-center gap-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <div class="i-carbon-sprout text-lg text-green-500" />
                <span>农场</span>
              </div>
              <div class="text-lg font-bold font-mono">
                {{ nextFarmCheck }}
              </div>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <div class="i-carbon-user-multiple text-lg text-blue-500" />
                <span>好友</span>
              </div>
              <div class="text-lg font-bold font-mono">
                {{ nextFriendCheck }}
              </div>
            </div>
          </div>
        </div>

        <!-- Operations Grid -->
        <div class="card-panel p-4">
          <h3 class="mb-3 flex items-center gap-2 text-lg font-medium">
            <div class="i-carbon-chart-column" />
            <span>今日统计</span>
          </h3>
          <div v-if="!status?.connection?.connected" class="flex flex-col items-center justify-center gap-4 card-panel p-12 text-center text-gray-500">
            <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
            <div class="flex flex-col">
              <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
                账号未登录
              </div>
              <div class="mt-1 text-sm text-gray-400">
                请先运行账号或检查网络连接
              </div>
            </div>
          </div>
          <div v-else class="grid grid-cols-2 gap-2 2xl:gap-3">
            <div
              v-for="(val, key) in (status?.operations || {})"
              :key="key"
              class="flex items-center justify-between rounded bg-gray-50 px-3 py-2 dark:bg-gray-700/30"
            >
              <div class="flex items-center gap-2">
                <div class="text-base 2xl:text-lg" :class="[getOpIcon(key), getOpColor(key)]" />
                <div class="text-xs text-gray-500 2xl:text-sm">
                  {{ getOpName(key) }}
                </div>
              </div>
              <div class="text-sm font-bold 2xl:text-base">
                {{ val }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 好友操作确认弹窗 -->
    <ConfirmModal
      :show="showFriendConfirm"
      :loading="friendConfirmLoading"
      title="确认操作"
      :message="friendConfirmMessage"
      @confirm="onFriendConfirm"
      @cancel="!friendConfirmLoading && (showFriendConfirm = false)"
    />
  </div>
</template>

