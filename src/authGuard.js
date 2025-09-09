import { isAdmin } from "./utils.js";
import { getSubscriber } from "./sheets.js";

/** Verifica si el teléfono está autorizado en la lista central. */
export const isAuthorized = async (phone) => {

  if (isAdmin(phone)) return true;
  const adminSheetId = process.env.ADMIN_SHEET_ID;
  if (!adminSheetId) {
    console.warn("[AuthGuard] ADMIN_SHEET_ID no configurado. Solo admin podrá usar el bot.");
    return false;
  }
  const sub = await getSubscriber(phone);
  return !!(sub && (sub.autorizado === true || sub.autorizado === "TRUE" || sub.autorizado === "1"));
};
