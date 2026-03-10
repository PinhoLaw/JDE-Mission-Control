import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const env = readFileSync(envPath, "utf8");

// Find the JSON value - it starts with { and ends with }
const startIdx = env.indexOf("GOOGLE_SERVICE_ACCOUNT_JSON=") + "GOOGLE_SERVICE_ACCOUNT_JSON=".length;
// Find the matching closing brace
let braceCount = 0;
let endIdx = startIdx;
for (let i = startIdx; i < env.length; i++) {
  if (env[i] === "{") braceCount++;
  if (env[i] === "}") braceCount--;
  if (braceCount === 0) {
    endIdx = i + 1;
    break;
  }
}

const jsonStr = env.slice(startIdx, endIdx);
console.log("JSON length:", jsonStr.length);

try {
  const creds = JSON.parse(jsonStr);
  console.log("PARSED OK");
  console.log("type:", creds.type);
  console.log("client_email:", creds.client_email);
  console.log("has private_key:", typeof creds.private_key === "string" && creds.private_key.length > 50);
} catch (e) {
  console.log("Parse error:", e.message);
  console.log("First 100:", jsonStr.slice(0, 100));
  console.log("Last 100:", jsonStr.slice(-100));
}
