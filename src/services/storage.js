export const STORAGE_KEY = "style-tap-web-mvp-v0.1";

const now = new Date().toISOString();

const seedGarments = [
  {
    id: "garment-ivory-knit",
    name: "象牙白短针织",
    category: "上衣",
    subcategory: "短上衣",
    seasons: ["春", "秋"],
    primaryColor: "象牙白",
    colorHex: "#f4eee5",
    pattern: "纯色",
    styles: ["简洁", "温柔"],
    occasions: ["上课", "通勤", "约会"],
    imagePath: "generated://ivory-knit",
    originalImagePath: null,
    isFavorite: true,
    wearCount: 6,
    lastWornDate: "2026-05-30",
    status: "可穿",
    notes: "适合搭高腰下装，视觉上更显比例。",
    createdAt: now,
    visual: { kind: "top", accent: "#8f1f3d" },
  },
  {
    id: "garment-wide-pants",
    name: "炭灰高腰阔腿裤",
    category: "下装",
    subcategory: "阔腿裤",
    seasons: ["春", "秋", "冬"],
    primaryColor: "炭灰",
    colorHex: "#34323a",
    pattern: "纯色",
    styles: ["通勤", "简洁"],
    occasions: ["通勤", "上课", "聚会"],
    imagePath: "generated://wide-pants",
    originalImagePath: null,
    isFavorite: true,
    wearCount: 9,
    lastWornDate: "2026-06-02",
    status: "可穿",
    notes: "裤腿垂感好，适合轻熟或极简搭配。",
    createdAt: now,
    visual: { kind: "pants", accent: "#eee8df" },
  },
  {
    id: "garment-lavender-shirt",
    name: "浅薰衣草衬衫",
    category: "上衣",
    subcategory: "衬衫",
    seasons: ["春", "夏"],
    primaryColor: "浅薰衣草紫",
    colorHex: "#cfc2ef",
    pattern: "纯色",
    styles: ["通勤", "温柔"],
    occasions: ["通勤", "约会"],
    imagePath: "generated://lavender-shirt",
    originalImagePath: null,
    isFavorite: false,
    wearCount: 4,
    lastWornDate: "2026-05-19",
    status: "可穿",
    notes: "可以外搭针织马甲或单穿。",
    createdAt: now,
    visual: { kind: "top", accent: "#7f6ab8" },
  },
  {
    id: "garment-berry-bag",
    name: "莓果红小方包",
    category: "包包",
    subcategory: "肩背包",
    seasons: ["春", "夏", "秋", "冬"],
    primaryColor: "莓果红",
    colorHex: "#b9264f",
    pattern: "纯色",
    styles: ["甜酷", "通勤"],
    occasions: ["约会", "聚会", "通勤"],
    imagePath: "generated://berry-bag",
    originalImagePath: null,
    isFavorite: true,
    wearCount: 11,
    lastWornDate: "2026-06-05",
    status: "可穿",
    notes: "适合给黑白灰搭配增加亮点。",
    createdAt: now,
    visual: { kind: "bag", accent: "#f4ccd7" },
  },
  {
    id: "garment-white-sneakers",
    name: "奶白低帮运动鞋",
    category: "鞋子",
    subcategory: "运动鞋",
    seasons: ["春", "夏", "秋"],
    primaryColor: "奶白",
    colorHex: "#f7f4ec",
    pattern: "拼色",
    styles: ["休闲", "运动"],
    occasions: ["上课", "旅行", "运动"],
    imagePath: "generated://white-sneakers",
    originalImagePath: null,
    isFavorite: false,
    wearCount: 14,
    lastWornDate: "2026-06-01",
    status: "可穿",
    notes: "舒适度高，适合走路多的场景。",
    createdAt: now,
    visual: { kind: "shoes", accent: "#aeb3b8" },
  },
  {
    id: "garment-black-coat",
    name: "曜石黑短外套",
    category: "外套",
    subcategory: "短夹克",
    seasons: ["秋", "冬"],
    primaryColor: "曜石黑",
    colorHex: "#151318",
    pattern: "纯色",
    styles: ["甜酷", "简洁"],
    occasions: ["聚会", "旅行", "通勤"],
    imagePath: "generated://black-coat",
    originalImagePath: null,
    isFavorite: false,
    wearCount: 3,
    lastWornDate: "2026-04-28",
    status: "收纳中",
    notes: "天气偏凉时再拿出来。",
    createdAt: now,
    visual: { kind: "outer", accent: "#ded5c8" },
  },
  {
    id: "garment-green-dress",
    name: "柔绿色直筒连衣裙",
    category: "连衣裙",
    subcategory: "直筒裙",
    seasons: ["春", "夏"],
    primaryColor: "柔和绿色",
    colorHex: "#8ebf9d",
    pattern: "纯色",
    styles: ["法式", "温柔"],
    occasions: ["约会", "聚会", "旅行"],
    imagePath: "generated://green-dress",
    originalImagePath: null,
    isFavorite: true,
    wearCount: 5,
    lastWornDate: "2026-05-22",
    status: "可穿",
    notes: "单穿就完整，适合低成本出门。",
    createdAt: now,
    visual: { kind: "dress", accent: "#f7f4ec" },
  },
  {
    id: "garment-silver-necklace",
    name: "细银项链",
    category: "配饰",
    subcategory: "项链",
    seasons: ["春", "夏", "秋", "冬"],
    primaryColor: "银色",
    colorHex: "#c9ced3",
    pattern: "金属",
    styles: ["简洁", "通勤"],
    occasions: ["通勤", "约会", "聚会"],
    imagePath: "generated://silver-necklace",
    originalImagePath: null,
    isFavorite: false,
    wearCount: 18,
    lastWornDate: "2026-06-03",
    status: "可穿",
    notes: "适合给基础款增加一点精致度。",
    createdAt: now,
    visual: { kind: "accessory", accent: "#8d99a5" },
  },
];

