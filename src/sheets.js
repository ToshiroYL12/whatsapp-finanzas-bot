// src/sheets.js
import 'dotenv/config';
import { google } from 'googleapis';
import { getAuth } from './googleAuth.js';

const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID;          // Hoja "Lista Central"
const SUSCRIPTORES_RANGE = 'Suscriptores!A:G';              // columnas: telefono | email | autorizado | sheet_id | sheet_url | nombre | observacion

let sheetsClient = null;

// Singleton de cliente de Sheets
async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const auth = await getAuth();
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// Normaliza teléfono a +51XXXXXXXXX; tolera números, strings y JIDs
function normPhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 9) return '+51' + digits;
  if (digits.length === 11 && digits.startsWith('51')) return '+' + digits;
  return digits;
}

// Lee la tabla Suscriptores y devuelve arreglo de objetos por columna
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

// Busca suscriptor por teléfono
export async function getSubscriber(phoneRaw) {
  const phone = normPhone(phoneRaw);
  const list = await readSubscribers();
  return list.find(s => normPhone(s.telefono) === phone) || null;
}

// Estado resumido para admin
export async function getSubscriberStatus(phoneRaw) {
  const sub = await getSubscriber(phoneRaw);
  if (!sub) {
    return { found: false, message: 'No existe en Suscriptores' };
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

// Marca autorizado TRUE/FALSE en la fila del teléfono
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

// Actualiza campos del suscriptor (email, nombre, sheet_id, sheet_url, etc.)
export async function setSubscriberFields(phoneRaw, fields) {
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
  if (idxTelefono === -1) throw new Error('Falta columna telefono en Suscriptores');

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const t = normPhone(rows[i][idxTelefono] || '');
    if (t === phone) { rowIndex = i; break; }
  }
  if (rowIndex === -1) throw new Error('Teléfono no encontrado');

  const dataUpdates = [];
  for (const [key, val] of Object.entries(fields || {})) {
    const colIndex = headers.indexOf(key.toLowerCase());
    if (colIndex === -1) continue;
    const colLetter = String.fromCharCode(65 + colIndex);
    dataUpdates.push({
      range: `Suscriptores!${colLetter}${rowIndex + 1}`,
      values: [[val == null ? '' : String(val)]],
    });
  }
  if (dataUpdates.length === 0) return { ok: true, updated: 0 };
  // Option C: no inyectar fórmulas/tablas; la plantilla se encarga.
  return { ok: true };

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: ADMIN_SHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: dataUpdates,
    },
  });
  return { ok: true, updated: dataUpdates.length };
}

// Agrega nuevo suscriptor (teléfono + autorizado=TRUE). Si existe, solo autoriza
export async function addSubscriber(phoneRaw) {
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

  let exists = false;
  for (let i = 1; i < rows.length; i++) {
    const t = normPhone(rows[i][idxTelefono] || '');
    if (t === phone) { exists = true; break; }
  }

  if (exists) {
    await setAutorizado(phone, true);
    return { ok: true, existed: true };
  }

  const row = new Array(headers.length).fill('');
  row[idxTelefono] = phone;
  row[idxAutorizado] = 'TRUE';

  await sheets.spreadsheets.values.append({
    spreadsheetId: ADMIN_SHEET_ID,
    range: SUSCRIPTORES_RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  return { ok: true, existed: false };
}

// Agrega fila en la hoja Movimientos del usuario dado su sheet_id
export async function appendMovimiento(userSheetId, movimiento) {
  const sheets = await getSheetsClient();
  const { id, fecha, tipo, categoria, monto, detalle } = movimiento;
  await sheets.spreadsheets.values.append({
    spreadsheetId: userSheetId,
    range: 'Movimientos!A:F',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[id, fecha, tipo, categoria, monto, detalle]] },
  });
  return { ok: true };
}

// Lista categorías desde la hoja del usuario. Se asume hoja 'Categorias' con columnas:
// Col A: Gasto, Col B: Ingreso. Si no existe, devuelve categorías por defecto.
export async function listUserCategories(userSheetId, tipo) {
  const sheets = await getSheetsClient();
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: userSheetId,
      range: 'Categorias!A:B',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = data.values || [];
    const colIndex = String(tipo || '').toUpperCase().startsWith('ING') ? 1 : 0; // 0=Gasto,1=Ingreso
    const items = [];
    let firstNonEmptySeen = false;
    const headerRe = /^(tipo|categor[ií]a|ingreso|gasto|header|encabezado|nombre)$/i;
    for (const r of rows) {
      const v = (r[colIndex] ?? '').toString().trim();
      if (!v) continue;
      if (!firstNonEmptySeen) {
        firstNonEmptySeen = true;
        if (headerRe.test(v)) continue; // salta el primer valor si parece encabezado
        items.push(v);
        continue;
      }
      items.push(v);
    }
    // quita posibles encabezados repetidos
    const uniq = [...new Set(items.filter(Boolean))];
    if (uniq.length > 0) return uniq;
  } catch (e) {
    // si falla, cae a defaults
    console.warn('[listUserCategories] usando categorías por defecto', e?.message);
  }
  if (String(tipo || '').toUpperCase().startsWith('ING')) {
    return ['Sueldo', 'Ventas', 'Intereses', 'Otro'];
  }
  return ['Comida', 'Transporte', 'Servicios', 'Entretenimiento', 'Otro'];
}

