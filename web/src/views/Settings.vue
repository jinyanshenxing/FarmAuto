<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted, ref, watch } from 'vue'

defineProps<{ embedded?: boolean }>()
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useSettingStore } from '@/stores/setting'

const settingStore = useSettingStore()
const accountStore = useAccountStore()
const appStore = useAppStore()

const { settings, loading } = storeToRefs(settingStore)
const { currentAccountId } = storeToRefs(accountStore)
const { userRole } = storeToRefs(appStore)

const saving = ref(false)
const passwordSaving = ref(false)

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

const localSettings = ref({
  plantingStrategy: 'preferred',
  preferredSeedId: 0,
  stealDelaySeconds: 0,
  plantOrderRandom: false,
  plantDelaySeconds: 0,
  intervals: { farmMin: 2, farmMax: 2, friendMin: 10, friendMax: 10 },
  friendQuietHours: { enabled: false, start: '23:00', end: '07:00' },
  friendOpOrder: ['help', 'steal', 'bad'] as ('help' | 'steal' | 'bad')[],
  automation: {
    farm: false,
    task: false,
    sell: false,
    friend: false,
    farm_push: false,
    land_upgrade: false,
    farm_water: true,
    farm_weed: true,
    farm_bug: true,
    friend_steal: false,
    friend_water: false,
    friend_weed: false,
    friend_bug: false,
    friend_bad: false,
    friend_help_exp_limit: false,
    email: false,
    fertilizer_gift: false,
    fertilizer_buy: false,
    farm_fertilizer_normal: true,
    farm_fertilizer_organic_once: false,
    farm_fertilizer_anti_steal: false,
    farm_fertilizer_anti_steal_sec: 300,
    farm_fertilizer_organic_loop: false,
    farm_fertilizer_use_gift_pack: true,
    free_gifts: false,
    share_reward: false,
    vip_gift: false,
    month_card: false,
    open_server_gift: false,
    fertilizer: 'none',
  },
})

const passwordForm = ref({
  old: '',
  new: '',
  confirm: '',
})

function syncLocalSettings() {
  if (settings.value) {
    localSettings.value = JSON.parse(JSON.stringify({
      plantingStrategy: settings.value.plantingStrategy,
      preferredSeedId: settings.value.preferredSeedId,
      stealDelaySeconds: settings.value.stealDelaySeconds ?? 0,
      plantOrderRandom: !!settings.value.plantOrderRandom,
      plantDelaySeconds: settings.value.plantDelaySeconds ?? 0,
      intervals: settings.value.intervals,
      friendQuietHours: settings.value.friendQuietHours,
      friendOpOrder: Array.isArray(settings.value.friendOpOrder) ? [...settings.value.friendOpOrder] : ['help', 'steal', 'bad'],
      automation: settings.value.automation,
    }))

    // Default automation values if missing
    if (!localSettings.value.automation) {
      localSettings.value.automation = {
        farm: false,
        task: false,
        sell: false,
        friend: false,
        farm_push: false,
        land_upgrade: false,
        farm_water: true,
        farm_weed: true,
        farm_bug: true,
        friend_steal: false,
        friend_water: false,
        friend_weed: false,
        friend_bug: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        email: false,
        fertilizer_gift: false,
        fertilizer_buy: false,
        farm_fertilizer_normal: true,
        farm_fertilizer_organic_once: false,
        farm_fertilizer_anti_steal: false,
        farm_fertilizer_anti_steal_sec: 300,
        farm_fertilizer_organic_loop: false,
        farm_fertilizer_use_gift_pack: true,
        free_gifts: false,
        share_reward: false,
        vip_gift: false,
        month_card: false,
        open_server_gift: false,
        fertilizer: 'none',
      }
    }
    else {
      // Merge with defaults to ensure all keys exist
      const defaults = {
        farm: false,
        task: false,
        sell: false,
        friend: false,
        farm_push: false,
        land_upgrade: false,
        farm_water: true,
        farm_weed: true,
        farm_bug: true,
        friend_steal: false,
        friend_water: false,
        friend_weed: false,
        friend_bug: false,
        friend_bad: false,
        friend_help_exp_limit: false,
        email: false,
        fertilizer_gift: false,
        fertilizer_buy: false,
        farm_fertilizer_normal: true,
        farm_fertilizer_organic_once: false,
        farm_fertilizer_anti_steal: false,
        farm_fertilizer_anti_steal_sec: 300,
        farm_fertilizer_organic_loop: false,
        farm_fertilizer_use_gift_pack: true,
        free_gifts: false,
        share_reward: false,
        vip_gift: false,
        month_card: false,
        open_server_gift: false,
        fertilizer: 'none',
      }
      localSettings.value.automation = {
        ...defaults,
        ...localSettings.value.automation,
      }
    }

  }
}

