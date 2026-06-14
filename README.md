# 搭一下 Web MVP

这是“搭一下”测试版的零依赖静态 Web 原型，用于先验证产品骨架、页面结构和本地数据闭环。

## 运行

使用本地代理服务器打开根目录：

```powershell
python server.py
```

然后访问：

```text
http://localhost:5173
```

## 给同一局域网里的其他电脑访问

默认只允许本机访问。要给同一 Wi-Fi / 局域网里的设备访问，用：

```powershell
$env:HOST="0.0.0.0"
python server.py
```

然后在主电脑上查看局域网 IP：

```powershell
ipconfig
```

其他电脑访问：

```text
http://主电脑局域网IP:5173
```

例如：

```text
http://192.168.1.23:5173
```

注意：局域网访问时，别人会通过这台主电脑的后端代理调用 AI。如果你在网页里输入了 API Key，同一局域网能访问这个地址的人也可能消耗这枚 Key，测试时请只开放给可信设备。

## 当前实现范围

- 五栏底部导航：首页、衣橱、拍照、搭配、我的
- 中央突出的拍照按钮
- 首页今日推荐、快捷场景、最近加入、衣橱概览
- 衣橱分类筛选、收藏、详情弹层
- 拍照/相册导入的模拟识衣流程
- 手动搭配工作台和三套 AI 推荐方案
- 身体参数和风格偏好设置
- 使用浏览器 `localStorage` + 本机 `data/wardrobe.json` 双保存衣物、穿搭、身体档案和偏好
- 通过本地 `/api/text` 和 `/api/image` 代理接入 Responses API

## API 配置

不要把密钥写进前端文件。推荐打开网页后，在“我的 → AI 接口密钥”里输入。

网页输入的密钥只保存在 `server.py` 的进程内存里：

- 不写入前端文件
- 不写入 `localStorage`
- 不在 `/api/config` 里回显
- 重启服务器后自动清空

也可以启动前在当前终端设置环境变量：

```powershell
$env:AI_PROVIDER="openai"
$env:OPENAI_API_KEY="你的密钥"
python server.py
```

如果要使用 Google Gemini：

```powershell
$env:AI_PROVIDER="google"
$env:GOOGLE_API_KEY="你的 Google Gemini API Key"
$env:GOOGLE_MODEL="gemini-3.5-flash"
$env:GOOGLE_IMAGE_MODEL="gemini-3.1-flash-image"
python server.py
```

多个 Key 可以用逗号、分号、空格或换行分隔，例如：

```powershell
$env:GOOGLE_API_KEYS="第一个Key,第二个Key,第三个Key"
```

当某个 Key 返回 429、502、5xx、网络超时，或 Google 额度/限流类 403 时，后端会在同一次请求内自动尝试下一个 Key，避免界面长时间卡住。

可选环境变量：

```powershell
$env:OPENAI_BASE_URL="https://ai-us.hctopup.com/v1"
$env:OPENAI_MODEL="gpt-5.5"
$env:OPENAI_REASONING_EFFORT="xhigh"
$env:GOOGLE_BASE_URL="https://generativelanguage.googleapis.com/v1beta"
```

默认已使用：

```text
base_url = https://ai-us.hctopup.com/v1
model = gpt-5.5
wire_api = responses
store = false
```

## 设计参考

视觉概念图保存在：

```text
docs/ui-concept.png
```

## 微信小程序

已新增 `wechat-miniprogram` 原生小程序工程，支持首页、衣橱、拍照、搭配、我的、微信登录和微信支付下单入口。打包命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\package-wechat-miniprogram.ps1"
```

配置步骤见：

```text
docs/wechat-miniprogram.md
```
