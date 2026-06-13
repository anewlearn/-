const scoreByStatus = (garment) => (garment.status !== "清洗中" ? 1 : 0);

function firstWearable(garments, categories, fallbackIndex = 0) {
  const categoryList = Array.isArray(categories) ? categories : [categories];
  const candidates = garments.filter(
    (garment) => categoryList.includes(garment.category) && scoreByStatus(garment),
  );
  return candidates[fallbackIndex % Math.max(candidates.length, 1)] || null;
}

export function getWardrobeStats(garments) {
  const oldItems = garments.filter((garment) => {
    if (!garment.lastWornDate) return true;
    const days = (Date.now() - new Date(garment.lastWornDate).getTime()) / 86400000;
    return days > 30;
  });

  const wornThisMonth = garments.filter((garment) => {
    if (!garment.lastWornDate) return false;
    const worn = new Date(garment.lastWornDate);
    const today = new Date();
    return worn.getMonth() === today.getMonth() && worn.getFullYear() === today.getFullYear();
  });

  return {
    total: garments.length,
    wornThisMonth: wornThisMonth.length,
    longUnworn: oldItems.length,
  };
}

export function getTodayRecommendation(garments) {
  const top = firstWearable(garments, "上衣");
  const bottom = firstWearable(garments, ["下装", "连衣裙"]);
  const shoes = firstWearable(garments, "鞋子");
  const bag = firstWearable(garments, "包包");

  return {
    title: "轻松通勤",
    scene: "通勤",
    reason: "简洁短上衣搭配高腰阔腿裤，拉高腰线，适合轻松通勤。",
    garmentIDs: [top, bottom, shoes, bag].filter(Boolean).map((garment) => garment.id),
  };
}

export function buildOutfitRecommendations(garments, context = {}) {
  const scene = context.scene || "上课";
  const top = firstWearable(garments, "上衣");
  const bottom = firstWearable(garments, ["下装", "连衣裙"]);
  const outer = firstWearable(garments, "外套");
  const shoes = firstWearable(garments, "鞋子");
  const bag = firstWearable(garments, "包包");
  const accessory = firstWearable(garments, "配饰");

  return [
    {
      id: "safe",
      name: "稳妥搭配",
      garmentIDs: [top, bottom, shoes, bag].filter(Boolean).map((garment) => garment.id),
      styleKeywords: ["简洁", "干净", "日常"],
      colorLogic: "以低饱和基础色为主，亮色包袋作为小面积视觉焦点。",
      proportionLogic: "短上衣或清晰腰线搭配高腰下装，保持上短下长。",
      sceneFit: `${scene}、日常出门、轻松通勤。`,
      detailBoost: "鞋包色彩轻轻呼应，整体不费力。",
      risk: "如果上装过宽松，需要把下装腰线露出来。",
      reason: `${scene}场景优先选择干净配色，比例清楚，不容易出错。`,
      score: 91,
    },
    {
      id: "styled",
      name: "更有风格",
      garmentIDs: [outer, top, bottom, bag, accessory].filter(Boolean).map((garment) => garment.id),
      styleKeywords: ["层次", "利落", "轻熟"],
      colorLogic: "用深色外套压住轮廓，内搭和配饰提供轻盈感。",
      proportionLogic: "外套制造肩线，长下装拉伸腿部比例。",
      sceneFit: "聚会、通勤、天气偏凉时。",
      detailBoost: "配饰增加精致度，让基础单品更完整。",
      risk: "外套如果偏厚，整体会更正式，需要用鞋包降低压迫感。",
      reason: "用外套和配饰增加层次，整体更有完成度。",
      score: 86,
    },
    {
      id: "new",
      name: "尝试新组合",
      garmentIDs: [top, bottom, shoes, accessory].filter(Boolean).map((garment) => garment.id),
      styleKeywords: ["轻亮点", "舒适", "新鲜"],
      colorLogic: "基础色压住面积，首饰或浅色单品做轻微提亮。",
      proportionLogic: "保持重心在上半身附近，鞋子减轻整体重量。",
      sceneFit: "上课、旅行、周末出门。",
      detailBoost: "小配饰能让休闲组合更像认真搭过。",
      risk: "如果颜色过浅，可能显得层次不足，可增加包袋或外套。",
      reason: "保留基础单品，加入轻亮点，适合想换个感觉的时候。",
      score: 78,
    },
  ];
}