async function loadData() {
  if (currentAccountId.value) {
    await settingStore.fetchSettings(currentAccountId.value)
    syncLocalSettings()
  }
}

onMounted(() => {
  loadData()
})

watch(currentAccountId, () => {
  loadData()
})

const FRIEND_OP_STEP_LABELS: Record<string, string> = {
  help: '帮助（除草 / 除虫 / 浇水）',
  steal: '偷菜',
  bad: '捣乱（放虫 / 放草）',
}

function moveFriendOpStep(index: number, direction: 'up' | 'down') {
  const order = localSettings.value.friendOpOrder
  if (!Array.isArray(order) || order.length !== 3) return
  const next: ('help' | 'steal' | 'bad')[] = [...order]
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= next.length) return
  const a = next[index]
  const b = next[target]
  if (a == null || b == null) return
  next[index] = b
  next[target] = a
  localSettings.value.friendOpOrder = next
}

async function saveAccountSettings() {
  if (!currentAccountId.value)
    return
  saving.value = true
  try {
    const res = await settingStore.saveSettings(currentAccountId.value, localSettings.value)
    if (res.ok) {
      showAlert('账号设置已保存')
    }
    else {
      showAlert(`保存失败: ${res.error}`, 'danger')
    }
  }
  finally {
    saving.value = false
  }
}

async function handleChangePassword() {
  if (!passwordForm.value.old || !passwordForm.value.new) {
    showAlert('请填写完整', 'danger')
    return
  }
  if (passwordForm.value.new !== passwordForm.value.confirm) {
    showAlert('两次密码输入不一致', 'danger')
    return
  }
  if (passwordForm.value.new.length < 4) {
    showAlert('密码长度至少4位', 'danger')
    return
  }

  passwordSaving.value = true
  try {
    const res = await settingStore.changeAdminPassword(passwordForm.value.old, passwordForm.value.new)

    if (res.ok) {
      showAlert('密码修改成功')
      passwordForm.value = { old: '', new: '', confirm: '' }
    }
    else {
      showAlert(`修改失败: ${res.error || '未知错误'}`, 'danger')
    }
  }
  finally {
    passwordSaving.value = false
  }
}

</script>

