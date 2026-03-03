<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useCardStore, type Card } from '@/stores/card'
import { useToastStore } from '@/stores/toast'

const cardStore = useCardStore()
const toast = useToastStore()
const { stats, cards, loading, statsLoading } = storeToRefs(cardStore)

const filterStatus = ref('')
const filterType = ref('')
const filterSearch = ref('')

const showBatchModal = ref(false)
const batchForm = ref({
  type: 'month',
  count: 10,
  prefix: '',
  remark: '',
})
const batchSubmitting = ref(false)
const confirmAction = ref<{ type: string, card: Card } | null>(null)
const confirmLoading = ref(false)

// 卡密复制：批量勾选
const selectedIds = ref<Set<string>>(new Set())
const allSelected = computed(() => cards.value.length > 0 && selectedIds.value.size === cards.value.length)
const hasSelected = computed(() => selectedIds.value.size > 0)

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(cards.value.map(c => c.id))
  }
}

function fallbackCopyText(str: string): boolean {
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
    return ok
  } catch {
    return false
  }
}

function copySelected() {
  if (!hasSelected.value) {
    toast.warning('请先勾选要复制的卡密')
    return
  }
  const list = cards.value.filter(c => selectedIds.value.has(c.id))
  const text = list.map(c => c.code).join('\n')
  const onSuccess = () => toast.success(`已复制 ${list.length} 条卡密到剪贴板`)
  const onFail = () => toast.error('复制失败，请检查浏览器权限或使用 HTTPS')
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      if (fallbackCopyText(text)) onSuccess()
      else onFail()
    })
  } else {
    if (fallbackCopyText(text)) onSuccess()
    else onFail()
  }
}

const cardTypeOptions = [
  { label: '天卡', value: 'day' },
  { label: '周卡', value: 'week' },
  { label: '月卡', value: 'month' },
  { label: '年卡', value: 'year' },
  { label: '永久卡', value: 'permanent' },
]
const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '正常', value: 'active' },
  { label: '已封禁', value: 'banned' },
  { label: '已过期', value: 'expired' },
]
const typeFilterOptions = [
  { label: '全部类型', value: '' },
  ...cardTypeOptions,
]

onMounted(() => {
  cardStore.fetchStats()
  cardStore.fetchCards({
    status: filterStatus.value || undefined,
    type: filterType.value || undefined,
    search: filterSearch.value.trim() || undefined,
  })
})

useIntervalFn(() => {
  cardStore.fetchStats()
}, 5000)

watch([filterStatus, filterType, filterSearch], () => {
  cardStore.fetchCards({
    status: filterStatus.value || undefined,
    type: filterType.value || undefined,
    search: filterSearch.value.trim() || undefined,
  })
})

function refreshList() {
  cardStore.fetchStats()
  cardStore.fetchCards({
    status: filterStatus.value || undefined,
    type: filterType.value || undefined,
    search: filterSearch.value.trim() || undefined,
  })
}

function openBatchModal() {
  batchForm.value = { type: 'month', count: 10, prefix: '', remark: '' }
  showBatchModal.value = true
}

async function submitBatch() {
  const { type, prefix, remark } = batchForm.value
  const count = Math.min(1000, Math.max(1, Number(batchForm.value.count) || 1))
  if (count < 1 || count > 1000) {
    toast.warning('数量请填写 1～1000')
    return
  }
  batchSubmitting.value = true
  try {
    const created = await cardStore.createBatch({ type, count, prefix, remark })
    toast.success(`成功生成 ${created.length} 张卡密`)
    showBatchModal.value = false
    refreshList()
  }
  catch (e: any) {
    toast.error(e?.message || '制卡失败')
  }
  finally {
    batchSubmitting.value = false
  }
}

function openConfirm(type: string, card: Card) {
  confirmAction.value = { type, card }
}

function closeConfirm() {
  if (!confirmLoading.value) confirmAction.value = null
}

async function runConfirm() {
  if (!confirmAction.value) return
  const { type, card } = confirmAction.value
  confirmLoading.value = true
  try {
    if (type === 'ban') await cardStore.banCard(card.id)
    else if (type === 'unban') await cardStore.unbanCard(card.id)
    else if (type === 'force-logout') await cardStore.forceLogout(card.id)
    else if (type === 'unbind') await cardStore.unbind(card.id)
    else if (type === 'delete') await cardStore.deleteCard(card.id)
    toast.success('操作成功')
    confirmAction.value = null
    refreshList()
  }
  catch (e: any) {
    toast.error(e?.message || '操作失败')
  }
  finally {
    confirmLoading.value = false
  }
}

