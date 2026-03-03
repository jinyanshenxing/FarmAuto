<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useBagStore } from '@/stores/bag'

const appStore = useAppStore()
const accountStore = useAccountStore()
const bagStore = useBagStore()
const { sidebarOpen, customBackgroundUrl } = storeToRefs(appStore)
const { currentAccountId } = storeToRefs(accountStore)

watch(currentAccountId, (id) => {
  appStore.fetchTheme(id || undefined)
  bagStore.clearBag()
}, { immediate: true })

const layoutBackgroundStyle = computed(() => {
  const url = customBackgroundUrl.value
  if (!url) return { height: '100dvh' }
  return {
    height: '100dvh',
    backgroundImage: `url(${url})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundColor: 'var(--main-bg, #f8fafc)',
  }
})
</script>

<template>
  <div
    class="w-screen flex overflow-hidden layout-main-bg"
    :style="layoutBackgroundStyle"
  >
    <!-- Mobile Sidebar Overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm transition-opacity lg:hidden"
      @click="appStore.closeSidebar"
    />

    <Sidebar />

    <main class="relative h-full min-w-0 flex flex-1 flex-col overflow-hidden">
      <!-- Top Bar (Mobile/Tablet only or for additional actions) -->
      <header class="h-16 flex shrink-0 items-center justify-between border-b border-gray-200/80 bg-white/90 backdrop-blur-sm px-6 lg:hidden dark:border-gray-700 dark:bg-gray-900/90">
        <div class="text-lg font-bold">
          FarmAuto
        </div>
        <button
          class="flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          @click="appStore.toggleSidebar"
        >
          <div class="i-carbon-menu text-xl" />
        </button>
      </header>

      <!-- Main Content Area -->
      <div class="flex flex-1 flex-col overflow-hidden">
        <div class="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-2 sm:p-4 md:p-6">
          <RouterView v-slot="{ Component, route }">
            <Transition name="slide-fade" mode="out-in">
              <component :is="Component" :key="route.path" />
            </Transition>
          </RouterView>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Slide Fade Transition */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease-out;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 3px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}
</style>
