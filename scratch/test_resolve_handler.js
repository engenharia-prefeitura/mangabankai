const handler = require('../api/resolve-chapter.js');

// Mock request and response objects for Blue Lock chapter 344
const req = {
  method: 'GET',
  query: {
    mangaId: 'mugiwaras-blue-lock',
    slug: 'blue-lock',
    chNum: '344',
    lang: 'pt'
  },
  headers: {
    host: 'localhost:3000'
  }
};

const res = {
  statusCode: 200,
  jsonObj: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(obj) {
    this.jsonObj = obj;
    return this;
  }
};

async function main() {
  console.log("Simulating API request for Blue Lock 344...");
  await handler(req, res);
  
  console.log("Response Status:", res.statusCode);
  if (res.jsonObj) {
    console.log("Response Success:", res.jsonObj.success);
    if (res.jsonObj.success) {
      console.log(`Resolved ${res.jsonObj.pages.length} pages.`);
      console.log("First 3 page URLs:");
      console.log(res.jsonObj.pages.slice(0, 3));
    } else {
      console.log("Error details:", res.jsonObj.error);
    }
  } else {
    console.log("No JSON response returned.");
  }
}

main().catch(console.error);
