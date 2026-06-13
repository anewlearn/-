import { icon } from "./icons.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function byId(items, id) {
  return items.find((item) => item.id === id) || null;
}

export function renderBottomNav(activeTab) {
  const tabs = [
    ["home", "首页", "home"],
    ["wardrobe", "衣橱", "wardrobe"],
    ["capture", "拍照", "camera"],
    ["outfit", "搭配", "sparkles"],
    ["settings", "我的", "user"],
  ];

  return `
    <nav class="bottom-nav" aria-label="主导航">
      ${tabs
        .map(([key, label, iconName]) => {
          const isCapture = key === "capture";
          const isActive = activeTab === key;
          return `
            <button class="nav-item ${isActive ? "is-active" : ""} ${isCapture ? "is-capture" : ""}" data-nav="${key}" type="button" aria-label="${label}">
              <span class="nav-icon">${icon(iconName, isCapture ? 27 : 21)}</span>
              <span>${label}</span>
            </button>
          `;
        })
        .join("")}
    </nav>
  `;
}

function garmentPath(kind) {
  const shapes = {
    top:
      '<path d="M33 17 17 28l9 15 8-4v51h52V39l8 4 9-15L87 17l-13 10c-8 7-20 7-28 0Z"/><path d="M45 19c5 7 19 7 24 0"/>',
    pants:
      '<path d="M37 14h46l5 76H66L60 44l-6 46H32Z"/><path d="M42 14c6 8 26 8 36 0"/><path d="M60 44V18"/>',
    dress:
      '<path d="M43 14h34l7 31 13 45H23l13-45Z"/><path d="M47 14c4 9 22 9 26 0"/><path d="M36 45h48"/>',
    outer:
      '<path d="M37 15 20 30l8 14 8-4-5 50h58l-5-50 8 4 8-14-17-15-15 10H52Z"/><path d="M60 27v63"/><path d="M48 31l12 12 12-12"/>',
    shoes:
      '<path d="M22 56c17 0 28-8 38-19 5 8 13 13 28 16 8 2 12 8 10 16H19c-6 0-7-8 3-13Z"/><path d="M35 54h19"/><path d="M59 39l8 14"/><path d="M72 45l6 10"/>',
    bag:
      '<path d="M30 38h60l-5 48H35Z"/><path d="M45 38c0-18 30-18 30 0"/><path d="M42 52h36"/>',
    accessory:
      '<path d="M26 31c9 31 59 31 68 0"/><path d="M33 32c9 20 45 20 54 0"/><circle cx="60" cy="69" r="8"/><path d="M60 77v11"/>',
  };
  return shapes[kind] || shapes.top;
}

export function renderGarmentArt(garment, size = "regular") {
  if (garment.imagePath?.startsWith("data:image/") || garment.imagePath?.startsWith("http")) {
    return `
      <div class="garment-art garment-art--${size}">
        <img src="${escapeHtml(garment.imagePath)}" alt="${escapeHtml(garment.name)}" />
      </div>
    `;
  }

  const visual = garment.visual || { kind: "top", accent: "#b9264f" };
  const color = garment.colorHex || "#f4eee5";
  return `
    <div class="garment-art garment-art--${size}" style="--garment-color:${color}; --garment-accent:${visual.accent || "#b9264f"}">
      <svg viewBox="0 0 120 104" role="img" aria-label="${escapeHtml(garment.name)}">
        <g fill="var(--garment-color)" stroke="rgba(21,19,24,.18)" stroke-width="2.2" stroke-linejoin="round">
          ${garmentPath(visual.kind)}
        </g>
        <g fill="none" stroke="var(--garment-accent)" stroke-width="2" stroke-linecap="round" opacity=".72">
          <path d="M39 88h42"/>
          <path d="M43 82h34"/>
        </g>
      </svg>
    </div>
  `;
}

