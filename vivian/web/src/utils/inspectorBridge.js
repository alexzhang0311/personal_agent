// Builds the srcdoc for the inspector iframe.
//
// The iframe is sandboxed with `allow-scripts` only (no `allow-same-origin`),
// so the parent cannot reach into the iframe's DOM. All info travels through
// `postMessage`. The injected script:
//   - on hover: rAF-throttles mousemove, posts { type:'hover', rect, tag, selector }
//   - on select (Inspect mode click, or Interact mode Alt+click): posts
//     { type:'select', selector, tag, attrs, computed, outerHtml, handlers, anchorX/Y }
//   - forwards generic click/submit events to { type:'event', kind, selector, ts }
//   - listens for parent messages: { type:'set-mode' } / { type:'reload' }

const OUTER_HTML_MAX = 4096

const COMPUTED_KEYS = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'border',
  'opacity',
  'cursor',
  'z-index',
]

const HANDLER_ATTRS = [
  'onclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onmouseout', 'onmouseenter',
  'onmouseleave', 'onmousemove', 'onkeydown', 'onkeyup', 'onkeypress', 'onchange',
  'oninput', 'onsubmit', 'onfocus', 'onblur', 'onload', 'onerror', 'ontouchstart',
  'ontouchend',
]

function inspectorScript() {
  return `
(function () {
  var mode = '__INITIAL_MODE__';
  var hoverEl = null;
  var rafPending = false;
  var lastMove = null;

  function post(msg) {
    try { parent.postMessage(msg, '*'); } catch (e) {}
  }

  function escSel(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\\\$1');
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el === document.body) return 'body';
    if (el === document.documentElement) return 'html';
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 8) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + escSel(node.id);
        parts.unshift(part);
        break;
      }
      if (node.classList && node.classList.length) {
        var classes = Array.prototype.slice.call(node.classList).slice(0, 3).map(escSel).join('.');
        if (classes) part += '.' + classes;
      }
      var parent = node.parentNode;
      if (parent && parent.children && parent.children.length > 1) {
        var same = [];
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === node.tagName) same.push(parent.children[i]);
        }
        if (same.length > 1) {
          var idx = same.indexOf(node) + 1;
          part += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(part);
      node = node.parentNode;
      depth++;
    }
    if (node === document.body) parts.unshift('body');
    return parts.join('>');
  }

  function collectAttrs(el) {
    var out = {};
    if (!el || !el.attributes) return out;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      out[a.name] = a.value;
    }
    return out;
  }

  function collectHandlers(el) {
    var keys = __HANDLER_ATTRS__;
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (el && el.hasAttribute && el.hasAttribute(k)) {
        out[k] = el.getAttribute(k);
      }
    }
    return out;
  }

  function collectComputed(el) {
    var keys = __COMPUTED_KEYS__;
    var cs = window.getComputedStyle(el);
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      out[k] = cs.getPropertyValue(k);
    }
    return out;
  }

  function buildSnapshot(el, anchorX, anchorY) {
    var rect = el.getBoundingClientRect();
    var outer = el.outerHTML || '';
    if (outer.length > __OUTER_MAX__) outer = outer.slice(0, __OUTER_MAX__) + '...';
    return {
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      attrs: collectAttrs(el),
      computed: collectComputed(el),
      handlers: collectHandlers(el),
      outerHtml: outer,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      anchorX: anchorX,
      anchorY: anchorY,
    };
  }

  function emitHover(el) {
    if (!el || el === document.body || el === document.documentElement) {
      post({ type: 'hover', rect: null });
      return;
    }
    var rect = el.getBoundingClientRect();
    post({
      type: 'hover',
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      tag: el.tagName.toLowerCase(),
      selector: buildSelector(el),
    });
  }

  function shouldInspect(evt) {
    if (mode === 'inspect') return true;
    if (mode === 'interact' && (evt.altKey || evt.metaKey)) return true;
    return false;
  }

  document.addEventListener('mousemove', function (e) {
    lastMove = e;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      if (!lastMove) return;
      if (mode === 'interact' && !lastMove.altKey) {
        if (hoverEl) { hoverEl = null; post({ type: 'hover', rect: null }); }
        return;
      }
      var el = document.elementFromPoint(lastMove.clientX, lastMove.clientY);
      if (el === hoverEl) return;
      hoverEl = el;
      emitHover(el);
    });
  }, true);

  document.addEventListener('mouseleave', function () {
    hoverEl = null;
    post({ type: 'hover', rect: null });
  }, true);

  document.addEventListener('click', function (e) {
    if (shouldInspect(e)) {
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      if (el && el.nodeType === 1) {
        var snap = buildSnapshot(el, e.clientX, e.clientY);
        post({ type: 'select', snapshot: snap });
      }
      return;
    }
    var t = e.target;
    if (t && t.nodeType === 1) {
      post({ type: 'event', kind: 'click', selector: buildSelector(t), tag: t.tagName.toLowerCase(), ts: Date.now() });
    }
  }, true);

  document.addEventListener('submit', function (e) {
    var t = e.target;
    if (t && t.nodeType === 1) {
      post({ type: 'event', kind: 'submit', selector: buildSelector(t), tag: t.tagName.toLowerCase(), ts: Date.now() });
    }
  }, true);

  window.addEventListener('message', function (e) {
    var data = e.data || {};
    if (data.type === 'set-mode') {
      mode = data.mode === 'interact' ? 'interact' : 'inspect';
      hoverEl = null;
      post({ type: 'hover', rect: null });
    }
  });

  post({ type: 'ready' });
})();
`
}

