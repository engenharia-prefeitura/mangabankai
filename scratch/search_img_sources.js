const https = require('https');

function getUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mugiwarasoficial.com/'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/');
  
  // Search for the unique folder ID
  const pattern = 'manga_69a172f301d66';
  let pos = 0;
  let occurrences = 0;
  while ((pos = html.indexOf(pattern, pos)) !== -1) {
    occurrences++;
    console.log(`\nOccurrence #${occurrences} at position ${pos}:`);
    console.log(html.substring(pos - 100, pos + 250));
    pos += pattern.length;
  }
  
  console.log(`\nTotal occurrences of ${pattern}: ${occurrences}`);
}

main();
