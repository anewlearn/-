import { renderBottomNav, renderDetailSheet, renderToast, byId } from "../core/design-system/components.js";
import { OUTFIT_LAYERS } from "../models/schema.js";
import {
  createGarmentFromCapture,
  clearServerDatabase,
  getWardrobeStorageInfo,
  loadDatabase,
  loadDatabaseFromServer,
  resetDatabase,
  saveDatabase,
  saveDatabaseToServer,
} from "../services/storage.js";
import { buildOutfitRecommendations, getTodayRecommendation } from "../services/recommendation-service.js";
import { renderCapture } from "../features/capture/capture.js";
import { renderHome } from "../features/home/home.js";
import { renderOutfit } from "../features/outfit-builder/outfit.js";
import { renderSettings } from "../features/settings/settings.js";
import { renderWardrobe } from "../features/wardrobe/wardrobe.js";
import {
  clearRuntimeApiKey,
  generateGarmentFlatImage,
  generateOutfitPlansWithAI,
  generateOutfitTryOnImage,
  getAiModeConfig,
  getApiConfig,
  recognizeGarmentFromImage,
  recognizeOutfitItemsFromImage,
  setRuntimeApiKey,
} from "../services/ai-client.js";

const root = document.querySelector("#app");
let database = loadDatabase();
let toastTimer = null;

function pickFirst(category) {
  return database.garments.find((garment) => garment.category === category && garment.status === "可穿")?.id || "";
}

function defaultOutfitSelections() {
  return {
    outer: pickFirst("外套"),
    top: pickFirst("上衣"),
    bottom: pickFirst("下装") || pickFirst("连衣裙"),
    shoes: pickFirst("鞋子"),
    bag: pickFirst("包包"),
    accessory: pickFirst("配饰"),
  };
}

const ui = {
  tab: "home",
  category: "全部",
  season: "全部",
  selectedScene: "通勤",
  detailId: null,
  toast: "",
  capture: {
    mode: "single",
    fileName: "",
    previewUrl: "",
    imageDataUrl: "",
    stepIndex: 0,
    pendingGarment: null,
    pendingGarments: [],
    selectedPendingGarmentIds: [],
    skippedItems: [],
    isProcessing: false,
    aiError: "",
  },
  outfitSelections: defaultOutfitSelections(),
  aiPlans: null,
  aiStylistReport: null,
  tryOn: {
    isGenerating: false,
    imageDataUrl: "",
    error: "",
    personFileName: "",
    personPreviewUrl: "",
    personImageDataUrl: "",
  },
  apiConfig: null,
  storageInfo: null,
};

const pages = {
  home: () => renderHome(database, ui),
  wardrobe: () => renderWardrobe(database, ui),
  capture: () => renderCapture(database, ui),
  outfit: () => renderOutfit(database, ui),
  settings: () => renderSettings(database, ui),
};

function persist() {
  database.updatedAt = new Date().toISOString();
  saveDatabase(database);
  saveDatabaseToServer(database).catch((error) => {
    console.warn("Failed to save wardrobe database to server", error);
  });
  refreshStorageInfo();
}

async function hydrateDatabaseFromServer() {
  const serverDatabase = await loadDatabaseFromServer();
  if (serverDatabase) {
    database = serverDatabase;
    saveDatabase(database);
    ui.outfitSelections = defaultOutfitSelections();
    ui.detailId = null;
    ui.aiPlans = null;
    ui.aiStylistReport = null;
    await refreshStorageInfo();
    return;
  }

  saveDatabaseToServer(database).catch((error) => {
    console.warn("Failed to create initial server wardrobe database", error);
  });
}

async function refreshApiConfig() {
  ui.apiConfig = await getApiConfig();
  render();
}

async function refreshStorageInfo() {
  let estimate = null;
  try {
    estimate = (await navigator.storage?.estimate?.()) || null;
  } catch (error) {
    estimate = null;
  }
  ui.storageInfo = getWardrobeStorageInfo(database, estimate);
  render();
}

function currentAiMode() {
  return database.preference.aiMode || "fast";
}

function currentAiModeConfig() {
  return getAiModeConfig(currentAiMode());
}

