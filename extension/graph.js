// Injected by background.js on every toolbar click. A click closes an open panel, else opens one.
// No state is kept on window, so a reloaded extension never runs an old copy.
(() => {
  'use strict';
  const SEL = '[data-epic-graph]';
  const existing = document.querySelector(SEL);
  if (existing) return existing.remove();
  const API = location.origin + '/rest/api/3';
  const get = async p => {
    const r = await fetch(API + p, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Jira answered ${r.status} for ${p}`);
    return r.json();
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const epicKey = () => new URL(location.href).searchParams.get('selectedIssue')
    || (location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/) || [])[1];

  async function load(key) {
    const epic = await get(`/issue/${key}?fields=summary,status,issuetype`);
    if (epic.fields.issuetype.hierarchyLevel < 1) throw new Error(`${key} is a ${epic.fields.issuetype.name}, not an epic.`);
    const sprintId = (await get('/field')).find(f => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id;
    const fields = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'issuelinks', 'updated', sprintId].filter(Boolean).join(',');
    const issues = [];
    let token;
    do {
      const r = await get(`/search/jql?jql=${encodeURIComponent(`parent = ${key} ORDER BY key`)}&fields=${fields}&maxResults=100`
        + (token ? `&nextPageToken=${encodeURIComponent(token)}` : ''));
      issues.push(...r.issues);
      token = r.nextPageToken;
    } while (token);
    return {
      epic,
      nodes: issues.map(({ key, fields: f }) => ({
        key, summary: f.summary, status: f.status.name, cat: f.status.statusCategory.key,
        type: f.issuetype.name, priority: f.priority?.name ?? '-', assignee: f.assignee?.displayName ?? 'Unassigned',
        sprint: (f[sprintId] || []).at(-1)?.name ?? '-', updated: (f.updated || '').slice(0, 10),
        links: (f.issuelinks || []).filter(l => l.outwardIssue).map(l => ({ to: l.outwardIssue.key, type: l.type.outward })),
      })),
    };
  }

  const CSS = `
:host{all:initial}
*{box-sizing:content-box}
.pane{position:absolute;inset:0;display:flex;flex-direction:column;font:13px system-ui,sans-serif;color:#172b4d;background:#f7f8f9}
.bar{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #dfe1e6;background:#fff}
.bar h1{font-size:15px;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar h1 a{color:#0c66e4}
button{font:inherit;padding:4px 10px;border:1px solid #c1c7d0;border-radius:4px;background:#fff;cursor:pointer}
button:hover{background:#f1f2f4}
.sub{padding:6px 14px;color:#5e6c84;font-size:12px;background:#fff;border-bottom:1px solid #dfe1e6}
.scroll{flex:1;overflow:hidden;position:relative;cursor:grab;touch-action:none;background-image:radial-gradient(#c1c7d0 1px,transparent 1px)}
.scroll.panning{cursor:grabbing}
.msg{padding:20px;color:#5e6c84}.err{color:#c9372c}
#wrap{position:absolute;left:0;top:0;transform-origin:0 0}
.zr{min-width:48px}
svg{position:absolute;inset:0;pointer-events:none;overflow:visible}
.col-h{position:absolute;font-weight:600;color:#5e6c84;font-size:11px;text-transform:uppercase}
.card{position:absolute;width:230px;background:#fff;border:1px solid #dfe1e6;border-left:5px solid #8993a4;border-radius:6px;padding:8px 10px;box-shadow:0 1px 2px #0001;cursor:grab;user-select:none;transition:opacity .15s}
.card.drag{cursor:grabbing;z-index:9;box-shadow:0 6px 16px #0004}
.card.done{border-left-color:#94c748;background:#f4f5f7;color:#8590a2;box-shadow:none}
.card.done .k{color:#7aa7e8}.card.done .m{color:#a5adba}.card.indeterminate{border-left-color:#1d7afc}
.card.ready{background:#fff7d6;border-color:#f5cd47;box-shadow:0 0 0 3px #f5cd4755}
.k{font-weight:700;color:#0c66e4}.st{float:right;font-size:10px;padding:1px 6px;border-radius:3px;background:#dfe1e6}
.done .st{background:#dcfff1;color:#216e4e}.indeterminate .st{background:#1d7afc;color:#fff}
.bk{font-size:10px;font-weight:600;color:#ae2e24;background:#ffeceb;border-radius:3px;padding:1px 6px;margin-left:6px}
.rd{font-size:10px;font-weight:600;color:#7f5f01;background:#f8e6a0;border-radius:3px;padding:1px 6px;margin-left:6px}
.s{margin:4px 0 6px;line-height:1.3}.m{font-size:11px;color:#5e6c84;line-height:1.5}
.dim .card{opacity:.25}.dim .card.on{opacity:1}.dim .card.self{outline:2px solid #1d7afc}
.dim .card.up{outline:2px solid #e2a03f}.dim .card.down{outline:2px solid #8f7ee7}
.dim path{opacity:.1}.dim path.on{opacity:1;stroke-width:2.5}`;

  let host;
  const close = () => { document.querySelector(SEL)?.remove(); host = null; };
  if (!window.__epicGraphEsc) {
    window.__epicGraphEsc = true;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelector(SEL)?.remove(); });
  }

  async function open() {
    const key = epicKey();
    if (!location.hostname.endsWith('.atlassian.net')) return;
    if (!key) return alert('Epic graph: open an epic ticket first.');
    close();
    host = document.createElement('div');
    host.dataset.epicGraph = '';
    host.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(1200px,75vw);z-index:2147483000;box-shadow:-4px 0 16px #0003';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="pane">
<div class="bar"><h1>${esc(key)}</h1><button id="zo" title="Zoom out">−</button><button id="zr" class="zr" title="Reset to 100%">100%</button><button id="zi" title="Zoom in">+</button><button id="zf">Fit</button><button id="fmt">Auto-format</button><button id="ref">Refresh</button><button id="x" title="Close (Esc)">✕</button></div>
<div class="sub">Solid arrow = blocks. Dashed = relates to. <span class="rd" style="margin:0">Ready</span> = To Do, all blockers done. <span class="bk" style="margin:0">blocks N</span> = not-done tickets further down the chain. Hover: <b style="color:#e2a03f">parents</b> / <b style="color:#8f7ee7">children</b>. Drag a card to move it, drag the canvas to pan, Ctrl/⌘ + scroll or pinch to zoom.</div>
<div class="scroll"><div class="msg">Loading…</div></div></div>`;
    document.body.append(host);
    root.getElementById('x').onclick = close;
    root.getElementById('ref').onclick = open;
    try {
      const { epic, nodes } = await load(key);
      root.querySelector('h1').innerHTML = `<a href="${location.origin}/browse/${esc(key)}">${esc(key)}</a> ${esc(epic.fields.summary)} (${esc(epic.fields.status.name)}, ${nodes.length} tickets)`;
      if (!nodes.length) { root.querySelector('.scroll').innerHTML = '<div class="msg">This epic has no child tickets.</div>'; return; }
      render(root, nodes);
    } catch (e) {
      root.querySelector('.scroll').innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    }
  }

  function render(root, D) {
    const scroll = root.querySelector('.scroll');
    scroll.innerHTML = '<div id="wrap"><svg><defs><marker id="a" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#6b778c"/></marker></defs></svg></div>';
    const wrap = root.getElementById('wrap'), svg = wrap.querySelector('svg');
    let z = 1;
    const by = Object.fromEntries(D.map(n => [n.key, n]));
    // ponytail: links to tickets outside the epic are dropped
    const E = D.flatMap(n => n.links.filter(l => by[l.to]).map(l => ({ from: n.key, to: l.to, type: l.type })));
    const B = E.filter(e => e.type === 'blocks');

    // longest-path layers over "blocks"; cycle members fall back to layer 0
    const lay = {}, indeg = {};
    D.forEach(n => { lay[n.key] = 0; indeg[n.key] = 0; });
    B.forEach(e => indeg[e.to]++);
    const q = D.filter(n => !indeg[n.key]).map(n => n.key);
    while (q.length) { const k = q.shift(); B.filter(e => e.from === k).forEach(e => { lay[e.to] = Math.max(lay[e.to], lay[k] + 1); if (!--indeg[e.to]) q.push(e.to); }); }
    // parentless cards sit one row above their first child
    D.forEach(n => { const ch = B.filter(e => e.from === n.key); if (ch.length && !B.some(e => e.to === n.key)) lay[n.key] = Math.max(0, Math.min(...ch.map(e => lay[e.to])) - 1); });
    const rows = {};
    D.forEach(n => (rows[lay[n.key]] ??= []).push(n.key));
    const R = Object.keys(rows).map(Number).sort((x, y) => x - y);
    // ponytail: barycenter sweeps to cut crossings; swap for dagre/elk past ~50 cards
    const cx = k => rows[lay[k]].indexOf(k) - (rows[lay[k]].length - 1) / 2;
    for (let i = 0; i < 8; i++) (i % 2 ? [...R].reverse() : R).forEach(r => {
      const m = {};
      rows[r].forEach(k => { const nb = B.filter(e => i % 2 ? e.from === k : e.to === k).map(e => cx(i % 2 ? e.to : e.from)); m[k] = nb.length ? nb.reduce((x, y) => x + y) / nb.length : cx(k); });
      rows[r].sort((x, y) => m[x] - m[y]);
    });

    // not-done tickets anywhere below k in the blocks chain
    const below = (k, seen = new Set()) => { B.forEach(e => { if (e.from === k && !seen.has(e.to)) { seen.add(e.to); below(e.to, seen); } }); return seen; };
    const blocks = k => by[k].cat === 'done' ? 0 : [...below(k)].filter(x => by[x].cat !== 'done').length;
    const ready = k => by[k].cat === 'new' && B.filter(e => e.to === k).every(e => by[e.from].cat === 'done');
    const W = 270, GAP = 70, LX = 70, pos = {};
    D.forEach(n => {
      const a = document.createElement('div');
      a.className = `card ${esc(n.cat)}${ready(n.key) ? ' ready' : ''}`;
      a.dataset.k = n.key;
      a.innerHTML = `<a class="k" target="_blank" href="${location.origin}/browse/${esc(n.key)}">${esc(n.key)}</a>${ready(n.key) ? '<span class="rd">Ready</span>' : ''}${blocks(n.key) ? `<span class="bk" title="Not-done tickets below this one in the blocks chain">blocks ${blocks(n.key)}</span>` : ''}<span class="st">${esc(n.status)}</span>
<div class="s">${esc(n.summary)}</div><div class="m">👤 ${esc(n.assignee)}<br>🏃 ${esc(n.sprint)}<br>${esc(n.type)} · ${esc(n.priority)} · upd ${esc(n.updated)}</div>`;
      wrap.append(a);
      pos[n.key] = a;
    });

    const NS = 'http://www.w3.org/2000/svg';
    E.forEach(e => {
      const p = e.p = document.createElementNS(NS, 'path');
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#6b778c'); p.setAttribute('stroke-width', '1.4');
      if (e.type !== 'blocks') p.setAttribute('stroke-dasharray', '5 4');
      p.setAttribute('marker-end', 'url(#a)');
      svg.append(p);
    });
    const draw = () => E.forEach(e => {
      let A = pos[e.from], Z = pos[e.to];
      if (e.type !== 'blocks' && A.offsetTop > Z.offsetTop) [A, Z] = [Z, A];
      const mid = c => [c.offsetLeft + c.offsetWidth / 2, c.offsetTop + c.offsetHeight / 2];
      let [x1, y1] = mid(A), [x2, y2] = mid(Z), d;
      if (Math.abs(y1 - y2) < A.offsetHeight / 2) {
        const r = x1 < x2, s = r ? 1 : -1;
        x1 += s * A.offsetWidth / 2; x2 -= s * Z.offsetWidth / 2;
        d = `M${x1},${y1}C${x1 + 30 * s},${y1} ${x2 - 30 * s},${y2} ${x2},${y2}`;
      } else {
        y1 = A.offsetTop + A.offsetHeight; y2 = Z.offsetTop;
        const c = Math.max(40, Math.abs(y2 - y1) / 2);
        d = `M${x1},${y1}C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`;
      }
      e.p.setAttribute('d', d);
    });
    const fit = () => {
      const cs = Object.values(pos);
      wrap.style.height = Math.max(...cs.map(a => a.offsetTop + a.offsetHeight)) + 20 + 'px';
      wrap.style.width = Math.max(...cs.map(a => a.offsetLeft + a.offsetWidth)) + 20 + 'px';
    };

    // highlight: "blocks" walked transitively, relates-to only as a direct neighbour
    let cur = null, drag = null;
    const walk = (k, down, seen = new Set()) => {
      E.forEach(e => {
        const [a, b] = down ? [e.from, e.to] : [e.to, e.from];
        if (a === k && !seen.has(b) && (e.type === 'blocks' || k === cur)) { seen.add(b); if (e.type === 'blocks') walk(b, down, seen); }
      });
      return seen;
    };
    const hl = k => {
      cur = k;
      Object.values(pos).forEach(c => c.classList.remove('on', 'self', 'up', 'down'));
      E.forEach(e => e.p.classList.remove('on'));
      if (!k) return wrap.classList.remove('dim');
      const up = walk(k, false), dn = walk(k, true), U = new Set([k, ...up]), Dn = new Set([k, ...dn]);
      wrap.classList.add('dim');
      pos[k].classList.add('on', 'self');
      up.forEach(x => pos[x].classList.add('on', 'up'));
      dn.forEach(x => pos[x].classList.add('on', 'down'));
      const direct = e => e.type === 'blocks' || e.to === k || e.from === k;
      E.forEach(e => { if (direct(e) && (U.has(e.from) && U.has(e.to) || Dn.has(e.from) && Dn.has(e.to))) e.p.classList.add('on'); });
    };
    Object.values(pos).forEach(c => {
      c.onmouseenter = () => { if (!drag) hl(c.dataset.k); };
      c.onmouseleave = () => { if (!drag) hl(null); };
      c.onpointerdown = ev => {
        if (ev.target.closest('a')) return;
        drag = { c, x: ev.clientX, y: ev.clientY, l: c.offsetLeft, t: c.offsetTop };
        c.classList.add('drag');
        c.setPointerCapture(ev.pointerId);
      };
      c.onpointermove = ev => {
        if (drag?.c !== c) return;
        c.style.left = Math.max(0, drag.l + (ev.clientX - drag.x) / z) + 'px';
        c.style.top = Math.max(0, drag.t + (ev.clientY - drag.y) / z) + 'px';
        draw(); fit();
      };
      c.onpointerup = () => { if (drag?.c === c) { c.classList.remove('drag'); drag = null; } };
    });

    const layout = () => {
      wrap.querySelectorAll('.col-h').forEach(h => h.remove());
      const maxN = Math.max(...R.map(r => rows[r].length));
      let y = 0;
      R.forEach(r => {
        const ks = rows[r], off = LX + (maxN - ks.length) * W / 2;
        const l = document.createElement('div');
        l.className = 'col-h'; l.style.left = '0'; l.style.top = y + 8 + 'px'; l.textContent = 'Layer ' + r;
        wrap.append(l);
        let h = 0;
        ks.forEach((k, i) => { const a = pos[k]; a.style.left = off + i * W + 'px'; a.style.top = y + 'px'; h = Math.max(h, a.offsetHeight); });
        y += h + GAP;
      });
      fit(); draw();
    };
    // infinite canvas: wrap is moved by translate(tx, ty) scale(z)
    let tx = 0, ty = 0, pan = null;
    const apply = () => {
      wrap.style.transform = `translate(${tx}px,${ty}px) scale(${z})`;
      scroll.style.backgroundSize = `${20 * z}px ${20 * z}px`;
      scroll.style.backgroundPosition = `${tx}px ${ty}px`;
      root.getElementById('zr').textContent = Math.round(z * 100) + '%';
    };
    // zoom keeps the canvas point under (cx, cy) fixed; defaults to the panel centre
    const zoom = (nz, cx, cy) => {
      const r = scroll.getBoundingClientRect();
      const mx = (cx ?? r.left + r.width / 2) - r.left, my = (cy ?? r.top + r.height / 2) - r.top;
      const px = (mx - tx) / z, py = (my - ty) / z;
      z = Math.min(3, Math.max(0.1, nz));
      tx = mx - px * z; ty = my - py * z;
      apply();
    };
    const fitView = () => {
      z = Math.min(1, (scroll.clientWidth - 40) / wrap.offsetWidth, (scroll.clientHeight - 40) / wrap.offsetHeight);
      tx = (scroll.clientWidth - wrap.offsetWidth * z) / 2; ty = 20;
      apply();
    };
    // wheel / two-finger scroll pans; Ctrl/Cmd + wheel and trackpad pinch zoom
    scroll.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoom(z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else { tx -= e.deltaX; ty -= e.deltaY; apply(); }
    }, { passive: false });
    // drag on empty canvas pans
    scroll.addEventListener('pointerdown', e => {
      if (e.target.closest('.card') || e.button !== 0) return;
      pan = { x: e.clientX - tx, y: e.clientY - ty };
      scroll.classList.add('panning');
      scroll.setPointerCapture(e.pointerId);
    });
    scroll.addEventListener('pointermove', e => { if (pan) { tx = e.clientX - pan.x; ty = e.clientY - pan.y; apply(); } });
    scroll.addEventListener('pointerup', () => { pan = null; scroll.classList.remove('panning'); });
    root.getElementById('zi').onclick = () => zoom(z * 1.25);
    root.getElementById('zo').onclick = () => zoom(z / 1.25);
    root.getElementById('zr').onclick = () => zoom(1);
    root.getElementById('zf').onclick = fitView;
    root.getElementById('fmt').onclick = () => { layout(); fitView(); };
    requestAnimationFrame(() => { layout(); fitView(); });
  }

  open();
})();
