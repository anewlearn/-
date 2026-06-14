const api = require("../../utils/api");
const config = require("../../config");
const { loadDatabase, saveDatabase, resetDatabase } = require("../../utils/storage");
const { syncTabBar } = require("../../utils/tabbar");

Page({
  data: {
    serverReady: false,
    serverStatusText: "检查中",
    loginEnabled: false,
    paymentEnabled: false,
    loggedIn: false,
    loginLoading: false,
    payLoading: false,
    wechatBackendReady: false,
    buildVersion: config.buildVersion,
    priceText: (config.paymentSku.amountCents / 100).toFixed(2),
    garmentCount: 0,
    profileFields: [],
    modelStyle: {}
  },

  onShow() {
    syncTabBar(this, 4);
    this.refreshLocal();
    this.refreshServerConfig();
  },

  refreshLocal() {
    const database = loadDatabase();
    const profile = database.bodyProfile || {};
    this.setData({
      loggedIn: Boolean(wx.getStorageSync("styletap_wechat_session_token")),
      garmentCount: database.garments.length,
      modelStyle: this.buildModelStyle(profile),
      profileFields: [
        { key: "height", label: "身高", value: Number(profile.height || 168), min: 140, max: 195, unit: "cm" },
        { key: "shoulderWidth", label: "肩宽", value: Number(profile.shoulderWidth || 42), min: 32, max: 58, unit: "cm" },
        { key: "waist", label: "腰围", value: Number(profile.waist || 68), min: 48, max: 110, unit: "cm" },
        { key: "hips", label: "臀围", value: Number(profile.hips || 92), min: 70, max: 130, unit: "cm" },
        { key: "legLength", label: "腿长", value: Number(profile.legLength || 94), min: 68, max: 125, unit: "cm" }
      ]
    });
  },

  buildModelStyle(profile) {
    const shoulder = Number(profile.shoulderWidth || 42);
    const waist = Number(profile.waist || 68);
    const hips = Number(profile.hips || 92);
    const legs = Number(profile.legLength || 94);
    return {
      shoulderWidth: `${Math.max(70, Math.min(112, shoulder * 2.1))}rpx`,
      torsoWidth: `${Math.max(58, Math.min(96, waist * 1.05))}rpx`,
      hipWidth: `${Math.max(74, Math.min(122, hips * 1.08))}rpx`,
      legHeight: `${Math.max(112, Math.min(170, legs * 1.45))}rpx`
    };
  },

  async refreshServerConfig() {
    try {
      const result = await api.get("/api/config", { timeout: 20000 });
      const wechat = result.wechat || {};
      const hasWechatConfig = Boolean(result.wechat);
      this.setData({
        serverReady: true,
        serverStatusText: "已连接",
        wechatBackendReady: hasWechatConfig,
        loginEnabled: Boolean(wechat.loginEnabled),
        paymentEnabled: Boolean(wechat.paymentEnabled)
      });
    } catch (error) {
      this.setData({
        serverReady: false,
        wechatBackendReady: false,
        serverStatusText: "连接失败",
        loginEnabled: false,
        paymentEnabled: false
      });
    }
  },

  loginWithWechat() {
    if (!this.data.wechatBackendReady) {
      wx.showModal({
        title: "需要部署新版后端",
        content: "当前线上服务还没有微信登录接口。请把最新代码上传 GitHub 并等待 Render 重新部署。",
        showCancel: false
      });
      return;
    }
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true });
    wx.login({
      success: async (loginResult) => {
        try {
          if (!loginResult.code) throw new Error("微信没有返回登录 code");
          const result = await api.post("/api/wechat/login", { code: loginResult.code });
          wx.setStorageSync("styletap_wechat_session_token", result.sessionToken);
          wx.setStorageSync("styletap_wechat_user", result.user || {});
          this.setData({ loggedIn: true });
          wx.showToast({ title: "登录成功", icon: "success" });
        } catch (error) {
          wx.showModal({ title: "登录失败", content: error.message || "请稍后重试", showCancel: false });
        } finally {
          this.setData({ loginLoading: false });
        }
      },
      fail: (error) => {
        this.setData({ loginLoading: false });
        wx.showModal({ title: "登录失败", content: error.errMsg || "wx.login 调用失败", showCancel: false });
      }
    });
  },

  async startPayment() {
    if (!this.data.wechatBackendReady) {
      wx.showModal({
        title: "需要部署新版后端",
        content: "当前线上服务还没有微信支付接口。请先部署最新后端。",
        showCancel: false
      });
      return;
    }
    const sessionToken = wx.getStorageSync("styletap_wechat_session_token");
    if (!sessionToken) {
      wx.showToast({ title: "请先登录", icon: "none" });
      return;
    }
    this.setData({ payLoading: true });
    try {
      const result = await api.post("/api/wechat/pay/create", {
        sessionToken,
        productId: config.paymentSku.productId,
        description: config.paymentSku.description,
        amountCents: config.paymentSku.amountCents
      });
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          ...result.paymentParams,
          success: resolve,
          fail: (error) => reject(new Error(error.errMsg || "微信支付取消或失败"))
        });
      });
      wx.showToast({ title: "支付成功", icon: "success" });
    } catch (error) {
      wx.showModal({ title: "支付未完成", content: error.message || "请稍后重试", showCancel: false });
    } finally {
      this.setData({ payLoading: false });
    }
  },

  changeProfile(event) {
    const key = event.currentTarget.dataset.key;
    const value = Number(event.detail.value);
    const database = loadDatabase();
    database.bodyProfile = { ...(database.bodyProfile || {}), [key]: value };
    saveDatabase(database);
    this.refreshLocal();
  },

  resetAll() {
    wx.showModal({
      title: "重置数据",
      content: "会清空当前小程序本地衣橱并恢复示例数据。",
      success: (result) => {
        if (!result.confirm) return;
        resetDatabase();
        this.refreshLocal();
        wx.showToast({ title: "已重置", icon: "success" });
      }
    });
  }
});
