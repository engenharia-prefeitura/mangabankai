const https = require('https');
const http = require('http');

function fetchBinary(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://ww2.mangafreak.me/'
      },
      timeout: 15000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchBinary(next, redirects + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        buf: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || 'image/jpeg',
        status: res.statusCode
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');

  const url = (req.query && req.query.url) || '';
  if (!url || !url.startsWith('https://images.mangafreak.me/')) {
    return res.status(400).end('url inválida');
  }

  try {
    const { buf, contentType, status } = await fetchBinary(url);
    if (status !== 200) return res.status(status).end('upstream error ' + status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).end('proxy error: ' + e.message);
  }
};
