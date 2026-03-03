<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AccountModal from '@/components/AccountModal.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useCardStore } from '@/stores/card'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const accountStore = useAccountStore()
const appStore = useAppStore()
const cardStore = useCardStore()
const toast = useToastStore()
const { accounts, loading } = storeToRefs(accountStore)
const { userRole } = storeToRefs(appStore)

const isAdmin = computed(() => userRole.value === 'admin')

/** 运行中数量（已连接脚本服务器） */
const runningCount = computed(() =>
  (accounts.value || []).filter((a: any) => a.running && a.connected).length)
/** 异常数量（已启动但未连接脚本服务器） */
const abnormalCount = computed(() =>
  (accounts.value || []).filter((a: any) => a.running && !a.connected).length)
/** 已停止数量 */
const stoppedCount = computed(() =>
  (accounts.value || []).filter((a: any) => !a.running).length)

/** 管理员时按所属用户分组，普通用户为单组 */
const accountGroups = computed(() => {
  const list = accounts.value || []
  if (!isAdmin.value || list.length === 0) {
    return [{ key: 'default', label: '', accounts: list }]
  }
  const hasOwner = list.some((a: any) => a.ownerUsername != null || a.ownerId != null)
  if (!hasOwner) {
    return [{ key: 'default', label: '', accounts: list }]
  }
  const map = new Map<string, any[]>()
  for (const acc of list) {
    const key = acc.ownerId != null ? String(acc.ownerId) : ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(acc)
  }
  const groups: { key: string; label: string; accounts: any[] }[] = []
  for (const [key, accs] of map) {
    const first = accs[0]
    const label = first?.ownerUsername ?? (key === 'legacy-admin' ? '管理员' : key || '历史账号')
    groups.push({ key, label, accounts: accs })
  }
  groups.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  return groups
})

const showModal = ref(false)
const showDeleteConfirm = ref(false)
const deleteLoading = ref(false)
const editingAccount = ref<any>(null)
const accountToDelete = ref<any>(null)

const showRenewModal = ref(false)
const renewAccount = ref<any>(null)
const renewCode = ref('')
const renewError = ref('')
const renewLoading = ref(false)

onMounted(() => {
  accountStore.fetchAccounts()
})

useIntervalFn(() => {
  accountStore.fetchAccounts()
}, 3000)

function openSettings(account: any) {
  accountStore.selectAccount(account.id)
  router.push('/settings')
}

function openAddModal() {
  editingAccount.value = null
  showModal.value = true
}

function openEditModal(account: any) {
  editingAccount.value = { ...account }
  showModal.value = true
}

function openRemoveConfirm(account: any) {
  accountToDelete.value = account
  showDeleteConfirm.value = true
}

async function confirmRemove() {
  if (!accountToDelete.value)
    return
  try {
    deleteLoading.value = true
    await accountStore.deleteAccount(accountToDelete.value.id)
    accountToDelete.value = null
    showDeleteConfirm.value = false
  }
  finally {
    deleteLoading.value = false
  }
}

async function toggleAccount(account: any) {
  if (account.running) {
    await accountStore.stopAccount(account.id)
  }
  else {
    await accountStore.startAccount(account.id)
  }
}

function handleSaved() {
  accountStore.fetchAccounts()
}

function openRenewModal(account: any) {
  const info = account?.cardInfo
  const isPermanent = info && (info.expiresAt == null || info.type === 'permanent')
  if (isPermanent) {
    toast.warning('永久卡用户无需续费')
    return
  }
  renewAccount.value = account
  renewCode.value = ''
  renewError.value = ''
  showRenewModal.value = true
}

function closeRenewModal() {
  if (!renewLoading.value) {
    showRenewModal.value = false
    renewAccount.value = null
    renewCode.value = ''
    renewError.value = ''
  }
}

async function submitRenew() {
  if (!renewAccount.value) return
  const raw = renewCode.value.trim()
  if (!raw) {
    renewError.value = '请输入新卡密'
    return
  }
  renewError.value = ''
  renewLoading.value = true
  try {
    await cardStore.renewCard(renewAccount.value.id, raw)
    toast.success('续费成功，账户到期时间已更新')
    await accountStore.fetchAccounts()
    closeRenewModal()
  }
  catch (e: any) {
    renewError.value = e?.message || '续费失败'
  }
  finally {
    renewLoading.value = false
  }
}

const cardTypeLabel: Record<string, string> = {
  day: '天卡',
  week: '周卡',
  month: '月卡',
  year: '年卡',
  permanent: '永久卡',
  multiple: '多张（叠加）',
}

