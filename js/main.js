// ========== LOCAL STORAGE HELPERS ==========

const LS = {
  get(key, def = null) {
    try { const v = localStorage.getItem('ms_' + key); return v ? JSON.parse(v) : def; }
    catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('ms_' + key, JSON.stringify(val)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem('ms_' + key); } catch {}
  }
};

// Favorites
window.authFavorites = [];
window.currentUser = null;

function getFavorites() {
  if (window.currentUser) return window.authFavorites;
  return LS.get('favorites', []);
}
function toggleFavorite(mangaId) {
  if (window.currentUser) {
    const hasIt = window.authFavorites.includes(mangaId);
    if (hasIt) {
      window.authFavorites = window.authFavorites.filter(id => id !== mangaId);
    } else {
      window.authFavorites.push(mangaId);
    }
    fetch(`/api/manga/favorites?mangaId=${encodeURIComponent(mangaId)}`, { method: 'POST' }).catch(() => {});
    return !hasIt;
  }
  let faves = getFavorites();
  if (faves.includes(mangaId)) { faves = faves.filter(id => id !== mangaId); }
  else { faves.push(mangaId); }
  LS.set('favorites', faves);
  return faves.includes(mangaId);
}
function isFavorite(mangaId) { return getFavorites().includes(mangaId); }

// Continue Reading
function saveProgress(mangaId, chapterId, pageIndex, totalPages) {
  const data = LS.get('continue', {});
  data[mangaId] = { chapterId, pageIndex, totalPages, updatedAt: Date.now() };
  LS.set('continue', data);
  if (window.currentUser) {
    if (window.authHistory) {
      window.authHistory[mangaId] = data[mangaId];
    }
    fetch('/api/manga/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaId, chapterId, pageIndex, totalPages })
    }).catch(() => {});
  }
}
function getProgress(mangaId) {
  return getAllProgress()[mangaId] || null;
}
function getAllProgress() {
  if (window.currentUser && window.authHistory) {
    return window.authHistory;
  }
  return LS.get('continue', {});
}

// Reader Settings
function getReaderSettings() {
  return LS.get('readerSettings', {
    direction: 'ltr',
    pageMode: 'scroll',
    brightness: 100,
    bgColor: '#000000'
  });
}
function saveReaderSettings(settings) {
  LS.set('readerSettings', settings);
}

// ========== TOAST ==========

function showToast(message, duration = 2500) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = message;
  toast.classList.add('show');
  clearTimeout(toast._hide);
  toast._hide = setTimeout(() => toast.classList.remove('show'), duration);
}

// ========== BACK TO TOP ==========

function initBackToTop() {
  const btn = document.createElement('button');
  btn.className = 'back-top';
  btn.innerHTML = '↑';
  btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.appendChild(btn);

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        btn.classList.toggle('visible', window.scrollY > 400);
        ticking = false;
      });
      ticking = true;
    }
  });
}

// ========== TEMPO RELATIVO + RECÊNCIA ==========

// Dados de recência (home.json): { updated: { id: {ch, date} }, recent: [...] }
window.HOME_DATA = window.HOME_DATA || null;

function relativeTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 90000) return 'agora';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `há ${mo} ${mo > 1 ? 'meses' : 'mês'}`;
  const y = Math.floor(mo / 12);
  return `há ${y} ${y > 1 ? 'anos' : 'ano'}`;
}

// Meta do card: "Cap X • há Yh" quando há dado de recência; senão "N caps".
function cardMetaHtml(manga) {
  const info = (window.HOME_DATA && window.HOME_DATA.updated && window.HOME_DATA.updated[manga.id]) || null;
  const caps = manga.chaptersCount || (manga.chapters && manga.chapters.length) || 0;
  if (info) {
    const time = info.date ? relativeTime(info.date) : '';
    return `<span class="ch-badge">Cap. ${info.ch}</span>` + (time ? `<span class="ago">${time}</span>` : '');
  }
  return `<span class="caps">${caps} caps</span>`;
}

// Renderiza uma fileira horizontal rolável (estilo streaming).
function renderCarousel(list, containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = '';
  c.classList.add('row-carousel');
  if (!list || list.length === 0) {
    c.innerHTML = '<p style="color:var(--text-muted);padding:24px">Nada por aqui ainda.</p>';
    return;
  }
  list.forEach(m => c.appendChild(createMangaCard(m)));
}

