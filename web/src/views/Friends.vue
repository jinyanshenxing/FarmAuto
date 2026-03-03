<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import LandCard from '@/components/LandCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAccountStore } from '@/stores/account'
import { useFriendStore } from '@/stores/friend'
import { useStatusStore } from '@/stores/status'

const accountStore = useAccountStore()
const friendStore = useFriendStore()
const statusStore = useStatusStore()
const { currentAccountId } = storeToRefs(accountStore)
const { friends, friendsTotal, loading, friendLands, friendLandsLoading, blacklist, farmBannedList, farmBannedLoading } = storeToRefs(friendStore)
const { status, loading: statusLoading, realtimeConnected } = storeToRefs(statusStore)

const friendsTab = ref<'list' | 'banned'>('list')
const bannedSearchKeyword = ref('')

// Confirm Modal state
const showConfirm = ref(false)
const confirmMessage = ref('')
const confirmLoading = ref(false)
const pendingAction = ref<(() => Promise<void>) | null>(null)
const avatarErrorKeys = ref<Set<string>>(new Set())

function confirmAction(msg: string, action: () => Promise<void>) {
  confirmMessage.value = msg
  pendingAction.value = action
  showConfirm.value = true
}

async function onConfirm() {
  if (pendingAction.value) {
    try {
      confirmLoading.value = true
      await pendingAction.value()
      pendingAction.value = null
      showConfirm.value = false
    }
    finally {
      confirmLoading.value = false
    }
  }
  else {
    showConfirm.value = false
  }
}

// 好友名字检索
const friendSearchKeyword = ref('')

const filteredFriends = computed(() => {
  const list = friends.value || []
  const kw = String(friendSearchKeyword.value || '').trim().toLowerCase()
  if (!kw)
    return list
  return list.filter((f: any) => {
    const name = String(f?.name ?? '').toLowerCase()
    return name.includes(kw)
  })
})

const filteredFarmBanned = computed(() => {
  const list = farmBannedList.value || []
  const kw = String(bannedSearchKeyword.value || '').trim().toLowerCase()
  if (!kw)
    return list
  return list.filter((item: { gid: number, friendName: string }) => {
    const name = String(item.friendName ?? '').toLowerCase()
    const gidStr = String(item.gid ?? '')
    return name.includes(kw) || gidStr.includes(kw)
  })
})

// Track expanded friends
const expandedFriends = ref<Set<string>>(new Set())

const FRIEND_PAGE_SIZE = 100
const loadMoreLoading = ref(false)

async function loadFriends() {
  if (!currentAccountId.value)
    return
  if (!realtimeConnected.value) {
    await statusStore.fetchStatus(currentAccountId.value)
  }
  avatarErrorKeys.value.clear()
  await friendStore.fetchFriends(currentAccountId.value, { page: 1, pageSize: FRIEND_PAGE_SIZE })
  friendStore.fetchBlacklist(currentAccountId.value)
}

const hasMoreFriends = computed(() => (friends.value?.length ?? 0) < (friendsTotal.value ?? 0))

async function loadMoreFriends() {
  if (!currentAccountId.value || !hasMoreFriends.value || loadMoreLoading.value)
    return
  loadMoreLoading.value = true
  try {
    const nextPage = Math.floor((friends.value?.length ?? 0) / FRIEND_PAGE_SIZE) + 1
    await friendStore.fetchFriends(currentAccountId.value, { page: nextPage, pageSize: FRIEND_PAGE_SIZE, append: true })
  } finally {
    loadMoreLoading.value = false
  }
}

// 倒计时每秒更新；页面不可见时暂停以减轻性能开销
useIntervalFn(() => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    return
  for (const gid in friendLands.value) {
    if (friendLands.value[gid]) {
      friendLands.value[gid] = friendLands.value[gid].map((l: any) =>
        l.matureInSec > 0 ? { ...l, matureInSec: l.matureInSec - 1 } : l,
      )
    }
  }
}, 1000)

onMounted(() => {
  loadFriends()
})

watch(currentAccountId, () => {
  expandedFriends.value.clear()
  loadFriends()
  if (friendsTab.value === 'banned' && currentAccountId.value)
    friendStore.fetchFarmBannedList(currentAccountId.value)
})

watch(friendsTab, (tab) => {
  if (tab === 'banned' && currentAccountId.value)
    friendStore.fetchFarmBannedList(currentAccountId.value)
})

// 每 30 秒自动刷新好友列表
useIntervalFn(() => {
  loadFriends()
}, 30000)

function toggleFriend(friendId: string) {
  if (expandedFriends.value.has(friendId)) {
    expandedFriends.value.delete(friendId)
  }
  else {
    // Collapse others? The original code does:
    // document.querySelectorAll('.friend-lands').forEach(e => e.style.display = 'none');
    // So it behaves like an accordion.
    expandedFriends.value.clear()
    expandedFriends.value.add(friendId)
    if (currentAccountId.value) {
      friendStore.fetchFriendLands(currentAccountId.value, friendId)
    }
  }
}

