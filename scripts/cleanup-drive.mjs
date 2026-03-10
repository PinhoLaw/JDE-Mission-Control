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
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  // Check quota
  const about = await drive.about.get({ fields: "storageQuota" });
  const q = about.data.storageQuota;
  console.log("Storage quota:");
  console.log(`  Used: ${(Number(q.usage) / 1e9).toFixed(2)} GB`);
  console.log(`  Limit: ${(Number(q.limit) / 1e9).toFixed(2)} GB`);
  console.log(`  Trash: ${(Number(q.usageInDriveTrash) / 1e9).toFixed(2)} GB`);

  // List all files
  console.log("\nFiles in service account Drive:");
  let pageToken;
  let totalFiles = 0;
  do {
    const res = await drive.files.list({
      pageSize: 100,
      fields: "nextPageToken, files(id, name, size, mimeType, createdTime)",
      pageToken,
    });
    for (const f of res.data.files || []) {
      totalFiles++;
      const sizeMB = f.size ? (Number(f.size) / 1e6).toFixed(1) : "?";
      console.log(`  ${sizeMB}MB  ${f.name}  (${f.mimeType})  ${f.createdTime}`);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  console.log(`\nTotal files: ${totalFiles}`);

  // Empty trash
  console.log("\nEmptying trash...");
  try {
    await drive.files.emptyTrash();
    console.log("Trash emptied!");
  } catch (e) {
    console.log("Trash empty failed:", e.message);
  }

  // Re-check quota
  const about2 = await drive.about.get({ fields: "storageQuota" });
  const q2 = about2.data.storageQuota;
  console.log(`\nAfter cleanup: ${(Number(q2.usage) / 1e9).toFixed(2)} GB used`);
}

main().catch(e => console.error("Error:", e.message));