// ========== MANGA CARD COMPONENT ==========

function createMangaCard(manga, listView = false) {
  if (listView) return createMangaCardList(manga);

  const card = document.createElement('a');
  card.className = 'manga-card';
  const currentLang = LS.get('global_lang', 'all');
  const langSuffix = currentLang !== 'all' ? `&lang=${currentLang}` : '';
  card.href = `manga.html?id=${manga.id}${langSuffix}`;

  const badge = manga.status === 'ongoing'
    ? '<span class="badge ongoing">Em andamento</span>'
    : '<span class="badge completed">Completo</span>';

  const fav = isFavorite(manga.id);
  const metaHtml = cardMetaHtml(manga);

  card.innerHTML = `
    <div class="cover">
      <img src="${manga.cover}" alt="${manga.title}" referrerPolicy="no-referrer" loading="lazy" onerror="this.src='https://placehold.co/300x400/1a1a1a/444?text=?'">
      ${badge}
      <button class="fav-btn ${fav ? 'favorited' : ''}" onclick="event.preventDefault();event.stopPropagation();toggleFavCard('${manga.id}', this)" title="${fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">${fav ? '♥' : '♡'}</button>
    </div>
    <div class="info">
      <h3>${manga.title}</h3>
      <div class="meta">${metaHtml}</div>
    </div>
  `;
  return card;
}

function createMangaCardList(manga) {
  const card = document.createElement('a');
  card.className = 'manga-card list';
  const currentLang = LS.get('global_lang', 'all');
  const langSuffix = currentLang !== 'all' ? `&lang=${currentLang}` : '';
  card.href = `manga.html?id=${manga.id}${langSuffix}`;

  const badge = manga.status === 'ongoing' ? '<span class="badge ongoing">Em andamento</span>' : '<span class="badge completed">Completo</span>';

  card.innerHTML = `
    <div class="cover" style="position:relative">
      <img src="${manga.cover}" alt="${manga.title}" referrerPolicy="no-referrer" loading="lazy" onerror="this.src='https://placehold.co/300x400/1a1a1a/444?text=?'">
      ${badge}
    </div>
    <div class="info">
      <h3>${manga.title}</h3>
      <span style="font-size:0.78rem;color:var(--text-muted)">${manga.altTitle || ''}</span>
      <div class="desc">${(manga.description || '').substring(0, 150)}...</div>
      <div class="tags">${(manga.genres || ['Manga']).slice(0, 4).map(g => `<span>${g}</span>`).join('')}</div>
      <div class="meta" style="margin-top:6px">
        <span class="rating">★ ${manga.rating || 0}</span>
        <span>${manga.chaptersCount || (manga.chapters && manga.chapters.length) || 0} caps</span>
        <span>${manga.year || '-'}</span>
        <span>${manga.author || 'Desconhecido'}</span>
      </div>
    </div>
  `;
  return card;
}

function toggleFavCard(id, btn) {
  const nowFav = toggleFavorite(id);
  btn.classList.toggle('favorited', nowFav);
  btn.textContent = nowFav ? '♥' : '♡';
  btn.title = nowFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
  showToast(nowFav ? 'Adicionado aos <span class="toast-accent">favoritos</span>' : 'Removido dos <span class="toast-accent">favoritos</span>');
}

function renderMangaGrid(mangaList, containerId, listView = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  container.className = 'manga-grid' + (listView ? ' list-view' : '');
  if (mangaList.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:60px 20px;grid-column:1/-1">Nenhum mangá encontrado.</p>';
    return;
  }
  mangaList.forEach(m => container.appendChild(createMangaCard(m, listView)));
}

// ========== CHAPTER ITEM ==========

function createChapterItem(chapter, mangaId, index) {
  const item = document.createElement('div');
  item.className = 'chapter-item';
  item.onclick = () => window.location.href = `reader.html?manga=${mangaId}&chapter=${chapter.id}`;
  item.innerHTML = `
    <div class="left">
      <span class="ch-num">${chapter.number}</span>
      <span class="ch-title">${chapter.title}</span>
    </div>
    <div class="right">
      <span class="ch-date">${chapter.date}</span>
    </div>
  `;
  return item;
}

