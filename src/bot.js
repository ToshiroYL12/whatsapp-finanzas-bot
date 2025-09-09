// src/bot.js
import 'dotenv/config';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { handleAdminMessage } from './admin.js';
import { getSubscriber, appendMovimiento } from './sheets.js';

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
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
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

    // Flujo ADMIN
    if (/^admin\b/i.test(body)) {
      await handleAdminMessage(message);
      return;
    }

    // Guard de autorización
    const sub = await getSubscriber(from);
    const autorizado = sub && String(sub.autorizado || '').toUpperCase() === 'TRUE';

    if (!autorizado) {
      if (String(process.env.SILENT_FOR_UNAUTHORIZED || '').toUpperCase() === 'TRUE') {
        // No responder a no autorizados (silencio)
        return;
      } else {
        await message.reply('🚫 No estás autorizado. Contacta al administrador.');
        return;
      }
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
