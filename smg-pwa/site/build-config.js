/**
 * build-config.js
 * Netlify build script:
 * - baca config.template.js
 * - inject ENV: GAS_API_URL dan API_KEY
 * - tulis menjadi site/config.js
 */
const fs = require("fs");
const path = require("path");

function requiredEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing Netlify environment variable: ${name}`);
  }
  return String(v).trim();
}

function main() {
  const tplPath = path.join(__dirname, "config.template.js");
  const outPath = path.join(__dirname, "config.js");

  const tpl = fs.readFileSync(tplPath, "utf8");

  const gasUrl = requiredEnv("GAS_API_URL");
  const apiKey = requiredEnv("API_KEY");

  const out = tpl
    .replaceAll("__GAS_API_URL__", gasUrl)
    .replaceAll("__API_KEY__", apiKey);

  fs.writeFileSync(outPath, out, "utf8");
  console.log("✅ config.js generated:", outPath);
}

main();
