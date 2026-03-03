<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useCardStore } from '@/stores/card'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])

const cardStore = useCardStore()
const toast = useToastStore()

const activeTab = ref('qr') // qr, manual
const loading = ref(false)
const qrData = ref<{ image?: string, code: string, qrcode?: string, url?: string } | null>(null)
const qrStatus = ref('')
const errorMessage = ref('')

// 添加账号时的卡密验证（仅新增时使用）
const cardCode = ref('')
const cardVerified = ref(false)
const cardVerifyMessage = ref('')
const cardVerifyLoading = ref(false)
const verifiedCardInfo = ref<{ type?: string, expiresAt?: number | null } | null>(null)
// QQ 账号验证：若该 QQ 已激活且未过期则可跳过卡密直接扫码
const qqUin = ref('')
const uinVerifyLoading = ref(false)
const uinVerifyMessage = ref('')
const skipCardByUin = ref(false)

const form = reactive({
  name: '',
  code: '',
  platform: 'qq',
})

const needCardVerify = computed(() => !props.editData)
const canProceedAdd = computed(() => !needCardVerify.value || cardVerified.value)

const cardTypeLabel: Record<string, string> = {
  day: '天卡',
  week: '周卡',
  month: '月卡',
  year: '年卡',
  permanent: '永久卡',
}

const { pause: stopQRCheck, resume: startQRCheck } = useIntervalFn(async () => {
  if (!qrData.value)
    return
  try {
    const res = await api.post('/api/qr/check', { code: qrData.value.code })
    if (res.data.ok) {
      const status = res.data.data.status
      if (status === 'OK') {
        // Login success
        stopQRCheck()
        qrStatus.value = '登录成功'
        // Auto fill form and submit
        const { uin, code: authCode, nickname } = res.data.data

        // Use name from form if provided, otherwise default
        let accName = form.name.trim()
        if (!accName) {
          // 优先使用 nickname，其次使用 uin
          accName = nickname || (uin ? String(uin) : '扫码账号')
        }

        // We need to add account with this data
        await addAccount({
          id: props.editData?.id,
          uin,
          code: authCode,
          loginType: 'qr',
          name: props.editData ? (props.editData.name || accName) : accName,
          platform: 'qq',
        })
      }
      else if (status === 'Used') {
        qrStatus.value = '二维码已失效' // Consistent text
        stopQRCheck()
      }
      else if (status === 'Wait') {
        qrStatus.value = '等待扫码'
      }
      else {
        qrStatus.value = `错误: ${res.data.data.error}`
      }
    }
  }
  catch (e) {
    console.error(e)
  }
}, 1000, { immediate: false })

async function verifyUin() {
  const uin = qqUin.value.trim()
  if (!uin) {
    uinVerifyMessage.value = '请输入QQ号'
    return
  }
  uinVerifyLoading.value = true
  uinVerifyMessage.value = ''
  try {
    const result = await cardStore.checkUinActivation(uin)
    if (result.canSkipCard) {
      cardVerified.value = true
      skipCardByUin.value = true
      uinVerifyMessage.value = result.message || '该QQ已激活且未过期，可直接扫码添加'
      cardVerifyMessage.value = result.message || ''
    }
    else {
      cardVerified.value = false
      skipCardByUin.value = false
      uinVerifyMessage.value = result.message || '该QQ尚未激活或已过期'
    }
  }
  catch (e) {
    cardVerified.value = false
    skipCardByUin.value = false
    uinVerifyMessage.value = '验证失败，请重试'
  }
  finally {
    uinVerifyLoading.value = false
  }
}

async function verifyCardKey() {
  const code = cardCode.value.trim()
  if (!code) {
    cardVerifyMessage.value = '请输入卡密'
    return
  }
  skipCardByUin.value = false
  cardVerifyLoading.value = true
  cardVerifyMessage.value = ''
  verifiedCardInfo.value = null
  try {
    const result = await cardStore.verifyCard(code)
    if (result.valid && result.card) {
      cardVerified.value = true
      cardVerifyMessage.value = '卡密有效'
      verifiedCardInfo.value = {
        type: result.card.type,
        expiresAt: result.card.expiresAt,
      }
    }
    else {
      cardVerified.value = false
      cardVerifyMessage.value = result.message || '卡密无效'
    }
  }
  catch (e) {
    cardVerified.value = false
    cardVerifyMessage.value = '验证失败，请重试'
  }
  finally {
    cardVerifyLoading.value = false
  }
}

function formatCardExpiry(expiresAt: number | null | undefined) {
  if (expiresAt == null) return '永久'
  return new Date(expiresAt).toLocaleString('zh-CN')
}

