// scripts/sa-drive-cleanup.mjs
import 'dotenv/config';
import { google } from 'googleapis';
import readline from 'node:readline';

// --- CLI flags ---
// Ejemplos:
//   node scripts/sa-drive-cleanup.mjs --list --prefix "Finanzas – "
//   node scripts/sa-drive-cleanup.mjs --trash --prefix "Finanzas – "
//   node scripts/sa-drive-cleanup.mjs --delete --prefix "Finanzas – " --older-than 7
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  })
);

const MODE_LIST = !!args.list || (!args.trash && !args.delete); // por defecto: listar
const MODE_TRASH = !!args.trash;
const MODE_DELETE = !!args.delete;
const PREFIX = typeof args.prefix === 'string' ? args.prefix : null;
const OLDER_DAYS = args['older-than'] ? Number(args['older-than']) : null;

// --- Auth con Service Account ---
function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Faltan GOOGLE_CLIENT_EMAIL o GOOGLE_PRIVATE_KEY en .env');
  }
  return new google.auth.JWT(email, null, key, [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.metadata',
  ]);
}

const auth = getAuth();
const drive = google.drive({ version: 'v3', auth });

// Utilidades
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, ans => res(ans)));

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

function olderThan(dateStr, days) {
  if (!days) return true;
  const t = new Date(dateStr).getTime();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return t < cutoff;
}

async function getQuota() {
  const res = await drive.about.get({ fields: 'storageQuota' });
  const q = res.data.storageQuota || {};
  return {
    limit: Number(q.limit || 0),
    usage: Number(q.usage || 0),
    usageInDrive: Number(q.usageInDrive || 0),
    usageInDriveTrash: Number(q.usageInDriveTrash || 0),
  };
}

async function* listOwnedFiles() {
  // Archivos donde la SA es propietaria: "'me' in owners"
  // Excluimos papelera por defecto (trashed = false). Si quisieras incluirlos, ajusta la query.
  let q = "'me' in owners and trashed = false";
  if (PREFIX) {
    q += ` and name contains '${PREFIX.replace(/'/g, "\\'")}'`;
  }
  const fields = 'nextPageToken, files(id, name, size, mimeType, createdTime, trashed)';
  let pageToken = undefined;
  do {
    const res = await drive.files.list({
      q, fields, pageToken, pageSize: 1000,
      orderBy: 'modifiedTime desc',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) yield f;
    pageToken = res.data.nextPageToken;
  } while (pageToken);
}

async function run() {
  // 1) Mostrar cuota
  const quota = await getQuota();
  console.log('=== Cuota de la Service Account ===');
  console.log('Límite:', fmtBytes(quota.limit));
  console.log('Uso:', fmtBytes(quota.usage));
  console.log('En Drive:', fmtBytes(quota.usageInDrive));
  console.log('En Papelera:', fmtBytes(quota.usageInDriveTrash));
  console.log('');

  // 2) Listar archivos propios (filtro por prefijo/antigüedad si aplica)
  let count = 0;
  let totalBytes = 0;
  const files = [];

  for await (const f of listOwnedFiles()) {
    if (OLDER_DAYS && !olderThan(f.createdTime, OLDER_DAYS)) continue;
    files.push(f);
    count++;
    const sz = Number(f.size || 0); // Google Docs nativo puede no tener size
    totalBytes += sz;
  }

  console.log(`=== Archivos de la SA (propietario = 'me')${PREFIX ? ` | prefix: "${PREFIX}"` : ''}${OLDER_DAYS ? ` | older-than: ${OLDER_DAYS}d` : ''} ===`);
  for (const f of files) {
    console.log(
      `- ${f.name}  | id=${f.id}  | ${f.mimeType}  | ${new Date(f.createdTime).toISOString()}  | size=${fmtBytes(Number(f.size || 0))}`
    );
  }
  console.log(`Total archivos listados: ${count}`);
  console.log(`Tamaño total (conocido): ${fmtBytes(totalBytes)}\n`);

  if (MODE_LIST) {
    console.log('Modo LIST: no se harán cambios.');
    rl.close();
    return;
  }

  // 3) Confirmación
  const modeTxt = MODE_TRASH ? 'ENVIAR A PAPELERA' : 'ELIMINAR PERMANENTEMENTE';
  const ans = await ask(`¿Seguro que deseas ${modeTxt} ${count} archivo(s)? Escribe EXACTAMENTE: SI\n> `);
  if (ans.trim() !== 'SI') {
    console.log('Cancelado.');
    rl.close();
    return;
  }

  // 4) Ejecutar acción
  let ok = 0, fail = 0;
  for (const f of files) {
    try {
      if (MODE_TRASH) {
        // mover a papelera
        await drive.files.update({ fileId: f.id, requestBody: { trashed: true } });
      } else if (MODE_DELETE) {
        // eliminar definitivo
        await drive.files.delete({ fileId: f.id });
      }
      ok++;
      console.log(`✔ ${modeTxt}: ${f.name} (${f.id})`);
    } catch (e) {
      fail++;
      console.error(`✖ Error con ${f.name} (${f.id}):`, e?.errors?.[0]?.message || e.message);
    }
  }

  console.log(`\nHecho. OK=${ok}  FAIL=${fail}`);
  rl.close();
}

run().catch(e => {
  console.error('ERROR FATAL:', e);
  rl.close();
  process.exit(1);
});