async function handleOp(friendId: string, type: string, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return

  confirmAction('确定执行此操作吗?', async () => {
    await friendStore.operate(currentAccountId.value!, friendId, type)
  })
}

async function handleToggleBlacklist(friend: any, e: Event) {
  e.stopPropagation()
  if (!currentAccountId.value)
    return
  await friendStore.toggleBlacklist(currentAccountId.value, Number(friend.gid))
}

async function handleRemoveFromFarmBanned(item: { gid: number, friendName: string }) {
  if (!currentAccountId.value)
    return
  await friendStore.removeFromFarmBanned(currentAccountId.value, item.gid)
}

function getFriendStatusText(friend: any) {
  const p = friend.plant || {}
  const info = []
  if (p.stealNum)
    info.push(`偷${p.stealNum}`)
  if (p.dryNum)
    info.push(`水${p.dryNum}`)
  if (p.weedNum)
    info.push(`草${p.weedNum}`)
  if (p.insectNum)
    info.push(`虫${p.insectNum}`)
  return info.length ? info.join(' ') : '无操作'
}

function getFriendAvatar(friend: any) {
  const direct = String(friend?.avatarUrl || friend?.avatar_url || '').trim()
  if (direct)
    return direct
  const uin = String(friend?.uin || '').trim()
  if (uin)
    return `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`
  return ''
}

function getFriendAvatarKey(friend: any) {
  const key = String(friend?.gid || friend?.uin || '').trim()
  return key || String(friend?.name || '').trim()
}

function canShowFriendAvatar(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return false
  return !!getFriendAvatar(friend) && !avatarErrorKeys.value.has(key)
}

function handleFriendAvatarError(friend: any) {
  const key = getFriendAvatarKey(friend)
  if (!key)
    return
  avatarErrorKeys.value.add(key)
}
</script>

