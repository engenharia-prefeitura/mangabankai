const ADS = (function () {

  // Injeta código de ad via blob URL.
  // blob: preserva a origem do site (https://mangabankai.vercel.app) para que os
  // scripts do Adsterra identifiquem o publisher corretamente — diferente de srcdoc
  // que cria origem opaca (null) e causa delays de 2+ min no matching de anúncios.
  function _iframe(container, html, w, h) {
    if (!container) return;
    const t0 = performance.now();
    const label = w ? (w + '×' + h) : 'native';

    // A2 — placeholder shimmer enquanto o criativo não pinta. O iframe fica por
    // cima; quando o anúncio carrega ele cobre o shimmer. Removido após timeout
    // de segurança para não animar para sempre.
    container.classList.add('ad-loading');
    const stopShimmer = setTimeout(function () { container.classList.remove('ad-loading'); }, 6000);

    const blob = new Blob([html], {type: 'text/html; charset=utf-8'});
    const url = URL.createObjectURL(blob);
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
      fr.style.cssText = 'border:0;display:block;width:100%;min-height:90px;position:relative;z-index:1;';
    }
    fr.src = url;
    fr.addEventListener('load', function () {
      URL.revokeObjectURL(url);
      // dá ~1.2s pro criativo pintar dentro do iframe, então tira o shimmer
      setTimeout(function () { clearTimeout(stopShimmer); container.classList.remove('ad-loading'); }, 1200);
      console.debug('[ADS] ' + label + ' carregado em ' + Math.round(performance.now() - t0) + 'ms');
    }, {once: true});
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
    renderPopunder() {
      if (sessionStorage.getItem('_adp')) return;
      sessionStorage.setItem('_adp', '1');
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://pl30096192.effectivecpmnetwork.com/61/a3/64/61a364624a5d9564624c731fa93801d7.js';
      document.head.appendChild(s);
    },

    // ── SOCIAL BAR ───────────────────────────────────────────────────────
    renderSocialBar() {
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://pl30096195.effectivecpmnetwork.com/63/b7/16/63b716721a507990403b659bbf920045.js';
      document.body.appendChild(s);
    },

    // ── BANNER NATIVO ────────────────────────────────────────────────────
    renderNative(container) {
      _iframe(container,
        '<scr' + 'ipt async data-cfasync="false" ' +
        'src="https://pl30096193.effectivecpmnetwork.com/3bf02e75245e7cb6a59d7847d032a951/invoke.js"><\/scr' + 'ipt>' +
        '<div id="container-3bf02e75245e7cb6a59d7847d032a951"></div>'
      );
    },

    // ── BANNER 300×250 ───────────────────────────────────────────────────
    renderBanner300(container) {
      _iframe(container,
        '<scr' + 'ipt>atOptions={\'key\':\'fe05dd3e4e352dea7bcfb0afe47a6044\',' +
        '\'format\':\'iframe\',\'height\':250,\'width\':300,\'params\':{}}<\/scr' + 'ipt>' +
        '<scr' + 'ipt src="https://www.highperformanceformat.com/fe05dd3e4e352dea7bcfb0afe47a6044/invoke.js"><\/scr' + 'ipt>',
        300, 250
      );
    },

    // ── BANNER 728×90 ────────────────────────────────────────────────────
    renderBanner728(container) {
      _iframe(container,
        '<scr' + 'ipt>atOptions={\'key\':\'b23ec25cb230921662d8cbac7ac95c50\',' +
        '\'format\':\'iframe\',\'height\':90,\'width\':728,\'params\':{}}<\/scr' + 'ipt>' +
        '<scr' + 'ipt src="https://www.highperformanceformat.com/b23ec25cb230921662d8cbac7ac95c50/invoke.js"><\/scr' + 'ipt>',
        728, 90
      );
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
      btn.textContent = btnLabel || 'Próximo capítulo →';
      btn.onclick = function () { screen.remove(); onConfirm && onConfirm(); };
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
