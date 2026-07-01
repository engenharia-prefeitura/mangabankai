// loading-anim.js — loader animado do MangaBankai.
// Personagem circular (frames webp) + frase inteira com movimento de ONDA (wave)
// que troca aleatoriamente (≤3s por frase). Conjuntos de frases por contexto.
// Reutilizável: splash de primeiro acesso, leitor e carregamentos de página.
// Caminhos ABSOLUTOS (o leitor roda em rotas aninhadas).
(function () {
  if (window.MangaLoader) return;

  var FRAME_COUNT = 51;
  var FRAME_BASE  = '/img/loading-circ/frame_';
  var FRAME_MS    = 80;   // ~12,5 fps

  // Conjuntos de frases por contexto (tema Bleach/Bankai).
  var PHRASE_SETS = {
    home: [
      'Liberando a Reiatsu…',
      'Abrindo o Senkaimon…',
      'Convocando as borboletas infernais…',
      'Sincronizando com a Soul Society…'
    ],
    reader: [
      'Desenhando o capítulo…',
      'Liberando o Bankai…',
      'Getsuga Tenshō nas páginas…',
      'Materializando a Zanpakutō…',
      'Selando o Hollow nas tramas…',
      'Bankai! Quase lá…'
    ],
    catalog: [
      'Reunindo as Zanpakutō…',
      'Explorando a Soul Society…',
      'Garimpando relíquias do Rukongai…',
      'Catalogando as almas…'
    ],
    manga: [
      'Despertando a Zanpakutō…',
      'Lendo o nome do Bankai…',
      'Canalizando a Reiatsu da obra…',
      'Abrindo a obra…',
      'Soprando a poeira da capa…',
      'Virando pra primeira página…'
    ]
  };
  var HOLD_MIN = 1900, HOLD_RAND = 1000; // 1,9–2,9s por frase (≤3s)

  // ── CSS (injetado uma vez) ──────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('mbLoaderCss')) return;
    var css = ''
      + '.mb-loader{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:22px;'
      + 'padding:20px;box-sizing:border-box;max-width:100%}'
      + '.mb-loader.mb-fixed{position:fixed;inset:0;z-index:99999;background:radial-gradient(circle at 50% 42%,#14141b 0%,#08080a 70%);'
      + 'opacity:1;transition:opacity .45s ease;will-change:opacity}'
      + '.mb-loader.mb-hide{opacity:0;pointer-events:none}'
      + '.mb-ring{position:relative;width:168px;height:168px;max-width:60vw;max-height:60vw;border-radius:50%;'
      + 'display:flex;align-items:center;justify-content:center;flex:0 0 auto}'
      + '.mb-ring::before{content:"";position:absolute;inset:-6px;border-radius:50%;'
      + 'background:conic-gradient(from 0deg,rgba(255,107,53,0),#ff6b35,rgba(255,107,53,0));'
      + '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 4px));'
      + 'mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 4px));'
      + 'animation:mbSpin 2.4s linear infinite;opacity:.9}'
      + '.mb-ring::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 34px rgba(255,107,53,.28)}'
      + '.mb-frame{width:150px;height:150px;max-width:54vw;max-height:54vw;border-radius:50%;object-fit:cover;display:block;opacity:0;transition:opacity .3s ease}'
      + '.mb-frame.mb-on{opacity:1}'
      + '.mb-text{font:600 15px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f0f0f0;'
      + 'letter-spacing:.2px;min-height:1.35em;text-align:center;max-width:90vw;padding:0 8px;box-sizing:border-box}'
      + '.mb-phrase{display:inline-block;transition:opacity .22s ease}'
      + '.mb-phrase.mb-fade{opacity:0}'
      + '.mb-w{display:inline-block;animation:mbWave 1.5s ease-in-out infinite;will-change:transform}'
      + '.mb-sp{display:inline-block;width:.32em}'
      + '@keyframes mbSpin{to{transform:rotate(360deg)}}'
      + '@keyframes mbWave{0%,55%,100%{transform:translateY(0)}28%{transform:translateY(-5px)}}'
      + '@media(max-width:600px){.mb-ring{width:132px;height:132px}.mb-frame{width:118px;height:118px}.mb-text{font-size:13.5px}}';
    var s = document.createElement('style');
    s.id = 'mbLoaderCss'; s.textContent = css;
    document.head.appendChild(s);
  }

  // ── Instância do loader ─────────────────────────────────────────────────
  function LoaderInstance(el, phrases) {
    this.el = el;
    this.frameEl = el.querySelector('.mb-frame');
    this.phraseEl = el.querySelector('.mb-phrase');
    this.phrases = phrases || PHRASE_SETS.home;
    this._frames = [];
    this._fi = 0;
    this._timers = [];
    this._last = -1;
    this._started = false;
  }
  LoaderInstance.prototype._preload = function () {
    var self = this, first = true;
    for (var i = 0; i < FRAME_COUNT; i++) {
      var im = new Image();
      im.src = FRAME_BASE + String(i).padStart(3, '0') + '.webp';
      this._frames.push(im);
      if (first) { im.onload = function () { if (self.frameEl) { self.frameEl.src = this.src; self.frameEl.classList.add('mb-on'); } }; first = false; }
    }
  };
  LoaderInstance.prototype._animFrames = function () {
    var self = this;
    var t = setInterval(function () {
      if (!self.frameEl) return;
      self._fi = (self._fi + 1) % FRAME_COUNT;
      var im = self._frames[self._fi];
      if (im && im.complete) self.frameEl.src = im.src;
    }, FRAME_MS);
    this._timers.push(t);
  };
  // Renderiza a frase inteira em <span> por letra, com delay escalonado (onda).
  LoaderInstance.prototype._renderWave = function (phrase) {
    var el = this.phraseEl;
    if (!el) return;
    el.textContent = '';
    for (var i = 0; i < phrase.length; i++) {
      var c = phrase.charAt(i);
      var s = document.createElement('span');
      if (c === ' ') { s.className = 'mb-sp'; }
      else { s.className = 'mb-w'; s.textContent = c; s.style.animationDelay = (i * 0.045).toFixed(3) + 's'; }
      el.appendChild(s);
    }
  };
  LoaderInstance.prototype._pick = function () {
    var n; var len = this.phrases.length;
    do { n = Math.floor(Math.random() * len); } while (len > 1 && n === this._last);
    this._last = n; return this.phrases[n];
  };
  LoaderInstance.prototype._cyclePhrases = function () {
    var self = this;
    self._renderWave(self._pick());
    function swap() {
      if (!self.phraseEl) return;
      self.phraseEl.classList.add('mb-fade');           // fade out
      self._timers.push(setTimeout(function () {
        self._renderWave(self._pick());
        self.phraseEl.classList.remove('mb-fade');       // fade in (frase inteira)
        self._timers.push(setTimeout(swap, HOLD_MIN + Math.random() * HOLD_RAND));
      }, 240));
    }
    self._timers.push(setTimeout(swap, HOLD_MIN + Math.random() * HOLD_RAND));
  };
  LoaderInstance.prototype.start = function () {
    if (this._started) return; this._started = true;
    this._preload(); this._animFrames(); this._cyclePhrases();
  };
  LoaderInstance.prototype.stop = function () {
    this._timers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
    this._timers = []; this._started = false;
  };

  function buildMarkup(fixed) {
    var wrap = document.createElement('div');
    wrap.className = 'mb-loader' + (fixed ? ' mb-fixed' : '');
    wrap.innerHTML =
      '<div class="mb-ring"><img class="mb-frame" alt="Carregando" decoding="async"></div>' +
      '<div class="mb-text"><span class="mb-phrase"></span></div>';
    return wrap;
  }

  function resolveSet(setOrArray) {
    if (Array.isArray(setOrArray)) return setOrArray;
    return PHRASE_SETS[setOrArray] || PHRASE_SETS.home;
  }

  // ── API pública ─────────────────────────────────────────────────────────
  var splashInst = null;
  window.MangaLoader = {
    // Loader embutido dentro de `container`. `set` = chave (reader/home/...) ou array.
    mount: function (container, set) {
      injectCss();
      var node = buildMarkup(false);
      container.innerHTML = '';
      container.appendChild(node);
      var inst = new LoaderInstance(node, resolveSet(set));
      inst.start();
      return inst;
    },
    // Splash de tela cheia. `set` = chave do conjunto de frases.
    splash: function (set) {
      injectCss();
      if (splashInst) return splashInst;
      var node = buildMarkup(true);
      node.id = 'mbSplash';
      document.body.appendChild(node);
      splashInst = new LoaderInstance(node, resolveSet(set));
      splashInst.start();
      splashInst._shownAt = Date.now();
      return splashInst;
    },
    // Some com o splash (fade), respeitando um tempo mínimo de exibição.
    hideSplash: function (minMs) {
      if (!splashInst) return;
      var wait = Math.max(0, (minMs || 0) - (Date.now() - (splashInst._shownAt || 0)));
      setTimeout(function () {
        if (!splashInst) return;
        splashInst.el.classList.add('mb-hide');
        setTimeout(function () {
          if (splashInst) { splashInst.stop(); if (splashInst.el.parentNode) splashInst.el.parentNode.removeChild(splashInst.el); splashInst = null; }
        }, 480);
      }, wait);
    }
  };

  // ── Loader durante NAVEGAÇÃO ─────────────────────────────────────────────
  // Site multi-página: o splash do destino só aparece depois de baixar/renderizar.
  // Aqui mostramos o loader na PÁGINA ATUAL assim que a navegação começa, cobrindo
  // o vão (perceptível no mobile lento) ao ir pro catálogo, abrir obra ou recarregar.
  function setForPath(p) {
    if (/\/manga\/[^/]+\/[^/]+/.test(p)) return 'reader';         // /manga/<id>/<cap>
    if (/catalog\.html/.test(p)) return 'catalog';
    if (/manga\.html/.test(p) || /\/manga\/[^/]+\/?$/.test(p)) return 'manga';
    return 'home';
  }
  function isInternal(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(javascript:|mailto:|tel:|data:)/i.test(href)) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    if (!isInternal(href)) return;
    var u; try { u = new URL(href, location.href); } catch (e2) { return; }
    if (u.pathname === location.pathname && u.search === location.search) return; // só âncora/mesma URL
    window.MangaLoader.splash(setForPath(u.pathname));
  }, true);
  // Navegações via JS (window.location = …) e recarregar a página.
  window.addEventListener('beforeunload', function () {
    window.MangaLoader.splash(setForPath(location.pathname));
  });
  // Voltar pelo histórico (bfcache) restaura a página com o splash preso → remove.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) window.MangaLoader.hideSplash(0);
  });
})();
