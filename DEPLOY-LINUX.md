# Linux 部署说明

本文档说明在 Linux 服务器上部署 QQ 农场 Bot Web 面板的几种方式，适用于 Ubuntu、Debian、CentOS 等常见发行版。

---

## 一、环境要求

| 项目     | 要求                          |
|----------|-------------------------------|
| 系统     | Linux（推荐 Ubuntu 20.04+、Debian 11+） |
| Node.js  | 20.x 或更高（LTS 推荐）       |
| pnpm     | 10.x（可通过 corepack 启用）  |
| 端口     | 默认 3000（可改）             |

---

## 二、方式一：源码直接运行

### 2.1 安装 Node.js 与 pnpm

**Ubuntu / Debian：**

```bash
# 安装 curl（如未安装）
sudo apt update && sudo apt install -y curl

# 使用 NodeSource 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 启用 pnpm（随 Node 自带 corepack）
sudo corepack enable
pnpm -v   # 应显示 10.x
```

**CentOS / RHEL：**

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
sudo corepack enable
pnpm -v
```

### 2.2 克隆/上传项目并安装依赖

```bash
cd /path/to/qq-farm-bot-ui   # 替换为你的项目路径

# 安装依赖
pnpm install

# 构建前端（必须执行一次）
pnpm build:web
```

### 2.3 启动服务

```bash
# 前台运行（调试用，Ctrl+C 退出）
pnpm dev:core

# 或使用 start（会先 build:web 再启动）
pnpm start
```

**可选：通过环境变量设置管理密码与端口**

```bash
export ADMIN_PASSWORD='你的强密码'
export ADMIN_PORT=3000
pnpm dev:core
```

### 2.4 访问

- 本机：<http://localhost:3000>
- 局域网/服务器：<http://服务器IP:3000>
- 默认管理密码：`admin`，**部署后请尽快在面板中修改**

### 2.5 数据目录

- 数据存放在项目下的 **`core/data/`** 目录（与 `client.js` 同级的 `data`）。
- 重要文件：`accounts.json`、`store.json`、`cards.json` 等，请定期备份。

---

## 三、方式二：使用 systemd 守护进程（推荐生产环境）

适用于需要开机自启、崩溃自动重启的场景。

### 3.1 创建 systemd 服务文件

```bash
sudo vim /etc/systemd/system/qq-farm-bot-ui.service
```

写入以下内容（将 `WorkingDirectory` 和 `User` 改为实际路径与用户）：

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
Environment=NODE_ENV=production
ExecStart=/usr/bin/pnpm dev:core
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- `User`：运行服务的系统用户（如 `www-data`、`deploy`）。
- `WorkingDirectory`：项目根目录（含 `package.json`、`core/`、`web/`）。
- `ExecStart`：若 pnpm 不在默认路径，可用 `which pnpm` 查看后替换；或改为 `ExecStart=/usr/bin/node client.js` 并将 `WorkingDirectory` 改为 **`/path/to/qq-farm-bot-ui/core`**（此时需已在项目根目录执行过 `pnpm build:web`）。

### 3.2 启动与开机自启

```bash
sudo systemctl daemon-reload
sudo systemctl enable qq-farm-bot-ui
sudo systemctl start qq-farm-bot-ui
sudo systemctl status qq-farm-bot-ui
```

### 3.3 常用命令

```bash
# 查看日志
sudo journalctl -u qq-farm-bot-ui -f

# 重启服务
sudo systemctl restart qq-farm-bot-ui

# 停止服务
sudo systemctl stop qq-farm-bot-ui
```

---

## 四、方式三：Docker 部署

无需在宿主机安装 Node.js，适合容器化环境。

### 4.1 安装 Docker 与 Docker Compose

**Ubuntu / Debian：**

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # 当前用户加入 docker 组，需重新登录生效
```

### 4.2 构建并启动

在项目根目录执行：

```bash
cd /path/to/qq-farm-bot-ui
docker compose up -d --build
```

### 4.3 配置

- **端口**：默认映射 `3000:3000`，可在 `docker-compose.yml` 的 `ports` 中修改。
- **环境变量**：在 `docker-compose.yml` 的 `environment` 中可设置：
  - `ADMIN_PASSWORD`：管理密码
  - `TZ`：时区，如 `Asia/Shanghai`
- **数据持久化**：宿主机 `./data` 挂载到容器内，账号与卡密等数据保存在宿主机 `./data` 目录。

### 4.4 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止并删除容器
docker compose down

# 仅停止
docker compose stop
```

---

## 五、生产环境建议

### 5.1 反向代理（Nginx）

使用 Nginx 做反向代理并配置 HTTPS 与域名示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配置后重载 Nginx：`sudo nginx -t && sudo systemctl reload nginx`。

### 5.2 数据备份

- 定期备份 **`core/data/`**（或 Docker 部署时的 `./data`）。
- 重要文件：`accounts.json`、`store.json`、`cards.json`、`users.json` 等。

### 5.3 防火墙

若仅本机或内网访问，可不开放端口；对外提供时建议只开放 80/443，由 Nginx 转发到 3000：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 六、环境变量说明

| 变量名           | 说明           | 默认值   |
|------------------|----------------|----------|
| `ADMIN_PORT`     | 管理面板端口   | 3000     |
| `ADMIN_PASSWORD` | 管理员密码     | admin    |
| `TZ`             | 时区           | -        |
| `NODE_ENV`       | 运行环境       | -        |
| `LOG_LEVEL`      | 日志级别       | info     |

---

## 七、故障排查

1. **端口被占用**  
   修改 `ADMIN_PORT` 或使用 `ss -tlnp | grep 3000` 查看占用进程。

2. **pnpm 未找到**  
   执行 `sudo corepack enable`，或使用 `npm install -g pnpm` 安装。

3. **前端白屏或 404**  
   确保在项目根目录执行过 `pnpm build:web`，且后端从含 `web/dist` 的目录正确提供静态资源（源码运行时由 core 自动托管）。

4. **数据丢失**  
   确认运行目录正确，数据写在 `core/data/`；Docker 部署时确认 `./data` 挂载无误。

5. **权限问题**  
   systemd 或直接运行时，保证运行用户对项目目录及 `core/data` 有读写权限。

---

## 八、快速命令汇总

```bash
# 源码一键部署（安装依赖 + 构建 + 启动）
cd /path/to/qq-farm-bot-ui
pnpm install
pnpm build:web
pnpm dev:core

# 或使用根目录脚本
pnpm run deploy    # 仅安装依赖 + 构建
pnpm start         # 构建并启动
```

更多说明见项目根目录 `DEPLOY.md` 与 `README.md`。
