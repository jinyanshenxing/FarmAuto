<script setup lang="ts">
defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

/** 按功能板块组织的使用说明与部署说明 */
const sections: Array<{
  id: string
  title: string
  icon: string
  items: string[]
}> = [
  {
    id: 'overview',
    title: '概览（首页）',
    icon: 'i-carbon-chart-pie',
    items: [
      '左侧点击「概览」进入首页，顶部可切换：我的农场、好友互动、功能设置。',
      '我的农场：含「土地详情」「我的背包」「我的任务」三个子页。土地详情展示当前账号农田、作物成熟时间；背包与任务可刷新查看。',
      '好友互动：含「好友列表」「已封禁」。好友列表分页显示（每页 10 人），点击某行可展开该好友的作物与时间表；支持搜索、一键帮助、一键偷取及批量勾选操作。已封禁为脚本自动加入的封禁名单，可移除。',
      '功能设置：含「自动设置」「作物偷取设置」「策略设置」。见下方功能设置板块。',
      '首页还展示运行状态、操作统计、实时日志与好友访问记录（好友对我进行的操作）。',
    ],
  },
  {
    id: 'analytics',
    title: '分析',
    icon: 'i-carbon-analytics',
    items: [
      '左侧点击「分析」进入作物数据分析页，可按经验效率、普通肥经验效率、净利润效率、普通肥净利润效率、等级要求等维度排序。',
      '用于种植策略参考：在「功能设置 → 策略设置」中可选择按最高等级、最大经验/时、最大利润/时等策略时，分析页数据会参与选种。',
    ],
  },
  {
    id: 'accounts',
    title: '账号管理',
    icon: 'i-carbon-user-settings',
    items: [
      '左侧点击「账号」管理 QQ 账号：添加、编辑、删除、启动、停止、备注。',
      '添加账号需先验证卡密（在卡密管理中绑定或使用免费永久卡），再通过扫码或手动输入 Code 完成 QQ 登录。',
      '账号可设置「下线自动删除」与离线超时时间；被踢下线或超时未重连会按配置删除。',
    ],
  },
  {
    id: 'cards',
    title: '卡密管理',
    icon: 'i-carbon-key',
    items: [
      '左侧点击「卡密管理」：管理员可制卡、查看全部卡密与绑定状态；普通用户可查看自己使用过或领取的卡密。',
      '首页左上角（已用卡密上方）提供「免费永久卡（3次）」：每个网站登录账号限领 3 次，领取的卡密会出现在卡密列表与「已用卡密」中（显示为未用/已用）。',
    ],
  },
  {
    id: 'settings',
    title: '功能设置',
    icon: 'i-carbon-settings',
    items: [
      '自动设置：总开关（农场、好友、任务等）、好友操作顺序（帮助→偷取→捣乱）、土地升级等。',
      '作物偷取设置：不偷取作物黑名单（按作物勾选），好友巡田时跳过这些作物。',
      '策略设置：种植策略（优先种子/最高等级/最大经验或利润等）、施肥策略、农场/好友巡查间隔、偷取延迟、静默时段、种植顺序随机与延迟等。',
    ],
  },
  {
    id: 'theme',
    title: '主题与外观',
    icon: 'i-carbon-color-palette',
    items: [
      '首页左下角「主题切换」：五款渐变主题（翡翠森林、海洋深邃、落日熔金、紫晶幻梦、樱花绯色），可切换配色；支持自定义上传网页背景图，按账号保存并跨端同步。',
      '卡片与左侧栏背景会随当前主题变色。',
    ],
  },
  {
    id: 'offline',
    title: '下线提醒',
    icon: 'i-carbon-notification',
    items: [
      '首页左下角「下线提醒」：配置账号被踢下线时的推送（Webhook、Bark、Server 酱、钉钉等），以及重登录链接方式、标题与内容。',
    ],
  },
  {
    id: 'auth',
    title: '登录与安全',
    icon: 'i-carbon-security',
    items: [
      '面板首次访问需登录，默认管理密码为 admin，部署后请点击头像在个人中心中修改为强密码。',
      '支持注册多用户；卡密领取与已用卡密按当前登录用户区分。',
    ],
  },
  {
    id: 'deploy',
    title: '全环境部署说明',
    icon: 'i-carbon-deployment-unit',
    items: [
      '环境要求：Node.js 20+（源码运行），pnpm（建议 corepack enable）。',
      '一、源码运行（Windows）：安装 Node.js 20+ 并执行 corepack enable → 项目根目录执行 pnpm install、pnpm build:web → 启动 pnpm dev:core。可选环境变量 ADMIN_PASSWORD 设置管理密码。',
      '二、源码运行（Linux）：安装 Node.js 20+ 与 pnpm 后，同上执行 pnpm install、pnpm build:web、pnpm dev:core。',
      '三、Docker：在项目根目录执行 docker compose up -d --build。数据持久化于 ./data（accounts.json、store.json）。在 docker-compose.yml 的 environment 中配置 ADMIN_PASSWORD 与 TZ。默认端口 3000。',
      '四、二进制发布版（无需 Node.js）：执行 pnpm install、pnpm package:release，产物在 dist/（Windows：qq-farm-bot-win-x64.exe；Linux：qq-farm-bot-linux-x64；macOS 见 README）。运行后会在可执行文件同级自动创建 data/ 并写入配置。',
      '访问：本机 http://localhost:3000，局域网 http://<本机IP>:3000。',
    ],
  },
]
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div
        class="card-panel flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden shadow-2xl"
        @click.stop
      >
        <div class="card-panel-header flex shrink-0 items-center justify-between px-4 text-gray-900 dark:text-gray-100">
          <h3 class="flex items-center gap-2 text-lg font-bold">
            <div class="i-carbon-document text-xl" />
            使用说明
          </h3>
          <button
            type="button"
            class="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-600 dark:hover:text-gray-200"
            aria-label="关闭"
            @click="emit('close')"
          >
            <div class="i-carbon-close text-xl" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="space-y-6">
            <section
              v-for="section in sections"
              :key="section.id"
              class="rounded-xl border border-gray-200/80 bg-gray-50/80 p-4 dark:border-gray-600/80 dark:bg-gray-700/30"
            >
              <h4 class="mb-2 flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-base text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400"
                  :class="section.icon"
                />
                {{ section.title }}
              </h4>
              <ul class="space-y-1.5 pl-0 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                <li
                  v-for="(item, i) in section.items"
                  :key="i"
                  class="flex gap-2"
                >
                  <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500/60 dark:bg-emerald-400/60" />
                  <span>{{ item }}</span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
