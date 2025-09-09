import { google } from "googleapis";
import { readFile } from "node:fs/promises";
import "dotenv/config";

async function main() {
  const tokens = JSON.parse(await readFile("token.json", "utf8"));

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  auth.setCredentials(tokens);

  // Drive
  const drive = google.drive({ version: "v3", auth });
  const about = await drive.about.get({ fields: "user" });
  console.log("Drive OK para:", about.data.user?.displayName);

  // Sheets
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: process.env.ADMIN_SHEET_ID,
  });
  console.log("Sheets OK. Título:", res.data.properties?.title);
}

main().catch(console.error);
