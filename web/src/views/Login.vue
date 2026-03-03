<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { setValidatedToken } from '@/router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const appStore = useAppStore()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const token = useStorage('admin_token', '')

async function handleLogin() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.post('/api/login', {
      username: username.value.trim() || undefined,
      password: password.value,
    })
    if (res.data.ok) {
      token.value = res.data.data.token
      appStore.setUser(res.data.data.username || '', res.data.data.role || '')
      setValidatedToken(res.data.data.token)
      appStore.fetchTheme()
      router.push('/')
    }
    else {
      error.value = res.data.error || '登录失败'
    }
  }
  catch (e: any) {
    error.value = e.response?.data?.error || e.message || '登录异常'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="h-screen w-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
    <div class="max-w-md w-full rounded-xl bg-white p-8 shadow-lg space-y-6 dark:bg-gray-800">
      <div class="mb-8 py-4 text-center">
        <h1 class="text-3xl text-gray-900 font-bold tracking-tight dark:text-white">
          FarmAuto
        </h1>
        <p class="mt-3 text-sm text-gray-500 tracking-widest uppercase dark:text-gray-400">
          统一登录
        </p>
      </div>
      <form class="space-y-4" @submit.prevent="handleLogin">
        <BaseInput
          id="username"
          v-model="username"
          type="text"
          placeholder="用户名（留空则使用管理员密码）"
          autocomplete="username"
        />
        <BaseInput
          id="password"
          v-model="password"
          type="password"
          placeholder="密码"
          required
          autocomplete="current-password"
        />
        <div v-if="error" class="text-sm text-red-600 dark:text-red-400">
          {{ error }}
        </div>
        <BaseButton
          type="submit"
          variant="primary"
          block
          :loading="loading"
        >
          登录
        </BaseButton>
      </form>
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        没有账号？
        <router-link to="/register" class="text-blue-600 font-medium hover:underline dark:text-blue-400">
          去注册
        </router-link>
      </p>
    </div>
  </div>
</template>
