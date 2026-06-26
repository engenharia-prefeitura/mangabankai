// find-rsc-api.cjs - Try Next.js RSC-specific headers to get chapter data
const https = require('https');

function fetchWithHeaders(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/x-component',
      'Next-Router-State-Tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22(main)%22%2C%7B%22children%22%3A%5B%22manga%22%2C%7B%22children%22%3A%5B%5B%22slug%22%2C%22magic-emperor%22%2C%22d%22%5D%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%5D%7D%5D%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
      'RSC': '1',
      'Referer': 'https://leituramanga.net',
      ...extraHeaders
    };
    https.get(url, { headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, ct: res.headers['content-type'] }));
    }).on('error', reject);
  });
}

async function main() {
  const slug = 'magic-emperor';
  const url = `https://leituramanga.net/manga/${slug}`;
  
  console.log('Trying RSC with Next-Router headers...');
  const res = await fetchWithHeaders(url);
  console.log('Status:', res.status, '| Content-Type:', res.ct);
  console.log('Size:', res.body.length, 'bytes');
  
  // Extract all chapter/number references
  const chapterRefs = [...new Set((res.body.match(new RegExp(`/manga/${slug}/chapter/([\\d.]+)`, 'g')) || []).map(m => m.split('/chapter/')[1]))];
  console.log('\nChapter refs found:', chapterRefs.length);
  console.log('Chapters:', chapterRefs.sort((a, b) => parseFloat(a) - parseFloat(b)));
  
  // Look for chapter number patterns
  const numPattern = /"number"\s*:\s*([\d.]+)/g;
  const nums = [];
  let m;
  while ((m = numPattern.exec(res.body)) !== null) nums.push(m[1]);
  console.log('\n"number" fields found:', [...new Set(nums)].sort((a,b)=>parseFloat(a)-parseFloat(b)));
  
  // Save raw RSC for analysis
  const fs = require('fs');
  fs.writeFileSync('rsc-chapters-dump.txt', res.body.substring(0, 50000));
  console.log('\nFirst 50kb saved to rsc-chapters-dump.txt');
}

main().catch(console.error);
