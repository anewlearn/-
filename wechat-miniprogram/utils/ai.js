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
      quality: aiMode === "normal" ? 72 : 52,
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
  fallbackGarment
};
