const https = require('https');

const url = 'https://cdn.mugiverso.com/mugiwarasoficial/manga_69a172f301d66/e3b18179a41f377f3f01b87d328738fd/01.webp';

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://mugiwarasoficial.com/'
  }
}, (res) => {
  console.log("Status with Referer:", res.statusCode);
  console.log("Headers:", res.headers);
}).on('error', (err) => {
  console.error("Error:", err.message);
});

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
}, (res) => {
  console.log("Status without Referer:", res.statusCode);
}).on('error', (err) => {
  console.error("Error without Referer:", err.message);
});
