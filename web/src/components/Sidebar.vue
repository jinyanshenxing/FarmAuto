<script setup lang="ts">
import { useDateFormat, useIntervalFn, useNow, useStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import AccountModal from '@/components/AccountModal.vue'
import HelpGuideModal from '@/components/HelpGuideModal.vue'
import RemarkModal from '@/components/RemarkModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

import { menuRoutes } from '@/router/menu'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useAppStore, COLOR_THEMES } from '@/stores/app'
import { useSettingStore } from '@/stores/setting'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const settingStore = useSettingStore()
const toast = useToastStore()
const statusStore = useStatusStore()
const appStore = useAppStore()
const route = useRoute()
const router = useRouter()
const adminToken = useStorage('admin_token', '')
const { accounts, currentAccount } = storeToRefs(accountStore)
const { status, realtimeConnected, currentRealtimeAccountId } = storeToRefs(statusStore)
const { sidebarOpen, userRole, userName, colorTheme, customBackgroundUrl } = storeToRefs(appStore)

const showAccountDropdown = ref(false)
const showUserMenuPopover = ref(false)
const showAccountModal = ref(false)
const showRemarkModal = ref(false)
const showPasswordModal = ref(false)
const showHelpModal = ref(false)
const showOfflineReminderModal = ref(false)
const showThemeModal = ref(false)
const themeBgFileInput = ref<HTMLInputElement | null>(null)
const themeBgUploading = ref(false)
const showUsedCardsPopover = ref(false)
const usedCardsPopoverTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const myUsedCards = ref<Array<{
  code: string
  typeLabel?: string
  used: boolean
  boundAccountName: string | null
  boundAccountUin: string | null
  usedAt: number | null
  claimedByUsername?: string | null
}>>([])
const myUsedCardsLoading = ref(false)
const accountToEdit = ref<any>(null)
const wsErrorNotifiedAt = ref<Record<string, number>>({})
const freeClaimRemaining = ref(0)
const freeClaimLoading = ref(false)

const passwordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const passwordError = ref('')
const passwordLoading = ref(false)

const offlineSaving = ref(false)
const localOffline = ref({
  channel: 'webhook',
  reloginUrlMode: 'none',
  endpoint: '',
  token: '',
  title: '',
  msg: '',
  offlineDeleteSec: 120,
})

const OFFLINE_CHANNEL_OPTIONS = [
  { label: 'Webhook(自定义接口)', value: 'webhook' },
  { label: 'Qmsg 酱', value: 'qmsg' },
  { label: 'Server 酱', value: 'serverchan' },
  { label: 'PushPlus', value: 'pushplus' },
  { label: 'PushPlus 互享', value: 'pushplushxtrip' },
  { label: '钉钉', value: 'dingtalk' },
  { label: '企业微信', value: 'wecom' },
  { label: 'Bark', value: 'bark' },
  { label: 'Go-cqhttp', value: 'gocqhttp' },
  { label: 'OneBot', value: 'onebot' },
  { label: 'Atri', value: 'atri' },
  { label: 'PushDeer', value: 'pushdeer' },
  { label: 'iGot', value: 'igot' },
  { label: 'Telegram', value: 'telegram' },
  { label: '飞书', value: 'feishu' },
  { label: 'IFTTT', value: 'ifttt' },
  { label: '企业微信群机器人', value: 'wecombot' },
  { label: 'Discord', value: 'discord' },
  { label: 'WxPusher', value: 'wxpusher' },
]
const OFFLINE_RELOGIN_OPTIONS = [
  { label: '不需要', value: 'none' },
  { label: 'QQ直链', value: 'qq_link' },
  { label: '二维码链接', value: 'qr_link' },
]
const OFFLINE_CHANNEL_DOCS: Record<string, string> = {
  webhook: '',
  qmsg: 'https://qmsg.zendee.cn/',
  serverchan: 'https://sct.ftqq.com/',
  pushplus: 'https://www.pushplus.plus/',
  pushplushxtrip: 'https://pushplus.hxtrip.com/',
  dingtalk: 'https://open.dingtalk.com/document/group/custom-robot-access',
  wecom: 'https://guole.fun/posts/626/',
  wecombot: 'https://developer.work.weixin.qq.com/document/path/91770',
  bark: 'https://github.com/Finb/Bark',
  gocqhttp: 'https://docs.go-cqhttp.org/api/',
  onebot: 'https://docs.go-cqhttp.org/api/',
  atri: 'https://blog.tianli0.top/',
  pushdeer: 'https://www.pushdeer.com/',
  igot: 'https://push.hellyw.com/',
  telegram: 'https://core.telegram.org/bots',
  feishu: 'https://www.feishu.cn/hc/zh-CN/articles/360024984973',
  ifttt: 'https://ifttt.com/maker_webhooks',
  discord: 'https://discord.com/developers/docs/resources/webhook#execute-webhook',
  wxpusher: 'https://wxpusher.zjiecode.com/docs/#/',
}

