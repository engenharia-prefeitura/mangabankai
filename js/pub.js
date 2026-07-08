const ADS = (function () {

  // Injeta o arquivo ad-banner.html via iframe local com os parâmetros do anúncio.
  // Isso garante 100% de medibilidade e consistência na origem (same-origin).
  function _iframe(container, type, key, w, h, host) {
    if (!container) return;
    
    const t0 = performance.now();
    const label = w ? (w + '×' + h) : 'native';

    container.classList.add('ad-loading');
    const stopShimmer = setTimeout(function () { container.classList.remove('ad-loading'); }, 6000);

    const fr = document.createElement('iframe');
    fr.setAttribute('frameborder', '0');
    fr.setAttribute('scrolling', 'no');
    fr.setAttribute('marginwidth', '0');
    fr.setAttribute('marginheight', '0');
    
    if (w) {
      fr.width  = w;
      fr.height = h;
      fr.style.cssText = 'border:0;display:block;width:' + w + 'px;height:' + h + 'px;position:relative;z-index:1;';
    } else {
      fr.style.cssText = 'border:0;display:block;width:100%;min-height:' + (h || 90) + 'px;position:relative;z-index:1;';
    }
    
    let src = `/ad-banner.html?key=${encodeURIComponent(key)}`;
    if (type) src += `&type=${encodeURIComponent(type)}`;
    if (w) src += `&w=${w}`;
    if (h) src += `&h=${h}`;
    if (host) src += `&host=${encodeURIComponent(host)}`;
    
    fr.src = src;
    fr.addEventListener('load', function () {
      setTimeout(function () { clearTimeout(stopShimmer); container.classList.remove('ad-loading'); }, 1200);
      console.debug('[ADS] ' + label + ' carregado em ' + Math.round(performance.now() - t0) + 'ms');
    }, {once: true});
    
    container.innerHTML = '';
    container.appendChild(fr);
  }

  return {

    // ── LAZY LOAD (A1) ───────────────────────────────────────────────────
    // Só carrega o anúncio quando o container chega perto da viewport (600px
    // antes). Evita que ads abaixo da dobra disputem banda com o primeiro ad
    // visível — o de cima aparece mais rápido. fn recebe o container.
    lazy(container, fn) {
      if (!container) return;
      if (!('IntersectionObserver' in window)) { fn(container); return; }
      const obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { obs.disconnect(); fn(container); }
        });
      }, { rootMargin: '600px 0px' });
      obs.observe(container);
    },

    // ── POPUNDER ─────────────────────────────────────────────────────────
    renderPopunder(key) {
      if (!key) {
        // Auto-detecta mangá ou capítulo atual a partir da URL/Pathname
        const p = new URLSearchParams(window.location.search);
        const parts = window.location.pathname.split('/').filter(Boolean);
        let mangaId = p.get('manga') || p.get('id');
        let chapterId = p.get('cap') || p.get('chapter');
        if (!mangaId && parts[0] === 'manga' && parts.length >= 2) {
          mangaId = parts[1];
          if (parts.length >= 3) chapterId = parts[2];
        }
        
        if (mangaId && chapterId) {
          key = 'ch_' + mangaId + '_' + chapterId;
        } else if (mangaId) {
          key = 'manga_' + mangaId;
        }
      }
      
      const storageKey = key ? ('_adp_' + key) : '_adp';
      if (sessionStorage.getItem(storageKey)) return;
      sessionStorage.setItem(storageKey, '1');
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://pl30096192.effectivecpmnetwork.com/61/a3/64/61a364624a5d9564624c731fa93801d7.js';
      document.head.appendChild(s);
    },

    // ── SOCIAL BAR ───────────────────────────────────────────────────────
    renderSocialBar() {
      if (window._socialBarLoaded) return;
      window._socialBarLoaded = true;
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://pl30096195.effectivecpmnetwork.com/63/b7/16/63b716721a507990403b659bbf920045.js';
      document.body.appendChild(s);
    },

    // ── DIRECT LINK (ADSTERRA) ───────────────────────────────────────────
    getDirectLink() {
      return 'https://www.effectivecpmnetwork.com/j1s8jdu63?key=63bb0cb2e3a95b2c0447914593cc6747';
    },

    // ── BANNER NATIVO (ADSTERRA DIRECT LINK) ─────────────────────────────
    renderNative(container) {
      if (!container) return;
      _iframe(container, 'native', '3bf02e75245e7cb6a59d7847d032a951', 0, 250, 'pl30096193.effectivecpmnetwork.com');
    },

    // ── BANNER 300×250 / 160×300 (ADSTERRA DIRECT LINK) ──────────────────
    renderBanner300(container) {
      if (!container) return;
      _iframe(container, 'banner', '008cabfc613fdd6ea56d84d6915d013b', 160, 300);
    },

    // ── BANNER 728×90 (ADSTERRA DIRECT LINK) ─────────────────────────────
    renderBanner728(container) {
      if (!container) return;
      _iframe(container, 'banner', 'b23ec25cb230921662d8cbac7ac95c50', 728, 90);
    },

    // ── PÁGINA MID-CAPÍTULO (3 ads empilhados) ───────────────────────────
    buildMidPage() {
      const wrap = document.createElement('div');
      wrap.className = 'reader-ad-page reader-ad-page--mid';
      wrap.innerHTML =
        '<span class="ad-page-label">publicidade</span>' +
        '<div class="ad-slot ad-s728"></div>' +
        '<div class="ad-slot ad-s300"></div>' +
        '<div class="ad-slot ad-snat"></div>';
      return wrap;
    },

    // ── PÁGINA FIM-CAPÍTULO (1 ad) ───────────────────────────────────────
    buildEndPage() {
      const wrap = document.createElement('div');
      wrap.className = 'reader-ad-page reader-ad-page--end';
      wrap.innerHTML =
        '<span class="ad-page-label">publicidade</span>' +
        '<div class="ad-slot ad-s300"></div>';
      return wrap;
    },

    fillMidPage(wrap) {
      ADS.renderBanner728(wrap.querySelector('.ad-s728'));
      ADS.renderBanner300(wrap.querySelector('.ad-s300'));
      ADS.renderNative(wrap.querySelector('.ad-snat'));
    },

    fillEndPage(wrap) {
      ADS.renderBanner300(wrap.querySelector('.ad-s300'));
    },

    // ── TELA DE TRANSIÇÃO ENTRE CAPÍTULOS ────────────────────────────────
    showTransition(btnLabel, onConfirm) {
      const prev = document.getElementById('_adTransition');
      if (prev) prev.remove();

      const screen = document.createElement('div');
      screen.id = '_adTransition';
      screen.className = 'ad-transition-screen';

      const inner = document.createElement('div');
      inner.className = 'ad-transition-inner';
      inner.innerHTML =
        '<span class="ad-page-label">publicidade</span>' +
        '<div class="ad-slot ad-s728 ad-tr728"></div>' +
        '<div class="ad-slot ad-s300 ad-tr300"></div>' +
        '<div class="ad-slot ad-snat ad-trnat"></div>';

      const btn = document.createElement('button');
      btn.className = 'ad-transition-btn';
      btn.disabled = true;
      btn.style.cursor = 'not-allowed';
      btn.style.opacity = '0.6';

      let timeLeft = 10;
      function updateBtnText() {
        btn.textContent = `Aguarde os anúncios (${timeLeft}s)...`;
      }
      updateBtnText();

      const timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
          clearInterval(timer);
          btn.disabled = false;
          btn.style.cursor = 'pointer';
          btn.style.opacity = '1';
          btn.textContent = btnLabel || 'Próximo capítulo →';
        } else {
          updateBtnText();
        }
      }, 1000);

      const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);
      const BACKEND_URL = isLocal ? (location.protocol + '//' + location.hostname + ':3001') : '';
      const settingsUrl = BACKEND_URL ? `${BACKEND_URL}/settings` : `/api/manga?action=settings`;

      fetch(settingsUrl)
        .then(r => r.json())
        .then(data => {
          if (data && typeof data.transition_delay !== 'undefined') {
            const delay = parseInt(data.transition_delay, 10);
            if (!isNaN(delay)) {
              if (delay <= 0) {
                timeLeft = 0;
                clearInterval(timer);
                btn.disabled = false;
                btn.style.cursor = 'pointer';
                btn.style.opacity = '1';
                btn.textContent = btnLabel || 'Próximo capítulo →';
              } else {
                timeLeft = delay;
                updateBtnText();
              }
            }
          }
        })
        .catch(() => {});

      btn.onclick = function () {
        clearInterval(timer);
        screen.remove();
        onConfirm && onConfirm();
      };

      inner.appendChild(btn);
      screen.appendChild(inner);
      document.body.appendChild(screen);

      ADS.renderBanner728(screen.querySelector('.ad-tr728'));
      ADS.renderBanner300(screen.querySelector('.ad-tr300'));
      ADS.renderNative(screen.querySelector('.ad-trnat'));
    },

    // ── DETECÇÃO DE ADBLOCK ──────────────────────────────────────────────
    // Dois métodos em paralelo:
    //   1. Elemento isca (CSS) — captura bloqueadores que ocultam via CSS
    //   2. Fetch de rede (URL)  — captura uBlock Origin e similares que bloqueiam
    //      por URL (ERR_BLOCKED_BY_CLIENT); o fetch falha imediatamente nesse caso
    // Reporta "bloqueado" se QUALQUER método detectar. Reporta "livre" somente
    // quando ambos passarem, ou após 2s de segurança (servidor lento ≠ adblock).
    detectAdBlock(callback) {
      var settled = false;
      var passing  = 0;

      function report(blocked) {
        if (settled) return;
        if (blocked) { settled = true; callback(true); return; }
        passing++;
        if (passing >= 2) { settled = true; callback(false); }
      }

      // Segurança: se os dois checks demorarem mais de 2s assume sem adblock
      setTimeout(function () { if (!settled) { settled = true; callback(false); } }, 2000);

      // Método 1 — elemento isca (bloqueadores CSS)
      var bait = document.createElement('div');
      bait.className = 'ad ads adsbox doubleclick ad-placement carbon-ads';
      Object.assign(bait.style, {
        height: '1px', width: '1px', position: 'absolute',
        left: '-9999px', top: '-9999px', pointerEvents: 'none'
      });
      document.body.appendChild(bait);
      setTimeout(function () {
        var cs = window.getComputedStyle(bait);
        report(bait.offsetHeight === 0 || cs.display === 'none' || cs.visibility === 'hidden');
        bait.remove();
      }, 200);

      // Método 2 — fetch de rede (uBlock Origin, Adblock Plus com filtros de rede)
      // no-cors: resposta opaca mas não lança erro → não bloqueado
      // ERR_BLOCKED_BY_CLIENT → lança TypeError → bloqueado
      fetch('https://www.highperformanceformat.com/fe05dd3e4e352dea7bcfb0afe47a6044/invoke.js', {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store'
      })
      .then(function () { report(false); })
      .catch(function () { report(true); });
    },

    // ── OVERLAY DE ADBLOCK ────────────────────────────────────────────────
    showAdBlockWall() {
      if (document.getElementById('_adblockWall')) return;
      const src = Math.random() < 0.5 ? 'img/msgadblock1.png' : 'img/msgadblock2.png';
      const wall = document.createElement('div');
      wall.id = '_adblockWall';
      wall.className = 'adblock-wall';
      wall.innerHTML =
        '<div class="adblock-wall-inner">' +
          '<img src="' + src + '" alt="Adblock detectado" class="adblock-wall-img">' +
          '<button class="adblock-retry-btn" onclick="location.reload()">Já desativei — Recarregar</button>' +
        '</div>';
      document.body.appendChild(wall);
    },

    // ── GUARD (chamar em toda página) ────────────────────────────────────
    // Roda a detecção em cada carregamento de página e exibe o wall se houver
    // adblock. Sem guard de sessão: cada página verifica de forma independente,
    // então o bloqueio cobre home, catálogo, mangá e leitor. Defensivo quanto
    // ao body: se chamado antes do body existir, aguarda DOMContentLoaded.
    guard() {
      function run() {
        // Inicializa a Social Bar de forma global em todas as páginas
        ADS.renderSocialBar();
        
        // Controla o Popunder de forma inteligente dependendo da página
        const parts = window.location.pathname.split('/').filter(Boolean);
        const isHome = window.location.pathname === '/' || window.location.pathname.endsWith('index.html') || parts.length === 0;
        
        if (!isHome) {
          ADS.renderPopunder();
        }
        
        ADS.detectAdBlock(function (blocked) {
          if (blocked) ADS.showAdBlockWall();
        });
      }
      if (document.body) run();
      else document.addEventListener('DOMContentLoaded', run);
    },

    // ── DEBUG (use no console do browser: ADS.debug()) ───────────────────
    debug() {
      const slots = document.querySelectorAll('.ad-slot, .ad-banner-fixed, .reader-ad-page');
      console.group('[ADS] Debug Report');
      console.log('Slots encontrados:', slots.length);
      slots.forEach(function (el, i) {
        const frs = el.querySelectorAll('iframe');
        frs.forEach(function (fr) {
          console.log(
            'Slot ' + i, el.className.trim(),
            '| iframe src:', fr.src ? fr.src.slice(0, 60) : '(sem src)',
            '| tamanho:', fr.offsetWidth + '×' + fr.offsetHeight
          );
        });
        if (!frs.length) console.warn('Slot ' + i, el.className.trim(), '| SEM iframe (ad não carregou)');
      });
      console.log('Popunder disparado:', sessionStorage.getItem('_adp') ? 'sim' : 'não');
      console.log('Adblock ativo:', document.getElementById('_adblockWall') ? 'sim (wall visível)' : 'não');
      console.groupEnd();
    }

  };
})();
