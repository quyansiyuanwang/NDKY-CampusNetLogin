#!/usr/bin/env node
// ============================================
// QueryString 自动获取工具
// ============================================
// 访问登录页面并自动提取 queryString 参数

const {
  CONSTANTS,
  httpPost,
  httpGet,
  extractQueryString,
  followRedirects,
  fetchPageInfo,
} = require("./utils");

// 配置
const LOGIN_PAGE_URL = "http://10.88.108.101";

console.log(
  "\n╔════════════════════════════════════════════════════════════════╗",
);
console.log(
  "║              QueryString 自动获取工具                          ║",
);
console.log(
  "╚════════════════════════════════════════════════════════════════╝\n",
);

// 从 HTML 中提取隐藏字段和 JavaScript 重定向
async function extractHiddenFields(html, baseUrl) {
  const fields = {};

  // 从 JavaScript 重定向中提取 URL
  const jsRedirectMatch = html.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (jsRedirectMatch) {
    const redirectUrl = jsRedirectMatch[1];
    console.log("   发现 JavaScript 重定向:", redirectUrl);

    fields.queryString = extractQueryString(redirectUrl);
    if (fields.queryString) {
      fields.redirectUrl = redirectUrl;
    }
  }

  // 调用 pageInfo API 获取 RSA 公钥
  console.log("   正在调用 pageInfo API...");
  try {
    const pageInfoResult = await fetchPageInfo(baseUrl, fields.queryString);

    if (pageInfoResult.publicKeyModulus) {
      fields.publicKeyModulus = pageInfoResult.publicKeyModulus;
      console.log("   ✓ 从 pageInfo API 获取到 publicKeyModulus");
    }

    if (pageInfoResult.publicKeyExponent) {
      fields.publicKeyExponent = pageInfoResult.publicKeyExponent;
      console.log("   ✓ 从 pageInfo API 获取到 publicKeyExponent");
    }
  } catch (e) {
    console.log("   ⚠️  调用 pageInfo API 失败:", e.message);
  }

  return fields;
}

// 主函数
async function main() {
  try {
    console.log("🌐 正在访问登录页面...");
    console.log(`   URL: ${LOGIN_PAGE_URL}\n`);

    // 跟随所有重定向
    const { response, redirectCount } = await followRedirects(LOGIN_PAGE_URL);
    console.log(`📡 响应状态: ${response.statusCode}`);
    console.log(`✅ 完成所有重定向 (共 ${redirectCount} 次)\n`);

    // 从 HTML 中提取隐藏字段和 JavaScript 重定向
    console.log("🔍 正在分析页面内容...\n");
    const hiddenFields = await extractHiddenFields(
      response.body,
      LOGIN_PAGE_URL,
    );

    // 如果发现 JavaScript 重定向到登录页面，继续访问
    if (
      hiddenFields.redirectUrl &&
      hiddenFields.redirectUrl.includes("index.jsp")
    ) {
      console.log("🔄 发现登录页面重定向，继续访问...");
      console.log(`   URL: ${hiddenFields.redirectUrl}\n`);

      const loginPageResponse = await httpGet(hiddenFields.redirectUrl);
      console.log(`📡 响应状态: ${loginPageResponse.statusCode}\n`);

      // 重新提取隐藏字段
      const loginPageFields = await extractHiddenFields(
        loginPageResponse.body,
        LOGIN_PAGE_URL,
      );
      // 合并字段，保留 queryString
      Object.assign(hiddenFields, loginPageFields);
    }

    if (Object.keys(hiddenFields).length > 0) {
      console.log("✅ 提取到以下配置信息:\n");
      console.log("═".repeat(64));

      if (hiddenFields.queryString) {
        console.log("\n【queryString】");
        console.log(hiddenFields.queryString);

        // 解析参数
        const params = new URLSearchParams(hiddenFields.queryString);
        console.log("\n参数详情:");
        for (const [key, value] of params) {
          console.log(`   ${key}: ${value}`);
        }
      }

      if (hiddenFields.publicKeyModulus) {
        console.log("\n【publicKeyModulus (RSA 公钥模数)】");
        console.log(hiddenFields.publicKeyModulus.substring(0, 100) + "...");
        console.log(`(长度: ${hiddenFields.publicKeyModulus.length} 字符)`);
      }

      if (hiddenFields.publicKeyExponent) {
        console.log("\n【publicKeyExponent (RSA 公钥指数)】");
        console.log(hiddenFields.publicKeyExponent);
      }

      console.log("\n" + "═".repeat(64));
      console.log("");

      // 生成配置代码
      console.log("📝 可以直接复制以下配置到 login.js:\n");
      console.log("─".repeat(64));
      console.log("const CONFIG = {");
      console.log("    username: '',  // 填入你的用户名");
      console.log("    password: '',  // 填入你的密码");
      console.log("    baseUrl: 'http://10.88.108.101',");
      if (hiddenFields.queryString) {
        console.log(`    queryString: '${hiddenFields.queryString}',`);
      }
      if (hiddenFields.publicKeyModulus) {
        console.log(
          `    publicKeyModulus: '${hiddenFields.publicKeyModulus}',`,
        );
      }
      if (hiddenFields.publicKeyExponent) {
        console.log(
          `    publicKeyExponent: '${hiddenFields.publicKeyExponent}',`,
        );
      }
      console.log("    service: '',");
      console.log("    passwordEncrypt: 'true',");
      console.log("    debug: true");
      console.log("};");
      console.log("─".repeat(64));
      console.log("");
    } else {
      console.log("⚠️  未能从页面中提取到配置信息");
      console.log("");
      console.log("💡 建议:");
      console.log("   1. 在浏览器中访问 http://10.88.108.101");
      console.log("   2. 按 F12 打开开发者工具");
      console.log("   3. 在 Console 中运行以下命令:");
      console.log("");
      console.log("      // 获取 queryString");
      console.log("      document.getElementById('queryString').value");
      console.log("");
      console.log("      // 获取 RSA 公钥");
      console.log("      document.getElementById('publicKeyModulus').value");
      console.log("");
    }
  } catch (error) {
    console.error("❌ 错误:", error.message);
    console.log("");
    console.log("💡 可能的原因:");
    console.log("   1. 网络连接问题");
    console.log("   2. 服务器地址不正确");
    console.log("   3. 需要先连接到校园网");
    console.log("");
    console.log("请检查网络连接后重试。");
    console.log("");
    process.exit(1);
  }
}

// 运行
console.log("提示: 此工具会自动访问登录页面并提取配置信息");
console.log("");

main().then(() => {
  console.log("✅ 完成!\n");
  process.exit(0);
});