function showToast(message) {
  ui.toast = message;
  render();
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    ui.toast = "";
    render();
  }, 1800);
}

function navigate(tab) {
  ui.tab = tab;
  ui.detailId = null;
  render();
}

function resetCapture() {
  if (ui.capture.previewUrl) {
    URL.revokeObjectURL(ui.capture.previewUrl);
  }
  ui.capture = {
    mode: ui.capture.mode || "single",
    fileName: "",
    previewUrl: "",
    imageDataUrl: "",
    stepIndex: 0,
    pendingGarment: null,
    pendingGarments: [],
    selectedPendingGarmentIds: [],
    skippedItems: [],
    isProcessing: false,
    aiError: "",
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("Failed to read file.")));
    reader.readAsDataURL(file);
  });
}

function updatePendingGarment(id, patch) {
  ui.capture.pendingGarments = (ui.capture.pendingGarments || []).map((garment) =>
    garment.id === id ? { ...garment, ...patch } : garment,
  );
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function generateOutfitGarmentImages(garments, mode) {
  const modeConfig = currentAiModeConfig();
  let successCount = 0;
  let failedCount = 0;

  await runWithConcurrency(garments, modeConfig.outfitImageConcurrency || 2, async (garment) => {
    updatePendingGarment(garment.id, { imageStatus: "generating", imageError: "" });
    render();
    try {
      const imagePath = await generateGarmentFlatImage(garment, ui.capture.imageDataUrl, {
        aiMode: mode,
      });
      updatePendingGarment(garment.id, {
        imagePath,
        imageStatus: "done",
        imageError: "",
      });
      successCount += 1;
    } catch (error) {
      updatePendingGarment(garment.id, {
        imageStatus: "failed",
        imageError: error.message,
      });
      failedCount += 1;
    }
    render();
  });

  return { successCount, failedCount };
}

async function fileToDataUrl(file, options = {}) {
  const { maxEdge = 1600, quality = 0.9 } = options;
  const dataUrl = await readFileAsDataUrl(file);
  if (!file.type.startsWith("image/") || dataUrl.startsWith("data:image/gif") || dataUrl.startsWith("data:image/svg")) {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const longest = Math.max(width, height);
      if (!width || !height || longest <= maxEdge) {
        resolve(dataUrl);
        return;
      }

      const scale = maxEdge / longest;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    });
    image.addEventListener("error", () => resolve(dataUrl));
    image.src = dataUrl;
  });
}

function tryOnPersonState() {
  return {
    personFileName: ui.tryOn.personFileName || "",
    personPreviewUrl: ui.tryOn.personPreviewUrl || "",
    personImageDataUrl: ui.tryOn.personImageDataUrl || "",
  };
}

function setTryOnState(next) {
  ui.tryOn = {
    ...tryOnPersonState(),
    isGenerating: false,
    imageDataUrl: "",
    error: "",
    ...next,
  };
}

function clearTryOnPerson() {
  if (ui.tryOn.personPreviewUrl) {
    URL.revokeObjectURL(ui.tryOn.personPreviewUrl);
  }
  ui.tryOn = {
    isGenerating: false,
    imageDataUrl: "",
    error: "",
    personFileName: "",
    personPreviewUrl: "",
    personImageDataUrl: "",
  };
}

function selectedGarmentIds() {
  return Object.values(ui.outfitSelections).filter(Boolean);
}

function hasApiKey() {
  return Boolean(ui.apiConfig?.hasApiKey);
}

function applyGarmentsToLayers(garmentIDs) {
  const next = { outer: "", top: "", bottom: "", shoes: "", bag: "", accessory: "" };
  for (const id of garmentIDs) {
    const garment = byId(database.garments, id);
    if (!garment) continue;
    const layer = OUTFIT_LAYERS.find((item) => item.accepts.includes(garment.category));
    if (layer && !next[layer.key]) {
      next[layer.key] = id;
    }
  }
  ui.outfitSelections = { ...ui.outfitSelections, ...next };
}