// QR Code Logic
async function loadQRCode() {
  if (activeTab.value !== 'qr')
    return
  if (needCardVerify.value && !cardVerified.value)
    return
  loading.value = true
  qrStatus.value = '正在获取二维码'
  errorMessage.value = ''
  try {
    const res = await api.post('/api/qr/create')
    if (res.data.ok) {
      qrData.value = res.data.data
      qrStatus.value = '请使用手机QQ扫码'
      startQRCheck()
    }
    else {
      qrStatus.value = `获取失败: ${res.data.error}`
    }
  }
  catch (e) {
    qrStatus.value = '获取失败'
    console.error(e)
  }
  finally {
    loading.value = false
  }
}

const isMobile = computed(() => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent))

function openQRCodeLoginUrl() {
  if (!qrData.value?.url)
    return

  const url = qrData.value.url
  if (!isMobile.value) {
    window.open(url, '_blank')
    return
  }

  // Mobile Deep Link logic
  try {
    const b64 = btoa(decodeURIComponent(encodeURIComponent(url)))
    const qqDeepLink = `mqqapi://forward/url?url_prefix=${encodeURIComponent(b64)}&version=1&src_type=web`
    window.location.href = qqDeepLink
  }
  catch (e) {
    console.error('打开二维码登录链接失败:', e)
    window.location.href = url
  }
}

async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    if (res.data.ok) {
      const accounts = res.data.data?.accounts
      const newAccountId = Array.isArray(accounts) && accounts.length > 0
        ? (accounts[accounts.length - 1]?.id)
        : null
      if (needCardVerify.value && cardVerified.value && !skipCardByUin.value && cardCode.value.trim() && newAccountId) {
        try {
          await cardStore.activateCard(cardCode.value.trim(), newAccountId)
        }
        catch (e: any) {
          toast.error(e?.message || '卡密激活失败')
        }
      }
      emit('saved')
      close()
    }
    else {
      errorMessage.value = `保存失败: ${res.data.error}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${e.response?.data?.error || e.message}`
  }
  finally {
    loading.value = false
  }
}

async function submitManual() {
  errorMessage.value = ''
  if (needCardVerify.value && !cardVerified.value) {
    errorMessage.value = '请先验证卡密'
    return
  }
  if (!form.code) {
    errorMessage.value = '请输入Code 或 进行扫码'
    return
  }

  if (!form.name && props.editData) {
    errorMessage.value = '请输入名称'
    return
  }

  let code = form.code.trim()
  // Try to extract code from URL if present
  const match = code.match(/[?&]code=([^&]+)/i)
  if (match && match[1]) {
    code = decodeURIComponent(match[1])
    form.code = code // Update UI
  }

  const payload = {
    id: props.editData?.id, // If editing
    name: form.name,
    code,
    platform: form.platform,
    loginType: 'manual',
  }

  await addAccount(payload)
}

