const { CATEGORIES, SEASONS } = require("../../utils/constants");
const { loadDatabase, saveDatabase, saveOutfitDraft, outfitLayerForGarment } = require("../../utils/storage");
const { fileToDataUrl, compressImageForAi, generateFlatImage } = require("../../utils/ai");
const { syncTabBar } = require("../../utils/tabbar");

Page({
  data: {
    categories: CATEGORIES,
    seasons: SEASONS,
    category: "全部",
    season: "全部",
    database: null,
    filtered: [],
    selectedGarment: null,
    regenerating: false
  },

  onShow() {
    syncTabBar(this, 1);
    this.refresh();
  },

  refresh() {
    const database = loadDatabase();
    const filtered = database.garments
      .filter((item) => this.data.category === "全部" || item.category === this.data.category)
      .filter((item) => this.data.season === "全部" || (item.seasons || []).includes(this.data.season))
      .map((item) => this.decorateGarment(item));
    this.setData({ database, filtered });
  },

  decorateGarment(item) {
    return {
      ...item,
      seasonsText: (item.seasons || []).join(" / ") || "未设置",
      stylesText: (item.styles || []).join(" / ") || "未设置",
      occasionsText: (item.occasions || []).join(" / ") || "未设置",
      tagsText: (item.aiTags || []).slice(0, 8).join(" / ") || "未设置",
      wearCount: Number(item.wearCount || 0),
      washCount: Number(item.washCount || 0)
    };
  },

  selectCategory(event) {
    this.setData({ category: event.currentTarget.dataset.value || "全部" }, () => this.refresh());
  },

  selectSeason(event) {
    this.setData({ season: event.currentTarget.dataset.value || "全部" }, () => this.refresh());
  },

  toggleFavorite(event) {
    const id = event.currentTarget.dataset.id;
    const database = this.data.database || loadDatabase();
    database.garments = database.garments.map((item) => item.id === id ? { ...item, isFavorite: !item.isFavorite } : item);
    saveDatabase(database);
    const selected = database.garments.find((item) => item.id === this.data.selectedGarment?.id);
    this.setData({ selectedGarment: selected ? this.decorateGarment(selected) : null });
    this.refresh();
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    const garment = (this.data.database || loadDatabase()).garments.find((item) => item.id === id);
    if (!garment) return;
    this.setData({ selectedGarment: this.decorateGarment(garment) });
  },

  closeDetail() {
    this.setData({ selectedGarment: null });
  },

  noop() {},

  openCapture() {
    wx.switchTab({ url: "/pages/capture/capture" });
  },

  updateCount(event) {
    const id = event.currentTarget.dataset.id;
    const field = event.currentTarget.dataset.field;
    const delta = Number(event.currentTarget.dataset.delta || 0);
    if (!id || !["wearCount", "washCount"].includes(field)) return;
    const database = this.data.database || loadDatabase();
    database.garments = database.garments.map((item) => {
      if (item.id !== id) return item;
      const nextValue = Math.max(0, Number(item[field] || 0) + delta);
      return {
        ...item,
        [field]: nextValue,
        lastWornDate: field === "wearCount" && delta > 0 ? new Date().toISOString() : item.lastWornDate
      };
    });
    saveDatabase(database);
    const selected = database.garments.find((item) => item.id === id);
    this.setData({
      database,
      selectedGarment: selected ? this.decorateGarment(selected) : null
    });
    this.refresh();
  },

  setCount(event) {
    const id = event.currentTarget.dataset.id;
    const field = event.currentTarget.dataset.field;
    const value = Math.max(0, Number(event.detail.value || 0));
    if (!id || !["wearCount", "washCount"].includes(field)) return;
    const database = this.data.database || loadDatabase();
    database.garments = database.garments.map((item) => item.id === id ? { ...item, [field]: value } : item);
    saveDatabase(database);
    const selected = database.garments.find((item) => item.id === id);
    this.setData({
      database,
      selectedGarment: selected ? this.decorateGarment(selected) : null
    });
    this.refresh();
  },

  sendToOutfit(event) {
    const id = event.currentTarget.dataset.id;
    const database = this.data.database || loadDatabase();
    const garment = database.garments.find((item) => item.id === id);
    if (!garment) return;
    const draft = wx.getStorageSync("styletap_miniprogram_outfit_draft") || {};
    draft[outfitLayerForGarment(garment)] = id;
    saveOutfitDraft(draft);
    wx.showToast({ title: "已加入搭配", icon: "success" });
    this.setData({ selectedGarment: null });
    wx.switchTab({ url: "/pages/outfit/outfit" });
  },

  deleteGarment(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除单品",
      content: "删除后将从衣橱中移除。",
      success: (result) => {
        if (!result.confirm) return;
        const database = this.data.database || loadDatabase();
        database.garments = database.garments.filter((item) => item.id !== id);
        saveDatabase(database);
        this.refresh();
      }
    });
  },

  async regenerateFlatImage(event) {
    const id = event.currentTarget.dataset.id;
    const database = this.data.database || loadDatabase();
    const garment = database.garments.find((item) => item.id === id);
    if (!garment?.imagePath) {
      wx.showToast({ title: "没有可参考图片", icon: "none" });
      return;
    }
    this.setData({ regenerating: true });
    wx.showLoading({ title: "生成单品图" });
    try {
      const aiPath = await compressImageForAi(garment.imagePath, "fast");
      const dataUrl = await fileToDataUrl(aiPath || garment.imagePath, "fast");
      const newImagePath = await generateFlatImage(garment, dataUrl, "fast");
      database.garments = database.garments.map((item) => item.id === id ? { ...item, imagePath: newImagePath, imageError: "" } : item);
      saveDatabase(database);
      const updated = database.garments.find((item) => item.id === id);
      this.setData({ database, selectedGarment: this.decorateGarment(updated), regenerating: false });
      this.refresh();
      wx.showToast({ title: "已生成", icon: "success" });
    } catch (error) {
      this.setData({ regenerating: false });
      wx.showModal({ title: "生成失败", content: error.message || "请稍后重试", showCancel: false });
    } finally {
      wx.hideLoading();
    }
  }
});