function formatCardExpiry(expiresAt: number | null | undefined) {
  if (expiresAt == null) return '永久'
  return new Date(expiresAt).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="mx-auto max-w-6xl w-full p-4">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">
          账号管理
        </h1>
        <p v-if="isAdmin && accountGroups.length > 1" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          以下按用户账号分组展示各用户添加的 QQ 账号
        </p>
      </div>
      <BaseButton
        variant="primary"
        @click="openAddModal"
      >
        <div class="i-carbon-add mr-2" />
        添加账号
      </BaseButton>
    </div>

    <!-- 状态统计 -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div class="text-sm text-gray-500 dark:text-gray-400">
          运行中
        </div>
        <div class="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
          {{ loading && accounts.length === 0 ? '—' : runningCount }}
        </div>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div class="text-sm text-gray-500 dark:text-gray-400">
          异常
        </div>
        <div class="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
          {{ loading && accounts.length === 0 ? '—' : abnormalCount }}
        </div>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div class="text-sm text-gray-500 dark:text-gray-400">
          已停止
        </div>
        <div class="mt-1 text-2xl font-bold text-gray-600 dark:text-gray-400">
          {{ loading && accounts.length === 0 ? '—' : stoppedCount }}
        </div>
      </div>
    </div>

    <div v-if="loading && accounts.length === 0" class="py-8 text-center text-gray-500">
      <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
      <div>加载中...</div>
    </div>

    <div v-else-if="accounts.length === 0" class="card-panel py-12 text-center">
      <div i-carbon-user-avatar class="mb-4 inline-block text-4xl text-gray-400" />
      <p class="mb-4 text-gray-500">
        暂无账号
      </p>
      <BaseButton
        variant="text"
        @click="openAddModal"
      >
        立即添加
      </BaseButton>
    </div>

    <div v-else class="space-y-8">
      <section
        v-for="group in accountGroups"
        :key="group.key || 'default'"
        class="space-y-4"
      >
        <h2
          v-if="group.label"
          class="flex items-center gap-2 text-base font-semibold text-gray-700 dark:text-gray-300"
        >
          <span class="i-carbon-user-multiple text-green-600 dark:text-green-400" />
          用户账号：{{ group.label }}
        </h2>
        <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-3 sm:grid-cols-2">
          <div
            v-for="acc in group.accounts"
            :key="acc.id"
            class="card-panel border-transparent p-4 transition-colors hover:border-emerald-400/50"
          >
        <div class="mb-4 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="h-12 w-12 flex items-center justify-center overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <img v-if="acc.uin" :src="`https://q1.qlogo.cn/g?b=qq&nk=${acc.uin}&s=100`" class="h-full w-full object-cover">
              <div v-else class="i-carbon-user text-2xl text-gray-400" />
            </div>
            <div>
              <h3 class="text-lg font-bold">
                {{ acc.name || acc.nick || acc.id }}
              </h3>
              <div class="mt-0.5 flex items-center gap-1.5">
                <span
                  v-if="acc.platform"
                  class="rounded px-1 py-0.2 text-[10px] font-medium leading-tight"
                  :class="getPlatformClass(acc.platform)"
                >
                  {{ getPlatformLabel(acc.platform) }}
                </span>
                <span class="text-sm text-gray-500">
                  {{ acc.uin || '未绑定' }}
                </span>
              </div>
              <!-- 卡密信息（支持多张卡叠加） -->
              <div v-if="acc.cardInfo" class="mt-2 rounded bg-gray-100 px-2 py-1.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                <div class="font-medium text-gray-700 dark:text-gray-300">
                  {{ acc.cardInfo.cardCount > 1 ? `绑定 ${acc.cardInfo.cardCount} 张卡密` : '卡密' }}：<span class="font-mono">{{ acc.cardInfo.code }}</span>
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>类型：{{ cardTypeLabel[acc.cardInfo.type] || acc.cardInfo.type }}</span>
                  <span>账户到期时间：{{ formatCardExpiry(acc.cardInfo.expiresAt) }}</span>
                </div>
              </div>
              <div v-else class="mt-2 text-xs text-gray-400 dark:text-gray-500">
                未绑定卡密
              </div>
            </div>
          </div>
          <div class="flex flex-col items-end gap-2">
            <BaseButton
              v-if="acc.loginDisabled"
              variant="secondary"
              size="sm"
              class="w-20 border rounded-full border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400"
              disabled
            >
              已封禁
            </BaseButton>
            <BaseButton
              v-else-if="!acc.cardInfo"
              variant="secondary"
              size="sm"
              class="w-20 border rounded-full border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400"
              disabled
              title="请先绑定卡密后再启动"
            >
              <div class="i-carbon-play-filled mr-1 opacity-50" />
              启动
            </BaseButton>
            <BaseButton
              v-else
              variant="secondary"
              size="sm"
              class="w-20 border rounded-full shadow-sm transition-all duration-500 ease-in-out active:scale-95"
              :class="acc.running ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500 active:border-red-300 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 dark:focus:ring-red-500 dark:active:border-red-700' : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 active:border-green-300 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:focus:ring-green-500 dark:active:border-green-700'"
              @click="toggleAccount(acc)"
            >
              <div :class="acc.running ? 'i-carbon-stop-filled' : 'i-carbon-play-filled'" class="mr-1" />
              {{ acc.running ? '停止' : '启动' }}
            </BaseButton>
          </div>
        </div>

        <div class="mt-2 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-700">
          <div class="flex items-center gap-2 text-sm text-gray-500">
            <span v-if="acc.loginDisabled" class="rounded px-1.5 py-0.5 text-xs font-medium text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400">
              已封禁
            </span>
            <span
              v-else
              class="flex items-center gap-1"
              :class="acc.running && !acc.connected ? 'text-red-600 dark:text-red-400' : ''"
            >
              <div
                class="h-2 w-2 rounded-full"
                :class="
                  acc.running && acc.connected
                    ? 'bg-green-500'
                    : acc.running && !acc.connected
                      ? 'bg-red-500'
                      : 'bg-gray-300'
                "
              />
              {{ acc.running && acc.connected ? '运行中' : acc.running && !acc.connected ? '异常' : '已停止' }}
            </span>
          </div>

          <div class="flex flex-wrap gap-2">
            <BaseButton
              variant="outline"
              size="sm"
              class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
              title="设置"
              @click="openSettings(acc)"
            >
              设置
            </BaseButton>
            <BaseButton
              variant="outline"
              size="sm"
              class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
              title="编辑"
              @click="openEditModal(acc)"
            >
              编辑
            </BaseButton>
            <BaseButton
              v-if="!acc.cardInfo || (acc.cardInfo.expiresAt != null && acc.cardInfo.type !== 'permanent')"
              variant="outline"
              size="sm"
              class="border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 focus:ring-blue-500 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
              title="续费：输入新卡密，时长在原有到期时间上叠加（永久不降级）"
              @click="openRenewModal(acc)"
            >
              续费
            </BaseButton>
            <BaseButton
              variant="outline"
              size="sm"
              class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
              title="移除账号"
              @click="openRemoveConfirm(acc)"
            >
              移除账号
            </BaseButton>
          </div>
        </div>
          </div>
        </div>
      </section>
    </div>

    <AccountModal
      :show="showModal"
      :edit-data="editingAccount"
      @close="showModal = false"
      @saved="handleSaved"
    />

    <ConfirmModal
      :show="showDeleteConfirm"
      :loading="deleteLoading"
      title="移除账号"
      :message="accountToDelete
        ? `确定要移除账号「${accountToDelete.name || accountToDelete.id}」吗？确认后将断开该账号的脚本运行并删除账号数据，此操作不可恢复。`
        : ''"
      confirm-text="确认移除"
      type="success"
      @close="!deleteLoading && (showDeleteConfirm = false)"
      @cancel="!deleteLoading && (showDeleteConfirm = false)"
      @confirm="confirmRemove"
    />

    <!-- 续费弹窗 -->
    <div
      v-if="showRenewModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="closeRenewModal"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3 class="mb-2 text-lg font-bold">
          卡密续费
        </h3>
        <p v-if="renewAccount" class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          账号：{{ renewAccount.name || renewAccount.id }}。输入新卡密后，新卡时长会叠加到当前账户到期时间（永久不会因续费短时卡而降级）。
        </p>
        <BaseInput
          v-model="renewCode"
          type="text"
          label="新卡密"
          placeholder="请输入新卡密"
          autofocus
          @keydown.enter="submitRenew"
        />
        <p v-if="renewError" class="mt-2 text-sm text-red-600 dark:text-red-400">
          {{ renewError }}
        </p>
        <div class="mt-6 flex justify-end gap-2">
          <BaseButton variant="outline" size="sm" @click="closeRenewModal">
            取消
          </BaseButton>
          <BaseButton variant="primary" :loading="renewLoading" @click="submitRenew">
            确认续费
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
