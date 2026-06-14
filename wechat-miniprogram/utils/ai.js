const api = require("./api");
const { makeGarment, saveLocalFile, uid } = require("./storage");

function extractJson(text) {
  const source = String(text || "").trim().replace(/^```json/i, "```");
  const fenced = source.match(/```\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : source;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI 没有返回 JSON");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function mimeFromPath(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function compressImageForAi(filePath, aiMode = "fast") {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve("");
      return;
    }
    wx.compressImage({
      src: filePath,
      quality: aiMode === "normal" ? 78 : 45,
      success: (result) => resolve(result.tempFilePath || filePath),
      fail: () => resolve(filePath)
    });
  });
}

function fileToDataUrl(filePath, aiMode = "fast") {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: "base64",
      success: (result) => {
        const encoded = String(result.data || "");
        const maxLength = aiMode === "normal" ? 7600000 : 5200000;
        if (encoded.length > maxLength) {
          reject(new Error("图片仍然过大，请裁剪后重试，或先使用快速模式。"));
          return;
        }
        resolve(`data:${mimeFromPath(filePath)};base64,${encoded}`);
      },
      fail: (error) => reject(new Error(error.errMsg || "读取图片失败"))
    });
  });
}

function saveDataUrlAsFile(dataUrl, prefix = "ai-image") {
  return new Promise((resolve, reject) => {
    const match = String(dataUrl || "").match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      resolve(dataUrl);
      return;
    }
    const ext = match[1].includes("jpeg") ? "jpg" : match[1].split("/")[1];
    const filePath = `${wx.env.USER_DATA_PATH}/${prefix}-${uid("img")}.${ext}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: match[2],
      encoding: "base64",
      success: async () => resolve(await saveLocalFile(filePath)),
      fail: (error) => reject(new Error(error.errMsg || "保存 AI 图片失败"))
    });
  });
}

