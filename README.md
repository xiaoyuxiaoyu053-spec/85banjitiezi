# 85班匿名社区

Render + PostgreSQL 的匿名社区。

## Render
1. 将整个项目上传到 GitHub。
2. Render -> New -> Web Service，选择仓库。
3. Build Command: `npm install`
4. Start Command: `npm start`
5. 添加环境变量：
   - `DATABASE_URL`：Render PostgreSQL 的 Internal/External connection string
   - `ADMIN_PASSWORD`：`85mmtzowner`
   - `SESSION_SECRET`：随机长字符串（也可以让 Render Generate Value）
6. 部署。

首次启动会自动创建 PostgreSQL 表。

## 管理后台
`/admin`

密码：通过 Render 环境变量 `ADMIN_PASSWORD` 设置为 `85mmtzowner`。

## 数据
帖子、回复、点赞、匿名身份、私信、举报、公告全部存 PostgreSQL。
重新部署 Web Service 不会删除数据库数据。不要删除/重建 PostgreSQL 数据库。

## 匿名身份
用户无需注册登录。服务器通过签名 HttpOnly Cookie 识别匿名身份。清除 Cookie、换浏览器或换设备后会生成新的匿名身份。