const confirmMessage = computed(() => {
  if (!confirmAction.value) return ''
  const { type, card } = confirmAction.value
  if (type === 'ban') return `确定封禁卡密 ${card.code}？`
  if (type === 'unban') return `确定解除封禁 ${card.code}？`
  if (type === 'force-logout') return `确定强制下线（解除设备绑定）${card.code}？`
  if (type === 'unbind') return `确定解除设备/账号绑定 ${card.code}？`
  if (type === 'delete') return `确定删除卡密 ${card.code}？删除后将解除与该卡密绑定的 QQ 账号，并立即停止该账号的脚本运行，且不可恢复。`
  return '确定执行？'
})

const confirmType = computed(() => (confirmAction.value?.type === 'unban' ? 'primary' : 'danger'))

function formatTime(ts: number | null) {
  if (ts == null) return '—'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN')
}

function statusLabel(s: string) {
  if (s === 'active') return '正常'
  if (s === 'banned') return '已封禁'
  if (s === 'expired') return '已过期'
  return s
}

function typeLabel(t: string) {
  return cardTypeOptions.find(o => o.value === t)?.label ?? t
}
</script>

<template>
  <div class="mx-auto max-w-7xl w-full p-4">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        卡密管理
      </h1>
      <BaseButton variant="primary" @click="openBatchModal">
        <div class="i-carbon-add mr-2" />
        批量制卡
      </BaseButton>
    </div>

    <!-- 统计 -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div class="text-sm text-gray-500 dark:text-gray-400">
          总卡密数
        </div>
        <div class="mt-1 text-2xl font-bold">
          {{ statsLoading ? '—' : stats.totalCards }}
        </div>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div class="text-sm text-gray-500 dark:text-gray-400">
          当前在线人数
        </div>
        <div class="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
          {{ statsLoading ? '—' : stats.onlineCount }}
        </div>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div class="text-sm text-gray-500 dark:text-gray-400">
          已激活卡密
        </div>
        <div class="mt-1 text-2xl font-bold">
          {{ statsLoading ? '—' : stats.activatedCards }}
        </div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <BaseSelect
        v-model="filterStatus"
        :options="statusOptions"
        placeholder="状态"
        class="w-36"
      />
      <BaseSelect
        v-model="filterType"
        :options="typeFilterOptions"
        placeholder="类型"
        class="w-36"
      />
      <BaseInput
        v-model="filterSearch"
        placeholder="搜索卡密/绑定账号/备注"
        class="min-w-48 max-w-xs"
      />
      <BaseButton
        variant="outline"
        size="sm"
        class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
        @click="refreshList"
      >
        刷新
      </BaseButton>
      <BaseButton
        v-if="hasSelected"
        variant="outline"
        size="sm"
        class="border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
        title="将勾选的卡密（每行一条）复制到剪贴板"
        @click="copySelected"
      >
        <div class="i-carbon-copy mr-1" />
        复制选中 ({{ selectedIds.size }})
      </BaseButton>
    </div>

    <!-- 列表 -->
    <div class="rounded-xl border border-gray-200 bg-white shadow dark:border-gray-700 dark:bg-gray-800">
      <div v-if="loading && cards.length === 0" class="py-12 text-center text-gray-500">
        <div class="i-svg-spinners-90-ring-with-bg mb-2 inline-block text-2xl" />
        加载中...
      </div>
      <div v-else-if="cards.length === 0" class="py-12 text-center text-gray-500">
        暂无卡密，请先批量制卡
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[800px] text-left text-sm">
          <thead class="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
            <tr>
              <th class="w-10 px-2 py-3">
                <label class="flex cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    :indeterminate="hasSelected && !allSelected"
                    class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:focus:ring-blue-500"
                    @change="toggleSelectAll"
                  >
                </label>
              </th>
              <th class="px-4 py-3 font-medium">
                卡密
              </th>
              <th class="px-4 py-3 font-medium">
                类型
              </th>
              <th class="px-4 py-3 font-medium">
                状态
              </th>
              <th class="px-4 py-3 font-medium">
                激活状态
              </th>
              <th class="px-4 py-3 font-medium">
                激活时间
              </th>
              <th class="px-4 py-3 font-medium">
                到期时间
              </th>
              <th class="px-4 py-3 font-medium">
                QQ号
              </th>
              <th class="px-4 py-3 font-medium">
                绑定账号
              </th>
              <th class="px-4 py-3 font-medium">
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
            <tr
              v-for="card in cards"
              :key="card.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-700/30"
            >
              <td class="w-10 px-2 py-3">
                <label class="flex cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    :checked="selectedIds.has(card.id)"
                    class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:focus:ring-blue-500"
                    @change="toggleSelect(card.id)"
                  >
                </label>
              </td>
              <td class="px-4 py-3 font-mono text-xs">
                {{ card.code }}
              </td>
              <td class="px-4 py-3">
                {{ typeLabel(card.type) }}
              </td>
              <td class="px-4 py-3">
                <span
                  class="rounded px-2 py-0.5 text-xs font-medium"
                  :class="{
                    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400': card.status === 'active',
                    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400': card.status === 'banned',
                    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400': card.status === 'expired',
                  }"
                >
                  {{ statusLabel(card.status) }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span
                  class="rounded px-2 py-0.5 text-xs font-medium"
                  :class="card.activatedAt
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'"
                >
                  {{ card.activatedAt ? '已激活' : '未激活' }}
                </span>
              </td>
              <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                {{ card.activatedAt ? formatTime(card.activatedAt) : '未激活' }}
              </td>
              <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                {{ card.type === 'permanent' ? '永久' : formatTime(card.expiresAt) }}
              </td>
              <td class="px-4 py-3 font-mono text-gray-600 dark:text-gray-400">
                {{ card.boundAccountUin ?? '—' }}
              </td>
              <td class="px-4 py-3 text-gray-600 dark:text-gray-400">
                {{ card.boundAccountName ?? card.boundAccountId ?? (card.claimedByUsername ? `领取: ${card.claimedByUsername}` : '—') }}
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap items-center gap-2">
                  <BaseButton
                    v-if="card.status === 'active'"
                    variant="outline"
                    size="sm"
                    class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
                    title="封号"
                    @click="openConfirm('ban', card)"
                  >
                    封号
                  </BaseButton>
                  <BaseButton
                    v-if="card.status === 'banned'"
                    variant="outline"
                    size="sm"
                    class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
                    title="解封"
                    @click="openConfirm('unban', card)"
                  >
                    解封
                  </BaseButton>
                  <BaseButton
                    variant="outline"
                    size="sm"
                    class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
                    title="强制下线"
                    @click="openConfirm('force-logout', card)"
                  >
                    强制下线
                  </BaseButton>
                  <BaseButton
                    variant="outline"
                    size="sm"
                    class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
                    title="解除设备绑定"
                    @click="openConfirm('unbind', card)"
                  >
                    解除绑定
                  </BaseButton>
                  <BaseButton
                    variant="outline"
                    size="sm"
                    class="border-red-200 bg-red-50 text-red-600 hover:bg-red-100 focus:ring-red-500 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                    title="删除卡密并解除绑定，同时停止该账号脚本"
                    @click="openConfirm('delete', card)"
                  >
                    删除
                  </BaseButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 批量制卡弹窗 -->
    <div
      v-if="showBatchModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="showBatchModal = false"
    >
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3 class="mb-4 text-lg font-bold">
          批量制卡
        </h3>
        <div class="space-y-4">
          <BaseSelect
            v-model="batchForm.type"
            label="卡类型"
            :options="cardTypeOptions"
          />
          <BaseInput
            v-model="batchForm.count"
            type="number"
            label="数量"
            placeholder="1～1000"
          />
          <BaseInput
            v-model="batchForm.prefix"
            label="前缀（可选）"
            placeholder="如 VIP"
          />
          <BaseInput
            v-model="batchForm.remark"
            label="备注（可选）"
          />
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <BaseButton
            variant="outline"
            size="sm"
            class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
            @click="showBatchModal = false"
          >
            取消
          </BaseButton>
          <BaseButton variant="success" :loading="batchSubmitting" @click="submitBatch">
            生成
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 操作确认 -->
    <ConfirmModal
      :show="!!confirmAction"
      :loading="confirmLoading"
      title="确认操作"
      :message="confirmMessage"
      confirm-text="确定"
      :type="confirmType"
      @close="closeConfirm"
      @cancel="closeConfirm"
      @confirm="runConfirm"
    />
  </div>
</template>
