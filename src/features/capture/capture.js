import { PROCESSING_STATES } from "../../models/schema.js";
import { escapeHtml, renderGarmentArt } from "../../core/design-system/components.js";
import { icon } from "../../core/design-system/icons.js";

function renderSteps(stepIndex) {
  return PROCESSING_STATES.slice(0, 5)
    .map((label, index) => {
      const className = index < stepIndex ? "is-done" : index === stepIndex ? "is-active" : "";
      return `
        <div class="processing-step ${className}">
          <span>${escapeHtml(label)}</span>
          <i class="processing-dot" aria-hidden="true"></i>
        </div>
      `;
    })
    .join("");
}

function renderAiTags(garment) {
  const tags = [
    ...(garment.aiTags || []),
    garment.category,
    garment.primaryColor,
    garment.sourceRegion,
    garment.layerRole,
    garment.colorTemperature,
    garment.formality,
    garment.visualWeight,
    ...(garment.styles || []),
    ...(garment.occasions || []),
  ]
    .filter(Boolean)
    .slice(0, 8);
  return tags.length
    ? `<div class="ai-tag-list">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
}

function renderImageStatus(garment) {
  const status = garment.imageStatus || (garment.imagePath?.startsWith?.("data:image/") ? "done" : "queued");
  const label =
    {
      queued: "待生成",
      generating: "生成中",
      done: "已生成图",
      failed: "生图失败",
    }[status] || "待生成";
  return `<span class="tag ${status === "done" ? "success" : status === "failed" ? "danger" : "ai"}">${label}</span>`;
}

function renderCaptureModeSwitch(mode) {
  return `
    <div class="segmented-control capture-mode-control" role="group" aria-label="拍照识衣模式">
      <button class="${mode === "single" ? "is-active" : ""}" data-action="set-capture-mode" data-mode="single" type="button">
        单品
      </button>
      <button class="${mode === "outfit" ? "is-active" : ""}" data-action="set-capture-mode" data-mode="outfit" type="button">
        整套
      </button>
    </div>
  `;
}

function renderDetectedBoxes(mode) {
  if (mode === "outfit") {
    return `
      <div class="detected-box detected-box--top"><span>上衣</span></div>
      <div class="detected-box detected-box--bottom"><span>下装</span></div>
      <div class="detected-box detected-box--shoes"><span>鞋子</span></div>
      <div class="detected-box detected-box--bag"><span>包包</span></div>
    `;
  }
  return `<div class="detected-box detected-box--single"><span>单品</span></div>`;
}

function renderSkippedItems(items = []) {
  if (!items.length) return "";
  return `
    <div class="skipped-list">
      <strong>未入库区域</strong>
      ${items.map((item) => `<span>${escapeHtml(item.area || "局部")}：${escapeHtml(item.reason || "清晰度不足")}</span>`).join("")}
    </div>
  `;
}

function renderOutfitResults(capture) {
  const garments = capture.pendingGarments || [];
  if (!garments.length) return "";
  const selectedIds = new Set(capture.selectedPendingGarmentIds || []);
  return `
    <div class="capture-result capture-result--stacked">
      <div class="section-title">
        <h2>识别到 ${garments.length} 件单品</h2>
        <span>勾选后加入衣橱</span>
      </div>
      ${garments
        .map((garment) => {
          const isSelected = selectedIds.has(garment.id);
          return `
            <article class="result-card result-card--multi ${isSelected ? "is-selected" : ""}">
              <label class="pending-check">
                <input type="checkbox" data-pending-garment="${garment.id}" ${isSelected ? "checked" : ""} />
                <span>${isSelected ? "已选" : "未选"}</span>
              </label>
              ${renderGarmentArt(garment)}
              <div>
                <div class="tag-row">
                  <span class="tag ai">AI 标签</span>
                  <span class="tag">${escapeHtml(garment.category)}</span>
                  ${renderImageStatus(garment)}
                </div>
                <h3>${escapeHtml(garment.name)}</h3>
                ${renderAiTags(garment)}
                ${garment.sourceRegion ? `<p class="result-meta">原图位置：${escapeHtml(garment.sourceRegion)}</p>` : ""}
                ${garment.imageError ? `<p class="error-box error-box--inline">单品图生成失败：${escapeHtml(garment.imageError)}</p>` : ""}
                <p>${escapeHtml(garment.notes || "已从整套照片中识别，可加入衣橱。")}</p>
              </div>
            </article>
          `;
        })
        .join("")}
      ${renderSkippedItems(capture.skippedItems)}
      <div class="button-row">
        <button class="primary-button" data-action="confirm-capture" type="button">加入选中衣橱</button>
        <button class="ghost-button" data-action="reset-capture" type="button">重新选择</button>
      </div>
    </div>
  `;
}

export function renderCapture(database, ui) {
  const capture = ui.capture;
  const hasFile = Boolean(capture.fileName);
  const mockGarment = capture.pendingGarment;
  const apiConfig = ui.apiConfig;
  const aiMode = database.preference.aiMode || "fast";
  const mode = capture.mode || "single";
  const hasOutfitResults = mode === "outfit" && (capture.pendingGarments || []).length > 0;

  return `
    <section class="screen" data-page="capture">
      <header class="page-header">
        <div>
          <h1>拍照识衣</h1>
          <p>${mode === "single" ? "拍单件衣服，生成一张 AI 单品平面图。" : "拍全身照，拆出多件单品、打标签并生成单品图。"}</p>
        </div>
      </header>

      <section class="api-status ${apiConfig?.hasApiKey ? "is-ready" : "is-missing"}">
        <strong>${apiConfig?.hasApiKey ? "AI 已连接" : "AI 未配置密钥"}</strong>
        <span>${apiConfig?.hasApiKey ? `${apiConfig.model} / ${aiMode === "fast" ? "快速模式" : "正常模式"}` : "请到“我的”页面输入 API Key"}</span>
      </section>

      <section class="capture-panel">
        ${renderCaptureModeSwitch(mode)}
        <p class="mode-help">${mode === "single" ? "适合拍一件衣服或商品图，速度较快，结果更聚焦。" : "适合全身照，会按上身、下身、鞋履、包和配饰分区识别；先补完整标签，再逐件生成 AI 单品图。"}</p>
        ${
          hasFile
            ? `
              <div class="captured-preview">
                ${capture.previewUrl ? `<img src="${capture.previewUrl}" alt="待识别照片预览" />` : ""}
                ${renderDetectedBoxes(mode)}
              </div>
              <div class="processing-list">${renderSteps(capture.stepIndex)}</div>
              <p class="note-box">${capture.isProcessing ? (mode === "single" ? "正在调用 AI 把衣服整理出来……" : "正在识别整套单品、补标签并逐件生成单品图……") : "识别结果会先进入确认页，你可以保留、删除或重新生成。"}</p>
              ${capture.aiError ? `<p class="error-box">AI 调用失败：${escapeHtml(capture.aiError)}</p>` : ""}
            `
            : `
              <label class="upload-zone">
                <input id="capture-file" type="file" accept="image/*" capture="environment" />
                <span class="nav-icon">${icon("camera", 34)}</span>
                <strong>拍照或选择照片</strong>
                <span>一次处理一张照片，后续再支持批量导入</span>
              </label>
            `
        }

        ${
          hasOutfitResults
            ? renderOutfitResults(capture)
            : mockGarment
            ? `
              <div class="capture-result">
                <article class="result-card">
                  ${renderGarmentArt(mockGarment)}
                  <div>
                    <div class="tag-row">
                      <span class="tag ai">AI 单品平面图</span>
                      <span class="tag">${escapeHtml(mockGarment.category)}</span>
                    </div>
                    <h3>${escapeHtml(mockGarment.name)}</h3>
                    ${renderAiTags(mockGarment)}
                    <p>已自动填写类别、颜色、季节、风格和推荐场合，你可以先加入衣橱。</p>
                    <div class="button-row">
                      <button class="primary-button" data-action="confirm-capture" type="button">加入衣橱</button>
                      <button class="ghost-button" data-action="reset-capture" type="button">重新选择</button>
                    </div>
                  </div>
                </article>
              </div>
            `
            : hasFile
              ? `<div class="button-row" style="margin-top:16px">
                  <button class="primary-button" data-action="finish-processing" type="button" ${capture.isProcessing ? "disabled" : ""}>${capture.isProcessing ? "AI 处理中" : mode === "single" ? "查看识别结果" : "识别并生成单品图"}</button>
                  <button class="ghost-button" data-action="reset-capture" type="button">取消</button>
                </div>`
              : ""
        }
      </section>

      <section class="section">
        <div class="section-title">
          <h2>测试版流程</h2>
        </div>
        <div class="stats-band">
          <div class="stat-tile">
            <strong>1</strong>
            <span>识别照片里的服装轮廓并选择要提取的单品</span>
          </div>
          <div class="stat-tile">
            <strong>2</strong>
            <span>生成透明底衣物展示图，再确认属性</span>
          </div>
        </div>
      </section>
    </section>
  `;
}
