<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch, watchEffect } from 'vue'

defineProps<{ embedded?: boolean }>()
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useFarmStore } from '@/stores/farm'
import { useSettingStore } from '@/stores/setting'

const settingStore = useSettingStore()
const accountStore = useAccountStore()
const farmStore = useFarmStore()

const { settings, loading } = storeToRefs(settingStore)
const { currentAccountId, accounts } = storeToRefs(accountStore)
const { seeds } = storeToRefs(farmStore)

const saving = ref(false)
const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

function showAlert(message: string, type: 'primary' | 'danger' = 'primary') {
  modalConfig.value = {
    title: type === 'danger' ? '错误' : '提示',
    message,
    type,
    isAlert: true,
  }
  modalVisible.value = true
}

const currentAccountName = computed(() => {
  const acc = accounts.value.find((a: any) => a.id === currentAccountId.value)
  return acc ? (acc.name || acc.nick || acc.id) : null
})

/** 普通肥料施肥间隔默认值（毫秒），与后端 farm.js 一致 */
const FERTILIZER_INTERVAL_NORMAL_MS_DEFAULT = 50
/** 有机肥料施肥间隔默认值（毫秒），与后端 farm.js 一致 */
const FERTILIZER_INTERVAL_ORGANIC_MS_DEFAULT = 100

const local = ref({
  plantingStrategy: 'preferred',
  preferredSeedId: 0,
  stealDelaySeconds: 0,
  plantOrderRandom: false,
  fertilizerOrderRandom: false,
  plantDelaySeconds: 0,
  intervals: { farmMin: 2, farmMax: 2, friendMin: 10, friendMax: 10 },
  friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
  fertilizer_interval_normal_ms: FERTILIZER_INTERVAL_NORMAL_MS_DEFAULT,
  fertilizer_interval_organic_ms: FERTILIZER_INTERVAL_ORGANIC_MS_DEFAULT,
})

const plantingStrategyOptions = [
  { label: '优先种植种子', value: 'preferred' },
  { label: '最高等级作物', value: 'level' },
  { label: '最大经验/时', value: 'max_exp' },
  { label: '最大普通肥经验/时', value: 'max_fert_exp' },
  { label: '最大净利润/时', value: 'max_profit' },
  { label: '最大普通肥净利润/时', value: 'max_fert_profit' },
]

const preferredSeedOptions = computed(() => {
  const options = [{ label: '自动选择', value: 0 }]
  if (seeds.value) {
    options.push(...seeds.value.map(seed => ({
      label: `${seed.requiredLevel}级 ${seed.name} (${seed.price}金)`,
      value: seed.seedId,
      disabled: seed.locked || seed.soldOut,
    })))
  }
  return options
})

const analyticsSortByMap: Record<string, string> = {
  max_exp: 'exp',
  max_fert_exp: 'fert',
  max_profit: 'profit',
  max_fert_profit: 'fert_profit',
}

const strategyPreviewLabel = ref<string | null>(null)

watchEffect(async () => {
  const strategy = local.value.plantingStrategy
  if (strategy === 'preferred') {
    strategyPreviewLabel.value = null
    return
  }
  if (!seeds.value || seeds.value.length === 0) {
    strategyPreviewLabel.value = null
    return
  }
  const available = seeds.value.filter(s => !s.locked && !s.soldOut)
  if (available.length === 0) {
    strategyPreviewLabel.value = '暂无可用种子'
    return
  }
  if (strategy === 'level') {
    const best = [...available].sort((a, b) => b.requiredLevel - a.requiredLevel)[0]
    strategyPreviewLabel.value = best ? `${best.requiredLevel}级 ${best.name}` : null
    return
  }
  const sortBy = analyticsSortByMap[strategy]
  if (sortBy) {
    try {
      const res = await api.get(`/api/analytics?sort=${sortBy}`)
      const rankings: any[] = res.data.ok ? (res.data.data || []) : []
      const availableIds = new Set(available.map(s => s.seedId))
      const match = rankings.find(r => availableIds.has(Number(r.seedId)))
      if (match) {
        const seed = available.find(s => s.seedId === Number(match.seedId))
        strategyPreviewLabel.value = seed ? `${seed.requiredLevel}级 ${seed.name}` : null
      }
      else {
        strategyPreviewLabel.value = '暂无匹配种子'
      }
    }
    catch {
      strategyPreviewLabel.value = null
    }
  }
})

