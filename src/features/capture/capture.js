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

function batchItemGarments(item) {
  if (!item) return [];
  return item.pendingGarment ? [item.pendingGarment] : item.pendingGarments || [];
}

function renderBatchQueue(capture) {
  const items = capture.batchItems || [];
  if (items.length <= 1) return "";
  const doneCount = items.filter((item) => ["done", "done-with-warnings", "failed"].includes(item.status)).length;
  const statusLabels = {
    queued: "排队中",
    processing: "处理中",
    done: "已完成",
    "done-with-warnings": "已完成",
    failed: "处理失败",
  };
  return `
    <div class="batch-queue">
      <div class="batch-queue__header">
        <strong>图片队列</strong>
        <span>${doneCount}/${items.length} 已处理，最多 10 张</span>
      </div>
      <div class="batch-queue__list">
        ${items
          .map((item, index) => {
            const garments = batchItemGarments(item);
            const isActive = item.id === capture.activeBatchItemId;
            const status = item.status || "queued";
            return `
              <button class="batch-item ${isActive ? "is-active" : ""} ${status === "failed" ? "is-error" : ""}" data-action="select-batch-item" data-id="${item.id}" type="button">
                ${item.previewUrl ? `<img src="${item.previewUrl}" alt="${escapeHtml(item.fileName)} 预览" />` : ""}
                <span>
                  <strong>${index + 1}. ${escapeHtml(item.fileName)}</strong>
                  <small>${garments.length ? `识别 ${garments.length} 件单品` : status === "processing" ? "正在识别和生图" : "等待处理"}</small>
                </span>
                <em>${statusLabels[status] || "排队中"}</em>
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderBatchResults(capture) {
  const items = capture.batchItems || [];
  const selectedIds = new Set(capture.selectedPendingGarmentIds || []);
  const resultItems = items.filter((item) => batchItemGarments(item).length || item.aiError || (item.skippedItems || []).length);
  const garmentCount = resultItems.reduce((sum, item) => sum + batchItemGarments(item).length, 0);
  if (!resultItems.length) return "";
  return `
    <div class="capture-result capture-result--stacked batch-results">
      <div class="section-title">
        <h2>批量识别结果 ${garmentCount ? `· ${garmentCount} 件单品` : ""}</h2>
        <span>按照片分组，勾选后加入衣橱</span>
      </div>
      ${resultItems
        .map((item, itemIndex) => {
          const garments = batchItemGarments(item);
          return `
            <section class="batch-result-group">
              <div class="batch-result-title">
                <strong>${itemIndex + 1}. ${escapeHtml(item.fileName)}</strong>
                <span>${garments.length ? `${garments.length} 件单品` : "暂无可入库单品"}</span>
              </div>
              ${item.aiError ? `<p class="error-box error-box--inline">${escapeHtml(item.aiError)}</p>` : ""}
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
                        <p>${escapeHtml(garment.notes || "已从批量照片中识别，可加入衣橱。")}</p>
                      </div>
                    </article>
                  `;
                })
                .join("")}
              ${renderSkippedItems(item.skippedItems)}
            </section>
          `;
        })
        .join("")}
      <div class="button-row">
        <button class="primary-button" data-action="confirm-capture" type="button">加入选中衣橱</button>
        <button class="ghost-button" data-action="reset-capture" type="button">重新选择</button>
      </div>
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
  const batchItems = capture.batchItems || [];
  const isBatch = batchItems.length > 1;
  const activeBatchItem = batchItems.find((item) => item.id === capture.activeBatchItemId) || batchItems[0] || null;
  const hasFile = Boolean(capture.fileName) || Boolean(activeBatchItem);
  const mockGarment = capture.pendingGarment;
  const apiConfig = ui.apiConfig;
  const aiMode = database.preference.aiMode || "fast";
  const mode = capture.mode || "single";
  const hasOutfitResults = !isBatch && mode === "outfit" && (capture.pendingGarments || []).length > 0;
  const hasBatchResults = isBatch && batchItems.some((item) => batchItemGarments(item).length || item.aiError);
  const previewUrl = activeBatchItem?.previewUrl || capture.previewUrl;
  const stepIndex = activeBatchItem?.stepIndex ?? capture.stepIndex;

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
                ${previewUrl ? `<img src="${previewUrl}" alt="待识别照片预览" />` : ""}
                ${renderDetectedBoxes(mode)}
              </div>
              ${renderBatchQueue(capture)}
              <div class="processing-list">${renderSteps(stepIndex)}</div>
              <p class="note-box">${capture.isProcessing ? (isBatch ? "正在按队列逐张处理图片，当前图片完成后会自动进入下一张……" : mode === "single" ? "正在调用 AI 把衣服整理出来……" : "正在识别整套单品、补标签并逐件生成单品图……") : isBatch ? "已建立图片队列，点击开始后会按顺序逐张识别和生成单品图。" : "识别结果会先进入确认页，你可以保留、删除或重新生成。"}</p>
              ${capture.aiError ? `<p class="error-box">AI 调用失败：${escapeHtml(capture.aiError)}</p>` : ""}
            `
            : `
              <div class="upload-zone upload-zone--choices">
                <label class="upload-choice">
                  <input data-capture-file="camera" type="file" accept="image/*" capture="environment" />
                  <span class="nav-icon">${icon("camera", 32)}</span>
                  <strong>拍照</strong>
                  <span>调用相机拍一张</span>
                </label>
                <label class="upload-choice">
                  <input data-capture-file="album" type="file" accept="image/*" multiple />
                  <span class="nav-icon">${icon("wardrobe", 32)}</span>
                  <strong>从相册选择</strong>
                  <span>最多 10 张，按队列处理</span>
                </label>
              </div>
            `
        }

        ${
          hasBatchResults
            ? renderBatchResults(capture)
            : hasOutfitResults
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
                  <button class="primary-button" data-action="finish-processing" type="button" ${capture.isProcessing ? "disabled" : ""}>${capture.isProcessing ? (isBatch ? "队列处理中" : "AI 处理中") : isBatch ? "开始队列处理" : mode === "single" ? "查看识别结果" : "识别并生成单品图"}</button>
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
