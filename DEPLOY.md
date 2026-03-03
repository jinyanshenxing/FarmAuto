# 部署说明

## 一、本地 / 服务器直接运行

### 1. 安装依赖并构建

```bash
# 在项目根目录执行
pnpm install
pnpm build:web
```

或使用一键命令（安装依赖 + 构建前端）：

```bash
pnpm run deploy
```

### 2. 启动服务

```bash
# 方式 A：先构建再启动后端（推荐）
pnpm build:web
pnpm -C core start

# 方式 B：使用根目录 start 脚本（会先执行 build:web 再启动）
pnpm start
```

### 3. 访问

- 管理面板：<http://localhost:3000>（端口可通过环境变量 `ADMIN_PORT` 修改，默认 3000）
- 首次使用需在「设置」中设置管理员密码；账号与卡密等数据存放在项目下的 `data/` 目录

---

## 二、Docker 部署

### 1. 构建并启动

在项目根目录执行：

```bash
docker compose up -d --build
```

### 2. 配置

- 端口：容器内 3000 映射到主机 3000（可在 `docker-compose.yml` 中修改 `ports`）
- 环境变量：可在 `docker-compose.yml` 的 `environment` 中设置 `ADMIN_PASSWORD`、`TZ` 等
- 数据持久化：`./data` 挂载到容器内，账号与卡密数据保存在主机 `./data` 目录

### 3. 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止
docker compose down
```

---

## 三、生产环境建议

1. **反向代理**：使用 Nginx / Caddy 等做反向代理，配置 HTTPS 与域名。
2. **数据备份**：定期备份 `data/` 目录（含账号、卡密、配置等）。
3. **进程守护**：非 Docker 部署时可用 systemd、pm2 等保持进程常驻与开机自启。
