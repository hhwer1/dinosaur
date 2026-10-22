# Cloudflare Workers + D1 部署

## 1. 安装并登录 Wrangler

```powershell
npm install -g wrangler
wrangler login
```

## 2. 创建 D1 数据库

```powershell
wrangler d1 create studio-booking-db
```

复制命令返回的 `database_id`，替换 `wrangler.toml` 中的中文占位内容。

## 3. 初始化数据库

```powershell
wrangler d1 execute studio-booking-db --remote --file=d1-schema.sql
```

## 4. 设置工作人员密码

```powershell
wrangler secret put STAFF_PASSWORD
```

按提示输入内部工作人员共用密码。密码不会写入项目文件。

## 5. 部署

```powershell
wrangler deploy
```

部署完成后会得到一个 `https://studio-booking.<账号>.workers.dev` 地址。

## 6. 后续更新

修改网页或 Worker 后，再次运行：

```powershell
wrangler deploy
```

## 权限说明

- 所有人都能查看占用状态并创建预约。
- 创建预约的浏览器会在本机保存专属修改凭证，可修改或取消自己创建的预约。
- 工作人员用顶部密码登录后，可以修改或取消全部预约。
- 工作人员密码只保存在 Worker Secret 中，不会暴露在网页代码里。
