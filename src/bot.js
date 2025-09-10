// src/bot.js
import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { handleAdminMessage } from './admin.js';
import { getSubscriber, appendMovimiento, setSubscriberFields, listUserCategories, addCategoryToUserSheet } from './sheets.js';
import { driveClient } from './googleAuth.js';
import { setupUserDashboard } from './sheets.js';
import { isAdmin } from './utils.js';

/** --------- Helpers --------- **/

// Normaliza a +51XXXXXXXXX (ajusta si usas otro país)
function normPhone(raw) {
  const digits = (raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 9) return '+51' + digits; // 9 dígitos locales → +51
  if (digits.length === 11 && digits.startsWith('51')) return '+' + digits;
  return digits;
}

// ¿Mensaje viene de grupo?
function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

// Fecha local Lima YYYY-MM-DD
function todayLima() {
  const fmt = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // "dd/mm/aaaa" → transformamos a aaaa-mm-dd
  const parts = fmt.formatToParts(new Date());
  const d = parts.find(p => p.type === 'day').value.padStart(2, '0');
  const m = parts.find(p => p.type === 'month').value.padStart(2, '0');
  const y = parts.find(p => p.type === 'year').value;
  return `${y}-${m}-${d}`;
}

// Genera ID simple y único por tiempo
function genId() {
  const now = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 1e6).toString(36);
  return `${now}${rnd}`.toUpperCase();
}

// Parseo de monto robusto: acepta "10,50" o "10.50" o "S/ 10,50"
function parseMonto(raw) {
  if (!raw) return NaN;
  // quitar símbolos y espacios
  let s = String(raw).replace(/[^\d,.\-]/g, '').trim();
  // Si hay ambas coma y punto, intentamos asumir coma = miles, punto = decimales
  if (s.includes(',') && s.includes('.')) {
    // quita separador de miles más probable (coma)
    if (s.indexOf(',') < s.indexOf('.')) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (s.includes(',')) {
    // solo coma → usar como decimal
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Email básico
function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

// Estado conversacional para onboarding de suscriptores
const userState = new Map(); // key: from (jid), value: { step: 'ASK_EMAIL'|'ASK_NAME'|'MENU'|'CAT'|'CAT_NEW'|'MONTO'|'CONFIRM', tipo, categorias, categoria, monto }

async function ensureUserSheetProvisioned(sub) {
  if (sub?.sheet_id) return sub;
  const templateId = process.env.USER_TEMPLATE_SHEET_ID;
  if (!templateId) throw new Error('USER_TEMPLATE_SHEET_ID no configurado');
  const drive = await driveClient();
  const displayName = (sub?.nombre ? String(sub.nombre) : '') || String(sub?.telefono || '').trim() || 'Usuario';
  const res = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: `Finanzas - ${displayName}` },
    supportsAllDrives: true,
  });
  const newId = res.data.id;
  const url = `https://docs.google.com/spreadsheets/d/${newId}/edit`;
  await setSubscriberFields(sub.telefono, { sheet_id: newId, sheet_url: url });
  sub.sheet_id = newId;
  sub.sheet_url = url;
  try {
    await setupUserDashboard(newId);
  } catch (e) {
    console.warn('[DASHBOARD INIT] No se pudo inicializar Dashboard:', e?.message);
  }
  // Compartir si hay email
  if (sub.email && isValidEmail(sub.email)) {
    await drive.permissions.create({
      fileId: newId,
      requestBody: { role: 'reader', type: 'user', emailAddress: sub.email },
      sendNotificationEmail: false,
      supportsAllDrives: true,
    });
  }
  return sub;
}

// Mensaje de ayuda para usuario
function ayudaUsuario() {
  return [
    '📒 *Registro rápido*',
    '',
    '• *gasto* <monto> [categoria] [detalle]',
    '  ej:  gasto 25.50 comida almuerzo',
    '',
    '• *ingreso* <monto> [categoria] [detalle]',
    '  ej:  ingreso 1200 sueldo septiembre',
    '',
    '_Formato flexible: acepta 10,50 o 10.50_',
  ].join('\n');
}

/** --------- App logic --------- **/

