// probe-api.cjs — Descobre endpoints JSON do catálogo em api.leituramanga.net
// Rode com:  node probe-api.cjs
// Objetivo: achar um endpoint que liste TODOS os mangás em JSON, para
// substituir a raspagem de HTML por chamadas de API (mais rápido e seguro).

const https = require('https');
const zlib = require('zlib');

const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

function get(url, headers = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://leituramanga.net/',
        'Origin': 'https://leituramanga.net',
        ...headers
      },
      timeout: 15000
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

function looksLikeMangaList(body) {
  // heurística: JSON com vários títulos/slugs
  try {
    const j = JSON.parse(body);
    const s = JSON.stringify(j);
    const hits = (s.match(/"slug"|"title"|"chapterNumber"|"_id"/g) || []).length;
    return hits >= 5;
  } catch (e) { return false; }
}

async function tryEp(url, headers) {
  process.stdout.write(`→ ${url}\n   `);
  const r = await get(url, headers);
  const good = r.status === 200 && /json/.test(r.ct || '');
  const flag = good ? (looksLikeMangaList(r.body) ? '✅✅ PROVÁVEL CATÁLOGO' : '✅ JSON') : `❌ ${r.status}`;
  console.log(`${flag}  [${r.ct || '-'}]  ${r.body ? r.body.length : 0}b`);
  if (good) console.log('   preview:', (r.body || '').replace(/\s+/g, ' ').slice(0, 220));
  console.log('');
  return good && looksLikeMangaList(r.body);
}

async function main() {
  const API = 'https://api.leituramanga.net';
  // limite alto = pega tudo de uma vez se o endpoint existir
  const L = '9007199254740991';

  const candidates = [
    `${API}/api/manga/get-all?page=1&limit=${L}`,
    `${API}/api/manga/get-all`,
    `${API}/api/manga?page=1&limit=${L}`,
    `${API}/api/manga/list?page=1&limit=${L}`,
    `${API}/api/manga/get-list?page=1&limit=${L}`,
    `${API}/api/manga/get-by-page?page=1&limit=60`,
    `${API}/api/manga/latest?page=1&limit=60`,
    `${API}/api/manga/get-latest?page=1&limit=60`,
    `${API}/api/manga/popular?page=1&limit=60`,
    `${API}/api/manga/search?q=`,
    `${API}/api/catalog?page=1&limit=${L}`,
    `${API}/api/manga/all`,
  ];

  console.log('🔎 Sondando endpoints de catálogo em', API, '\n');
  let found = false;
  for (const url of candidates) {
    if (await tryEp(url)) found = true;
    await new Promise(r => setTimeout(r, 400));
  }

  if (!found) {
    console.log('\nNenhum candidato óbvio respondeu. Próximo passo manual:');
    console.log('1) Abra o site no navegador, F12 → aba Network → filtro "Fetch/XHR".');
    console.log('2) Navegue pelo catálogo e veja quais URLs de api.leituramanga.net aparecem.');
    console.log('3) Me mande os caminhos (ex.: /api/manga/get-by-page) que eu adapto o scraper.');
  } else {
    console.log('\n🎉 Achou! Use o(s) endpoint(s) marcados com ✅✅ para puxar o catálogo via JSON.');
  }
}

main().catch(console.error);
