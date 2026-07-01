// push.js — convite de notificações (Web Push) do MangaBankai.
// Mostra um card (personagem + "Não perca nenhum Bankai — ative os alertas")
// após engajamento (ex.: 60s de leitura). No "Ativar": pede permissão, inscreve
// no PushManager e salva a inscrição no servidor (/api/push).
(function () {
  if (window.MangaPush) return;

  var VAPID_PUBLIC_FALLBACK =
    'BCsxGB0ZQFEB82SX2fMoMFOtjdJgABW-W3kCl2JQ4IXbToVjvOuUcY5agED9pLNT5o854SpyPneQBobdepGnfbw';
  var DISMISS_KEY = 'mb_push_dismissed_until';
  var COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // reoferece só depois de 7 dias

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function dismissedRecently() {
    try { var t = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10); return Date.now() < t; } catch (e) { return false; }
  }
  function setDismissed() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + COOLDOWN_MS)); } catch (e) {}
  }
  function urlB64ToUint8Array(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function getPublicKey() {
    return fetch('/api/push?action=key').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (d && d.publicKey) || VAPID_PUBLIC_FALLBACK; })
      .catch(function () { return VAPID_PUBLIC_FALLBACK; });
  }

  function injectCss() {
    if (document.getElementById('mbPushCss')) return;
    var css = ''
      + '.mb-push{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(140%);z-index:99998;'
      + 'width:min(420px,calc(100vw - 24px));box-sizing:border-box;background:#16161d;border:1px solid #2a2a3a;'
      + 'border-radius:16px;padding:16px 16px 14px;box-shadow:0 14px 40px rgba(0,0,0,.6);display:flex;gap:14px;align-items:center;'
      + 'transition:transform .4s cubic-bezier(.2,.9,.3,1);opacity:.99}'
      + '.mb-push.mb-in{transform:translateX(-50%) translateY(0)}'
      + '.mb-push img{width:58px;height:58px;border-radius:50%;object-fit:cover;flex:0 0 auto;box-shadow:0 0 18px rgba(255,107,53,.35)}'
      + '.mb-push .mb-push-body{flex:1;min-width:0}'
      + '.mb-push h4{margin:0 0 8px;font:600 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f0f0f0}'
      + '.mb-push .mb-push-btns{display:flex;gap:8px;flex-wrap:wrap}'
      + '.mb-push button{border:0;border-radius:8px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer}'
      + '.mb-push .mb-yes{background:#ff6b35;color:#141018}'
      + '.mb-push .mb-yes:hover{background:#ff8555}'
      + '.mb-push .mb-no{background:transparent;color:#9898a8}'
      + '.mb-push .mb-no:hover{color:#f0f0f0}'
      + '@media(max-width:480px){.mb-push{bottom:14px}.mb-push img{width:50px;height:50px}}';
    var s = document.createElement('style'); s.id = 'mbPushCss'; s.textContent = css;
    document.head.appendChild(s);
  }

  var cardEl = null;
  function removeCard() {
    if (!cardEl) return;
    cardEl.classList.remove('mb-in');
    var el = cardEl; cardEl = null;
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 420);
  }
  function showCard() {
    injectCss();
    if (cardEl) return;
    cardEl = document.createElement('div');
    cardEl.className = 'mb-push';
    cardEl.innerHTML =
      '<img src="/img/loading-circ/frame_000.webp" alt="">' +
      '<div class="mb-push-body">' +
      '<h4>🦋 Não perca nenhum Bankai — ative os alertas</h4>' +
      '<div class="mb-push-btns">' +
      '<button class="mb-yes">Ativar 🔔</button>' +
      '<button class="mb-no">Agora não</button>' +
      '</div></div>';
    document.body.appendChild(cardEl);
    requestAnimationFrame(function () { cardEl && cardEl.classList.add('mb-in'); });

    cardEl.querySelector('.mb-no').addEventListener('click', function () { setDismissed(); removeCard(); });
    cardEl.querySelector('.mb-yes').addEventListener('click', function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Ativando…';
      subscribe().then(function (ok) {
        removeCard();
        if (!ok) setDismissed();
      });
    });
  }

  function subscribe() {
    if (!supported()) return Promise.resolve(false);
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { setDismissed(); return false; }
      return Promise.all([navigator.serviceWorker.ready, getPublicKey()]).then(function (arr) {
        var reg = arr[0], key = arr[1];
        return reg.pushManager.getSubscription().then(function (existing) {
          return existing || reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(key)
          });
        });
      }).then(function (sub) {
        return fetch('/api/push?action=subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub })
        }).then(function () { return true; });
      }).catch(function () { return false; });
    }).catch(function () { return false; });
  }

  function eligible() {
    if (!supported()) return false;
    if (Notification.permission !== 'default') return false; // já concedeu ou bloqueou
    if (dismissedRecently()) return false;
    return true;
  }

  window.MangaPush = {
    // Mostra o convite se elegível (não pede nada ainda; só o card).
    maybeInvite: function () { if (eligible()) showCard(); },
    // Agenda o convite após `ms` (ex.: 60s de leitura).
    inviteAfter: function (ms) {
      if (!eligible()) return;
      setTimeout(function () { if (eligible()) showCard(); }, ms || 60000);
    },
    subscribe: subscribe
  };
})();
