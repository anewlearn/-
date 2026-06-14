import { OCCASIONS, STYLE_TAGS } from "../../models/schema.js";
import { escapeHtml } from "../../core/design-system/components.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

export function renderBodyModel(profile) {
  const shoulder = clamp(profile.shoulderWidth || 42, 34, 52) * 1.34;
  const waist = clamp(profile.waist || 68, 56, 92) * 0.72;
  const hips = clamp(profile.hips || 92, 76, 118) * 0.64;
  const leg = clamp(profile.legLength || 94, 76, 112);
  const legBottom = 126 + (leg - 76) * 1.4;
  const center = 60;
  const shoulderHalf = shoulder / 2;
  const waistHalf = waist / 2;
  const hipHalf = hips / 2;

  return `
    <div class="body-model" aria-label="二维参数化模特预览">
      <svg viewBox="0 0 120 250" role="img">
        <circle cx="60" cy="25" r="18" fill="#e8c7b2" />
        <path d="M60 44v18" stroke="#151318" stroke-width="5" stroke-linecap="round" />
        <path
          d="M${center - shoulderHalf} 62
             C${center - shoulderHalf * 0.72} 92 ${center - waistHalf} 108 ${center - waistHalf} 126
             L${center - hipHalf} 148
             L${center + hipHalf} 148
             L${center + waistHalf} 126
             C${center + waistHalf} 108 ${center + shoulderHalf * 0.72} 92 ${center + shoulderHalf} 62 Z"
          fill="#cfc2ef"
          stroke="rgba(21,19,24,.18)"
          stroke-width="2"
        />
        <path d="M${center - shoulderHalf} 66 C18 96 22 128 30 156" stroke="#e8c7b2" stroke-width="10" stroke-linecap="round" />
        <path d="M${center + shoulderHalf} 66 C102 96 98 128 90 156" stroke="#e8c7b2" stroke-width="10" stroke-linecap="round" />
        <path d="M${center - hipHalf * 0.45} 148 C43 174 42 ${legBottom - 24} 38 ${legBottom}" stroke="#34323a" stroke-width="13" stroke-linecap="round" />
        <path d="M${center + hipHalf * 0.45} 148 C77 174 78 ${legBottom - 24} 82 ${legBottom}" stroke="#34323a" stroke-width="13" stroke-linecap="round" />
        <path d="M30 ${legBottom + 5}h20" stroke="#151318" stroke-width="7" stroke-linecap="round" />
        <path d="M70 ${legBottom + 5}h20" stroke="#151318" stroke-width="7" stroke-linecap="round" />
      </svg>
    </div>
  `;
}

function slider(label, key, value, min, max, unit) {
  return `
    <label class="slider-row">
      <span class="slider-head"><span>${escapeHtml(label)}</span><span data-profile-value="${key}" data-unit="${unit}">${value}${unit}</span></span>
      <input type="range" min="${min}" max="${max}" value="${value}" data-profile="${key}" />
    </label>
  `;
}

