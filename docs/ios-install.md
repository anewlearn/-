# 搭一下 iOS 安装说明

当前项目是 Web MVP，不是原生 iOS 工程。iPhone 上推荐先用 PWA 方式安装：

1. 运行 `scripts/package-ios-web.ps1` 生成干净包。
2. 把压缩包里的 `StyleTap` 目录部署到支持 HTTPS 的网站或内网 HTTPS 服务。
3. 用 iPhone Safari 打开部署后的地址。
4. 点击 Safari 分享按钮。
5. 选择“添加到主屏幕”。
6. 主屏幕会出现“搭一下”图标，打开后会以独立 App 样式运行。

注意：

- iOS 的 Service Worker 和完整 PWA 能力要求 HTTPS。
- API Key 不会打进安装包，需要用户在“我的”页自行输入。
- 用户衣橱数据不会打进安装包，新设备会生成自己的本地数据。
- 如果要生成真正的 `.ipa`，必须在 macOS + Xcode + Apple Developer 签名环境中完成。
