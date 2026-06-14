const { loadDatabase, saveDatabase, saveLocalFile, makeGarment, uid } = require("../../utils/storage");
const api = require("../../utils/api");
const { fileToDataUrl, compressImageForAi, recognizeSingle, recognizeOutfit, generateFlatImage, fallbackGarment } = require("../../utils/ai");
const { syncTabBar } = require("../../utils/tabbar");

Page({
  data: {
    mode: "single",
    aiModes: ["快速", "正常"],
    aiMode: "fast",
    aiModeIndex: 0,
    aiModeLabel: "快速",
    generateFlat: true,
    processing: false,
    queue: [],
    pendingGarments: [],
    aiStatus: "检查中",
    aiReady: false,
    aiStatusDetail: "正在连接 AI 服务"
  },

  onShow() {
    syncTabBar(this, 2);
    this.refreshAiStatus();
  },

  async refreshAiStatus() {
    try {
      const result = await api.get("/api/config", { timeout: 20000 });
      const provider = result.provider || result.providerId || "AI";
      this.setData({
        aiReady: Boolean(result.hasApiKey),
        aiStatus: result.hasApiKey ? `${provider} 已连接` : "AI 未配置",
        aiStatusDetail: result.hasApiKey
          ? `当前模型：${result.model || "未返回"}，图片会先压缩后上传识别。`
          : "请先在 Render 环境变量中配置 OPENAI_API_KEYS 或 GOOGLE_API_KEYS。"
      });
    } catch (error) {
      this.setData({
        aiReady: false,
        aiStatus: "AI 服务连接失败",
        aiStatusDetail: error.message || "请检查 Render 是否已部署。"
      });
    }
  },

  setMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode || "single" });
  },

  changeAiMode(event) {
    const index = Number(event.detail.value || 0);
    this.setData({
      aiModeIndex: index,
      aiMode: index === 1 ? "normal" : "fast",
      aiModeLabel: index === 1 ? "正常" : "快速"
    });
  },

  toggleGenerateFlat(event) {
    this.setData({ generateFlat: Boolean(event.detail.value) });
  },

  chooseImages() {
    if (this.data.processing) return;
    if (!this.data.aiReady) {
      wx.showToast({ title: "AI 未连接，将尝试识别并保留失败提示", icon: "none" });
    }
    wx.chooseMedia({
      count: 10,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (result) => {
        const files = (result.tempFiles || []).slice(0, 10);
        if (!files.length) return;
        this.startQueue(files);
      },
      fail: (error) => {
        if (!String(error.errMsg || "").includes("cancel")) {
          wx.showToast({ title: "选择图片失败", icon: "none" });
        }
      }
    });
  },

  async startQueue(files) {
    const queue = files.map((file, index) => ({
      id: uid("task"),
      path: file.tempFilePath,
      name: `图片 ${index + 1}`,
      status: "等待处理",
      error: ""
    }));
    this.setData({ queue, processing: true, pendingGarments: [] });
    const pendingGarments = [];
    for (let index = 0; index < files.length; index += 1) {
      const task = queue[index];
      const garments = await this.processFile(files[index], task);
      pendingGarments.push(...garments);
      this.setData({
        pendingGarments: pendingGarments.map((item) => ({ ...item, tagsText: (item.aiTags || []).slice(0, 4).join(" / ") }))
      });
    }
    this.setData({ processing: false });
    wx.showToast({ title: pendingGarments.length ? "识别完成" : "未识别到单品", icon: "none" });
  },

  updateTask(id, patch) {
    const queue = this.data.queue.map((task) => task.id === id ? { ...task, ...patch } : task);
    this.setData({ queue });
  },

  async processFile(file, task) {
    const tempPath = file.tempFilePath;
    const fileName = tempPath.split("/").pop() || task.name;
    try {
      this.updateTask(task.id, { status: "保存图片" });
      const savedPath = await saveLocalFile(tempPath);
      this.updateTask(task.id, { status: "压缩图片给 AI" });
      const aiPath = await compressImageForAi(savedPath || tempPath, this.data.aiMode);
      this.updateTask(task.id, { status: "读取压缩图" });
      const imageDataUrl = await fileToDataUrl(aiPath || savedPath || tempPath, this.data.aiMode);
      if (this.data.mode === "outfit") {
        return await this.processOutfitImage(task, fileName, savedPath, imageDataUrl);
      }
      return [await this.processSingleImage(task, fileName, savedPath, imageDataUrl)];
    } catch (error) {
      this.updateTask(task.id, { status: "AI 失败，已生成待确认单品", error: error.message || "处理失败" });
      return [fallbackGarment(fileName, tempPath)];
    }
  },

  async processSingleImage(task, fileName, savedPath, imageDataUrl) {
    this.updateTask(task.id, { status: "AI 打标签" });
    const metadata = await recognizeSingle(imageDataUrl, fileName, this.data.aiMode);
    const garment = makeGarment({ ...metadata, imagePath: savedPath, originalImagePath: fileName });
    if (this.data.generateFlat) {
      try {
        this.updateTask(task.id, { status: "生成 AI 单品图" });
        garment.imagePath = await generateFlatImage(garment, imageDataUrl, this.data.aiMode);
      } catch (error) {
        garment.imageError = error.message || "AI 单品图生成失败";
      }
    }
    this.updateTask(task.id, { status: "已完成" });
    return garment;
  },

  async processOutfitImage(task, fileName, savedPath, imageDataUrl) {
    this.updateTask(task.id, { status: "全身多件识别" });
    const result = await recognizeOutfit(imageDataUrl, fileName, this.data.aiMode);
    const items = result.items.length ? result.items : [{ name: "待确认上衣", category: "上衣", subcategory: "待确认" }];
    const garments = [];
    for (let index = 0; index < items.length; index += 1) {
      const garment = makeGarment({ ...items[index], imagePath: savedPath, originalImagePath: fileName });
      if (this.data.generateFlat && index < 4) {
        try {
          this.updateTask(task.id, { status: `生成第 ${index + 1} 件单品图` });
          garment.imagePath = await generateFlatImage(garment, imageDataUrl, this.data.aiMode);
        } catch (error) {
          garment.imageError = error.message || "AI 单品图生成失败";
        }
      }
      garments.push(garment);
    }
    this.updateTask(task.id, { status: `已完成：${garments.length} 件` });
    return garments;
  },

  confirmGarments() {
    if (!this.data.pendingGarments.length) return;
    const database = loadDatabase();
    database.garments = [...this.data.pendingGarments, ...database.garments];
    saveDatabase(database);
    this.setData({ pendingGarments: [], queue: [] });
    wx.showToast({ title: "已加入衣橱", icon: "success" });
    wx.switchTab({ url: "/pages/wardrobe/wardrobe" });
  }
});
