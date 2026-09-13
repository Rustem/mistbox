/*
 * Mistbox — make the dashboard tell the truth about a refused save.
 *
 * The Saleor dashboard renders a mutation's *error code* through its own
 * translation table and shows the server's actual sentence only in a toast,
 * which the next toast dismisses in a blink. So when our Django plugin
 * (`saleor-plugin/`) refuses a box that breaks a Mistbox rule — too many of
 * one item, more pieces than the carton holds — the person composing the box
 * sees "Invalid value" and nothing else. The rule is enforced (the save really
 * does fail), but the reason is invisible.
 *
 * This script is appended to the dashboard's own page by nginx (`sub_filter`,
 * see `dashboard/default.conf`). It is *our* code sitting beside theirs, not a
 * patch of their minified bundle: if a future dashboard changes shape, the
 * worst case is this quietly does nothing and we are back to today's toast.
 *
 * It does two things, both driven by the real save response — never by polling,
 * so it can never disagree with the form:
 *   1. Replaces the inline "Invalid value" helper text under the field with the
 *      server's real sentence.
 *   2. Shows a persistent panel that names what was wrong and says plainly that
 *      the box was not saved. It stays until the next save, unlike the toast.
 */
(function () {
  'use strict';
  if (window.__mistboxInlineErrors) return;
  window.__mistboxInlineErrors = true;

  var CANNED = 'Invalid value'; // the dashboard's stand-in for our sentence

  // ---- Capture the real messages from a mutation response -----------------
  // Walk the JSON for any `errors` array (Saleor puts field errors at
  // `data.<mutation>.errors`, transport errors at the top level). Report
  // whether we saw one at all: a plain query has none, and must not clear a
  // standing message.
  function scan(node, state) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) scan(node[i], state);
      return;
    }
    if (Array.isArray(node.errors)) {
      state.sawErrors = true;
      for (var j = 0; j < node.errors.length; j++) {
        var e = node.errors[j];
        if (e && typeof e.message === 'string' && e.message.trim()) {
          state.messages.push(e.message.trim());
        }
      }
    }
    for (var k in node) {
      if (k === 'errors') continue;
      var v = node[k];
      if (v && typeof v === 'object') scan(v, state);
    }
  }

  function dedupe(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      if (!seen[list[i]]) { seen[list[i]] = 1; out.push(list[i]); }
    }
    return out;
  }

  var _fetch = window.fetch;
  window.fetch = function () {
    var promise = _fetch.apply(this, arguments);
    try {
      promise.then(function (res) {
        try {
          var ct = (res.headers && res.headers.get('content-type')) || '';
          if (ct.indexOf('json') === -1) return;
          res.clone().json().then(function (body) {
            try {
              var state = { sawErrors: false, messages: [] };
              scan(body, state);
              // A query carries no `errors` key — leave any standing message be.
              if (!state.sawErrors) return;
              var msgs = dedupe(state.messages);
              if (msgs.length) { showPanel(msgs); paintInline(msgs); }
              else { clearPanel(); }
            } catch (_) {}
          }, function () {});
        } catch (_) {}
      }, function () {});
    } catch (_) {}
    return promise;
  };

  // ---- 1. Rewrite the inline "Invalid value" under the field --------------
  // Only when there is a single message, so we can never staple the wrong
  // sentence onto the wrong field. The panel carries the rest.
  function paintInline(msgs) {
    if (msgs.length !== 1) return;
    var msg = msgs[0];
    var deadline = Date.now() + 4000; // the field re-renders a beat after save

    function sweep() {
      try {
        var nodes = document.querySelectorAll('p,span,div');
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          if (el.childElementCount === 0 &&
              el.textContent &&
              el.textContent.trim() === CANNED &&
              el.getAttribute('data-mistbox') !== 'done') {
            el.textContent = msg;
            el.setAttribute('data-mistbox', 'done');
          }
        }
      } catch (_) {}
    }

    sweep();
    var obs = new MutationObserver(sweep);
    try { obs.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (_) {}
    setTimeout(function () { try { obs.disconnect(); } catch (_) {} }, Math.max(0, deadline - Date.now()));
  }

  // ---- 2. A persistent panel — the toast that does not run away -----------
  function ensureStyle() {
    if (document.getElementById('mistbox-style')) return;
    var s = document.createElement('style');
    s.id = 'mistbox-style';
    s.textContent = [
      '#mistbox-panel{position:fixed;top:16px;right:16px;z-index:2147483647;',
        'width:360px;max-width:calc(100vw - 32px);',
        'background:#f6f1e7;color:#26352c;border:1px solid #d8ccb4;',
        'border-left:4px solid #b8892b;border-radius:10px;',
        'box-shadow:0 12px 32px rgba(38,53,44,.22);',
        'font-family:Georgia,\"Times New Roman\",serif;overflow:hidden;}',
      '#mistbox-panel .mb-head{display:flex;align-items:baseline;justify-content:space-between;',
        'gap:12px;padding:14px 16px 8px;}',
      '#mistbox-panel .mb-title{font-size:15px;font-weight:600;letter-spacing:.2px;margin:0;}',
      '#mistbox-panel .mb-x{cursor:pointer;border:0;background:transparent;color:#7a6a4a;',
        'font-size:18px;line-height:1;padding:2px 4px;font-family:inherit;}',
      '#mistbox-panel .mb-x:hover{color:#26352c;}',
      '#mistbox-panel ul{margin:0;padding:2px 16px 14px 32px;}',
      '#mistbox-panel li{font-size:14px;line-height:1.45;margin:4px 0;',
        'font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;}',
      '#mistbox-panel .mb-foot{padding:0 16px 14px;font-size:12px;color:#7a6a4a;',
        'font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;}'
    ].join('');
    document.head.appendChild(s);
  }

  function showPanel(msgs) {
    ensureStyle();
    var panel = document.getElementById('mistbox-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'mistbox-panel';
      panel.setAttribute('role', 'alert');
      document.body.appendChild(panel);
    }
    var items = msgs.map(function (m) {
      var li = document.createElement('li');
      li.textContent = m;
      return li.outerHTML;
    }).join('');
    panel.innerHTML =
      '<div class="mb-head">' +
        '<p class="mb-title">This box wasn’t saved</p>' +
        '<button class="mb-x" aria-label="Dismiss" type="button">×</button>' +
      '</div>' +
      '<ul>' + items + '</ul>' +
      '<div class="mb-foot">Nothing changed. Fix the box and save again.</div>';
    panel.querySelector('.mb-x').addEventListener('click', clearPanel);
  }

  function clearPanel() {
    var panel = document.getElementById('mistbox-panel');
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  }
})();