async function imagePathToAiReference(filePath, aiMode = "fast") {
  if (!filePath) return "";
  if (/^https?:\/\//.test(String(filePath))) return filePath;
  const compressed = await compressImageForAi(filePath, aiMode);
  return fileToDataUrl(compressed || filePath, aiMode);
}

async function recognizeSingle(imageDataUrl, fileName, aiMode = "fast") {
  const prompt = `
识别这张照片中最适合加入电子衣橱的一件服装单品。只返回严格 JSON。
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
  "aiTags": ["短上衣","暖白","通勤","显腿长"],
  "colorTemperature": "冷色|暖色|中性色|冷中性色",
  "formality": "休闲|中等正式|正式",
  "visualWeight": "轻|中等|中高|重",
  "silhouette": "版型轮廓",
  "proportionEffect": "身材修饰效果",
  "confidence": 0.0
}
文件名：${fileName || "未命名图片"}
`;
  const response = await api.post("/api/text", {
    system: "你是搭一下 App 的衣物识别助手。输出必须是严格 JSON。",
    prompt,
    imageDataUrl,
    reasoningEffort: aiMode === "normal" ? "medium" : "low"
  }, { timeout: aiMode === "normal" ? 180000 : 120000 });
  return extractJson(response.text || "");
}

async function recognizeOutfit(imageDataUrl, fileName, aiMode = "fast") {
  const prompt = `
识别这张全身照或穿搭照片中的多件可加入电子衣橱的单品。必须按头肩、外套、上衣、腰臀、腿部、脚部、包包、配饰逐区检查，不要只识别上半身。
只返回严格 JSON：
{
  "items": [
    {
      "name": "简短中文名称",
      "category": "上衣|下装|连衣裙|外套|鞋子|包包|配饰",
      "subcategory": "子类别",
      "sourceRegion": "原图位置",
      "seasons": ["春","夏","秋","冬"],
      "primaryColor": "主颜色",
      "colorHex": "#RRGGBB",
      "pattern": "图案",
      "styles": ["简洁","休闲","通勤","甜酷","法式","运动","温柔"],
      "occasions": ["上课","通勤","约会","聚会","旅行","运动"],
      "notes": "一句穿搭建议",
      "aiTags": ["高腰","阔腿","冷色","轻正式"],
      "colorTemperature": "冷色|暖色|中性色|冷中性色",
      "formality": "休闲|中等正式|正式",
      "visualWeight": "轻|中等|中高|重",
      "silhouette": "版型轮廓",
      "proportionEffect": "身材修饰效果",
      "confidence": 0.0
    }
  ],
  "skipped": []
}
文件名：${fileName || "未命名图片"}
`;
  const response = await api.post("/api/text", {
    system: "你是搭一下 App 的整套穿搭识别助手。必须按全身区域扫描，不要只识别上身。",
    prompt,
    imageDataUrl,
    reasoningEffort: aiMode === "normal" ? "xhigh" : "medium"
  }, { timeout: aiMode === "normal" ? 210000 : 150000 });
  const parsed = extractJson(response.text || "");
  return {
    items: Array.isArray(parsed.items) ? parsed.items.slice(0, aiMode === "normal" ? 6 : 4) : [],
    skipped: Array.isArray(parsed.skipped) ? parsed.skipped : []
  };
}

async function generateFlatImage(garment, imageDataUrl, aiMode = "fast") {
  const prompt = `
参考上传照片，为电子衣橱生成一张 AI 单品平面图。
只提取主体：${garment.name}，类别：${garment.category}/${garment.subcategory}，颜色：${garment.primaryColor}。
要求：单件衣物正面展示，移除人物、背景和其他物品，暖白或透明感背景，保留颜色、版型和图案，不要文字、不要水印。
`;
  const response = await api.post("/api/image", {
    prompt,
    imageDataUrl,
    size: "1024x1024",
    quality: aiMode === "fast" ? "low" : "",
    action: "edit",
    reasoningEffort: aiMode === "normal" ? "medium" : "low"
  }, { timeout: aiMode === "normal" ? 240000 : 180000 });
  if (!response.imageDataUrl) {
    throw new Error(response.error || "AI 没有返回图片");
  }
  return saveDataUrlAsFile(response.imageDataUrl, "garment-flat");
}

function garmentTextForStylist(garment) {
  const tags = [
    ...(garment.aiTags || []),
    ...(garment.styles || []),
    ...(garment.occasions || []),
    ...(garment.seasons || []),
    garment.colorTemperature,
    garment.formality,
    garment.visualWeight,
    garment.silhouette,
    garment.proportionEffect
  ].filter(Boolean).slice(0, 18).join(" / ");
  return [
    `ID: ${garment.id}`,
    `名称: ${garment.name}`,
    `类别: ${garment.category}/${garment.subcategory || ""}`,
    `颜色: ${garment.primaryColor || ""} ${garment.colorHex || ""}`,
    `图案: ${garment.pattern || ""}`,
    `季节: ${(garment.seasons || []).join("/")}`,
    `风格: ${(garment.styles || []).join("/")}`,
    `场合: ${(garment.occasions || []).join("/")}`,
    `状态: ${garment.status || "可穿"}`,
    `穿着次数: ${garment.wearCount || 0}`,
    `标签: ${tags}`,
    `备注: ${garment.notes || ""}`
  ].join("；");
}

function scoreForScene(garment, scene, preference = {}) {
  if (garment.status === "清洗中") return -999;
  let score = 0;
  const tags = [
    ...(garment.aiTags || []),
    ...(garment.styles || []),
    ...(garment.occasions || []),
    garment.category,
    garment.subcategory,
    garment.primaryColor,
    garment.colorTemperature,
    garment.formality,
    garment.visualWeight,
    garment.silhouette
  ].filter(Boolean).map(String);
  if ((garment.occasions || []).includes(scene)) score += 28;
  if (tags.some((tag) => tag.includes(scene))) score += 12;
  if ((preference.styles || []).some((style) => tags.includes(style))) score += 8;
  if (garment.isFavorite) score += 5;
  score += Math.max(0, 10 - Number(garment.wearCount || 0) * 0.4);
  if (garment.status && garment.status !== "可穿") score -= 10;
  return score;
}

function prefilterGarmentsForStylist(garments, scene, preference = {}, limit = 24) {
  const scored = (garments || []).map((garment) => ({
    ...garment,
    recommendationScore: scoreForScene(garment, scene, preference)
  }));
  const usable = scored.filter((garment) => garment.status !== "清洗中");
  const categories = ["外套", "上衣", "下装", "连衣裙", "鞋子", "包包", "配饰"];
  const picked = [];
  categories.forEach((category) => {
    usable
      .filter((garment) => garment.category === category)
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, category === "配饰" ? 3 : 4)
      .forEach((garment) => {
        if (!picked.some((item) => item.id === garment.id)) picked.push(garment);
      });
  });
  usable
    .sort((a, b) => b.recommendationScore - a.recommendationScore)
    .forEach((garment) => {
      if (picked.length < limit && !picked.some((item) => item.id === garment.id)) picked.push(garment);
    });
  return {
    candidates: picked.slice(0, limit),
    excluded: scored
      .filter((garment) => garment.status === "清洗中" || !picked.some((item) => item.id === garment.id))
      .slice(0, 16)
      .map((garment) => ({
        id: garment.id,
        name: garment.name,
        reason: garment.status === "清洗中" ? "清洗中，最终搭配不得使用" : "本轮标签匹配度较低，未进入候选"
      })),
    sourceCount: garments.length,
    usableCount: usable.length
  };
}