function saveOutfit(name, garmentIDs, occasion) {
  if (!garmentIDs.length) return false;
  database.outfits.unshift({
    id: `outfit-${crypto.randomUUID()}`,
    name,
    garmentIDs,
    occasion,
    seasons: ["春", "秋"],
    isFavorite: false,
    previewImagePath: "./src/assets/outfit-recommendation.png",
    wornDate: null,
    createdAt: new Date().toISOString(),
  });
  persist();
  return true;
}

function deleteGarment(id) {
  database.garments = database.garments.filter((garment) => garment.id !== id);
  database.outfits = database.outfits.map((outfit) => ({
    ...outfit,
    garmentIDs: outfit.garmentIDs.filter((garmentId) => garmentId !== id),
  }));
  for (const key of Object.keys(ui.outfitSelections)) {
    if (ui.outfitSelections[key] === id) ui.outfitSelections[key] = "";
  }
  ui.detailId = null;
  persist();
  showToast("已删除这件衣服");
}

function handleNav(event) {
  const nav = event.target.closest("[data-nav]");
  if (!nav) return false;
  navigate(nav.dataset.nav);
  return true;
}

function handleScene(event) {
  const chip = event.target.closest("[data-scene]");
  if (!chip) return false;
  ui.selectedScene = chip.dataset.scene;
  ui.tab = "outfit";
  showToast(`已按「${ui.selectedScene}」生成推荐`);
  return true;
}

function handlePreferenceChip(event) {
  const chip = event.target.closest("[data-pref-type]");
  if (!chip) return false;
  const { prefType, prefValue } = chip.dataset;
  const list = database.preference[prefType] || [];
  database.preference[prefType] = list.includes(prefValue)
    ? list.filter((item) => item !== prefValue)
    : [...list, prefValue];
  persist();
  render();
  return true;
}

