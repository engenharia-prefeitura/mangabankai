// send-push.cjs — envia Web Push quando obras ganham capítulos novos.
// Compara a contagem atual de cada obra (js/data.js) com o último estado salvo
// (manga_notify_state) e notifica as inscrições (push_subscriptions).
// 1ª execução: só inicializa o estado (não spamma). Requer VAPID_PRIVATE +
// VAPID_PUBLIC + DATABASE_URL (secrets). Sem eles, encerra sem erro.
const fs = require('fs');
const path = require('path');

const DATABASE_URL  = process.env.DATABASE_URL;
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC ||
  'BCsxGB0ZQFEB82SX2fMoMFOtjdJgABW-W3kCl2JQ4IXbToVjvOuUcY5agED9pLNT5o854SpyPneQBobdepGnfbw';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:eng.dennylsonsantos@gmail.com';
const SITE          = process.env.SITE_URL || 'https://mangabankai.vercel.app';
const PER_MANGA_CAP = 8;   // acima disso, manda 1 resumo em vez de N notificações

if (!VAPID_PRIVATE || !DATABASE_URL) {
  console.log('send-push: VAPID_PRIVATE/DATABASE_URL ausentes — nada a fazer.');
  process.exit(0);
}

const webpush = require('web-push');
const { createPool } = require('@vercel/postgres');
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// Extrai [{id,title,chaptersCount}] do js/data.js (parser ciente de strings).
function loadCatalog() {
  const dataJs = fs.readFileSync(path.join(__dirname, 'js', 'data.js'), 'utf8');
  const marker = dataJs.indexOf('MANGA_DATA = [');
  const start = dataJs.indexOf('[', marker);
  let depth = 0, inStr = false, esc = false, end = start;
  for (let i = start; i < dataJs.length; i++) {
    const c = dataJs[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (c === '[') depth++; else if (c === ']') { depth--; if (!depth) { end = i + 1; break; } } }
  }
  return JSON.parse(dataJs.substring(start, end))
    .map(m => ({ id: m.id, title: m.title, count: parseInt(m.chaptersCount, 10) || 0 }));
}

async function sendToAll(pool, subs, payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const dead = [];
  const CONC = 20;
  for (let i = 0; i < subs.length; i += CONC) {
    await Promise.all(subs.slice(i, i + CONC).map(async (s) => {
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try { await webpush.sendNotification(sub, payload); }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); }
    }));
  }
  if (dead.length) {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ANY($1)', [dead]);
    console.log(`send-push: removidas ${dead.length} inscrições expiradas.`);
  }
}

async function main() {
  const pool = createPool({ connectionString: DATABASE_URL });
  try {
    const catalog = loadCatalog();
    const stRes = await pool.query('SELECT manga_id, last_count FROM manga_notify_state');
    const state = new Map((stRes.rows || []).map(r => [r.manga_id, r.last_count]));
    const firstRun = state.size === 0;

    const updated = [];           // obras que ganharam capítulo
    const upserts = [];           // estado a gravar
    for (const m of catalog) {
      const prev = state.get(m.id);
      if (prev == null) { upserts.push(m); continue; }            // nova no catálogo → só registra
      if (m.count > prev) { updated.push(m); upserts.push(m); }   // cresceu → notifica
    }

    // Persiste o estado (batch).
    for (let i = 0; i < upserts.length; i += 200) {
      const chunk = upserts.slice(i, i + 200);
      const vals = chunk.map((_, j) => `($${j*2+1}, $${j*2+2})`).join(',');
      const params = [];
      chunk.forEach(m => { params.push(m.id, m.count); });
      await pool.query(
        `INSERT INTO manga_notify_state (manga_id, last_count) VALUES ${vals}
         ON CONFLICT (manga_id) DO UPDATE SET last_count = EXCLUDED.last_count, updated_at = CURRENT_TIMESTAMP`,
        params
      );
    }

    if (firstRun) { console.log(`send-push: 1ª execução — estado inicializado (${upserts.length} obras), sem envio.`); return; }
    if (!updated.length) { console.log('send-push: nenhum capítulo novo.'); return; }

    const subsRes = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions');
    const subs = subsRes.rows || [];
    if (!subs.length) { console.log(`send-push: ${updated.length} obras novas, mas 0 inscrições.`); return; }

    if (updated.length > PER_MANGA_CAP) {
      await sendToAll(pool, subs, {
        title: 'MangaBankai',
        body: `⚡ ${updated.length} obras com capítulos novos!`,
        url: `${SITE}/`,
        tag: 'mb-summary'
      });
      console.log(`send-push: resumo enviado (${updated.length} obras) para ${subs.length} inscrições.`);
    } else {
      for (const m of updated) {
        await sendToAll(pool, subs, {
          title: 'Novo capítulo! 🔔',
          body: `${m.title} — capítulo novo disponível`,
          url: `${SITE}/manga/${m.id}/`,
          tag: `mb-${m.id}`
        });
      }
      console.log(`send-push: ${updated.length} notificações enviadas para ${subs.length} inscrições.`);
    }
  } catch (e) {
    console.error('send-push erro:', e.message);
  } finally {
    await pool.end();
  }
}

main();
