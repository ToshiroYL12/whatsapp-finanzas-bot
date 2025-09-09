import { driveClient } from "./googleAuth.js";
import { getSubscriber } from "./sheets.js";

export const ensureUserSheet = async (subscriber) => {
  if (!subscriber) return;
  if (subscriber.sheet_id) return subscriber; // ya existe

  const templateId = process.env.USER_TEMPLATE_SHEET_ID;
  if (!templateId) throw new Error("USER_TEMPLATE_SHEET_ID no configurado");

  const drive = await driveClient();
  const res = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: `Finanzas – ${subscriber.telefono}` },
    supportsAllDrives: true
  });
  const newId = res.data.id;

  // Actualiza los campos en memoria (si quieres, también escribe en Lista Central aquí)
  subscriber.sheet_id = newId;
  subscriber.sheet_url = `https://docs.google.com/spreadsheets/d/${newId}/edit`;
  return subscriber;
};

export const shareUserSheet = async (subscriber) => {
  if (!subscriber?.sheet_id || !subscriber?.email) return;
  const drive = await driveClient();
  await drive.permissions.create({
    fileId: subscriber.sheet_id,
    requestBody: { role: "reader", type: "user", emailAddress: subscriber.email },
    sendNotificationEmail: false,
    supportsAllDrives: true
  });
};
