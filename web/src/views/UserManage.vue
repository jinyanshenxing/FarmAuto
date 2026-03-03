<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import api from '@/api'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'

const appStore = useAppStore()
const toast = useToastStore()
const { userRole } = storeToRefs(appStore)

const isAdmin = computed(() => userRole.value === 'admin')

interface UserItem {
  id: number
  username: string
  password: string
  createdAt: number | null
  role: string
  banned: boolean
}

interface UserCardItem {
  id: string
  code: string
  type: string
  typeLabel: string
  used: boolean
  boundAccountId: string | null
  status: string
}

const users = ref<UserItem[]>([])
const loading = ref(false)
const loadError = ref(false)
const expandedId = ref<number | null>(null)
const cardsByUser = ref<Record<number, UserCardItem[]>>({})
const cardsLoading = ref<Record<number, boolean>>({})

const passwordModal = ref<{ userId: number; username: string } | null>(null)
const newPassword = ref('')
const passwordSaving = ref(false)

const confirmModal = ref<{ type: 'delete' | 'ban' | 'unban'; user: UserItem } | null>(null)
const confirmLoading = ref(false)

async function fetchUsers() {
  if (!isAdmin.value) return
  loading.value = true
  loadError.value = false
  try {
    const res = await api.get<{ ok: boolean; data?: UserItem[] }>('/api/admin/users')
    if (res.data?.ok && Array.isArray(res.data.data))
      users.value = res.data.data
    else
      users.value = []
  } catch (e: any) {
    console.error('获取用户列表失败', e)
    const is404 = e?.response?.status === 404
    users.value = []
    if (is404) loadError.value = true
    else toast.error('获取用户列表失败')
  } finally {
    loading.value = false
  }
}

async function fetchUserCards(userId: number) {
  cardsLoading.value = { ...cardsLoading.value, [userId]: true }
  try {
    const res = await api.get<{ ok: boolean; data?: UserCardItem[] }>(`/api/admin/users/${userId}/cards`)
    if (res.data?.ok && Array.isArray(res.data.data))
      cardsByUser.value = { ...cardsByUser.value, [userId]: res.data.data }
    else
      cardsByUser.value = { ...cardsByUser.value, [userId]: [] }
  } catch (e) {
    console.error('获取用户卡密失败', e)
    toast.error('获取卡密列表失败')
    cardsByUser.value = { ...cardsByUser.value, [userId]: [] }
  } finally {
    cardsLoading.value = { ...cardsLoading.value, [userId]: false }
  }
}

function toggleExpand(user: UserItem) {
  if (expandedId.value === user.id) {
    expandedId.value = null
    return
  }
  expandedId.value = user.id
  if (!cardsByUser.value[user.id])
    fetchUserCards(user.id)
}

function formatTime(ts: number | null) {
  if (ts == null) return '—'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN')
}

function openPasswordModal(user: UserItem) {
  passwordModal.value = { userId: user.id, username: user.username }
  newPassword.value = ''
  passwordSaving.value = false
}

function closePasswordModal() {
  passwordModal.value = null
  newPassword.value = ''
}

async function savePassword() {
  if (!passwordModal.value || newPassword.value.trim().length < 4) {
    toast.warning('新密码至少 4 位')
    return
  }
  passwordSaving.value = true
  try {
    const res = await api.post(`/api/admin/users/${passwordModal.value.userId}/password`, {
      newPassword: newPassword.value.trim(),
    })
    if (res.data?.ok) {
      toast.success('密码已修改')
      closePasswordModal()
    } else {
      toast.error((res.data as any)?.error || '修改失败')
    }
  } catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '修改失败')
  } finally {
    passwordSaving.value = false
  }
}

function openConfirm(type: 'delete' | 'ban' | 'unban', user: UserItem) {
  confirmModal.value = { type, user }
  confirmLoading.value = false
}

function closeConfirm() {
  confirmModal.value = null
}

const confirmTitle = computed(() => {
  if (!confirmModal.value) return ''
  const { type } = confirmModal.value
  if (type === 'delete') return '确认删除账号'
  if (type === 'ban') return '确认封禁账号'
  if (type === 'unban') return '确认解封账号'
  return ''
})

const confirmMessage = computed(() => {
  if (!confirmModal.value) return ''
  const { type, user } = confirmModal.value
  const name = user.username || user.id
  if (type === 'delete') return `确定删除用户「${name}」？删除后该用户无法再登录，其下绑定的 QQ 账号与卡密关系保持不变，卡密使用状态不变。`
  if (type === 'ban') return `确定封禁用户「${name}」？封禁后该用户无法登录，账号与卡密关系保持不变。`
  if (type === 'unban') return `确定解封用户「${name}」？`
  return ''
})

async function doConfirm() {
  if (!confirmModal.value) return
  const { type, user } = confirmModal.value
  confirmLoading.value = true
  try {
    if (type === 'delete') {
      await api.delete(`/api/admin/users/${user.id}`)
      toast.success('账号已删除')
    } else if (type === 'ban') {
      await api.post(`/api/admin/users/${user.id}/ban`)
      toast.success('账号已封禁')
    } else if (type === 'unban') {
      await api.post(`/api/admin/users/${user.id}/unban`)
      toast.success('已解封')
    }
    closeConfirm()
    fetchUsers()
    if (expandedId.value === user.id)
      expandedId.value = null
  } catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '操作失败')
  } finally {
    confirmLoading.value = false
  }
}

onMounted(() => {
  if (isAdmin.value) fetchUsers()
})
</script>

