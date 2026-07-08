// probe-mf-pages.cjs — descobre como o MangaFreak lista as imagens de um capítulo,
// para resolvermos a lista EXATA de páginas no servidor (sem adivinhar / sem 404).
// Uso:  node probe-mf-pages.cjs [Slug] [Capitulo]
//   ex: node probe-mf-pages.cjs Berserk 210
const https = require('https');

const SLUG = process.argv[2] || 'Berserk';
const CH = process.argv[3] || '210';
const BASE = 'https://ww2.mangafreak.me';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        res.resume(); return get(next).then(resolve);
      }
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d, url }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: -1, body: 'timeout' }); });
  });
}

(async () => {
  // 1) Acha a URL /ReadN_Slug_Ch a partir da página do mangá
  console.log(`Buscando link do capítulo ${CH} de ${SLUG}...`);
  const mangaPage = await get(`${BASE}/Manga/${SLUG}`);
  let readUrl = null;
  const m = mangaPage.body.match(new RegExp(`/Read\\d+_${SLUG}_${CH}\\b`));
  if (m) readUrl = BASE + m[0];
  else readUrl = `${BASE}/Read1_${SLUG}_${CH}`; // tentativa padrão
  console.log('URL do capítulo:', readUrl);

  // 2) Baixa a página do capítulo
  const r = await get(readUrl);
  console.log('Status:', r.status, '| tamanho:', r.body.length, 'bytes');
  if (r.status !== 200) { console.log('Falhou ao abrir o capítulo.'); return; }

  const html = r.body;

  // 3) Mostra como as imagens aparecem (várias hipóteses)
  console.log('\n=== <img> apontando para images.mangafreak.me ===');
  const imgs = [...html.matchAll(/<img[^>]+src=["']([^"']*images\.mangafreak[^"']+)["']/gi)].map(x => x[1]);
  console.log('quantidade:', imgs.length);
  imgs.slice(0, 3).forEach(u => console.log('  ', u));
  if (imgs.length > 3) console.log('  ...', imgs[imgs.length - 1]);

  console.log('\n=== arrays/variáveis JS com imagens ===');
  const jsArr = html.match(/(var|let|const)\s+\w*([Ii]mage|[Pp]age|img)\w*\s*=\s*\[[\s\S]{0,400}?\]/);
  console.log(jsArr ? jsArr[0].slice(0, 400) : '(nenhuma var de imagem óbvia)');

  console.log('\n=== qualquer .jpg/.png/.webp de images.mangafreak no HTML ===');
  const anyImg = [...new Set((html.match(/https?:\/\/images\.mangafreak[^"'\s)]+\.(?:jpg|png|webp|jpeg)/gi) || []))];
  console.log('quantidade distinta:', anyImg.length);
  anyImg.slice(0, 3).forEach(u => console.log('  ', u));
  if (anyImg.length > 3) console.log('  ...', anyImg[anyImg.length - 1]);

  console.log('\n=== pistas de contagem de páginas (select/option, "of N", data-*) ===');
  const sel = [...html.matchAll(/<option[^>]*>\s*([\d]+)\s*<\/option>/gi)].map(x => x[1]);
  if (sel.length) console.log('options numéricas (páginas?):', sel.length, '→', sel.slice(0, 5).join(','), '...', sel[sel.length - 1]);
  const ofN = html.match(/of\s+(\d+)/i);
  if (ofN) console.log('"of N":', ofN[0]);

  console.log('\nMe mande TODA essa saída que eu escrevo o extrator exato.');
})();
