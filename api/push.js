// api/push.js — inscrição/cancelamento de Web Push.
//   POST /api/push?action=subscribe   body: { subscription }
//   POST /api/push?action=unsubscribe body: { endpoint }
//   GET  /api/push?action=key         → { publicKey }  (chave VAPID pública)
const { ensureConnection } = require('../lib/db');

// Chave pública VAPID (pode ficar no código; a privada é secret no envio).
const VAPID_PUBLIC = process.env.VAPID_PUBLIC ||
  'BCsxGB0ZQFEB82SX2fMoMFOtjdJgABW-W3kCl2JQ4IXbToVjvOuUcY5agED9pLNT5o854SpyPneQBobdepGnfbw';

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';

  if (req.method === 'GET' && action === 'key') {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ publicKey: VAPID_PUBLIC });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  try {
    const sql = await ensureConnection();

    if (action === 'unsubscribe') {
      const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
      if (!endpoint) return res.status(400).json({ ok: false, error: 'endpoint ausente' });
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
      return res.status(200).json({ ok: true });
    }

    // subscribe (padrão)
    const sub = body.subscription || body;
    const endpoint = sub && sub.endpoint;
    const keys = sub && sub.keys;
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ ok: false, error: 'subscription inválida' });
    }
    await sql`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth)
      VALUES (${endpoint}, ${keys.p256dh}, ${keys.auth})
      ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
