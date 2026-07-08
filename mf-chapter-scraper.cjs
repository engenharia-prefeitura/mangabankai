const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'https://ww2.mangafreak.me';
const DELAY = 200;
const CONCURRENCY = 5;
const RESUME_FILE = path.join(__dirname, 'js', 'mf-chapters-progress.json');
const OUTPUT_FILE = path.join(__dirname, 'js', 'mf-chapters-data.json');
// Teto de obras EXISTENTES re-scrapeadas por execução quando a contagem de
// capítulos da lista cresceu (evita re-scrape gigante na 1ª execução). --all: sem teto.
const FULL = process.argv.includes('--all');
const REFRESH_MAX = parseInt(process.env.MF_REFRESH_MAX || (FULL ? '999999' : '400'), 10);

const mangaList = require(path.join(__dirname, 'js', 'mf-manga-list.json'));

function fetch(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        res.resume(); // descarta o corpo para liberar o socket, senão o processo nunca encerra
        fetch(next, redirects + 1).then(resolve).catch(reject);
        return;
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Timeout: ${url}`)));
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

let processed = new Set();
// counts[slug] = contagem de capítulos que a lista mostrava na última vez que
// escrapeamos este mangá. Usada para detectar crescimento genuíno (capítulo
// novo) sem re-scrape perpétuo por divergência de contagem.
let counts = {};

if (fs.existsSync(RESUME_FILE)) {
  const saved = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
  processed = new Set(saved.processed || []);
  counts = saved.counts || {};
  console.log(`Resuming: ${processed.size} already processed`);
}

function saveProgress() {
  fs.writeFileSync(RESUME_FILE, JSON.stringify({ processed: [...processed], counts }), 'utf8');
}

function extractChapters(html, slug) {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const chapters = [];
  
  // Parse table rows: <tr><td><a href="/Read1_{slug}_{ch}">Chapter X - Title</a></td><td>DATE</td></tr>
  const tableRegex = new RegExp(
    `<tr>\\s*<td>\\s*<a\\s+href="/Read\\d+_${escaped}_([^"]+)"[^>]*>\\s*Chapter\\s+\\d+(?:[a-z])?\\s*[-:]?\\s*([^<]*)</a>\\s*</td>\\s*<td>([^<]*)</td>`,
    'gi'
  );
  
  let match;
  while ((match = tableRegex.exec(html)) !== null) {
    chapters.push({
      number: match[1],
      title: match[2].trim(),
      date: match[3].trim()
    });
  }
  
  // Deduplicate
  const seen = new Set();
  return chapters.filter(c => {
    const k = c.number;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function mangaIdOf(manga) {
  return manga.id || manga.slug.toLowerCase().replace(/_/g, '-');
}

// Quantos capítulos a lista indica a MAIS do que na última vez que escrapeamos
// este mangá. Sinal barato (usa a contagem já capturada por mf-scraper), sem
// fetch extra, e sem churn perpétuo (compara com o último visto, não com o site).
function chapterGap(manga) {
  const listed = parseInt(manga.chapters, 10) || 0;
  return listed - (counts[manga.slug] || 0);
}

async function processManga(manga) {
  const slug = manga.slug;

  try {
    const html = await fetch(`${BASE}/Manga/${slug}`);
    const chapters = extractChapters(html, slug);
    
    if (chapters.length > 0) {
      const mangaId = manga.id || slug.toLowerCase().replace(/_/g, '-');
      const targetDir = path.join(__dirname, 'js', 'chapters');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const targetFile = path.join(targetDir, `${mangaId}.json`);
      
      let existing = {};
      if (fs.existsSync(targetFile)) {
        try {
          existing = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
        } catch(e) {}
      }
      
      const newEnChapters = chapters.map(ch => ({
        id: `${mangaId}-${ch.number}`,
        number: ch.number,
        title: ch.title || '',
        date: ch.date || '',
        pages: []
      }));
      
      existing['en'] = newEnChapters;

      fs.writeFileSync(targetFile, JSON.stringify(existing, null, 2), 'utf8');
      // Registra a contagem vista na lista → base para detectar crescimento futuro.
      counts[slug] = parseInt(manga.chapters, 10) || newEnChapters.length;
    }

    processed.add(slug);
    const pct = ((processed.size / mangaList.length) * 100).toFixed(1);
    process.stdout.write(`\r${pct}% - ${slug}: ${chapters.length} chs        `);
    
  } catch (err) {
    console.log(`\n${slug}: ERROR ${err.message}`);
    processed.add(slug);
  }
  
  if (processed.size % 50 === 0) saveProgress();
}

async function main() {
  console.log(`=== Fase 2: Extraindo capítulos de ${mangaList.length} mangás ===`);

  // NOVOS — nunca processados. Sempre entram.
  const novos = mangaList.filter(m => !processed.has(m.slug));
  // REFRESH — já processados mas cuja lista indica MAIS capítulos do que temos
  // salvo (ganharam capítulo novo). Prioriza o maior atraso e limita por
  // REFRESH_MAX para não re-scrapear tudo de uma vez.
  const refresh = mangaList
    .filter(m => processed.has(m.slug))
    .map(m => ({ m, gap: chapterGap(m) }))
    .filter(x => x.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, REFRESH_MAX)
    .map(x => x.m);

  const toProcess = [...novos, ...refresh];
  console.log(`Pendentes: ${novos.length} novos + ${refresh.length} com capítulos novos (teto refresh ${REFRESH_MAX}) = ${toProcess.length}`);

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(m => processManga(m).then(() => delay(DELAY))));
  }
  
  saveProgress();
  
  console.log(`\n✅ Concluído! ${processed.size}/${mangaList.length} mangás processados`);
  
  const chaptersDir = path.join(__dirname, 'js', 'chapters');
  const files = fs.existsSync(chaptersDir) ? fs.readdirSync(chaptersDir).filter(f => f.endsWith('.json')) : [];
  console.log(`📚 Mangás com capítulos (arquivos): ${files.length}`);
  console.log(`📁 Dados salvos individualmente em js/chapters/`);
}

// exit explícito: garante que nenhum socket esquecido segure o processo aberto
main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