const offlineChannelDocUrl = computed(() => {
  const key = String(localOffline.value.channel || '').trim().toLowerCase()
  return OFFLINE_CHANNEL_DOCS[key] || ''
})

function openOfflineChannelDocs() {
  const url = offlineChannelDocUrl.value
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}

async function triggerThemeBgInput() {
  themeBgFileInput.value?.click()
}

function onThemeBgFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  themeBgUploading.value = true
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result as string
    if (dataUrl) appStore.setCustomBackground(dataUrl)
    themeBgUploading.value = false
    input.value = ''
  }
  reader.onerror = () => {
    themeBgUploading.value = false
    input.value = ''
  }
  reader.readAsDataURL(file)
}

function clearThemeBg() {
  appStore.setCustomBackground('')
  const el = themeBgFileInput.value
  if (el) el.value = ''
}

async function openOfflineReminderModal() {
  if (currentAccount.value?.id) {
    await settingStore.fetchSettings(currentAccount.value.id)
  }
  if (settingStore.settings?.offlineReminder) {
    localOffline.value = { ...settingStore.settings.offlineReminder }
  } else {
    localOffline.value = {
      channel: 'webhook',
      reloginUrlMode: 'none',
      endpoint: '',
      token: '',
      title: '账号下线提醒',
      msg: '账号下线',
      offlineDeleteSec: 120,
    }
  }
  showOfflineReminderModal.value = true
}

async function saveOfflineReminder() {
  offlineSaving.value = true
  try {
    const res = await settingStore.saveOfflineConfig(localOffline.value)
    if (res.ok) {
      toast.success('下线提醒设置已保存')
      showOfflineReminderModal.value = false
    } else {
      toast.error(res.error || '保存失败')
    }
  } finally {
    offlineSaving.value = false
  }
}

const roleLabel = computed(() => (userRole.value === 'admin' ? '管理员' : '普通用户'))

async function handleChangePassword() {
  passwordError.value = ''
  const { oldPassword, newPassword, confirmPassword } = passwordForm.value
  if (!oldPassword) {
    passwordError.value = '请输入原密码'
    return
  }
  if (!newPassword || newPassword.length < 4) {
    passwordError.value = '新密码至少 4 位'
    return
  }
  if (newPassword !== confirmPassword) {
    passwordError.value = '两次输入的新密码不一致'
    return
  }
  passwordLoading.value = true
  try {
    const res = await api.post('/api/admin/change-password', {
      oldPassword,
      newPassword,
    })
    if (res.data?.ok) {
      showPasswordModal.value = false
      passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
    } else {
      passwordError.value = res.data?.error || '修改失败'
    }
  } catch (e: any) {
    passwordError.value = e.response?.data?.error || e.message || '修改失败'
  } finally {
    passwordLoading.value = false
  }
}

function openPasswordModal() {
  passwordError.value = ''
  passwordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
  showPasswordModal.value = true
}

function formatUsedAt(ts: number | null | undefined) {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString('zh-CN')
}

/** 免费永久卡与网站登录用户关联，与是否添加 QQ 账号无关 */
async function fetchFreeClaimQuota() {
  if (!userName.value) {
    freeClaimRemaining.value = 0
    return
  }
  try {
    const res = await api.get<{ ok: boolean; data?: { limit: number; remainingClaims: number } }>('/api/cards/free-claim-quota')
    if (res.data?.ok && res.data?.data) {
      freeClaimRemaining.value = res.data.data.remainingClaims ?? 0
    } else {
      freeClaimRemaining.value = 0
    }
  } catch {
    freeClaimRemaining.value = 0
  }
}

async function claimFreeCard() {
  if (!userName.value || freeClaimLoading.value || freeClaimRemaining.value <= 0)
    return
  freeClaimLoading.value = true
  try {
    const res = await api.post<{ ok: boolean; data?: { card: { code: string }; remainingClaims: number }; error?: string }>('/api/cards/claim-free')
    if (res.data?.ok && res.data?.data) {
      const { card, remainingClaims } = res.data.data
      freeClaimRemaining.value = remainingClaims
      await fetchMyUsedCards()
      toast.success(`领取成功！永久卡密：${card?.code ?? ''}（还可领 ${remainingClaims} 次）`)
    } else {
      toast.error(res.data?.error || '领取失败')
    }
  } catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '领取失败')
  } finally {
    freeClaimLoading.value = false
  }
}