function renderChapterList(chapters, mangaId, containerId = 'chapterList') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  chapters.forEach((c, i) => container.appendChild(createChapterItem(c, mangaId, i)));
}

// ========== MOBILE HEADER ==========

document.addEventListener('DOMContentLoaded', () => {
  const cp = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const cleanHref = href.split('?')[0];
    if (cleanHref === cp) a.classList.add('active');
  });

  // Preserve language parameter in all relative links dynamically
  const langVal = LS.get('global_lang', 'all');
  if (langVal !== 'all') {
    document.querySelectorAll('a').forEach(a => {
      let href = a.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript:') && !href.includes('lang=')) {
        const separator = href.includes('?') ? '&' : '?';
        a.setAttribute('href', href + separator + 'lang=' + langVal);
      }
    });
  }

  initBackToTop();
  renderHeaderControls();
});

// ========== SEARCH ==========

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('searchInput');
  const dropdown = document.getElementById('searchDropdown');
  if (!input) return;

  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();

    if (!q) {
      if (dropdown) { dropdown.classList.remove('active'); dropdown.innerHTML = ''; }
      return;
    }

    timer = setTimeout(() => {
      const results = searchManga(q).slice(0, 6);
      if (!dropdown) return;
      if (results.length === 0) {
        dropdown.innerHTML = '<div class="s-item"><div class="s-info"><h4>Nenhum resultado</h4></div></div>';
      } else {
        dropdown.innerHTML = results.map(m => `
          <div class="s-item" onclick="window.location.href='manga.html?id=${m.id}'">
            <img src="${m.cover}" alt="${m.title}" referrerPolicy="no-referrer" onerror="this.src='https://placehold.co/36x48/1a1a1a/444?text=N/A'">
            <div class="s-info">
              <h4>${m.title}</h4>
              <span>${(m.genres || []).slice(0, 3).join(' · ') || m.chaptersCount + ' caps'}</span>
            </div>
          </div>
        `).join('');
      }
      dropdown.classList.add('active');
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-bar') && dropdown) dropdown.classList.remove('active');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (q) window.location.href = `catalog.html?q=${encodeURIComponent(q)}`;
    }
  });
});

// ========== GLOBAL CONTROLS (LANG + ADULT) ==========
function renderHeaderControls() {
  const headerInner = document.querySelector('.header-inner');
  if (!headerInner) return;

  // Limpa elementos anteriores injetados
  headerInner.querySelectorAll('.header-controls, .drawer-header, .drawer-options').forEach(el => el.remove());

  const currentLang = LS.get('global_lang', 'all');
  const adultMode = LS.get('adult_mode', false);

  const userHtml = window.currentUser
    ? `<div class="user-profile-menu">
         <button class="username-btn" onclick="toggleUserDropdown()" title="Minha Conta">👤 ${window.currentUser.username}</button>
         <div class="user-dropdown" id="userDropdown">
           <a href="profile.html">👤 Perfil</a>
           ${window.currentUser.role === 'admin' ? '<a href="admin.html">⚙️ Painel Admin</a>' : ''}
           <a href="javascript:void(0)" onclick="handleLogout()">🚪 Sair</a>
         </div>
       </div>`
    : `<button onclick="openAuthModal()" class="auth-toggle-btn" title="Entrar / Cadastrar">👤 Entrar</button>`;

  const langHtml = `
    <div class="global-lang-selector">
      <button onclick="setGlobalLang('all')" class="lang-btn ${currentLang === 'all' ? 'active' : ''}" title="Todos os Idiomas">🌐 Todos</button>
      <button onclick="setGlobalLang('pt')" class="lang-btn ${currentLang === 'pt' ? 'active' : ''}" title="Apenas em Português">🇵🇹 PT</button>
      <button onclick="setGlobalLang('en')" class="lang-btn ${currentLang === 'en' ? 'active' : ''}" title="Apenas em Inglês">🇬🇧 EN</button>
    </div>
  `;

  const adultHtml = `
    <button onclick="toggleAdultMode()" class="adult-toggle-btn ${adultMode ? 'active' : ''}" title="Modo +18 (Conteúdo Adulto)">
      🔞 ${adultMode ? 'Modo +18' : 'Modo Livre'}
    </button>
  `;

  const menu = headerInner.querySelector('.header-menu');

  if (window.innerWidth <= 900 && menu) {
    // Layout mobile: Usuário no topo, links no meio (já estáticos), opções na base
    const drawerHeader = document.createElement('div');
    drawerHeader.className = 'drawer-header';
    drawerHeader.innerHTML = `
      <div class="drawer-user">${userHtml}</div>
      <button class="drawer-close-btn" onclick="toggleHeaderMenu()" aria-label="Fechar menu">✕</button>
    `;
    menu.prepend(drawerHeader);

    const drawerOptions = document.createElement('div');
    drawerOptions.className = 'drawer-options';
    drawerOptions.innerHTML = langHtml + adultHtml;
    menu.appendChild(drawerOptions);
  } else {
    // Layout desktop: linha única contínua
    const controls = document.createElement('div');
    controls.className = 'header-controls';
    controls.innerHTML = langHtml + adultHtml + userHtml;

    if (menu) {
      menu.appendChild(controls);
    } else {
      const searchBar = headerInner.querySelector('.search-bar');
      if (searchBar) headerInner.insertBefore(controls, searchBar);
      else headerInner.appendChild(controls);
    }
  }
}

