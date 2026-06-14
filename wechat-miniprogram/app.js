const config = require("./config");

App({
  globalData: {
    config,
    sessionToken: "",
    user: null,
    outfitDraft: null
  },

  onLaunch() {
    console.log("StyleTap Mini Program build:", config.buildVersion);
    const sessionToken = wx.getStorageSync("styletap_wechat_session_token");
    const user = wx.getStorageSync("styletap_wechat_user");
    if (sessionToken) {
      this.globalData.sessionToken = sessionToken;
    }
    if (user) {
      this.globalData.user = user;
    }
  }
});