async function fetchMyUsedCards() {
  myUsedCardsLoading.value = true
  try {
    const res = await api.get<{ ok: boolean; data?: Array<{
      code: string
      type?: string
      typeLabel?: string
      used?: boolean
      boundAccountName?: string | null
      boundAccountUin?: string | null
      usedAt?: number | null
      claimedByUsername?: string | null
    }> }>('/api/cards/my-used')
    if (res.data?.ok && Array.isArray(res.data.data)) {
      myUsedCards.value = res.data.data.map((item: any) => ({
        code: item.code || '',
        typeLabel: item.typeLabel || item.type || '',
        used: item.used === true,
        boundAccountName: item.boundAccountName ?? item.boundAccountId ?? null,
        boundAccountUin: item.boundAccountUin ?? null,
        usedAt: item.usedAt != null ? item.usedAt : null,
        claimedByUsername: item.claimedByUsername ?? null,
      }))
    } else {
      myUsedCards.value = []
    }
  } catch {
    myUsedCards.value = []
  } finally {
    myUsedCardsLoading.value = false
  }
}

function showUsedCardsPopoverDelayed() {
  if (usedCardsPopoverTimer.value) {
    clearTimeout(usedCardsPopoverTimer.value)
    usedCardsPopoverTimer.value = null
  }
  usedCardsPopoverTimer.value = setTimeout(() => {
    showUsedCardsPopover.value = true
    fetchMyUsedCards()
    usedCardsPopoverTimer.value = null
  }, 300)
}

function hideUsedCardsPopoverDelayed() {
  if (usedCardsPopoverTimer.value) {
    clearTimeout(usedCardsPopoverTimer.value)
    usedCardsPopoverTimer.value = null
  }
  usedCardsPopoverTimer.value = setTimeout(() => {
    showUsedCardsPopover.value = false
    usedCardsPopoverTimer.value = null
  }, 200)
}

function cancelUsedCardsPopoverTimer() {
  if (usedCardsPopoverTimer.value) {
    clearTimeout(usedCardsPopoverTimer.value)
    usedCardsPopoverTimer.value = null
  }
}

function copyCardCode(code: string | undefined | null) {
  const text = String(code ?? '').trim()
  if (!text) {
    toast.warning('卡密为空，无法复制')
    return
  }
  const doCopy = (): boolean => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(() => {
          toast.success('卡密已复制')
        }).catch(() => {
          fallbackCopy(text)
        })
        return true
      }
    } catch {
      // clipboard API 不可用或报错，走降级
    }
    return fallbackCopy(text)
  }
  const fallbackCopy = (str: string): boolean => {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = str
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (ok) toast.success('卡密已复制')
      else toast.error('复制失败')
      return ok
    } catch {
      toast.error('复制失败，请检查浏览器权限或使用 HTTPS')
      return false
    }
  }
  doCopy()
}

async function handleLogout() {
  try {
    await api.post('/api/logout')
  } catch {
    // 忽略错误，本地仍会清除
  }
  adminToken.value = ''
  appStore.setUser('', '')
  router.push('/login')
}

const systemConnected = ref(true)
const serverUptimeBase = ref(0)
const serverVersion = ref('')
const lastPingTime = ref(Date.now())
const now = useNow()
const formattedTime = useDateFormat(now, 'YYYY-MM-DD HH:mm:ss')

async function checkConnection() {
  try {
    const res = await api.get('/api/ping')
    systemConnected.value = true
    if (res.data.ok && res.data.data) {
      if (res.data.data.uptime) {
        serverUptimeBase.value = res.data.data.uptime
        lastPingTime.value = Date.now()
      }
      if (res.data.data.version) {
        serverVersion.value = res.data.data.version
      }
    }
    const accountRef = currentAccount.value?.id || currentAccount.value?.uin
    if (accountRef) {
      statusStore.connectRealtime(String(accountRef))
    }
  }
  catch {
    systemConnected.value = false
  }
}

async function refreshStatusFallback() {
  if (realtimeConnected.value)
    return

  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  if (accountRef) {
    await statusStore.fetchStatus(String(accountRef))
  }
}

async function handleAccountSaved() {
  await accountStore.fetchAccounts()
  await refreshStatusFallback()
  showAccountModal.value = false
  showRemarkModal.value = false
}

function openRemarkModal(acc: any) {
  accountToEdit.value = acc
  showRemarkModal.value = true
  showAccountDropdown.value = false
}

onMounted(() => {
  accountStore.fetchAccounts()
  checkConnection()
})

onBeforeUnmount(() => {
  statusStore.disconnectRealtime()
})

const platform = computed(() => getPlatformLabel(currentAccount.value?.platform))

useIntervalFn(checkConnection, 30000)
useIntervalFn(() => {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  refreshStatusFallback()
  accountStore.fetchAccounts()
}, 30000)

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', () => {
  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  const id = String(accountRef || '')
  statusStore.connectRealtime(id)
  fetchFreeClaimQuota()
  // 状态由 WebSocket 推送或 connectRealtime 内 1.5s 后备请求拉取，避免刷新/登录时重复请求
}, { immediate: true })

// 免费永久卡与网站登录用户关联：登录后拉取领取额度
watch(userName, (name) => {
  if (name) fetchFreeClaimQuota()
}, { immediate: true })

