# 搭一下 Web 部署说明

当前项目包含 Python 后端代理，所以不要只部署到 GitHub Pages 这类纯静态服务，否则 `/api/text`、`/api/image`、`/api/config` 会失效。

## 推荐：Render Web Service

1. 先生成干净包，确认不包含 `data/wardrobe.json`：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\package-clean.ps1"
   ```

2. 把项目上传到 GitHub 仓库。

3. 登录 Render，选择 New Web Service，连接这个 GitHub 仓库。

4. 如果 Render 识别到 `render.yaml`，使用 Blueprint 创建即可。

5. 环境变量建议：

   ```text
   HOST=0.0.0.0
   PORT=10000
   DISABLE_SERVER_DATABASE=true
   DISABLE_RUNTIME_API_KEY=true
   OPENAI_BASE_URL=https://ai-us.hctopup.com/v1
   OPENAI_MODEL=gpt-5.5
   OPENAI_IMAGE_MODEL=gpt-image-2
   OPENAI_REASONING_EFFORT=xhigh
   OPENAI_API_KEY=你的服务器端 API Key，可选
   OPENAI_API_KEYS=多个服务器端 API Key，可选，用逗号或换行分隔
   AI_PROVIDER=openai
   GOOGLE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
   GOOGLE_MODEL=gemini-3.5-flash
   GOOGLE_IMAGE_MODEL=gemini-3.1-flash-image
   GOOGLE_API_KEY=你的 Google Gemini API Key，可选
   GOOGLE_API_KEYS=多个 Google Gemini API Key，可选，用逗号或换行分隔
   ```

   `OPENAI_API_KEY` 和 `OPENAI_API_KEYS` 二选一即可。两个都填时，后端会先轮询
   `OPENAI_API_KEYS` 中的 Key，最后把 `OPENAI_API_KEY` 作为补充 Key 加入池中。
   网页端只会看到“已配置”和 Key 数量，不会拿到 Key 明文。

   如果要切换到 Google Gemini，把 `AI_PROVIDER` 改成 `google`，然后填写
   `GOOGLE_API_KEY` 或 `GOOGLE_API_KEYS`。Google 的文字识别、图片理解和图片生成都会通过
   Gemini `generateContent` 接口走服务器代理，前端不会拿到 Key 明文。

6. 部署完成后访问 Render 提供的 HTTPS 地址。iPhone Safari 打开后可以“添加到主屏幕”。

## 多 Key 轮询

当 Render 环境变量中配置了 `OPENAI_API_KEYS` 或 `GOOGLE_API_KEYS`：

```text
OPENAI_API_KEYS=sk-第一个,sk-第二个,sk-第三个
GOOGLE_API_KEYS=AIza-第一个,AIza-第二个,AIza-第三个
```

服务端会按请求轮流使用：

```text
第 1 次 AI 请求 -> 第一个 Key
第 2 次 AI 请求 -> 第二个 Key
第 3 次 AI 请求 -> 第三个 Key
第 4 次 AI 请求 -> 回到第一个 Key
```

这样可以把文字识别、生图、图片编辑等请求分散到多个 Key 上，减少单个 Key 的限流压力。
如果某个 Key 遇到 429、502、5xx、网络超时，或 Google 返回额度/限流类 403，服务端会在同一次请求内尝试下一个 Key。
如果某个 Key 本身无效，仍然需要在 Render 里删除或替换它；轮询不会把无效 Key 暴露给前端。

## 生图请求缓存

前端会把成功的生图结果缓存在浏览器 IndexedDB 中。相同图片、相同单品信息、相同 AI 模式和相同提示词再次请求时，会直接复用缓存图，避免重复调用生图 API。

这只影响当前设备当前浏览器，不会把图片缓存上传到 GitHub，也不会暴露 API Key。

## 线上安全模式

`render.yaml` 默认启用：

```text
DISABLE_SERVER_DATABASE=true
DISABLE_RUNTIME_API_KEY=true
```

这样做是为了避免公开测试时出现两类问题：

- 所有人共用服务器上的 `data/wardrobe.json`。
- 某个访问者在网页中输入 API Key 后变成服务器全局临时 Key。

启用线上安全模式后：

- 衣橱、设置、图片仍保存在每个用户自己的浏览器 `localStorage`。
- 服务器不会保存用户衣橱。
- 网页不会接受临时 API Key。
- 如果需要 AI 功能，请在服务器环境变量中配置 `AI_PROVIDER`，以及对应的 `OPENAI_API_KEY(S)` 或 `GOOGLE_API_KEY(S)`。

## 公开发布前需要改造

当前 MVP 还没有账号系统。如果要给多人长期使用，建议先加入：

- 用户登录
- 每个用户独立数据库
- 图片对象存储
- 服务端 API Key 管理和额度限制
- 隐私政策和删除数据入口