<template>
  <div class="p-4">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <div class="i-carbon-user-multiple" />
        好友
      </h2>
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-600 dark:bg-gray-800">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            :class="friendsTab === 'list' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
            @click="friendsTab = 'list'"
          >
            好友列表
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            :class="friendsTab === 'banned' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-600 dark:text-gray-400'"
            @click="friendsTab = 'banned'; currentAccountId && friendStore.fetchFarmBannedList(currentAccountId)"
          >
            已封禁
            <span v-if="farmBannedList.length > 0" class="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-400">{{ farmBannedList.length }}</span>
          </button>
        </div>
        <template v-if="friendsTab === 'list'">
          <BaseInput
            v-model="friendSearchKeyword"
            placeholder="按好友名字检索"
            class="w-40 sm:w-48"
            clearable
          />
          <div v-if="friends.length" class="shrink-0 text-sm text-gray-500">
            共 {{ filteredFriends.length }}{{ friendSearchKeyword.trim() ? ` / ${friends.length}` : '' }} 名好友
          </div>
        </template>
        <template v-else>
          <BaseInput
            v-model="bannedSearchKeyword"
            placeholder="搜索昵称或 GID"
            class="w-40 sm:w-48"
            clearable
          />
          <div class="shrink-0 text-sm text-gray-500">
            共 {{ filteredFarmBanned.length }}{{ bannedSearchKeyword.trim() ? ` / ${farmBannedList.length}` : '' }} 人
          </div>
        </template>
      </div>
    </div>

    <div v-if="loading || statusLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="card-panel p-8 text-center text-gray-500">
      请选择账号后查看好友
    </div>

    <div v-else-if="!status?.connection?.connected" class="card-panel flex flex-col items-center justify-center gap-4 p-12 text-center text-gray-500">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="text-lg text-gray-700 font-medium dark:text-gray-300">
          账号未登录
        </div>
        <div class="mt-1 text-sm text-gray-400">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <div v-else-if="friendsTab === 'list' && friends.length === 0" class="card-panel p-8 text-center text-gray-500">
      暂无好友或数据加载失败
    </div>

    <!-- 已封禁名单 Tab -->
    <div v-else-if="friendsTab === 'banned'" class="space-y-4">
      <div v-if="farmBannedLoading" class="flex justify-center py-12">
        <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
      </div>
      <div v-else-if="farmBannedList.length === 0" class="card-panel p-8 text-center text-gray-500">
        <div class="i-carbon-security mb-2 text-4xl text-gray-300" />
        <p>暂无农场封禁名单</p>
        <p class="mt-1 text-sm text-gray-400">访问或操作好友时若提示账号封禁，将自动加入此名单，脚本将不再对其巡田</p>
      </div>
      <div v-else class="card-panel overflow-hidden">
        <div class="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
          以下好友在访问/操作时曾提示封禁，已自动加入名单；移出后脚本将恢复对其巡田
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[400px] text-left text-sm">
            <thead class="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
              <tr>
                <th class="px-4 py-3 font-medium">GID</th>
                <th class="px-4 py-3 font-medium">昵称</th>
                <th class="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              <tr
                v-for="item in filteredFarmBanned"
                :key="item.gid"
                class="hover:bg-gray-50 dark:hover:bg-gray-700/30"
              >
                <td class="px-4 py-3 font-mono text-gray-600 dark:text-gray-400">{{ item.gid }}</td>
                <td class="px-4 py-3 text-gray-800 dark:text-gray-200">{{ item.friendName || `—` }}</td>
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
        <div v-if="filteredFarmBanned.length === 0 && bannedSearchKeyword.trim()" class="p-4 text-center text-sm text-gray-500">
          未找到匹配的封禁记录
        </div>
      </div>
    </div>

    <div v-else class="space-y-4">
      <div
        v-if="friendSearchKeyword.trim() && filteredFriends.length === 0"
        class="card-panel py-8 text-center text-gray-500"
      >
        未找到名字包含「{{ friendSearchKeyword.trim() }}」的好友
      </div>
      <template v-else>
        <div
          v-for="friend in filteredFriends"
          :key="friend.gid"
          class="card-panel overflow-hidden"
        >
        <div
          class="flex flex-col cursor-pointer justify-between gap-4 p-4 transition sm:flex-row sm:items-center hover:bg-gray-50 dark:hover:bg-gray-700/50"
          :class="blacklist.includes(Number(friend.gid)) ? 'opacity-50' : ''"
          @click="toggleFriend(friend.gid)"
        >
          <div class="flex items-center gap-3">
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
              <div class="text-sm" :class="getFriendStatusText(friend) !== '无操作' ? 'text-green-500 font-medium' : 'text-gray-400'">
                {{ getFriendStatusText(friend) }}
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              class="rounded bg-blue-100 px-3 py-2 text-sm text-blue-700 transition hover:bg-blue-200"
              @click="handleOp(friend.gid, 'steal', $event)"
            >
              偷取
            </button>
            <button
              class="rounded bg-cyan-100 px-3 py-2 text-sm text-cyan-700 transition hover:bg-cyan-200"
              @click="handleOp(friend.gid, 'water', $event)"
            >
              浇水
            </button>
            <button
              class="rounded bg-green-100 px-3 py-2 text-sm text-green-700 transition hover:bg-green-200"
              @click="handleOp(friend.gid, 'weed', $event)"
            >
              除草
            </button>
            <button
              class="rounded bg-orange-100 px-3 py-2 text-sm text-orange-700 transition hover:bg-orange-200"
              @click="handleOp(friend.gid, 'bug', $event)"
            >
              除虫
            </button>
            <button
              class="rounded bg-red-100 px-3 py-2 text-sm text-red-700 transition hover:bg-red-200"
              @click="handleOp(friend.gid, 'bad', $event)"
            >
              捣乱
            </button>
            <button
              class="rounded px-3 py-2 text-sm transition"
              :class="blacklist.includes(Number(friend.gid))
                ? 'bg-gray-200 text-gray-600 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700/50 dark:text-gray-400 dark:hover:bg-gray-700'"
              @click="handleToggleBlacklist(friend, $event)"
            >
              {{ blacklist.includes(Number(friend.gid)) ? '移出黑名单' : '加入黑名单' }}
            </button>
          </div>
        </div>

        <div v-if="expandedFriends.has(friend.gid)" class="border-t bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
          <div v-if="friendLandsLoading[friend.gid]" class="flex justify-center py-4">
            <div class="i-svg-spinners-90-ring-with-bg text-2xl text-blue-500" />
          </div>
          <div v-else-if="!friendLands[friend.gid] || friendLands[friend.gid]?.length === 0" class="py-4 text-center text-gray-500">
            无土地数据
          </div>
          <div v-else class="grid grid-cols-2 gap-2 lg:grid-cols-8 md:grid-cols-5 sm:grid-cols-4">
            <LandCard
              v-for="land in friendLands[friend.gid]"
              :key="land.id"
              :land="land"
            />
          </div>
        </div>
      </div>
        <div v-if="hasMoreFriends" class="flex justify-center py-4">
          <button
            type="button"
            class="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            :disabled="loadMoreLoading"
            @click="loadMoreFriends"
          >
            {{ loadMoreLoading ? '加载中…' : `加载更多（已显示 ${friends.length} / ${friendsTotal}）` }}
          </button>
        </div>
      </template>
    </div>

    <ConfirmModal
      :show="showConfirm"
      :loading="confirmLoading"
      title="确认操作"
      :message="confirmMessage"
      @confirm="onConfirm"
      @cancel="!confirmLoading && (showConfirm = false)"
    />
  </div>
</template>