async function handleAction(event) {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;

  const action = actionElement.dataset.action;
  if (action === "close-sheet" && actionElement.classList.contains("sheet-backdrop") && event.target !== actionElement) {
    return;
  }

  const id = actionElement.dataset.id;

  switch (action) {
    case "toggle-favorite": {
      const garment = byId(database.garments, id);
      if (garment) {
        garment.isFavorite = !garment.isFavorite;
        persist();
        showToast(garment.isFavorite ? "已收藏" : "已取消收藏");
      }
      break;
    }
    case "open-garment":
      ui.detailId = id;
      render();
      break;
    case "close-sheet":
      ui.detailId = null;
      render();
      break;
    case "delete-garment":
      deleteGarment(id);
      break;
    case "quick-add-garment": {
      const garment = createGarmentFromCapture("手动新增.jpg");
      garment.name = "手动新增单品";
      database.garments.unshift(garment);
      persist();
      ui.category = "全部";
      showToast("已新增一件示例衣服");
      break;
    }
    case "shuffle-today":
      database.garments = [...database.garments.slice(1), database.garments[0]];
      persist();
      showToast("已换一套推荐");
      break;
    case "save-today": {
      const recommendation = getTodayRecommendation(database.garments);
      const saved = saveOutfit(recommendation.title, recommendation.garmentIDs, recommendation.scene);
      showToast(saved ? "今日推荐已保存" : "还没有可保存的单品");
      break;
    }
    case "finish-processing": {
      const mode = currentAiMode();
      if (!hasApiKey()) {
        ui.capture.stepIndex = 4;
        ui.capture.aiError = "请先在“我的”页面输入 API Key。";
        if (ui.capture.mode === "outfit") {
          const fallback = createGarmentFromCapture(ui.capture.fileName);
          ui.capture.pendingGarments = [fallback];
          ui.capture.selectedPendingGarmentIds = [fallback.id];
          ui.capture.pendingGarment = null;
        } else {
          ui.capture.pendingGarment = createGarmentFromCapture(ui.capture.fileName);
        }
        showToast("未配置 API Key，已使用本地模拟");
        break;
      }
      ui.capture.stepIndex = 3;
      ui.capture.isProcessing = true;
      ui.capture.aiError = "";
      render();
      try {
        if (ui.capture.mode === "outfit") {
          const result = await recognizeOutfitItemsFromImage(ui.capture.imageDataUrl, ui.capture.fileName, {
            aiMode: mode,
          });
          const garments = result.items.map((item, index) =>
            createGarmentFromCapture(`${ui.capture.fileName || "整套照片"}-${index + 1}`, {
              ...item,
              imageStatus: "queued",
            }),
          );
          if (!garments.length) {
            throw new Error("AI 没有识别出可入库单品，请换一张更清晰的全身照。");
          }
          ui.capture.pendingGarments = garments;
          ui.capture.selectedPendingGarmentIds = garments.map((garment) => garment.id);
          ui.capture.skippedItems = result.skipped;
          ui.capture.pendingGarment = null;
          ui.capture.stepIndex = 4;
          render();
          showToast(`已识别并打标 ${garments.length} 件，正在生成单品图`);
          const imageResult = await generateOutfitGarmentImages(garments, mode);
          ui.capture.aiError = imageResult.failedCount
            ? `整套识别和标签已完成，${imageResult.failedCount} 件单品图生成失败，可先加入衣橱或稍后重试。`
            : "";
          showToast(`整套处理完成：${imageResult.successCount}/${garments.length} 件已生成单品图`);
          break;
        }
        const metadata = await recognizeGarmentFromImage(ui.capture.imageDataUrl, ui.capture.fileName, {
          aiMode: mode,
        });
        const draftGarment = createGarmentFromCapture(ui.capture.fileName, metadata);
        ui.capture.stepIndex = 4;
        render();
        try {
          const imagePath = await generateGarmentFlatImage(draftGarment, ui.capture.imageDataUrl, {
            aiMode: mode,
          });
          ui.capture.pendingGarment = { ...draftGarment, imagePath };
          showToast("AI 识别和生图完成");
        } catch (imageError) {
          ui.capture.aiError = `单品图生成失败：${imageError.message} 已保留识别属性。`;
          ui.capture.pendingGarment = draftGarment;
          showToast("AI 识别完成，单品图生成失败");
        }
      } catch (error) {
        ui.capture.aiError = error.message;
        if (ui.capture.mode === "outfit") {
          const fallback = createGarmentFromCapture(ui.capture.fileName);
          ui.capture.pendingGarments = [fallback];
          ui.capture.selectedPendingGarmentIds = [fallback.id];
          ui.capture.pendingGarment = null;
        } else {
          ui.capture.pendingGarment = createGarmentFromCapture(ui.capture.fileName);
        }
        showToast("AI 调用失败，已使用本地模拟");
      } finally {
        ui.capture.stepIndex = 4;
        ui.capture.isProcessing = false;
        render();
      }
      break;
    }
    case "confirm-capture": {
      if (ui.capture.mode === "outfit" && ui.capture.pendingGarments.length) {
        const selected = new Set(ui.capture.selectedPendingGarmentIds);
        const garments = ui.capture.pendingGarments.filter((garment) => selected.has(garment.id));
        if (!garments.length) {
          showToast("请先勾选至少一件单品");
          break;
        }
        database.garments.unshift(...garments);
        persist();
        resetCapture();
        ui.tab = "wardrobe";
        ui.category = "全部";
        showToast(`已加入 ${garments.length} 件单品`);
      } else if (ui.capture.pendingGarment) {
        database.garments.unshift(ui.capture.pendingGarment);
        persist();
        resetCapture();
        ui.tab = "wardrobe";
        ui.category = "全部";
        showToast("已加入衣橱");
      }
      break;
    }
    case "reset-capture":
      resetCapture();
      render();
      break;
    case "set-capture-mode": {
      const nextMode = actionElement.dataset.mode === "outfit" ? "outfit" : "single";
      const hasCurrentFile = Boolean(ui.capture.fileName);
      ui.capture.mode = nextMode;
      ui.capture.pendingGarment = null;
      ui.capture.pendingGarments = [];
      ui.capture.selectedPendingGarmentIds = [];
      ui.capture.skippedItems = [];
      ui.capture.aiError = "";
      ui.capture.stepIndex = hasCurrentFile ? 2 : 0;
      showToast(nextMode === "single" ? "已切换单品模式" : "已切换整套模式");
      render();
      break;
    }
    case "save-current-outfit": {
      const ids = selectedGarmentIds();
      const saved = saveOutfit("我的新穿搭", ids, ui.selectedScene);
      showToast(saved ? "穿搭已保存" : "先选择至少一件衣服");
      break;
    }
    case "clear-try-on-person":
      clearTryOnPerson();
      showToast("已移除人物形象");
      render();
      break;
    case "set-ai-mode": {
      const mode = actionElement.dataset.mode === "normal" ? "normal" : "fast";
      database.preference.aiMode = mode;
      ui.aiPlans = null;
      ui.aiStylistReport = null;
      persist();
      showToast(mode === "fast" ? "已切换快速模式" : "已切换正常模式");
      break;
    }
    case "generate-plans":
      if (!hasApiKey()) {
        ui.aiPlans = null;
        ui.aiStylistReport = null;
        showToast("请先在“我的”页面输入 API Key");
        break;
      }
      showToast(`正在用${currentAiModeConfig().label}模式生成大师级推荐`);
      try {
        const result = await generateOutfitPlansWithAI({
          garments: database.garments,
          scene: ui.selectedScene,
          preference: database.preference,
          bodyProfile: database.bodyProfile,
          aiMode: currentAiMode(),
        });
        ui.aiPlans = result.plans;
        ui.aiStylistReport = result;
        showToast("大师级搭配分析已生成");
      } catch (error) {
        ui.aiPlans = null;
        ui.aiStylistReport = null;
        showToast("AI 调用失败，已使用本地推荐");
      }
      break;
    case "generate-try-on": {
      const garments = selectedGarmentIds().map((garmentId) => byId(database.garments, garmentId)).filter(Boolean);
      if (!garments.length) {
        showToast("先选择至少一件衣服");
        break;
      }
      if (!hasApiKey()) {
        setTryOnState({
          isGenerating: false,
          imageDataUrl: "",
          error: "请先在“我的”页面输入 API Key。",
        });
        showToast("请先输入 API Key");
        render();
        break;
      }
      setTryOnState({ isGenerating: true, imageDataUrl: "", error: "" });
      render();
      try {
        const imageDataUrl = await generateOutfitTryOnImage({
          garments,
          scene: ui.selectedScene,
          bodyProfile: database.bodyProfile,
          personImageDataUrl: ui.tryOn.personImageDataUrl,
          aiMode: currentAiMode(),
        });
        setTryOnState({ isGenerating: false, imageDataUrl, error: "" });
        showToast("AI 试穿效果已生成");
      } catch (error) {
        setTryOnState({ isGenerating: false, imageDataUrl: "", error: error.message });
        showToast("AI 生图失败");
      }
      render();
      break;
    }
    case "apply-plan": {
      const plans = ui.aiPlans || buildOutfitRecommendations(database.garments, { scene: ui.selectedScene });
      const plan = plans.find((item) => item.id === actionElement.dataset.plan);
      if (plan) {
        applyGarmentsToLayers(plan.garmentIDs);
        showToast(`已使用「${plan.name}」`);
      }
      break;
    }
    case "feedback-plan":
      database.preference.feedback.push({
        plan: actionElement.dataset.plan,
        value: "不喜欢",
        createdAt: new Date().toISOString(),
      });
      persist();
      showToast("已记录反馈");
      break;
    case "reset-demo":
      resetCapture();
      clearTryOnPerson();
      await clearServerDatabase();
      database = resetDatabase();
      ui.outfitSelections = defaultOutfitSelections();
      ui.aiPlans = null;
      ui.aiStylistReport = null;
      ui.detailId = null;
      refreshStorageInfo();
      showToast("示例数据已恢复");
      break;
    case "delete-body-profile":
      database.bodyProfile = {
        height: null,
        weight: null,
        shoulderWidth: null,
        chest: null,
        waist: null,
        hips: null,
        thigh: null,
        calf: null,
        legLength: null,
        torsoLength: null,
        bodyType: "未设置",
        skinTone: "未设置",
        hairStyle: "未设置",
      };
      persist();
      showToast("身体档案已清空");
      break;
    case "save-api-key": {
      const input = root.querySelector("#api-key-input");
      const apiKey = input?.value.trim() || "";
      if (!apiKey) {
        showToast("请输入 API Key");
        break;
      }
      try {
        await setRuntimeApiKey(apiKey);
        if (input) input.value = "";
        await refreshApiConfig();
        showToast("AI 密钥已临时保存");
      } catch (error) {
        showToast("密钥保存失败");
      }
      break;
    }
    case "clear-api-key":
      try {
        await clearRuntimeApiKey();
        await refreshApiConfig();
        showToast("已清除网页临时密钥");
      } catch (error) {
        showToast("清除失败");
      }
      break;
    default:
      break;
  }
}

