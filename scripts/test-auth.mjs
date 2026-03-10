import { google } from "googleapis";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCredentials() {
  const envPath = resolve(__dirname, "../.env.local");
  const env = readFileSync(envPath, "utf8");
  const key = "GOOGLE_SERVICE_ACCOUNT_JSON=";
  const startIdx = env.indexOf(key);
  if (startIdx === -1) throw new Error("Not found");
  const jsonStart = startIdx + key.length;
  let braceCount = 0;
  let endIdx = jsonStart;
  for (let i = jsonStart; i < env.length; i++) {
    if (env[i] === "{") braceCount++;
    if (env[i] === "}") braceCount--;
    if (braceCount === 0) { endIdx = i + 1; break; }
  }
  return JSON.parse(env.slice(jsonStart, endIdx));
}

const creds = loadCredentials();
console.log("client_email:", creds.client_email);
console.log("private_key type:", typeof creds.private_key);
console.log("private_key starts with:", creds.private_key?.substring(0, 40));
console.log("private_key ends with:", creds.private_key?.slice(-40));
console.log("private_key length:", creds.private_key?.length);

// Try GoogleAuth instead of JWT
try {
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  const client = await auth.getClient();
  console.log("\nGoogleAuth SUCCESS - got client type:", client.constructor.name);
} catch (e) {
  console.log("\nGoogleAuth FAILED:", e.message);
}
