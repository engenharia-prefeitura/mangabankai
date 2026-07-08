// start.cjs — sobe o site (porta 3000) e o admin-server (porta 3001) juntos.
// Uso:  npm start    (ou:  node start.cjs)
// Ctrl+C encerra os dois.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const isWin = process.platform === 'win32';

// Garante um js/data-lite.js válido e fresco antes de servir as páginas.
// Se a geração enxuta falhar por qualquer motivo, cai para uma cópia integral
// do data.js (assim o site nunca quebra por falta/corrupção do lite).
(function ensureLite() {
  try {
    const r = require('./build-lite.cjs').buildLite();
    console.log(`🪶 data-lite.js: ${r.mangas} mangás (${(r.after/1048576).toFixed(2)} MB)`);
  } catch (e) {
    // NÃO sobrescreve data-lite.js com data.js corrompido — mantém o data-lite.js existente
    console.log('⚠️ build-lite.cjs falhou —', e.message, '— mantendo data-lite.js existente.');
  }
})();

// Gera js/home.json (recência real) para a home (fileira "Atualizados").
(function ensureHome() {
  try {
    const r = require('./build-home.cjs').buildHome();
    console.log(`🏠 home.json: ${r.recent} recentes (${r.comData}/${r.mangas} com data)`);
  } catch (e) { console.log('⚠️ home.json:', e.message); }
})();

const tasks = [
  { name: 'SITE ', cmd: 'npx', args: ['http-server', '.', '-p', '3000', '-c-1', '--cors'] },
  { name: 'ADMIN', cmd: 'node', args: ['admin-server.cjs'] },
];

const children = [];
let shuttingDown = false;

function prefixWrite(stream, name, chunk) {
  const parts = chunk.toString().split(/\r?\n/);
  parts.forEach((line, i) => {
    if (i === parts.length - 1 && line === '') return; // ignora linha vazia final
    stream.write(`[${name}] ${line}\n`);
  });
}

function killAll(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      if (isWin) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch (e) { /* ignore */ }
  }
  setTimeout(() => process.exit(exitCode || 0), 600);
}

for (const t of tasks) {
  const child = spawn(t.cmd, t.args, { cwd: __dirname, shell: isWin });
  child.stdout.on('data', d => prefixWrite(process.stdout, t.name, d));
  child.stderr.on('data', d => prefixWrite(process.stderr, t.name, d));
  child.on('error', err => {
    console.error(`[launcher] Falha ao iniciar "${t.name.trim()}": ${err.message}`);
    killAll(1);
  });
  child.on('exit', code => {
    if (!shuttingDown) {
      console.log(`\n[launcher] "${t.name.trim()}" encerrou (código ${code}). Finalizando o outro...`);
      killAll(code || 0);
    }
  });
  children.push(child);
}

console.log('▶  Site   → http://localhost:3000');
console.log('▶  Painel → http://localhost:3000/admin.html   (API em :3001)');
console.log('   (Ctrl+C encerra os dois)\n');

process.on('SIGINT', () => killAll(0));
process.on('SIGTERM', () => killAll(0));
