import { GARMENT_CATEGORIES, SEASONS } from "../../models/schema.js";
import { escapeHtml, renderGarmentCard } from "../../core/design-system/components.js";
import { icon } from "../../core/design-system/icons.js";

export function renderWardrobe(database, ui) {
  const category = ui.category || "全部";
  const season = ui.season || "全部";
  const filtered = database.garments.filter((garment) => {
    const categoryMatch = category === "全部" || garment.category === category;
    const seasonMatch = season === "全部" || garment.seasons.includes(season);
    return categoryMatch && seasonMatch;
  });

  return `
    <section class="screen" data-page="wardrobe">
      <header class="page-header">
        <div>
          <h1>电子衣橱</h1>
          <p>按类别和季节快速找到能穿的单品。</p>
        </div>
        <button class="icon-button" data-action="quick-add-garment" type="button" aria-label="新增衣服">${icon("plus", 20)}</button>
      </header>

      <div class="category-row" role="tablist" aria-label="衣物分类">
        ${GARMENT_CATEGORIES.map(
          (item) => `
            <button class="category-chip ${item === category ? "is-selected" : ""}" data-category="${item}" type="button">
              ${escapeHtml(item)}
            </button>
          `,
        ).join("")}
      </div>

      <section class="section">
        <div class="section-title">
          <h2>${escapeHtml(category)}单品</h2>
          <span>${filtered.length} 件</span>
        </div>
        <div class="filter-row" aria-label="季节筛选">
          ${SEASONS.map(
            (item) => `
              <button class="filter-chip ${item === season ? "is-selected" : ""}" data-season="${item}" type="button">
                ${escapeHtml(item)}
              </button>
            `,
          ).join("")}
        </div>
      </section>

      <section class="section">
        ${
          filtered.length
            ? `<div class="garment-grid">${filtered.map((garment) => renderGarmentCard(garment)).join("")}</div>`
            : `<div class="empty-state">当前筛选下还没有衣服。<br />换个分类，或者用拍照按钮加入一件。</div>`
        }
      </section>
    </section>
  `;
}