<template>
  <div class="settings-page">
    <div v-if="loading" class="py-4 text-center text-gray-500">
      <div class="i-svg-spinners-ring-resize mx-auto mb-2 text-2xl" />
      <p>加载中...</p>
    </div>

    <div v-else class="grid grid-cols-1 gap-4 text-sm lg:grid-cols-2" :class="embedded ? 'mt-0 p-4' : 'mt-12'">
      <!-- Card 1: Automation -->
      <div v-if="currentAccountId" class="card-panel card h-full flex flex-col">
        <!-- Auto Control Header -->
        <div class="card-panel-header flex items-center gap-2 text-gray-900 dark:text-gray-100">
          <h3 class="flex items-center gap-2 text-base font-bold">
            <div class="i-fas-toggle-on" />
            自动控制
          </h3>
        </div>

        <!-- Auto Control Content -->
        <div class="flex-1 p-4 space-y-4">
          <!-- Switches Grid -->
          <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
            <BaseSwitch v-model="localSettings.automation.farm" label="自动种植收获" />
            <BaseSwitch v-model="localSettings.automation.task" label="自动做任务" />
            <BaseSwitch v-model="localSettings.automation.sell" label="自动卖果实" />
            <BaseSwitch v-model="localSettings.automation.friend" label="自动好友互动" />
            <BaseSwitch v-model="localSettings.automation.farm_push" label="推送触发巡田" />
            <BaseSwitch v-model="localSettings.automation.land_upgrade" label="自动升级土地" />
            <BaseSwitch v-model="localSettings.automation.farm_water" label="自动浇水" />
            <BaseSwitch v-model="localSettings.automation.farm_weed" label="自动除草" />
            <BaseSwitch v-model="localSettings.automation.farm_bug" label="自动除虫" />
            <BaseSwitch v-model="localSettings.automation.email" label="自动领取邮件" />
            <BaseSwitch v-model="localSettings.automation.free_gifts" label="自动商城礼包" />
            <BaseSwitch v-model="localSettings.automation.share_reward" label="自动分享奖励" />
            <BaseSwitch v-model="localSettings.automation.vip_gift" label="自动VIP礼包" />
            <BaseSwitch v-model="localSettings.automation.month_card" label="自动月卡奖励" />
            <BaseSwitch v-model="localSettings.automation.open_server_gift" label="自动开服红包" />
            <BaseSwitch v-model="localSettings.automation.fertilizer_gift" label="自动填充化肥" />
            <BaseSwitch v-model="localSettings.automation.fertilizer_buy" label="自动购买化肥" />
          </div>

          <!-- 施肥细分控制（打开自动填充化肥后展开） -->
          <div v-if="localSettings.automation.fertilizer_gift" class="space-y-3">
            <div class="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-800/40 dark:bg-emerald-900/20">
              <div class="mb-2 flex items-center gap-1.5 text-xs text-emerald-700 font-medium dark:text-emerald-400">
                <div class="i-carbon-chemistry" />
                施肥细分控制
              </div>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <BaseSwitch v-model="localSettings.automation.farm_fertilizer_use_gift_pack" label="自动使用化肥礼包" />
                <BaseSwitch v-model="localSettings.automation.farm_fertilizer_normal" label="自动普通肥料" />
                <BaseSwitch v-model="localSettings.automation.farm_fertilizer_organic_once" label="自动施一次有机肥料" />
                <BaseSwitch v-model="localSettings.automation.farm_fertilizer_anti_steal" label="防偷" />
                <BaseSwitch v-model="localSettings.automation.farm_fertilizer_organic_loop" label="连续施有机肥" />
              </div>
              <div v-if="localSettings.automation.farm_fertilizer_anti_steal" class="mt-2 flex items-center gap-2">
                <BaseInput
                  v-model.number="localSettings.automation.farm_fertilizer_anti_steal_sec"
                  label="防偷识别秒数"
                  type="number"
                  min="0"
                  max="86400"
                  placeholder="300"
                  class="w-32"
                />
                <span class="text-xs text-emerald-600 dark:text-emerald-500">秒内成熟则施一次有机肥加速，防好友偷取</span>
              </div>
              <p class="mt-2 text-xs text-emerald-600 dark:text-emerald-500">
                自动使用化肥礼包：自动打开背包中的化肥礼包。自动普通肥料：作物种植后第一时间施普通肥。自动施一次有机肥：种植后施一次有机肥。防偷：自己农田剩余成熟时间≤上述秒数时自动施一次有机肥加速。连续施有机肥：按策略设置中的施肥间隔连续施有机肥。
              </p>
            </div>
          </div>

          <!-- 好友互动子开关 -->
          <div v-if="localSettings.automation.friend" class="space-y-3">
            <div class="rounded-lg border border-blue-200 bg-blue-50/80 p-3 dark:border-blue-800/40 dark:bg-blue-900/20">
              <div class="mb-2 flex items-center gap-1.5 text-xs text-blue-600 font-medium dark:text-blue-400">
                <div class="i-carbon-settings-adjust" />
                好友互动细分控制
              </div>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <BaseSwitch v-model="localSettings.automation.friend_steal" label="自动偷取作物" />
                <BaseSwitch v-model="localSettings.automation.friend_water" label="自动好友浇水" />
                <BaseSwitch v-model="localSettings.automation.friend_weed" label="自动好友除草" />
                <BaseSwitch v-model="localSettings.automation.friend_bug" label="自动好友除虫" />
                <BaseSwitch v-model="localSettings.automation.friend_bad" label="自动捣乱" />
                <BaseSwitch v-model="localSettings.automation.friend_help_exp_limit" label="经验上限停帮忙" />
              </div>
            </div>
            <!-- 好友操作执行顺序 -->
            <div class="rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-800/40 dark:bg-amber-900/20">
              <div class="mb-2 flex items-center gap-1.5 text-xs text-amber-700 font-medium dark:text-amber-400">
                <div class="i-carbon-list-numbered" />
                访问好友时的执行顺序
              </div>
              <p class="mb-2 text-xs text-amber-600 dark:text-amber-500">
                可调整三种操作的执行先后，保存后脚本将按此顺序在好友互动时执行。
              </p>
              <div class="flex flex-col gap-2">
                <div
                  v-for="(step, idx) in (localSettings.friendOpOrder || ['help','steal','bad'])"
                  :key="step"
                  class="flex items-center gap-2 rounded border border-amber-200 bg-white py-2 pl-3 pr-2 dark:border-amber-700 dark:bg-gray-800/50"
                >
                  <span class="w-6 shrink-0 text-sm font-medium text-amber-600 dark:text-amber-400">{{ idx + 1 }}</span>
                  <span class="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-300">{{ FRIEND_OP_STEP_LABELS[step] || step }}</span>
                  <div class="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      class="rounded p-1.5 text-gray-500 hover:bg-amber-100 hover:text-amber-700 disabled:opacity-40 dark:hover:bg-amber-900/40 dark:hover:text-amber-300"
                      :disabled="idx === 0"
                      :aria-label="'上移'"
                      @click="moveFriendOpStep(idx, 'up')"
                    >
                      <div class="i-carbon-chevron-up text-lg" />
                    </button>
                    <button
                      type="button"
                      class="rounded p-1.5 text-gray-500 hover:bg-amber-100 hover:text-amber-700 disabled:opacity-40 dark:hover:bg-amber-900/40 dark:hover:text-amber-300"
                      :disabled="idx === (localSettings.friendOpOrder?.length ?? 3) - 1"
                      :aria-label="'下移'"
                      @click="moveFriendOpStep(idx, 'down')"
                    >
                      <div class="i-carbon-chevron-down text-lg" />
                    </button>
                  </div>
                </div>
          </div>
          </div>
          </div>
        </div>

        <!-- Save Button -->
        <div class="mt-auto flex justify-end border-t bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/50">
          <BaseButton
            variant="primary"
            size="sm"
            :loading="saving"
            @click="saveAccountSettings"
          >
            保存自动设置
          </BaseButton>
        </div>
      </div>

      <div v-else class="card-panel card flex flex-col items-center justify-center gap-4 p-12 text-center">
        <div class="rounded-full bg-gray-50 p-4 dark:bg-gray-700/50">
          <div class="i-carbon-settings-adjust text-4xl text-gray-400 dark:text-gray-500" />
        </div>
        <div class="max-w-xs">
          <h3 class="text-lg text-gray-900 font-medium dark:text-gray-100">
            需要登录账号
          </h3>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            请先登录账号以配置策略和自动化选项。
          </p>
        </div>
      </div>

      <!-- Card 2: System Settings (Password & Offline) -->
      <div class="card-panel card h-full flex flex-col">
        <!-- 管理密码：仅管理员可见 -->
        <template v-if="userRole === 'admin'">
          <!-- Password Header -->
          <div class="card-panel-header flex items-center gap-2 text-gray-900 dark:text-gray-100">
            <h3 class="flex items-center gap-2 text-base font-bold">
              <div class="i-carbon-password" />
              管理密码
            </h3>
          </div>

          <!-- Password Content -->
          <div class="p-4 space-y-3">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <BaseInput
                v-model="passwordForm.old"
                label="当前密码"
                type="password"
                placeholder="当前管理密码"
              />
              <BaseInput
                v-model="passwordForm.new"
                label="新密码"
                type="password"
                placeholder="至少 4 位"
              />
              <BaseInput
                v-model="passwordForm.confirm"
                label="确认新密码"
                type="password"
                placeholder="再次输入新密码"
              />
            </div>

            <div class="flex items-center justify-between pt-1">
              <p class="text-xs text-gray-500">
                建议修改默认密码 (admin)
              </p>
              <BaseButton
                variant="primary"
                size="sm"
                :loading="passwordSaving"
                @click="handleChangePassword"
              >
                修改管理密码
              </BaseButton>
            </div>
          </div>
        </template>
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
/* Custom styles if needed */
</style>
