const fs = require('fs');
const path = require('path');

const suffixes = ['pt', 'es', 'fr', 'de', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'bn', 'id', 'ms', 'th', 'vi', 'tl'];

async function main() {
  console.log('🚀 Starting chapters splitting process...');

  const dataJsPath = path.join(__dirname, 'js', 'data.js');
  if (!fs.existsSync(dataJsPath)) {
    throw new Error('js/data.js not found');
  }

  // 1. Extract MANGA_DATA from js/data.js using bracket-depth parsing
  const dataJs = fs.readFileSync(dataJsPath, 'utf8');
  const arrayStart = dataJs.indexOf('const MANGA_DATA = [') + 'const MANGA_DATA = '.length;
  if (arrayStart < 'const MANGA_DATA = '.length) {
    throw new Error('Could not find const MANGA_DATA in js/data.js');
  }

  let depth = 0;
  let arrayEnd = arrayStart;
  for (let i = arrayStart; i < dataJs.length; i++) {
    if (dataJs[i] === '[') depth++;
    if (dataJs[i] === ']') {
      depth--;
      if (depth === 0) {
        arrayEnd = i + 1;
        break;
      }
    }
  }

  const jsonStr = dataJs.substring(arrayStart, arrayEnd);
  const mangaList = JSON.parse(jsonStr);
  console.log(`✅ Loaded ${mangaList.length} manga entries from js/data.js`);

  // Ensure output directory exists
  const outputDir = path.join(__dirname, 'js', 'chapters');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('📁 Created directory js/chapters/');
  }

  // 2. Load chapters.json (MangaFire chapters)
  const chaptersJsonPath = path.join(__dirname, 'js', 'chapters.json');
  let chaptersMap = {};
  if (fs.existsSync(chaptersJsonPath)) {
    console.log('📦 Loading js/chapters.json (this may take a few seconds)...');
    try {
      chaptersMap = JSON.parse(fs.readFileSync(chaptersJsonPath, 'utf8'));
      console.log(`✅ Loaded chapters.json with ${Object.keys(chaptersMap).length} entries.`);
    } catch (e) {
      console.error('⚠️ Error reading chapters.json:', e.message);
    }
  }

  // 3. Load mf-chapters-data.json (MangaFreak chapters)
  const mfChaptersPath = path.join(__dirname, 'js', 'mf-chapters-data.json');
  let mfChaptersMap = {};
  if (fs.existsSync(mfChaptersPath)) {
    console.log('📦 Loading js/mf-chapters-data.json...');
    try {
      mfChaptersMap = JSON.parse(fs.readFileSync(mfChaptersPath, 'utf8'));
      console.log(`✅ Loaded mf-chapters-data.json with ${Object.keys(mfChaptersMap).length} entries.`);
    } catch (e) {
      console.error('⚠️ Error reading mf-chapters-data.json:', e.message);
    }
  }

  let count = 0;

  // 4. Process each manga
  for (const manga of mangaList) {
    const data = {};

    // Check chapters.json (MangaFire)
    // Keys in chapters.json could be manga.id, manga.id-pt, manga.id-es, etc.
    const keysToCheck = [manga.id, ...suffixes.map(suff => `${manga.id}-${suff}`)];

    for (const key of keysToCheck) {
      if (chaptersMap[key]) {
        // Determine language
        let lang = 'en';
        for (const suff of suffixes) {
          if (key.endsWith('-' + suff)) {
            lang = suff;
            break;
          }
        }

        if (!data[lang]) data[lang] = [];
        const chs = chaptersMap[key].map(ch => ({
          id: ch.id,
          number: ch.number,
          title: ch.title || '',
          date: ch.releaseDate || '',
          pages: ch.pages || []
        }));
        data[lang].push(...chs);
      }
    }

    // Check mf-chapters-data.json (MangaFreak) using manga.slug
    if (mfChaptersMap[manga.slug]) {
      // If we don't have English chapters or they are empty, populate them from MangaFreak
      if (!data['en'] || data['en'].length === 0) {
        data['en'] = mfChaptersMap[manga.slug].map(ch => ({
          id: `${manga.id}-${ch.number}`,
          number: ch.number,
          title: ch.title || '',
          date: ch.date || '',
          pages: [] // to be dynamically discovered
        }));
      }
    }

    // Write individual file if it has chapters
    if (Object.keys(data).length > 0) {
      const filePath = path.join(outputDir, `${manga.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      count++;
    }
  }

  console.log(`\n🎉 Completed! Successfully split and wrote ${count} individual chapter JSON files.`);
  
  // 5. Shrink large JSON files to empty object to free space and prevent browser loads
  if (fs.existsSync(chaptersJsonPath)) {
    fs.writeFileSync(chaptersJsonPath, '{}', 'utf8');
    console.log('✅ Emptied chapters.json');
  }
  if (fs.existsSync(mfChaptersPath)) {
    fs.writeFileSync(mfChaptersPath, '{}', 'utf8');
    console.log('✅ Emptied mf-chapters-data.json');
  }
}

main().catch(console.error);
