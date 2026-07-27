# check

验证与管理控制台 — 服务于 LokiBox 用户脚本的认证、好友、Presence 系统，并提供管理后台。

## 功能

### 用户端（LokiBox 客户端加密链路）
- `/session` — AES-256-GCM sessionKey 协商
- `/auth/register` `/auth/login` `/auth/logout` `/auth/user`
- `/user/details` `/user/nickname` `/user/avatar`
- `/presence/heartbeat` `/presence/map/:id`
- `/friends/*` `/users/search`

### 管理后台（HttpOnly Cookie + JWT）
- `/login` `/register` — 登录/注册页
- `/` — 仪表盘（用户/在线/IP 分布/心跳趋势）
- `/programs` — 程序管理（远程配置 feature 参数）
- `/users` — 用户管理（在线状态/IP/指纹/地图位置）

## 全链路安全

| 层 | 机制 |
|---|---|
| 传输 | HTTPS（Vercel 自动 TLS） |
| 握手 | BootstrapKey (PSK) → sessionKey (随机 32 字节) 协商 |
| 加密 | AES-256-GCM（每次随机 12 字节 IV） |
| 防重放 | X-TimeStamp ±60s 时间窗口 |
| 防篡改 | HMAC-SHA256（可选） |
| 密码 | bcrypt cost=12 |
| 会话 | JWT HS256 7d，HttpOnly Cookie |
| 设备指纹 | UA + 平台 + 屏幕 + 时区 SHA-256 |
| IP 定位 | ip-api + ipinfo + ipapi 三源加权平均 |

## 部署

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量（参考 .env.example）
cp .env.example .env.local
# 编辑 JWT_SECRET / HMAC_SECRET 等

# 3. 初始化数据库
pnpm db:push
pnpm db:seed  # 创建 admin 账号

# 4. 启动开发
pnpm dev

# 5. 部署到 Vercel
vercel
```

## 默认管理员

- 用户名：`admin`
- 密码：`cyccodemao1234`

首次启动时 `instrumentation.ts` 会自动 seed。
