async function requestJson(path, payload = null) {
  const options = payload
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    : {};

  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `API request failed: ${response.status}`);
  }
  return data;
}

const IMAGE_REQUEST_CACHE_DB = "style-tap-ai-image-request-cache";
const IMAGE_REQUEST_CACHE_VERSION = 1;
const IMAGE_REQUEST_CACHE_STORE = "image-results";
const IMAGE_REQUEST_CACHE_PREFIX = "ai-image-request:";
const pendingImageRequests = new Map();

function simpleHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function digestString(value) {
  if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return simpleHash(value);
}

function imageRequestCacheAvailable() {
  return typeof window !== "undefined" && Boolean(window.indexedDB);
}

function openImageRequestCache() {
  if (!imageRequestCacheAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available."));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IMAGE_REQUEST_CACHE_DB, IMAGE_REQUEST_CACHE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IMAGE_REQUEST_CACHE_STORE)) {
        database.createObjectStore(IMAGE_REQUEST_CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open image request cache."));
  });
}

async function readImageRequestCache(key) {
  const database = await openImageRequestCache();
  const record = await new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_REQUEST_CACHE_STORE, "readonly");
    const store = transaction.objectStore(IMAGE_REQUEST_CACHE_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Failed to read image request cache."));
  });
  database.close();
  return record?.imageDataUrl ? record : null;
}

async function writeImageRequestCache(key, imageDataUrl, metadata = {}) {
  const database = await openImageRequestCache();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(IMAGE_REQUEST_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(IMAGE_REQUEST_CACHE_STORE);
    store.put({
      key,
      imageDataUrl,
      metadata,
      createdAt: new Date().toISOString(),
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Failed to write image request cache."));
  });
  database.close();
}

async function imageRequestCacheKey(kind, payload, metadata = {}) {
  const signature = JSON.stringify({
    version: 2,
    kind,
    payload,
    metadata,
  });
  return `${IMAGE_REQUEST_CACHE_PREFIX}${await digestString(signature)}`;
}

async function requestImageWithCache(kind, payload, metadata = {}) {
  const cacheKey = await imageRequestCacheKey(kind, payload, metadata);

  try {
    const cached = await readImageRequestCache(cacheKey);
    if (cached?.imageDataUrl) {
      return {
        ok: true,
        imageDataUrl: cached.imageDataUrl,
        cached: true,
      };
    }
  } catch (error) {
    console.warn("Failed to read AI image cache", error);
  }

  if (pendingImageRequests.has(cacheKey)) {
    return pendingImageRequests.get(cacheKey);
  }

  const request = requestJson("/api/image", payload)
    .then(async (data) => {
      if (data.imageDataUrl) {
        try {
          await writeImageRequestCache(cacheKey, data.imageDataUrl, metadata);
        } catch (error) {
          console.warn("Failed to write AI image cache", error);
        }
      }
      return {
        ...data,
        cached: false,
      };
    })
    .finally(() => {
      pendingImageRequests.delete(cacheKey);
    });

  pendingImageRequests.set(cacheKey, request);
  return request;
}

const AI_MODE_CONFIG = {
  fast: {
    label: "快速",
    reasoningEffort: "low",
    captureMaxEdge: 1280,
    personMaxEdge: 1152,
    flatImageSize: "1024x1024",
    tryOnSize: "768x1152",
    maxTryOnReferences: 4,
    maxRecommendationGarments: 12,
    maxOutfitItems: 5,
    outfitImageConcurrency: 2,
    outfitRecognitionEffort: "medium",
    imageQuality: "low",
  },
  normal: {
    label: "正常",
    reasoningEffort: "medium",
    captureMaxEdge: 1700,
    personMaxEdge: 1536,
    flatImageSize: "1024x1024",
    tryOnSize: "1024x1536",
    maxTryOnReferences: 8,
    maxRecommendationGarments: 18,
    maxOutfitItems: 6,
    outfitImageConcurrency: 2,
    outfitRecognitionEffort: "xhigh",
    imageQuality: "",
  },
};

export function getAiModeConfig(mode = "fast") {
  return AI_MODE_CONFIG[mode] || AI_MODE_CONFIG.fast;
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : trimmed;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI response did not include JSON.");
  }
  return JSON.parse(source.slice(start, end + 1));
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeOutfitRecognitionItems(items, maxItems) {
  const categoryPriority = ["外套", "上衣", "下装", "连衣裙", "鞋子", "包包", "配饰"];
  const normalized = items
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const aiTags = uniqueStrings([
        ...asList(item.aiTags),
        item.category,
        item.subcategory,
        item.primaryColor,
        item.pattern,
        item.colorTemperature,
        item.formality,
        item.visualWeight,
        item.silhouette,
        item.proportionEffect,
        item.sourceRegion,
        item.bodyRegion,
        item.layerRole,
        ...asList(item.seasons).map((season) => `${season}季`),
        ...asList(item.styles),
        ...asList(item.occasions),
      ]);
      return {
        ...item,
        detectionIndex: index + 1,
        confidence: Number(item.confidence || 0.6),
        aiTags,
        sourceRegion: item.sourceRegion || item.bodyRegion || "",
        visibleClues: item.visibleClues || "",
        layerRole: item.layerRole || item.category || "",
        notes:
          item.notes ||
          `${item.sourceRegion || "整套照片"}识别出的${item.category || "服装单品"}，已补充颜色、风格和搭配标签。`,
      };
    })
    .filter((item) => item.category && item.name);

  const priority = (item) => {
    const index = categoryPriority.indexOf(item.category);
    return index === -1 ? 99 : index;
  };

  return normalized
    .sort((a, b) => priority(a) - priority(b) || Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, maxItems);
}