const defaultIntervals = () => ({ farmMin: 2, farmMax: 2, friendMin: 10, friendMax: 10 })

function syncFromStore() {
  if (settings.value) {
    local.value.plantingStrategy = settings.value.plantingStrategy ?? 'preferred'
    local.value.preferredSeedId = settings.value.preferredSeedId ?? 0
    local.value.stealDelaySeconds = settings.value.stealDelaySeconds ?? 0
    local.value.plantOrderRandom = !!settings.value.plantOrderRandom
    local.value.fertilizerOrderRandom = !!settings.value.fertilizerOrderRandom
    local.value.plantDelaySeconds = settings.value.plantDelaySeconds ?? 0
    local.value.intervals = {
      ...defaultIntervals(),
      ...settings.value.intervals,
      farmMin: settings.value.intervals?.farmMin ?? 2,
      farmMax: settings.value.intervals?.farmMax ?? 2,
      friendMin: settings.value.intervals?.friendMin ?? 10,
      friendMax: settings.value.intervals?.friendMax ?? 10,
    }
    const qh = settings.value.friendQuietHours
    local.value.friendQuietHours = {
      enabled: !!qh?.enabled,
      start: qh?.start ?? '23:00',
      end: qh?.end ?? '07:00',
    }
    const auto = settings.value.automation as any
    local.value.fertilizer_interval_normal_ms = auto?.fertilizer_interval_normal_ms ?? FERTILIZER_INTERVAL_NORMAL_MS_DEFAULT
    local.value.fertilizer_interval_organic_ms = auto?.fertilizer_interval_organic_ms ?? FERTILIZER_INTERVAL_ORGANIC_MS_DEFAULT
  }
}

async function loadData() {
  if (currentAccountId.value) {
    await settingStore.fetchSettings(currentAccountId.value)
    syncFromStore()
    await farmStore.fetchSeeds(currentAccountId.value)
  }
}

watch(currentAccountId, () => {
  loadData()
}, { immediate: true })

