// probe-bulk-chapters.cjs — procura uma forma de pegar capítulos EM LOTE,
// para evitar 1.274 chamadas (uma por mangá) na carga completa.
// Rode:  node probe-bulk-chapters.cjs
const https = require('https');
const zlib = require('zlib');

const API = 'https://api.leituramanga.net';
const L = '9007199254740991';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, */*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://leituramanga.net/'
      },
      timeout: 20000
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

// Conta quantos "chapterNumber" e quantos mangás distintos aparecem na resposta
function analyze(body) {
  try {
    const j = JSON.parse(body);
    const s = JSON.stringify(j);
    const chs = (s.match(/"chapterNumber"/g) || []).length;
    const mangaIds = new Set((s.match(/"mangaId"\s*:\s*"[a-f0-9]{24}"/g) || []));
    return { chapters: chs, mangas: mangaIds.size };
  } catch (e) { return { chapters: 0, mangas: 0 }; }
}

async function tryEp(url) {
  // Tenta algumas vezes; se vier 429, espera e repete (o IP pode estar em cooldown).
  let r;
  for (let i = 0; i < 4; i++) {
    r = await get(url);
    if (r.status !== 429 && r.status !== 503) break;
    const w = 4000 * (i + 1);
    process.stdout.write(`   (429 — esperando ${w/1000}s e tentando de novo)\n`);
    await new Promise(res => setTimeout(res, w));
  }
  const good = r.status === 200 && /json/.test(r.ct || '');
  let extra = '';
  if (good) { const a = analyze(r.body); extra = `→ capítulos: ${a.chapters} | mangás distintos: ${a.mangas}`; }
  console.log(`${good ? '✅' : '❌ ' + r.status}  ${url}`);
  if (good) {
    console.log('    ', extra, `| ${r.body.length} bytes`);
    if (analyze(r.body).chapters > 50 && analyze(r.body).mangas > 5) {
      console.log('    🎯 PARECE LISTA GLOBAL DE CAPÍTULOS — ótimo candidato!');
      console.log('     preview:', r.body.replace(/\s+/g, ' ').slice(0, 220));
    }
  }
  console.log('');
}

async function main() {
  console.log('🔎 Procurando endpoint de capítulos em lote / catálogo com capítulos completos\n');
  const candidates = [
    // listas globais de capítulos (paginadas)
    `${API}/api/chapter?page=1&limit=${L}`,
    `${API}/api/chapter/get-all?page=1&limit=${L}`,
    `${API}/api/chapter/list?page=1&limit=${L}`,
    `${API}/api/chapter/latest?page=1&limit=200`,
    `${API}/api/chapter/get-latest?page=1&limit=200`,
    // catálogo pedindo capítulos completos embutidos
    `${API}/api/manga?page=1&limit=${L}&includeChapters=true`,
    `${API}/api/manga?page=1&limit=${L}&withChapters=true`,
    `${API}/api/manga?page=1&limit=${L}&full=true`,
    // capítulos por vários mangás
    `${API}/api/chapter/get-by-manga-ids?page=1&limit=${L}`,
  ];
  for (const url of candidates) { await tryEp(url); await new Promise(r => setTimeout(r, 500)); }
  console.log('Se algum mostrar 🎯, me manda a URL + o preview que eu adapto o scraper pra usar ele.');
  console.log('Se nenhum servir, abra o site com F12 → Network → Fetch/XHR e veja se há outra chamada de capítulos.');
}
main().catch(console.error);
