const { OCCASIONS, OUTFIT_LAYERS } = require("../../utils/constants");
const {
  loadDatabase,
  saveDatabase,
  saveOutfitDraft,
  loadOutfitDraft,
  defaultOutfitSelections,
  outfitLayerForGarment,
  uid
} = require("../../utils/storage");
const { buildRecommendations } = require("../../utils/recommendation");
const { syncTabBar } = require("../../utils/tabbar");

Page({
  data: {
    scenes: OCCASIONS,
    scene: "通勤",
    sceneIndex: 1,
    database: null,
    selections: {},
    layers: [],
    selectedGarments: [],
    plans: []
  },

  onShow() {
    syncTabBar(this, 3);
    this.refresh();
  },

  refresh() {
    const database = loadDatabase();
    const scene = wx.getStorageSync("styletap_scene") || this.data.scene || "通勤";
    const draft = { ...defaultOutfitSelections(database), ...loadOutfitDraft() };
    const selectedGarments = OUTFIT_LAYERS.map((layer) => database.garments.find((item) => item.id === draft[layer.key])).filter(Boolean);
    const layers = OUTFIT_LAYERS.map((layer) => {
      const candidates = database.garments.filter((item) => layer.accepts.includes(item.category));
      const optionIds = ["", ...candidates.map((item) => item.id)];
      const selectedIndex = Math.max(0, optionIds.indexOf(draft[layer.key] || ""));
      return {
        ...layer,
        optionIds,
        optionNames: ["未选择", ...candidates.map((item) => item.name)],
        selectedIndex,
        selectedName: selectedIndex > 0 ? candidates[selectedIndex - 1]?.name || "未选择" : "未选择"
      };
    });
    this.setData({
      database,
      scene,
      sceneIndex: Math.max(0, OCCASIONS.indexOf(scene)),
      selections: draft,
      layers,
      selectedGarments,
      plans: buildRecommendations(database, scene)
    });
  },

  changeLayer(event) {
    const key = event.currentTarget.dataset.key;
    const layer = this.data.layers.find((item) => item.key === key);
    const selectedIndex = Number(event.detail.value || 0);
    const selections = { ...this.data.selections, [key]: layer?.optionIds[selectedIndex] || "" };
    saveOutfitDraft(selections);
    this.setData({ selections }, () => this.refresh());
  },

  changeScene(event) {
    const index = Number(event.detail.value || 0);
    const scene = OCCASIONS[index] || "通勤";
    wx.setStorageSync("styletap_scene", scene);
    this.setData({ scene, sceneIndex: index }, () => this.refresh());
  },

  useGarment(event) {
    const id = event.currentTarget.dataset.id;
    const garment = this.data.database.garments.find((item) => item.id === id);
    if (!garment) return;
    const selections = { ...this.data.selections, [outfitLayerForGarment(garment)]: id };
    saveOutfitDraft(selections);
    this.setData({ selections }, () => this.refresh());
  },

  saveOutfit() {
    const garmentIDs = Object.values(this.data.selections).filter(Boolean);
    if (!garmentIDs.length) {
      wx.showToast({ title: "先选择单品", icon: "none" });
      return;
    }
    const database = this.data.database || loadDatabase();
    database.outfits = [
      {
        id: uid("outfit"),
        name: `${this.data.scene}穿搭`,
        garmentIDs,
        occasion: this.data.scene,
        seasons: [],
        isFavorite: false,
        createdAt: new Date().toISOString()
      },
      ...(database.outfits || [])
    ];
    saveDatabase(database);
    wx.showToast({ title: "已保存穿搭", icon: "success" });
  }
});