export async function getApiConfig() {
  try {
    return await requestJson("/api/config");
  } catch (error) {
    return {
      ok: false,
      hasApiKey: false,
      error: error.message,
    };
  }
}

export async function setRuntimeApiKey(apiKey, provider = "openai") {
  return requestJson("/api/key", { apiKey, provider });
}

export async function clearRuntimeApiKey() {
  const response = await fetch("/api/key", { method: "DELETE" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `API request failed: ${response.status}`);
  }
  return data;
}

export async function recognizeGarmentFromImage(imageDataUrl, fileName, options = {}) {
  const mode = getAiModeConfig(options.aiMode);
  const prompt = `
识别这张照片中最适合加入电子衣橱的一件服装单品。优先选择画面中面积最大、最完整、最清晰的一件真实衣物；如果有多人或多件衣服，只选一件，不要把整套穿搭合并成一个单品。
只返回 JSON，不要 Markdown。
字段：
{
  "name": "简短中文名称",
  "category": "上衣|下装|连衣裙|外套|鞋子|包包|配饰",
  "subcategory": "子类别",
  "seasons": ["春","夏","秋","冬"],
  "primaryColor": "主颜色",
  "colorHex": "#RRGGBB",
  "pattern": "图案",
  "styles": ["简洁","休闲","通勤","甜酷","法式","运动","温柔"],
  "occasions": ["上课","通勤","约会","聚会","旅行","运动"],
  "notes": "一句穿搭建议",
  "aiTags": ["用于筛选推荐的标签，例如：短上衣","暖白","通勤","轻熟","显腿长"],
  "colorTemperature": "冷色|暖色|中性色|冷中性色",
  "formality": "休闲|中等正式|正式",
  "visualWeight": "轻|中等|中高|重",
  "silhouette": "版型轮廓，例如：短款修身、直筒、阔腿、宽松",
  "proportionEffect": "身材修饰效果，例如：提高腰线、拉长腿部、增加肩线",
  "confidence": 0.0
}
文件名：${fileName || "未命名图片"}
`;

  const data = await requestJson("/api/text", {
    system: "你是搭一下 App 的衣物识别助手。输出必须是严格 JSON。",
    prompt,
    imageDataUrl,
    reasoningEffort: mode.reasoningEffort,
  });
  return extractJson(data.text || "");
}

