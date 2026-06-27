const ADS = (function () {

  // Injeta qualquer código de ad dentro de um iframe isolado.
  // Evita conflito de variáveis globais (atOptions) quando múltiplos
  // banners do mesmo formato aparecem na mesma página.
  function _iframe(container, html) {
    if (!container) return;
    const fr = document.createElement('iframe');
    fr.setAttribute('frameborder', '0');
    fr.setAttribute('scrolling', 'no');
    fr.setAttribute('marginwidth', '0');
    fr.setAttribute('marginheight', '0');
    fr.style.cssText = 'border:0;display:block;max-width:100%;';
    container.appendChild(fr);
    try {
      const d = fr.contentDocument || fr.contentWindow.document;
      d.open();
      d.write(html);
      d.close();
    } catch (_) {}
  }

  return {

    // ── POPUNDER ─────────────────────────────────────────────────────────
    // Dispara apenas 1x por sessão (sessionStorage). Ideal para reader.
    renderPopunder() {
      if (sessionStorage.getItem('_adp')) return;
      sessionStorage.setItem('_adp', '1');
      const s = document.createElement('script');
      s.src = 'https://pl30096192.effectivecpmnetwork.com/61/a3/64/61a364624a5d9564624c731fa93801d7.js';
      document.head.appendChild(s);
    },

    // ── SOCIAL BAR ───────────────────────────────────────────────────────
    // Usar apenas em home/manga — nunca no leitor.
    renderSocialBar() {
      const s = document.createElement('script');
      s.src = 'https://pl30096195.effectivecpmnetwork.com/63/b7/16/63b716721a507990403b659bbf920045.js';
      document.head.appendChild(s);
    },

    // ── BANDEIRA NATIVA ──────────────────────────────────────────────────
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
        '<scr' + 'ipt src="https://www.highperformanceformat.com/fe05dd3e4e352dea7bcfb0afe47a6044/invoke.js"><\/scr' + 'ipt>'
      );
    },

    // ── BANNER 728×90 ────────────────────────────────────────────────────
    renderBanner728(container) {
      _iframe(container,
        '<scr' + 'ipt>atOptions={\'key\':\'b23ec25cb230921662d8cbac7ac95c50\',' +
        '\'format\':\'iframe\',\'height\':90,\'width\':728,\'params\':{}}<\/scr' + 'ipt>' +
        '<scr' + 'ipt src="https://www.highperformanceformat.com/b23ec25cb230921662d8cbac7ac95c50/invoke.js"><\/scr' + 'ipt>'
      );
    },

    // ── PÁGINA MID-CAPÍTULO (3 ads empilhados) ───────────────────────────
    // Carrega os ads via IntersectionObserver quando a página ficar visível.
    buildMidPage() {
      const wrap = document.createElement('div');
      wrap.className = 'reader-ad-page reader-ad-page--mid';
      wrap.innerHTML =
        '<span class="ad-page-label">publicidade</span>' +
        '<div class="ad-slot ad-s728"></div>' +
        '<div class="ad-slot ad-s300"></div>' +
        '<div class="ad-slot ad-snat"></div>';
      const obs = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        ADS.renderBanner728(wrap.querySelector('.ad-s728'));
        ADS.renderBanner300(wrap.querySelector('.ad-s300'));
        ADS.renderNative(wrap.querySelector('.ad-snat'));
      }, { threshold: 0.05 });
      obs.observe(wrap);
      return wrap;
    },

    // ── PÁGINA FIM-CAPÍTULO (1 ad) ───────────────────────────────────────
    buildEndPage() {
      const wrap = document.createElement('div');
      wrap.className = 'reader-ad-page reader-ad-page--end';
      wrap.innerHTML =
        '<span class="ad-page-label">publicidade</span>' +
        '<div class="ad-slot ad-s300"></div>';
      const obs = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        ADS.renderBanner300(wrap.querySelector('.ad-s300'));
      }, { threshold: 0.05 });
      obs.observe(wrap);
      return wrap;
    },

    // ── TELA DE TRANSIÇÃO ENTRE CAPÍTULOS (3 ads + botão) ────────────────
    // Overlay fullscreen; onConfirm() é chamado quando usuário clica no botão.
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
    }

  };
})();
