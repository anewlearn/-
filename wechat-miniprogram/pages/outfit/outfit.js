const { OCCASIONS, OUTFIT_LAYERS } = require("../../utils/constants");
const {
  loadDatabase,
  saveDatabase,
  saveOutfitDraft,
  loadOutfitDraft,
  defaultOutfitSelections,
  outfitLayerForGarment,
  saveLocalFile,
  uid
} = require("../../utils/storage");
const api = require("../../utils/api");
const { buildRecommendations } = require("../../utils/recommendation");
const { generateOutfitPlansWithAI, generateOutfitTryOnImage } = require("../../utils/ai");
const { syncTabBar } = require("../../utils/tabbar");

function planKeywords(plan) {
  if (Array.isArray(plan.styleKeywords)) return plan.styleKeywords.join(" / ");
  return plan.keywords || "";
}

function decorateAiPlan(plan, database, bestPlanId) {
  const garmentIds = Array.isArray(plan.garmentIds) ? plan.garmentIds : [];
  const garments = garmentIds
    .map((id) => (database.garments || []).find((item) => item.id === id))
    .filter(Boolean);
  return {
    ...plan,
    id: plan.id || uid("ai-plan"),
    title: plan.name || plan.title || "AI 搭配方案",
    keywords: planKeywords(plan),
    garments,
    isBest: bestPlanId ? plan.id === bestPlanId : false
  };
}

Page({
  data: {
    scenes: OCCASIONS,
    scene: "通勤",
    sceneIndex: 1,
    aiModes: ["快速", "正常"],
    aiMode: "fast",
    aiModeIndex: 0,
    aiModeLabel: "快速",
    database: null,
    selections: {},
    layers: [],
    selectedGarments: [],
    plans: [],
    aiPlans: [],
    aiSummary: null,
    aiLoading: false,
    tryOnLoading: false,
    tryOnImagePath: "",
    tryOnPersonPath: "",
    tryOnPersonName: "",
    aiReady: false,
    aiStatus: "检查中",
    error: ""
  },

  onShow() {
    syncTabBar(this, 3);
    this.refresh();
    this.refreshAiStatus();
  },

  async refreshAiStatus() {
    try {
      const result = await api.get("/api/config", { timeout: 20000 });
      this.setData({
        aiReady: Boolean(result.hasApiKey),
        aiStatus: result.hasApiKey ? `${result.provider || "AI"} 已连接` : "AI 未配置"
      });
    } catch (error) {
      this.setData({ aiReady: false, aiStatus: "AI 连接失败" });
    }
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
    this.setData({ scene, sceneIndex: index, aiPlans: [], aiSummary: null }, () => this.refresh());
  },

  changeAiMode(event) {
    const index = Number(event.detail.value || 0);
    this.setData({
      aiModeIndex: index,
      aiMode: index === 1 ? "normal" : "fast",
      aiModeLabel: index === 1 ? "正常" : "快速"
    });
  },

  setAiMode(event) {
    const mode = event.currentTarget.dataset.mode === "normal" ? "normal" : "fast";
    this.setData({
      aiMode: mode,
      aiModeIndex: mode === "normal" ? 1 : 0,
      aiModeLabel: mode === "normal" ? "正常" : "快速"
    });
  },

  useGarment(event) {
    const id = event.currentTarget.dataset.id;
    const garment = this.data.database.garments.find((item) => item.id === id);
    if (!garment) return;
    const selections = { ...this.data.selections, [outfitLayerForGarment(garment)]: id };
    saveOutfitDraft(selections);
    this.setData({ selections }, () => this.refresh());
  },

  applyPlan(event) {
    const id = event.currentTarget.dataset.id;
    const source = event.currentTarget.dataset.source || "ai";
    const plans = source === "local" ? this.data.plans : this.data.aiPlans;
    const plan = plans.find((item) => item.id === id);
    if (!plan) return;
    const selections = { ...this.data.selections };
    (plan.garments || []).forEach((garment) => {
      selections[outfitLayerForGarment(garment)] = garment.id;
    });
    saveOutfitDraft(selections);
    this.setData({ selections }, () => this.refresh());
    wx.showToast({ title: "已应用搭配", icon: "success" });
  },

  async generateAiPlans() {
    const database = this.data.database || loadDatabase();
    if (!(database.garments || []).length) {
      wx.showToast({ title: "先添加衣服", icon: "none" });
      return;
    }
    this.setData({ aiLoading: true, error: "" });
    try {
      const result = await generateOutfitPlansWithAI({
        garments: database.garments || [],
        scene: this.data.scene,
        preference: database.preference || {},
        bodyProfile: database.bodyProfile || {},
        aiMode: this.data.aiMode
      });
      const aiPlans = (result.plans || []).map((plan) => decorateAiPlan(plan, database, result.bestPlanId));
      this.setData({
        aiPlans,
        aiSummary: {
          wardrobeStyle: result.wardrobeStyle || "",
          screeningLogic: result.screeningLogic || "",
          excludedSummary: result.excludedSummary || "",
          bestReason: result.bestReason || "",
          sourceCount: result.report?.sourceCount || 0,
          usableCount: result.report?.usableCount || 0,
          candidateCount: result.report?.candidates?.length || 0
        }
      });
      wx.showToast({ title: "AI 推荐已生成", icon: "success" });
    } catch (error) {
      this.setData({ error: error.message || "AI 推荐失败" });
      wx.showToast({ title: "已显示本地推荐", icon: "none" });
    } finally {
      this.setData({ aiLoading: false });
    }
  },

  choosePersonImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: async (result) => {
        const file = result.tempFiles?.[0];
        if (!file?.tempFilePath) return;
        const savedPath = await saveLocalFile(file.tempFilePath);
        this.setData({
          tryOnPersonPath: savedPath || file.tempFilePath,
          tryOnPersonName: "人物参考图",
          tryOnImagePath: ""
        });
      }
    });
  },

  clearPersonImage() {
    this.setData({ tryOnPersonPath: "", tryOnPersonName: "", tryOnImagePath: "" });
  },

  async generateTryOn() {
    if (!this.data.selectedGarments.length) {
      wx.showToast({ title: "先选择单品", icon: "none" });
      return;
    }
    if (!this.data.aiReady) {
      wx.showToast({ title: "AI 未连接", icon: "none" });
      return;
    }
    this.setData({ tryOnLoading: true, error: "" });
    try {
      const imagePath = await generateOutfitTryOnImage({
        garments: this.data.selectedGarments,
        scene: this.data.scene,
        bodyProfile: this.data.database?.bodyProfile || {},
        personImagePath: this.data.tryOnPersonPath,
        aiMode: this.data.aiMode
      });
      this.setData({ tryOnImagePath: imagePath });
      wx.showToast({ title: "试穿图已生成", icon: "success" });
    } catch (error) {
      this.setData({ error: error.message || "AI 试穿失败" });
      wx.showModal({ title: "AI 试穿失败", content: error.message || "请稍后重试", showCancel: false });
    } finally {
      this.setData({ tryOnLoading: false });
    }
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
        previewImagePath: this.data.tryOnImagePath || "",
        createdAt: new Date().toISOString()
      },
      ...(database.outfits || [])
    ];
    saveDatabase(database);
    wx.showToast({ title: "已保存穿搭", icon: "success" });
  }
});
