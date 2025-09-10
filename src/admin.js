// src/admin.js
import 'dotenv/config';
import { getSubscriber, getSubscriberStatus, setAutorizado, addSubscriber } from './sheets.js';

/** Normaliza teléfono a formato +51XXXXXXXXX (ajústalo si es necesario) */
function normPhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
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
    '🛠️ ADMIN',
    '',
    'Elige una opción enviando el número:',
    '1) Autorizar teléfono',
    '2) Desautorizar teléfono',
    '3) Ver estado de teléfono',
    '',
    'Envía 0 para volver a este menú.'
  ].join('\n');
}

// Estado conversacional por administrador (en memoria)
const adminState = new Map(); // key: from (jid), value: { step: 'MENU'|'AUTH'|'DEAUTH'|'STATUS' }

function setState(from, step) {
  adminState.set(from, { step });
}

function getState(from) {
  return adminState.get(from) || { step: 'MENU' };
}

/**
 * Handler de mensajes para el flujo admin.
 */
export async function handleAdminMessage(message) {
  const from = message?.from || '';
  const bodyRaw = message?.body || '';
  const body = bodyRaw.trim();

  if (!isAdminNumber(from)) {
    await message.reply('🚫 No estás autorizado como administrador.');
    return;
  }

  const state = getState(from);

  // Navegación global al menú
  if (/^(0|menu|admin)$/i.test(body)) {
    setState(from, 'MENU');
    await message.reply(adminMenu());
    return;
  }

  if (state.step === 'MENU') {
    if (/^[123]$/.test(body)) {
      if (body === '1') {
        setState(from, 'AUTH');
        await message.reply('Envía el teléfono a AUTORIZAR (ej. +51999999999 o 999999999).\nEnvía 0 para volver al menú.');
        return;
      }
      if (body === '2') {
        setState(from, 'DEAUTH');
        await message.reply('Envía el teléfono a DESAUTORIZAR.\nEnvía 0 para volver al menú.');
        return;
      }
      if (body === '3') {
        setState(from, 'STATUS');
        await message.reply('Envía el teléfono para consultar su ESTADO.\nEnvía 0 para volver al menú.');
        return;
      }
    }
    await message.reply(adminMenu());
    return;
  }

  if (state.step === 'AUTH') {
    const phoneArg = normPhone(body);
    if (!/\d/.test(phoneArg)) {
      await message.reply('No reconocí el teléfono. Intenta de nuevo o envía 0 para menú.');
      return;
    }
    try {
      await addSubscriber(phoneArg); // agrega si no existe, o autoriza si existe
      await message.reply(`✅ Teléfono ${phoneArg} quedó AUTORIZADO.`);
    } catch (err) {
      console.error('[ADMIN ERROR][autorizar]', err);
      await message.reply('⚠️ No se pudo autorizar/agregar. Revisa la configuración de Sheets.');
    }
    setState(from, 'MENU');
    await message.reply(adminMenu());
    return;
  }

  if (state.step === 'DEAUTH') {
    const phoneArg = normPhone(body);
    if (!/\d/.test(phoneArg)) {
      await message.reply('No reconocí el teléfono. Intenta de nuevo o envía 0 para menú.');
      return;
    }
    try {
      const exists = await getSubscriber(phoneArg);
      if (!exists) {
        await message.reply('Ese teléfono no existe en Suscriptores.');
      } else {
        await setAutorizado(phoneArg, false);
        await message.reply(`⛔ Teléfono ${phoneArg} marcado como NO AUTORIZADO.`);
      }
    } catch (err) {
      console.error('[ADMIN ERROR][desautorizar]', err);
      await message.reply('⚠️ No se pudo desautorizar. Revisa la configuración de Sheets.');
    }
    setState(from, 'MENU');
    await message.reply(adminMenu());
    return;
  }

  if (state.step === 'STATUS') {
    const phoneArg = normPhone(body);
    if (!/\d/.test(phoneArg)) {
      await message.reply('No reconocí el teléfono. Intenta de nuevo o envía 0 para menú.');
      return;
    }
    try {
      const status = await getSubscriberStatus(phoneArg);
      if (!status.found) {
        await message.reply('No existe en Suscriptores.');
      } else {
        const lines = [
          'Estado del suscriptor',
          `• Teléfono: ${status.telefono}`,
          `• Autorizado: ${status.autorizado ? 'Sí' : 'No'}`,
          `• Email: ${status.email || '—'}`,
          `• Nombre: ${status.nombre || '—'}`,
          `• Sheet URL: ${status.sheet_url || '—'}`,
        ];
        await message.reply(lines.join('\n'));
      }
    } catch (err) {
      console.error('[ADMIN ERROR][estado]', err);
      await message.reply('⚠️ Error al consultar estado.');
    }
    setState(from, 'MENU');
    await message.reply(adminMenu());
    return;
  }

  // Fallback
  setState(from, 'MENU');
  await message.reply(adminMenu());
}