function handleClick(event) {
  if (handleNav(event)) return;
  if (handleScene(event)) return;
  if (handlePreferenceChip(event)) return;

  const category = event.target.closest("[data-category]");
  if (category) {
    ui.category = category.dataset.category;
    render();
    return;
  }

  const season = event.target.closest("[data-season]");
  if (season) {
    ui.season = season.dataset.season;
    render();
    return;
  }

  handleAction(event);
}

async function handleChange(event) {
  const target = event.target;

  if (target.matches("[data-capture-file]")) {
    const file = target.files?.[0];
    if (!file) return;
    resetCapture();
    ui.capture.fileName = file.name;
    ui.capture.previewUrl = URL.createObjectURL(file);
    ui.capture.imageDataUrl = await fileToDataUrl(file, {
      maxEdge: currentAiModeConfig().captureMaxEdge,
      quality: currentAiMode() === "fast" ? 0.84 : 0.9,
    });
    ui.capture.stepIndex = 2;
    render();
    return;
  }

  if (target.matches("[data-pending-garment]")) {
    const id = target.dataset.pendingGarment;
    const selected = new Set(ui.capture.selectedPendingGarmentIds || []);
    if (target.checked) {
      selected.add(id);
    } else {
      selected.delete(id);
    }
    ui.capture.selectedPendingGarmentIds = [...selected];
    render();
    return;
  }

  if (target.id === "tryon-person-file") {
    const file = target.files?.[0];
    if (!file) return;
    if (ui.tryOn.personPreviewUrl) {
      URL.revokeObjectURL(ui.tryOn.personPreviewUrl);
    }
    setTryOnState({
      personFileName: file.name,
      personPreviewUrl: URL.createObjectURL(file),
      personImageDataUrl: await fileToDataUrl(file, {
        maxEdge: currentAiModeConfig().personMaxEdge,
        quality: currentAiMode() === "fast" ? 0.84 : 0.9,
      }),
      imageDataUrl: "",
      error: "",
    });
    render();
    return;
  }

  if (target.matches("[data-layer]")) {
    ui.outfitSelections[target.dataset.layer] = target.value;
    render();
    return;
  }

  if (target.dataset.action === "change-status") {
    const garment = byId(database.garments, target.dataset.id);
    if (garment) {
      garment.status = target.value;
      persist();
      showToast("衣服状态已更新");
    }
  }
}

function handleInput(event) {
  const target = event.target;

  if (target.matches("[data-profile]")) {
    database.bodyProfile[target.dataset.profile] = Number(target.value);
    persist();
    render();
    return;
  }

  if (target.matches("[data-preference='formality']")) {
    database.preference.formality = Number(target.value);
    persist();
    render();
  }
}

function render() {
  const activePage = pages[ui.tab] ? pages[ui.tab]() : pages.home();
  const detailGarment = ui.detailId ? byId(database.garments, ui.detailId) : null;
  root.innerHTML = `
    <div class="phone">
      ${activePage}
      ${renderBottomNav(ui.tab)}
      ${renderDetailSheet(detailGarment)}
      ${renderToast(ui.toast)}
    </div>
  `;
}

root.addEventListener("click", handleClick);
root.addEventListener("change", handleChange);
root.addEventListener("input", handleInput);

refreshApiConfig();
refreshStorageInfo();

render();
hydrateDatabaseFromServer();
