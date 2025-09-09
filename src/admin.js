// src/admin.js
import 'dotenv/config';
import { getSubscriberStatus, setAutorizado } from './sheets.js';

/** Normaliza teléfono a formato +51XXXXXXXXX (ajústalo a tu caso si es necesario) */
function normPhone(raw) {
  const digits = (raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 9) return '+51' + digits;               // 9 dígitos locales
  if (digits.length === 11 && digits.startsWith('51')) return '+' + digits; // 51XXXXXXXXX
  return digits;
}

function isAdminNumber(phone) {
  if (!process.env.ADMIN_PHONE) return false;
  return normPhone(phone) === normPhone(process.env.ADMIN_PHONE);
}

function adminMenu() {
  return [
    '🛠 *ADMIN*',
    '',
    'Comandos disponibles:',
    '• *admin* → muestra este menú',
    '• *admin estado <telefono>*',
    '• *admin autorizar <telefono>*',
    '• *admin desautorizar <telefono>*',
    '',
    'Ejemplos:',
    'admin estado +51 999999999',
    'admin autorizar 999999999',
    'admin desautorizar +51 999999999',
  ].join('\n');
}

/**
 * Handler de mensajes para el flujo admin.
 * Espera un objeto `message` de whatsapp-web.js:
 * - message.from
 * - message.body
 * - message.reply(text)
 */
export async function handleAdminMessage(message) {
  const from = message?.from || '';
  const bodyRaw = message?.body || '';
  const body = bodyRaw.trim();

  // Verifica admin
  if (!isAdminNumber(from)) {
    await message.reply('❌ No estás autorizado como administrador.');
    return;
  }

  // Sin argumentos → mostrar menú
  if (/^admin$/i.test(body)) {
    await message.reply(adminMenu());
    return;
  }

  // admin estado <tel>
  let m = body.match(/^admin\s+estado\s+(.+)$/i);
  if (m) {
    const phoneArg = normPhone(m[1]);
    if (!phoneArg) {
      await message.reply('⚠️ Debes indicar un teléfono. Ej: *admin estado +51 999999999*');
      return;
    }
    try {
      const status = await getSubscriberStatus(phoneArg); // 👈 AWAIT correcto
      if (!status.found) {
        await message.reply('ℹ️ Ese teléfono no existe en *Suscriptores*.');
        return;
      }
      const lines = [
        '📄 *Estado del suscriptor*',
        `• Teléfono: ${status.telefono || phoneArg}`,
        `• Autorizado: ${status.autorizado ? '✅ Sí' : '❌ No'}`,
        `• Email: ${status.email || '—'}`,
        `• Nombre: ${status.nombre || '—'}`,
        `• Sheet URL: ${status.sheet_url || '—'}`,
      ];
      await message.reply(lines.join('\n'));
    } catch (err) {
      console.error('[ADMIN ERROR][estado]', err);
      await message.reply('❌ Error al consultar estado. Revisa consola y configuración de Sheets.');
    }
    return;
  }

  // admin autorizar <tel>
  m = body.match(/^admin\s+autorizar\s+(.+)$/i);
  if (m) {
    const phoneArg = normPhone(m[1]);
    if (!phoneArg) {
      await message.reply('⚠️ Debes indicar un teléfono. Ej: *admin autorizar +51 999999999*');
      return;
    }
    try {
      await setAutorizado(phoneArg, true); // 👈 AWAIT correcto
      await message.reply(`✅ Teléfono ${phoneArg} marcado como *AUTORIZADO*.`);
    } catch (err) {
      console.error('[ADMIN ERROR][autorizar]', err);
      await message.reply('❌ No se pudo autorizar. Verifica que el teléfono exista en *Suscriptores* y las columnas estén correctas.');
    }
    return;
  }

  // admin desautorizar <tel>
  m = body.match(/^admin\s+desautorizar\s+(.+)$/i);
  if (m) {
    const phoneArg = normPhone(m[1]);
    if (!phoneArg) {
      await message.reply('⚠️ Debes indicar un teléfono. Ej: *admin desautorizar +51 999999999*');
      return;
    }
    try {
      await setAutorizado(phoneArg, false); // 👈 AWAIT correcto
      await message.reply(`🟡 Teléfono ${phoneArg} marcado como *NO AUTORIZADO*.`);
    } catch (err) {
      console.error('[ADMIN ERROR][desautorizar]', err);
      await message.reply('❌ No se pudo desautorizar. Verifica que el teléfono exista en *Suscriptores* y las columnas estén correctas.');
    }
    return;
  }

  // Cualquier otra variante → mostrar ayuda
  await message.reply(adminMenu());
}