export async function recognizeOutfitItemsFromImage(imageDataUrl, fileName, options = {}) {
  const mode = getAiModeConfig(options.aiMode);
  const prompt = `
识别这张全身照或穿搭照片中的多件可加入电子衣橱的单品。你不是只看上半身的识别助手，而是电子衣橱的多单品拆解器。

请按区域逐一检查：头肩和颈部配饰、外套层、上半身、腰臀区域、腿部、脚部、手持/肩背包、其他配饰。
如果画面中腿部或脚部可见，必须判断是否存在下装和鞋子；即使置信度较低，也要在可判断时输出对应单品并给出 confidence，不要只返回上衣。
如果连衣裙覆盖上下身，请返回“连衣裙”，不要再虚构下装；如果有外套叠穿，也要同时返回外套和内搭。

规则：
1. 只返回 JSON，不要 Markdown。
2. 最多返回 ${mode.maxOutfitItems} 件，优先返回完整、清晰、可单独入库的真实单品。
3. 必须为每件单品补齐推荐可用标签：类别、颜色冷暖、风格、正式程度、视觉重心、版型轮廓、身材修饰效果、适合场景。
4. 对于下装、鞋子、包包、配饰，不要因为面积小就忽略；只要能判断类别和主要颜色就可以输出。
5. 被遮挡严重、只有极小边缘露出、无法判断类别的区域写入 skipped。
6. sourceRegion 要写清楚在原图中的位置，例如“上半身内搭”“腿部下装”“脚部鞋子”“右肩包包”，后续会用它来生成单品图。

格式：
{
  "items": [
    {
      "name": "简短中文名称",
      "category": "上衣|下装|连衣裙|外套|鞋子|包包|配饰",
      "subcategory": "子类别",
      "sourceRegion": "原图位置和层次",
      "bodyRegion": "头肩|上半身|腰臀|腿部|脚部|手持物|配饰",
      "layerRole": "外层|内搭|下装|一件式|鞋履|包袋|点缀",
      "visibleClues": "用于判断这件单品的可见线索",
      "seasons": ["春","夏","秋","冬"],
      "primaryColor": "主颜色",
      "colorHex": "#RRGGBB",
      "pattern": "图案",
      "styles": ["简洁","休闲","通勤","甜酷","法式","运动","温柔"],
      "occasions": ["上课","通勤","约会","聚会","旅行","运动"],
      "notes": "一句穿搭建议",
      "aiTags": ["用于筛选推荐的标签，例如：高腰","阔腿","运动鞋","显腿长","冷色","轻正式"],
      "colorTemperature": "冷色|暖色|中性色|冷中性色",
      "formality": "休闲|中等正式|正式",
      "visualWeight": "轻|中等|中高|重",
      "silhouette": "版型轮廓",
      "proportionEffect": "身材修饰效果",
      "confidence": 0.0
    }
  ],
  "skipped": [
    {
      "area": "画面位置",
      "reason": "未识别原因"
    }
  ]
}
文件名：${fileName || "未命名图片"}
`;

  const data = await requestJson("/api/text", {
    system: "你是“搭一下”App 的整套穿搭识别助手。输出必须是严格 JSON。必须按全身区域扫描，不要只识别上身。",
    prompt,
    imageDataUrl,
    reasoningEffort: mode.outfitRecognitionEffort || mode.reasoningEffort,
  });
  const parsed = extractJson(data.text || "");
  if (!Array.isArray(parsed.items)) {
    throw new Error("AI response did not include outfit items.");
  }
  return {
    items: normalizeOutfitRecognitionItems(parsed.items, mode.maxOutfitItems || 6),
    skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
  };
}

export async function generateGarmentFlatImage(garment, sourceImageDataUrl = "", options = {}) {
  const mode = getAiModeConfig(options.aiMode);
  const tags = asList(garment.aiTags).slice(0, 10).join("、") || "无";
  const sourceHint = [garment.sourceRegion, garment.bodyRegion, garment.layerRole, garment.visibleClues]
    .filter(Boolean)
    .join("；");
  const prompt = `
参考上传照片，为电子衣橱生成一张单品展示图。
主体：${garment.name}，类别：${garment.category}/${garment.subcategory}，主颜色：${garment.primaryColor}。
定位线索：${sourceHint || "根据主体类别、颜色和版型，从原图中锁定这一件单品"}。
推荐标签：${tags}。
要求：
1. 上传图可能是一张全身穿搭照，里面有多件衣服；只提取“主体”这一件，不能把整套穿搭合成一张图。
2. 尽量保留参考照片中这件衣物的颜色、廓形、领口、袖长、裤型、材质和图案，不要重新发明一件衣服。
3. 只保留单件衣物，移除人物、头发、手臂、背景和其他物品；遮挡区域可以做自然补全。
4. 单件衣物正面展示，完整可见，居中，暖白或透明感背景，轻微自然阴影。
5. 不要文字、不要 logo、不要人物、不要模特、不要水印。
`;

  const payload = {
    prompt,
    imageDataUrl: sourceImageDataUrl,
    size: mode.flatImageSize,
    quality: mode.imageQuality,
    action: sourceImageDataUrl ? "edit" : "generate",
    reasoningEffort: mode.reasoningEffort,
  };
  const data = await requestImageWithCache("garment-flat", payload, {
    aiMode: options.aiMode || "fast",
    garmentName: garment.name || "",
    category: garment.category || "",
    subcategory: garment.subcategory || "",
    primaryColor: garment.primaryColor || "",
  });
  return data.imageDataUrl;
}

