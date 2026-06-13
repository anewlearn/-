export const GARMENT_CATEGORIES = [
  "全部",
  "上衣",
  "下装",
  "连衣裙",
  "外套",
  "鞋子",
  "包包",
  "配饰",
];

export const SEASONS = ["全部", "春", "夏", "秋", "冬"];

export const OCCASIONS = ["上课", "通勤", "约会", "聚会", "旅行", "运动"];

export const STYLE_TAGS = ["简洁", "休闲", "通勤", "甜酷", "法式", "运动", "温柔"];

export const GARMENT_STATUSES = ["可穿", "清洗中", "收纳中", "已闲置"];

export const OUTFIT_LAYERS = [
  { key: "outer", label: "外套", accepts: ["外套"] },
  { key: "top", label: "上衣", accepts: ["上衣"] },
  { key: "bottom", label: "下装 / 连衣裙", accepts: ["下装", "连衣裙"] },
  { key: "shoes", label: "鞋子", accepts: ["鞋子"] },
  { key: "bag", label: "包包", accepts: ["包包"] },
  { key: "accessory", label: "配饰", accepts: ["配饰"] },
];

export const PROCESSING_STATES = [
  "等待上传",
  "上传中",
  "识别中",
  "处理中",
  "等待确认",
  "已完成",
  "处理失败",
];
