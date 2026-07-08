const https = require('https');

const url = 'https://leitor.mangadash.net/storage/mangas/the_reincarnated_king_of_fists/Capitulo 99.pdf';

const req = https.request(url, {
  method: 'HEAD',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Referer': 'https://mangadash.net/'
  }
}, (res) => {
  console.log("Status Code:", res.statusCode);
  console.log("Headers:", res.headers);
}).on('error', (err) => {
  console.error("Error:", err.message);
});
req.end();