function asList(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function garmentTagSet(garment) {
  return new Set(
    [
      garment.category,
      garment.subcategory,
      garment.primaryColor,
      garment.pattern,
      garment.colorTemperature,
      garment.formality,
      garment.visualWeight,
      garment.silhouette,
      garment.proportionEffect,
      ...asList(garment.seasons).map((season) => `${season}季`),
      ...asList(garment.styles),
      ...asList(garment.occasions),
      ...asList(garment.aiTags),
    ]
      .map((tag) => String(tag || "").trim())
      .filter(Boolean),
  );
}

function scoreGarmentForRecommendation(garment, { scene, preference }) {
  if (garment.status === "清洗中") return -999;
  const tags = garmentTagSet(garment);
  let score = 0;
  if (garment.status === "可穿") score += 8;
  if (asList(garment.occasions).includes(scene) || tags.has(scene)) score += 32;
  if (asList(garment.styles).some((style) => asList(preference?.styles).includes(style))) score += 16;
  if (asList(garment.seasons).some((season) => ["春", "夏", "秋", "冬"].includes(season))) score += 4;
  if (garment.isFavorite) score += 6;
  if ((garment.wearCount || 0) < 3) score += 3;
  if (garment.status === "收纳中" || garment.status === "已闲置") score -= 8;
  if (tags.has("通勤") && scene === "通勤") score += 12;
  if (tags.has("运动") && ["通勤", "约会"].includes(scene)) score -= 6;
  if (tags.has("正式") && ["运动", "旅行"].includes(scene)) score -= 8;
  return score;
}

function selectRecommendationCandidates(garments, { scene, preference, aiMode }) {
  const mode = getAiModeConfig(aiMode);
  const usable = garments
    .map((garment) => ({
      ...garment,
      recommendationScore: scoreGarmentForRecommendation(garment, { scene, preference }),
    }))
    .filter((garment) => garment.status !== "清洗中");

  const ranked = [...usable].sort((a, b) => b.recommendationScore - a.recommendationScore);
  const categoryPriority = ["外套", "上衣", "下装", "连衣裙", "鞋子", "包包", "配饰"];
  const selected = [];
  for (const category of categoryPriority) {
    const item = ranked.find((garment) => garment.category === category && !selected.some((picked) => picked.id === garment.id));
    if (item) selected.push(item);
  }
  for (const garment of ranked) {
    if (selected.length >= mode.maxRecommendationGarments) break;
    if (!selected.some((picked) => picked.id === garment.id) && garment.recommendationScore >= 0) {
      selected.push(garment);
    }
  }
  if (selected.length < Math.min(6, ranked.length)) {
    for (const garment of ranked) {
      if (selected.length >= Math.min(mode.maxRecommendationGarments, ranked.length)) break;
      if (!selected.some((picked) => picked.id === garment.id)) selected.push(garment);
    }
  }

  const selectedIds = new Set(selected.map((garment) => garment.id));
  const filteredOut = garments
    .filter((garment) => !selectedIds.has(garment.id))
    .map((garment) => ({
      id: garment.id,
      name: garment.name,
      status: garment.status,
      reason:
        garment.status === "清洗中"
          ? "清洗中，不进入最终搭配"
          : "标签与当前场景或偏好匹配度较低，未进入本轮 AI 分析候选",
    }));

  return {
    allGarmentCount: garments.length,
    usableGarmentCount: usable.length,
    candidateGarments: selected,
    filteredOut,
    maxRecommendationGarments: mode.maxRecommendationGarments,
  };
}

function imageReferencesForTryOn(garments, personImageDataUrl, maxReferences) {
  const garmentImages = garments
    .map((garment) => garment.imagePath)
    .filter((imagePath) => imagePath?.startsWith("data:image/") || imagePath?.startsWith("http"));
  return [personImageDataUrl, ...garmentImages].filter(Boolean).slice(0, maxReferences);
}

export async function generateOutfitTryOnImage({ garments, scene, bodyProfile, personImageDataUrl = "", aiMode = "fast" }) {
  const mode = getAiModeConfig(aiMode);
  const hasPersonReference = Boolean(personImageDataUrl);
  const prompt = `
为“搭一下”电子衣橱生成一张 AI 穿搭试穿效果图。
场景：${scene || "日常出门"}
身体档案：身高 ${bodyProfile?.height || "未设置"}cm，基础体型 ${bodyProfile?.bodyType || "标准"}。
穿搭单品：${garments
    .map((garment) => `${garment.name}（${garment.category}，${garment.primaryColor}，${garment.styles?.join("、") || "基础风格"}）`)
    .join("；")}

画面要求：
1. ${hasPersonReference ? "以第一张参考图中的人物为主体，尽量保持人物身份、脸部、发型、肤色、身材比例、姿势和背景氛围。" : "生成单人正面或微侧站姿，全身穿搭效果。"}
2. 将上述衣物自然换到人物身上，体现单品的颜色、类别、廓形和整体搭配关系；如果附带了衣物参考图，优先参考衣物图。
3. 暖白简洁背景，像移动 App 内的试穿结果图。
4. 不要文字、不要 logo、不要水印、不要多人物、不要夸张姿势。
5. 这是穿搭参考图，不要求还原真实版型细节。
`;

  const referenceImages = imageReferencesForTryOn(garments, personImageDataUrl, mode.maxTryOnReferences);
  const payload = {
    prompt,
    imageDataUrls: referenceImages,
    size: mode.tryOnSize,
    quality: mode.imageQuality,
    action: referenceImages.length ? "edit" : "generate",
    reasoningEffort: mode.reasoningEffort,
  };
  const data = await requestImageWithCache("outfit-try-on", payload, {
    aiMode,
    scene: scene || "",
    garmentIds: garments.map((garment) => garment.id || garment.name || ""),
    hasPersonReference,
  });
  return data.imageDataUrl;
}

export async function generateOutfitPlansWithAI({ garments, scene, preference, bodyProfile, aiMode = "fast" }) {
  const mode = getAiModeConfig(aiMode);
  const prefilter = selectRecommendationCandidates(garments, { scene, preference, aiMode });
  const candidateGarments = prefilter.candidateGarments;
  const prompt = `
你不是普通穿搭助手，而是一位审美很强的高级造型师。
请用专业眼光分析用户衣服库，不只是简单把衣服组合起来，而是判断每件衣服的风格属性、颜色冷暖、正式程度、视觉重心、身材修饰效果。

根据用户衣橱生成 3 套完整穿搭推荐。
场景：${scene}
用户偏好：${JSON.stringify(preference)}
身体档案：${JSON.stringify(bodyProfile || {})}
当前模式：${mode.label}模式。${aiMode === "fast" ? "请结论更短，但仍保持专业判断。" : "请分析更完整，风险和细节更明确。"}
衣橱总单品数：${garments.length}
本地标签预筛选说明：系统已先根据类别、季节、场合、风格、AI 标签、状态和用户偏好做初步筛选，只把最合适的候选单品文本传给你分析，避免一次上传太多图片或无关数据造成响应变慢。本请求不上传衣物图片，只上传标签和属性文本。
可分析候选单品数：${candidateGarments.length}
候选上限：${prefilter.maxRecommendationGarments}
已排除或未进入候选：${JSON.stringify(prefilter.filteredOut)}
可分析的候选衣物：${JSON.stringify(
    candidateGarments.map((garment) => ({
      id: garment.id,
      name: garment.name,
      category: garment.category,
      subcategory: garment.subcategory,
      seasons: garment.seasons,
      primaryColor: garment.primaryColor,
      colorHex: garment.colorHex,
      colorTemperature: garment.colorTemperature,
      pattern: garment.pattern,
      styles: garment.styles,
      occasions: garment.occasions,
      aiTags: garment.aiTags,
      formality: garment.formality,
      visualWeight: garment.visualWeight,
      silhouette: garment.silhouette,
      proportionEffect: garment.proportionEffect,
      status: garment.status,
      wearCount: garment.wearCount,
      lastWornDate: garment.lastWornDate,
      notes: garment.notes,
      recommendationScore: garment.recommendationScore,
    })),
  )}

只返回 JSON，不要 Markdown。
推荐逻辑必须按以下顺序思考并体现在字段中：
1. 先判断衣服库整体风格倾向；
2. 再根据目标风格筛选最匹配的单品；
3. 排除不适合的单品；
4. 给出 3 套完整搭配；
5. 每套搭配说明风格关键词、颜色逻辑、版型比例、适合场景、加分细节、可能风险；
6. 最后给出最推荐的一套。

格式：
{
  "overallStyle": "衣服库整体风格倾向，1-2 句",
  "targetStyle": "本次场景下建议靠近的目标风格",
  "selectedGarmentIDs": ["用于重点分析的单品 id"],
  "excluded": [
    {
      "id": "被排除单品 id",
      "name": "单品名",
      "reason": "排除原因"
    }
  ],
  "plans": [
    {
      "id": "safe",
      "name": "稳妥搭配",
      "garmentIDs": ["..."],
      "styleKeywords": ["关键词"],
      "colorLogic": "颜色冷暖、明暗和主次逻辑",
      "proportionLogic": "版型比例和身材修饰逻辑",
      "sceneFit": "适合场景",
      "detailBoost": "加分细节",
      "risk": "可能的风险",
      "reason": "一句总评",
      "score": 0
    },
    {
      "id": "styled",
      "name": "更有风格",
      "garmentIDs": ["..."],
      "styleKeywords": ["关键词"],
      "colorLogic": "颜色逻辑",
      "proportionLogic": "版型比例",
      "sceneFit": "适合场景",
      "detailBoost": "加分细节",
      "risk": "可能风险",
      "reason": "一句总评",
      "score": 0
    },
    {
      "id": "new",
      "name": "尝试新组合",
      "garmentIDs": ["..."],
      "styleKeywords": ["关键词"],
      "colorLogic": "颜色逻辑",
      "proportionLogic": "版型比例",
      "sceneFit": "适合场景",
      "detailBoost": "加分细节",
      "risk": "可能风险",
      "reason": "一句总评",
      "score": 0
    }
  ],
  "bestPlanId": "safe|styled|new",
  "bestReason": "为什么最推荐这一套"
}
可以分析衣橱中的全部单品，但不要把状态为“清洗中”的衣服放入 garmentIDs；如果使用“收纳中”或“已闲置”单品，必须在 risk 中说明现实风险。
这里的“全部单品”指上面传入的全部候选单品；它们已经由本地标签筛选为本次最相关衣物。不要要求用户再上传更多衣服图片。
`;

  const data = await requestJson("/api/text", {
    system: "你是搭一下 App 的大师级造型师和穿搭推荐引擎。必须输出严格 JSON，不要 Markdown。",
    prompt,
    reasoningEffort: mode.reasoningEffort,
  });
  const parsed = extractJson(data.text || "");
  if (!Array.isArray(parsed.plans)) {
    throw new Error("AI response did not include plans.");
  }
  return {
    overallStyle: parsed.overallStyle || "",
    targetStyle: parsed.targetStyle || "",
    selectedGarmentIDs: Array.isArray(parsed.selectedGarmentIDs) ? parsed.selectedGarmentIDs : [],
    excluded: Array.isArray(parsed.excluded) ? parsed.excluded : [],
    plans: parsed.plans,
    bestPlanId: parsed.bestPlanId || parsed.plans[0]?.id || "",
    bestReason: parsed.bestReason || "",
    sourceGarmentCount: garments.length,
    usableGarmentCount: prefilter.usableGarmentCount,
    candidateGarmentCount: candidateGarments.length,
    maxRecommendationGarments: prefilter.maxRecommendationGarments,
    prefilterExcluded: prefilter.filteredOut,
    mode: aiMode,
  };
}