function close() {
  stopQRCheck()
  cardVerified.value = false
  cardCode.value = ''
  cardVerifyMessage.value = ''
  verifiedCardInfo.value = null
  qqUin.value = ''
  uinVerifyMessage.value = ''
  skipCardByUin.value = false
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    cardVerified.value = false
    cardCode.value = ''
    cardVerifyMessage.value = ''
    verifiedCardInfo.value = null
    qqUin.value = ''
    uinVerifyMessage.value = ''
    skipCardByUin.value = false
    if (props.editData) {
      activeTab.value = 'qr'
      form.name = props.editData.name
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      loadQRCode()
    }
    else {
      activeTab.value = 'qr'
      form.name = ''
      form.code = ''
      form.platform = 'qq'
      // 添加模式不自动拉取二维码，等卡密验证通过后再允许获取
      qrData.value = null
      qrStatus.value = '请先验证卡密'
    }
  }
  else {
    stopQRCheck()
    qrData.value = null
    qrStatus.value = ''
  }
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="max-w-md w-full overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800">
      <div class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
        <h3 class="text-lg font-semibold">
          {{ editData ? '编辑账号' : '添加账号' }}
        </h3>
        <BaseButton
          variant="outline"
          size="sm"
          class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 focus:ring-green-500 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
          title="关闭"
          aria-label="关闭"
          @click="close"
        >
          关闭
        </BaseButton>
      </div>

      <div class="p-4">
        <div v-if="errorMessage" class="mb-4 rounded bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ errorMessage }}
        </div>

        <!-- 添加账号：QQ 验证 或 卡密验证（仅新增时显示） -->
        <div v-if="needCardVerify" class="mb-4 space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
            添加账号需先验证：可验证 QQ 号（已激活且未过期则无需卡密），或验证卡密
          </p>
          <!-- QQ 账号验证 -->
          <div class="flex flex-wrap items-end gap-2">
            <BaseInput
              v-model="qqUin"
              placeholder="请输入QQ号（可选）"
              class="min-w-0 flex-1 font-mono text-sm"
              :disabled="cardVerified"
            />
            <BaseButton
              v-if="!cardVerified"
              variant="outline"
              size="sm"
              :loading="uinVerifyLoading"
              @click="verifyUin"
            >
              验证
            </BaseButton>
            <div v-else class="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <span class="i-carbon-checkmark-filled" />
              已通过验证
            </div>
          </div>
          <p
            v-if="uinVerifyMessage"
            class="text-sm"
            :class="cardVerified && skipCardByUin ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'"
          >
            {{ uinVerifyMessage }}
          </p>
          <!-- 卡密验证（QQ 未通过验证时需填写） -->
          <div v-if="!skipCardByUin" class="border-t border-gray-200 pt-3 dark:border-gray-600">
            <p class="mb-2 text-sm text-gray-600 dark:text-gray-400">
              或输入卡密验证
            </p>
            <div class="flex gap-2">
              <BaseInput
                v-model="cardCode"
                placeholder="请输入卡密"
                class="flex-1 font-mono text-sm"
                :disabled="cardVerified"
              />
              <BaseButton
                v-if="!cardVerified"
                variant="primary"
                :loading="cardVerifyLoading"
                @click="verifyCardKey"
              >
                验证卡密
              </BaseButton>
              <div v-else class="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <span class="i-carbon-checkmark-filled" />
                已验证
              </div>
            </div>
            <p
              v-if="cardVerifyMessage && !skipCardByUin"
              class="mt-2 text-sm"
              :class="cardVerified ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
            >
              {{ cardVerifyMessage }}
              <template v-if="cardVerified && verifiedCardInfo">
                · {{ (verifiedCardInfo.type && cardTypeLabel[verifiedCardInfo.type]) || verifiedCardInfo.type || '—' }}，到期：{{ formatCardExpiry(verifiedCardInfo.expiresAt) }}
              </template>
            </p>
          </div>
        </div>

        <!-- Tabs（添加模式下未验证卡密时仍显示，但内容区提示先验证） -->
        <div class="mb-4 flex border-b border-gray-200 dark:border-gray-700">
          <button
            class="flex-1 py-2 text-center font-medium"
            :class="[activeTab === 'qr' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500', !canProceedAdd && 'opacity-60']"
            @click="activeTab = 'qr'; if (canProceedAdd) loadQRCode()"
          >
            {{ editData ? '扫码更新' : '扫码登录' }}
          </button>
          <button
            class="flex-1 py-2 text-center font-medium"
            :class="[activeTab === 'manual' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500', !canProceedAdd && 'opacity-60']"
            @click="activeTab = 'manual'; stopQRCheck()"
          >
            手动填码
          </button>
        </div>

        <!-- QR Tab -->
        <div v-if="activeTab === 'qr'" class="flex flex-col items-center justify-center py-4 space-y-4">
          <template v-if="!canProceedAdd">
            <div class="h-48 w-48 flex items-center justify-center rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
              请先验证 QQ 号或卡密后再扫码添加
            </div>
          </template>
          <template v-else>
            <div class="w-full text-center">
              <p class="text-sm text-gray-500 dark:text-gray-400">
                扫码默认使用QQ昵称
              </p>
            </div>

            <div v-if="qrData && (qrData.image || qrData.qrcode)" class="border rounded bg-white p-2">
              <img :src="qrData.image ? (qrData.image.startsWith('data:') ? qrData.image : `data:image/png;base64,${qrData.image}`) : qrData.qrcode" class="h-48 w-48">
            </div>
            <div v-else class="h-48 w-48 flex items-center justify-center rounded bg-gray-100 text-gray-400 dark:bg-gray-700">
              <div v-if="loading" i-svg-spinners-90-ring-with-bg class="text-3xl" />
              <span v-else>点击下方获取二维码</span>
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ qrStatus }}
            </p>
            <div class="flex gap-2">
              <BaseButton variant="text" size="sm" @click="loadQRCode">
                获取二维码
              </BaseButton>
              <BaseButton
                v-if="qrData?.url"
                variant="text"
                size="sm"
                class="text-blue-600 md:hidden"
                @click="openQRCodeLoginUrl"
              >
                跳转QQ登录
              </BaseButton>
            </div>
          </template>
        </div>

        <!-- Manual Tab -->
        <div v-if="activeTab === 'manual'" class="space-y-4">
          <BaseInput
            v-model="form.name"
            label="备注名称"
            placeholder="留空默认账号X"
          />

          <BaseTextarea
            v-model="form.code"
            label="Code"
            placeholder="请输入登录 Code"
            :rows="3"
          />

          <BaseSelect
            v-if="!editData"
            v-model="form.platform"
            label="平台"
            :options="[
              { label: 'QQ小程序', value: 'qq' },
              { label: '微信小程序', value: 'wx' },
            ]"
          />

          <div class="flex justify-end gap-2 pt-4">
            <BaseButton
              variant="outline"
              size="sm"
              class="border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30"
              @click="close"
            >
              取消
            </BaseButton>
            <BaseButton
              variant="success"
              :loading="loading"
              @click="submitManual"
            >
              {{ editData ? '保存' : '添加' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