const client = new Client({
  // Permite cambiar la ruta de sesión con SESSION_DIR (ej. "/data/session")
  authStrategy: new LocalAuth({ dataPath: process.env.SESSION_DIR || '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('⚠️ Escanea este QR para vincular WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp bot listo.');
});

client.on('auth_failure', (m) => {
  console.error('❌ Falla de autenticación:', m);
});

client.on('disconnected', (reason) => {
  console.warn('🔌 Desconectado:', reason);
});

client.on('message', async (message) => {
  try {
    const from = message.from || '';
    const body = (message.body || '').trim();

    // Ignorar grupos
    if (isGroupJid(from)) return;

    // Flujo ADMIN: solo si es el administrador
    if (isAdmin(from)) {
      await handleAdminMessage(message);
      return;
    }

    // Guard de autorización
    let sub = await getSubscriber(from);
    const autorizado = isAdmin(from) || (sub && String(sub.autorizado || '').toUpperCase() === 'TRUE');

    if (!autorizado) {
      // No responder a no autorizados (silencio absoluto)
      return;
    }

    // Onboarding suscriptor: pedir email, crear/compartir sheet, pedir nombre
    // 1) Email
    if (!sub?.email || !isValidEmail(sub.email)) {
      const st = userState.get(from) || { step: 'ASK_EMAIL' };
      if (st.step !== 'ASK_EMAIL' && /^.+@.+\..+$/i.test(body)) {
        // Si el usuario mandó un email sin estar en el paso, trátalo como email
        st.step = 'ASK_EMAIL';
      }
      if (st.step === 'ASK_EMAIL') {
        if (isValidEmail(body)) {
          await setSubscriberFields(from, { email: body.trim() });
          // Refrescar suscriptor en memoria
          sub = await getSubscriber(from);
          userState.set(from, { step: 'ASK_NAME' });
          await message.reply('Listo. Guardé tu correo. Ahora, ¿cómo quieres que te llame? (tu nombre)');
          // Intentar provisionar sheet ya con email
          try {
            await ensureUserSheetProvisioned(sub);
          } catch (e) {
            console.error('[PROVISION ERROR][email step]', e);
          }
          return;
        } else {
          userState.set(from, { step: 'ASK_EMAIL' });
          await message.reply('Para empezar, envía tu correo electrónico (ej: nombre@dominio.com)');
          return;
        }
      }
    }

    // 2) Sheet provisioning si falta
    if (!sub?.sheet_id) {
      try {
        await ensureUserSheetProvisioned(sub);
        // Refrescar suscriptor en memoria
        sub = await getSubscriber(from);
        await message.reply(`He creado tu Excel y lo compartí contigo. Accede aquí: ${sub.sheet_url}`);
      } catch (e) {
        console.error('[PROVISION ERROR]', e);
        await message.reply('No pude crear/compartir tu Excel. Informa al administrador.');
        return;
      }
    }

    // 3) Nombre si falta
    if (!sub?.nombre || !String(sub.nombre).trim()) {
      const st = userState.get(from) || { step: 'ASK_NAME' };
      if (st.step === 'ASK_NAME') {
        if (body.length >= 2 && !/^(gasto|ingreso)\b/i.test(body)) {
          const nombre = body.trim().slice(0, 60);
          await setSubscriberFields(from, { nombre });
          sub = await getSubscriber(from);
          userState.delete(from);
          await message.reply(`Perfecto, ${nombre}. Ya estás listo.`);
          // Continúa al flujo normal tras nombrar
        } else {
          userState.set(from, { step: 'ASK_NAME' });
          await message.reply('¿Cómo quieres que te llame? (envía tu nombre)');
          return;
        }
      } else {
        userState.set(from, { step: 'ASK_NAME' });
        await message.reply('¿Cómo quieres que te llame? (envía tu nombre)');
        return;
      }
    }

    // A partir de aquí, el usuario ya está listo para registrar movimientos
    // Menú guiado: 1) Ingreso 2) Gasto -> Categoría -> Monto -> Confirmación

    // Atajos globales de navegación
    if (/^(0|menu)$/i.test(body)) {
      userState.set(from, { step: 'MENU' });
      await message.reply(['¿Qué deseas registrar?', '1) Ingreso', '2) Gasto'].join('\n'));
      return;
    }

    const st = userState.get(from) || { step: 'MENU' };
    if (st.step === 'MENU') {
      if (body === '1' || body === '2') {
        st.tipo = body === '1' ? 'INGRESO' : 'GASTO';
        // cargar categorías desde hoja del usuario
        const cats = await listUserCategories(sub.sheet_id, st.tipo);
        st.categorias = cats;
        st.step = 'CAT';
        userState.set(from, st);
        await message.reply([
          `Selecciona categoría para ${st.tipo}:`,
          ...cats.map((c, i) => `${i + 1}) ${c}`),
          '99) Agregar nueva categoría',
          '',
          '0) Menú'
        ].join('\n'));
        return;
      }
      // Mostrar menú si no opción válida
      userState.set(from, { step: 'MENU' });
      await message.reply(['¿Qué deseas registrar?', '1) Ingreso', '2) Gasto'].join('\n'));
      return;
    }

    if (st.step === 'CAT') {
      if (body === '99') {
        st.step = 'CAT_NEW';
        userState.set(from, st);
        await message.reply(`Escribe el nombre de la nueva categoría para ${st.tipo}:
0) Menú`);
        return;
      }
      const idx = Number(body) - 1;
      if (Number.isInteger(idx) && idx >= 0 && st.categorias && idx < st.categorias.length) {
        st.categoria = st.categorias[idx];
        st.step = 'MONTO';
        userState.set(from, st);
        await message.reply('Ingresa el monto (ej: 120, 120.50):\n0) Menú');
        return;
      }
      await message.reply('Elige una opción válida de la lista o 0 para volver al menú.');
      return;
    }

    if (st.step === 'CAT_NEW') {
      const nombre = body.trim().slice(0, 60);
      if (!nombre) {
        await message.reply('Nombre inválido. Envía un nombre para la categoría o 0 para menú.');
        return;
      }
      try {
        await addCategoryToUserSheet(sub.sheet_id, st.tipo, nombre);
        st.categoria = nombre;
        st.step = 'MONTO';
        userState.set(from, st);
        await message.reply(`Categoría '${nombre}' lista. Ingresa el monto (ej: 120, 120.50):\n0) Menú`);
      } catch (e) {
        console.error('[CAT_NEW ERROR]', e);
        await message.reply('No pude agregar la categoría. Intenta de nuevo o usa 0 para volver al menú.');
      }
      return;
    }

    if (st.step === 'MONTO') {
      const m = parseMonto(body);
      if (!Number.isFinite(m)) {
        await message.reply('Monto inválido. Intenta de nuevo (ej: 120, 120.50).\n0) Menú');
        return;
      }
      st.monto = st.tipo === 'GASTO' ? -Math.abs(m) : Math.abs(m);
      st.step = 'CONFIRM';
      userState.set(from, st);
      await message.reply([
        'Vas a registrar:',
        `• Tipo: ${st.tipo}`,
        `• Categoría: ${st.categoria}`,
        `• Monto: ${st.monto}`,
        '',
        '¿Confirmas? 1) Sí, 2) No'
      ].join('\n'));
      return;
    }

    if (st.step === 'CONFIRM') {
      if (body === '1') {
        const movimiento = {
          id: genId(),
          fecha: todayLima(),
          tipo: st.tipo,
          categoria: st.categoria,
          monto: st.monto,
          detalle: '',
        };
        try {
          await appendMovimiento(sub.sheet_id, movimiento);
          await message.reply(['✅ Registrado', `• Tipo: ${movimiento.tipo}`, `• Monto: ${movimiento.monto}`, `• Categoría: ${movimiento.categoria}`, `• Fecha: ${movimiento.fecha}`, `• ID: ${movimiento.id}`, '', '0) Menú'].join('\n'));
        } catch (e) {
          console.error('[APPEND ERROR]', e);
          await message.reply('⚠️ No se pudo registrar el movimiento. Informa al administrador.');
        }
        userState.set(from, { step: 'MENU' });
        return;
      }
      // No/Cancelar
      userState.set(from, { step: 'MENU' });
      await message.reply('Cancelado. Volviendo al menú...\n1) Ingreso\n2) Gasto');
      return;
    }

    // Comandos de usuario: gasto / ingreso
    if (/^(gasto|ingreso)\b/i.test(body)) {
      const parts = body.split(/\s+/);
      const tipo = parts.shift().toLowerCase(); // 'gasto' o 'ingreso'

      // Esperado: <monto> [categoria] [detalle...]
      const rawMonto = parts.shift();
      const monto = parseMonto(rawMonto);

      if (!Number.isFinite(monto)) {
        await message.reply('⚠️ Debes indicar un *monto* válido.\nEj: *gasto 25.50 comida almuerzo*\n\n' + ayudaUsuario());
        return;
      }

      const categoria = parts.shift() || (tipo === 'gasto' ? 'Gasto' : 'Ingreso');
      const detalle = parts.length ? parts.join(' ') : '';

      // Si es gasto, monto negativo; si es ingreso, positivo
      const montoSign = tipo === 'gasto' ? -Math.abs(monto) : Math.abs(monto);

      // Obtener sheet del usuario desde Suscriptores
      const userSheetId = sub?.sheet_id;
      if (!userSheetId) {
        await message.reply('⚠️ No encuentro tu *sheet_id* en Suscriptores. Pide al admin provisionarte (copiar plantilla).');
        return;
      }

      const movimiento = {
        id: genId(),
        fecha: todayLima(),
        tipo: tipo.toUpperCase(),     // GASTO / INGRESO
        categoria,
        monto: montoSign,
        detalle,
      };

      try {
        await appendMovimiento(userSheetId, movimiento);
        await message.reply(
          [
            '✅ *Registrado*',
            `• Tipo: ${movimiento.tipo}`,
            `• Monto: ${montoSign}`,
            `• Categoría: ${categoria}`,
            `• Detalle: ${detalle || '—'}`,
            `• Fecha: ${movimiento.fecha}`,
            `• ID: ${movimiento.id}`,
          ].join('\n')
        );
      } catch (e) {
        console.error('[APPEND ERROR]', e);
        await message.reply('❌ No se pudo guardar en *Movimientos*. Revisa tu acceso a la hoja y comenta al admin.');
      }
      return;
    }

    // Si no coincide con nada, muestra ayuda
    if (body.length) {
      await message.reply(ayudaUsuario());
    }
  } catch (err) {
    console.error('[BOT ERROR]', err);
    try {
      await message.reply('⚠️ Ocurrió un error inesperado procesando tu mensaje.');
    } catch {}
  }
});

client.initialize();

/** Graceful shutdown en Ctrl+C */
process.on('SIGINT', async () => {
  try {
    console.log('\n👋 Cerrando sesión de WhatsApp…');
    await client.destroy();
  } catch {}
  process.exit(0);
});
