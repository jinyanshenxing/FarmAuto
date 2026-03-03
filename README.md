# QQ 农场多账号挂机 + Web 管理面板

基于 Node.js 的 QQ 农场自动化工具，支持多账号管理、Web 控制面板、卡密体系、多用户与管理员功能，提供实时日志与数据分析。

---

## 一、技术栈介绍

### 1.1 前端（web/）

| 技术 | 版本/说明 |
|------|-----------|
| **Vue** | 3.x — 渐进式前端框架，Composition API + `<script setup>` |
| **TypeScript** | 5.x — 类型安全与 IDE 支持 |
| **Vite** | 7.x — 构建与开发服务器，ESM、HMR、按需编译 |
| **Vue Router** | 5.x — 单页路由（概览 / 分析 / 账号 / 卡密 / 用户管理 / 设置） |
| **Pinia** | 3.x — 状态管理（账号、设置、主题、Toast 等） |
| **UnoCSS** | 原子化 CSS，配合 Iconify（Carbon、Fa 等）图标 |
| **Axios** | HTTP 客户端，统一封装 baseURL、Token、错误与 401 处理 |
| **Socket.io Client** | 4.x — WebSocket 实时日志、状态推送 |
| **VueUse** | 组合式工具（如 useStorage、useIntervalFn） |
| **NProgress** | 路由切换进度条 |

构建产物为静态文件（`web/dist/`），由后端 Express 托管或单独部署到任意静态服务器。

### 1.2 后端（core/）

| 技术 | 版本/说明 |
|------|-----------|
| **Node.js** | 18+（推荐 20 LTS）— 运行环境 |
| **Express** | 4.x — HTTP API、静态托管、Session/Token 鉴权 |
| **Socket.io** | 4.x — 服务端推送（日志、账号状态） |
| **Protobuf.js** | 8.x — 游戏协议序列化/反序列化 |
| **Axios** | 请求游戏接口、内部 HTTP 调用 |
| **Winston** | 日志（控制台 + 文件，按模块与级别） |
| **Pushoo** | 推送通知（Bark、Server 酱、Webhook、钉钉等） |
| **QRCode** | 登录二维码生成 |

后端职责：多进程管理（主进程 + 各账号 Worker）、农场/好友/任务/仓库等业务逻辑、REST API、卡密与用户模型、数据持久化（JSON 文件）。

### 1.3 工程与部署

| 项目 | 说明 |
|------|------|
| **pnpm** | 10.x，Monorepo（根 + web + core），`pnpm-workspace.yaml` |
| **ESLint** | 统一规范（@antfu/eslint-config），根 / web / core 分别 lint |
| **Docker** | 使用 `core/Dockerfile` + 根目录 `docker-compose.yml` 构建与运行 |
| **pkg** | 可选，将 Node 应用打包为单可执行文件（Windows / Linux / macOS） |

---

## 二、功能说明

### 2.1 登录与权限

- **登录方式**：管理员密码登录或注册账号后用户名+密码登录。
- **角色**：管理员 / 普通用户。管理员可访问卡密管理、用户管理、查看全部账号；普通用户仅能管理自己的账号与卡密。
- **安全**：支持修改管理员密码；用户支持封禁、删除（删除/封禁不解除账号与卡密绑定）。

### 2.2 多账号管理

- 账号的添加、编辑、删除、启动、停止、备注。
- QQ 登录：扫码或手动输入 Code；添加前需验证卡密（或使用免费永久卡）。
- 卡密体系：天卡/周卡/月卡/年卡/永久卡；支持一账号多卡、到期叠加；管理员可制卡、解绑、封禁卡密。
- 账号被踢下线可配置自动删除；支持离线超时自动删除；支持下线推送（Webhook、Bark、Server 酱等）。

### 2.3 自动化能力

- **农场**：收获、种植、浇水、除草、除虫、铲除、土地升级；收获后可选自动卖果实。
- **自动填充化肥**（总开关）：  
  - 自动使用化肥礼包（打开背包中的礼包）  
  - 自动普通肥料（种植后第一时间施普通肥）  
  - 自动施一次有机肥（种植后施一次有机肥）  
  - 防偷（剩余成熟秒数内自动施一次有机肥加速，秒数可配置）  
  - 连续施有机肥（按策略设置中的施肥间隔）