watch(() => status.value?.wsError, (wsError: any) => {
  if (!wsError || Number(wsError.code) !== 400 || !currentAccount.value)
    return

  const accId = String(currentAccount.value.id || currentAccount.value.uin || '')
  if (currentRealtimeAccountId.value && accId && currentRealtimeAccountId.value !== accId)
    return

  const errAt = Number(wsError.at) || 0
  const lastNotified = wsErrorNotifiedAt.value[accId] || 0
  if (errAt <= lastNotified)
    return

  wsErrorNotifiedAt.value[accId] = errAt
  accountToEdit.value = currentAccount.value
  showAccountModal.value = true
}, { deep: true })

const uptime = computed(() => {
  const diff = Math.floor(serverUptimeBase.value + (now.value.getTime() - lastPingTime.value) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})

const displayName = computed(() => {
  const acc = currentAccount.value
  if (!acc)
    return '选择账号'

  // 1. 优先显示实时状态中的昵称 (如果有且不是未登录)
  const liveName = status.value?.status?.name
  if (liveName && liveName !== '未登录') {
    return liveName
  }

  // 2. 其次显示账号存储的备注名称 (name)
  if (acc.name)
    return acc.name

  // 3. 显示同步的昵称 (nick)
  if (acc.nick)
    return acc.nick

  // 4. 最后显示UIN
  return acc.uin
})

const connectionStatus = computed(() => {
  if (!systemConnected.value) {
    return {
      text: '系统离线',
      color: 'bg-red-500',
      pulse: false,
    }
  }

  if (!currentAccount.value?.id) {
    return {
      text: '请添加账号',
      color: 'bg-gray-400',
      pulse: false,
    }
  }

  const isConnected = status.value?.connection?.connected
  if (isConnected) {
    return {
      text: '运行中',
      color: 'bg-green-500',
      pulse: true,
    }
  }

  return {
    text: '未连接',
    color: 'bg-gray-400', // Or red? Old version uses gray/offline class which is gray usually
    pulse: false,
  }
})

const navItems = computed(() =>
  menuRoutes
    .filter(item => (item.name === 'cards' || item.name === 'userManage') ? userRole.value === 'admin' : true)
    .map(item => ({
      path: item.path ? `/${item.path}` : '/',
      label: item.label,
      icon: item.icon,
      component: item.component,
    })),
)

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  showAccountDropdown.value = false
}

const version = __APP_VERSION__

watch(
  () => route.path,
  () => {
    // Close sidebar on route change (mobile only)
    if (window.innerWidth < 1024)
      appStore.closeSidebar()
  },
)
</script>

