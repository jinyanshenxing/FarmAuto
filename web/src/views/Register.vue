<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

const router = useRouter()
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)

async function handleRegister() {
  error.value = ''
  success.value = ''
  const name = username.value.trim()
  if (!name) {
    error.value = '请输入用户名'
    return
  }
  if (name.length < 2) {
    error.value = '用户名至少 2 个字符'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    return
  }
  if (password.value.length < 4) {
    error.value = '密码至少 4 位'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = '两次密码不一致'
    return
  }

  loading.value = true
  try {
    const res = await api.post('/api/register', {
      username: name,
      password: password.value,
    })
    if (res.data.ok) {
      success.value = '注册成功，请登录'
      setTimeout(() => {
        router.push('/login')
      }, 1500)
    }
    else {
      error.value = res.data.error || '注册失败'
    }
  }
  catch (e: any) {
    error.value = e.response?.data?.error || e.message || '注册异常'
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
          注册账号（普通用户）
        </p>
      </div>
      <form class="space-y-4" @submit.prevent="handleRegister">
        <BaseInput
          id="reg-username"
          v-model="username"
          type="text"
          placeholder="用户名（至少 2 个字符）"
          autocomplete="username"
          required
        />
        <BaseInput
          id="reg-password"
          v-model="password"
          type="password"
          placeholder="密码（至少 4 位）"
          autocomplete="new-password"
          required
        />
        <BaseInput
          id="reg-confirm"
          v-model="confirmPassword"
          type="password"
          placeholder="再次输入密码"
          autocomplete="new-password"
          required
        />
        <div v-if="error" class="text-sm text-red-600 dark:text-red-400">
          {{ error }}
        </div>
        <div v-if="success" class="text-sm text-green-600 dark:text-green-400">
          {{ success }}
        </div>
        <BaseButton
          type="submit"
          variant="primary"
          block
          :loading="loading"
        >
          注册
        </BaseButton>
      </form>
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        已有账号？
        <router-link to="/login" class="text-blue-600 font-medium hover:underline dark:text-blue-400">
          去登录
        </router-link>
      </p>
    </div>
  </div>
</template>
