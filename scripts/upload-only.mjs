import { google } from "googleapis";
import { readFileSync, createReadStream } from "fs";
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
  let braceCount = 0, endIdx = jsonStart;
  for (let i = jsonStart; i < env.length; i++) {
    if (env[i] === "{") braceCount++;
    if (env[i] === "}") braceCount--;
    if (braceCount === 0) { endIdx = i + 1; break; }
  }
  return JSON.parse(env.slice(jsonStart, endIdx));
}

async function main() {
  const creds = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const drive = google.drive({ version: "v3", auth });

  const pptxPath = resolve(__dirname, "../JDE_Mission_Control_Dashboard_Guide.pptx");
  console.log("📤 Uploading .pptx → Google Slides...");

  const res = await drive.files.create({
    requestBody: {
      name: "JDE Mission Control — Dashboard Guide",
      mimeType: "application/vnd.google-apps.presentation",
    },
    media: {
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      body: createReadStream(pptxPath),
    },
    fields: "id,webViewLink",
  });

  const fileId = res.data.id;
  console.log(`✅ Uploaded! File ID: ${fileId}`);

  console.log("🔗 Setting sharing...");
  await drive.permissions.create({
    fileId,
    requestBody: { role: "writer", type: "anyone" },
  });

  const url = `https://docs.google.com/presentation/d/${fileId}/edit`;
  console.log("\n" + "═".repeat(70));
  console.log("🎉 Your Google Slides presentation:");
  console.log(`\n   ${url}\n`);
  console.log("═".repeat(70));
}

main().catch(e => {
  console.error("❌", e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
});
