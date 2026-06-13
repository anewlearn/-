import { OCCASIONS } from "../../models/schema.js";
import { byId, escapeHtml, renderGarmentArt, renderGarmentCard, renderSceneChips } from "../../core/design-system/components.js";
import { icon } from "../../core/design-system/icons.js";
import { getTodayRecommendation, getWardrobeStats } from "../../services/recommendation-service.js";

export function renderHome(database, ui) {
  const recommendation = getTodayRecommendation(database.garments);
  const stats = getWardrobeStats(database.garments);
  const recent = [...database.garments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);
  const recommendedItems = recommendation.garmentIDs
    .map((id) => byId(database.garments, id))
    .filter(Boolean);

  return `
    <section class="screen" data-page="home">
      <header class="page-header">
        <div>
          <h1>今天想怎么搭？</h1>
          <p>从现有衣橱里挑一套，或者拍一件新衣服进来。</p>
        </div>
        <button class="icon-button" data-nav="capture" type="button" aria-label="拍照识衣">${icon("camera", 20)}</button>
      </header>

      <section class="hero-card" aria-labelledby="today-title">
        <div class="recommendation-image">
          <img src="./src/assets/outfit-recommendation.png" alt="今日推荐穿搭平铺图" />
        </div>
        <div class="recommendation-copy">
          <div class="tag-row">
            <span class="tag">${escapeHtml(recommendation.scene)}</span>
            <span class="tag ai">AI 推荐</span>
          </div>
          <h2 id="today-title">${escapeHtml(recommendation.title)}</h2>
          <p>${escapeHtml(recommendation.reason)}</p>
          <div class="plan-items" aria-label="推荐单品">
            ${recommendedItems.map((garment) => `<span class="mini-garment">${renderGarmentArt(garment, "mini")}</span>`).join("")}
          </div>
          <div class="button-row">
            <button class="secondary-button" data-action="shuffle-today" type="button">${icon("refresh", 17)} 换一套</button>
            <button class="primary-button" data-action="save-today" type="button">${icon("check", 17)} 保存</button>
            <button class="ghost-button" data-nav="outfit" type="button">查看试穿</button>
          </div>
        </div>
      </section>

      <section class="section" aria-labelledby="scene-title">
        <div class="section-title">
          <h2 id="scene-title">快捷场景</h2>
          <span>点击直接生成推荐</span>
        </div>
        ${renderSceneChips(OCCASIONS, ui.selectedScene)}
      </section>

      <section class="section" aria-labelledby="recent-title">
        <div class="section-title">
          <h2 id="recent-title">最近加入</h2>
          <button class="tiny-button" data-nav="wardrobe" type="button">全部</button>
        </div>
        <div class="recent-grid">
          ${recent.map((garment) => renderGarmentCard(garment, { compact: true })).join("")}
        </div>
      </section>

      <section class="section" aria-labelledby="overview-title">
        <div class="section-title">
          <h2 id="overview-title">衣橱概览</h2>
        </div>
        <div class="stats-band">
          <div class="stat-tile">
            <strong>${stats.total}</strong>
            <span>你的衣橱里已有 ${stats.total} 件单品</span>
          </div>
          <div class="stat-tile">
            <strong>${stats.wornThisMonth}</strong>
            <span>本月穿过 ${stats.wornThisMonth} 件，还有 ${stats.longUnworn} 件很久没穿</span>
          </div>
        </div>
      </section>
    </section>
  `;
}
