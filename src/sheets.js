// src/sheets.js
import 'dotenv/config';
import { google } from 'googleapis';
import { getAuth } from './googleAuth.js';

const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID;          // Hoja "Lista Central"
const SUSCRIPTORES_RANGE = 'Suscriptores!A:G';              // columnas: telefono | email | autorizado | sheet_id | sheet_url | nombre | observacion

let sheetsClient = null;

/** Crea/retorna un único cliente de Sheets (singleton) */
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const auth = await getAuth();
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/** Normaliza teléfono a formato +51XXXXXXXXX (ajusta a tu realidad si hace falta) */
function normPhone(raw) {
  const digits = (raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 9) return '+51' + digits; // ej: 9 dígitos locales → +51
  if (digits.length === 11 && digits.startsWith('51')) return '+' + digits;
  return digits;
}

/** Lee la tabla Suscriptores y devuelve arreglo de objetos por columna */
async function readSubscribers() {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SHEET_ID,
    range: SUSCRIPTORES_RANGE,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = data.values || [];
  if (rows.length === 0) return [];

  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}

/** Busca suscriptor por teléfono */
export async function getSubscriber(phoneRaw) {
  const phone = normPhone(phoneRaw);
  const list = await readSubscribers();
  return list.find(s => normPhone(s.telefono) === phone) || null;
}

/** Estado resumido para admin */
export async function getSubscriberStatus(phoneRaw) {
  const sub = await getSubscriber(phoneRaw);
  if (!sub) {
    return {
      found: false,
      message: 'No existe en Suscriptores',
    };
  }
  const autorizado = String(sub.autorizado || '').toUpperCase() === 'TRUE';
  return {
    found: true,
    autorizado,
    telefono: normPhone(sub.telefono),
    email: sub.email || '',
    sheet_id: sub.sheet_id || '',
    sheet_url: sub.sheet_url || '',
    nombre: sub.nombre || '',
  };
}

/** Marca autorizado TRUE/FALSE en la fila del teléfono */
export async function setAutorizado(phoneRaw, value) {
  const sheets = await getSheetsClient();
  const phone = normPhone(phoneRaw);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SHEET_ID,
    range: SUSCRIPTORES_RANGE,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = data.values || [];
  if (rows.length === 0) throw new Error('Suscriptores vacío');

  const headers = rows[0].map(h => String(h).trim().toLowerCase());
  const idxTelefono = headers.indexOf('telefono');
  const idxAutorizado = headers.indexOf('autorizado');
  if (idxTelefono === -1 || idxAutorizado === -1) {
    throw new Error('Faltan columnas "telefono" o "autorizado" en Suscriptores');
  }

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const t = normPhone(rows[i][idxTelefono] || '');
    if (t === phone) { rowIndex = i; break; }
  }
  if (rowIndex === -1) throw new Error('Teléfono no encontrado');

  const targetRange = `Suscriptores!${String.fromCharCode(65 + idxAutorizado)}${rowIndex + 1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: ADMIN_SHEET_ID,
    range: targetRange,
    valueInputOption: 'RAW',
    requestBody: { values: [[value ? 'TRUE' : 'FALSE']] },
  });

  return { ok: true };
}

/** Agrega fila en la hoja Movimientos del usuario dado su sheet_id */
export async function appendMovimiento(userSheetId, movimiento) {
  const sheets = await getSheetsClient();
  const { id, fecha, tipo, categoria, monto, detalle } = movimiento;
  await sheets.spreadsheets.values.append({
    spreadsheetId: userSheetId,
    range: 'Movimientos!A:F',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[id, fecha, tipo, categoria, monto, detalle]],
    },
  });
  return { ok: true };
}
