# Sub-Store Workers

将 Sub-Store 后端自动部署到 Cloudflare Workers 和 Cloudflare Pages。

本项目只提供后端 API，不托管 Sub-Store 前端页面。访问后端根地址时跳转到官方前端是正常行为。

Workers 是主要运行环境，负责 API 和定时任务。部分中国境内网络无法直接访问 `workers.dev`，因此项目默认同时部署 Pages；`pages.dev` 通常可以在中国境内直连。Pages 可以通过 `NO_PAGE` Secret 关闭。

## 使用流程

### 1. Fork 仓库

打开原仓库：

https://github.com/tsiens/sub-store-workers

点击右上角 **Fork**，将仓库复制到自己的 GitHub 账号下。

### 2. 配置 Repository secrets

进入自己的仓库：

```text
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
```

添加以下 6 个 Secret。

| Name | 说明 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `KV_NAMESPACE` | KV 数据库名称，不是 ID |
| `PAGES_PROJECT_NAME` | Cloudflare Pages 项目名称 |
| `SUB_STORE_FRONTEND_BACKEND_PATH` | 后端访问密钥，必须以 `/` 开头 |
| `WORKERS_SUBDOMAIN` | Workers 子域名 |
| `NO_PAGE` | 是否关闭 Pages，留空或填 `false` 表示部署 Pages |

#### `CLOUDFLARE_ACCOUNT_ID`

登录 Cloudflare：

https://dash.cloudflare.com/

进入账号首页后，地址格式通常如下：

```text
https://dash.cloudflare.com/<ACCOUNT_ID>/home
```

`<ACCOUNT_ID>` 就是需要填写的账号 ID。

不要填写完整网址，只填写中间的账号 ID。

#### `CLOUDFLARE_API_TOKEN`

打开：

https://dash.cloudflare.com/profile/api-tokens

创建 API Token，并授予以下权限：

- `Workers`：管理员
- `Cloudflare Pages`：编辑
- `Workers KV 存储`：编辑

只需要将 Token 本身填入 `CLOUDFLARE_API_TOKEN`，不要填写 Token 名称。

#### `KV_NAMESPACE`

填写 KV 数据库名称，例如：

```text
sub-store-data
```

不需要提前创建 KV，也不需要填写 KV ID。

GitHub Actions 会自动执行以下操作：

- 查找指定名称的 KV
- 如果不存在则自动创建
- 将同一个 KV 绑定到 Workers 和 Pages

#### `PAGES_PROJECT_NAME`

填写 Pages 项目名称，例如：

```text
sub-store-prod
```

项目不存在时，GitHub Actions 会自动创建。

#### `SUB_STORE_FRONTEND_BACKEND_PATH`

填写后端访问密钥，必须以 `/` 开头，例如：

```text
/sub-store-password
```

注意：

- 必须包含开头的 `/`
- 不要填写域名
- 不要加结尾的 `/`
- 不要包含空格或换行

错误示例：

```text
sub-store-password
```

正确示例：

```text
/sub-store-password
```

#### `WORKERS_SUBDOMAIN`

打开 Cloudflare Workers & Pages：

```text
https://dash.cloudflare.com/<ACCOUNT_ID>/workers-and-pages
```

找到账号的 Workers 子域名。

例如账号域名为：

```text
example.workers.dev
```

则填写：

```text
example
```

不要填写完整的 `example.workers.dev`。

#### `NO_PAGE`

这是可选 Secret。

留空、删除，或填写：

```text
false
```

表示部署 Pages。

填写其他非空值（推荐填写 `true`）表示不部署 Pages。如果已经存在同名 Pages 项目，GitHub Actions 会自动将其删除。

注意：关闭 Pages 后，只会保留 Workers 部署。中国境内如果无法访问 `workers.dev`，将无法通过 Pages 域名访问后端。

### 3. 第一次运行 GitHub Actions

进入自己仓库的：

```text
Actions
→ Sync Upstream Sub-Store
→ Run workflow
```

将：

```text
强制部署（即使无更新）
```

设置为：

```text
true
```

然后点击 **Run workflow**。

