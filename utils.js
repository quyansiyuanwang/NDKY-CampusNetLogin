// ============================================
// 共享工具函数
// ============================================

const http = require("http");
const https = require("https");
const { URL } = require("url");

// 常量定义
const CONSTANTS = {
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  CONTENT_TYPE: "application/x-www-form-urlencoded; charset=UTF-8",
  TIMEOUT: 10000,
  MAX_REDIRECTS: 10,
  DEFAULT_RSA_EXPONENT: "10001",
  EPORTAL_PATH: "/eportal/InterFace.do?method=",
  CONNECTIVITY_TEST_URL: "http://www.msftconnecttest.com/connecttest.txt",
  CONNECTIVITY_TEST_RESPONSE: "Microsoft Connect Test",
};

// ============================================
// HTTP 请求函数
// ============================================
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === "https:" ? https : http;
    const method = options.method || "GET";
    const postData = options.body || "";

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        "User-Agent": CONSTANTS.USER_AGENT,
        ...options.headers,
      },
    };

    // 添加 POST 请求的 Content-Type 和 Content-Length
    if (method === "POST") {
      requestOptions.headers["Content-Type"] = CONSTANTS.CONTENT_TYPE;
      requestOptions.headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = protocol.request(requestOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");

        // 如果是 POST 请求，尝试解析 JSON
        if (method === "POST") {
          try {
            const result = JSON.parse(body);
            resolve(result);
          } catch (e) {
            resolve({ raw: body, error: e.message });
          }
        } else {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
            url: url,
          });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(CONSTANTS.TIMEOUT, () => {
      req.destroy();
      reject(new Error("请求超时"));
    });

    if (method === "POST" && postData) {
      req.write(postData);
    }
    req.end();
  });
}

// POST 请求快捷方式
function httpPost(url, data) {
  return httpRequest(url, { method: "POST", body: data || "" });
}

// GET 请求快捷方式
function httpGet(url) {
  return httpRequest(url, { method: "GET" });
}

// ============================================
// URL 工具函数
// ============================================
function extractQueryString(url) {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    const queryParts = [];

    for (const [key, value] of params) {
      queryParts.push(`${key}=${value}`);
    }

    return queryParts.join("&");
  } catch (e) {
    return "";
  }
}

function makeAbsoluteUrl(baseUrl, relativeUrl) {
  if (relativeUrl.startsWith("http")) {
    return relativeUrl;
  }

  const baseUrlObj = new URL(baseUrl);
  if (relativeUrl.startsWith("/")) {
    return `${baseUrlObj.protocol}//${baseUrlObj.host}${relativeUrl}`;
  } else {
    return `${baseUrlObj.protocol}//${baseUrlObj.host}/${relativeUrl}`;
  }
}

async function followRedirects(
  startUrl,
  maxRedirects = CONSTANTS.MAX_REDIRECTS,
) {
  let response = await httpGet(startUrl);
  let currentUrl = startUrl;
  let redirectCount = 0;

  while (
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    response.headers.location
  ) {
    redirectCount++;
    if (redirectCount > maxRedirects) {
      throw new Error("重定向次数过多");
    }

    const redirectUrl = response.headers.location;
    const fullRedirectUrl = makeAbsoluteUrl(currentUrl, redirectUrl);

    currentUrl = fullRedirectUrl;
    response = await httpGet(fullRedirectUrl);
  }

  return { response, redirectCount };
}

// ============================================
// Portal API 工具函数
// ============================================
async function fetchPageInfo(baseUrl, queryString) {
  const pageInfoUrl = `${baseUrl}${CONSTANTS.EPORTAL_PATH}pageInfo`;

  const params = new URLSearchParams();
  if (queryString) {
    params.append("queryString", encodeURIComponent(queryString));
  }

  return await httpPost(pageInfoUrl, params.toString());
}

module.exports = {
  CONSTANTS,
  httpRequest,
  httpPost,
  httpGet,
  extractQueryString,
  makeAbsoluteUrl,
  followRedirects,
  fetchPageInfo,
};
