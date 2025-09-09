// src/googleAuth.js
import 'dotenv/config';
import { google } from 'googleapis';
import { readFile } from 'node:fs/promises';

export async function getAuth() {
  const tokens = JSON.parse(await readFile('token.json', 'utf8'));
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  auth.setCredentials(tokens);
  return auth;
}