- **好友**：自动偷菜、帮忙（浇水/除草/除虫）、捣乱；可配置执行顺序、黑名单、静默时段、偷取延迟等。
- **任务与邮件**：自动检查并领取任务、邮件。
- **策略设置**：种植策略（优先种子/最高等级/最大经验或利润等）、施肥间隔、农场/好友巡查间隔等。

### 2.4 Web 面板

- **概览**：我的农场（土地、背包、任务）、好友互动（列表、封禁）、功能设置入口；运行状态、操作统计、实时日志、好友访问记录。
- **分析**：作物数据按经验效率、普通肥经验效率、净利润效率、等级等排序，供种植策略参考。
- **账号**：QQ 账号列表与操作；卡密信息与续费入口。
- **卡密管理**：管理员制卡、查看全部卡密；普通用户查看己用/未用卡密；支持免费永久卡领取（每用户限次）。
- **用户管理**（仅管理员）：注册用户列表、账号/密码占位/注册时间、展开查看对应用户绑定的卡密及是否使用；支持修改密码、封禁、删除用户。
- **设置**：自动设置（含施肥细分）、作物偷取设置、策略设置；主题与背景图、下线提醒配置。

### 2.5 其他

- 主题切换（多款渐变主题）、自定义背景图（按账号保存）。
- 下线提醒：配置推送渠道与重登录链接等。

---

## 三、不同环境下的部署详情

### 3.1 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | 20.x 或更高（LTS 推荐） |
| pnpm | 10.x（建议 `corepack enable`） |
| 端口 | 默认 3000，可通过环境变量 `ADMIN_PORT` 修改 |

### 3.2 Windows 本地 / 服务器

```powershell
# 1. 安装 Node.js 20+（https://nodejs.org/），并启用 pnpm
node -v
corepack enable
pnpm -v

# 2. 进入项目根目录，安装依赖并构建前端
cd 你的项目路径\qq-farm-bot-ui
pnpm install
pnpm build:web

# 3. 启动后端（会托管 web/dist 并提供 API）
pnpm -C core start

# 或使用根目录一键命令（会先执行 build:web 再启动）
pnpm start
```

可选：设置管理密码与端口后再启动：

```powershell
$env:ADMIN_PASSWORD = "你的强密码"
$env:ADMIN_PORT = "3000"
pnpm -C core start
```

访问：<http://localhost:3000>（首次使用需在面板中设置或修改管理员密码）。

### 3.3 Linux（Ubuntu / Debian）

```bash
# 1. 安装 Node.js 20 与 pnpm
sudo apt update && sudo apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
pnpm -v

# 2. 克隆或上传项目，安装依赖并构建
cd /path/to/qq-farm-bot-ui
pnpm install
pnpm build:web

# 3. 启动
pnpm -C core start
# 或
pnpm start
```

可选环境变量：

```bash
export ADMIN_PASSWORD='你的强密码'
export ADMIN_PORT=3000
pnpm -C core start
```

**使用 systemd 守护（推荐生产环境）**：创建服务文件 `/etc/systemd/system/qq-farm-bot-ui.service`，例如：

```ini
[Unit]
Description=QQ Farm Bot Web Panel
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/qq-farm-bot-ui
Environment=ADMIN_PORT=3000
Environment=ADMIN_PASSWORD=你的强密码
ExecStart=/usr/bin/pnpm -C core start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable qq-farm-bot-ui
sudo systemctl start qq-farm-bot-ui
sudo systemctl status qq-farm-bot-ui
```

### 3.4 Docker 部署

无需在宿主机安装 Node.js，适合容器化环境。

```bash
# 在项目根目录执行
docker compose up -d --build
```

- **端口**：默认映射 `3000:3000`，可在 `docker-compose.yml` 的 `ports` 中修改。
- **环境变量**：在 `docker-compose.yml` 的 `environment` 中可设置：
  - `ADMIN_PASSWORD`：管理员密码
  - `TZ`：时区，如 `Asia/Shanghai`
- **数据持久化**：宿主机 `./data` 挂载到容器内（见 `docker-compose.yml` 的 `volumes`），账号、卡密、用户与配置等均保存在宿主机 `./data` 目录。

