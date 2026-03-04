/**
 * JDE Mission Control — Google Apps Script Web App
 * =================================================
 *
 * This script runs as YOUR Gmail account (mstopperich@gmail.com) and creates
 * Google Sheets in your personal Drive. No admin console or Workspace needed.
 *
 * SETUP:
 * 1. Go to https://script.google.com and create a new project
 * 2. Name it "JDE Mission Control - Sheet Creator"
 * 3. Paste this entire file into Code.gs (replace any existing code)
 * 4. Click Deploy → New deployment
 * 5. Type: "Web app"
 * 6. Execute as: "Me (mstopperich@gmail.com)"
 * 7. Who has access: "Anyone" (so your Next.js server can call it)
 * 8. Click Deploy and copy the URL
 * 9. Set that URL as GOOGLE_APPS_SCRIPT_URL in your .env.local
 *
 * The web app accepts POST requests with JSON body:
 *   { "action": "createSheet", "eventName": "Peoria Ford Dec 25" }
 *
 * And returns:
 *   { "success": true, "sheetId": "...", "sheetUrl": "..." }
 */

// ── Your master template sheet ID ──
var TEMPLATE_SHEET_ID = "1zb2XMU7YwsFmQyGEEd5wjSJNlAYRiVA5ZBvL-CXF2XA";

// ── Optional: folder ID to place new sheets in ──
// Leave empty string to create in root Drive
var DRIVE_FOLDER_ID = "";

/**
 * Handle POST requests from the Next.js server
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === "createSheet") {
      var result = createEventSheet(body.eventName);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: "Unknown action" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle GET requests (for testing in browser)
 */
function doGet(e) {
  var eventName = e.parameter.eventName;

  if (eventName) {
    var result = createEventSheet(eventName);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      status: "ok",
      message: "JDE Sheet Creator is running. POST with { action: 'createSheet', eventName: '...' }"
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Copy the master template and create a new event sheet
 */
function createEventSheet(eventName) {
  if (!eventName) {
    return { success: false, error: "eventName is required" };
  }

  var newTitle = eventName + " - JDE Mission Control";

  // 1. Copy the template
  var templateFile = DriveApp.getFileById(TEMPLATE_SHEET_ID);
  var newFile = templateFile.makeCopy(newTitle);

  // 2. Move to folder if configured
  if (DRIVE_FOLDER_ID) {
    var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    folder.addFile(newFile);
    DriveApp.getRootFolder().removeFile(newFile);
  }

  // 3. Set sharing — anyone with the link can edit
  newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);

  var sheetId = newFile.getId();
  var sheetUrl = "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit";

  Logger.log("Created sheet: " + newTitle + " → " + sheetUrl);

  return {
    success: true,
    sheetId: sheetId,
    sheetUrl: sheetUrl,
    title: newTitle
  };
}

/**
 * Test function — run this from the Apps Script editor to verify it works
 */
function testCreateSheet() {
  var result = createEventSheet("Test Event " + new Date().toLocaleDateString());
  Logger.log(JSON.stringify(result, null, 2));
}
