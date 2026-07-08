const crypto = require('crypto');

const hashes = [
  'e3b18179a41f377f3f01b87d328738fd', // page 1
  '0a0c7f50dbd520d44f16db59d252ce86'  // page 2
];

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// Test various formats
const formats = [
  n => String(n),
  n => String(n).padStart(2, '0'),
  n => String(n).padStart(3, '0'),
  n => `page-${n}`,
  n => `page-${String(n).padStart(2, '0')}`,
  n => `image-${n}`,
  n => `01-${n}`,
  n => `page_${n}`,
  n => `p_${n}`
];

console.log("Testing matches for Page 1 hash:", hashes[0]);
for (const fmt of formats) {
  const val = fmt(1);
  const hash = md5(val);
  if (hash === hashes[0]) {
    console.log(`MATCH found for Page 1! Value: "${val}"`);
  }
}

console.log("Testing matches for Page 2 hash:", hashes[1]);
for (const fmt of formats) {
  const val = fmt(2);
  const hash = md5(val);
  if (hash === hashes[1]) {
    console.log(`MATCH found for Page 2! Value: "${val}"`);
  }
}
