const config = require("../config");

function request(path, options = {}) {
  const method = options.method || "GET";
  const data = options.data || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.apiBaseUrl}${path}`,
      method,
      data,
      timeout: options.timeout || 60000,
      header: {
        "content-type": "application/json"
      },
      success(response) {
        const body = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300 && body.ok !== false) {
          resolve(body);
          return;
        }
        reject(new Error(body.error || body.message || `请求失败：${response.statusCode}`));
      },
      fail(error) {
        const message = error.errMsg || "网络请求失败";
        reject(new Error(message.includes("timeout") ? "请求超时，请换快速模式或压缩图片后重试。" : message));
      }
    });
  });
}

function parseResponseBody(response) {
  if (typeof response.data === "string") {
    try {
      return JSON.parse(response.data);
    } catch (error) {
      return { ok: false, error: "服务端返回内容不是 JSON" };
    }
  }
  return response.data || {};
}

function upload(path, filePath, formData = {}, options = {}) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${config.apiBaseUrl}${path}`,
      filePath,
      name: options.name || "file",
      formData,
      timeout: options.timeout || 180000,
      success(response) {
        const body = parseResponseBody(response);
        if (response.statusCode >= 200 && response.statusCode < 300 && body.ok !== false) {
          resolve(body);
          return;
        }
        reject(new Error(body.error || body.message || `上传失败：${response.statusCode}`));
      },
      fail(error) {
        const message = error.errMsg || "图片上传失败";
        reject(new Error(message.includes("timeout") ? "图片上传超时，请换一张更小的照片或稍后重试。" : message));
      }
    });
  });
}

module.exports = {
  get(path, options = {}) {
    return request(path, options);
  },
  post(path, data, options = {}) {
    return request(path, { ...options, method: "POST", data });
  },
  upload
};
