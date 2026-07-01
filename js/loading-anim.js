// loading-anim.js — loader animado do MangaBankai.
// Personagem circular (frames webp) + texto "desenho a traço" (typewriter) que
// cicla frases temáticas. Reutilizável: splash de primeiro acesso, leitor e
// carregamentos de página. Caminhos ABSOLUTOS (o leitor roda em rotas aninhadas).
(function () {
  if (window.MangaLoader) return;

  var FRAME_COUNT = 51;
  var FRAME_BASE  = '/img/loading-circ/frame_';
  var FRAME_MS    = 80;   // ~12,5 fps
  var PHRASES = [
    'Desenhando o capítulo…',
    'Passando o nanquim…',
    'Traçando os balões…',
    'Aplicando as tramas…',
    'Finalizando a arte…',
    'Bankai! Quase lá…'
  ];
  var TYPE_MS = 55, ERASE_MS = 28, HOLD_MS = 900;

  // ── CSS (injetado uma vez) ──────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('mbLoaderCss')) return;
    var css = ''
      + '.mb-loader{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:22px}'
      + '.mb-loader.mb-fixed{position:fixed;inset:0;z-index:99999;background:radial-gradient(circle at 50% 42%,#14141b 0%,#08080a 70%);'
      + 'opacity:1;transition:opacity .45s ease;will-change:opacity}'
      + '.mb-loader.mb-hide{opacity:0;pointer-events:none}'
      + '.mb-ring{position:relative;width:168px;height:168px;border-radius:50%;display:flex;align-items:center;justify-content:center}'
      + '.mb-ring::before{content:"";position:absolute;inset:-6px;border-radius:50%;'
      + 'background:conic-gradient(from 0deg,rgba(255,107,53,0),#ff6b35,rgba(255,107,53,0));'
      + '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 4px));'
      + 'mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 4px));'
      + 'animation:mbSpin 2.4s linear infinite;opacity:.9}'
      + '.mb-ring::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 34px rgba(255,107,53,.28)}'
      + '.mb-frame{width:150px;height:150px;border-radius:50%;object-fit:cover;display:block;opacity:0;transition:opacity .3s ease}'
      + '.mb-frame.mb-on{opacity:1}'
      + '.mb-text{font:600 15px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f0f0f0;'
      + 'letter-spacing:.2px;min-height:1.3em;text-align:center;white-space:nowrap}'
      + '.mb-typed{color:#f0f0f0}'
      + '.mb-caret{display:inline-block;width:2px;margin-left:1px;color:#ff6b35;animation:mbBlink 1s steps(1) infinite}'
      + '@keyframes mbSpin{to{transform:rotate(360deg)}}'
      + '@keyframes mbBlink{50%{opacity:0}}'
      + '@media(max-width:600px){.mb-ring{width:132px;height:132px}.mb-frame{width:118px;height:118px}.mb-text{font-size:13.5px}}';
    var s = document.createElement('style');
    s.id = 'mbLoaderCss'; s.textContent = css;
    document.head.appendChild(s);
  }

  // ── Instância do loader ─────────────────────────────────────────────────
  function LoaderInstance(el) {
    this.el = el;
    this.frameEl = el.querySelector('.mb-frame');
    this.typedEl = el.querySelector('.mb-typed');
    this._frames = [];
    this._fi = 0;
    this._timers = [];
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
  LoaderInstance.prototype._typewriter = function () {
    var self = this, pi = 0, ci = 0, mode = 'type';
    function step() {
      if (!self.typedEl) return;
      var phrase = PHRASES[pi];
      if (mode === 'type') {
        self.typedEl.textContent = phrase.slice(0, ++ci);
        if (ci >= phrase.length) { mode = 'hold'; self._timers.push(setTimeout(step, HOLD_MS)); return; }
        self._timers.push(setTimeout(step, TYPE_MS));
      } else if (mode === 'hold') {
        mode = 'erase'; self._timers.push(setTimeout(step, ERASE_MS));
      } else {
        self.typedEl.textContent = phrase.slice(0, --ci);
        if (ci <= 0) { mode = 'type'; pi = (pi + 1) % PHRASES.length; self._timers.push(setTimeout(step, 260)); return; }
        self._timers.push(setTimeout(step, ERASE_MS));
      }
    }
    step();
  };
  LoaderInstance.prototype.start = function () {
    if (this._started) return; this._started = true;
    this._preload(); this._animFrames(); this._typewriter();
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
      '<div class="mb-text"><span class="mb-typed"></span><span class="mb-caret">▍</span></div>';
    return wrap;
  }

  // ── API pública ─────────────────────────────────────────────────────────
  var splashInst = null;
  window.MangaLoader = {
    // Cria e injeta um loader dentro de `container` (modo embutido). Retorna a instância.
    mount: function (container) {
      injectCss();
      var node = buildMarkup(false);
      container.innerHTML = '';
      container.appendChild(node);
      var inst = new LoaderInstance(node);
      inst.start();
      return inst;
    },
    // Splash de tela cheia. `hold` = mostra ao menos esse tempo (ms) antes de poder sumir.
    splash: function () {
      injectCss();
      if (splashInst) return splashInst;
      var node = buildMarkup(true);
      node.id = 'mbSplash';
      document.body.appendChild(node);
      splashInst = new LoaderInstance(node);
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
})();
