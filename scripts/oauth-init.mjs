// scripts/oauth-init.mjs
import 'dotenv/config';
import http from 'node:http';
import open from 'open';
import fs from 'node:fs/promises';
import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Faltan GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET en .env');
  process.exit(1);
}

// Loopback OAuth (puerto aleatorio)
const server = http.createServer();
await new Promise(r => server.listen(0, r));
const { port } = server.address();
const REDIRECT_URI = `http://localhost:${port}/oauth2callback`;

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const scopes = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];
const authUrl = oauth2.generateAuthUrl({ access_type: 'offline', scope: scopes, prompt: 'consent' });

console.log('Abriendo navegador para autorizar…');
await open(authUrl);

const tokens = await new Promise((resolve, reject) => {
  server.on('request', async (req, res) => {
    if (!req.url.startsWith('/oauth2callback')) return;
    const url = new URL(req.url, `http://localhost:${port}`);
    const code = url.searchParams.get('code');
    try {
      const { tokens } = await oauth2.getToken({ code, redirect_uri: REDIRECT_URI });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Autorizado. Ya puedes cerrar esta pestaña.');
      resolve(tokens);
    } catch (e) {
      reject(e);
    } finally {
      server.close();
    }
  });
});

await fs.writeFile('token.json', JSON.stringify(tokens, null, 2));
console.log('✅ token.json guardado. Listo.');
process.exit(0);
