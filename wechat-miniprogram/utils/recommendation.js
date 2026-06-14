const { OUTFIT_LAYERS } = require("./constants");

function availableGarments(database) {
  return (database.garments || []).filter((garment) => garment.status !== "清洗中");
}

function scoreGarment(garment, scene) {
  let score = 0;
  if ((garment.occasions || []).includes(scene)) score += 25;
  if ((garment.styles || []).includes("简洁")) score += 8;
  if (garment.isFavorite) score += 5;
  score += Math.max(0, 8 - Number(garment.wearCount || 0) * 0.3);
  return score;
}

function pickByCategory(database, category, scene, used = new Set()) {
  return availableGarments(database)
    .filter((garment) => garment.category === category && !used.has(garment.id))
    .sort((a, b) => scoreGarment(b, scene) - scoreGarment(a, scene))[0] || null;
}

function buildPlan(database, scene, title, styleShift = 0) {
  const used = new Set();
  const categories = styleShift === 2
    ? ["外套", "连衣裙", "鞋子", "包包", "配饰"]
    : ["外套", "上衣", "下装", "鞋子", "包包", "配饰"];
  const garments = categories
    .map((category) => {
      const item = pickByCategory(database, category, scene, used);
      if (item) used.add(item.id);
      return item;
    })
    .filter(Boolean);
  const colors = garments.map((item) => item.primaryColor).filter(Boolean).slice(0, 3).join("、") || "基础色";
  return {
    id: `${scene}-${styleShift}`,
    title,
    garments,
    reason: `围绕${scene}场景筛选，颜色以${colors}为主，排除了清洗中的单品。`,
    keywords: styleShift === 1 ? "更有风格、细节提亮" : styleShift === 2 ? "新组合、轻尝试" : "稳妥、好穿"
  };
}

function buildRecommendations(database, scene = "通勤") {
  return [
    buildPlan(database, scene, "稳妥搭配", 0),
    buildPlan(database, scene, "更有风格", 1),
    buildPlan(database, scene, "尝试新组合", 2)
  ].filter((plan) => plan.garments.length);
}

function selectionsToGarments(database, selections) {
  return OUTFIT_LAYERS.map((layer) => {
    const garment = (database.garments || []).find((item) => item.id === selections[layer.key]);
    return garment ? { layer, garment } : { layer, garment: null };
  });
}

module.exports = {
  buildRecommendations,
  selectionsToGarments
};
