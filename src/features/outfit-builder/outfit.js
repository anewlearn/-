import { OCCASIONS, OUTFIT_LAYERS } from "../../models/schema.js";
import { byId, escapeHtml, renderGarmentArt, renderSceneChips } from "../../core/design-system/components.js";
import { icon } from "../../core/design-system/icons.js";
import { buildOutfitRecommendations } from "../../services/recommendation-service.js";

function optionsForLayer(garments, layer, selectedId) {
  const options = garments.filter((garment) => layer.accepts.includes(garment.category));
  return `
    <select class="layer-select" data-layer="${layer.key}" aria-label="选择${layer.label}">
      <option value="">未选择</option>
      ${options
        .map(
          (garment) => `
            <option value="${garment.id}" ${garment.id === selectedId ? "selected" : ""}>${escapeHtml(garment.name)}</option>
          `,
        )
        .join("")}
    </select>
  `;
}

function stageItems(database, selections) {
  const rotations = ["-8deg", "5deg", "3deg", "-5deg", "9deg", "-11deg"];
  return OUTFIT_LAYERS.map((layer, index) => byId(database.garments, selections[layer.key]))
    .filter(Boolean)
    .map(
      (garment, index) => `
        <div class="stage-item" style="--rotate:${rotations[index % rotations.length]}">
          ${renderGarmentArt(garment)}
        </div>
      `,
    )
    .join("");
}

function renderAiModeSwitch(activeMode) {
  return `
    <div class="segmented-control" role="group" aria-label="AI 模式">
      <button class="${activeMode === "fast" ? "is-active" : ""}" data-action="set-ai-mode" data-mode="fast" type="button">
        快速
      </button>
      <button class="${activeMode === "normal" ? "is-active" : ""}" data-action="set-ai-mode" data-mode="normal" type="button">
        正常
      </button>
    </div>
  `;
}

function renderPlanDetail(label, value) {
  if (!value || (Array.isArray(value) && !value.length)) return "";
  const content = Array.isArray(value) ? value.join(" / ") : value;
  return `
    <div class="plan-detail">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(content)}</span>
    </div>
  `;
}

function renderPlan(database, plan, report) {
  const items = plan.garmentIDs.map((id) => byId(database.garments, id)).filter(Boolean);
  const isBest = report?.bestPlanId && report.bestPlanId === plan.id;
  return `
    <article class="recommendation-plan ${isBest ? "is-best" : ""}">
      <div class="plan-head">
        <h3>${escapeHtml(plan.name)}${isBest ? '<span class="best-badge">最推荐</span>' : ""}</h3>
        <span class="plan-score">${plan.score}</span>
      </div>
      <div class="plan-items">
        ${items.map((garment) => `<span class="mini-garment">${renderGarmentArt(garment, "mini")}</span>`).join("")}
      </div>
      <p>${escapeHtml(plan.reason)}</p>
      <div class="plan-details">
        ${renderPlanDetail("风格关键词", plan.styleKeywords)}
        ${renderPlanDetail("颜色逻辑", plan.colorLogic)}
        ${renderPlanDetail("版型比例", plan.proportionLogic)}
        ${renderPlanDetail("适合场景", plan.sceneFit)}
        ${renderPlanDetail("加分细节", plan.detailBoost)}
        ${renderPlanDetail("可能风险", plan.risk)}
      </div>
      <div class="button-row">
        <button class="secondary-button" data-action="apply-plan" data-plan="${plan.id}" type="button">使用这套</button>
        <button class="ghost-button" data-action="feedback-plan" data-plan="${plan.id}" type="button">不喜欢</button>
      </div>
    </article>
  `;
}

function renderStylistReport(report) {
  if (!report) return "";
  const excluded = report.excluded || [];
  return `
    <section class="stylist-report">
      <div class="section-title">
        <h2>大师造型分析</h2>
        <span>${report.mode === "normal" ? "正常模式" : "快速模式"}</span>
      </div>
      <div class="report-grid">
        <div>
          <strong>整体风格</strong>
          <p>${escapeHtml(report.overallStyle || "已完成衣橱整体风格判断。")}</p>
        </div>
        <div>
          <strong>目标风格</strong>
          <p>${escapeHtml(report.targetStyle || "根据当前场景筛选最匹配单品。")}</p>
        </div>
      </div>
      <div class="storage-note">
        本地标签已先从衣橱 ${report.sourceGarmentCount} 件单品中筛出 ${report.candidateGarmentCount || report.usableGarmentCount} 件候选，再交给 AI 分析；候选上限 ${report.maxRecommendationGarments || "默认"} 件。清洗中的衣服会被排除。
      </div>
      ${
        excluded.length
          ? `<div class="excluded-list">
              <strong>排除单品</strong>
              ${excluded
                .map(
                  (item) => `
                    <span>${escapeHtml(item.name || item.id)}：${escapeHtml(item.reason || "不适合本次目标风格")}</span>
                  `,
                )
                .join("")}
            </div>`
          : ""
      }
      ${report.bestReason ? `<p class="note-box">最推荐理由：${escapeHtml(report.bestReason)}</p>` : ""}
    </section>
  `;
}