function buildScript(mode) {
  return inspectorScript()
    .replace('__INITIAL_MODE__', mode === 'interact' ? 'interact' : 'inspect')
    .replace('__HANDLER_ATTRS__', JSON.stringify(HANDLER_ATTRS))
    .replace('__COMPUTED_KEYS__', JSON.stringify(COMPUTED_KEYS))
    .replace('__OUTER_MAX__', String(OUTER_HTML_MAX))
}

// Hardcoded white is intentional: user-content legibility — the app's CSS
// variables don't exist inside the sandboxed iframe document.
const BASE_STYLE = `
html, body { background: #ffffff; color: #111; margin: 0; }
* { box-sizing: border-box; }
`

export function buildSrcdoc(html, mode) {
  const body = typeof html === 'string' ? html : ''
  const script = buildScript(mode)
  // Inject a <style> + <script>. If user HTML is a full document, append to its body.
  const hasHtml = /<html[\s>]/i.test(body)
  const styleBlock = `<style>${BASE_STYLE}</style>`
  const scriptBlock = `<script>${script}</script>`
  if (hasHtml) {
    // Try to insert before </body>; else append.
    if (/<\/body>/i.test(body)) {
      return body.replace(/<\/body>/i, `${styleBlock}${scriptBlock}</body>`)
    }
    return body + styleBlock + scriptBlock
  }
  return `<!doctype html><html><head><meta charset="utf-8">${styleBlock}</head><body>${body}${scriptBlock}</body></html>`
}

export function summarizeSelected(snap, sourceLabel, eventLog) {
  if (!snap) return ''
  const lines = []
  lines.push(snap.outerHtml || '')
  lines.push('')
  lines.push('— attributes —')
  const attrs = snap.attrs || {}
  const attrKeys = Object.keys(attrs)
  if (attrKeys.length === 0) {
    lines.push('(none)')
  } else {
    for (const k of attrKeys) lines.push(`${k}="${attrs[k]}"`)
  }
  lines.push('')
  lines.push('— computed (key) —')
  const computed = snap.computed || {}
  for (const k of Object.keys(computed)) {
    const v = (computed[k] || '').trim()
    if (v) lines.push(`${k}: ${v}`)
  }
  lines.push('')
  lines.push('— handlers (inline only) —')
  const handlers = snap.handlers || {}
  const hKeys = Object.keys(handlers)
  if (hKeys.length === 0) {
    lines.push('(none — addEventListener handlers not introspectable from sandbox)')
  } else {
    for (const k of hKeys) lines.push(`${k}="${handlers[k]}"`)
  }
  if (Array.isArray(eventLog) && eventLog.length > 0) {
    lines.push('')
    lines.push('— event log (last 5) —')
    const recent = eventLog.slice(-5)
    for (const e of recent) {
      const ts = new Date(e.ts).toISOString().slice(11, 19)
      lines.push(`${ts} ${e.kind}  ${e.selector || ''}`)
    }
  }
  return lines.join('\n')
}
