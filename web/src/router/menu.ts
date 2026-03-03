export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
}

export const menuRoutes: MenuItem[] = [
  {
    path: '',
    name: 'dashboard',
    label: '概览',
    icon: 'i-carbon-chart-pie',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'analytics',
    name: 'analytics',
    label: '分析',
    icon: 'i-carbon-analytics',
    component: () => import('@/views/Analytics.vue'),
  },
  {
    path: 'accounts',
    name: 'accounts',
    label: '账号',
    icon: 'i-carbon-user-settings',
    component: () => import('@/views/Accounts.vue'),
  },
  {
    path: 'cards',
    name: 'cards',
    label: '卡密管理',
    icon: 'i-carbon-key',
    component: () => import('@/views/Cards.vue'),
  },
  {
    path: 'user-manage',
    name: 'userManage',
    label: '用户管理',
    icon: 'i-carbon-user-admin',
    component: () => import('@/views/UserManage.vue'),
  },
]