async function generateOutfitPlansWithAI({ garments, scene = "通勤", preference = {}, bodyProfile = {}, aiMode = "fast" }) {
  const limit = aiMode === "normal" ? 30 : 22;
  const report = prefilterGarmentsForStylist(garments, scene, preference, limit);
  if (!report.candidates.length) {
    throw new Error("衣橱里没有可参与推荐的单品。");
  }
  const prompt = `
你不是普通穿搭助手，而是一位审美很强的高级造型师。
请用专业眼光分析我的衣服库，不只是简单把衣服组合起来，而是判断每件衣服的风格属性、颜色冷暖、正式程度、视觉重心、身材修饰效果。

目标场景：${scene}
身体参数：${JSON.stringify(bodyProfile || {}, null, 2)}
用户偏好：${JSON.stringify(preference || {}, null, 2)}

本地标签预筛选说明：系统已先根据类别、季节、场合、风格、AI 标签、状态和用户偏好做初步筛选，只把最合适的候选单品文本传给你分析，避免一次上传太多图片造成响应变慢。你可以分析全部候选单品，但最终搭配不使用“清洗中”的衣服。

候选单品（只能从这些 ID 中选择最终搭配）：
${report.candidates.map(garmentTextForStylist).join("\n")}

已排除或弱匹配单品：
${report.excluded.map((item) => `${item.id} ${item.name}: ${item.reason}`).join("\n") || "无"}

请严格按以下逻辑输出：
1. 先判断我的衣服库整体风格倾向；
2. 再根据目标风格筛选最匹配的单品；
3. 排除不适合的单品；
4. 给出 3 套完整搭配；
5. 每套搭配说明：风格关键词、颜色逻辑、版型比例、适合场景、加分细节、可能的风险；
6. 最后给出“最推荐的一套”。

只返回严格 JSON：
{
  "wardrobeStyle": "衣橱整体风格倾向",
  "screeningLogic": "如何从候选中筛选",
  "excludedSummary": "排除逻辑",
  "plans": [
    {
      "id": "plan-safe",
      "name": "稳妥搭配",
      "garmentIds": ["必须是候选单品 ID"],
      "styleKeywords": ["关键词"],
      "colorLogic": "颜色逻辑",
      "proportionLogic": "版型比例",
      "sceneFit": "适合场景",
      "detailBoost": "加分细节",
      "risk": "可能风险",
      "reason": "一句简短理由"
    }
  ],
  "bestPlanId": "plan-safe",
  "bestReason": "为什么最推荐"
}
`;
  const response = await api.post("/api/text", {
    system: "你是搭一下 App 的大师级造型师和穿搭推荐引擎。必须输出严格 JSON，不要 Markdown。",
    prompt,
    reasoningEffort: aiMode === "normal" ? "xhigh" : "medium"
  }, { timeout: aiMode === "normal" ? 180000 : 120000 });
  const parsed = extractJson(response.text || "");
  return {
    ...parsed,
    report,
    plans: Array.isArray(parsed.plans) ? parsed.plans.slice(0, 3) : []
  };
}

