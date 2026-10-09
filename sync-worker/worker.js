const encoder = new TextEncoder();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json; charset=utf-8', ...headers}});
const bytes = n => crypto.getRandomValues(new Uint8Array(n));
const hex = data => [...new Uint8Array(data)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const randomToken = () => Array.from(bytes(32), b => b.toString(16).padStart(2, '0')).join('');

function cors(origin, allowed) {
  return origin === allowed ? {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Vary': 'Origin',
  } : {};
}

async function body(request) {
  if (Number(request.headers.get('content-length')) > 2_000_000) throw new Error('Requête trop volumineuse');
  const raw = await request.text();
  if (raw.length > 2_000_000) throw new Error('Requête trop volumineuse');
  return JSON.parse(raw);
}

async function session(request, db) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  const tokenHash = await sha(token);
  const row = await db.prepare('SELECT token_hash, recovery FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(tokenHash, new Date().toISOString()).first();
  return row || null;
}

async function limited(request, db) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = await sha(address);
  const now = Date.now();
  const row = await db.prepare('SELECT attempts, expires_at FROM login_attempts WHERE address_hash = ?').bind(key).first();
  if (row && row.expires_at > now && row.attempts >= 10) return true;
  const attempts = row && row.expires_at > now ? row.attempts + 1 : 1;
  await db.prepare('INSERT INTO login_attempts (address_hash, attempts, expires_at) VALUES (?, ?, ?) ON CONFLICT(address_hash) DO UPDATE SET attempts = excluded.attempts, expires_at = excluded.expires_at').bind(key, attempts, now + 15 * 60_000).run();
  return false;
}

async function issueSession(db, recovery = false) {
  const token = randomToken();
  const tokenHash = await sha(token);
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 864e5);
  await db.prepare('INSERT INTO sessions (token_hash, recovery, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(tokenHash, recovery ? 1 : 0, now.toISOString(), expires.toISOString()).run();
  return {token, expiresAt: expires.toISOString()};
}