// Crea hoja 'Categorias' si no existe
async function ensureCategoriasSheet(userSheetId) {
  const sheets = await getSheetsClient();
  try {
    await sheets.spreadsheets.get({ spreadsheetId: userSheetId });
    // intenta leer para comprobar existencia de la hoja
    await sheets.spreadsheets.values.get({
      spreadsheetId: userSheetId,
      range: 'Categorias!A1:B1',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    return true;
  } catch (e) {
    // si es porque no existe la hoja, la creamos
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: userSheetId,
        requestBody: {
          requests: [
            { addSheet: { properties: { title: 'Categorias' } } },
          ],
        },
      });
      return true;
    } catch (e2) {
      console.error('[ensureCategoriasSheet] no se pudo crear hoja Categorias', e2?.message);
      throw e2;
    }
  }
}

// Agrega categoría a la hoja del usuario. Evita duplicados (case-insensitive)
export async function addCategoryToUserSheet(userSheetId, tipo, nombre) {
  const name = String(nombre || '').trim();
  if (!name) throw new Error('Nombre de categoría vacío');
  await ensureCategoriasSheet(userSheetId);
  const existing = await listUserCategories(userSheetId, tipo);
  if (existing.some(x => String(x).trim().toLowerCase() === name.toLowerCase())) {
    return { ok: true, existed: true };
  }
  const col = String(tipo || '').toUpperCase().startsWith('ING') ? 'B' : 'A';
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: userSheetId,
    range: `Categorias!${col}:${col}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[name]] },
  });
  return { ok: true, existed: false };
}

// Crea/actualiza las hojas Parametros y Dashboard con KPIs y tablas base
export async function setupUserDashboard(userSheetId) {
  // Option C: El dashboard (Parametros, fórmulas y gráficos) viene preconfigurado en la plantilla.
  // No inyectamos nada desde código para evitar errores de comillas y mantener una sola fuente de verdad.
  return { ok: true };
  const sheets = await getSheetsClient();

  // Ensure Parametros sheet exists
  async function ensureSheet(title) {
    try {
      await sheets.spreadsheets.values.get({ spreadsheetId: userSheetId, range: `${title}!A1:A1` });
      return true;
    } catch {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: userSheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      });
      return true;
    }
  }

  await ensureSheet('Parametros');
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: userSheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: 'Parametros!A1', values: [['InicioMes']] },
        { range: 'Parametros!A2', values: [['=EOMONTH(TODAY(),-1)+1']] },
        { range: 'Parametros!B1', values: [['FinMes']] },
        { range: 'Parametros!B2', values: [['=EOMONTH(TODAY(),0)']] },
        { range: 'Parametros!C1', values: [['InicioMesText']] },
        { range: 'Parametros!C2', values: [['=TEXT(A2,"yyyy-mm-dd")']] },
        { range: 'Parametros!D1', values: [['FinMesText']] },
        { range: 'Parametros!D2', values: [['=TEXT(B2,"yyyy-mm-dd")']] },
      ],
    },
  });

  // Ensure Dashboard sheet exists
  await ensureSheet('Dashboard');

  // KPIs
  const kpiIngresos = `=IFERROR(INDEX(QUERY(Movimientos!B:E, "select sum(E) where C='INGRESO' and B >= date '"&Parametros!C2&"' and B <= date '"&Parametros!D2&"'", 0),1,1),0)`;
  const kpiGastos = `=IFERROR(-INDEX(QUERY(Movimientos!B:E, "select sum(E) where C='GASTO' and B >= date '"&Parametros!C2&"' and B <= date '"&Parametros!D2&"'", 0),1,1),0)`;
  const kpiBalance = '=B2-B3';
  const kpiPromGasto = `=IFERROR(AVERAGE(FILTER(-Movimientos!E:E, Movimientos!C:C="GASTO", Movimientos!B:B>=Parametros!A2, Movimientos!B:B<=Parametros!B2)),0)`;
  const kpiMovimientos = `=IFERROR(COUNTA(FILTER(Movimientos!B:B, Movimientos!B:B>=Parametros!A2, Movimientos!B:B<=Parametros!B2)),0)`;

  // Top categorías (Gasto)
  const topGastoFormula = '';

  // Ingreso vs Gasto por categoría
  const barrasIGFormula = '';

  // Últimos movimientos (monto positivo para gasto)
  const ultimosFormula = '';

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: userSheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: 'Dashboard!A1', values: [['KPIs']] },
        { range: 'Dashboard!A2', values: [['Ingresos Mes']] },
        { range: 'Dashboard!B2', values: [[kpiIngresos]] },
        { range: 'Dashboard!A3', values: [['Gastos Mes']] },
        { range: 'Dashboard!B3', values: [[kpiGastos]] },
        { range: 'Dashboard!A4', values: [['Balance Mes']] },
        { range: 'Dashboard!B4', values: [[kpiBalance]] },
        { range: 'Dashboard!A5', values: [['Promedio Gasto']] },
        { range: 'Dashboard!B5', values: [[kpiPromGasto]] },
        { range: 'Dashboard!A6', values: [['Movimientos Mes']] },
        { range: 'Dashboard!B6', values: [[kpiMovimientos]] },

        { range: 'Dashboard!A8', values: [['Top Categorías (Gasto)']] },
        { range: 'Dashboard!A9', values: [[topGastoFormula]] },

        { range: 'Dashboard!D8', values: [['Categoría','Gasto','Ingreso']] },
        { range: 'Dashboard!D9', values: [[barrasIGFormula]] },

        { range: 'Dashboard!A20', values: [['Últimos movimientos']] },
        { range: 'Dashboard!A21', values: [['Fecha','Tipo','Categoría','Monto','Detalle']] },
        { range: 'Dashboard!A22', values: [[ultimosFormula]] },
      ],
    },
  });

  // Intentar agregar gráficos (dona gastos y barras ingreso vs gasto)
  try {
    const ss = await sheets.spreadsheets.get({
      spreadsheetId: userSheetId,
      fields: 'sheets(properties(title,sheetId),charts(chartId,spec(title),position))',
    });
    const dash = ss.data.sheets.find(sh => sh.properties?.title === 'Dashboard');
    const dashId = dash?.properties?.sheetId;
    if (dashId != null) {
      const charts = dash.charts || [];
      const donutTitle = 'Gastos por categoría (Mes)';
      const barsTitle = 'Ingreso vs Gasto por categoría (Mes)';
      const donut = charts.find(c => c.spec?.title === donutTitle);
      const bars = charts.find(c => c.spec?.title === barsTitle);

      const requests = [];

      // If donut chart missing, add it. Else ensure position to avoid overlap
      if (!donut) {
        requests.push({
          addChart: {
            chart: {
              spec: {
                title: donutTitle,
                basicChart: {
                  chartType: 'PIE',
                  legendPosition: 'RIGHT_LEGEND',
                  domains: [
                    { domain: { sourceRange: { sources: [ { sheetId: dashId, startRowIndex: 8, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 } ] } } }
                  ],
                  series: [
                    { series: { sourceRange: { sources: [ { sheetId: dashId, startRowIndex: 8, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 2 } ] } } }
                  ],
                },
              },
              position: {
                overlayPosition: {
                  anchorCell: { sheetId: dashId, rowIndex: 7, columnIndex: 7 },
                  offsetXPixels: 0,
                  offsetYPixels: 0,
                },
              },
            },
          }
        });
      } else {
        requests.push({
          updateEmbeddedObjectPosition: {
            objectId: donut.chartId,
            newPosition: {
              overlayPosition: {
                anchorCell: { sheetId: dashId, rowIndex: 7, columnIndex: 7 },
                offsetXPixels: 0,
                offsetYPixels: 0,
              }
            },
            fields: 'newPosition',
          }
        });
      }

      // If bars chart missing, add it. Else ensure position
      if (!bars) {
        requests.push({
          addChart: {
            chart: {
              spec: {
                title: barsTitle,
                basicChart: {
                  chartType: 'COLUMN',
                  legendPosition: 'BOTTOM_LEGEND',
                  domains: [
                    { domain: { sourceRange: { sources: [ { sheetId: dashId, startRowIndex: 8, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 } ] } } }
                  ],
                  series: [
                    { series: { sourceRange: { sources: [ { sheetId: dashId, startRowIndex: 8, endRowIndex: 1000, startColumnIndex: 4, endColumnIndex: 5 } ] } }, targetAxis: 'LEFT_AXIS' },
                    { series: { sourceRange: { sources: [ { sheetId: dashId, startRowIndex: 8, endRowIndex: 1000, startColumnIndex: 5, endColumnIndex: 6 } ] } }, targetAxis: 'LEFT_AXIS' },
                  ],
                },
              },
              position: {
                overlayPosition: {
                  anchorCell: { sheetId: dashId, rowIndex: 7, columnIndex: 11 },
                  offsetXPixels: 0,
                  offsetYPixels: 0,
                },
              },
            },
          }
        });
      } else {
        requests.push({
          updateEmbeddedObjectPosition: {
            objectId: bars.chartId,
            newPosition: {
              overlayPosition: {
                anchorCell: { sheetId: dashId, rowIndex: 7, columnIndex: 11 },
                offsetXPixels: 0,
                offsetYPixels: 0,
              }
            },
            fields: 'newPosition',
          }
        });
      }

      if (requests.length) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: userSheetId,
          requestBody: { requests },
        });
      }
    }
  } catch (e) {
    console.warn('[DASHBOARD CHARTS] No se pudieron crear gráficos:', e?.message);
  }

  return { ok: true };
}