async function generateOutfitTryOnImage({ garments, scene = "通勤", bodyProfile = {}, personImagePath = "", aiMode = "fast" }) {
  if (!garments.length) {
    throw new Error("请先选择至少一件单品。");
  }
  const references = [];
  if (personImagePath) {
    references.push(await imagePathToAiReference(personImagePath, aiMode));
  }
  const maxGarmentRefs = aiMode === "normal" ? 5 : 3;
  for (const garment of garments.slice(0, maxGarmentRefs)) {
    if (garment.imagePath) {
      try {
        references.push(await imagePathToAiReference(garment.imagePath, aiMode));
      } catch (error) {
        // Skip oversized local references; the text description still guides generation.
      }
    }
  }
  const description = garments.map((garment, index) =>
    `${index + 1}. ${garment.name}，${garment.category}/${garment.subcategory || ""}，${garment.primaryColor || ""}，${garment.pattern || ""}，${(garment.styles || []).join("/")}`
  ).join("\n");
  const prompt = `
为“搭一下”电子衣橱生成一张 AI 穿搭试穿效果图。
场景：${scene}
身体参数：${JSON.stringify(bodyProfile || {}, null, 2)}
选择单品：
${description}

要求：
1. 如果提供了人物参考图，将上述衣物自然换到人物身上，保留人物的大致体型、姿态、肤色和发型，不改变身份特征；
2. 如果没有人物参考图，生成一位简洁真实的全身模特穿着效果；
3. 准确体现单品颜色、廓形、层次和整体搭配关系，避免把包、鞋、外套混成一件；
4. 暖白简洁背景，适合手机 App 内展示；
5. 不要文字、不要水印、不要夸张秀场姿势。
AI 模拟效果仅供穿搭参考，细节和实际版型可能存在差异。
`;
  const response = await api.post("/api/image", {
    prompt,
    referenceImages: references.filter(Boolean).slice(0, aiMode === "normal" ? 6 : 4),
    size: aiMode === "normal" ? "1024x1536" : "768x1152",
    quality: aiMode === "fast" ? "low" : "",
    action: "edit",
    reasoningEffort: aiMode === "normal" ? "medium" : "low"
  }, { timeout: aiMode === "normal" ? 240000 : 180000 });
  if (!response.imageDataUrl) {
    throw new Error(response.error || "AI 没有返回试穿图片");
  }
  return saveDataUrlAsFile(response.imageDataUrl, "try-on");
}

function fallbackGarment(fileName, imagePath) {
  return makeGarment({
    name: fileName ? `新识别单品 ${fileName.replace(/\.[^.]+$/, "").slice(0, 8)}` : "新识别单品",
    category: "上衣",
    subcategory: "待确认",
    primaryColor: "待确认",
    imagePath,
    originalImagePath: fileName,
    notes: "AI 未配置或识别失败，已按待确认单品保存，可在衣橱里继续修改。"
  });
}

module.exports = {
  fileToDataUrl,
  compressImageForAi,
  recognizeSingle,
  recognizeOutfit,
  generateFlatImage,
  generateOutfitPlansWithAI,
  generateOutfitTryOnImage,
  imagePathToAiReference,
  fallbackGarment
};