function preferenceChips(items, selected, type) {
  return `
    <div class="chip-row">
      ${items
        .map(
          (item) => `
            <button class="scene-chip ${selected.includes(item) ? "is-selected" : ""}" data-pref-type="${type}" data-pref-value="${item}" type="button">
              ${escapeHtml(item)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function formatBytes(bytes) {
  if (bytes == null) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function renderModeSwitch(activeMode) {
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

function providerSourceText(provider) {
  if (!provider) return "未配置";
  if (provider.keySource === "runtime") return `网页临时输入（${provider.apiKeyCount || 0} 个 Key）`;
  if (provider.keySource === "environment_pool") return `系统环境变量 Key 池（${provider.apiKeyCount || 0} 个）`;
  if (provider.keySource === "environment") return "系统环境变量";
  return "未配置";
}

function renderProviderOptions(config) {
  const providers = config?.providers?.length
    ? config.providers
    : [
        { id: "openai", label: "OpenAI", hasApiKey: config?.providerId !== "google" && Boolean(config?.hasApiKey) },
        { id: "google", label: "Google Gemini", hasApiKey: config?.providerId === "google" && Boolean(config?.hasApiKey) },
      ];
  return providers
    .map(
      (provider) => `
        <option value="${escapeHtml(provider.id)}" ${provider.id === (config?.providerId || "openai") ? "selected" : ""}>
          ${escapeHtml(provider.label)}${provider.hasApiKey ? "（已配置）" : ""}
        </option>
      `,
    )
    .join("");
}

function renderApiKeyPanel(ui) {
  const config = ui.apiConfig;
  const activeProvider = (config?.providers || []).find((provider) => provider.id === config?.providerId);
  const hasKey = Boolean(config?.hasApiKey);
  const sourceText = providerSourceText(activeProvider || config);
  const runtimeKeyEnabled = config?.runtimeApiKeyEnabled !== false;
  const managedByServer = !runtimeKeyEnabled;
  const providerName = config?.provider || "OpenAI";

  return `
    <section class="form-panel api-key-panel">
      <div class="section-title">
        <h2>AI 接口密钥</h2>
        <span>${hasKey ? `${providerName} 已连接` : "未连接"}</span>
      </div>
      <div class="api-status ${hasKey ? "is-ready" : "is-missing"}">
        <strong>${hasKey ? `${providerName} 已连接` : "AI 未配置密钥"}</strong>
        <span>${config?.model || "未设置模型"} / ${sourceText} / 不在页面或文件中明文保存</span>
      </div>
      ${
        managedByServer
          ? `
            <p class="note-box">
              线上部署已关闭网页临时密钥输入。请在 Render 的 Environment 中配置 AI_PROVIDER=openai 或 AI_PROVIDER=google；
              OpenAI 使用 OPENAI_API_KEY / OPENAI_API_KEYS，Google 使用 GOOGLE_API_KEY / GOOGLE_API_KEYS。
              多个 Key 可用逗号或换行分隔，某个 Key 额度耗尽、429、502、超时后会自动换下一个重试。
            </p>
          `
          : `
            <label class="field-label" for="api-provider-select">接口提供方</label>
            <select id="api-provider-select" class="select-field">
              ${renderProviderOptions(config)}
            </select>
            <label class="field-label" for="api-key-input">API Key，可填多个</label>
            <textarea
              id="api-key-input"
              class="text-field api-key-input"
              autocomplete="off"
              spellcheck="false"
              rows="3"
              placeholder="每行一个，或用逗号分隔；仅保存在本地服务器内存"
            ></textarea>
            <div class="button-row">
              <button class="primary-button" data-action="save-api-key" type="button">保存并连接</button>
              <button class="ghost-button" data-action="clear-api-key" type="button">清除临时密钥</button>
            </div>
          `
      }
    </section>
  `;
}

function renderAiModePanel(database) {
  const aiMode = database.preference.aiMode || "fast";
  return `
    <section class="form-panel">
      <div class="section-title">
        <h2>AI 提取模式</h2>
        <span>${aiMode === "fast" ? "速度优先" : "质量优先"}</span>
      </div>
      ${renderModeSwitch(aiMode)}
      <div class="mode-explain">
        <div>
          <strong>快速</strong>
          <span>压缩图片更小、低推理强度、试穿少传参考图，适合快速试错。</span>
        </div>
        <div>
          <strong>正常</strong>
          <span>保留更多图像细节和参考图，适合确认最终穿搭效果。</span>
        </div>
      </div>
    </section>
  `;
}

function renderStoragePanel(database, ui) {
  const storage = ui.storageInfo;
  const serverDatabaseEnabled = ui.apiConfig?.serverDatabaseEnabled !== false;
  const aiImageCount = Math.max(storage?.inlineImageCount || 0, storage?.indexedImageCount || 0);
  const percent = storage?.browserQuotaBytes
    ? Math.min(100, Math.round(((storage.browserUsageBytes || 0) / storage.browserQuotaBytes) * 100))
    : 0;
  return `
    <section class="form-panel">
      <div class="section-title">
        <h2>衣橱文件与空间</h2>
        <span>${storage?.hasEnoughSpace ? "空间充足" : "空间偏紧"}</span>
      </div>
      <div class="storage-note">
        当前测试版衣服属性和标签保存在本机浏览器的 localStorage，键名为 ${escapeHtml(storage?.storageKey || "style-tap-web-mvp-v0.1")}。
        AI 单品图会转存到浏览器 IndexedDB，避免大图撑爆 localStorage；原始照片目前只保存文件名，不保存照片文件。
      </div>
      <div class="storage-note">
        ${
          serverDatabaseEnabled
            ? `已启用本机文件备份：${escapeHtml(storage?.serverStorageLocation || "data/wardrobe.json")}。再次打开程序时会优先恢复衣橱、穿搭、身体参数和偏好设置；API Key 不会写入这个文件。`
            : "线上模式未启用服务器文件备份；每台设备会使用自己的浏览器存储，API Key 由 Render 环境变量管理。"
        }
      </div>
      <div class="storage-meter" aria-label="浏览器存储使用量">
        <span style="width:${percent}%"></span>
      </div>
      <div class="info-grid">
        <div><strong>${storage?.garmentCount ?? database.garments.length}</strong><span>衣服记录</span></div>
        <div><strong>${aiImageCount}</strong><span>AI 图片</span></div>
        <div><strong>${storage?.placeholderImageCount ?? 0}</strong><span>占位模型图</span></div>
        <div><strong>${formatBytes(storage?.localDatabaseBytes)}</strong><span>衣橱数据大小</span></div>
        <div><strong>${formatBytes(storage?.browserUsageBytes)}</strong><span>浏览器已用</span></div>
        <div><strong>${formatBytes(storage?.browserRemainingBytes)}</strong><span>估算剩余</span></div>
      </div>
    </section>
  `;
}

export function renderSettings(database, ui) {
  const profile = database.bodyProfile;
  const preference = database.preference;

  return `
    <section class="screen" data-page="settings">
      <header class="page-header">
        <div>
          <h1>我的</h1>
          <p>身体参数、风格偏好和隐私设置都保存在本地。</p>
        </div>
      </header>

      ${renderApiKeyPanel(ui)}
      ${renderAiModePanel(database)}
      ${renderStoragePanel(database, ui)}

      <section class="form-panel">
        <div class="model-preview">
          ${renderBodyModel(profile)}
          <div class="model-copy">
            <h2>二维模特</h2>
            <p>参数变化会实时影响肩线、腰臀比例和腿部长度。AI 上身图仅供参考，细节可能不同于实际版型。</p>
          </div>
        </div>
        ${slider("身高", "height", profile.height || 168, 145, 190, "cm")}
        ${slider("肩宽", "shoulderWidth", profile.shoulderWidth || 42, 34, 52, "cm")}
        ${slider("腰围", "waist", profile.waist || 68, 56, 92, "cm")}
        ${slider("臀围", "hips", profile.hips || 92, 76, 118, "cm")}
        ${slider("腿长", "legLength", profile.legLength || 94, 76, 112, "cm")}
      </section>

      <section class="section">
        <div class="section-title">
          <h2>风格偏好</h2>
          <span>用于推荐排序</span>
        </div>
        <div class="preference-row">
          <strong>常用场合</strong>
          ${preferenceChips(OCCASIONS, preference.occasions, "occasions")}
        </div>
        <div class="preference-row">
          <strong>风格倾向</strong>
          ${preferenceChips(STYLE_TAGS, preference.styles, "styles")}
        </div>
        <div class="preference-row">
          <span class="slider-head"><span>正式程度倾向</span><span data-preference-value="formality">${preference.formality}</span></span>
          <input type="range" min="0" max="100" value="${preference.formality}" data-preference="formality" />
        </div>
      </section>

      <section class="section">
        <div class="section-title">
          <h2>隐私与设置</h2>
        </div>
        <div class="button-row">
          <button class="secondary-button" data-action="reset-demo" type="button">恢复示例数据</button>
          <button class="ghost-button" data-action="delete-body-profile" type="button">清空身体档案</button>
        </div>
      </section>
    </section>
  `;
}
