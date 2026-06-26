const { execSync } = require('child_process');
const path = require('path');

function runCommand(cmd) {
  console.log(`\n🚀 Executando: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: __dirname });
    console.log(`✅ Sucesso: ${cmd}`);
  } catch (e) {
    console.error(`❌ Erro ao executar ${cmd}: ${e.message}`);
  }
}

function main() {
  console.log('🏁 INICIANDO PIPELINE DE ATUALIZAÇÃO BILINGUE (MangaSurge)');
  console.log('========================================================');
  
  // 1. Atualiza listagem incremental do MangaFreak (Inglês)
  runCommand('node mf-scraper.cjs --update');
  
  // 2. Extrai novos capítulos do MangaFreak
  runCommand('node mf-chapter-scraper.cjs');
  
  // 3. Atualiza lançamentos e capítulos do Leitura Manga (Português)
  runCommand('node leituramanga-scraper.cjs');
  
  // 3.5. Atualiza lançamentos e capítulos do MangaLivre (Português)
  runCommand('node mangalivre-scraper.cjs');
  
  // 4. Une metadados de capas, sinopse, autores e gera o data.js atualizado
  runCommand('node merge-meta.cjs');
  
  console.log('\n========================================================');
  console.log('🎉 PIPELINE DE ATUALIZAÇÃO CONCLUÍDO COM SUCESSO!');
}

main();