function validEnvelope(value) {
  return value && value.version === 1 && typeof value.salt === 'string' && typeof value.iv === 'string' && typeof value.data === 'string' && value.salt.length < 100 && value.iv.length < 100 && value.data.length < 1_800_000;
}
function validWrap(value) { return value && typeof value.iv === 'string' && typeof value.data === 'string' && value.iv.length < 100 && value.data.length < 1000; }

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    const headers = cors(origin, env.ALLOWED_ORIGIN);
    if (request.method === 'OPTIONS') return new Response(null, {status: origin === env.ALLOWED_ORIGIN ? 204 : 403, headers});
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({error:'Origine interdite'}, 403, headers);
    if (!env.DB || !env.SETUP_CODE || !env.ALLOWED_ORIGIN) return json({error:'Service non configuré'}, 503, headers);
    const path = new URL(request.url).pathname;
    try {
      if (path === '/health' && request.method === 'GET') return json({ok:true}, 200, headers);
      if (path === '/account' && request.method === 'GET') {
        const account = await env.DB.prepare('SELECT username FROM account WHERE id = 1').first();
        return json({exists:!!account, username:account?.username || null}, 200, headers);
      }
      if (path === '/setup' && request.method === 'POST') {
        const input = await body(request);
        if (typeof input.setupCode !== 'string' || input.setupCode !== env.SETUP_CODE) return json({error:'Code de configuration incorrect'}, 403, headers);
        const username = String(input.username || '').trim().toLowerCase();
        if (!/^[a-z0-9@._-]{3,100}$/.test(username) || !/^[a-f0-9]{64}$/.test(input.verifier || '') || !/^[a-f0-9]{64}$/.test(input.recoveryVerifier || '') || !validEnvelope(input.envelope) || !validEnvelope(input.recoveryEnvelope) || !validWrap(input.wrappedRecovery)) return json({error:'Données invalides'}, 400, headers);
        const existing = await env.DB.prepare('SELECT id FROM account WHERE id = 1').first();
        if (existing) return json({error:'Compte déjà créé'}, 409, headers);
        const createdAt = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO account (id, username, verifier_hash, recovery_verifier_hash, created_at) VALUES (1, ?, ?, ?, ?)').bind(username, await sha(input.verifier), await sha(input.recoveryVerifier), createdAt),
          env.DB.prepare('INSERT INTO snapshot (id, revision, envelope, recovery_envelope, wrapped_recovery, updated_at) VALUES (1, 1, ?, ?, ?, ?)').bind(JSON.stringify(input.envelope), JSON.stringify(input.recoveryEnvelope), JSON.stringify(input.wrappedRecovery), createdAt),
        ]);
        const auth = await issueSession(env.DB);
        return json({...auth, revision:1}, 201, headers);
      }
      if (path === '/login' && request.method === 'POST') {
        if (await limited(request, env.DB)) return json({error:'Trop de tentatives. Réessayez dans 15 minutes.'}, 429, headers);
        const input = await body(request);
        const account = await env.DB.prepare('SELECT username, verifier_hash FROM account WHERE id = 1').first();
        const username = String(input.username || '').trim().toLowerCase();
        if (!account || username !== account.username || !/^[a-f0-9]{64}$/.test(input.verifier || '') || await sha(input.verifier) !== account.verifier_hash) return json({error:'Identifiant ou mot de passe incorrect'}, 401, headers);
        return json(await issueSession(env.DB), 200, headers);
      }
      if (path === '/recover-login' && request.method === 'POST') {
        if (await limited(request, env.DB)) return json({error:'Trop de tentatives. Réessayez dans 15 minutes.'}, 429, headers);
        const input = await body(request);
        const account = await env.DB.prepare('SELECT username, recovery_verifier_hash FROM account WHERE id = 1').first();
        if (!account || String(input.username || '').trim().toLowerCase() !== account.username || !/^[a-f0-9]{64}$/.test(input.recoveryVerifier || '') || await sha(input.recoveryVerifier) !== account.recovery_verifier_hash) return json({error:'Identifiant ou code de récupération incorrect'}, 401, headers);
        return json(await issueSession(env.DB, true), 200, headers);
      }
      const auth = await session(request, env.DB);
      if (!auth) return json({error:'Session expirée. Reconnectez-vous.'}, 401, headers);
      if (path === '/logout' && request.method === 'POST') {
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(auth.token_hash).run();
        return json({ok:true}, 200, headers);
      }
      if (path === '/snapshot/recovery' && request.method === 'GET' && auth.recovery) {
        const row = await env.DB.prepare('SELECT revision, recovery_envelope FROM snapshot WHERE id = 1').first();
        return json({revision:row.revision, recoveryEnvelope:JSON.parse(row.recovery_envelope)}, 200, headers);
      }
      if (path === '/reset-password' && request.method === 'POST' && auth.recovery) {
        const input = await body(request);
        if (!Number.isSafeInteger(input.revision) || !/^[a-f0-9]{64}$/.test(input.verifier || '') || !validEnvelope(input.envelope) || !validWrap(input.wrappedRecovery)) return json({error:'Données invalides'}, 400, headers);
        const row = await env.DB.prepare('SELECT revision FROM snapshot WHERE id = 1').first();
        if (row.revision !== input.revision) return json({error:'Les données ont changé. Recommencez la récupération.'}, 409, headers);
        await env.DB.batch([
          env.DB.prepare('UPDATE account SET verifier_hash = ? WHERE id = 1').bind(await sha(input.verifier)),
          env.DB.prepare('UPDATE snapshot SET revision = revision + 1, envelope = ?, wrapped_recovery = ?, updated_at = ? WHERE id = 1').bind(JSON.stringify(input.envelope), JSON.stringify(input.wrappedRecovery), new Date().toISOString()),
          env.DB.prepare('DELETE FROM sessions'),
        ]);
        return json({...await issueSession(env.DB), revision:input.revision + 1}, 200, headers);
      }
      if (auth.recovery) return json({error:'Récupération en cours'}, 403, headers);
      if (path === '/snapshot' && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT revision, envelope, recovery_envelope, wrapped_recovery, updated_at FROM snapshot WHERE id = 1').first();
        return json({revision:row.revision, envelope:JSON.parse(row.envelope), recoveryEnvelope:JSON.parse(row.recovery_envelope), wrappedRecovery:JSON.parse(row.wrapped_recovery), updatedAt:row.updated_at}, 200, headers);
      }
      if (path === '/snapshot' && request.method === 'PUT') {
        const input = await body(request);
        if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !validEnvelope(input.envelope) || !validEnvelope(input.recoveryEnvelope)) return json({error:'Données invalides'}, 400, headers);
        const updatedAt = new Date().toISOString();
        const result = await env.DB.prepare('UPDATE snapshot SET revision = revision + 1, envelope = ?, recovery_envelope = ?, updated_at = ? WHERE id = 1 AND revision = ?').bind(JSON.stringify(input.envelope), JSON.stringify(input.recoveryEnvelope), updatedAt, input.revision).run();
        if (!result.meta.changes) return json({error:'Les données ont changé sur un autre appareil. Rechargez avant de modifier.', code:'CONFLICT'}, 409, headers);
        return json({revision:input.revision + 1, updatedAt}, 200, headers);
      }
      return json({error:'Adresse introuvable'}, 404, headers);
    } catch (error) {
      if (error instanceof SyntaxError || error.message === 'Requête trop volumineuse') return json({error:'Requête invalide ou trop volumineuse'}, 400, headers);
      return json({error:'Erreur du service. Réessayez.'}, 500, headers);
    }
  },
};
