const { OCCASIONS } = require("../../utils/constants");
const { loadDatabase } = require("../../utils/storage");
const { buildRecommendations } = require("../../utils/recommendation");
const { syncTabBar } = require("../../utils/tabbar");

Page({
  data: {
    scenes: OCCASIONS,
    database: null,
    today: { scene: "通勤", garments: [], title: "还没有可推荐搭配", reason: "先去衣橱添加几件衣服吧。" },
    recentGarments: [],
    garmentCount: 0,
    availableCount: 0,
    favoriteCount: 0
  },

  onShow() {
    syncTabBar(this, 0);
    this.refresh();
  },

  refresh(scene = wx.getStorageSync("styletap_scene") || "通勤") {
    const database = loadDatabase();
    const plans = buildRecommendations(database, scene);
    const today = plans[0] || this.data.today;
    this.setData({
      database,
      today: { ...today, scene },
      recentGarments: [...database.garments].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 6),
      garmentCount: database.garments.length,
      availableCount: database.garments.filter((item) => item.status === "可穿").length,
      favoriteCount: database.garments.filter((item) => item.isFavorite).length
    });
  },

  refreshRecommendation() {
    const current = this.data.today.scene || "通勤";
    const index = OCCASIONS.indexOf(current);
    const next = OCCASIONS[(index + 1) % OCCASIONS.length] || "通勤";
    wx.setStorageSync("styletap_scene", next);
    this.refresh(next);
  },

  openScene(event) {
    const scene = event.currentTarget.dataset.scene || "通勤";
    wx.setStorageSync("styletap_scene", scene);
    wx.switchTab({ url: "/pages/outfit/outfit" });
  },

  openCapture() {
    wx.switchTab({ url: "/pages/capture/capture" });
  },

  openOutfit() {
    wx.switchTab({ url: "/pages/outfit/outfit" });
  }
});