第一次运行会自动：

1. 获取 Sub-Store 上游源码
2. 创建或复用 KV 数据库
3. 构建 Worker
4. 创建并部署 Cloudflare Worker
5. 绑定 `SUB_STORE_DATA`
6. 写入 `SUB_STORE_FRONTEND_BACKEND_PATH`
7. 根据 `NO_PAGE` 设置创建或删除 Pages
8. 如果启用 Pages，则将其绑定到同一个 KV
9. 如果启用 Pages，则写入 Pages Secret 并部署
10. 执行健康检查

后续 GitHub Actions 会每天自动检查上游更新。只有检测到上游发生变化时才会重新部署；如果修改了 `NO_PAGE`，请手动运行 workflow 并将 `force` 设置为 `true`，使 Pages 开关立即生效。

### Pages 的作用

Pages 不是另一套数据，而是同一个后端的备用访问入口：

- Workers：负责运行 API、Cron 和后台逻辑
- Pages：使用同一个 KV 和鉴权密钥，提供 `pages.dev` 访问地址
- 中国境内无法访问 `workers.dev` 时，可以使用 Pages 地址连接前端

如果关闭 Pages，请使用 Workers 地址；如果 Workers 在当前网络不可访问，则需要重新启用 Pages。

### 4. 获取 Pages 后端地址

打开 Cloudflare：

```text
https://dash.cloudflare.com/<ACCOUNT_ID>/workers-and-pages
```

进入刚创建的 Pages 项目，复制 Pages 域名。

后端地址格式：

```text
https://<PAGES_DOMAIN>/<PASSWORD>
```

例如：

```text
https://sub-store-example.pages.dev/sub-store-password
```

其中：

- `<PAGES_DOMAIN>` 是 Cloudflare Pages 显示的域名
- `<PASSWORD>` 是 `SUB_STORE_FRONTEND_BACKEND_PATH` 去掉开头 `/` 后的内容

### 5. 连接 Sub-Store 前端

打开官方前端：

https://sub-store.vercel.app/subs

在前端设置中填写后端地址：

```text
https://<PAGES_DOMAIN>/<PASSWORD>
```

也可以使用一键连接地址：

```text
https://sub-store.vercel.app/?api=https://<PAGES_DOMAIN>/<PASSWORD>
```

### 6. 验证部署

访问：

```text
https://<PAGES_DOMAIN>/<PASSWORD>/api/utils/worker-status
```

正常情况下应返回类似内容：

```json
{
  "status": "success",
  "data": {
    "kv": {
      "bound": true
    },
    "auth": {
      "backendPathConfigured": true
    }
  }
}
```

## 常见问题

### 访问 Pages 根地址跳转到 `sub-store.vercel.app`

这是正常行为。

本项目是 Sub-Store 后端，根路径会跳转到官方前端。Pages 域名本身不会显示管理界面。

### 前端提示“无效的后端地址”

重点检查：

```text
SUB_STORE_FRONTEND_BACKEND_PATH
```

Secret 必须填写：

```text
/password
```

不能填写：

```text
password
```

修改 Secret 后，需要在 Actions 中重新运行，并将 `force` 设置为 `true`。

### 访问 API 返回 `401 Unauthorized`

这是正常的鉴权响应，说明后端已启用密码保护。

请使用带密码前缀的地址：

```text
https://<PAGES_DOMAIN>/<PASSWORD>/api/utils/worker-status
```

不要直接访问：

```text
https://<PAGES_DOMAIN>/api/utils/worker-status
```

### GitHub Actions 失败

优先检查：

- `CLOUDFLARE_ACCOUNT_ID` 是否正确
- `CLOUDFLARE_API_TOKEN` 是否有 Workers、Pages、KV 权限
- `KV_NAMESPACE` 是否填写了名称
- `PAGES_PROJECT_NAME` 是否符合 Cloudflare Pages 项目命名要求
- `WORKERS_SUBDOMAIN` 是否只填写了 `workers.dev` 前面的部分
- `SUB_STORE_FRONTEND_BACKEND_PATH` 是否以 `/` 开头
