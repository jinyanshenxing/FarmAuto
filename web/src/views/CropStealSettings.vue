<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'

defineProps<{ embedded?: boolean }>()
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import { useAccountStore } from '@/stores/account'

const accountStore = useAccountStore()
const { currentAccountId, accounts } = storeToRefs(accountStore)

const loading = ref(false)
const saving = ref(false)
const cropList = ref<Array<{ seedId: number; name: string; image?: string; level?: number }>>([])
const blacklist = ref<number[]>([]) // 不偷取的作物 seedId 列表（偷取黑名单）
const imageErrors = ref<Record<number, boolean>>({})
const modalVisible = ref(false)
const modalConfig = ref({ title: '', message: '', type: 'primary' as 'primary' | 'danger', isAlert: true })

const currentAccountName = computed(() => {
  const acc = (accounts.value || []).find((a: any) => a.id === currentAccountId.value)
  return acc ? (acc.name || acc.nick || acc.id) : null
})

// 从分析接口获取作物列表（与「分析」页一致）
async function loadAnalytics() {
  if (!currentAccountId.value) return
  loading.value = true
  try {
    const res = await api.get('/api/analytics', {
      params: { sort: 'level' },
      headers: { 'x-account-id': currentAccountId.value },
    })
    const data = res.data?.data
    const list = Array.isArray(data)
      ? data.map((item: any) => ({
          seedId: Number(item.seedId),
          name: item.name || `ID:${item.seedId}`,
          image: item.image,
          level: item.level,
        }))
      : []
    // 等级低的作物优先展示
    cropList.value = list.sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
  } catch {
    cropList.value = []
  } finally {
    loading.value = false
  }
}

async function loadBlacklist() {
  if (!currentAccountId.value) return
  try {
    const res = await api.get('/api/steal-blacklist', {
      headers: { 'x-account-id': currentAccountId.value },
    })
    const data = res.data?.data
    blacklist.value = Array.isArray(data) ? data.map(Number).filter(n => Number.isFinite(n)) : []
  } catch {
    blacklist.value = []
  }
}

function getSafeImageUrl(url: string | undefined) {
  if (!url) return ''
  if (url.startsWith('http://')) return url.replace('http://', 'https://')
  return url
}

function loadData() {
  loadAnalytics()
  loadBlacklist()
}

onMounted(() => loadData())
watch(currentAccountId, () => loadData())

// 全选：全部设为不偷取（全部加入黑名单）
function selectAll() {
  blacklist.value = cropList.value.map(c => c.seedId)
}

// 清空：全部可偷取（清空黑名单）
function clearAll() {
  blacklist.value = []
}

async function save() {
  if (!currentAccountId.value) return
  saving.value = true
  try {
    await api.post(
      '/api/steal-blacklist',
      { seedIds: blacklist.value },
      { headers: { 'x-account-id': currentAccountId.value } },
    )
    modalConfig.value = { title: '提示', message: '偷取策略已保存，巡田时将跳过黑名单中的作物。', type: 'primary', isAlert: true }
    modalVisible.value = true
  } catch (e: any) {
    modalConfig.value = {
      title: '错误',
      message: e?.response?.data?.error || e?.message || '保存失败',
      type: 'danger',
      isAlert: true,
    }
    modalVisible.value = true
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="crop-steal-settings-page">
    <div v-if="loading" class="py-4 text-center text-gray-500 dark:text-gray-400">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else :class="embedded ? 'mt-0' : 'mt-12'">
      <div v-if="!currentAccountId" class="card-panel card p-8 text-center text-gray-500">
        请先选择账号
      </div>

      <div v-else class="card-panel card">
        <div class="card-panel-header flex items-center gap-2 text-gray-900 dark:text-gray-100">
          <h3 class="flex items-center gap-2 text-base font-bold">
            <div class="i-carbon-crop" />
            作物偷取设置
            <span v-if="currentAccountName" class="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
              ({{ currentAccountName }})
            </span>
          </h3>
        </div>

        <div class="p-4">
          <p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
            勾选「不偷取」的作物将加入偷取黑名单，脚本巡田时会跳过这些作物的偷取。点击保存后生效。
          </p>

          <div class="mb-4 flex flex-wrap items-center gap-2">
            <BaseButton variant="secondary" size="sm" @click="selectAll">
              全选（全部不偷取）
            </BaseButton>
            <BaseButton variant="secondary" size="sm" @click="clearAll">
              清空（全部可偷取）
            </BaseButton>
          </div>

          <div v-if="cropList.length === 0" class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            暂无作物数据，请确保账号已运行并可在「分析」页查看数据
          </div>

          <ul v-else class="grid max-h-[60vh] list-none gap-2 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-600 sm:grid-cols-2 md:grid-cols-3">
            <li
              v-for="crop in cropList"
              :key="crop.seedId"
              class="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/50 p-2 dark:border-gray-700 dark:bg-gray-700/30"
            >
              <div class="relative h-10 w-10 flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
                <img
                  v-if="crop.image && !imageErrors[crop.seedId]"
                  :src="getSafeImageUrl(crop.image)"
                  class="h-8 w-8 object-contain"
                  decoding="async"
                  @error="imageErrors[crop.seedId] = true"
                >
                <div v-else class="i-carbon-sprout text-xl text-gray-400" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {{ crop.name }}
                </div>
                <div class="text-xs text-gray-500">
                  Lv{{ crop.level ?? '?' }} · ID:{{ crop.seedId }}
                </div>
              </div>
              <label class="flex shrink-0 items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                <input
                  v-model="blacklist"
                  type="checkbox"
                  :value="crop.seedId"
                  class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                >
                <span>不偷取</span>
              </label>
            </li>
          </ul>

          <div class="mt-4 flex justify-end border-t border-gray-200 pt-4 dark:border-gray-700">
            <BaseButton variant="primary" size="sm" :loading="saving" @click="save">
              保存偷取策略
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>

<style scoped lang="postcss">
.crop-steal-settings-page {
  min-height: 100%;
}
</style>