// ========== MENU MOBILE (drawer do header) ==========
function toggleHeaderMenu() {
  const menu = document.getElementById('headerMenu');
  const overlay = document.getElementById('headerMenuOverlay');
  if (!menu) return;
  const open = menu.classList.toggle('open');
  if (overlay) overlay.classList.toggle('open', open);
  document.body.classList.toggle('no-scroll', open);
}
window.toggleHeaderMenu = toggleHeaderMenu;

// Fecha o drawer ao voltar para desktop e reconstrói controles conforme largura da tela
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) {
    const menu = document.getElementById('headerMenu');
    const overlay = document.getElementById('headerMenuOverlay');
    if (menu) menu.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('no-scroll');
  }
  renderHeaderControls();
});

window.setGlobalLang = function(lang) {
  LS.set('global_lang', lang);
  const url = new URL(window.location.href);
  if (lang === 'all') {
    url.searchParams.delete('lang');
  } else {
    url.searchParams.set('lang', lang);
  }
  window.location.href = url.toString();
};

window.toggleAdultMode = function() {
  const current = LS.get('adult_mode', false);
  if (!current) {
    showAdultConfirmationModal(() => {
      LS.set('adult_mode', true);
      showToast('Modo +18 <span class="toast-accent">ativado</span>. Recarregando...');
      setTimeout(() => window.location.reload(), 800);
    });
  } else {
    LS.set('adult_mode', false);
    showToast('Modo +18 <span class="toast-accent">desativado</span>. Recarregando...');
    setTimeout(() => window.location.reload(), 800);
  }
};