const CATEGORY_TAGS = {
  上衣: ["上装", "上半身重心"],
  下装: ["下装", "拉长腿部"],
  连衣裙: ["一件式", "纵向线条"],
  外套: ["层次", "轮廓感"],
  鞋子: ["鞋履", "风格落点"],
  包包: ["配件", "视觉焦点"],
  配饰: ["精致度", "细节提亮"],
};

const COLOR_TEMPERATURE = {
  白: "中性色",
  奶白: "暖色",
  象牙: "暖色",
  灰: "冷中性色",
  黑: "冷中性色",
  紫: "冷色",
  绿: "冷色",
  红: "暖色",
  银: "冷色",
};

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function colorTemperature(color = "") {
  const match = Object.entries(COLOR_TEMPERATURE).find(([keyword]) => color.includes(keyword));
  return match?.[1] || "中性色";
}

export function buildGarmentTags(garment) {
  const colorTemp = garment.colorTemperature || colorTemperature(`${garment.primaryColor || ""}${garment.colorHex || ""}`);
  return unique([
    ...(garment.aiTags || []),
    garment.category,
    garment.subcategory,
    garment.primaryColor,
    garment.pattern,
    colorTemp,
    garment.formality,
    garment.visualWeight,
    garment.silhouette,
    garment.proportionEffect,
    garment.sourceRegion,
    garment.bodyRegion,
    garment.layerRole,
    garment.visibleClues,
    ...(CATEGORY_TAGS[garment.category] || []),
    ...(garment.seasons || []).map((season) => `${season}季`),
    ...(garment.styles || []),
    ...(garment.occasions || []),
  ]);
}

function normalizeGarment(garment) {
  const normalized = {
    ...garment,
    aiTags: unique(garment.aiTags || []),
    colorTemperature: garment.colorTemperature || colorTemperature(garment.primaryColor),
    formality: garment.formality || (garment.styles?.includes("通勤") ? "中等正式" : "日常休闲"),
    visualWeight: garment.visualWeight || (["外套", "下装"].includes(garment.category) ? "中高" : "中等"),
    proportionEffect: garment.proportionEffect || "",
    silhouette: garment.silhouette || garment.subcategory || "",
  };
  normalized.aiTags = buildGarmentTags(normalized);
  return normalized;
}

const seedDatabase = {
  garments: seedGarments,
  outfits: [
    {
      id: "outfit-easy-commute",
      name: "轻松通勤",
      garmentIDs: [
        "garment-ivory-knit",
        "garment-wide-pants",
        "garment-berry-bag",
        "garment-white-sneakers",
      ],
      occasion: "通勤",
      seasons: ["春", "秋"],
      isFavorite: true,
      previewImagePath: "./src/assets/outfit-recommendation.png",
      wornDate: null,
      createdAt: now,
    },
  ],
  bodyProfile: {
    height: 168,
    weight: null,
    shoulderWidth: 42,
    chest: null,
    waist: 68,
    hips: 92,
    thigh: null,
    calf: null,
    legLength: 94,
    torsoLength: 52,
    bodyType: "标准",
    skinTone: "自然",
    hairStyle: "中长发",
  },
  preference: {
    likedColors: ["莓果红", "奶白", "浅薰衣草紫"],
    dislikedColors: ["荧光色"],
    occasions: ["上课", "通勤", "约会"],
    styles: ["简洁", "通勤", "温柔"],
    formality: 45,
    aiMode: "fast",
    feedback: [],
  },
};

function mergeDatabase(parsed) {
  const seed = structuredClone(seedDatabase);
  return {
    ...seed,
    ...parsed,
    garments: (parsed.garments || seed.garments).map(normalizeGarment),
    bodyProfile: {
      ...seed.bodyProfile,
      ...(parsed.bodyProfile || {}),
    },
    preference: {
      ...seed.preference,
      ...(parsed.preference || {}),
    },
  };
}

function normalizedSeedDatabase() {
  return mergeDatabase(seedDatabase);
}

export function loadDatabase() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = normalizedSeedDatabase();
      saveDatabase(seed);
      return seed;
    }
    return mergeDatabase(JSON.parse(raw));
  } catch (error) {
    console.warn("Failed to load local database", error);
    return normalizedSeedDatabase();
  }
}