export function renderGarmentCard(garment, options = {}) {
  const compact = options.compact ? "is-compact" : "";
  return `
    <article class="garment-card ${compact}" data-garment-card="${garment.id}">
      <button class="match-button" data-action="send-to-outfit" data-id="${garment.id}" type="button" aria-label="加入搭配">
        ${icon("sparkles", 14)}
        <span>搭配</span>
      </button>
      <button class="favorite-button ${garment.isFavorite ? "is-on" : ""}" data-action="toggle-favorite" data-id="${garment.id}" type="button" aria-label="收藏">
        ${icon("heart", 16)}
      </button>
      <button class="garment-open" data-action="open-garment" data-id="${garment.id}" type="button">
        ${renderGarmentArt(garment)}
        <span class="garment-name">${escapeHtml(garment.name)}</span>
        <span class="garment-meta">${escapeHtml(garment.seasons.slice(0, 2).join(" / "))}</span>
      </button>
    </article>
  `;
}

export function renderSceneChips(scenes, selectedScene = "") {
  return `
    <div class="chip-row" role="list">
      ${scenes
        .map(
          (scene) => `
            <button class="scene-chip ${scene === selectedScene ? "is-selected" : ""}" data-scene="${scene}" type="button">
              ${escapeHtml(scene)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

export function renderStatusBadge(status) {
  const tone = status === "可穿" ? "success" : status === "清洗中" ? "ai" : "muted";
  return `<span class="status-badge status-badge--${tone}">${escapeHtml(status)}</span>`;
}

function renderAiTagList(tags = []) {
  const visibleTags = tags.filter(Boolean).slice(0, 14);
  if (!visibleTags.length) return "";
  return `
    <div class="detail-tag-block">
      <strong>AI 标签</strong>
      <div class="ai-tag-list">
        ${visibleTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
      </div>
    </div>
  `;
}

export function renderDetailSheet(garment) {
  if (!garment) return "";

  return `
    <div class="sheet-backdrop" data-action="close-sheet">
      <section class="detail-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(garment.name)}详情">
        <header class="sheet-header">
          <button class="icon-button" data-action="close-sheet" type="button" aria-label="关闭">${icon("x", 20)}</button>
          <strong>单品详情</strong>
          <button class="icon-button danger" data-action="delete-garment" data-id="${garment.id}" type="button" aria-label="删除">${icon("trash", 19)}</button>
        </header>
        <div class="detail-hero">
          ${renderGarmentArt(garment, "large")}
        </div>
        <div class="detail-content">
          <div class="detail-title-row">
            <div>
              <h2>${escapeHtml(garment.name)}</h2>
              <p>${escapeHtml(garment.category)} / ${escapeHtml(garment.subcategory)}</p>
            </div>
            ${renderStatusBadge(garment.status)}
          </div>
          <dl class="detail-grid">
            <div><dt>季节</dt><dd>${escapeHtml(garment.seasons.join("、"))}</dd></div>
            <div><dt>颜色</dt><dd>${escapeHtml(garment.primaryColor)}</dd></div>
            <div><dt>风格</dt><dd>${escapeHtml(garment.styles.join("、"))}</dd></div>
            <div><dt>场合</dt><dd>${escapeHtml(garment.occasions.join("、"))}</dd></div>
            <div><dt>穿着次数</dt><dd>${garment.wearCount} 次</dd></div>
            <div><dt>最近穿着</dt><dd>${garment.lastWornDate || "还没有记录"}</dd></div>
          </dl>
          <label class="field-label" for="garment-status">衣服状态</label>
          <select class="select-field" id="garment-status" data-action="change-status" data-id="${garment.id}">
            ${["可穿", "清洗中", "收纳中", "已闲置"]
              .map((status) => `<option ${status === garment.status ? "selected" : ""}>${status}</option>`)
              .join("")}
          </select>
          ${renderAiTagList(garment.aiTags)}
          <p class="note-box">${escapeHtml(garment.notes)}</p>
          <div class="button-row detail-actions">
            <button class="primary-button" data-action="send-to-outfit" data-id="${garment.id}" type="button">
              ${icon("sparkles", 17)}
              加入搭配
            </button>
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderToast(message) {
  if (!message) return "";
  return `<div class="toast" role="status">${escapeHtml(message)}</div>`;
}