async function saveStrategy() {
  if (!currentAccountId.value)
    return
  saving.value = true
  try {
    const current = settings.value
    const merged = {
      ...current,
      plantingStrategy: local.value.plantingStrategy,
      preferredSeedId: local.value.preferredSeedId,
      stealDelaySeconds: local.value.stealDelaySeconds,
      plantOrderRandom: local.value.plantOrderRandom,
      fertilizerOrderRandom: local.value.fertilizerOrderRandom,
      plantDelaySeconds: local.value.plantDelaySeconds,
      intervals: local.value.intervals,
      friendQuietHours: local.value.friendQuietHours,
      automation: {
        ...(current?.automation || {}),
        fertilizer_interval_normal_ms: local.value.fertilizer_interval_normal_ms,
        fertilizer_interval_organic_ms: local.value.fertilizer_interval_organic_ms,
      },
    }
    const res = await settingStore.saveSettings(currentAccountId.value, merged)
    if (res.ok) {
      showAlert('策略设置已保存')
    }
    else {
      showAlert(`保存失败: ${res.error}`, 'danger')
    }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="strategy-settings">
    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 text-sm" :class="embedded ? 'mt-0 p-4' : 'mt-12'">
      <div v-if="currentAccountId" class="card-panel card h-full flex flex-col">
        <div class="card-panel-header flex items-center gap-2 text-gray-900 dark:text-gray-100">
          <h3 class="flex items-center gap-2 text-base font-bold">
            <div class="i-fas-cogs" />
            策略设置
            <span v-if="currentAccountName" class="ml-2 text-sm text-gray-500 font-normal dark:text-gray-400">
              ({{ currentAccountName }})
            </span>
          </h3>
        </div>

        <div class="flex flex-1 flex-col gap-6 p-4">
          <!-- 种植策略 -->
          <div class="space-y-3">
            <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
              种植策略
            </h4>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <BaseSelect
                v-model="local.plantingStrategy"
                label="种植策略"
                :options="plantingStrategyOptions"
              />
              <BaseSelect
                v-if="local.plantingStrategy === 'preferred'"
                v-model="local.preferredSeedId"
                label="优先种植种子"
                :options="preferredSeedOptions"
              />
              <div v-else class="flex flex-col gap-1">
                <span class="text-xs text-gray-500 dark:text-gray-400">策略选种预览</span>
                <div class="h-9 flex items-center border border-gray-200 rounded-md bg-gray-50 px-3 text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-700/50 dark:text-gray-300">
                  {{ strategyPreviewLabel ?? '加载中...' }}
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
              <BaseInput
                v-model.number="local.intervals.farmMin"
                label="农场巡查最小 (秒)"
                type="number"
                min="1"
              />
              <BaseInput
                v-model.number="local.intervals.farmMax"
                label="农场巡查最大 (秒)"
                type="number"
                min="1"
              />
              <BaseInput
                v-model.number="local.intervals.friendMin"
                label="好友巡查最小 (秒)"
                type="number"
                min="1"
              />
              <BaseInput
                v-model.number="local.intervals.friendMax"
                label="好友巡查最大 (秒)"
                type="number"
                min="1"
              />
              <BaseInput
                v-model.number="local.stealDelaySeconds"
                label="作物偷取延迟 (秒)"
                type="number"
                min="0"
                placeholder="0"
              />
              <BaseInput
                v-model.number="local.plantDelaySeconds"
                label="种植作物延迟 (秒)"
                type="number"
                min="0"
                max="60"
                placeholder="0"
              />
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              巡田时若好友作物已成熟，将先等待「作物偷取延迟」秒数再执行偷取；「种植作物延迟」为每块地种植之间的间隔秒数，0 表示使用默认间隔。
            </p>

            <div class="flex flex-wrap items-center gap-4 border-t border-gray-200/80 pt-3 dark:border-gray-700">
              <BaseSwitch
                v-model="local.plantOrderRandom"
                label="作物种植顺序随机"
              />
              <BaseSwitch
                v-model="local.fertilizerOrderRandom"
                label="施肥顺序随机"
              />
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              作物种植顺序随机：在自己农田种植时按随机顺序种植各地块。施肥顺序随机：施肥时随机打乱可施肥地块顺序后再执行。
            </p>

            <div class="flex flex-wrap items-center gap-4 border-t pt-3 dark:border-gray-700">
              <BaseSwitch
                v-model="local.friendQuietHours.enabled"
                label="启用静默时段"
              />
              <div class="flex items-center gap-2">
                <BaseInput
                  v-model="local.friendQuietHours.start"
                  type="time"
                  class="w-24"
                  :disabled="!local.friendQuietHours.enabled"
                />
                <span class="text-gray-500">-</span>
                <BaseInput
                  v-model="local.friendQuietHours.end"
                  type="time"
                  class="w-24"
                  :disabled="!local.friendQuietHours.enabled"
                />
              </div>
            </div>
          </div>

          <!-- 施肥间隔（连续施有机肥等使用） -->
          <div class="space-y-3 border-t pt-4 dark:border-gray-700">
            <h4 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
              施肥间隔
            </h4>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BaseInput
                v-model.number="local.fertilizer_interval_normal_ms"
                label="普通肥料施肥间隔 (毫秒)"
                type="number"
                min="0"
                max="60000"
                :placeholder="String(FERTILIZER_INTERVAL_NORMAL_MS_DEFAULT)"
              />
              <BaseInput
                v-model.number="local.fertilizer_interval_organic_ms"
                label="有机肥料施肥间隔 (毫秒)"
                type="number"
                min="0"
                max="60000"
                :placeholder="String(FERTILIZER_INTERVAL_ORGANIC_MS_DEFAULT)"
              />
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              普通肥按地块逐块施肥，每块间隔为上方毫秒数（默认 {{ FERTILIZER_INTERVAL_NORMAL_MS_DEFAULT }}ms）；连续施有机肥时每次间隔为有机肥间隔（默认 {{ FERTILIZER_INTERVAL_ORGANIC_MS_DEFAULT }}ms）。设为 0 表示无间隔。
            </p>
          </div>
        </div>

        <div class="mt-auto flex justify-end border-t bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/50">
          <BaseButton
            variant="primary"
            size="sm"
            :loading="saving"
            @click="saveStrategy"
          >
            保存策略设置
          </BaseButton>
        </div>
      </div>

      <div v-else class="card-panel card flex flex-col items-center justify-center gap-4 p-12 text-center">
        <div class="rounded-full bg-gray-50 p-4 dark:bg-gray-700/50">
          <div class="i-carbon-settings-adjust text-4xl text-gray-400 dark:text-gray-500" />
        </div>
        <div class="max-w-xs">
          <h3 class="text-lg text-gray-900 font-medium dark:text-gray-100">
            需要选择账号
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            请先在首页选择要配置的 QQ 账号。
          </p>
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
