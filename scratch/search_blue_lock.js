const fs = require('fs');
const path = require('path');
const https = require('https');

const chapFile = path.join(__dirname, '..', 'js', 'chapters', 'mugiwaras-blue-lock.json');

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mugiwarasoficial.com/'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', (err) => resolve({ status: 500, error: err.message }));
  });
}

async function main() {
  if (!fs.existsSync(chapFile)) {
    console.error("mugiwaras-blue-lock.json not found!");
    return;
  }
  
  const chData = JSON.parse(fs.readFileSync(chapFile, 'utf8'));
  const chList = chData.pt || [];
  console.log("Total chapters in Blue Lock:", chList.length);
  
  const ch344 = chList.find(c => String(c.number) === '344');
  if (!ch344) {
    console.log("Chapter 344 not found in JSON!");
    console.log("Available chapters:", chList.slice(0, 5).map(c => c.number));
    return;
  }
  
  console.log("Chapter 344 details:", ch344);
  
  console.log("Fetching Chapter HTML from:", ch344.chapterUrl);
  const res = await getUrl(ch344.chapterUrl);
  console.log("HTML fetch status:", res.status);
  if (res.status === 200) {
    const match = res.data.match(/redenovax\.com\/jump\/[^?]+\?a=([^&"]+)/);
    if (match) {
      console.log("Found image redirect match:", match[0]);
      console.log("Decoded image URL:", decodeURIComponent(match[1]));
    } else {
      console.log("No image redirect match found in HTML!");
      console.log("Printing head of body to check if we were blocked or got different HTML:");
      console.log(res.data.substring(0, 1000));
    }
  }
}

main();