<template>
  <div class="mx-auto max-w-6xl w-full p-4">
    <div v-if="!isAdmin" class="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
      <p class="text-gray-600 dark:text-gray-400">需要管理员权限才能查看用户管理。</p>
    </div>

    <template v-else>
      <div class="mb-6 flex items-center justify-between">
        <h1 class="text-xl font-semibold text-gray-900 dark:text-gray-100">用户管理</h1>
        <BaseButton variant="secondary" size="sm" :loading="loading" @click="fetchUsers">
          刷新
        </BaseButton>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div v-if="loading" class="p-8 text-center text-gray-500">加载中...</div>
        <div v-else-if="users.length === 0" class="p-8 text-center text-gray-500 dark:text-gray-400">
          <template v-if="loadError">
            <p>用户管理接口返回 Not Found，通常表示当前后端未包含该功能。</p>
            <p class="mt-2 text-sm">请确认已更新到最新代码并<strong>重启后端服务</strong>后再试。</p>
            <BaseButton class="mt-3" variant="secondary" size="sm" @click="loadError = false; fetchUsers()">重试</BaseButton>
          </template>
          <template v-else>暂无注册用户</template>
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
              <tr>
                <th class="w-8 px-4 py-3" />
                <th class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">账号</th>
                <th class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">密码</th>
                <th class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">注册时间</th>
                <th class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">状态</th>
                <th class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <template v-for="user in users" :key="user.id">
                <tr
                  class="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
                  @click="toggleExpand(user)"
                >
                  <td class="px-4 py-2">
                    <div
                      class="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500"
                      :class="expandedId === user.id ? 'rotate-90' : ''"
                    >
                      <div class="i-carbon-chevron-right text-sm" />
                    </div>
                  </td>
                  <td class="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">{{ user.username }}</td>
                  <td class="px-4 py-2 font-mono text-gray-600 dark:text-gray-400">{{ user.password }}</td>
                  <td class="px-4 py-2 text-gray-600 dark:text-gray-400">{{ formatTime(user.createdAt) }}</td>
                  <td class="px-4 py-2">
                    <span
                      v-if="user.banned"
                      class="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    >
                      已封禁
                    </span>
                    <span v-else class="text-gray-500 dark:text-gray-400">正常</span>
                  </td>
                  <td class="px-4 py-2" @click.stop>
                    <div class="flex flex-wrap gap-1">
                      <BaseButton variant="secondary" size="sm" @click="openPasswordModal(user)">
                        修改密码
                      </BaseButton>
                      <BaseButton
                        v-if="!user.banned"
                        variant="secondary"
                        size="sm"
                        class="text-amber-600 dark:text-amber-400"
                        @click="openConfirm('ban', user)"
                      >
                        封禁
                      </BaseButton>
                      <BaseButton
                        v-else
                        variant="secondary"
                        size="sm"
                        @click="openConfirm('unban', user)"
                      >
                        解封
                      </BaseButton>
                      <BaseButton
                        variant="secondary"
                        size="sm"
                        class="text-red-600 dark:text-red-400"
                        @click="openConfirm('delete', user)"
                      >
                        删除
                      </BaseButton>
                    </div>
                  </td>
                </tr>
                <tr v-if="expandedId === user.id" class="bg-gray-50/80 dark:bg-gray-800/80">
                  <td colspan="6" class="px-4 py-3">
                    <div class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                      <div class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">绑定的卡密</div>
                      <div v-if="cardsLoading[user.id]" class="py-4 text-center text-gray-500">加载中...</div>
                      <div v-else-if="!(cardsByUser[user.id]?.length)" class="py-2 text-sm text-gray-500">暂无绑定卡密</div>
                      <div v-else class="space-y-2">
                        <div
                          v-for="card in cardsByUser[user.id]"
                          :key="card.id"
                          class="flex flex-wrap items-center gap-2 rounded border border-gray-100 px-2 py-1.5 text-sm dark:border-gray-700"
                        >
                          <span class="font-mono text-gray-800 dark:text-gray-200">{{ card.code }}</span>
                          <span class="text-gray-500 dark:text-gray-400">{{ card.typeLabel }}</span>
                          <span
                            :class="card.used
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-gray-500 dark:text-gray-400'"
                          >
                            {{ card.used ? '已使用' : '未使用' }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 修改密码弹窗 -->
      <div
        v-if="passwordModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="closePasswordModal"
      >
        <div class="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-gray-800">
          <h3 class="mb-3 text-lg font-medium text-gray-900 dark:text-gray-100">修改密码</h3>
          <p class="mb-2 text-sm text-gray-500 dark:text-gray-400">用户：{{ passwordModal.username }}</p>
          <BaseInput
            v-model="newPassword"
            type="password"
            label="新密码"
            placeholder="至少 4 位"
            class="mb-4"
          />
          <div class="flex justify-end gap-2">
            <BaseButton variant="secondary" @click="closePasswordModal">取消</BaseButton>
            <BaseButton variant="primary" :loading="passwordSaving" @click="savePassword">确定</BaseButton>
          </div>
        </div>
      </div>

      <!-- 确认弹窗 -->
      <ConfirmModal
        :show="!!confirmModal"
        :title="confirmTitle"
        :message="confirmMessage"
        type="danger"
        :is-alert="false"
        confirm-text="确定"
        cancel-text="取消"
        :loading="confirmLoading"
        @confirm="doConfirm"
        @cancel="closeConfirm"
      />
    </template>
  </div>
</template>