function showAdultConfirmationModal(onConfirm, onCancel) {
  let modal = document.getElementById('adultModal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'adultModal';
  modal.className = 'adult-modal-overlay';
  modal.innerHTML = `
    <div class="adult-modal-card glass">
      <div class="modal-header">
        <span class="warning-icon">🔞</span>
        <h3>Aviso de Conteúdo Adulto (+18)</h3>
      </div>
      <div class="modal-body">
        <p>Esta seção contém materiais com classificação indicativa de <strong>18 anos ou mais</strong> (incluindo gêneros como Hentai, Adulto, Ecchi, Smut, Mature ou selo HOT).</p>
        <p>Ao clicar em confirmar, você declara voluntariamente ser maior de 18 anos de idade e concorda em visualizar esse tipo de conteúdo.</p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="adultCancelBtn">Cancelar</button>
        <button class="btn btn-primary btn-confirm" id="adultConfirmBtn">Confirmar (+18)</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('adultCancelBtn').onclick = () => {
    modal.remove();
    if (onCancel) onCancel();
  };

  document.getElementById('adultConfirmBtn').onclick = () => {
    modal.remove();
    onConfirm();
  };
}

// ========== PWA: SERVICE WORKER ==========
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ========== AUTHENTICATION LOGIC ==========

window.toggleUserDropdown = function() {
  document.getElementById('userDropdown')?.classList.toggle('open');
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.user-profile-menu')) {
    document.getElementById('userDropdown')?.classList.remove('open');
  }
});

window.openAuthModal = function(isRegister = false) {
  let modal = document.getElementById('authModal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'authModal';
  modal.className = 'auth-modal-overlay';
  
  const title = isRegister ? 'Criar Conta' : 'Entrar na Conta';
  const submitText = isRegister ? 'Cadastrar' : 'Entrar';
  const switchHtml = isRegister
    ? 'Já possui uma conta? <a href="javascript:void(0)" onclick="openAuthModal(false)">Faça Login</a>'
    : 'Não tem uma conta? <a href="javascript:void(0)" onclick="openAuthModal(true)">Cadastre-se</a>';

  modal.innerHTML = `
    <div class="auth-modal-card" style="position:relative">
      <button class="auth-close-btn" onclick="closeAuthModal()">✕</button>
      <h3>${title}</h3>
      <form onsubmit="handleAuthSubmit(event, ${isRegister})">
        <div class="auth-form-group">
          <label for="authUsername">Nome de Usuário</label>
          <input type="text" id="authUsername" required placeholder="Ex: bankai_user" autocomplete="username">
        </div>
        <div class="auth-form-group">
          <label for="authPassword">Senha</label>
          <input type="password" id="authPassword" required placeholder="Mínimo 6 caracteres" autocomplete="current-password">
        </div>
        <button type="submit" class="btn btn-primary btn-submit">${submitText}</button>
      </form>
      <div class="auth-switch-text">${switchHtml}</div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.classList.add('no-scroll');
};

window.closeAuthModal = function() {
  document.getElementById('authModal')?.remove();
  document.body.classList.remove('no-scroll');
};

window.handleAuthSubmit = async function(e, isRegister) {
  e.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;

  const url = isRegister ? '/api/auth/register' : '/api/auth/login';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(`❌ ${data.error || 'Erro na autenticação'}`);
      return;
    }

    showToast(`✅ ${isRegister ? 'Cadastro realizado! Fazendo login...' : 'Bem-vindo de volta!'}`);
    closeAuthModal();

    if (isRegister) {
      // Se for registro, faz login automaticamente
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const loginData = await loginRes.json();
      if (loginRes.ok) {
        window.currentUser = loginData.user;
      }
    } else {
      window.currentUser = data.user;
    }

    if (window.currentUser) {
      await fetchFavorites();
      renderHeaderControls();
      // Atualiza a página atual se estiver exibindo favoritos
      if (window.location.pathname.includes('catalog.html') && typeof applyFilters === 'function') {
        applyFilters();
      } else {
        window.location.reload();
      }
    }
  } catch (err) {
    showToast('❌ Falha na conexão com o servidor');
  }
};

window.handleLogout = async function() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.currentUser = null;
    window.authFavorites = [];
    showToast('🚪 Até logo!');
    renderHeaderControls();
    window.location.reload();
  } catch (e) {
    showToast('❌ Erro ao deslogar');
  }
};

window.fetchFavorites = async function() {
  try {
    const res = await fetch('/api/manga/favorites');
    if (res.ok) {
      const data = await res.json();
      window.authFavorites = data.favorites || [];
    }
  } catch (e) {
    console.error('Erro ao buscar favoritos:', e);
  }
};

window.fetchHistory = async function() {
  try {
    const res = await fetch('/api/manga/history');
    if (res.ok) {
      const data = await res.json();
      window.authHistory = data.history || {};
    }
  } catch (e) {
    console.error('Erro ao buscar histórico:', e);
  }
};

window.checkAuth = async function() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        window.currentUser = data.user;
        await fetchFavorites();
        await fetchHistory();
        renderHeaderControls();
        window.authChecked = true;
        return;
      }
    }
  } catch (e) {
    console.error('Erro ao verificar autenticação:', e);
  }
  window.currentUser = null;
  window.authChecked = true;
};

// Registrar view de mangá
window.registerMangaView = function(mangaId) {
  fetch(`/api/manga/views?mangaId=${encodeURIComponent(mangaId)}`, { method: 'POST' })
    .catch(() => {});
};

// Iniciar verificação de autenticação na carga da página
window.addEventListener('DOMContentLoaded', () => {
  window.checkAuth();
});