<template>
  <aside
    class="theme-sidebar-bg fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col border-r shadow-[2px_0_12px_rgba(0,0,0,0.04)] transition-transform duration-300 lg:static lg:translate-x-0 dark:shadow-[2px_0_16px_rgba(0,0,0,0.2)]"
    :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <!-- Brand -->
    <div class="flex h-16 items-center justify-between border-b border-gray-200/80 px-6 dark:border-gray-700/50">
      <div class="flex items-center gap-3">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 dark:bg-emerald-400/10">
          <div class="i-carbon-sprout text-xl text-emerald-500 dark:text-emerald-400" />
        </div>
        <span class="bg-gradient-to-r from-emerald-600 to-green-500 bg-clip-text text-lg font-bold text-transparent dark:from-emerald-400 dark:to-green-400">
          FarmAuto
        </span>
      </div>
      <!-- Mobile Close Button -->
      <BaseButton
        variant="outline"
        size="sm"
        class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 lg:hidden dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
        @click="appStore.closeSidebar"
      >
        关闭
      </BaseButton>
    </div>

    <!-- 登录账号卡片（紧凑布局，便于手机端下方导航可见） -->
    <div class="border-b border-gray-200/80 px-2 py-1.5 sm:px-3 sm:py-2 dark:border-gray-700/50">
      <div class="relative rounded-lg border border-gray-200/80 bg-gray-50/90 px-2.5 py-2 shadow-sm dark:border-gray-600/80 dark:bg-gray-700/50">
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 transition hover:bg-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60"
            aria-label="用户菜单"
            @click="showUserMenuPopover = !showUserMenuPopover; showAccountDropdown = false"
          >
            <div class="i-carbon-user text-sm text-green-600 dark:text-green-400" />
          </button>
          <div class="min-w-0 flex-1">
            <div class="truncate text-xs font-medium text-gray-900 dark:text-white">
              {{ userName || '—' }}
            </div>
            <div class="text-[11px] text-gray-500 dark:text-gray-400">
              {{ roleLabel }}
            </div>
          </div>
        </div>
        <!-- 头像悬停窗：修改密码、退出登录 -->
        <div
          v-show="showUserMenuPopover"
          class="absolute left-0 top-full z-[100] mt-1.5 min-w-[140px] rounded-lg border border-gray-200 bg-white py-0.5 shadow-xl dark:border-gray-600 dark:bg-gray-800"
        >
          <button
            type="button"
            class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700/50"
            @click="openPasswordModal(); showUserMenuPopover = false"
          >
            <div class="i-carbon-password text-sm" />
            修改密码
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700/50"
            @click="handleLogout(); showUserMenuPopover = false"
          >
            <div class="i-carbon-logout text-sm" />
            退出登录
          </button>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <!-- 免费永久卡（每网站用户限领 3 次，与网站登录账号关联） -->
          <button
            v-if="userName"
            type="button"
            class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
            :disabled="freeClaimLoading || freeClaimRemaining <= 0"
            @click="claimFreeCard"
          >
            <div class="i-carbon-gift text-sm" />
            <span>{{ freeClaimLoading ? '领取中…' : '免费永久卡（3次）' }}</span>
          </button>
          <div
            class="relative w-full"
            @mouseenter="cancelUsedCardsPopoverTimer(); showUsedCardsPopoverDelayed()"
            @mouseleave="hideUsedCardsPopoverDelayed()"
          >
            <BaseButton
              variant="outline"
              size="sm"
              class="w-full !min-h-0 !py-1.5 border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 !text-xs"
            >
              <div class="i-carbon-key mr-1 text-xs" />
              已用卡密
            </BaseButton>
            <div
              v-show="showUsedCardsPopover"
              class="absolute left-0 top-full z-[100] mt-1 min-w-[240px] max-w-[280px] rounded-lg border border-gray-200 bg-white py-2 shadow-xl dark:border-gray-600 dark:bg-gray-800"
              @mouseenter="cancelUsedCardsPopoverTimer()"
              @mouseleave="hideUsedCardsPopoverDelayed()"
            >
              <div class="border-b border-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500 dark:border-gray-600 dark:text-gray-400">
                我的卡密（已用 / 未用）
              </div>
              <div class="max-h-64 overflow-y-auto px-2 py-1">
                <div v-if="myUsedCardsLoading" class="py-4 text-center text-sm text-gray-400">
                  加载中...
                </div>
                <div v-else-if="!myUsedCards.length" class="py-4 text-center text-sm text-gray-400">
                  暂无卡密
                </div>
                <div
                  v-else
                  v-for="(item, idx) in myUsedCards"
                  :key="idx"
                  class="flex items-start justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <div class="min-w-0 flex-1 space-y-0.5">
                    <div class="flex items-center gap-1.5">
                      <span
                        class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                        :class="item.used ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'"
                      >
                        {{ item.used ? '已用' : '未用' }}
                      </span>
                      <span class="truncate font-mono text-xs text-gray-700 dark:text-gray-300">
                        {{ item.code }}
                      </span>
                    </div>
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                      <span v-if="item.typeLabel">类型：{{ item.typeLabel }}</span>
                      <template v-if="item.used">
                        <span>绑定QQ：{{ item.boundAccountUin || item.boundAccountName || '—' }}</span>
                        <span>使用时间：{{ formatUsedAt(item.usedAt) }}</span>
                      </template>
                      <template v-else>
                        <span v-if="item.claimedByUsername">领取：{{ item.claimedByUsername }}</span>
                        <span v-else>未绑定</span>
                      </template>
                    </div>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    class="shrink-0 !p-1.5 text-green-600 dark:text-green-400"
                    title="复制卡密"
                    @click.stop="copyCardCode(item.code)"
                  >
                    <div class="i-carbon-copy text-sm" />
                  </BaseButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Account Selector（紧凑布局） -->
    <div class="border-b border-gray-200/80 p-2 sm:p-3 dark:border-gray-700/50">
      <div class="group relative">
        <button
          class="flex w-full items-center justify-between rounded-lg border border-gray-200/80 bg-gray-50/90 px-2.5 py-2 outline-none transition-all duration-200 hover:border-emerald-300 hover:bg-gray-100 focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600/80 dark:bg-gray-700/50 dark:hover:border-emerald-500/40 dark:hover:bg-gray-700"
          @click="showAccountDropdown = !showAccountDropdown"
        >
          <div class="flex min-w-0 items-center gap-2 overflow-hidden">
            <div class="h-7 w-7 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 ring-2 ring-white dark:bg-gray-600 dark:ring-gray-700">
              <img
                v-if="currentAccount?.uin"
                :src="`https://q1.qlogo.cn/g?b=qq&nk=${currentAccount.uin}&s=100`"
                class="h-full w-full object-cover"
                @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
              >
              <div v-else class="i-carbon-user text-sm text-gray-400" />
            </div>
            <div class="min-w-0 flex flex-col items-start">
              <span class="w-full truncate text-left text-xs font-medium">
                {{ displayName }}
              </span>
              <div class="flex items-center gap-1">
                <span
                  v-if="platform"
                  class="rounded px-1 py-0.2 text-[10px] font-medium leading-tight"
                  :class="getPlatformClass(currentAccount?.platform)"
                >
                  {{ platform }}
                </span>
                <span class="truncate text-[11px] text-gray-400">
                  {{ currentAccount?.uin || currentAccount?.id || '未选择' }}
                </span>
              </div>
            </div>
          </div>
          <div
            class="i-carbon-chevron-down shrink-0 text-sm text-gray-400 transition-transform duration-200"
            :class="{ 'rotate-180': showAccountDropdown }"
          />
        </button>

        <!-- Dropdown Menu -->
        <div
          v-if="showAccountDropdown"
          class="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden border border-gray-100 rounded-xl bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800"
        >
          <div class="custom-scrollbar max-h-60 overflow-y-auto">
            <template v-if="accounts.length > 0">
              <button
                v-for="acc in accounts"
                :key="acc.id || acc.uin"
                class="w-full flex items-center gap-3 px-4 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                :class="{ 'bg-green-50 dark:bg-green-900/10': currentAccount?.id === acc.id }"
                @click="selectAccount(acc)"
              >
                <div class="h-6 w-6 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                  <img
                    v-if="acc.uin"
                    :src="`https://q1.qlogo.cn/g?b=qq&nk=${acc.uin}&s=100`"
                    class="h-full w-full object-cover"
                    @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
                  >
                  <div v-else class="i-carbon-user text-gray-400" />
                </div>
                <div class="min-w-0 flex flex-1 flex-col items-start">
                  <span class="w-full truncate text-left text-sm font-medium">
                    {{ acc.name || acc.nick || acc.uin }}
                  </span>
                  <div class="flex items-center gap-1.5">
                    <span
                      v-if="platform"
                      class="rounded px-1 py-0.2 text-[10px] font-medium leading-tight"
                      :class="getPlatformClass(acc.platform)"
                    >
                      {{ getPlatformLabel(acc.platform) }}
                    </span>
                    <span class="text-xs text-gray-400">{{ acc.uin || acc.id }}</span>
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <button
                    class="rounded-full p-1 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-900/20"
                    title="修改备注"
                    @click.stop="openRemarkModal(acc)"
                  >
                    <div class="i-carbon-edit" />
                  </button>
                  <div v-if="currentAccount?.id === acc.id" class="i-carbon-checkmark text-green-500" />
                </div>
              </button>
            </template>
            <div v-else class="px-4 py-3 text-center text-sm text-gray-400">
              暂无账号
            </div>
          </div>
          <div class="mt-1 border-t border-gray-100 pt-1 dark:border-gray-700">
            <button
              class="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-600 transition-colors hover:bg-gray-50 dark:text-green-400 dark:hover:bg-gray-700/50"
              @click="showAccountModal = true; showAccountDropdown = false"
            >
              <div class="i-carbon-add" />
              <span>添加账号</span>
            </button>
            <router-link
              to="/accounts"
              class="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-600 transition-colors hover:bg-gray-50 dark:text-green-400 dark:hover:bg-gray-700/50"
              @click="showAccountDropdown = false"
            >
              <div class="i-carbon-add-alt" />
              <span>管理账号</span>
            </router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="group flex items-center gap-3 rounded-xl border-l-2 border-transparent px-3 py-2.5 text-gray-600 transition-all duration-200 hover:bg-gray-100 hover:text-emerald-600 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-emerald-400"
        :active-class="item.path === '/' ? '' : 'border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-400 font-medium shadow-sm ring-1 ring-emerald-500/10'"
        :exact-active-class="item.path === '/' ? 'border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-400 font-medium shadow-sm ring-1 ring-emerald-500/10' : ''"
        @mouseenter="item.component?.()"
      >
        <div class="text-xl transition-transform duration-200 group-hover:scale-105" :class="[item.icon]" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <!-- 主题切换 + 下线提醒 + 使用说明（左下角，图标+文字标识同一行） -->
    <div class="shrink-0 border-t border-gray-200/80 bg-gray-100/50 px-2 py-2 dark:border-gray-700/50 dark:bg-gray-800/50">
      <div class="flex items-center justify-center gap-2 sm:gap-3">
        <button
          type="button"
          class="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-gray-700 transition-all duration-200 hover:bg-white hover:text-emerald-600 hover:shadow-sm dark:text-gray-200 dark:hover:bg-gray-700/80 dark:hover:text-emerald-400"
          aria-label="主题切换"
          title="主题切换"
          @click="showThemeModal = true"
        >
          <div class="i-carbon-color-palette text-xl" />
          <span class="text-[10px] font-medium leading-tight text-gray-600 dark:text-gray-300">主题</span>
        </button>
        <button
          type="button"
          class="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-gray-700 transition-all duration-200 hover:bg-white hover:text-emerald-600 hover:shadow-sm dark:text-gray-200 dark:hover:bg-gray-700/80 dark:hover:text-emerald-400"
          aria-label="下线提醒设置"
          title="下线提醒"
          @click="openOfflineReminderModal"
        >
          <div class="i-carbon-notification text-xl" />
          <span class="text-[10px] font-medium leading-tight text-gray-600 dark:text-gray-300">提醒</span>
        </button>
        <button
          type="button"
          class="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-gray-700 transition-all duration-200 hover:bg-white hover:text-emerald-600 hover:shadow-sm dark:text-gray-200 dark:hover:bg-gray-700/80 dark:hover:text-emerald-400"
          aria-label="打开项目各功能使用说明"
          title="使用说明"
          @click="showHelpModal = true"
        >
          <div class="i-carbon-document text-xl" />
          <span class="text-[10px] font-medium leading-tight text-gray-600 dark:text-gray-300">说明</span>
        </button>
      </div>
    </div>

    <!-- Footer Status -->
    <div class="mt-auto border-t border-gray-200/80 bg-gray-50/60 p-4 dark:border-gray-700/50 dark:bg-gray-800/60">
      <div class="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div class="flex items-center gap-1.5">
          <div
            class="h-2 w-2 rounded-full"
            :class="[connectionStatus.color, { 'animate-pulse': connectionStatus.pulse }]"
          />
          <span>{{ connectionStatus.text }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span>{{ uptime }}</span>
        </div>
      </div>
      <div class="mt-1 flex flex-col gap-0.5 text-xs text-gray-400 font-mono">
        <div class="flex items-center justify-between">
          <span>{{ formattedTime }}</span>
        </div>
        <div class="flex items-center justify-between opacity-50">
          <span>Web v{{ version }}</span>
          <span v-if="serverVersion">Core v{{ serverVersion }}</span>
        </div>
      </div>
    </div>
  </aside>

  <!-- Overlay for dropdown/popover close -->
  <div
    v-if="showAccountDropdown || showUserMenuPopover"
    class="fixed inset-0 z-40 bg-transparent"
    @click="showAccountDropdown = false; showUserMenuPopover = false"
  />

  <AccountModal
    :show="showAccountModal"
    :edit-data="accountToEdit"
    @close="showAccountModal = false; accountToEdit = null"
    @saved="handleAccountSaved"
  />

  <RemarkModal
    :show="showRemarkModal"
    :account="accountToEdit"
    @close="showRemarkModal = false"
    @saved="handleAccountSaved"
  />

  <HelpGuideModal
    :show="showHelpModal"
    @close="showHelpModal = false"
  />

  <!-- 修改密码弹窗 -->
  <Teleport to="body">
    <div
      v-if="showPasswordModal"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      @click.self="showPasswordModal = false"
    >
      <div
        class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800"
        @click.stop
      >
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
            修改密码
          </h3>
          <BaseButton
            variant="outline"
            size="sm"
            class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
            @click="showPasswordModal = false"
          >
            关闭
          </BaseButton>
        </div>
        <form class="space-y-4" @submit.prevent="handleChangePassword">
          <BaseInput
            v-model="passwordForm.oldPassword"
            type="password"
            label="原密码"
            placeholder="请输入原密码"
            autocomplete="current-password"
          />
          <BaseInput
            v-model="passwordForm.newPassword"
            type="password"
            label="新密码"
            placeholder="至少 4 位"
            autocomplete="new-password"
          />
          <BaseInput
            v-model="passwordForm.confirmPassword"
            type="password"
            label="确认新密码"
            placeholder="再次输入新密码"
            autocomplete="new-password"
          />
          <p v-if="passwordError" class="text-sm text-red-500">
            {{ passwordError }}
          </p>
          <div class="flex gap-2 pt-2">
            <BaseButton
              type="button"
              variant="outline"
              class="flex-1 border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
              @click="showPasswordModal = false"
            >
              取消
            </BaseButton>
            <BaseButton
              type="submit"
              variant="success"
              class="flex-1"
              :loading="passwordLoading"
            >
              确认修改
            </BaseButton>
          </div>
        </form>
      </div>
    </div>
  </Teleport>

  <!-- 主题切换弹窗 -->
  <Teleport to="body">
    <div
      v-if="showThemeModal"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      @click.self="showThemeModal = false"
    >
      <div
        class="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800"
        @click.stop
      >
        <div class="mb-4 flex items-center justify-between">
          <h3 class="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-lg text-white"
              style="background: var(--theme-gradient);"
            >
              <div class="i-carbon-color-palette text-lg" />
            </div>
            主题切换
          </h3>
          <BaseButton
            variant="outline"
            size="sm"
            class="border-gray-200 dark:border-gray-600"
            @click="showThemeModal = false"
          >
            关闭
          </BaseButton>
        </div>
        <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
          当前账号独立保存，电脑端与手机端同步生效。
        </p>

        <!-- 五款渐变主题 -->
        <div class="mb-4">
          <h4 class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">配色主题</h4>
          <div class="space-y-2">
            <button
              v-for="theme in COLOR_THEMES"
              :key="theme.id"
              type="button"
              class="group w-full rounded-xl border-2 p-3 text-left transition-all"
              :class="colorTheme === theme.id
                ? 'border-current shadow-md ring-1 ring-current/20'
                : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500'"
              :style="colorTheme === theme.id ? `border-color: ${theme.gradientFrom}; color: ${theme.gradientFrom}; --tw-ring-color: ${theme.gradientFrom};` : ''"
              @click="appStore.setColorTheme(theme.id)"
            >
              <div
                class="mb-2 h-1.5 w-full rounded-full"
                :style="{ background: `linear-gradient(90deg, ${theme.gradientFrom}, ${theme.gradientTo})` }"
              />
              <div class="flex items-center gap-2">
                <div class="h-4 w-4 rounded-full shadow-inner" :style="{ backgroundColor: theme.gradientFrom }" />
                <div class="h-4 w-4 rounded-full shadow-inner" :style="{ background: `linear-gradient(135deg, ${theme.gradientFrom}, ${theme.gradientTo})` }" />
                <div class="h-4 w-4 rounded-full shadow-inner" :style="{ backgroundColor: theme.gradientTo }" />
                <span class="text-sm font-medium" :class="colorTheme === theme.id ? '' : 'text-gray-800 dark:text-gray-200'">{{ theme.name }}</span>
                <span v-if="colorTheme === theme.id" class="ml-auto text-xs" :style="{ color: theme.gradientFrom }">已选</span>
              </div>
              <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {{ theme.description }}
              </p>
            </button>
          </div>
        </div>

        <!-- 自定义背景图 -->
        <div class="border-t border-gray-200 pt-4 dark:border-gray-700">
          <h4 class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">自定义背景图</h4>
          <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
            上传图片将作为网页整体背景，按账号保存并跨端同步。
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <input
              ref="themeBgFileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onThemeBgFileChange"
            >
            <BaseButton
              variant="outline"
              size="sm"
              :loading="themeBgUploading"
              @click="triggerThemeBgInput"
            >
              {{ themeBgUploading ? '上传中…' : '上传图片' }}
            </BaseButton>
            <BaseButton
              v-if="customBackgroundUrl"
              variant="outline"
              size="sm"
              class="border-amber-200 text-amber-700 dark:border-amber-700 dark:text-amber-400"
              @click="clearThemeBg"
            >
              清除背景
            </BaseButton>
          </div>
          <div
            v-if="customBackgroundUrl"
            class="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600"
          >
            <img
              :src="customBackgroundUrl"
              alt="当前背景"
              class="h-24 w-full object-cover"
            >
          </div>
        </div>

        <div class="mt-4 flex justify-end border-t border-gray-100 pt-4 dark:border-gray-700">
          <BaseButton
            variant="primary"
            size="sm"
            @click="showThemeModal = false"
          >
            完成
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 下线提醒设置弹窗 -->
  <Teleport to="body">
    <div
      v-if="showOfflineReminderModal"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      @click.self="showOfflineReminderModal = false"
    >
      <div
        class="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800"
        @click.stop
      >
        <div class="mb-4 flex items-center justify-between">
          <h3 class="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <div class="i-carbon-notification text-xl text-emerald-500" />
            下线提醒
          </h3>
          <BaseButton
            variant="outline"
            size="sm"
            class="border-gray-200 dark:border-gray-600"
            @click="showOfflineReminderModal = false"
          >
            关闭
          </BaseButton>
        </div>
        <div class="space-y-3 text-sm">
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <span class="text-gray-700 font-medium dark:text-gray-300">推送渠道</span>
              <BaseButton
                v-if="offlineChannelDocUrl"
                variant="text"
                size="sm"
                class="text-emerald-600 dark:text-emerald-400"
                @click="openOfflineChannelDocs"
              >
                官网
              </BaseButton>
            </div>
            <BaseSelect
              v-model="localOffline.channel"
              :options="OFFLINE_CHANNEL_OPTIONS"
            />
          </div>
          <BaseSelect
            v-model="localOffline.reloginUrlMode"
            label="重登录链接"
            :options="OFFLINE_RELOGIN_OPTIONS"
          />
          <BaseInput
            v-model="localOffline.endpoint"
            label="接口地址"
            type="text"
            :disabled="localOffline.channel !== 'webhook'"
          />
          <BaseInput
            v-model="localOffline.token"
            label="Token"
            type="text"
            placeholder="接收端 token"
          />
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BaseInput
              v-model="localOffline.title"
              label="标题"
              type="text"
              placeholder="提醒标题"
            />
            <BaseInput
              v-model.number="localOffline.offlineDeleteSec"
              label="离线删除账号 (秒)"
              type="number"
              min="1"
              placeholder="默认 120"
            />
          </div>
          <BaseInput
            v-model="localOffline.msg"
            label="内容"
            type="text"
            placeholder="提醒内容"
          />
        </div>
        <div class="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
          <BaseButton
            variant="outline"
            size="sm"
            @click="showOfflineReminderModal = false"
          >
            取消
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="offlineSaving"
            @click="saveOfflineReminder"
          >
            保存下线提醒设置
          </BaseButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 2px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}
</style>
