const { loadDatabase, saveDatabase, makeGarment, saveLocalFile, downloadAndSaveFile, uid } = require("../../utils/storage");
const api = require("../../utils/api");
const { fallbackGarment } = require("../../utils/ai");
const { syncTabBar } = require("../../utils/tabbar");

const CAPTURE_TASKS_KEY = "styletap_capture_tasks_v0_2";
const TERMINAL_STATUSES = ["completed", "failed", "cached"];

function decorateGarment(item) {
  return {
    ...item,
    tagsText: (item.aiTags || []).slice(0, 4).join(" / "),
    statusText: item.imageStatus === "done" || item.imageStatus === "local" ? "AI 单品图" : item.imageStatus === "failed" ? "保留原图" : "已打标签"
  };
}

function statusLabel(task) {
  if (task.error) return task.error;
  if (task.statusText) return task.statusText;
  return {
    queued: "后端排队中",
    recognizing: "AI 正在识别",
    generating: "正在生成单品图",
    completed: "已完成",
    cached: "已复用缓存结果",
    failed: "处理失败"
  }[task.status] || "等待处理";
}

Page({
  data: {
    mode: "single",
    aiModes: ["快速", "正常"],
    aiMode: "fast",
    aiModeIndex: 0,
    aiModeLabel: "快速",
    generateFlat: true,
    processing: false,
    uploading: false,
    queue: [],
    pendingGarments: [],
    aiStatus: "检查中",
    aiReady: false,
    asyncReady: false,
    aiStatusDetail: "正在连接 AI 服务",
    queueSummary: "",
    lastError: ""
  },

  onShow() {
    syncTabBar(this, 2);
    this.restoreQueue();
    this.refreshAiStatus();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  async refreshAiStatus() {
    try {
      const result = await api.get("/api/config", { timeout: 20000 });
      const provider = result.provider || result.providerId || "AI";
      const asyncReady = Boolean(result.processing && result.processing.asyncUploadEnabled);
      this.setData({
        aiReady: Boolean(result.hasApiKey),
        asyncReady,
        aiStatus: result.hasApiKey ? `${provider} 已连接` : "AI 未配置",
        aiStatusDetail: result.hasApiKey
          ? asyncReady
            ? `当前模型：${result.model || "未返回"}。图片会上传原图，后端保存高清文件并排队处理。`
            : "当前后端还不是异步上传版本，请先部署最新代码。"
          : "请先在 Render 环境变量中配置 OPENAI_API_KEYS 或 GOOGLE_API_KEYS。"
      });
    } catch (error) {
      this.setData({
        aiReady: false,
        asyncReady: false,
        aiStatus: "AI 服务连接失败",
        aiStatusDetail: error.message || "请检查 Render 是否已部署。"
      });
    }
  },

  setMode(event) {
    if (this.data.processing || this.data.uploading) return;
    this.setData({ mode: event.currentTarget.dataset.mode || "single" });
  },

  changeAiMode(event) {
    if (this.data.processing || this.data.uploading) return;
    const index = Number(event.detail.value || 0);
    this.setData({
      aiModeIndex: index,
      aiMode: index === 1 ? "normal" : "fast",
      aiModeLabel: index === 1 ? "正常" : "快速"
    });
  },

  toggleGenerateFlat(event) {
    if (this.data.processing || this.data.uploading) return;
    this.setData({ generateFlat: Boolean(event.detail.value) });
  },

  chooseImages() {
    if (this.data.processing || this.data.uploading) return;
    if (!this.data.asyncReady) {
      wx.showModal({
        title: "需要部署新版后端",
        content: "原图上传和后台任务接口还不可用。请先把最新后端上传 GitHub 并等待 Render 重新部署。",
        showCancel: false
      });
      return;
    }
    if (!this.data.aiReady) {
      wx.showToast({ title: "AI 未连接，将保留失败提示", icon: "none" });
    }
    wx.chooseMedia({
      count: 10,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["original"],
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
    this.stopPolling();
    const queue = files.map((file, index) => ({
      id: uid("local-task"),
      path: file.tempFilePath,
      name: `图片 ${index + 1}`,
      status: "waiting",
      statusText: "等待上传原图",
      progress: 0,
      taskId: "",
      remoteUrl: "",
      error: "",
      imported: false,
      localSaved: false
    }));
    this.setData({
      queue,
      processing: true,
      uploading: true,
      pendingGarments: [],
      lastError: "",
      queueSummary: `0/${queue.length} 已上传`
    });
    this.persistQueue();

    let uploaded = 0;
    for (let index = 0; index < files.length; index += 1) {
      const local = this.data.queue[index];
      if (!local) continue;
      try {
        this.patchQueue(local.id, { statusText: "上传原图", progress: 6 });
        const result = await api.upload("/api/processing/upload", files[index].tempFilePath, {
          mode: this.data.mode,
          aiMode: this.data.aiMode,
          generateFlat: this.data.generateFlat ? "true" : "false"
        }, { timeout: 240000 });
        uploaded += 1;
        const task = result.task || {};
        this.patchQueue(local.id, {
          taskId: task.id || "",
          remoteUrl: result.upload?.url || task.imageUrl || "",
          status: task.status || "queued",
          statusText: statusLabel(task),
          progress: Number(task.progress || 10),
          error: ""
        });
        this.applyRemoteTasks([task]);
        this.setData({ queueSummary: `${uploaded}/${queue.length} 已上传` });
      } catch (error) {
        this.patchQueue(local.id, {
          status: "failed",
          statusText: "上传失败",
          progress: 100,
          error: error.message || "上传失败"
        });
      }
    }
    this.setData({ uploading: false });
    this.persistQueue();
    if (this.data.queue.some((item) => item.taskId && !TERMINAL_STATUSES.includes(item.status))) {
      this.startPolling();
    } else {
      this.finishIfDone();
    }
  },

  patchQueue(id, patch) {
    const queue = this.data.queue.map((task) => task.id === id ? { ...task, ...patch } : task);
    this.setData({ queue });
    this.persistQueue(queue);
  },

  persistQueue(queue = this.data.queue) {
    wx.setStorageSync(CAPTURE_TASKS_KEY, {
      mode: this.data.mode,
      aiMode: this.data.aiMode,
      aiModeIndex: this.data.aiModeIndex,
      aiModeLabel: this.data.aiModeLabel,
      generateFlat: this.data.generateFlat,
      queue,
      pendingGarments: this.data.pendingGarments,
      updatedAt: Date.now()
    });
  },

  restoreQueue() {
    const saved = wx.getStorageSync(CAPTURE_TASKS_KEY);
    if (!saved || !Array.isArray(saved.queue) || !saved.queue.length || this.data.queue.length) {
      return;
    }
    const pendingGarments = (saved.pendingGarments || []).map(decorateGarment);
    const hasActive = saved.queue.some((item) => item.taskId && !TERMINAL_STATUSES.includes(item.status));
    this.setData({
      mode: saved.mode || "single",
      aiMode: saved.aiMode || "fast",
      aiModeIndex: Number(saved.aiModeIndex || 0),
      aiModeLabel: saved.aiModeLabel || "快速",
      generateFlat: saved.generateFlat !== false,
      queue: saved.queue,
      pendingGarments,
      processing: hasActive,
      queueSummary: hasActive ? "正在恢复任务进度" : "已恢复上次结果"
    });
    if (hasActive) {
      this.startPolling();
    }
  },

  startPolling() {
    this.stopPolling();
    this.pollTimer = setTimeout(() => this.pollTasks(), 1200);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  },

  async pollTasks() {
    const ids = this.data.queue.map((item) => item.taskId).filter(Boolean);
    if (!ids.length) {
      this.finishIfDone();
      return;
    }
    try {
      const result = await api.get(`/api/processing/tasks?ids=${encodeURIComponent(ids.join(","))}`, { timeout: 25000 });
      this.applyRemoteTasks(result.tasks || []);
      this.finishIfDone();
    } catch (error) {
      this.setData({ lastError: error.message || "进度刷新失败" });
      this.pollTimer = setTimeout(() => this.pollTasks(), 5000);
    }
  },

  applyRemoteTasks(remoteTasks) {
    if (!Array.isArray(remoteTasks) || !remoteTasks.length) return;
    const byId = {};
    remoteTasks.forEach((task) => {
      if (task && task.id) byId[task.id] = task;
    });

    const existing = {};
    this.data.pendingGarments.forEach((garment) => {
      existing[garment.id] = garment;
    });

    const queue = this.data.queue.map((local) => {
      const remote = byId[local.taskId];
      if (!remote) return local;
      if ((remote.garments || []).length && !local.localSaved) {
        (remote.garments || []).forEach((raw) => {
          const garment = decorateGarment(makeGarment(raw));
          existing[garment.id] = garment;
        });
      }
      return {
        ...local,
        status: remote.status || local.status,
        statusText: statusLabel(remote),
        progress: Number(remote.progress || local.progress || 0),
        error: remote.error || ""
      };
    });

    const pendingGarments = Object.values(existing);
    this.setData({
      queue,
      pendingGarments,
      queueSummary: this.queueSummary(queue)
    });
    this.persistQueue(queue);
    remoteTasks
      .filter((task) => task && task.id && TERMINAL_STATUSES.includes(task.status))
      .forEach((task) => this.localizeRemoteTask(task));
  },

  async localizeRemoteTask(remoteTask) {
    if (!remoteTask || !remoteTask.id) return;
    if (!this.localizingTaskIds) this.localizingTaskIds = {};
    if (this.localizingTaskIds[remoteTask.id]) return;
    const localTask = this.data.queue.find((item) => item.taskId === remoteTask.id);
    if (!localTask || localTask.localSaved) return;
    this.localizingTaskIds[remoteTask.id] = true;
    try {
      const localized = [];
      let canAck = true;
      for (const raw of remoteTask.garments || []) {
        const garment = makeGarment(raw);
        if (/^https?:\/\//.test(String(garment.imagePath || "")) && raw.imageStatus === "done") {
          try {
            garment.imagePath = await downloadAndSaveFile(garment.imagePath);
            garment.imageStatus = "local";
            garment.imageError = "";
          } catch (error) {
            canAck = false;
            garment.imageError = error.message || "AI 图片下载失败";
          }
        } else if (/^https?:\/\//.test(String(garment.imagePath || "")) && localTask.path) {
          garment.imagePath = await saveLocalFile(localTask.path);
        }
        if (/^https?:\/\//.test(String(garment.originalImagePath || ""))) {
          garment.originalImagePath = "";
        }
        localized.push(decorateGarment(garment));
      }
      if (localized.length) {
        const byId = {};
        this.data.pendingGarments.forEach((item) => {
          byId[item.id] = item;
        });
        localized.forEach((item) => {
          byId[item.id] = item;
        });
        this.setData({ pendingGarments: Object.values(byId) });
      }
      if (canAck) {
        await api.post("/api/processing/ack", { taskIds: [remoteTask.id] }, { timeout: 30000 });
        this.patchQueue(localTask.id, { localSaved: true, statusText: "已保存到手机，服务器临时图已清理" });
      }
    } catch (error) {
      this.setData({ lastError: error.message || "保存 AI 图片到手机失败" });
    } finally {
      delete this.localizingTaskIds[remoteTask.id];
      this.persistQueue();
    }
  },

  queueSummary(queue = this.data.queue) {
    const done = queue.filter((item) => TERMINAL_STATUSES.includes(item.status)).length;
    const active = queue.find((item) => item.taskId && !TERMINAL_STATUSES.includes(item.status));
    return active ? `${done}/${queue.length} 完成 · ${active.statusText}` : `${done}/${queue.length} 完成`;
  },

  finishIfDone() {
    const queue = this.data.queue;
    const hasActive = queue.some((item) => item.taskId && !TERMINAL_STATUSES.includes(item.status));
    const hasUploading = this.data.uploading;
    if (hasActive || hasUploading) {
      this.pollTimer = setTimeout(() => this.pollTasks(), 3000);
      return;
    }
    this.stopPolling();
    this.setData({ processing: false, uploading: false, queueSummary: this.queueSummary(queue) });
    this.persistQueue(queue);
  },

  clearQueue() {
    if (this.data.processing || this.data.uploading) {
      wx.showToast({ title: "任务处理中，稍后再清空", icon: "none" });
      return;
    }
    this.stopPolling();
    wx.removeStorageSync(CAPTURE_TASKS_KEY);
    this.setData({ queue: [], pendingGarments: [], queueSummary: "", lastError: "" });
  },

  confirmGarments() {
    if (!this.data.pendingGarments.length) return;
    const database = loadDatabase();
    database.garments = [...this.data.pendingGarments, ...database.garments];
    saveDatabase(database);
    wx.removeStorageSync(CAPTURE_TASKS_KEY);
    this.stopPolling();
    this.setData({ pendingGarments: [], queue: [], queueSummary: "", processing: false, uploading: false });
    wx.showToast({ title: "已加入衣橱", icon: "success" });
    wx.switchTab({ url: "/pages/wardrobe/wardrobe" });
  },

  addFallbackForFailed(event) {
    const id = event.currentTarget.dataset.id;
    const task = this.data.queue.find((item) => item.id === id);
    if (!task) return;
    const garment = decorateGarment(fallbackGarment(task.name, task.path));
    this.setData({ pendingGarments: [garment, ...this.data.pendingGarments] });
    this.persistQueue();
    wx.showToast({ title: "已保留待确认单品", icon: "none" });
  }
});
