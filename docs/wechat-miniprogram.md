# 搭一下微信小程序打包与接入说明

当前版本采用真正原生微信小程序页面，不再使用 `web-view`：

- 原生页面：首页、衣橱、拍照、搭配、我的。
- 原生能力：`wx.chooseMedia` 选择图片，`wx.saveFile` 保存图片，`wx.setStorageSync` 保存衣橱数据。
- 服务端：负责 `wx.login` 换取微信用户会话、JSAPI 下单、支付参数签名。

## 1. 微信公众平台配置

进入微信公众平台的小程序后台：

1. 获取小程序 `AppID` 和 `AppSecret`。
2. 在“开发管理 -> 开发设置 -> 服务器域名”中添加：
   - `request 合法域名`：`https://da-xia.onrender.com`
3. 如果要正式支付，需要在微信支付商户平台绑定该小程序 AppID。

本版本不使用 `web-view`，所以不需要配置“业务域名”。本地开发时可以在微信开发者工具里临时勾选“不校验合法域名”，但正式预览、体验版和线上版必须配置 `request 合法域名`。

## 2. Render 环境变量

在 Render 服务的 Environment 中添加：

```text
WECHAT_APP_ID=wx...
WECHAT_APP_SECRET=小程序 AppSecret
WECHAT_SESSION_SECRET=一段随机长字符串

WECHAT_PAY_MCH_ID=微信支付商户号
WECHAT_PAY_SERIAL_NO=商户 API 证书序列号
WECHAT_PAY_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
WECHAT_PAY_NOTIFY_URL=https://da-xia.onrender.com/api/wechat/pay/notify
WECHAT_PAY_DEFAULT_AMOUNT_CENTS=990
```

`WECHAT_PAY_PRIVATE_KEY` 可以使用 `\n` 表示换行。不要把私钥、AppSecret、商户号明文写进小程序或 GitHub。

如果还没有开通微信支付，可以先只填：

```text
WECHAT_APP_ID=wx...
WECHAT_APP_SECRET=小程序 AppSecret
WECHAT_SESSION_SECRET=一段随机长字符串
```

这样微信登录可以先跑通，支付按钮会显示未配置。

## 3. 打包小程序

在项目根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\package-wechat-miniprogram.ps1"
```

脚本会在桌面生成：

```text
StyleTap-wechat-miniprogram-时间戳.zip
```

这个压缩包只包含 `wechat-miniprogram`，不会包含用户衣橱数据、图片、`.env`、`.key` 或 `.pem` 文件。

## 4. 微信开发者工具导入

1. 解压桌面的 `StyleTap-wechat-miniprogram-*.zip`。
2. 打开微信开发者工具。
3. 选择“导入项目”。
4. 项目目录选择解压后的 `wechat-miniprogram` 文件夹。
5. 把 `project.config.json` 里的 `appid` 从 `touristappid` 改成你的真实小程序 AppID。
6. 如果 Render 域名不是 `https://da-xia.onrender.com`，修改 `wechat-miniprogram/config.js`：

```js
module.exports = {
  apiBaseUrl: "https://你的域名",
  paymentSku: {
    productId: "styletap_membership_month",
    description: "搭一下会员服务",
    amountCents: 990
  }
};
```

## 5. 已实现接口

```text
GET  /api/wechat/config
POST /api/wechat/login
POST /api/wechat/pay/create
POST /api/wechat/pay/notify
```

说明：

- `/api/wechat/login` 接收小程序 `wx.login` 返回的 `code`，服务端调用微信 `code2Session`。
- 服务端只返回签名后的 `sessionToken`，不会把微信 `session_key` 返回给小程序端。
- `/api/wechat/pay/create` 使用登录态中的 `openid` 创建微信支付 JSAPI 订单，并返回 `wx.requestPayment` 所需参数。
- `/api/wechat/pay/notify` 当前只接收通知并返回成功。正式发放会员权益前，还需要加入微信支付平台证书验签、资源解密、订单表和幂等处理。

## 6. 原生页面说明

```text
pages/home/home       首页：今日推荐、快捷场景、最近加入、衣橱概览
pages/wardrobe        衣橱：分类、季节筛选、收藏、删除、加入搭配
pages/capture         拍照：单品/整套模式，最多 10 张，队列处理，AI 打标签
pages/outfit          搭配：分层选择单品，三套推荐，保存穿搭
pages/profile         我的：微信登录、支付、身体参数、本地数据重置
```

衣橱、图片和身体参数保存在当前用户的小程序本地缓存中。重新打开小程序仍会保留；用户卸载小程序或清理微信缓存后，本地数据可能被清除。正式多用户长期使用时，建议再加账号数据库和对象存储。

## 7. 官方文档

- 小程序登录 `wx.login`：https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html
- 图片选择 `wx.chooseMedia`：https://developers.weixin.qq.com/miniprogram/dev/api/media/video/wx.chooseMedia.html
- 文件保存 `wx.saveFile`：https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.saveFile.html
- 登录凭证校验 `code2Session`：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
- 小程序支付 `wx.requestPayment`：https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html
- 微信支付 JSAPI 下单：https://pay.weixin.qq.com/doc/v3/merchant/4012791851
