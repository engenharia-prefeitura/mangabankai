// inspect-chapter-latest.cjs — vê a estrutura do feed global de capítulos
// e testa se um limit alto traz TODOS os capítulos numa só chamada.
// Rode:  node inspect-chapter-latest.cjs
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

const API = 'https://api.leituramanga.net';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, */*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://leituramanga.net/'
      },
      timeout: 30000
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch (e) {}
        resolve({ status: res.statusCode, ct: res.headers['content-type'], body: buf.toString('utf8') });
      });
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: -1, body: 'timeout' }); });
  });
}

async function getRetry(url) {
  for (let i = 0; i < 5; i++) {
    const r = await get(url);
    if (r.status !== 429 && r.status !== 503) return r;
    const w = 5000 * (i + 1);
    console.log(`   (429 — esperando ${w/1000}s)`);
    await new Promise(res => setTimeout(res, w));
  }
  return { status: 429, body: 'rate limited' };
}

(async () => {
  console.log('Estrutura do feed (limit=5)...');
  const r1 = await getRetry(`${API}/api/chapter/latest?page=1&limit=5`);
  if (r1.status !== 200) { console.log('   falhou:', r1.status); return; }
  const j1 = JSON.parse(r1.body);
  console.log('   envelope:', Object.keys(j1).join(', '));
  console.log('   data:', Object.keys(j1.data || {}).join(', '));
  const list = (j1.data && j1.data.chapters) || [];
  console.log('   total de itens nesta página:', list.length);
  console.log('   chaves de um capítulo:', Object.keys(list[0] || {}).join(', '));
  console.log('\n   PRIMEIRO ITEM COMPLETO:\n' + JSON.stringify(list[0], null, 2));
  console.log('\n   SEGUNDO ITEM COMPLETO:\n' + JSON.stringify(list[1], null, 2));
  fs.writeFileSync('chapter-latest-sample.json', JSON.stringify(list, null, 2), 'utf8');
  console.log('\n   amostra salva em chapter-latest-sample.json');
})().catch(console.error);
