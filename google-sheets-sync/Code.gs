// ─────────────────────────────────────────────────────────────────────────────
// FABS × ProFace — Supabase → Google Sheets sync
//
// HOW TO USE (3 steps):
//   1. In your Google Sheet: Extensions → Apps Script
//   2. Replace everything with this file, click Save (💾)
//   3. Click Run → syncAll  (first run asks for permissions — allow them)
//   4. Set auto-refresh: Triggers (⏰) → Add Trigger → syncAll → Hour timer
// ─────────────────────────────────────────────────────────────────────────────

var SUPABASE_URL = "https://mhjtoliyyiazhegixxpq.supabase.co";
var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oanRvbGl5eWlhemhlZ2l4eHBxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTc5NTA1MywiZXhwIjoyMDk1MzcxMDUzfQ.XY9x6kN3hgwq9pBcu0iybiotEciOeCCMxhUsvLVa1gQ";

var SHEET_CLIENTS  = "proface_clients";
var SHEET_ANALYSES = "proface_analyses";
var SHEET_LOG      = "proface_sync_log";

// ── Main entry point ─────────────────────────────────────────────────────────
function syncAll() {
  var startTime = new Date();
  try {
    syncClients();
    syncAnalyses();
    writeLog("✅ OK", startTime);
  } catch (e) {
    writeLog("❌ " + e.message, startTime);
    throw e;
  }
}

// ── Clients sheet — profiles table ───────────────────────────────────────────
function syncClients() {
  var data = supabase("/rest/v1/profiles?select=email,phone,subscription_status,created_at&order=created_at.desc");

  var sheet = getOrCreateSheet(SHEET_CLIENTS);
  sheet.clearContents();
  sheet.clearFormats();

  sheet.appendRow(["Email", "Phone", "Subscription", "Registered (UTC)"]);
  styleHeader(sheet);

  data.forEach(function(row) {
    sheet.appendRow([
      row.email || "",
      row.phone || "",
      row.subscription_status || "pending",
      fmt(row.created_at)
    ]);
  });

  // Green = pro, yellow = pending
  for (var i = 2; i <= data.length + 1; i++) {
    var cell = sheet.getRange(i, 3);
    var val = sheet.getRange(i, 3).getValue();
    cell.setBackground(val === "pro" ? "#d4edda" : "#fff3cd");
    cell.setFontColor(val === "pro" ? "#155724" : "#856404");
    cell.setFontWeight("bold");
  }

  for (var c = 1; c <= 4; c++) sheet.autoResizeColumn(c);
  stamp(sheet, data.length + " clients");
}

// ── Analyses sheet — face_analyses table ─────────────────────────────────────
function syncAnalyses() {
  var data = supabase("/rest/v1/face_analyses?select=id,user_id,created_at,analysis_result&order=created_at.desc&limit=500");

  var sheet = getOrCreateSheet(SHEET_ANALYSES);
  sheet.clearContents();
  sheet.clearFormats();

  sheet.appendRow(["Analysis ID", "User ID", "Date (UTC)", "Face Shape", "Skin Tone", "Has Recs"]);
  styleHeader(sheet);

  data.forEach(function(row) {
    var r = row.analysis_result || {};
    sheet.appendRow([
      row.id || "",
      row.user_id || "",
      fmt(row.created_at),
      r.faceShape || r.face_shape || "",
      r.skinTone  || r.skin_tone  || "",
      r.recommendations ? "Yes" : "No"
    ]);
  });

  for (var c = 1; c <= 6; c++) sheet.autoResizeColumn(c);
  stamp(sheet, data.length + " analyses");
}

// ── Supabase REST helper ──────────────────────────────────────────────────────
function supabase(path) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + path, {
    method: "GET",
    headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("HTTP " + res.getResponseCode() + ": " + res.getContentText().substring(0, 300));
  }
  return JSON.parse(res.getContentText());
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function styleHeader(sheet) {
  var r = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  r.setBackground("#1a1a2e");
  r.setFontColor("#ffffff");
  r.setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function stamp(sheet, text) {
  sheet.getRange(sheet.getLastRow() + 2, 1)
       .setValue("Synced: " + new Date().toUTCString() + " — " + text);
}

function writeLog(msg, startTime) {
  var sheet = getOrCreateSheet(SHEET_LOG);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp (UTC)", "Duration (s)", "Status"]);
    styleHeader(sheet);
  }
  var secs = ((new Date() - startTime) / 1000).toFixed(1);
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 3).setValues([[new Date().toUTCString(), secs, msg]]);
}

function fmt(iso) {
  if (!iso) return "";
  return iso.replace("T", " ").replace(/\.\d{3,}[Z+].*$/, " UTC");
}
