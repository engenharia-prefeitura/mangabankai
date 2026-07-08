// inspect-catalog.cjs — mostra a estrutura do catálogo da API para mapear campos.
// Rode:  node inspect-catalog.cjs
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');

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
        resolve({ status: res.statusCode, body: buf.toString('utf8') });
      });
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: -1, body: 'timeout' }); });
  });
}

(async () => {
  const url = 'https://api.leituramanga.net/api/manga?page=1&limit=9007199254740991';
  const r = await get(url);
  const j = JSON.parse(r.body);
  const list = j.data.data;
  console.log('Total de mangás retornados:', list.length);
  console.log('\n=== CHAVES de um item ===');
  console.log(Object.keys(list[0]).join(', '));
  console.log('\n=== PRIMEIRO ITEM COMPLETO ===');
  console.log(JSON.stringify(list[0], null, 2));

  // procura um item que tenha autor/descrição preenchidos para ver esses campos
  const withAuthor = list.find(m => JSON.stringify(m).toLowerCase().includes('author')) || list[0];
  console.log('\n=== ITEM COM POSSÍVEL AUTOR ===');
  console.log(JSON.stringify(withAuthor, null, 2).slice(0, 1500));

  fs.writeFileSync('catalog-sample.json', JSON.stringify(list.slice(0, 3), null, 2), 'utf8');
  console.log('\n3 itens salvos em catalog-sample.json');
})();