export function saveDatabase(database) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  } catch (error) {
    console.warn("Failed to save local database", error);
  }
}

export function resetDatabase() {
  window.localStorage.removeItem(STORAGE_KEY);
  return normalizedSeedDatabase();
}

export async function loadDatabaseFromServer() {
  try {
    const response = await fetch("/api/database", { cache: "no-store" });
    const payload = await response.json();
    if (!payload.ok || !payload.database) return null;
    return mergeDatabase(payload.database);
  } catch (error) {
    console.warn("Failed to load server database", error);
    return null;
  }
}

export async function saveDatabaseToServer(database) {
  const response = await fetch("/api/database", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ database }),
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || "Failed to save server database.");
  }
  return payload;
}

export async function clearServerDatabase() {
  try {
    const response = await fetch("/api/database", { method: "DELETE" });
    return await response.json();
  } catch (error) {
    console.warn("Failed to clear server database", error);
    return null;
  }
}

function byteSize(value) {
  return new Blob([String(value || "")]).size;
}

function approximateDataUrlBytes(value) {
  if (!value?.startsWith?.("data:image/")) return 0;
  const encoded = value.split(",", 2)[1] || "";
  return Math.round((encoded.length * 3) / 4);
}

export function getWardrobeStorageInfo(database, estimate = null) {
  const raw = JSON.stringify(database);
  const imageGarments = database.garments.filter((garment) => garment.imagePath?.startsWith("data:image/"));
  const placeholderGarments = database.garments.filter((garment) => garment.imagePath?.startsWith("generated://"));
  const remoteGarments = database.garments.filter((garment) => garment.imagePath?.startsWith("http"));
  const inlineImageBytes = imageGarments.reduce((sum, garment) => sum + approximateDataUrlBytes(garment.imagePath), 0);
  const localDatabaseBytes = byteSize(raw);
  const quota = Number(estimate?.quota || 0);
  const usage = Number(estimate?.usage || 0);
  const remaining = quota ? Math.max(quota - usage, 0) : null;

  return {
    storageKey: STORAGE_KEY,
    storageLocation: "browser localStorage + data/wardrobe.json",
    serverStorageLocation: "data/wardrobe.json",
    garmentCount: database.garments.length,
    inlineImageCount: imageGarments.length,
    placeholderImageCount: placeholderGarments.length,
    remoteImageCount: remoteGarments.length,
    localDatabaseBytes,
    inlineImageBytes,
    browserUsageBytes: usage || null,
    browserQuotaBytes: quota || null,
    browserRemainingBytes: remaining,
    hasEnoughSpace: remaining == null ? true : remaining > Math.max(localDatabaseBytes * 2, 20 * 1024 * 1024),
  };
}

function normalizeArray(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

function visualKindForCategory(category) {
  return {
    上衣: "top",
    下装: "pants",
    连衣裙: "dress",
    外套: "outer",
    鞋子: "shoes",
    包包: "bag",
    配饰: "accessory",
  }[category] || "top";
}

export function createGarmentFromCapture(fileName, aiMetadata = {}, imagePath = "generated://captured-flat-lay") {
  const id = `garment-${crypto.randomUUID()}`;
  return normalizeGarment({
    id,
    name: aiMetadata.name || (fileName ? `新识别单品 ${fileName.replace(/\.[^/.]+$/, "").slice(0, 8)}` : "新识别单品"),
    category: aiMetadata.category || "上衣",
    subcategory: aiMetadata.subcategory || "短上衣",
    seasons: normalizeArray(aiMetadata.seasons, ["春", "夏"]),
    primaryColor: aiMetadata.primaryColor || "奶白",
    colorHex: aiMetadata.colorHex || "#f4eee5",
    pattern: aiMetadata.pattern || "纯色",
    styles: normalizeArray(aiMetadata.styles, ["简洁", "休闲"]),
    occasions: normalizeArray(aiMetadata.occasions, ["上课", "通勤"]),
    aiTags: normalizeArray(aiMetadata.aiTags, []),
    colorTemperature: aiMetadata.colorTemperature || "",
    formality: aiMetadata.formality || "",
    visualWeight: aiMetadata.visualWeight || "",
    proportionEffect: aiMetadata.proportionEffect || "",
    silhouette: aiMetadata.silhouette || aiMetadata.subcategory || "",
    sourceRegion: aiMetadata.sourceRegion || "",
    bodyRegion: aiMetadata.bodyRegion || "",
    layerRole: aiMetadata.layerRole || "",
    visibleClues: aiMetadata.visibleClues || "",
    confidence: Number(aiMetadata.confidence || 0),
    imageStatus: aiMetadata.imageStatus || "",
    imageError: aiMetadata.imageError || "",
    imagePath,
    originalImagePath: fileName || null,
    isFavorite: false,
    wearCount: 0,
    lastWornDate: null,
    status: "可穿",
    notes: aiMetadata.notes || "由拍照识衣流程生成，可在详情里继续修改属性。",
    createdAt: new Date().toISOString(),
    visual: { kind: visualKindForCategory(aiMetadata.category || "上衣"), accent: "#b9264f" },
  });
}
