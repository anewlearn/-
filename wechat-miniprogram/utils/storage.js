const { OUTFIT_LAYERS } = require("./constants");

const STORAGE_KEY = "styletap_miniprogram_database_v0_1";
const OUTFIT_DRAFT_KEY = "styletap_miniprogram_outfit_draft";

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function asArray(value, fallback = []) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function unique(values) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function visualKind(category) {
  return {
    上衣: "top",
    下装: "pants",
    连衣裙: "dress",
    外套: "outer",
    鞋子: "shoes",
    包包: "bag",
    配饰: "accessory"
  }[category] || "top";
}

function makeGarment(overrides) {
  const category = overrides.category || "上衣";
  const garment = {
    id: overrides.id || uid("garment"),
    name: overrides.name || "新识别单品",
    category,
    subcategory: overrides.subcategory || category,
    seasons: asArray(overrides.seasons, ["春", "夏"]),
    primaryColor: overrides.primaryColor || "奶白",
    colorHex: overrides.colorHex || "#f4eee5",
    pattern: overrides.pattern || "纯色",
    styles: asArray(overrides.styles, ["简洁", "休闲"]),
    occasions: asArray(overrides.occasions, ["上课", "通勤"]),
    aiTags: unique(overrides.aiTags || []),
    colorTemperature: overrides.colorTemperature || "中性色",
    formality: overrides.formality || "休闲",
    visualWeight: overrides.visualWeight || "中等",
    silhouette: overrides.silhouette || overrides.subcategory || category,
    proportionEffect: overrides.proportionEffect || "",
    sourceRegion: overrides.sourceRegion || "",
    notes: overrides.notes || "",
    imagePath: overrides.imagePath || "",
    originalImagePath: overrides.originalImagePath || "",
    isFavorite: Boolean(overrides.isFavorite),
    wearCount: Number(overrides.wearCount || 0),
    lastWornDate: overrides.lastWornDate || "",
    status: overrides.status || "可穿",
    createdAt: overrides.createdAt || nowIso(),
    visual: overrides.visual || { kind: visualKind(category), accent: overrides.colorHex || "#c02655" }
  };
  garment.aiTags = unique([
    ...garment.aiTags,
    garment.category,
    garment.subcategory,
    garment.primaryColor,
    garment.pattern,
    garment.colorTemperature,
    garment.formality,
    garment.visualWeight,
    garment.silhouette,
    ...garment.seasons.map((season) => `${season}季`),
    ...garment.styles,
    ...garment.occasions
  ]);
  return garment;
}

function seedDatabase() {
  const createdAt = nowIso();
  const garments = [
    makeGarment({
      id: "garment-white-tee",
      name: "白色修身短袖T恤",
      category: "上衣",
      subcategory: "短袖T恤",
      seasons: ["春", "夏"],
      primaryColor: "白色",
      colorHex: "#f6f1ea",
      styles: ["简洁", "休闲"],
      occasions: ["上课", "通勤"],
      isFavorite: true,
      wearCount: 5,
      notes: "适合搭高腰下装，干净利落。",
      createdAt
    }),
    makeGarment({
      id: "garment-gray-pants",
      name: "炭灰高腰阔腿裤",
      category: "下装",
      subcategory: "阔腿裤",
      seasons: ["春", "秋", "冬"],
      primaryColor: "炭灰",
      colorHex: "#3d3a40",
      styles: ["通勤", "简洁"],
      occasions: ["通勤", "上课"],
      isFavorite: true,
      wearCount: 9,
      proportionEffect: "提高腰线，拉长腿部。",
      createdAt
    }),
    makeGarment({
      id: "garment-silver-heels",
      name: "银黑机甲高筒靴",
      category: "鞋子",
      subcategory: "高筒靴",
      seasons: ["秋", "冬"],
      primaryColor: "银黑",
      colorHex: "#b7bcc2",
      styles: ["甜酷", "通勤"],
      occasions: ["聚会", "通勤"],
      wearCount: 2,
      visualWeight: "重",
      createdAt
    }),
    makeGarment({
      id: "garment-berry-bag",
      name: "米色单肩包",
      category: "包包",
      subcategory: "单肩包",
      seasons: ["春", "夏", "秋", "冬"],
      primaryColor: "米色",
      colorHex: "#ead9c5",
      styles: ["温柔", "通勤"],
      occasions: ["约会", "通勤"],
      isFavorite: true,
      createdAt
    })
  ];

  return {
    garments,
    outfits: [],
    bodyProfile: {
      height: 168,
      shoulderWidth: 42,
      waist: 68,
      hips: 92,
      legLength: 94,
      bodyType: "标准"
    },
    preference: {
      styles: ["简洁", "通勤", "温柔"],
      occasions: ["上课", "通勤", "约会"],
      aiMode: "fast"
    },
    createdAt,
    updatedAt: createdAt
  };
}

function normalizeDatabase(database) {
  const seed = seedDatabase();
  const merged = {
    ...seed,
    ...(database || {}),
    bodyProfile: { ...seed.bodyProfile, ...(database?.bodyProfile || {}) },
    preference: { ...seed.preference, ...(database?.preference || {}) }
  };
  merged.garments = asArray(database?.garments, seed.garments).map(makeGarment);
  merged.outfits = asArray(database?.outfits, []);
  return merged;
}

function loadDatabase() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw) {
      const seed = seedDatabase();
      saveDatabase(seed);
      return seed;
    }
    return normalizeDatabase(JSON.parse(raw));
  } catch (error) {
    console.warn("load database failed", error);
    return seedDatabase();
  }
}

function saveDatabase(database) {
  const next = { ...database, updatedAt: nowIso() };
  wx.setStorageSync(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function resetDatabase() {
  wx.removeStorageSync(STORAGE_KEY);
  const seed = seedDatabase();
  saveDatabase(seed);
  return seed;
}

function saveOutfitDraft(draft) {
  wx.setStorageSync(OUTFIT_DRAFT_KEY, draft || {});
}

function loadOutfitDraft() {
  return wx.getStorageSync(OUTFIT_DRAFT_KEY) || {};
}

function defaultOutfitSelections(database) {
  const garments = database.garments || [];
  const pick = (category) => garments.find((item) => item.category === category && item.status === "可穿")?.id || "";
  return {
    outer: pick("外套"),
    top: pick("上衣"),
    bottom: pick("下装") || pick("连衣裙"),
    shoes: pick("鞋子"),
    bag: pick("包包"),
    accessory: pick("配饰")
  };
}

function outfitLayerForGarment(garment) {
  const layer = OUTFIT_LAYERS.find((item) => item.accepts.includes(garment.category));
  return layer?.key || "top";
}

function saveLocalFile(tempFilePath) {
  return new Promise((resolve) => {
    if (!tempFilePath) {
      resolve("");
      return;
    }
    wx.saveFile({
      tempFilePath,
      success: (result) => resolve(result.savedFilePath || tempFilePath),
      fail: () => resolve(tempFilePath)
    });
  });
}

module.exports = {
  STORAGE_KEY,
  uid,
  makeGarment,
  loadDatabase,
  saveDatabase,
  resetDatabase,
  saveLocalFile,
  saveOutfitDraft,
  loadOutfitDraft,
  defaultOutfitSelections,
  outfitLayerForGarment
};