export function renderOutfit(database, ui) {
  const selections = ui.outfitSelections;
  const plans = ui.aiPlans || buildOutfitRecommendations(database.garments, { scene: ui.selectedScene });
  const planSource = ui.aiPlans ? "AI 实时生成" : "本地规则推荐";
  const report = ui.aiStylistReport;
  const tryOn = ui.tryOn || {};
  const apiReady = Boolean(ui.apiConfig?.hasApiKey);
  const hasPersonReference = Boolean(tryOn.personPreviewUrl);
  const aiMode = database.preference.aiMode || "fast";
  const wearableCount = database.garments.filter((garment) => garment.status !== "清洗中").length;

  return `
    <section class="screen" data-page="outfit">
      <header class="page-header">
        <div>
          <h1>搭配工作台</h1>
          <p>像做杂志拼贴一样，把不同层级的单品组合起来。</p>
        </div>
      </header>

      <section class="workspace">
        <div class="collage-stage" aria-label="穿搭拼贴画布">
          ${stageItems(database, selections)}
        </div>

        <div class="button-row">
          <button class="primary-button" data-action="save-current-outfit" type="button">保存穿搭</button>
          <button class="secondary-button" data-action="generate-plans" type="button">大师级推荐</button>
          <button class="ghost-button" data-action="generate-try-on" type="button" ${tryOn.isGenerating ? "disabled" : ""}>${tryOn.isGenerating ? "生成中" : hasPersonReference ? "换到人物身上" : "生成 AI 试穿效果"}</button>
        </div>
        <div class="mode-strip">
          <div>
            <strong>${aiMode === "fast" ? "快速模式" : "正常模式"}</strong>
            <span>推荐会分析衣橱全部 ${database.garments.length} 件单品，实际搭配排除清洗中；当前可参与 ${wearableCount} 件。</span>
          </div>
          ${renderAiModeSwitch(aiMode)}
        </div>

        <section class="try-on-panel">
          <div class="section-title">
            <h2>AI 试穿效果</h2>
            <span>${tryOn.imageDataUrl ? "已生成" : tryOn.isGenerating ? "生成中" : "实验功能"}</span>
          </div>
          <div class="person-upload">
            ${
              hasPersonReference
                ? `
                  <div class="person-reference">
                    <img src="${tryOn.personPreviewUrl}" alt="人物形象参考图" />
                    <div>
                      <strong>人物形象已上传</strong>
                      <span>${escapeHtml(tryOn.personFileName || "参考照片")}</span>
                    </div>
                    <button class="tiny-button" data-action="clear-try-on-person" type="button" aria-label="移除人物形象">${icon("x", 14)}移除</button>
                  </div>
                `
                : `
                  <label class="upload-zone upload-zone--compact">
                    <input id="tryon-person-file" type="file" accept="image/*" />
                    <span class="nav-icon">${icon("user", 28)}</span>
                    <strong>上传人物形象</strong>
                    <span>可把当前穿搭直接换到这张人物照上</span>
                  </label>
                `
            }
          </div>
          ${
            tryOn.imageDataUrl
              ? `<img class="try-on-image" src="${tryOn.imageDataUrl}" alt="AI 试穿效果图" />`
              : `<div class="try-on-placeholder">${apiReady ? (hasPersonReference ? "选择好单品后，AI 会参考人物照生成换装效果。" : "选择好单品后生成一张整体穿搭效果图。") : "请先在“我的”页面输入 API Key，再生成穿搭效果图。"}<br />AI 模拟效果仅供穿搭参考，细节和实际版型可能存在差异。</div>`
          }
          ${tryOn.error ? `<p class="error-box">生图失败：${escapeHtml(tryOn.error)}</p>` : ""}
        </section>

        <div class="layer-list">
          ${OUTFIT_LAYERS.map((layer) => {
            const selected = byId(database.garments, selections[layer.key]);
            return `
              <div class="layer-row">
                <strong>${escapeHtml(layer.label)}</strong>
                <span>${selected ? escapeHtml(selected.name) : "从衣橱中选择"}</span>
                ${optionsForLayer(database.garments, layer, selections[layer.key])}
              </div>
            `;
          }).join("")}
        </div>
      </section>

      <section class="section">
        <div class="section-title">
          <h2>推荐输入</h2>
          <span>${escapeHtml(ui.selectedScene || "上课")}</span>
        </div>
        ${renderSceneChips(OCCASIONS, ui.selectedScene)}
      </section>

      <section class="section">
        <div class="section-title">
          <h2>AI 推荐方案</h2>
          <span>${planSource}</span>
        </div>
        ${renderStylistReport(report)}
        <div class="workspace">
          ${plans.map((plan) => renderPlan(database, plan, report)).join("")}
        </div>
      </section>
    </section>
  `;
}