常用命令：

```bash
docker compose logs -f    # 查看日志
docker compose down      # 停止并移除容器
```

### 3.5 二进制发布版（无需安装 Node.js）

使用 pkg 将 Node 应用与 web 构建产物打包为单可执行文件：

```bash
pnpm install
pnpm build:web
pnpm package:release
```

产物在 `core/dist/` 目录：

| 平台 | 文件名示例 |
|------|------------|
| Windows x64 | `qq-farm-bot-win-x64.exe` |
| Linux x64 | `qq-farm-bot-linux-x64` |
| macOS Intel | `qq-farm-bot-macos-x64` |
| macOS Apple Silicon | `qq-farm-bot-macos-arm64` |

运行：在可执行文件所在目录执行即可，程序会在同级创建 `data/` 并写入配置与账号数据。

```bash
# Windows
.\qq-farm-bot-win-x64.exe

# Linux / macOS
chmod +x ./qq-farm-bot-linux-x64 && ./qq-farm-bot-linux-x64
```

### 3.6 环境变量说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `ADMIN_PORT` | 管理面板 HTTP 端口 | 3000 |
| `ADMIN_PASSWORD` | 管理员密码（部分部署方式） | admin |
| `TZ` | 时区 | - |
| `NODE_ENV` | 运行环境 | - |
| `LOG_LEVEL` | 日志级别 | info |

### 3.7 数据目录与备份

- **源码 / 二进制运行**：数据目录为项目下的 `core/data/`（或可执行文件同级的 `data/`）。
- **Docker**：数据在宿主机挂载的 `./data` 目录。
- 重要文件：`accounts.json`、`store.json`、`cards.json`、`users.json` 及 `logs/`。建议定期备份整个数据目录。

### 3.8 生产环境建议

1. **反向代理**：使用 Nginx / Caddy 等反向代理到 `localhost:3000`，并配置 HTTPS 与域名。
2. **防火墙**：若对外只提供 Web，建议仅开放 80/443，由 Nginx 转发，不直接暴露 3000 端口。
3. **备份**：定期备份 `core/data/`（或 Docker 的 `./data`）。

更多细节可参考项目根目录的 `DEPLOY.md` 与 `DEPLOY-LINUX.md`。

---

## 四、项目结构

```
qq-farm-bot-ui/
├── core/                     # 后端
│   ├── src/
│   │   ├── config/           # 配置、运行时路径、游戏常量
│   │   ├── controllers/      # HTTP API（admin 面板、REST）
│   │   ├── core/             # Worker 入口与调度
│   │   ├── gameConfig/       # 游戏静态数据（等级、作物、物品等）
│   │   ├── models/           # 账号、卡密、用户、配置存储
│   │   ├── proto/            # Protobuf 协议
│   │   ├── runtime/          # 运行时引擎与多进程
│   │   └── services/         # 农场、好友、任务、仓库等业务
│   ├── data/                 # 运行时数据（勿提交 Git）
│   ├── client.js              # 主进程入口
│   └── package.json
├── web/                      # 前端
│   ├── src/
│   │   ├── api/              # Axios 封装与拦截器
│   │   ├── components/       # 公共组件
│   │   ├── router/           # 路由与菜单
│   │   ├── stores/           # Pinia
│   │   └── views/            # 页面
│   ├── dist/                 # 构建产物（由 core 托管）
│   └── package.json
├── docker-compose.yml
├── DEPLOY.md
├── DEPLOY-LINUX.md
├── pnpm-workspace.yaml
└── package.json
```

---

## 五、致谢与免责声明

- 核心逻辑与协议参考：[linguo2625469/qq-farm-bot](https://github.com/linguo2625469/qq-farm-bot)、[QianChenJun/qq-farm-bot](https://github.com/QianChenJun/qq-farm-bot)
- 扫码登录：[lkeme/QRLib](https://github.com/lkeme/QRLib)
- 推送：[imaegoo/pushoo](https://github.com/imaegoo/pushoo)

**免责声明**：本项目仅供学习与研究。使用本工具可能违反相关平台或游戏服务条款，由此产生的一切后果由使用者自行承担。
