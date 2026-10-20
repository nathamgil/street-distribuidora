/* Street Distribuidora — loja de atacado (vitrine + pedido + Pix). Demo Zync.
   Depende de: config.js (window.STREET_CONFIG), store.js (window.StreetDB), qrcode-generator, pix.js (window.StreetPix).
   Rotas (hash): #/ · #/c/<categoria>[/<sub>] · #/m/<marca> · #/busca/<termo> · #/colecao/<slug> · #/p/<handle>
                 #/rapido · #/checkout · #/pedido/<id> · #/conta · #/piteiras · #/sobre · #/politicas */
(() => {
  'use strict';
  const DB = window.StreetDB;
  const C = DB.config;
  const brl = DB.brl;
  const soDig = DB.soDig;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const enc = encodeURIComponent;
  const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmtNum = n => Number(n).toLocaleString('pt-BR');
  const reduzMov = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const app = $('#app');

  let CAT = null;          // catálogo
  let PRODS = [];          // produtos visíveis (sem ocultos)
  let SKU = new Map();     // SKU (maiúsculo) → {p, v}
  let pg = {};             // ganchos da página atual: {onCarrinho, onPedidos, sair, n}
  let rotaAtual = '';
  let rotaAnterior = '';
  const posicoes = {};     // hash → {y, n} para voltar do produto à lista no mesmo ponto

  /* ======================================================================
     Utilidades de produto
     ====================================================================== */
  const imgW = (u, w) => (u ? u + (u.includes('?') ? '&' : '?') + 'width=' + w : '');
  const srcset = (u, ws = [180, 270, 360, 540, 720]) => ws.map(w => `${imgW(u, w)} ${w}w`).join(', ');
  const SIZES_CARD = '(min-width:1280px) 250px, (min-width:1000px) 23vw, (min-width:640px) 31vw, 46vw';
  const temVar = p => Array.isArray(p.v) && p.v.length > 1;
  const keyDe = (p, v) => `${p.id}:${v ? v.id : (p.vid || 0)}`;
  const itemDe = (p, v) => ({
    pid: p.id, vid: v ? v.id : (p.vid || 0), nome: p.n, variante: v ? v.t : '', marca: p.m || '', sku: v ? v.sku : (p.sku || ''),
    preco: v ? v.p : p.p, img: (v && v.img) || p.img[0] || '', qtd: 0, por: p.por || null, un: p.un || null,
  });
  const precoMin = p => (temVar(p) ? Math.min(...p.v.map(v => v.p)) : p.p);
  const precoVaria = p => temVar(p) && new Set(p.v.map(v => v.p)).size > 1;
  const pctPromo = p => (p.de && p.de > p.p ? Math.round((1 - p.p / p.de) * 100) : 0);
  const ehMaster = p => !!(p.master || p.un === 'CM');
  const porUnidade = p => p.por > 1 && (p.un === 'DP' || p.un === 'DS' || (!p.un && /\bund\b/i.test(p.n)));
  function unLabel(p) {
    if (p.un === 'DP' || p.un === 'DS') return p.por ? `Display c/ ${p.por} und` : 'Display';
    if (p.un === 'CM') return 'Caixa master';
    if (p.un === 'CX') return p.por ? `Caixa c/ ${p.por} und` : 'Caixa';
    if (p.un === 'KIT') return 'Kit';
    if (p.un === 'UN') return 'Unidade';
    if (p.por && /\bund\b/i.test(p.n)) return `Pacote c/ ${p.por} und`;
    return '';
  }
  const pluralOpt = (opt, n) => {
    const o = String(opt || 'opção').toLowerCase();
    if (n === 1) return o;
    return o.split('/').map(w => (w === 'opção' ? 'opções' : /r$/.test(w) ? w + 'es' : /m$/.test(w) ? w.slice(0, -1) + 'ns' : w + 's')).join('/');
  };
  const linkP = p => '#/p/' + enc(p.h);
  const linkC = (c, s) => '#/c/' + enc(c) + (s ? '/' + enc(s) : '');
  const linkM = m => '#/m/' + enc(m);
  const qtdNoPedido = () => { const m = new Map(); DB.carrinho.itens().forEach(i => m.set(String(i.pid), (m.get(String(i.pid)) || 0) + i.qtd)); return m; };
  const qtdPorKey = () => new Map(DB.carrinho.itens().map(i => [i.key, i.qtd]));   // 1 leitura do carrinho por render
  // % até o pedido mínimo (mínimo 0 = sempre 100%, sem NaN)
  const pctMin = sub => (C.pedidoMinimo > 0 ? Math.min(100, (sub / C.pedidoMinimo) * 100) : 100);
  const RAIO = '<svg class="ic ic-raio" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';
  const wa = msg => `https://wa.me/${C.whatsapp}?text=${enc(msg)}`;
  const ordemDisp = (a, b) => (a.disp === b.disp ? 0 : a.disp ? -1 : 1);
  const ordemTop = (a, b) => ordemDisp(a, b) || (a.top || 9999) - (b.top || 9999) || a.n.localeCompare(b.n, 'pt-BR');

  function selos(p, max = 3) {
    const s = [];
    if (!p.disp) s.push(['esgotado', 'Esgotado']);
    if (p.novo) s.push(['novo', 'Novidade']);
    const pc = pctPromo(p); if (pc > 0) s.push(['promo', `Promo -${pc}%`]);
    if (p.top && p.top <= 40) s.push(['top', 'Mais pedido']);
    if (ehMaster(p)) s.push(['master', 'Caixa master']);
    if (p.orig) s.push(['orig', 'Original Street']);
    if (p.destaque) s.unshift(['pix', 'Destaque']);
    return s.slice(0, max).map(([c, t]) => `<span class="selo selo-${c}">${esc(t)}</span>`).join('');
  }

  function stepperHTML(valor = 1, { min = 1, label = 'Quantidade', key = '', p = false } = {}) {
    return `<div class="stepper${p ? ' p' : ''}${valor ? '' : ' zero'}"${key ? ` data-key="${esc(key)}"` : ''}>
      <button type="button" data-menos aria-label="Diminuir">−</button>
      <input type="number" inputmode="numeric" pattern="[0-9]*" min="${min}" max="9999" value="${valor}" aria-label="${esc(label)}">
      <button type="button" data-mais aria-label="Aumentar">+</button></div>`;
  }

  function precosHTML(p, grande = false) {
    const base = precoMin(p);
    const pix = DB.precoPix(base);
    const aPartir = precoVaria(p) || p.pmax ? '<span class="preco-de">a partir de</span>' : '';
    const de = pctPromo(p) ? `<s>${brl(DB.precoPix(p.de))}</s>` : '';
    const unit = porUnidade(p) ? `<div class="${grande ? 'unit' : 'preco-de'}">${brl(pix / p.por)}/und no Pix</div>` : '';
    return `<div class="precos">${aPartir}<div class="preco-pix"><strong>${brl(pix)}</strong><span class="tag-pix">Pix</span>${de}</div>
      <div class="preco-cartao">${brl(DB.precoCartao(base))} no cartão</div>${unit}</div>`;
  }

  function card(p, noMap) {
    const esg = !p.disp;
    const q = noMap ? noMap.get(String(p.id)) || 0 : 0;
    const i1 = p.img[0], i2 = p.img[1];
    const un = unLabel(p);
    const nVar = temVar(p) ? p.v.length : 0;
    let acoes;
    if (esg) acoes = `<div class="card-acoes"><button type="button" class="btn btn-p" data-avise="${p.id}">Avise-me</button></div>`;
    else if (nVar) acoes = `<div class="card-acoes"><button type="button" class="btn btn-laranja" data-grade="${p.id}">Escolher ${esc((p.opt || 'opção').toLowerCase())} (${nVar})</button></div>`;
    else acoes = `<div class="card-acoes dupla">${stepperHTML(1, { label: 'Quantidade de ' + p.n, p: true })}<button type="button" class="btn btn-preto" data-add="${p.id}">Adicionar</button></div>`;
    return `<article class="card${esg ? ' esgotado' : ''}" data-pid="${p.id}">
      <a class="card-img${i2 ? ' tem2' : ''}" href="${linkP(p)}" tabindex="-1" aria-hidden="true">
        <span class="selos">${selos(p)}</span>
        ${i1 ? `<img class="img1" src="${imgW(i1, 360)}" srcset="${srcset(i1)}" sizes="${SIZES_CARD}" alt="" loading="lazy" decoding="async" width="360" height="360">` : ''}
        ${i2 ? `<img class="img2" data-src="${imgW(i2, 360)}" alt="" decoding="async" width="360" height="360">` : ''}
      </a>
      <span class="card-no" data-no="${p.id}"${q ? '' : ' hidden'}>✓ ${q} no pedido</span>
      <div class="card-corpo">
        <div class="card-info">
          ${p.m ? `<a class="card-marca" href="${linkM(p.m)}">${esc(p.m)}</a>` : '<span class="card-marca">&nbsp;</span>'}
          <a class="card-nome" href="${linkP(p)}" title="${esc(p.n)}">${esc(p.n)}</a>
          <div class="card-un">${un ? `<b>${esc(un)}</b>` : ''}${nVar ? `<span>${nVar} ${esc(pluralOpt(p.opt, nVar))}</span>` : ''}</div>
        </div>
        ${precosHTML(p)}
        ${acoes}
      </div>
    </article>`;
  }

  /* ======================================================================
     Busca (índice normalizado, sem acento)
     ====================================================================== */
  // Indexa só o que está visível na loja (ocultos ficam fora da busca, do SKU exato e do "Colar lista").
  // Rodar de novo sempre que PRODS mudar (ajustes do painel trocam p.v e p.oculto).
  function indexar() {
    SKU = new Map();
    PRODS.forEach(p => {
      p._n = norm(p.n);
      p._s = norm([p.n, p.m, p.c, p.s, p.sku, ...(p.v || []).map(v => `${v.sku} ${v.t}`)].join(' '));
      if (p.sku) SKU.set(String(p.sku).toUpperCase(), { p, v: temVar(p) ? p.v.find(v => v.sku === p.sku) || null : null });
      (p.v || []).forEach(v => { if (v.sku) SKU.set(String(v.sku).toUpperCase(), { p, v: temVar(p) ? v : null }); });
    });
  }
  function buscar(q, lista = PRODS) {
    const t = norm(q).split(/\s+/).filter(Boolean);
    if (!t.length) return [];
    const qU = String(q).trim().toUpperCase();
    const res = [];
    for (const p of lista) {
      if (!t.every(x => p._s.includes(x))) continue;
      let sc = 0;
      if (SKU.get(qU) && SKU.get(qU).p === p) sc += 200;
      if (p._n.startsWith(t[0])) sc += 25;
      t.forEach(x => { if (p._n.includes(x)) sc += 8; if (norm(p.m) === x) sc += 12; if (norm(p.c).startsWith(x)) sc += 6; });
      if (p.top) sc += Math.max(0, (200 - p.top) / 20);
      if (p.disp) sc += 15;
      res.push([sc, p]);
    }
    return res.sort((a, b) => b[0] - a[0]).map(x => x[1]);
  }

  /* ======================================================================
     Topo: carrinho, conta, busca instantânea
     ====================================================================== */
  function atualizarTopo() {
    const qtd = DB.carrinho.qtdTotal();
    const sub = DB.carrinho.subtotal();
    const pct = pctMin(sub);
    $('#carrinho-qtd').textContent = qtd > 999 ? '999+' : qtd;
    $('#carrinho-sub').textContent = brl(DB.carrinho.subtotalPix());
    $('#carrinho-sr').textContent = `Abrir pedido: ${qtd} ${qtd === 1 ? 'item' : 'itens'}, ${brl(DB.carrinho.subtotalPix())} no Pix`;
    const anel = $('#anel-prog');
    anel.style.strokeDasharray = `${pct} 100`;
    anel.classList.toggle('ok', sub >= C.pedidoMinimo);
    const l = DB.lojistas.atual();
    $('#conta-rotulo').textContent = l ? 'Minha conta' : 'Entrar';
  }
  function pulo() {
    const b = $('#btn-carrinho');
    b.classList.remove('pulo'); void b.offsetWidth; b.classList.add('pulo');
  }

  const buscaInput = $('#busca-input');
  const buscaRes = $('#busca-res');
  // Painel de resultados comum (região com lista de links e botões), sem listbox: setas ↓/↑ levam o foco
  // de verdade para os links, então leitor de tela e teclado chegam também ao botão "+".
  function fecharBusca() { buscaRes.hidden = true; }
  const renderBusca = debounce(() => {
    const q = buscaInput.value.trim();
    $('#busca-limpar').hidden = !q;
    if (q.length < 2 || !CAT) { fecharBusca(); return; }
    const r = buscar(q);
    const nq = norm(q);
    const cats = Object.keys(CAT.categorias).filter(c => norm(c).includes(nq)).slice(0, 3);
    const marcas = CAT.marcas.filter(m => norm(m.nome).includes(nq)).slice(0, 4);
    const noMap = qtdNoPedido();
    let h = '';
    if (cats.length || marcas.length) {
      h += `<h3 class="br-grupo" id="br-g-atalhos">Atalhos</h3><ul class="br-chips" aria-labelledby="br-g-atalhos">${cats.map(c => `<li><a class="chip" href="${linkC(c)}">${esc(c)} <small>${CAT.categorias[c].n}</small></a></li>`).join('')}${marcas.map(m => `<li><a class="chip" href="${linkM(m.nome)}">${esc(m.nome)} <small>${m.n}</small></a></li>`).join('')}</ul>`;
    }
    if (r.length) {
      h += `<h3 class="br-grupo" id="br-g-prod">Produtos</h3><ul class="br-lista" aria-labelledby="br-g-prod">` + r.slice(0, 7).map(p => {
        const q2 = noMap.get(String(p.id)) || 0;
        const btn = !p.disp ? `<button type="button" class="br-add" disabled aria-label="${esc(p.n)}: esgotado">×</button>`
          : temVar(p) ? `<button type="button" class="br-add" data-grade="${p.id}" aria-label="Escolher ${esc(p.opt || 'opção')} de ${esc(p.n)}">+</button>`
          : `<button type="button" class="br-add" data-add-rapido="${p.id}" aria-label="Adicionar 1 ${esc(p.n)} ao pedido">+</button>`;
        return `<li class="br-item">
          ${p.img[0] ? `<img src="${imgW(p.img[0], 120)}" alt="" loading="lazy" width="52" height="52">` : '<span class="br-ph"></span>'}
          <a class="br-link" href="${linkP(p)}"><span class="br-nome">${esc(p.n)}</span><span class="br-meta">${esc([p.m, unLabel(p), p.disp ? '' : 'Esgotado', q2 ? `${q2} no pedido` : ''].filter(Boolean).join(' • '))}</span></a>
          <div class="br-dir"><span class="br-preco">${brl(DB.precoPix(precoMin(p)))}<span class="sr"> no Pix</span></span>${btn}</div></li>`;
      }).join('') + '</ul>';
      h += `<div class="br-pe"><span>${fmtNum(r.length)} ${r.length === 1 ? 'produto' : 'produtos'}</span><a href="#/busca/${enc(q)}">Ver todos os resultados →</a></div>`;
    } else {
      h += `<div class="br-vazio">Nada encontrado para “${esc(q)}”. Tente o nome da marca, o tipo de produto ou o SKU.</div>`;
    }
    buscaRes.innerHTML = h;
    buscaRes.hidden = false;
  }, 110);

  buscaInput.addEventListener('input', renderBusca);
  buscaInput.addEventListener('focus', () => { if (buscaInput.value.trim().length >= 2) renderBusca(); });
  // ↓ no campo → primeiro resultado; ↓/↑ entre os links; Esc volta ao campo
  $('#busca').addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!buscaRes.hidden) { fecharBusca(); buscaInput.focus(); } return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (buscaRes.hidden) return;
    const links = $$('.br-link, .br-pe a', buscaRes);
    if (!links.length) return;
    const i = links.indexOf(document.activeElement);
    if (e.target === buscaInput) { if (e.key === 'ArrowDown') { e.preventDefault(); links[0].focus(); } return; }
    if (!buscaRes.contains(e.target)) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i <= 0) { buscaInput.focus(); return; }
    const alvo = links[Math.max(0, Math.min(links.length - 1, (i < 0 ? 0 : i) + (e.key === 'ArrowDown' ? 1 : -1)))];
    alvo.focus(); alvo.scrollIntoView({ block: 'nearest' });
  });
  $('#busca').addEventListener('focusout', e => { if (!e.relatedTarget || !$('#busca').contains(e.relatedTarget)) { if (e.relatedTarget) fecharBusca(); } });
  $('#busca').addEventListener('submit', e => {
    e.preventDefault();
    const q = buscaInput.value.trim(); if (!q) return;
    const exato = SKU.get(q.toUpperCase());
    location.hash = exato && !exato.p.oculto ? linkP(exato.p) : '#/busca/' + enc(q);
    fecharBusca(); buscaInput.blur();
  });
  $('#busca-limpar').addEventListener('click', () => { buscaInput.value = ''; fecharBusca(); $('#busca-limpar').hidden = true; buscaInput.focus(); });
  document.addEventListener('click', e => { if (!e.target.closest('#busca')) fecharBusca(); });
  buscaRes.addEventListener('click', e => { if (e.target.closest('a')) fecharBusca(); });

  /* ======================================================================
     Toasts, folha (modal), gaveta
     ====================================================================== */
  // No celular: 1 toast por vez, embaixo (não cobre o carrinho do topo). Adições seguidas viram um toast só ("+3 itens").
  const celular = () => window.matchMedia('(max-width: 759px)').matches;
  function toast({ img = '', titulo, texto = '', acao = null, tipo = '', somaAdd = 0 }) {
    const box = $('#toasts');
    const ant = box.lastElementChild;
    let soma = somaAdd;
    if (somaAdd && ant && ant.dataset.somaAdd && !ant.classList.contains('sai')) {
      soma = Number(ant.dataset.somaAdd) + somaAdd;
      titulo = `${soma} ${soma === 1 ? 'unidade adicionada' : 'unidades adicionadas'} ao pedido`;
    }
    const el = document.createElement('div');
    el.className = 'toast ' + tipo;
    if (soma) el.dataset.somaAdd = soma;
    el.innerHTML = `${img ? `<img src="${esc(imgW(img, 100))}" alt="">` : `<span class="t-ic">${tipo === 'erro' ? '!' : '✓'}</span>`}
      <div style="min-width:0"><b>${esc(titulo)}</b>${texto ? `<span>${esc(texto)}</span>` : ''}</div>${acao ? `<button type="button">${esc(acao.rotulo)}</button>` : '<i></i>'}`;
    if (acao) el.querySelector('button').addEventListener('click', () => { acao.fn(); sair(); });
    if (somaAdd && ant && ant.dataset.somaAdd) ant.remove();
    box.appendChild(el);
    const max = celular() ? 1 : 3;
    while (box.children.length > max) box.firstChild.remove();
    let t = setTimeout(sair, acao && acao.rotulo === 'Desfazer' ? 5000 : 3200);
    el.addEventListener('mouseenter', () => clearTimeout(t));
    el.addEventListener('mouseleave', () => { t = setTimeout(sair, 1600); });
    el.addEventListener('focusin', () => clearTimeout(t));
    function sair() { el.classList.add('sai'); setTimeout(() => el.remove(), 320); }
  }

  // Fundo travado enquanto folha/gaveta estão abertas: inert (teclado e leitor de tela não escapam)
  // e, em tela de toque, body fixo guardando o scroll (overflow:hidden não trava o iOS).
  const FUNDO = ['.letreiro', '#topo', '#conteudo', '#rodape', '#zap', '#btn-instalar'];
  let fundoTravado = false, travaY = 0, rolagemPausada = false;
  const toque = window.matchMedia('(pointer: coarse)').matches;
  function travarFundo(on) {
    FUNDO.forEach(s => { const el = $(s); if (el) { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); } });
    if (on === fundoTravado) return;
    fundoTravado = on;
    const b = document.body;
    if (on) {
      b.style.overflow = 'hidden';
      if (toque) { travaY = window.scrollY; rolagemPausada = true; Object.assign(b.style, { position: 'fixed', top: -travaY + 'px', left: '0', right: '0', width: '100%' }); }
    } else {
      b.style.overflow = '';
      if (toque) { Object.assign(b.style, { position: '', top: '', left: '', right: '', width: '' }); window.scrollTo(0, travaY); rolagemPausada = false; }
    }
  }

  const folhaVeu = $('#folha-veu');
  const folha = $('#folha');
  let folhaFechavel = true, folhaAoFechar = null, folhaFocoAntes = null;
  function abrirFolha(html, { classe = '', fechavel = true, aoFechar = null } = {}) {
    folhaFocoAntes = document.activeElement;
    folha.className = 'folha ' + classe;
    folha.innerHTML = html;
    folhaFechavel = fechavel; folhaAoFechar = aoFechar;
    folha.style.transform = '';
    clearTimeout(folhaTimer);
    folhaVeu.hidden = false;
    folhaAberta = true;
    travarFundo(true);
    requestAnimationFrame(() => folhaVeu.classList.add('on'));
    setTimeout(() => { const f = folha.querySelector('[autofocus], input:not([type=hidden]), button:not([data-fechar-folha]), a[href]'); (f || folha).focus({ preventScroll: true }); }, 60);
    return folha;
  }
  let folhaAberta = false, folhaTimer = null;
  function fecharFolha() {
    if (!folhaAberta) return;
    folhaAberta = false;
    folhaVeu.classList.remove('on');
    folhaTimer = setTimeout(() => { folhaVeu.hidden = true; folha.innerHTML = ''; folha.style.transform = ''; }, 220);
    travarFundo(gavetaAberta);
    const fn = folhaAoFechar; folhaAoFechar = null; if (fn) fn();
    if (folhaFocoAntes && folhaFocoAntes !== document.body && document.contains(folhaFocoAntes) && !folhaFocoAntes.closest('[inert]')) folhaFocoAntes.focus({ preventScroll: true });
    else if (!gavetaAberta) { const h1 = $('h1', app); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); } }   // ex.: portão +18 aberto antes da página
  }
  folhaVeu.addEventListener('click', e => { if (e.target === folhaVeu && folhaFechavel) fecharFolha(); });
  // Arrastar o puxador / cabeçalho para baixo fecha a folha (celular)
  (() => {
    let y0 = null, dy = 0, id = null;
    folha.addEventListener('pointerdown', e => {
      if (!folhaFechavel || window.innerWidth >= 760 || e.button > 0) return;
      const r = folha.getBoundingClientRect();
      if (!(e.target.closest('.folha-cab') || e.clientY - r.top < 28) || e.target.closest('button, a, input, select, textarea')) return;
      y0 = e.clientY; dy = 0; id = e.pointerId;
      try { folha.setPointerCapture(id); } catch { /* */ }
      folha.style.transition = 'none';
    });
    folha.addEventListener('pointermove', e => {
      if (y0 == null || e.pointerId !== id) return;
      dy = Math.max(0, e.clientY - y0);
      folha.style.transform = `translateY(${dy}px)`;
    });
    const fim = e => {
      if (y0 == null || e.pointerId !== id) return;
      y0 = null; folha.style.transition = '';
      if (dy > 80) fecharFolha(); else folha.style.transform = '';
    };
    folha.addEventListener('pointerup', fim);
    folha.addEventListener('pointercancel', fim);
  })();
  const cabFolha = (tit, sub = '') => `<div class="folha-cab"><div style="min-width:0"><h2 id="folha-tit">${tit}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="x" type="button" data-fechar-folha aria-label="Fechar">×</button></div>`;

  const gaveta = $('#gaveta');
  const veu = $('#veu');
  let gavetaFocoAntes = null, gavetaAberta = false, gavetaTimer = null;
  function abrirGaveta() {
    fecharBusca();
    $('#toasts').innerHTML = '';
    if (!gavetaAberta) gavetaFocoAntes = document.activeElement;
    renderGaveta();
    clearTimeout(gavetaTimer);
    gaveta.hidden = false; veu.hidden = false;
    gavetaAberta = true;
    travarFundo(true);
    $('#btn-carrinho').setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => { gaveta.classList.add('on'); veu.classList.add('on'); });
    setTimeout(() => $('.x', gaveta).focus({ preventScroll: true }), 80);
  }
  function fecharGaveta() {
    if (!gavetaAberta) return;
    gavetaAberta = false;
    gaveta.classList.remove('on'); veu.classList.remove('on');
    $('#btn-carrinho').setAttribute('aria-expanded', 'false');
    gavetaTimer = setTimeout(() => { gaveta.hidden = true; veu.hidden = true; }, 330);
    travarFundo(folhaAberta);
    if (gavetaFocoAntes && document.contains(gavetaFocoAntes) && !gavetaFocoAntes.closest('[inert]')) gavetaFocoAntes.focus({ preventScroll: true });
  }
  veu.addEventListener('click', fecharGaveta);
  $('#btn-carrinho').addEventListener('click', abrirGaveta);

  function progressoHTML() {
    const sub = DB.carrinho.subtotal();
    if (!(C.pedidoMinimo > 0)) return '';
    const falta = Math.max(0, C.pedidoMinimo - sub);
    const pct = pctMin(sub);
    return `<div class="prog${falta ? '' : ' ok'}"><div class="prog-txt">${falta
      ? `Faltam <b>${brl(falta)}</b> para o pedido mínimo de ${brl(C.pedidoMinimo)}`
      : `<b>Pedido mínimo atingido.</b> Pode finalizar.`}</div>
      <div class="prog-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Progresso até o pedido mínimo"><i style="width:${pct}%"></i></div></div>`;
  }

  function renderGaveta() {
    const itens = DB.carrinho.itens();
    const corpo = $('#gaveta-corpo'), pe = $('#gaveta-pe');
    const foco = document.activeElement && gaveta.contains(document.activeElement) ? document.activeElement : null;
    const focoKey = foco && foco.closest('[data-key]') ? foco.closest('[data-key]').dataset.key : null;
    const focoTipo = foco ? (foco.hasAttribute('data-menos') ? 'menos' : foco.hasAttribute('data-mais') ? 'mais' : foco.tagName === 'INPUT' ? 'input' : '') : '';
    $('#gaveta-tit').textContent = itens.length ? `Seu pedido (${DB.carrinho.qtdTotal()})` : 'Seu pedido';
    if (!itens.length) {
      corpo.innerHTML = `<div class="gaveta-vazia"><img src="assets/img/logo-street.png" alt="" width="120" style="margin:0 auto;opacity:.25">
        <h3>Pedido vazio</h3><p class="muted">Adicione produtos direto dos cards ou use o pedido rápido por SKU.</p>
        <div class="dir-flex" style="justify-content:center"><a class="btn btn-preto" href="#/colecao/mais-pedidos" data-fechar-gaveta>Mais pedidos</a><a class="btn" href="#/rapido" data-fechar-gaveta>Pedido rápido</a></div></div>`;
      pe.innerHTML = `<p class="muted" style="margin:0;font-size:14px">${C.pedidoMinimo > 0 ? `Pedido mínimo de ${brl(C.pedidoMinimo)} • ` : ''}Pix sem acréscimo</p>`;
      return;
    }
    corpo.innerHTML = itens.map(i => {
      const p = CAT && CAT.porId.get(String(i.pid));
      const href = p ? linkP(p) : '#/';
      return `<div class="gi" data-key="${esc(i.key)}">
        ${i.img ? `<img src="${esc(imgW(i.img, 140))}" alt="" loading="lazy" width="64" height="64">` : '<span></span>'}
        <div style="min-width:0">
          <a class="gi-nome" href="${href}" data-fechar-gaveta>${esc(i.nome)}</a>
          <div class="gi-var">${esc([i.variante, i.sku ? 'SKU ' + i.sku : ''].filter(Boolean).join(' • '))}</div>
          <div class="gi-linha">${stepperHTML(i.qtd, { min: 0, key: i.key, label: 'Quantidade de ' + i.nome, p: true })}
            <div class="gi-val">${brl(DB.precoPix(i.preco) * i.qtd)}<small>${brl(DB.precoPix(i.preco))} un. no Pix</small></div></div>
          <button type="button" class="gi-rem" data-remover="${esc(i.key)}" aria-label="Remover ${esc(i.nome)}${i.variante ? ' — ' + esc(i.variante) : ''}">Remover</button>
        </div></div>`;
    }).join('');
    const sub = DB.carrinho.subtotal(), subPix = DB.carrinho.subtotalPix();
    const ok = sub >= C.pedidoMinimo;
    pe.innerHTML = `${progressoHTML()}
      <div class="linhas"><div><span>Subtotal no cartão</span><span>${brl(sub)}</span></div>
      <div class="total"><span>No Pix</span><span>${brl(subPix)}</span></div>
      <div class="eco"><span>Economia pagando no Pix</span><span>${brl(sub - subPix)}</span></div></div>
      <div style="display:grid;gap:8px;margin-top:12px">
        <a class="btn btn-verde btn-g btn-bloco" href="#/checkout" ${ok ? 'data-fechar-gaveta' : 'aria-disabled="true" data-bloqueado'}>Finalizar pedido</a>
        <div class="dir-flex" style="justify-content:space-between"><button type="button" class="btn btn-fantasma btn-p" data-fechar-gaveta>Continuar comprando</button><button type="button" class="btn btn-fantasma btn-p" data-limpar>Esvaziar</button></div>
      </div>`;
    if (focoKey) {
      const alvo = corpo.querySelector(`[data-key="${CSS.escape(focoKey)}"]`);
      const el = alvo && (focoTipo === 'menos' ? alvo.querySelector('[data-menos]') : focoTipo === 'mais' ? alvo.querySelector('[data-mais]') : alvo.querySelector('input'));
      if (el) el.focus({ preventScroll: true });
    }
  }

  /* ======================================================================
     Ações de compra
     ====================================================================== */
  function adicionar(p, v, qtd, { silencioso = false } = {}) {
    qtd = Math.min(DB.QTD_MAX, Math.floor(qtd) || 0);
    if (!qtd || qtd < 1) return;
    DB.carrinho.add(itemDe(p, v), qtd);
    pulo();
    if (!silencioso) {
      toast({ img: (v && v.img) || p.img[0], titulo: `${qtd} ${qtd === 1 ? 'unidade adicionada' : 'unidades adicionadas'} ao pedido`, texto: p.n + (v ? ' — ' + v.t : ''), acao: { rotulo: 'Ver pedido', fn: abrirGaveta }, somaAdd: qtd });
    }
  }
  function removerComDesfazer(key) {
    const it = DB.carrinho.itens().find(i => i.key === key); if (!it) return;
    DB.carrinho.remover(key);
    toast({ img: it.img, titulo: 'Item removido do pedido', texto: it.nome + (it.variante ? ' — ' + it.variante : ''), acao: { rotulo: 'Desfazer', fn: () => DB.carrinho.add(it, it.qtd) } });
  }
  function aviseMe(p, v) {
    const msg = `Olá, Street! Quero ser avisado quando chegar: ${p.n}${v ? ' — ' + v.t : ''} (SKU ${v ? v.sku : p.sku}).`;
    window.open(wa(msg), '_blank', 'noopener');
  }

  /* grade de variantes (produto com cores/estampas) */
  function vlinhaHTML(p, v, qMap) {
    const no = qMap.get(keyDe(p, v)) || 0;
    const img = v.img || p.img[0];
    return `<div class="vlinha${v.d ? '' : ' off'}" data-vid="${v.id}">
      ${img ? `<img src="${esc(imgW(img, 140))}" alt="" loading="lazy" width="56" height="56" data-vimg="${esc(img)}">` : '<span class="vph"></span>'}
      <div style="min-width:0"><div class="vlinha-nome">${esc(v.t)}</div>
        <div class="vlinha-sub">${v.d ? '<span class="ok">Disponível</span>' : '<span class="no">Esgotado</span>'} · <span class="mono">${esc(v.sku)}</span>${v.p !== precoMin(p) ? ' · ' + brl(DB.precoPix(v.p)) : ''}<span data-vno>${no ? ` · <b>${no} no pedido</b>` : ''}</span></div></div>
      ${v.d ? stepperHTML(0, { min: 0, label: `Quantidade de ${v.t}`, p: true }) : `<button type="button" class="btn btn-p" data-avise="${p.id}" data-avise-v="${v.id}">Avise-me</button>`}
    </div>`;
  }
  function vgradeHTML(p, { comCab = true } = {}) {
    const opt = p.opt || 'Opção';
    const nDisp = p.v.filter(v => v.d).length;
    return `${comCab ? `<div class="vgrade-cab"><h2>${esc(opt)} · ${nDisp} de ${p.v.length} disponíveis</h2>` : '<div class="vgrade-cab"><span class="muted" style="font-size:14px">' + nDisp + ' de ' + p.v.length + ' disponíveis</span>'}
      <div class="vatalhos"><button type="button" class="btn btn-p btn-fantasma" data-v-cada>+1 de cada</button><button type="button" class="btn btn-p btn-fantasma" data-v-zerar>Zerar</button></div></div>
      <div class="vgrade">${(qMap => p.v.map(v => vlinhaHTML(p, v, qMap)).join(''))(qtdPorKey())}</div>`;
  }
  function ligarVgrade(raiz, p, totalEl, btn, aoAdicionar) {
    const atualizar = () => {
      let q = 0, val = 0;
      $$('.vlinha', raiz).forEach(l => {
        const inp = $('input', l); if (!inp) return;
        const n = Math.max(0, Math.min(DB.QTD_MAX, parseInt(inp.value, 10) || 0));
        const v = p.v.find(x => String(x.id) === l.dataset.vid); if (!v) return;
        q += n; val += n * DB.precoPix(v.p);
        l.classList.toggle('tem', n > 0);
        inp.closest('.stepper').classList.toggle('zero', !n);
      });
      totalEl.innerHTML = q ? `${q} ${q === 1 ? 'unidade' : 'unidades'} na grade<strong>${brl(val)}</strong>` : `Escolha as quantidades<strong>${brl(0)}</strong>`;
      btn.disabled = !q;
      btn.textContent = q ? `Adicionar ${fmtNum(q)} ao pedido` : 'Adicionar ao pedido';
    };
    raiz.addEventListener('input', atualizar);
    raiz.addEventListener('click', e => {
      if (e.target.closest('[data-v-cada]')) { $$('.vlinha:not(.off) input', raiz).forEach(i => { i.value = (parseInt(i.value, 10) || 0) + 1; }); atualizar(); }
      if (e.target.closest('[data-v-zerar]')) { $$('.vlinha input', raiz).forEach(i => { i.value = 0; }); atualizar(); }
    });
    btn.addEventListener('click', () => {
      let total = 0, linhas = 0;
      $$('.vlinha', raiz).forEach(l => {
        const inp = $('input', l); if (!inp) return;
        const n = Math.max(0, Math.min(DB.QTD_MAX, parseInt(inp.value, 10) || 0)); if (!n) return;
        const v = p.v.find(x => String(x.id) === l.dataset.vid); if (!v || !v.d) return;
        DB.carrinho.add(itemDe(p, v), n); total += n; linhas++;
        inp.value = 0;
      });
      if (!total) return;
      pulo();
      toast({ img: p.img[0], titulo: `${total} ${total === 1 ? 'unidade adicionada' : 'unidades adicionadas'} ao pedido`, texto: `${p.n} • ${linhas} ${linhas === 1 ? 'variação' : 'variações'}`, acao: { rotulo: 'Ver pedido', fn: abrirGaveta } });
      const qMap = qtdPorKey();
      $$('.vlinha', raiz).forEach(l => {
        const v = p.v.find(x => String(x.id) === l.dataset.vid); if (!v) return;
        const no = qMap.get(keyDe(p, v)) || 0;
        const s = $('[data-vno]', l); if (s) s.innerHTML = no ? ` · <b>${no} no pedido</b>` : '';
      });
      atualizar();
      if (aoAdicionar) aoAdicionar();
    });
    atualizar();
  }
  function abrirGradeFolha(p) {
    fecharBusca();
    const f = abrirFolha(`${cabFolha('Escolher ' + esc((p.opt || 'opção').toLowerCase()), esc(p.n) + ' • ' + brl(DB.precoPix(precoMin(p))) + ' no Pix')}
      <div class="folha-corpo" id="vg-corpo">${vgradeHTML(p, { comCab: false })}</div>
      <div class="folha-pe"><div class="vtotal" style="position:static;border:0;padding:0;margin:0"><div class="vtotal-num" id="vg-total"></div>
        <div class="dir-flex"><a class="btn btn-fantasma btn-p" href="${linkP(p)}" data-fechar-folha>Ver produto</a><button type="button" class="btn btn-preto" id="vg-add">Adicionar ao pedido</button></div></div></div>`, { classe: 'larga' });
    ligarVgrade($('#vg-corpo', f), p, $('#vg-total', f), $('#vg-add', f), () => setTimeout(fecharFolha, 250));
  }

  /* ======================================================================
     Cliques globais (delegação)
     ====================================================================== */
  document.addEventListener('click', e => {
    const t = e.target;
    const step = t.closest('[data-menos], [data-mais]');
    if (step) {
      const st = step.closest('.stepper'); const inp = $('input', st);
      const min = parseInt(inp.min, 10) || 0;
      let v = parseInt(inp.value, 10) || 0;
      v = Math.min(DB.QTD_MAX, step.hasAttribute('data-mais') ? v + 1 : Math.max(min, v - 1));
      inp.value = v;
      st.classList.toggle('zero', !v);
      if (st.dataset.key) { if (v > 0) DB.carrinho.setQtd(st.dataset.key, v); else removerComDesfazer(st.dataset.key); }
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const add = t.closest('[data-add]');
    if (add) {
      const p = CAT.porId.get(add.dataset.add); if (!p || p.oculto || !p.disp) return;
      const box = add.closest('.card, .prod-info') || add.parentElement;
      const inp = box && $('.stepper input', box);
      const q = Math.min(DB.QTD_MAX, Math.max(1, parseInt(inp && inp.value, 10) || 1));
      adicionar(p, null, q);
      if (inp && box.classList.contains('card')) inp.value = 1;
      return;
    }
    const addR = t.closest('[data-add-rapido]');
    if (addR) { const p = CAT.porId.get(addR.dataset.addRapido); if (p && p.disp && !p.oculto) { adicionar(p, null, 1); renderBusca(); } return; }
    const gr = t.closest('[data-grade]');
    if (gr) { const p = CAT.porId.get(gr.dataset.grade); if (p && !p.oculto) abrirGradeFolha(p); return; }
    const av = t.closest('[data-avise]');
    if (av) { const p = CAT.porId.get(av.dataset.avise); if (p) aviseMe(p, av.dataset.aviseV ? p.v.find(v => String(v.id) === av.dataset.aviseV) : null); return; }
    const rem = t.closest('[data-remover]');
    if (rem) { removerComDesfazer(rem.dataset.remover); return; }
    if (t.closest('[data-limpar]')) { if (confirm('Esvaziar o pedido?')) DB.carrinho.limpar(); return; }
    const bloq = t.closest('[data-bloqueado]');
    if (bloq) {
      e.preventDefault();
      if (DB.carrinho.subtotal() >= C.pedidoMinimo) { location.hash = bloq.getAttribute('href') || '#/checkout'; if (gavetaAberta) fecharGaveta(); return; }
      toast({ titulo: 'Pedido mínimo não atingido', texto: `Faltam ${brl(Math.max(0, C.pedidoMinimo - DB.carrinho.subtotal()))}`, tipo: 'erro' }); return;
    }
    if (t.closest('[data-fechar-gaveta]')) { fecharGaveta(); }
    if (t.closest('[data-fechar-folha]')) { fecharFolha(); }
    if (t.closest('[data-abrir-carrinho]')) { e.preventDefault(); abrirGaveta(); return; }
    const rol = t.closest('[data-rolar]');
    if (rol) { const a = document.getElementById(rol.dataset.rolar); if (a) a.scrollIntoView({ behavior: reduzMov ? 'auto' : 'smooth' }); return; }
    const rep = t.closest('[data-repetir]');
    if (rep) { repetirPedido(rep.dataset.repetir); return; }
  });
  // stepper do carrinho: digitação confirma no "change". Vazio/negativo/inválido volta ao valor anterior;
  // 0 remove com "Desfazer"; acima de 9999 é limitado.
  document.addEventListener('change', e => {
    const inp = e.target;
    const st = inp.closest && inp.closest('.stepper[data-key]');
    if (!st || inp.tagName !== 'INPUT') return;
    const key = st.dataset.key;
    const n = parseInt(inp.value, 10);
    if (!Number.isFinite(n) || n < 0) { inp.value = DB.carrinho.qtdDe(key) || 1; return; }
    if (n === 0) { removerComDesfazer(key); return; }
    const q = Math.min(DB.QTD_MAX, n);
    if (q !== n) inp.value = q;
    DB.carrinho.setQtd(key, q);
  });
  // quantidade digitada nos steppers dos cards e da página do produto também respeita o teto
  document.addEventListener('change', e => {
    const inp = e.target;
    if (!inp.matches || !inp.matches('.stepper:not([data-key]) input')) return;
    const n = parseInt(inp.value, 10);
    if (Number.isFinite(n) && n > DB.QTD_MAX) inp.value = DB.QTD_MAX;
  });
  // 2ª foto do card só carrega no primeiro hover
  document.addEventListener('mouseover', e => {
    const a = e.target.closest && e.target.closest('.card-img.tem2');
    if (!a) return;
    const i2 = a.querySelector('img[data-src]');
    if (i2) { i2.src = i2.dataset.src; i2.removeAttribute('data-src'); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (folhaAberta && folhaFechavel) fecharFolha();
      else if (gavetaAberta) fecharGaveta();
    }
    if (e.key === 'Tab') {
      const box = folhaAberta ? folha : gavetaAberta ? gaveta : null;
      if (!box) return;
      const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', box).filter(x => x.offsetParent !== null);
      if (!f.length) { e.preventDefault(); box.focus && box.focus(); return; }
      // foco fora da folha/gaveta (ex.: ficou atrás do modal): traz para dentro
      if (!box.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); return; }
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  function repetirPedido(id) {
    const ped = DB.pedidos.get(id); if (!ped) return;
    let ok = 0, fora = 0;
    ped.itens.forEach(it => {
      const p = CAT.porId.get(String(it.pid));
      if (!p || !p.disp || p.oculto) { fora++; return; }
      const v = temVar(p) ? p.v.find(x => String(x.id) === String(it.vid)) : null;
      if (temVar(p) && (!v || !v.d)) { fora++; return; }
      DB.carrinho.add(itemDe(p, v), it.qtd); ok++;
    });
    pulo();
    toast({ titulo: `${ok} ${ok === 1 ? 'item voltou' : 'itens voltaram'} para o pedido`, texto: fora ? `${fora} ${fora === 1 ? 'está esgotado' : 'estão esgotados'} e ficaram de fora` : 'Confira as quantidades e finalize', acao: { rotulo: 'Ver pedido', fn: abrirGaveta }, tipo: fora ? '' : 'ok' });
  }

  /* ======================================================================
     Componentes de página
     ====================================================================== */
  function prateleira({ id, kicker = '', titulo, sub = '', lista, verTudo = '', cinza = false, extra = '', classe = '' }) {
    if (!lista.length) return '';
    const noMap = qtdNoPedido();
    return `<section class="secao${cinza ? ' cinza' : ''}${classe ? ' ' + classe : ''}" aria-labelledby="t-${id}"><div class="wrap">
      <div class="secao-cab"><div>${kicker ? `<div class="kicker">${kicker}</div>` : ''}<h2 class="tit-secao incl" id="t-${id}">${titulo}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
      ${extra || (verTudo ? `<a class="ver-tudo" href="${verTudo}">Ver tudo <span aria-hidden="true">→</span></a>` : '')}</div>
      <div class="prateleira"><button type="button" class="prat-seta esq" data-prat="-1" aria-label="Rolar para a esquerda">‹</button>
      <div class="prateleira-trilho" tabindex="0" aria-label="${esc(titulo.replace(/<[^>]+>/g, ''))}">${lista.map(p => card(p, noMap)).join('')}</div>
      <button type="button" class="prat-seta dir" data-prat="1" aria-label="Rolar para a direita">›</button></div>
    </div></section>`;
  }
  app.addEventListener('click', e => {
    const b = e.target.closest('[data-prat]'); if (!b) return;
    const tr = $('.prateleira-trilho', b.parentElement);
    tr.scrollBy({ left: Number(b.dataset.prat) * tr.clientWidth * 0.9, behavior: reduzMov ? 'auto' : 'smooth' });
  });

  function catImg(nome, w = 160) {
    const c = CAT.categorias[nome];
    if (c && c.img) return { src: `assets/img/cat/cat-${c.img}.jpg`, prod: false };
    const p = PRODS.filter(x => x.c === nome && x.img[0]).sort(ordemTop)[0];
    return p ? { src: imgW(p.img[0], w), prod: true } : null;
  }
  const catsOrdenadas = () => Object.keys(CAT.categorias).filter(c => CAT.categorias[c].n > 0).sort((a, b) => (a === 'Outros') - (b === 'Outros') || CAT.categorias[b].n - CAT.categorias[a].n);

  function renderCatbar() {
    $('#catbar-in').innerHTML = `<a class="cb-item cb-todos" href="#/rapido">${RAIO}Pedido rápido</a>` + catsOrdenadas().map(c => {
      const im = catImg(c, 80);
      return `<a class="cb-item" href="${linkC(c)}" data-cat="${esc(c)}">${im ? `<img src="${im.src}" alt="" width="36" height="36" loading="lazy"${im.prod ? ' style="object-fit:contain;background:#fff;padding:3px"' : ''}>` : `<span class="cb-ph">${esc(c[0])}</span>`}${esc(c)}</a>`;
    }).join('');
  }
  function marcarCatbar(cat) {
    $$('.cb-item[data-cat]').forEach(a => { const on = a.dataset.cat === cat; a.classList.toggle('ativo', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const at = $('.cb-item.ativo');
    if (at) { const box = $('#catbar-in'); box.scrollTo({ left: at.offsetLeft - 40, behavior: 'auto' }); }
  }

  function renderRodape() {
    const ig = C.instagram ? `https://instagram.com/${C.instagram}` : '';
    $('#rodape').innerHTML = `<div class="rodape-faixa">Venda exclusiva para lojistas • Proibida a venda para menores de 18 anos</div>
      <div class="rodape-in">
        <div><img class="logo" src="assets/img/logo-street.png" alt="Street" width="140" height="56"><p><b style="color:#fff">${esc(C.nome)}</b></p><p>${esc(C.slogan || '')}</p>
          <p class="aviso-18" style="color:#fff;margin-top:12px"><b>+18</b> Venda exclusiva para lojistas com CNPJ.</p></div>
        <div><h3>Atendimento</h3><ul>
          <li><a href="${wa('Olá, Street! Vim pelo site.')}" target="_blank" rel="noopener">WhatsApp ${esc(C.telefone || '')}</a></li>
          ${ig ? `<li><a href="${ig}" target="_blank" rel="noopener">Instagram @${esc(C.instagram)}</a></li>` : ''}
          </ul><p style="margin-top:8px">${esc(C.horario || '')}</p><p>${esc(C.endereco || '')}</p></div>
        <div><h3>Loja</h3><ul>
          <li><a href="#/rapido">Pedido rápido por SKU</a></li>
          <li><a href="#/colecao/mais-pedidos">Mais pedidos</a></li>
          <li><a href="#/colecao/novidades">Novidades</a></li>
          <li><a href="#/colecao/promocoes">Promoções</a></li>
          <li><a href="#/piteiras">Piteiras personalizadas</a></li></ul></div>
        <div><h3>Institucional</h3><ul>
          <li><a href="#/sobre">Sobre a Street</a></li>
          <li><a href="#/politicas">Entrega, trocas e pagamento</a></li>
          <li><a href="#/conta">Minha conta</a></li></ul></div>
      </div>
      <div class="rodape-base"><span>© ${new Date().getFullYear()} ${esc(C.razaoSocial || C.nome)} • CNPJ ${esc(C.cnpj)}</span><span class="zync">Site por <a href="https://zynchub.com.br" target="_blank" rel="noopener">Zync</a></span></div>`;
    $('#zap').href = wa('Olá, Street! Vim pelo site e quero fazer um pedido.');
    // as duas cópias do trilho (o letreiro é duplicado para rolar sem emenda)
    $$('[data-letreiro-minimo]').forEach(m => { m.textContent = C.pedidoMinimo > 0 ? 'PEDIDO MÍNIMO ' + brl(C.pedidoMinimo).replace(/,00$/, '').toUpperCase() : 'SEM PEDIDO MÍNIMO'; });
    const srL = $('.letreiro .sr'); if (srL) srL.textContent = `Venda só no atacado. Pix sem acréscimo. Envio em até 2 dias úteis em Salvador e RMS. ${C.pedidoMinimo > 0 ? `Pedido mínimo de ${brl(C.pedidoMinimo)}.` : ''} Fábrica de piteiras parceira.`;
  }

  const vazioHTML = (tit, txt, botoes = '') => `<div class="wrap" style="padding-top:32px;padding-bottom:56px"><div class="vazio"><h1 class="disp" style="font-size:28px;margin-bottom:8px">${tit}</h1><p class="muted">${txt}</p><div class="dir-flex" style="justify-content:center">${botoes || '<a class="btn btn-preto" href="#/">Voltar ao início</a>'}</div></div></div>`;

  /* ======================================================================
     HOME
     ====================================================================== */
  function home() {
    document.title = 'Street Distribuidora — Atacado para tabacarias e headshops';
    const P = PRODS;
    const nProd = P.length, nMarcas = CAT.marcas.filter(m => m.nome).length;
    const nProdTxt = fmtNum(Math.floor(nProd / 100) * 100) + '+';
    const nMarcasTxt = Math.floor(nMarcas / 10) * 10 + '+';
    const top = P.filter(p => p.top).sort(ordemTop).slice(0, 16);
    const destaques = P.filter(p => p.destaque).sort(ordemTop);
    const novos = P.filter(p => p.novo).sort(ordemTop).slice(0, 16);
    const promos = P.filter(p => pctPromo(p) > 0).sort((a, b) => ordemDisp(a, b) || pctPromo(b) - pctPromo(a)).slice(0, 16);
    const master = P.filter(ehMaster).sort(ordemTop).slice(0, 16);
    const orig = P.filter(p => p.orig).sort(ordemTop).slice(0, 16);
    const pitV = P.filter(p => p.c === 'Piteiras de Vidro' && p.disp && p.img[0]).sort(ordemTop).slice(0, 3);
    const maxM = Math.max(...CAT.marcas.map(m => m.n));
    const marcas = CAT.marcas.filter(m => m.nome).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const minTxt = brl(C.pedidoMinimo).replace(/,00$/, '');
    const temMin = C.pedidoMinimo > 0;

    // Lojista logado com pedido anterior: prateleira "Repor seu último pedido"
    const lj = DB.lojistas.atual();
    const ultimo = lj ? DB.pedidos.list().find(p => p.lojista && soDig(p.lojista.cnpj) === soDig(lj.cnpj)) : null;
    const repor = ultimo ? [...new Set(ultimo.itens.map(i => String(i.pid)))].map(id => CAT.porId.get(id)).filter(p => p && !p.oculto) : [];

    // Nota de pedido de exemplo com produtos reais do catálogo (SKU e preço Pix de verdade)
    const notaItens = P.filter(p => p.disp && p.top && !temVar(p) && p.sku).sort(ordemTop).slice(0, 3).map((p, i) => ({ p, q: [12, 6, 24][i] }));
    const notaTotal = notaItens.reduce((s, x) => s + DB.precoPix(x.p.p) * x.q, 0);

    app.innerHTML = `
    <section class="hero"><div class="wrap hero-in">
      <div>
        <div class="hero-tag"><span class="selo selo-top">Só atacado</span><span class="selo selo-novo">${esc(C.slogan || 'Distribuidora')}</span></div>
        <h1 class="disp incl"><span class="bloco">Abasteça</span><span class="bloco">sua loja com</span><span class="bloco l">a Street</span></h1>
        <p class="hero-sub"><b>${nProdTxt} acessórios de ${nMarcasTxt} marcas</b> para tabacaria e headshop. Monte o pedido em minutos, pague no <b>Pix sem acréscimo</b> e acompanhe tudo por aqui.</p>
        <div class="hero-ctas">
          <a class="btn-s" href="#/colecao/mais-pedidos"><span class="btn-s-txt">Comprar agora</span><span class="s-chip" aria-hidden="true"></span></a>
          <a class="btn btn-g btn-raio" href="#/rapido">${RAIO}Pedido rápido por SKU</a>
        </div>
        <div class="hero-num">
          <div><strong>${nProdTxt}</strong><span>produtos no catálogo</span></div>
          <div><strong>${nMarcasTxt}</strong><span>marcas do cenário</span></div>
          <div><strong>${temMin ? minTxt : 'Sem'}</strong><span>pedido mínimo</span></div>
        </div>
      </div>
      <div class="hero-vis">
        <span class="hero-adesivo a1"><span class="selo selo-pix">Pix sem acréscimo</span></span>
        <span class="hero-adesivo a2"><span class="selo selo-promo">Envio em até 2 dias úteis*</span></span>
        <a href="#/colecao/mais-pedidos" aria-label="Explore a linha completa"><img class="linha" src="assets/img/banner-linha-completa.jpg" alt="Explore a linha completa das principais marcas do cenário" width="1390" height="900" fetchpriority="high"></a>
      </div>
    </div></section>

    <section class="beneficios" aria-label="Vantagens"><ul class="adesivos wrap">
      <li class="adesivo ad-pix"><strong>Pix sem acréscimo</strong><span>cartão +${Math.round(C.acrescimoCartao * 100)}% via link</span></li>
      <li class="adesivo ad-prazo"><strong>2 dias úteis</strong><span>envio em Salvador e RMS*</span></li>
      <li class="adesivo ad-prod"><strong>${nProdTxt} produtos</strong><span>de ${nMarcasTxt} marcas</span></li>
      <li class="adesivo ad-min"><strong>${temMin ? 'Mín. ' + minTxt : 'Sem mínimo'}</strong><span>venda só no atacado</span></li>
    </ul></section>

    ${repor.length ? prateleira({ id: 'repor', kicker: `Seu último pedido • ${esc(ultimo.id)}`, titulo: 'Repor <em>seu estoque</em>', sub: `${esc(ultimo.lojista.razao || '')} • ${fmtData(ultimo.criadoEm)} • ${ultimo.itens.length} SKUs`, lista: repor, classe: 'repor', extra: `<button type="button" class="btn btn-laranja" data-repetir="${esc(ultimo.id)}">Repetir pedido inteiro</button>` }) : ''}

    <section class="carrossel" aria-roledescription="carrossel" aria-label="Destaques">
      <div class="carrossel-janela"><div class="carrossel-trilho" id="car-trilho">
        <a class="carrossel-slide" role="group" aria-roledescription="slide" href="${linkC('Cases')}" aria-label="1 de 2: Cases Street — a peça perfeita para os seus kits"><img src="assets/img/banner-cases.jpg" alt="Cases Street: a peça perfeita para os seus kits" width="1800" height="570" loading="lazy"></a>
        <a class="carrossel-slide" role="group" aria-roledescription="slide" href="${linkC('Piteiras de Vidro')}" aria-label="2 de 2: Monte o seu próprio carrinho${temMin ? ` — pedido mínimo de ${minTxt}` : ''}"><img src="assets/img/banner-2.jpg" alt="Monte o seu próprio carrinho!${temMin ? ` Pedido mínimo de ${minTxt}` : ''}" width="1800" height="570" loading="lazy"></a>
      </div></div>
      <button type="button" class="carrossel-seta esq" data-car="-1" aria-label="Banner anterior">‹</button>
      <button type="button" class="carrossel-seta dir" data-car="1" aria-label="Próximo banner">›</button>
      <div class="carrossel-pontos" id="car-pontos"><button type="button" aria-label="Banner 1" aria-current="true" data-ir="0"></button><button type="button" aria-label="Banner 2" data-ir="1"></button>
        <button type="button" class="carrossel-pausa" id="car-pausa" aria-pressed="false" aria-label="Pausar troca automática dos banners"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-pausa" d="M7 5h3v14H7zM14 5h3v14h-3z"/><path class="i-play" d="M8 5v14l11-7z"/></svg></button></div>
    </section>

    ${destaques.length ? prateleira({ id: 'dest', kicker: 'Escolhidos pela Street', titulo: 'Destaques <em>da semana</em>', lista: destaques }) : ''}
    ${prateleira({ id: 'top', kicker: 'Ranking de vendas', titulo: 'Mais pedidos <em>pelos lojistas</em>', sub: 'O que mais gira nas prateleiras das tabacarias.', lista: top, verTudo: '#/colecao/mais-pedidos' })}

    <section class="secao cinza" aria-labelledby="t-cats"><div class="wrap">
      <div class="secao-cab"><div><div class="kicker">${Object.keys(CAT.categorias).length} categorias</div><h2 class="tit-secao incl" id="t-cats">Compre por <em>categoria</em></h2></div></div>
      <div class="cats">${catsOrdenadas().map(c => { const im = catImg(c, 300); return `<a class="cat" href="${linkC(c)}"><span class="cat-img">${im ? `<img class="${im.prod ? 'prod' : ''}" src="${im.src}" alt="" loading="lazy" width="215" height="215">` : ''}</span><strong>${esc(c)}</strong><small>${CAT.categorias[c].n} itens</small></a>`; }).join('')}</div>
    </div></section>

    <section class="secao" aria-labelledby="t-marcas"><div class="wrap">
      <div class="secao-cab" style="justify-content:center;text-align:center"><div><div class="kicker">${nMarcas} marcas</div><h2 class="tit-secao incl" id="t-marcas">A parede <em>de marcas</em></h2><p class="sub">Quanto maior o nome, mais itens da marca no catálogo.</p></div></div>
      <div class="marcas-parede">${marcas.map(m => `<a class="marca-tag" href="${linkM(m.nome)}" style="font-size:${Math.round(15 + 38 * Math.sqrt(m.n / maxM))}px">${esc(m.nome)}<sup>${m.n}</sup></a>`).join('')}</div>
    </div></section>

    ${prateleira({ id: 'novos', kicker: 'Acabou de chegar', titulo: 'Novidades', lista: novos, verTudo: '#/colecao/novidades', cinza: true })}
    ${prateleira({ id: 'promo', kicker: 'Preço baixou', titulo: 'Promoções', sub: 'Preço "de" riscado e desconto calculado no valor do Pix.', lista: promos, verTudo: '#/colecao/promocoes' })}

    <section class="secao escura" aria-labelledby="t-fab"><div class="wrap fabrica">
      <div>
        <div class="kicker">Fábrica de piteiras parceira</div>
        <h2 class="disp incl" id="t-fab">Crie a piteira <em>da sua loja</em></h2>
        <p style="margin-top:16px;font-size:17px">Piteiras de vidro com a sua marca: do modelo simples ao full print e às artísticas. Quase todas as piteiras de vidro do nosso site são da casa.</p>
        <div class="fabrica-tipos"><span>Simples</span><span>Full print</span><span>Artísticas</span></div>
        <a class="btn-s claro" href="#/piteiras"><span class="btn-s-txt">Quero personalizar</span><span class="s-chip" aria-hidden="true"></span></a>
      </div>
      <div class="fabrica-fotos">${pitV.map(p => `<a href="${linkP(p)}" aria-label="${esc(p.n)}"><img src="${imgW(p.img[0], 360)}" alt="" loading="lazy" width="360" height="480"></a>`).join('')}</div>
    </div></section>

    ${prateleira({ id: 'master', kicker: 'Para quem compra grande', titulo: 'Caixas <em>master</em>', sub: 'Caixa fechada para quem compra em volume.', lista: master, verTudo: '#/colecao/master' })}
    ${prateleira({ id: 'orig', kicker: 'Marca própria', titulo: 'Originais <em>Street</em>', lista: orig, verTudo: '#/colecao/originais', cinza: true })}

    <section class="secao" aria-labelledby="t-como"><div class="wrap como">
      <div class="como-txt">
        <div class="kicker">Simples assim</div>
        <h2 class="tit-secao incl" id="t-como">Como funciona <em>pro lojista</em></h2>
        <ol class="como-passos">
          <li><b>Cadastre o CNPJ.</b> A gente preenche razão social e cidade sozinho. Venda só para lojistas.</li>
          <li><b>Monte o pedido.</b> Direto dos cards, em grade de cores e estampas ou colando a lista de SKUs.</li>
          <li><b>Pague no Pix.</b> QR Code e copia e cola na hora, sem acréscimo. Cartão com link pelo WhatsApp.</li>
          <li><b>Receba.</b> Retire no galpão ou receba em até 2 dias úteis em Salvador e RMS*. Acompanhe o status por aqui.</li>
        </ol>
        <div class="dir-flex"><a class="btn btn-preto btn-raio" href="#/rapido">${RAIO}Fazer um pedido rápido</a><a class="ver-tudo" href="#/politicas">Entrega e trocas <span aria-hidden="true">→</span></a></div>
      </div>
      ${notaItens.length ? `<figure class="nota" aria-label="Exemplo de nota de pedido com produtos do catálogo">
        <div class="nota-cab"><img src="assets/img/logo-street.png" alt="" width="96" height="38"><span>Nota de pedido</span><small>Exemplo</small></div>
        <div class="nota-bloco"><span class="nota-n">01</span><div><b>Sua loja</b><span class="nota-ok">CNPJ conferido na Receita ✓</span></div></div>
        <div class="nota-bloco"><span class="nota-n">02</span><div style="min-width:0;flex:1"><b>Itens por SKU</b>
          ${notaItens.map(x => `<div class="nota-item"><span class="mono">${esc(x.p.sku)}</span><i aria-hidden="true"></i><span>${x.q} un</span><b>${brl(DB.precoPix(x.p.p) * x.q)}</b></div>`).join('')}</div></div>
        <div class="nota-bloco nota-pix"><span class="nota-n">03</span><div style="flex:1"><b>Total no Pix</b><span class="nota-total">${brl(notaTotal)}</span><span class="muted">QR Code e copia e cola na hora</span></div>
          <svg class="nota-qr" viewBox="0 0 21 21" aria-hidden="true"><path d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zm1 1v5h5V1zm1 1h3v3h-3zM0 14h7v7H0zm1 1v5h5v-5zm1 1h3v3H2zM9 0h2v2H9zm0 3h1v3H9zm3 1h1v2h-1zM8 8h3v1H8zm4 0h2v2h-2zm3 0h1v3h-1zm2 1h4v1h-4zM9 10h2v2H9zm-9-1h2v1H0zm3 0h3v2H3zm6 4h2v1H9zm3-1h1v3h-1zm2 2h3v1h-3zm4-2h3v2h-3zm-9 4h2v3H9zm3 1h2v2h-2zm4 0h1v3h-1zm2 1h3v2h-3z"/></svg></div>
        <div class="nota-bloco"><span class="nota-n">04</span><div><b>Status ao vivo</b><span class="nota-status"><span class="st-chip st-aguardando_pagamento">Aguardando Pix</span><span aria-hidden="true">→</span><span>Pago</span><span aria-hidden="true">→</span><span>Separação</span><span aria-hidden="true">→</span><span>Enviado</span></span></div></div>
        <figcaption class="nota-pe">Produtos e preços reais do catálogo • ${temMin ? `pedido mínimo ${minTxt}` : 'sem pedido mínimo'}</figcaption>
      </figure>` : ''}
    </div>
    <div class="wrap"><p class="muted" style="font-size:14px;margin-top:18px">* Salvador e região metropolitana. Bahia em até 1 semana; demais estados com prazo informado na cotação.</p></div></section>`;

    // carrossel: pausa no hover, no foco e no toque; botão de pausa; slide fora da tela não recebe foco
    const trilho = $('#car-trilho'), pontos = $$('#car-pontos [data-ir]'), slides = $$('.carrossel-slide', trilho);
    const n = pontos.length; let i = 0, timer = null, pausado = reduzMov;
    const btnPausa = $('#car-pausa');
    const ir = k => {
      i = (k + n) % n; trilho.style.transform = `translateX(-${i * 100}%)`;
      pontos.forEach((b, j) => b.setAttribute('aria-current', j === i ? 'true' : 'false'));
      slides.forEach((s, j) => { if (j === i) { s.removeAttribute('inert'); s.removeAttribute('aria-hidden'); } else { s.setAttribute('inert', ''); s.setAttribute('aria-hidden', 'true'); } });
    };
    const parar = () => clearInterval(timer);
    const play = () => { parar(); if (pausado) return; timer = setInterval(() => ir(i + 1), 6000); };
    const marcarPausa = () => { btnPausa.setAttribute('aria-pressed', String(pausado)); btnPausa.setAttribute('aria-label', pausado ? 'Retomar troca automática dos banners' : 'Pausar troca automática dos banners'); btnPausa.classList.toggle('parado', pausado); };
    const car = $('.carrossel');
    car.addEventListener('click', e => {
      if (e.target.closest('#car-pausa')) { pausado = !pausado; marcarPausa(); play(); return; }
      const a = e.target.closest('[data-car]'); if (a) { ir(i + Number(a.dataset.car)); play(); }
      const d = e.target.closest('[data-ir]'); if (d) { ir(Number(d.dataset.ir)); play(); }
    });
    car.addEventListener('mouseenter', parar);
    car.addEventListener('mouseleave', () => { if (!car.contains(document.activeElement)) play(); });
    car.addEventListener('focusin', parar);
    car.addEventListener('focusout', e => { if (!car.contains(e.relatedTarget)) play(); });
    car.addEventListener('touchstart', parar, { passive: true });
    let x0 = null;
    car.addEventListener('pointerdown', e => { x0 = e.clientX; });
    car.addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) { car.dataset.arrastou = '1'; setTimeout(() => delete car.dataset.arrastou, 50); ir(i + (dx < 0 ? 1 : -1)); } play(); });
    car.addEventListener('click', e => { if (e.target.closest('a') && car.dataset.arrastou) { e.preventDefault(); } }, true);
    ir(0); marcarPausa(); play();
    pg.sair = () => clearInterval(timer);
  }

  /* ======================================================================
     CATÁLOGO (#/c, #/m, #/busca, #/colecao)
     ====================================================================== */
  const ORDENS = [['top', 'Mais pedidos'], ['menor', 'Menor preço'], ['maior', 'Maior preço'], ['az', 'A–Z'], ['novo', 'Novidades']];
  function ordenar(lista, ordem) {
    const l = lista.slice();
    const f = {
      top: ordemTop,
      menor: (a, b) => ordemDisp(a, b) || precoMin(a) - precoMin(b),
      maior: (a, b) => ordemDisp(a, b) || precoMin(b) - precoMin(a),
      az: (a, b) => ordemDisp(a, b) || a.n.localeCompare(b.n, 'pt-BR'),
      novo: (a, b) => ordemDisp(a, b) || (b.novo ? 1 : 0) - (a.novo ? 1 : 0) || ordemTop(a, b),
      rel: ordemDisp,
    }[ordem] || ordemTop;
    return l.sort(f);
  }
  const FLAGS = [['disp', 'Só disponíveis', p => p.disp], ['promo', 'Em promoção', p => pctPromo(p) > 0], ['novo', 'Novidades', p => !!p.novo], ['master', 'Caixa master', ehMaster]];

  function paginaCatalogo({ titulo, kicker = '', migalha = [], base, subs = null, subAtiva = null, catPai = null, catToggle = true, ordem = 'top', tituloDoc, vazio }) {
    document.title = (tituloDoc || titulo) + ' • Street Distribuidora';
    // volta do produto ou re-render ao vivo (painel mudou algo): restaura filtros, ordem e quantos itens já estavam carregados
    const salvo = (rotaAnterior.startsWith('/p/') || rerenderAoVivo) && posicoes[rotaAtual] && posicoes[rotaAtual].st ? posicoes[rotaAtual] : null;
    const st = { marcas: new Set(), flags: new Set(), cat: null, ordem, vista: DB.ls.get('vista', 'grade'), n: salvo ? salvo.n : 48, lista: [] };
    if (salvo && salvo.st) { st.marcas = new Set(salvo.st.marcas); st.flags = new Set(salvo.st.flags); st.cat = salvo.st.cat; st.ordem = salvo.st.ordem; }
    pg.n = () => ({ n: st.n, st: { marcas: [...st.marcas], flags: [...st.flags], cat: st.cat, ordem: st.ordem } });

    const catsNaBase = () => { const m = new Map(); base.forEach(p => m.set(p.c, (m.get(p.c) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    let chips = '';
    if (subs && subs.length) {
      const cont = new Map(); PRODS.filter(p => p.c === catPai).forEach(p => cont.set(p.s, (cont.get(p.s) || 0) + 1));
      const sv = subs.filter(s => cont.get(s));
      if (sv.length) chips = `<nav class="chips" aria-label="Subcategorias"><a class="chip${subAtiva ? '' : ' ativo'}" href="${linkC(catPai)}"${subAtiva ? '' : ' aria-current="page"'}>Todas <small>${PRODS.filter(p => p.c === catPai).length}</small></a>${sv.map(s => `<a class="chip${s === subAtiva ? ' ativo' : ''}" href="${linkC(catPai, s)}"${s === subAtiva ? ' aria-current="page"' : ''}>${esc(s)} <small>${cont.get(s)}</small></a>`).join('')}</nav>`;
    } else if (catToggle) {
      const cs = catsNaBase();
      if (cs.length > 1) chips = `<div class="chips" role="group" aria-label="Filtrar por categoria" id="chips-cat">${cs.map(([c, n]) => `<button type="button" class="chip" data-chip-cat="${esc(c)}" aria-pressed="${st.cat === c}">${esc(c)} <small>${n}</small></button>`).join('')}</div>`;
    }

    app.innerHTML = `
      <div class="cat-cab"><div class="wrap">
        ${migalha.length ? `<nav class="migalha" aria-label="Você está em">${migalha.map(([t, h], i) => (h ? `<a href="${h}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`) + (i < migalha.length - 1 ? '<span aria-hidden="true">/</span>' : '')).join('')}</nav>` : ''}
        ${kicker ? `<div class="kicker">${kicker}</div>` : ''}
        <h1 class="disp incl">${esc(titulo)}</h1>
        <div class="contagem" id="contagem"></div>
        ${chips}
      </div></div>
      <div class="wrap catalogo">
        <aside class="filtros-lado" aria-label="Filtros" id="filtros-lado"></aside>
        <div style="min-width:0">
          <div class="barra-res">
            <div class="esq"><button type="button" class="btn btn-p btn-filtros" id="btn-filtros"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filtros<span id="nfiltros"></span></button>
              <label class="sr" for="ordem">Ordenar por</label>
              <select class="sel" id="ordem">${(ordem === 'rel' ? [['rel', 'Mais relevantes'], ...ORDENS] : ORDENS).map(([v, t]) => `<option value="${v}"${v === st.ordem ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="alterna" role="group" aria-label="Visualização">
              <button type="button" data-vista="grade" aria-pressed="${st.vista === 'grade'}" aria-label="Ver em grade"><svg class="ic" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg></button>
              <button type="button" data-vista="lista" aria-pressed="${st.vista === 'lista'}" aria-label="Ver em lista"><svg class="ic" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/></svg></button>
            </div>
          </div>
          <div class="ativos" id="ativos"></div>
          <div class="grade${st.vista === 'lista' ? ' lista' : ''}" id="grade"></div>
          <div class="mais" id="mais"></div>
        </div>
      </div>`;

    const baseCat = () => (st.cat ? base.filter(p => p.c === st.cat) : base);
    function filtrosHTML(pref) {
      const b = baseCat();
      const cm = new Map(); b.forEach(p => { if (p.m) cm.set(p.m, (cm.get(p.m) || 0) + 1); });
      const ms = [...cm.entries()].sort((a, b2) => b2[1] - a[1] || a[0].localeCompare(b2[0], 'pt-BR'));
      return `<div class="filtro-grupo"><h3>Mostrar</h3>${FLAGS.map(([k, t, fn]) => { const n = b.filter(fn).length; return n ? `<label class="check"><input type="checkbox" data-flag="${k}"${st.flags.has(k) ? ' checked' : ''}><span>${t}</span><small>${n}</small></label>` : ''; }).join('')}</div>
        ${ms.length > 1 ? `<div class="filtro-grupo"><h3>Marcas</h3>${ms.length > 8 ? `<label class="sr" for="${pref}-bm">Buscar marca</label><input class="filtro-marcas-busca" id="${pref}-bm" type="search" placeholder="Buscar marca" data-busca-marca>` : ''}
          <div class="filtro-marcas">${ms.map(([m, n]) => `<label class="check" data-nm="${esc(norm(m))}"><input type="checkbox" data-marca="${esc(m)}"${st.marcas.has(m) ? ' checked' : ''}><span>${esc(m)}</span><small>${n}</small></label>`).join('')}</div></div>` : ''}
        <div class="filtro-grupo" style="border:0"><button type="button" class="link" data-limpar-filtros>Limpar filtros</button></div>`;
    }
    const lado = $('#filtros-lado');
    function renderFiltros() { lado.innerHTML = filtrosHTML('fl'); }

    let obs = null;
    function aplicar(manterN = false) {
      let l = baseCat();
      if (st.marcas.size) l = l.filter(p => st.marcas.has(p.m));
      st.flags.forEach(k => { const fn = FLAGS.find(f => f[0] === k)[2]; l = l.filter(fn); });
      st.lista = ordenar(l, st.ordem);
      if (!manterN) st.n = 48;
      const nf = st.marcas.size + st.flags.size + (st.cat ? 1 : 0);
      $('#nfiltros').textContent = nf ? ` (${nf})` : '';
      $('#contagem').textContent = `${fmtNum(st.lista.length)} ${st.lista.length === 1 ? 'produto' : 'produtos'}${st.lista.length !== base.length ? ` de ${fmtNum(base.length)}` : ''}`;
      const at = [];
      if (st.cat) at.push(`<button type="button" class="chip ativo" data-tira-cat>${esc(st.cat)} <span class="chip-x" aria-hidden="true">×</span><span class="sr">remover filtro</span></button>`);
      st.flags.forEach(k => at.push(`<button type="button" class="chip ativo" data-tira-flag="${k}">${FLAGS.find(f => f[0] === k)[1]} <span class="chip-x" aria-hidden="true">×</span><span class="sr">remover filtro</span></button>`));
      st.marcas.forEach(m => at.push(`<button type="button" class="chip ativo" data-tira-marca="${esc(m)}">${esc(m)} <span class="chip-x" aria-hidden="true">×</span><span class="sr">remover filtro</span></button>`));
      $('#ativos').innerHTML = at.join('') + (at.length > 1 ? '<button type="button" class="link" data-limpar-filtros style="margin-left:6px">Limpar tudo</button>' : '');
      $('#ativos').hidden = !at.length;
      $$('[data-chip-cat]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.chipCat === st.cat)));
      renderGrade();
    }
    function renderGrade() {
      const g = $('#grade'), mais = $('#mais');
      if (!st.lista.length) {
        g.innerHTML = `<div class="vazio" style="grid-column:1/-1">${vazio || '<h2>Nada por aqui</h2><p class="muted">Nenhum produto com esses filtros.</p>'}${(st.marcas.size || st.flags.size || st.cat) ? '<button type="button" class="btn btn-preto" data-limpar-filtros>Limpar filtros</button>' : ''}</div>`;
        mais.innerHTML = ''; return;
      }
      const noMap = qtdNoPedido();
      g.innerHTML = st.lista.slice(0, st.n).map(p => card(p, noMap)).join('');
      rodapeMais();
    }
    function rodapeMais() {
      const mais = $('#mais');
      const mostr = Math.min(st.n, st.lista.length);
      if (mostr >= st.lista.length) { mais.innerHTML = st.lista.length > 12 ? `<span>Você viu todos os ${fmtNum(st.lista.length)} produtos.</span>` : ''; if (obs) obs.disconnect(); return; }
      mais.innerHTML = `<span>Mostrando ${fmtNum(mostr)} de ${fmtNum(st.lista.length)}</span><button type="button" class="btn" id="btn-mais">Carregar mais produtos</button><span id="sentinela" style="height:1px;width:1px"></span>`;
      if ('IntersectionObserver' in window) {
        if (obs) obs.disconnect();
        obs = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) carregarMais(); }, { rootMargin: '700px 0px' });
        obs.observe($('#sentinela'));
      }
    }
    function carregarMais() {
      const g = $('#grade'); if (!g) return;
      const de = st.n; st.n += 48;
      const noMap = qtdNoPedido();
      g.insertAdjacentHTML('beforeend', st.lista.slice(de, st.n).map(p => card(p, noMap)).join(''));
      rodapeMais();
    }

    function abrirFiltrosFolha() {
      const f = abrirFolha(`${cabFolha('Filtros')}<div class="folha-corpo" id="filtros-folha">${filtrosHTML('ff')}</div>
        <div class="folha-pe"><button type="button" class="btn btn-preto btn-bloco btn-g" data-fechar-folha id="ver-n">Ver ${fmtNum(st.lista.length)} produtos</button></div>`);
      ligarFiltros($('#filtros-folha', f), () => { $('#ver-n', f).textContent = `Ver ${fmtNum(st.lista.length)} produtos`; });
    }
    function ligarFiltros(raiz, depois) {
      raiz.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.flag) { t.checked ? st.flags.add(t.dataset.flag) : st.flags.delete(t.dataset.flag); }
        else if (t.dataset.marca != null) { t.checked ? st.marcas.add(t.dataset.marca) : st.marcas.delete(t.dataset.marca); }
        else return;
        aplicar();
        if (raiz !== lado) renderFiltros();
        if (depois) depois();
      });
      raiz.addEventListener('input', e => {
        if (!e.target.matches('[data-busca-marca]')) return;
        const q = norm(e.target.value);
        $$('[data-nm]', raiz).forEach(l => { l.hidden = q && !l.dataset.nm.includes(q); });
      });
    }
    ligarFiltros(lado);
    const limpar = () => { st.marcas.clear(); st.flags.clear(); st.cat = null; aplicar(); renderFiltros(); };
    function cliques(e) {
      const t = e.target;
      if (t.closest('#btn-filtros')) abrirFiltrosFolha();
      else if (t.closest('#btn-mais')) carregarMais();
      else if (t.closest('[data-limpar-filtros]')) limpar();
      else if (t.closest('[data-tira-cat]')) { st.cat = null; st.marcas.clear(); aplicar(); renderFiltros(); }
      else if (t.closest('[data-tira-flag]')) { st.flags.delete(t.closest('[data-tira-flag]').dataset.tiraFlag); aplicar(); renderFiltros(); }
      else if (t.closest('[data-tira-marca]')) { st.marcas.delete(t.closest('[data-tira-marca]').dataset.tiraMarca); aplicar(); renderFiltros(); }
      else if (t.closest('[data-chip-cat]')) { const c = t.closest('[data-chip-cat]').dataset.chipCat; st.cat = st.cat === c ? null : c; st.marcas.clear(); aplicar(); renderFiltros(); }
      else if (t.closest('[data-vista]')) {
        st.vista = t.closest('[data-vista]').dataset.vista; DB.ls.set('vista', st.vista);
        $('#grade').classList.toggle('lista', st.vista === 'lista');
        $$('[data-vista]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vista === st.vista)));
      }
    }
    function cliquesF(e) {
      if (e.target.closest('[data-limpar-filtros]') && folha.contains($('#filtros-folha'))) { limpar(); $('#filtros-folha').innerHTML = filtrosHTML('ff'); const b = $('#ver-n'); if (b) b.textContent = `Ver ${fmtNum(st.lista.length)} produtos`; }
    }
    app.addEventListener('click', cliques);
    folha.addEventListener('click', cliquesF);
    $('#ordem').addEventListener('change', e => { st.ordem = e.target.value; aplicar(); });

    renderFiltros();
    aplicar(true);
    pg.sair = () => { if (obs) obs.disconnect(); app.removeEventListener('click', cliques); folha.removeEventListener('click', cliquesF); };
  }

  function rotaCategoria(c, s) {
    const cat = CAT.categorias[c];
    if (!cat) { app.innerHTML = vazioHTML('Categoria não encontrada', 'Ela pode ter mudado de nome. Veja todas as categorias no início.'); return; }
    const base = PRODS.filter(p => p.c === c && (!s || p.s === s));
    marcarCatbar(c);
    paginaCatalogo({
      titulo: s ? `${c}: ${s}` : c, tituloDoc: s ? `${c} ${s}` : c, kicker: 'Categoria',
      migalha: [['Início', '#/'], ...(s ? [[c, linkC(c)], [s, '']] : [[c, '']])], base, subs: cat.subs, subAtiva: s || null, catPai: c, catToggle: false,
    });
  }
  function rotaMarca(m) {
    const base = PRODS.filter(p => p.m === m);
    if (!base.length) { app.innerHTML = vazioHTML('Marca não encontrada', `Não achamos produtos da marca “${esc(m)}”.`); return; }
    paginaCatalogo({ titulo: m, kicker: 'Marca', migalha: [['Início', '#/'], ['Marcas', '#/'], [m, '']], base });
  }
  function rotaBusca(q) {
    buscaInput.value = q; $('#busca-limpar').hidden = !q;
    const base = buscar(q);
    paginaCatalogo({
      titulo: q ? `“${q}”` : 'Busca', tituloDoc: `Busca: ${q}`, kicker: 'Resultado da busca', migalha: [['Início', '#/'], ['Busca', '']], base, ordem: 'rel',
      vazio: `<h2>Nada encontrado</h2><p class="muted">Não achamos “${esc(q)}”. Tente outra palavra, a marca ou o SKU. Ou peça pelo WhatsApp que a gente procura.</p><a class="btn btn-verde" target="_blank" rel="noopener" href="${wa('Olá, Street! Procuro: ' + q)}">Perguntar no WhatsApp</a>`,
    });
  }
  const COLECOES = {
    'mais-pedidos': { t: 'Mais pedidos', k: 'Ranking de vendas', f: p => !!p.top },
    novidades: { t: 'Novidades', k: 'Acabou de chegar', f: p => !!p.novo },
    promocoes: { t: 'Promoções', k: 'Preço baixou', f: p => pctPromo(p) > 0 },
    master: { t: 'Caixas master', k: 'Para quem compra grande', f: ehMaster },
    originais: { t: 'Originais Street', k: 'Marca própria', f: p => !!p.orig },
    destaques: { t: 'Destaques', k: 'Escolhidos pela Street', f: p => !!p.destaque },
  };
  function rotaColecao(slug) {
    const c = COLECOES[slug];
    if (!c) { app.innerHTML = vazioHTML('Coleção não encontrada', 'Volte ao início para ver as vitrines.'); return; }
    paginaCatalogo({ titulo: c.t, kicker: c.k, migalha: [['Início', '#/'], [c.t, '']], base: PRODS.filter(c.f) });
  }

  /* ======================================================================
     PRODUTO
     ====================================================================== */
  function rotaProduto(h) {
    const p = CAT.porHandle.get(h);
    if (!p || p.oculto) { app.innerHTML = vazioHTML('Produto não encontrado', 'Ele pode ter saído do catálogo. Busque pelo nome ou SKU.'); return; }
    document.title = p.n + ' • Street Distribuidora';
    marcarCatbar(p.c);
    const imgs = p.img.slice(0, 5);
    const nVar = temVar(p);
    const no = DB.carrinho.itens().filter(i => String(i.pid) === String(p.id)).reduce((s, i) => s + i.qtd, 0);
    const rel = PRODS.filter(x => x !== p && x.c === p.c && (p.s ? x.s === p.s : true)).sort(ordemTop);
    const relM = p.m ? PRODS.filter(x => x !== p && x.m === p.m && !rel.includes(x)).sort(ordemTop) : [];
    const relacionados = [...rel.slice(0, 10), ...relM].slice(0, 12);
    let compra;
    if (!p.disp) {
      compra = `<div class="aviso laranja" style="margin:14px 0"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.5"/></svg><div><b>Esgotado no momento.</b> Clique em “Avise-me” e a Street te chama no WhatsApp quando chegar.</div></div>
        <button type="button" class="btn btn-preto btn-g btn-bloco" data-avise="${p.id}">Avise-me quando chegar</button>`;
    } else if (nVar) {
      compra = `<div id="vg-prod">${vgradeHTML(p)}</div>
        <div class="vtotal"><div class="vtotal-num" id="vg-total"></div><button type="button" class="btn btn-preto btn-g" id="vg-add">Adicionar ao pedido</button></div>`;
    } else {
      compra = `<div class="prod-add">${stepperHTML(1, { label: 'Quantidade' })}<button type="button" class="btn btn-preto btn-g" data-add="${p.id}">Adicionar ao pedido</button></div>`;
    }
    app.innerHTML = `<div class="wrap">
      <nav class="migalha" aria-label="Você está em" style="padding-top:16px;margin:0"><a href="#/">Início</a><span aria-hidden="true">/</span><a href="${linkC(p.c)}">${esc(p.c)}</a>${p.s ? `<span aria-hidden="true">/</span><a href="${linkC(p.c, p.s)}">${esc(p.s)}</a>` : ''}</nav>
      <div class="prod">
        <div class="galeria">
          <div class="galeria-principal" id="gal-princ" role="button" tabindex="0" aria-label="Ampliar foto">
            <span class="selos">${selos(p, 4)}</span>
            ${imgs[0] ? `<img id="gal-img" src="${imgW(imgs[0], 900)}" srcset="${srcset(imgs[0], [450, 700, 900, 1200])}" sizes="(min-width:900px) 50vw, 100vw" alt="${esc(p.n)}" width="900" height="900">` : ''}
          </div>
          ${imgs.length > 1 ? `<div class="galeria-mini" role="group" aria-label="Fotos do produto">${imgs.map((u, i) => `<button type="button" data-foto="${esc(u)}" aria-label="Foto ${i + 1}"${i ? '' : ' aria-current="true"'}><img src="${imgW(u, 160)}" alt="" loading="lazy" width="70" height="70"></button>`).join('')}</div>` : ''}
        </div>
        <div class="prod-info">
          ${p.m ? `<a class="prod-marca" href="${linkM(p.m)}">${esc(p.m)}</a>` : ''}
          <h1>${esc(p.n)}</h1>
          <div class="prod-meta">${p.sku && !nVar ? `<span>SKU <b class="mono">${esc(p.sku)}</b></span>` : ''}${unLabel(p) ? `<span>Unidade de venda: <b>${esc(unLabel(p))}</b></span>` : ''}${nVar ? `<span><b>${p.v.length}</b> ${esc(pluralOpt(p.opt, p.v.length))}</span>` : ''}</div>
          <div class="prod-preco">${precosHTML(p, true)}</div>
          ${no ? `<div class="aviso verde" style="margin-bottom:12px"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg><div>Você já tem <b>${no}</b> deste produto no pedido. <button type="button" class="link" data-abrir-carrinho>Ver pedido</button></div></div>` : ''}
          ${compra}
          <div class="prod-garantias">
            <div><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg><span>Pix sem acréscimo • cartão com +${Math.round(C.acrescimoCartao * 100)}% pelo link</span></div>
            <div><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg><span>Envio em até 2 dias úteis em Salvador e RMS • retirada no galpão</span></div>
            <div><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg><span>Defeito de fabricação? Avise em até 3 dias com fotos. <a class="link" href="#/politicas">Trocas</a></span></div>
          </div>
          <div class="prod-desc"><h2>Descrição</h2><div class="txt" id="desc"><div class="esqueleto" style="height:16px;margin-bottom:8px"></div><div class="esqueleto" style="height:16px;width:80%"></div></div></div>
        </div>
      </div></div>
      ${prateleira({ id: 'rel', kicker: 'Combina com a sua vitrine', titulo: 'Relacionados', lista: relacionados, verTudo: linkC(p.c, p.s), cinza: true })}`;

    // galeria
    const princ = $('#gal-princ'), gimg = $('#gal-img');
    const trocar = u => { if (!gimg) return; gimg.src = imgW(u, 900); gimg.srcset = srcset(u, [450, 700, 900, 1200]); princ.classList.remove('zoom'); };
    $$('[data-foto]').forEach(b => b.addEventListener('click', () => { trocar(b.dataset.foto); $$('[data-foto]').forEach(x => x.removeAttribute('aria-current')); b.setAttribute('aria-current', 'true'); }));
    const zoom = () => { princ.classList.toggle('zoom'); if (!princ.classList.contains('zoom') && gimg) gimg.style.transformOrigin = 'center'; };
    princ.addEventListener('click', zoom);
    princ.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(); } });
    princ.addEventListener('mousemove', e => {
      if (!princ.classList.contains('zoom') || !gimg) return;
      const r = princ.getBoundingClientRect();
      gimg.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    });
    if (nVar && p.disp) {
      ligarVgrade($('#vg-prod'), p, $('#vg-total'), $('#vg-add'));
      $('#vg-prod').addEventListener('click', e => { const im = e.target.closest('[data-vimg]'); if (im) { trocar(im.dataset.vimg); window.scrollTo({ top: 0, behavior: reduzMov ? 'auto' : 'smooth' }); } });
    }
    DB.descricao(p.id).then(txt => {
      const d = $('#desc'); if (!d) return;
      if (txt == null) { d.innerHTML = 'Não foi possível carregar a descrição agora. <button type="button" class="link" id="desc-de-novo">Tentar de novo</button>'; $('#desc-de-novo').addEventListener('click', () => rotear(true)); return; }
      d.textContent = txt ? txt.trim() : 'Sem descrição detalhada. Dúvidas sobre medidas ou embalagem? Pergunte no WhatsApp.';
    });
  }

  /* ======================================================================
     PEDIDO RÁPIDO
     ====================================================================== */
  function rotaRapido() {
    document.title = 'Pedido rápido • Street Distribuidora';
    const st = { q: '', cat: '', disp: true, soPedido: false, n: 80, linhas: [] };
    const exemplos = PRODS.filter(p => p.disp && p.top && !temVar(p) && p.sku).sort(ordemTop).slice(0, 3);
    app.innerHTML = `
      <div class="rapido-cab"><div class="wrap">
        <div class="kicker" style="color:var(--mostarda)">Feito para o atacado</div>
        <h1 class="disp incl">Pedido <em>rápido</em></h1>
        <p>Digite a quantidade e aperte <b>Enter</b> para ir ao próximo. Produtos com cores ou estampas abrem uma linha por variação. Tem a lista pronta? Cole tudo de uma vez.</p>
        <div class="dir-flex" style="margin-top:16px"><button type="button" class="btn btn-laranja" id="btn-colar"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/></svg>Colar lista de SKUs</button></div>
      </div></div>
      <div class="rapido-ferr">
        <div class="wrap" id="ferr">
          <div class="campo-busca"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><label class="sr" for="rq">Buscar por nome, SKU ou marca</label><input id="rq" type="search" placeholder="Nome, SKU ou marca" autocomplete="off"></div>
          <div class="dir-flex"><label class="sr" for="rcat">Categoria</label><select class="sel" id="rcat" style="flex:1 1 180px"><option value="">Todas as categorias</option>${catsOrdenadas().map(c => `<option>${esc(c)}</option>`).join('')}</select>
          <label class="check" style="min-height:44px"><input type="checkbox" id="rdisp" checked><span>Só disponíveis</span></label>
          <label class="check" style="min-height:44px"><input type="checkbox" id="rped"><span>Só o que está no pedido</span></label></div>
        </div>
      </div>
      <div class="wrap rapido-lista">
        <div class="rl rl-cab" aria-hidden="true"><span></span><span>SKU</span><span>Produto</span><span style="text-align:right">Preço Pix</span><span style="text-align:center">Quantidade</span></div>
        <div id="rl-corpo"></div>
        <div class="mais" id="rl-mais"></div>
      </div>
      <div class="rapido-pe" id="rapido-pe"></div>`;
    document.body.classList.add('tem-pe');
    let qMap = new Map();   // key → qtd no pedido (1 leitura do carrinho por render, não 1 por linha)

    function montar(manterN = false) {
      let l = PRODS;
      if (st.cat) l = l.filter(p => p.c === st.cat);
      l = st.q ? buscar(st.q, l) : l.slice().sort(ordemTop);
      if (st.disp) l = l.filter(p => p.disp);
      const linhas = [];
      const itensKeys = new Set(DB.carrinho.itens().map(i => i.key));
      l.forEach(p => {
        if (temVar(p)) {
          const vs = p.v.filter(v => (!st.disp || v.d) && (!st.soPedido || itensKeys.has(keyDe(p, v))));
          if (!vs.length) return;
          linhas.push({ tipo: 'pai', p, n: vs.length });
          vs.forEach(v => linhas.push({ tipo: 'var', p, v }));
        } else {
          if (st.soPedido && !itensKeys.has(keyDe(p, null))) return;
          linhas.push({ tipo: 'uni', p });
        }
      });
      st.linhas = linhas;
      if (!manterN) st.n = 80;
      render();
    }
    function linhaHTML(r) {
      const p = r.p;
      if (r.tipo === 'pai') {
        return `<div class="rl pai">${p.img[0] ? `<img src="${imgW(p.img[0], 120)}" alt="" loading="lazy" width="48" height="48">` : '<span class="rlph"></span>'}
          <span class="rl-sku-col"></span><div style="min-width:0"><div class="rl-nome"><a href="${linkP(p)}">${esc(p.n)}</a></div><div class="rl-meta"><span>${esc(p.m || '')}</span><span>${r.n} ${esc(pluralOpt(p.opt, r.n))} abaixo</span></div></div>
          <span class="rl-preco-col"><span class="rl-preco">${brl(DB.precoPix(precoMin(p)))}</span></span><span></span></div>`;
      }
      const v = r.v || null;
      const key = keyDe(p, v);
      const q = qMap.get(key) || 0;
      const preco = v ? v.p : p.p;
      const off = v ? !v.d : !p.disp;
      const sku = v ? v.sku : p.sku;
      const img = v ? (v.img || p.img[0]) : p.img[0];
      const nome = v ? v.t : p.n;
      return `<div class="rl${r.tipo === 'var' ? ' var' : ''}${q ? ' tem' : ''}${off ? ' off' : ''}" data-key="${esc(key)}" data-pid="${p.id}" data-vid="${v ? v.id : ''}">
        ${img ? `<img src="${imgW(img, 120)}" alt="" loading="lazy" width="48" height="48">` : '<span class="rlph"></span>'}
        <span class="rl-sku-col rl-sku">${esc(sku || '—')}</span>
        <div style="min-width:0"><div class="rl-nome">${v ? esc(nome) : `<a href="${linkP(p)}">${esc(nome)}</a>`}</div>
          <div class="rl-meta"><span class="so-mob rl-sku">${esc(sku || '')}</span>${!v && p.m ? `<span>${esc(p.m)}</span>` : ''}${unLabel(p) ? `<span>${esc(unLabel(p))}</span>` : ''}<span class="so-mob rl-preco">${brl(DB.precoPix(preco))}</span>${off ? '<span style="color:var(--erro);font-weight:700">Esgotado</span>' : ''}</div></div>
        <span class="rl-preco-col"><span class="rl-preco">${brl(DB.precoPix(preco))}</span><br><small class="muted">${brl(preco)} cartão</small></span>
        <div class="rl-qtd"><input type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="9999" value="${q || ''}" placeholder="0" aria-label="Quantidade de ${esc(p.n)}${v ? ' — ' + esc(v.t) : ''}"${off ? ' disabled' : ''}><small>${q ? brl(DB.precoPix(preco) * q) : ''}</small></div>
      </div>`;
    }
    let obs = null;
    function render() {
      const corpo = $('#rl-corpo');
      if (!st.linhas.length) {
        corpo.innerHTML = `<div class="vazio" style="margin-top:16px"><h2>Nada encontrado</h2><p class="muted">${st.soPedido ? 'Seu pedido ainda está vazio.' : 'Tente outro nome, SKU ou marca.'}</p></div>`;
        $('#rl-mais').innerHTML = ''; return;
      }
      qMap = qtdPorKey();
      corpo.innerHTML = st.linhas.slice(0, st.n).map(linhaHTML).join('');
      maisRodape();
    }
    function maisRodape() {
      const m = $('#rl-mais');
      const total = st.linhas.length;
      if (st.n >= total) { m.innerHTML = `<span>${fmtNum(total)} ${total === 1 ? 'linha' : 'linhas'}</span>`; if (obs) obs.disconnect(); return; }
      m.innerHTML = `<span>Mostrando ${fmtNum(st.n)} de ${fmtNum(total)} linhas</span><button type="button" class="btn" id="rl-btn-mais">Carregar mais</button><span id="rl-sent" style="height:1px;width:1px"></span>`;
      if ('IntersectionObserver' in window) { if (obs) obs.disconnect(); obs = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) mais(); }, { rootMargin: '800px 0px' }); obs.observe($('#rl-sent')); }
    }
    function mais() {
      const de = st.n; st.n += 80;
      qMap = qtdPorKey();
      $('#rl-corpo').insertAdjacentHTML('beforeend', st.linhas.slice(de, st.n).map(linhaHTML).join(''));
      maisRodape();
    }
    function commit(input) {
      const row = input.closest('.rl'); if (!row) return;
      const p = CAT.porId.get(row.dataset.pid); if (!p || p.oculto) return;
      const v = row.dataset.vid ? p.v.find(x => String(x.id) === row.dataset.vid) : null;
      if (v ? !v.d : !p.disp) return;
      const key = row.dataset.key;
      const q = Math.max(0, Math.min(DB.QTD_MAX, parseInt(input.value, 10) || 0));
      if (String(q) !== input.value && input.value !== '') input.value = q || '';
      const atual = DB.carrinho.qtdDe(key);
      if (q === atual) return;
      if (!atual && q > 0) { DB.carrinho.add(itemDe(p, v), q); pulo(); }
      else if (!q) removerComDesfazer(key);
      else DB.carrinho.setQtd(key, q);
    }
    const corpo = $('#rl-corpo');
    corpo.addEventListener('change', e => { if (e.target.matches('.rl-qtd input')) commit(e.target); });
    corpo.addEventListener('keydown', e => {
      if (!e.target.matches('.rl-qtd input')) return;
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.altKey)) {
        e.preventDefault();
        commit(e.target);
        let ins = $$('.rl-qtd input:not([disabled])', corpo);
        let i = ins.indexOf(e.target);
        if (i === ins.length - 1 && st.n < st.linhas.length) { mais(); ins = $$('.rl-qtd input:not([disabled])', corpo); }
        const prox = ins[i + 1];
        if (prox) { prox.focus(); prox.select(); prox.scrollIntoView({ block: 'center', behavior: reduzMov ? 'auto' : 'smooth' }); }
      }
    });
    corpo.addEventListener('focusin', e => { if (e.target.matches('.rl-qtd input')) e.target.select(); });

    const qBusca = debounce(() => { st.q = $('#rq').value.trim(); montar(); }, 140);
    $('#rq').addEventListener('input', qBusca);
    $('#rq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const f = $('.rl-qtd input:not([disabled])', corpo); if (f) f.focus(); } });
    $('#rcat').addEventListener('change', e => { st.cat = e.target.value; montar(); });
    $('#rdisp').addEventListener('change', e => { st.disp = e.target.checked; montar(); });
    $('#rped').addEventListener('change', e => { st.soPedido = e.target.checked; montar(); });
    $('#rl-mais').addEventListener('click', e => { if (e.target.closest('#rl-btn-mais')) mais(); });
    $('#btn-colar').addEventListener('click', () => abrirColar(exemplos));

    // Rodapé fixo. No celular vira uma linha só (total + quanto falta | Finalizar) com barra fina no topo.
    function pe() {
      const itens = DB.carrinho.itens();
      const qtd = itens.reduce((s, i) => s + i.qtd, 0), sub = DB.carrinho.subtotal(), pix = DB.carrinho.subtotalPix();
      const pct = pctMin(sub), ok = sub >= C.pedidoMinimo;
      const falta = ok ? (C.pedidoMinimo > 0 ? 'Pedido mínimo atingido' : `${qtd} ${qtd === 1 ? 'unidade' : 'unidades'}`) : `Faltam ${brl(C.pedidoMinimo - sub)}<span class="pe-det"> para o mínimo de ${brl(C.pedidoMinimo)}</span>`;
      $('#rapido-pe').innerHTML = `<div class="barra-min pe-barra${ok ? ' ok' : ''}" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <div class="rapido-pe-in">
        <div class="pe-esq"><div class="tot"><small class="pe-det">${qtd} ${qtd === 1 ? 'unidade' : 'unidades'} • ${itens.length} SKUs</small><strong>${brl(pix)}<span class="sr"> no Pix</span></strong><small class="pe-det">no Pix (${brl(sub)} no cartão)</small></div>
          <small class="pe-falta${ok ? ' ok' : ''}">${falta}</small></div>
        <div class="pe-dir"><button type="button" class="btn btn-p pe-revisar" data-abrir-carrinho>Revisar</button>
          <a class="btn btn-laranja" href="#/checkout" ${ok ? '' : 'aria-disabled="true" data-bloqueado'}>Finalizar<span class="pe-det"> pedido</span></a></div></div>`;
    }
    pg.onCarrinho = () => {
      pe();
      const itens = new Map(DB.carrinho.itens().map(i => [i.key, i]));
      $$('.rl[data-key]', corpo).forEach(row => {
        const it = itens.get(row.dataset.key);
        const inp = $('input', row);
        const q = it ? it.qtd : 0;
        row.classList.toggle('tem', !!q);
        if (document.activeElement !== inp) inp.value = q || '';
        $('small', $('.rl-qtd', row)).textContent = q ? brl(DB.precoPix(it.preco) * q) : '';
      });
    };
    // painel mudou preço/estoque/config: confirma o campo em edição e remonta mantendo busca, filtros e quantas linhas já estavam abertas
    pg.aoVivo = () => {
      const ativo = document.activeElement;
      const keyAtiva = ativo && ativo.matches && ativo.matches('.rl-qtd input') ? ativo.closest('.rl').dataset.key : null;
      if (keyAtiva) commit(ativo);
      montar(true); pe();
      if (keyAtiva) { const r = corpo.querySelector(`.rl[data-key="${CSS.escape(keyAtiva)}"] input:not([disabled])`); if (r) r.focus({ preventScroll: true }); }
    };
    pg.sair = () => { document.body.classList.remove('tem-pe'); if (obs) obs.disconnect(); };
    montar(); pe();
  }

  function abrirColar(exemplos) {
    const ex = exemplos.map((p, i) => `${p.sku} ${[12, 6, 24][i] || 10}`).join('\n');
    const f = abrirFolha(`${cabFolha('Colar lista de SKUs', 'Uma linha por produto: “SKU quantidade” ou “quantidade SKU”.')}
      <div class="folha-corpo"><label class="sr" for="colar-ta">Lista de SKUs e quantidades</label>
        <textarea class="colar-ta" id="colar-ta" placeholder="${esc(ex)}" spellcheck="false" autofocus></textarea>
        <p class="muted" style="font-size:13.5px;margin:8px 0 0">Aceita separação por espaço, vírgula, ponto e vírgula ou tabulação (dá para colar direto do Excel). Ex.: <span class="mono">${esc(exemplos[0] ? exemplos[0].sku : 'SKU')} 12</span> ou <span class="mono">12x ${esc(exemplos[0] ? exemplos[0].sku : 'SKU')}</span></p>
        <div class="colar-res" id="colar-res" aria-live="polite"></div></div>
      <div class="folha-pe"><div class="dir-flex" style="justify-content:flex-end"><button type="button" class="btn btn-fantasma" data-fechar-folha>Fechar</button><button type="button" class="btn btn-preto" id="colar-ok">Adicionar ao pedido</button></div></div>`, { classe: 'larga' });
    $('#colar-ok', f).addEventListener('click', () => {
      const txt = $('#colar-ta', f).value;
      const r = processarLista(txt);
      const res = $('#colar-res', f);
      res.innerHTML = `${r.ok.length ? `<p class="colar-ok">✓ ${r.ok.length} ${r.ok.length === 1 ? 'linha adicionada' : 'linhas adicionadas'} (${r.unid} unidades)</p>` : ''}
        ${r.esg.length ? `<p class="colar-erro" style="color:var(--laranja-forte)">${r.esg.length} esgotado${r.esg.length > 1 ? 's' : ''} (não adicionado${r.esg.length > 1 ? 's' : ''}):</p><ul>${r.esg.map(x => `<li><span class="mono">${esc(x)}</span></li>`).join('')}</ul>` : ''}
        ${r.semQtd.length ? `<p class="colar-erro" style="color:var(--laranja-forte)">${r.semQtd.length} ${r.semQtd.length === 1 ? 'linha sem quantidade entrou' : 'linhas sem quantidade entraram'} com 1 unidade. Confira no pedido:</p><ul>${r.semQtd.map(x => `<li><span class="mono">${esc(x)}</span></li>`).join('')}</ul>` : ''}
        ${r.nao.length ? `<p class="colar-erro">Não encontramos ${r.nao.length} ${r.nao.length === 1 ? 'linha' : 'linhas'}:</p><ul>${r.nao.map(x => `<li><span class="mono">${esc(x)}</span></li>`).join('')}</ul><p class="muted" style="font-size:13.5px">Confira o SKU ou mande essas linhas no WhatsApp.</p>` : ''}
        ${!r.ok.length && !r.nao.length && !r.esg.length ? '<p class="muted">Cole pelo menos uma linha.</p>' : ''}`;
      if (r.ok.length) { pulo(); $('#colar-ta', f).value = r.nao.join('\n'); }
    });
  }
  // Quantidade com separador de milhar (comum ao copiar do Excel): "1.000", "1,000", "2.500x" → 1000, 2500.
  // Só mexe em tokens que são número puro (separados por espaço, ; ou tab), para não quebrar SKU com ponto.
  const MILHAR = /(^|[\s;\t])(x?)(\d{1,3}(?:[.,]\d{3})+)(x?)(?=$|[\s;\t])/gi;
  function processarLista(txt) {
    const ok = [], nao = [], esg = [], semQtd = []; let unid = 0;
    txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(linha => {
      const lin = linha.replace(MILHAR, (_, a, x1, n, x2) => a + x1 + n.replace(/[.,]/g, '') + x2);
      const toks = lin.split(/[\s;,\t]+/).filter(Boolean);
      let achado = null, qtd = null;
      for (const t of toks) { const m = SKU.get(t.toUpperCase()); if (m && !achado) { achado = m; continue; } const n = t.replace(/^x|x$/i, ''); if (/^\d+$/.test(n) && qtd == null) qtd = parseInt(n, 10); }
      if (!achado) { // SKU com espaço? tenta a linha sem o número
        const semNum = lin.replace(/(^\d+\s*x?\s+)|(\s+x?\d+$)/i, '').trim().toUpperCase();
        if (SKU.get(semNum)) achado = SKU.get(semNum);
      }
      if (!achado) { nao.push(linha); return; }
      const { p, v } = achado;
      if (p.oculto) { nao.push(linha); return; }
      if (temVar(p) && !v) { nao.push(linha + '  (escolha a variação)'); return; }
      if (!p.disp || (v && !v.d)) { esg.push(linha); return; }
      if (!qtd) semQtd.push(linha);
      const q = Math.min(DB.QTD_MAX, Math.max(1, qtd || 1));
      DB.carrinho.add(itemDe(p, v), q); unid += q; ok.push(linha);
    });
    return { ok, nao, esg, semQtd, unid };
  }

  /* ======================================================================
     CHECKOUT
     ====================================================================== */
  const mascCNPJ = v => soDig(v).slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  const mascTel = v => { const d = soDig(v).slice(0, 11); if (!d) return ''; if (d.length <= 2) return '(' + d; if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`; if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`; return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`; };
  const mascCEP = v => soDig(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
  function cnpjValido(c) {
    c = soDig(c);
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    const dv = n => { let s = 0, pos = n - 7; for (let i = n; i >= 1; i--) { s += Number(c[n - i]) * pos--; if (pos < 2) pos = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
  }
  // null = falha de rede/timeout/HTTP (não conseguimos consultar); objeto = resposta da API
  async function buscaJSON(url, ms = 8000) {
    const ctl = 'AbortController' in window ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), ms);
    try { const r = await fetch(url, ctl ? { signal: ctl.signal } : {}); if (!r.ok) return null; return await r.json(); } catch { return null; } finally { clearTimeout(t); }
  }
  // Marca erro de campo de forma acessível (aria-invalid + aria-describedby apontando para a mensagem)
  let nErro = 0;
  function marcarCampo(el, txt) {
    const c = el.closest('.campo'); if (!c) return;
    c.classList.add('erro');
    el.setAttribute('aria-invalid', 'true');
    let msg = c.querySelector('.msg-erro');
    if (!msg) { msg = document.createElement('span'); msg.className = 'msg-erro'; msg.dataset.gerado = ''; c.appendChild(msg); }
    if (txt && msg.dataset.gerado != null) msg.textContent = txt;
    if (!msg.id) msg.id = 'erro-' + (++nErro);
    const ant = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== msg.id);
    el.dataset.descAntes = ant.join(' ');
    el.setAttribute('aria-describedby', [...ant, msg.id].join(' '));
  }
  function limparErros(raiz) {
    $$('.campo.erro', raiz).forEach(c => c.classList.remove('erro'));
    $$('.msg-erro[data-gerado]', raiz).forEach(m => m.remove());
    $$('[aria-invalid]', raiz).forEach(el => {
      el.removeAttribute('aria-invalid');
      if (el.dataset.descAntes != null) { if (el.dataset.descAntes) el.setAttribute('aria-describedby', el.dataset.descAntes); else el.removeAttribute('aria-describedby'); delete el.dataset.descAntes; }
    });
  }
  const buscaCNPJ = c => buscaJSON(`https://brasilapi.com.br/api/cnpj/v1/${soDig(c)}`);
  const buscaCEP = c => buscaJSON(`https://viacep.com.br/ws/${soDig(c)}/json/`);

  /* liga um campo de CNPJ: máscara, validação, BrasilAPI. cb(dados|null, cnpjDig) */
  function ligarCNPJ(input, msgEl, aoCompletar) {
    let ultimo = '';
    input.addEventListener('input', async () => {
      const pos = input.selectionStart, antes = input.value.length;
      input.value = mascCNPJ(input.value);
      if (document.activeElement === input && pos != null) { const d = input.value.length - antes; try { input.setSelectionRange(pos + d, pos + d); } catch { /* */ } }
      const d = soDig(input.value);
      const campo = input.closest('.campo');
      campo.classList.remove('erro'); msgEl.className = 'ajuda'; msgEl.textContent = '';
      input.removeAttribute('aria-invalid');
      if (d.length < 14) { ultimo = ''; return; }
      if (d === ultimo) return; ultimo = d;
      const conhecido = DB.lojistas.get(d);
      if (!cnpjValido(d) && !conhecido) { campo.classList.add('erro'); input.setAttribute('aria-invalid', 'true'); msgEl.className = 'msg-erro'; msgEl.textContent = 'CNPJ inválido. Confira os números.'; return; }
      msgEl.className = 'ajuda'; msgEl.innerHTML = '<span class="spin" style="width:14px;height:14px;border-width:2px;vertical-align:-2px"></span> Buscando dados na Receita…';
      const dados = conhecido && conhecido.exemplo ? null : await buscaCNPJ(d);
      if (soDig(input.value) !== d) return;
      if (dados && dados.razao_social) {
        const sit = dados.descricao_situacao_cadastral || '';
        msgEl.className = sit && sit.toUpperCase() !== 'ATIVA' ? 'msg-erro' : 'msg-ok';
        msgEl.textContent = `✓ ${dados.razao_social} — ${dados.municipio || ''}/${dados.uf || ''}${sit && sit.toUpperCase() !== 'ATIVA' ? ` (situação: ${sit})` : ''}`;
      } else if (conhecido) {
        msgEl.className = 'msg-ok'; msgEl.textContent = `✓ Cadastro encontrado: ${conhecido.razao || ''}`;
      } else {
        msgEl.className = 'ajuda'; msgEl.textContent = 'Não conseguimos consultar agora. Preencha os dados abaixo.';
      }
      aoCompletar(dados, d, conhecido);
    });
  }
  function ligarMascaras(raiz) {
    $$('[data-masc="tel"]', raiz).forEach(i => i.addEventListener('input', () => { i.value = mascTel(i.value); }));
    $$('[data-masc="cep"]', raiz).forEach(i => i.addEventListener('input', () => { i.value = mascCEP(i.value); }));
  }

  /* Confere o carrinho contra o catálogo atual (o painel pode mudar preço, esgotar ou ocultar).
     Corrige preços, tira o que ficou indisponível e grava. Devolve {precos:[nomes], fora:[nomes]}. */
  function revalidarCarrinho() {
    const res = { precos: [], fora: [] };
    if (!CAT) return res;
    const novos = [];
    DB.carrinho.itens().forEach(i => {
      const p = CAT.porId.get(String(i.pid));
      const v = p && temVar(p) ? p.v.find(x => String(x.id) === String(i.vid)) : null;
      const nome = i.nome + (i.variante ? ' — ' + i.variante : '');
      if (!p || p.oculto || !p.disp || (temVar(p) && (!v || !v.d))) { res.fora.push(nome); return; }
      const preco = v ? v.p : p.p;
      if (Number(preco) !== Number(i.preco)) { res.precos.push(nome); novos.push({ ...i, preco }); return; }
      novos.push(i);
    });
    if (res.fora.length || res.precos.length) DB.carrinho.substituir(novos);
    return res;
  }
  function avisarRevalidacao(r, extra = '') {
    if (!r.fora.length && !r.precos.length) return;
    const partes = [];
    if (r.fora.length) partes.push(r.fora.length === 1 ? `${r.fora[0]} ficou indisponível e saiu do pedido` : `${r.fora.length} itens ficaram indisponíveis e saíram do pedido`);
    if (r.precos.length) partes.push(r.precos.length === 1 ? `preço de ${r.precos[0]} atualizado` : `${r.precos.length} preços atualizados`);
    toast({ titulo: r.fora.length ? 'Seu pedido mudou' : 'Preço atualizado', texto: partes.join(' • ') + extra, tipo: r.fora.length ? 'erro' : '', acao: { rotulo: 'Ver pedido', fn: abrirGaveta } });
  }

  function rotaCheckout() {
    document.title = 'Finalizar pedido • Street Distribuidora';
    const itens = DB.carrinho.itens();
    if (!itens.length) {
      app.innerHTML = vazioHTML('Seu pedido está vazio', 'Adicione produtos para finalizar.', '<a class="btn btn-preto" href="#/colecao/mais-pedidos">Ver mais pedidos</a><a class="btn" href="#/rapido">Pedido rápido</a>');
      return;
    }
    const lj = DB.lojistas.atual();
    const rasc = DB.ls.get('checkout', {}) || {};
    const v0 = k => esc((lj && lj[k]) || rasc[k] || '');
    const entregaSel = rasc.entrega && C.entrega.some(e => e.id === rasc.entrega) ? rasc.entrega : C.entrega[0].id;
    app.innerHTML = `
      <div class="cat-cab"><div class="wrap"><nav class="migalha" aria-label="Você está em"><a href="#/">Início</a><span aria-hidden="true">/</span><button type="button" class="link" style="color:inherit;text-decoration:none;font-weight:600" data-abrir-carrinho>Pedido</button><span aria-hidden="true">/</span><span aria-current="page">Finalizar</span></nav>
        <h1 class="disp incl">Finalizar pedido</h1><div class="contagem">Venda exclusiva para lojistas com CNPJ</div></div></div>
      <form class="wrap checkout" id="form-ck" novalidate>
        <div style="min-width:0">
          <section class="etapa" aria-labelledby="e1"><div class="etapa-tit"><b>1</b><h2 id="e1">Sua loja</h2></div>
            ${lj ? `<div class="aviso verde" style="margin-bottom:14px"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg><div>Comprando como <b>${esc(lj.razao || lj.cnpj)}</b>. <a class="link" href="#/conta">Trocar</a></div></div>` : ''}
            <div class="form-grade d2">
              <div class="campo campo-cnpj col2"><label for="ck-cnpj">CNPJ da loja</label><input id="ck-cnpj" name="cnpj" inputmode="numeric" autocomplete="off" placeholder="00.000.000/0000-00" value="${esc(mascCNPJ((lj && lj.cnpj) || rasc.cnpj || ''))}" required aria-describedby="ck-cnpj-msg"><span class="ajuda" id="ck-cnpj-msg">Preenchemos razão social e cidade automaticamente.</span></div>
              <div class="campo col2"><label for="ck-razao">Razão social ou nome da loja</label><input id="ck-razao" name="razao" autocomplete="organization" value="${v0('razao')}" required></div>
              <div class="campo"><label for="ck-nome">Seu nome</label><input id="ck-nome" name="nome" autocomplete="name" value="${v0('nome')}" required></div>
              <div class="campo"><label for="ck-zap">WhatsApp</label><input id="ck-zap" name="whatsapp" data-masc="tel" inputmode="tel" autocomplete="tel-national" placeholder="(71) 99999-9999" value="${esc(mascTel((lj && lj.whatsapp) || rasc.whatsapp || ''))}" required></div>
              <div class="campo"><label for="ck-email">E-mail <small>(opcional)</small></label><input id="ck-email" name="email" type="email" autocomplete="email" value="${v0('email')}"></div>
              <div class="campo" style="display:grid;grid-template-columns:minmax(0,1fr) 80px;gap:8px"><div class="campo"><label for="ck-cidade">Cidade</label><input id="ck-cidade" name="cidade" autocomplete="address-level2" value="${v0('cidade')}"></div><div class="campo"><label for="ck-uf">UF</label><input id="ck-uf" name="uf" maxlength="2" autocomplete="address-level1" style="text-transform:uppercase" value="${v0('uf')}"></div></div>
            </div>
          </section>

          <section class="etapa" aria-labelledby="e2"><div class="etapa-tit"><b>2</b><h2 id="e2">Entrega</h2></div>
            <div class="opcoes" role="radiogroup" aria-labelledby="e2">${C.entrega.map(e => `<label class="opcao"><input type="radio" name="entrega" value="${esc(e.id)}"${e.id === entregaSel ? ' checked' : ''}>
              <div style="min-width:0"><div class="opcao-nome">${esc(e.nome)}</div><div class="opcao-det">${esc(e.detalhe || '')}${e.prazo ? `<br><b>${esc(e.prazo)}</b>` : ''}</div></div>
              <div class="opcao-val">${e.valor == null ? 'A combinar' : e.valor === 0 ? 'Grátis' : brl(e.valor)}</div></label>`).join('')}</div>
            <div id="end-box" class="form-grade d2" style="margin-top:14px">
              <div class="campo"><label for="ck-cep">CEP</label><input id="ck-cep" name="cep" data-masc="cep" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" value="${esc(rasc.cep || '')}" aria-describedby="ck-cep-msg"><span class="ajuda" id="ck-cep-msg" aria-live="polite"></span></div>
              <div class="campo"><label for="ck-num">Número</label><input id="ck-num" name="numero" autocomplete="address-line2" value="${esc(rasc.numero || '')}"></div>
              <div class="campo col2"><label for="ck-rua">Endereço</label><input id="ck-rua" name="logradouro" autocomplete="address-line1" value="${esc(rasc.logradouro || '')}"></div>
              <div class="campo"><label for="ck-bairro">Bairro</label><input id="ck-bairro" name="bairro" value="${esc(rasc.bairro || '')}"></div>
              <div class="campo"><label for="ck-comp">Complemento <small>(opcional)</small></label><input id="ck-comp" name="complemento" value="${esc(rasc.complemento || '')}"></div>
            </div>
          </section>

          <section class="etapa" aria-labelledby="e3"><div class="etapa-tit"><b>3</b><h2 id="e3">Pagamento</h2></div>
            <div class="opcoes" role="radiogroup" aria-labelledby="e3" id="pag-box"></div>
          </section>

          <section class="etapa" aria-labelledby="e4"><div class="etapa-tit"><b>4</b><h2 id="e4">Observações</h2></div>
            <div class="campo"><label for="ck-obs">Algo que a Street precisa saber? <small>(opcional)</small></label><textarea id="ck-obs" name="obs" placeholder="Ex.: pode substituir cores esgotadas por similares; entregar após 14h.">${esc(rasc.obs || '')}</textarea></div>
          </section>
        </div>
        <aside class="resumo" id="resumo" aria-label="Resumo do pedido"></aside>
      </form>`;

    const form = $('#form-ck');
    let enviando = false;
    let cepLocal = rasc.cepCidade ? { cidade: rasc.cepCidade, uf: rasc.cepUf } : null;
    ligarMascaras(form);
    const metodo = () => (form.querySelector('[name=pagamento]:checked') || {}).value || 'pix';
    const entrega = () => C.entrega.find(e => e.id === (form.querySelector('[name=entrega]:checked') || {}).value) || C.entrega[0];
    const lojistaDoCNPJ = () => { const d = soDig($('#ck-cnpj').value); return d.length === 14 ? DB.lojistas.get(d) : null; };
    // Boleto a prazo: só cadastro aprovado E com o boleto liberado no painel (chave "Liberar boleto a prazo")
    const boletoLiberado = l => !!(l && l.status === 'aprovado' && l.boleto);

    function renderPag() {
      const sel = metodo();
      const l = lojistaDoCNPJ();
      const liberado = boletoLiberado(l);
      const sub = DB.carrinho.subtotal(), pix = DB.carrinho.subtotalPix();
      const motivo = !l ? 'Disponível para lojistas com cadastro aprovado.' : l.status === 'recusado' ? 'Cadastro não aprovado. Fale com a Street no WhatsApp.'
        : l.status !== 'aprovado' ? 'Seu cadastro ainda está em análise.' : 'Ainda não liberado para a sua loja. Peça à Street no WhatsApp.';
      $('#pag-box').innerHTML = C.pagamentos.map(pg2 => {
        const des = pg2.id === 'boleto' && !liberado;
        const val = pg2.id === 'pix' ? pix : sub;
        const chk = (sel === pg2.id && !des) || (pg2.id === 'pix' && (sel === 'boleto' && des));
        return `<label class="opcao${des ? ' desab' : ''}"><input type="radio" name="pagamento" value="${pg2.id}"${chk ? ' checked' : ''}${des ? ' disabled' : ''}>
          <div style="min-width:0"><div class="opcao-nome">${esc(pg2.nome)}${pg2.id === 'pix' ? '<span class="tag-verde">Melhor preço</span>' : ''}</div>
          <div class="opcao-det">${esc(pg2.detalhe || '')}${des ? `<br><b>${motivo}</b> <a class="link" href="#/conta">Saiba mais</a>` : ''}</div></div>
          <div class="opcao-val">${brl(val)}${pg2.id === 'pix' ? `<small>economia de ${brl(sub - pix)}</small>` : ''}</div></label>`;
      }).join('');
      if (!form.querySelector('[name=pagamento]:checked')) form.querySelector('[name=pagamento][value=pix]').checked = true;
    }
    function renderEnd() {
      const e = entrega();
      const precisa = e.id !== 'retirada';
      $('#end-box').hidden = !precisa;
      $$('#end-box input').forEach(i => { i.required = precisa && ['cep', 'logradouro', 'numero', 'bairro'].includes(i.name); });
    }
    function renderResumo() {
      const its = DB.carrinho.itens();
      const m = metodo(), e = entrega();
      const sub = m === 'pix' ? DB.carrinho.subtotalPix() : DB.carrinho.subtotal();
      const tot = sub + (e.valor || 0);
      const ok = DB.carrinho.subtotal() >= C.pedidoMinimo;
      $('#resumo').innerHTML = `<h2>Resumo <small>${DB.carrinho.qtdTotal()} unid. • ${its.length} SKUs</small></h2>
        <div class="resumo-itens">${its.map(i => `<div class="ri">${i.img ? `<img src="${esc(imgW(i.img, 100))}" alt="" loading="lazy" width="44" height="44">` : '<span></span>'}<div style="min-width:0"><div class="ri-nome">${esc(i.nome)}</div><small>${i.qtd} × ${brl(m === 'pix' ? DB.precoPix(i.preco) : i.preco)}${i.variante ? ' • ' + esc(i.variante) : ''}</small></div><span class="ri-val">${brl((m === 'pix' ? DB.precoPix(i.preco) : i.preco) * i.qtd)}</span></div>`).join('')}</div>
        <button type="button" class="link" data-abrir-carrinho style="font-size:14px;margin-bottom:12px">Editar itens</button>
        ${progressoHTML()}
        <div class="linhas">
          <div><span>Subtotal (${m === 'pix' ? 'Pix' : m === 'cartao' ? 'cartão' : 'boleto'})</span><span>${brl(sub)}</span></div>
          <div><span>Entrega</span><span>${e.valor == null ? 'A combinar' : e.valor === 0 ? 'Grátis' : brl(e.valor)}</span></div>
          ${m === 'pix' ? `<div class="eco"><span>Você economiza no Pix</span><span>${brl(DB.carrinho.subtotal() - DB.carrinho.subtotalPix())}</span></div>` : ''}
          <div class="total"><span>Total</span><span>${brl(tot)}</span></div>
          ${e.valor == null ? '<div style="font-size:13px;color:var(--cinza-5)"><span>Frete informado pelo WhatsApp antes do envio.</span></div>' : ''}
        </div>
        <button type="submit" class="btn btn-verde btn-g btn-bloco" style="margin-top:14px"${ok ? '' : ' disabled'}>${m === 'pix' ? 'Enviar pedido e gerar Pix' : 'Enviar pedido'}</button>
        <p class="muted" style="font-size:13.5px;margin:10px 0 0;line-height:1.4">Ao enviar, você confirma que compra para revenda e tem 18 anos ou mais. ${ok ? '' : `<b style="color:var(--erro)">Pedido mínimo: ${brl(C.pedidoMinimo)}.</b>`}</p>`;
    }
    function salvarRasc() {
      const fd = Object.fromEntries(new FormData(form).entries());
      DB.ls.set('checkout', { ...fd, cnpj: soDig(fd.cnpj), whatsapp: soDig(fd.whatsapp), cepCidade: cepLocal ? cepLocal.cidade : '', cepUf: cepLocal ? cepLocal.uf : '' });
    }
    form.addEventListener('change', e => {
      if (e.target.name === 'pagamento' || e.target.name === 'entrega') { if (e.target.name === 'entrega') renderEnd(); renderResumo(); }
      salvarRasc();
    });
    form.addEventListener('input', debounce(salvarRasc, 400));

    ligarCNPJ($('#ck-cnpj'), $('#ck-cnpj-msg'), (dados, d, conhecido) => {
      const set = (id, v) => { const el = $(id); if (v && el) el.value = v; };
      if (dados) {
        set('#ck-razao', dados.nome_fantasia ? `${dados.razao_social} (${dados.nome_fantasia})` : dados.razao_social);
        set('#ck-cidade', dados.municipio ? dados.municipio.replace(/\b\w+/g, w => w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase()) : '');
        set('#ck-uf', dados.uf);
        if (!$('#ck-email').value && dados.email) $('#ck-email').value = String(dados.email).toLowerCase();
      }
      if (conhecido) {
        set('#ck-razao', $('#ck-razao').value || conhecido.razao); if (!$('#ck-nome').value) set('#ck-nome', conhecido.nome);
        if (!$('#ck-zap').value) set('#ck-zap', mascTel(conhecido.whatsapp)); set('#ck-cidade', $('#ck-cidade').value || conhecido.cidade); set('#ck-uf', $('#ck-uf').value || conhecido.uf);
      }
      renderPag(); renderResumo(); salvarRasc();
    });
    // CNPJ mudou (mesmo incompleto ou durante a consulta): a elegibilidade do boleto é recalculada na hora
    let cnpjPag = soDig($('#ck-cnpj').value);
    $('#ck-cnpj').addEventListener('input', () => { const d = soDig($('#ck-cnpj').value); if (d !== cnpjPag) { cnpjPag = d; renderPag(); renderResumo(); } });
    $('#ck-cep').addEventListener('input', async () => {
      const d = soDig($('#ck-cep').value), msg = $('#ck-cep-msg');
      if (d.length !== 8) { msg.textContent = ''; return; }
      msg.className = 'ajuda'; msg.textContent = 'Buscando endereço…';
      const r = await buscaCEP(d);
      if (soDig($('#ck-cep').value) !== d) return;
      if (r && !r.erro) {
        if (r.logradouro) $('#ck-rua').value = r.logradouro;
        if (r.bairro) $('#ck-bairro').value = r.bairro;
        if (r.localidade && !$('#ck-cidade').value) $('#ck-cidade').value = r.localidade;
        if (r.uf && !$('#ck-uf').value) $('#ck-uf').value = r.uf;
        cepLocal = { cidade: r.localidade, uf: r.uf };
        msg.className = 'msg-ok'; msg.textContent = `✓ ${r.localidade}/${r.uf}`;
        $('#ck-num').focus();
      } else if (r === null) { msg.className = 'ajuda'; msg.textContent = 'Não conseguimos consultar o CEP agora. Preencha o endereço.'; }
      else { msg.className = 'msg-erro'; msg.textContent = 'CEP não encontrado. Confira o número ou preencha o endereço.'; }
      salvarRasc();
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      if (enviando) return;
      limparErros(form);
      // preço/estoque podem ter mudado no painel desde que o item entrou no pedido
      const rv = revalidarCarrinho();
      if (rv.fora.length || rv.precos.length) {
        avisarRevalidacao(rv, '. Confira o resumo e envie de novo.');
        if (!DB.carrinho.itens().length) return;
        renderPag(); renderResumo(); $('#resumo').scrollIntoView({ block: 'start', behavior: reduzMov ? 'auto' : 'smooth' }); return;
      }
      const erros = [];
      const marcaErro = (id, txt) => { const el = $(id); marcarCampo(el, txt); erros.push(el); };
      const cnpj = soDig($('#ck-cnpj').value);
      if (!(cnpjValido(cnpj) || DB.lojistas.get(cnpj))) marcaErro('#ck-cnpj', 'Informe um CNPJ válido.');
      if (!$('#ck-razao').value.trim()) marcaErro('#ck-razao', 'Informe a razão social ou o nome da loja.');
      if (!$('#ck-nome').value.trim()) marcaErro('#ck-nome', 'Informe seu nome.');
      if (soDig($('#ck-zap').value).length < 10) marcaErro('#ck-zap', 'Informe o WhatsApp com DDD.');
      const ent = entrega();
      if (ent.id !== 'retirada') {
        if (soDig($('#ck-cep').value).length !== 8) marcaErro('#ck-cep', 'Informe o CEP.');
        if (!$('#ck-rua').value.trim()) marcaErro('#ck-rua', 'Informe o endereço.');
        if (!$('#ck-num').value.trim()) marcaErro('#ck-num', 'Informe o número.');
        if (!$('#ck-bairro').value.trim()) marcaErro('#ck-bairro', 'Informe o bairro.');
      }
      if (DB.carrinho.subtotal() < C.pedidoMinimo) { toast({ titulo: 'Pedido mínimo não atingido', texto: `Mínimo de ${brl(C.pedidoMinimo)}`, tipo: 'erro' }); renderResumo(); return; }
      if (erros.length) { erros[0].focus(); erros[0].scrollIntoView({ block: 'center', behavior: reduzMov ? 'auto' : 'smooth' }); toast({ titulo: erros.length === 1 ? 'Confira o campo destacado' : `Confira os ${erros.length} campos destacados`, texto: erros[0].closest('.campo').querySelector('.msg-erro') ? erros[0].closest('.campo').querySelector('.msg-erro').textContent : '', tipo: 'erro' }); return; }

      const cad = DB.lojistas.get(cnpj);
      if (cad && cad.status === 'recusado') {
        toast({ titulo: 'Cadastro não aprovado', texto: 'Esta loja não pode comprar pelo site. Fale com a Street.', tipo: 'erro', acao: { rotulo: 'WhatsApp', fn: () => window.open(wa(`Olá, Street! O cadastro da loja ${mascCNPJ(cnpj)} não foi aprovado. Podem me ajudar?`), '_blank', 'noopener') } });
        return;
      }
      const m = metodo();
      if (m === 'boleto' && !boletoLiberado(cad)) { renderPag(); renderResumo(); toast({ titulo: 'Boleto a prazo indisponível para este CNPJ', texto: 'Escolha Pix ou cartão', tipo: 'erro' }); $('#pag-box').scrollIntoView({ block: 'center', behavior: reduzMov ? 'auto' : 'smooth' }); return; }
      const its = DB.carrinho.itens();
      const subtotal = m === 'pix' ? DB.carrinho.subtotalPix() : DB.carrinho.subtotal();
      const total = DB.r2(subtotal + (ent.valor || 0));
      // preço unitário efetivamente cobrado fica congelado no pedido (mudar o acréscimo depois não altera pedidos antigos)
      const itensPed = its.map(i => ({ ...i, precoPago: m === 'pix' ? DB.precoPix(i.preco) : DB.precoCartao(i.preco) }));
      let copiaECola = '';
      if (m === 'pix') {
        try { copiaECola = window.StreetPix.brcode({ chave: C.pix.chave, nome: C.pix.nome, cidade: C.pix.cidade, valor: total, txid: 'X' }); }
        catch (err) { console.error(err); toast({ titulo: 'Pix indisponível no momento', texto: 'A chave Pix da loja precisa ser revista. Escolha cartão ou fale no WhatsApp.', tipo: 'erro', acao: { rotulo: 'WhatsApp', fn: () => window.open(wa('Olá, Street! Quero fazer um pedido pelo site, mas o Pix não abriu.'), '_blank', 'noopener') } }); return; }
      }
      const lojista = {
        cnpj: mascCNPJ(cnpj), razao: $('#ck-razao').value.trim(), nome: $('#ck-nome').value.trim(), whatsapp: soDig($('#ck-zap').value),
        email: $('#ck-email').value.trim(), cidade: $('#ck-cidade').value.trim(), uf: $('#ck-uf').value.trim().toUpperCase(),
      };
      const endereco = ent.id === 'retirada' ? null : {
        cep: mascCEP($('#ck-cep').value), logradouro: $('#ck-rua').value.trim(), numero: $('#ck-num').value.trim(), complemento: $('#ck-comp').value.trim(),
        bairro: $('#ck-bairro').value.trim(), cidade: (cepLocal && cepLocal.cidade) || lojista.cidade, uf: (cepLocal && cepLocal.uf) || lojista.uf,
      };
      let ped;
      try {
        ped = DB.pedidos.criar({
          lojista, entrega: { tipo: ent.id, nome: ent.nome, prazo: ent.prazo || '', endereco, valor: ent.valor },
          pagamento: { metodo: m }, itens: itensPed, subtotal: DB.r2(subtotal), total, acrescimo: C.acrescimoCartao, obs: $('#ck-obs').value.trim(),
        });
        const txid = ped.id.replace(/[^A-Za-z0-9]/g, '');
        if (m === 'pix') {
          copiaECola = window.StreetPix.brcode({ chave: C.pix.chave, nome: C.pix.nome, cidade: C.pix.cidade, valor: total, txid });
          DB.pedidos.atualizar(ped.id, { pagamento: { metodo: 'pix', txid, copiaECola, geradoEm: new Date().toISOString() } });
        } else {
          DB.pedidos.atualizar(ped.id, { pagamento: { metodo: m, txid } });
        }
        if (!DB.pedidos.get(ped.id)) throw new Error('pedido não gravado');
      } catch (err) {
        // não conseguiu gravar (armazenamento cheio/bloqueado): o carrinho fica intacto e o pedido segue pelo WhatsApp
        console.error(err);
        const resumo = its.slice(0, 25).map(i => `• ${i.qtd}x ${i.nome}${i.variante ? ' — ' + i.variante : ''}${i.sku ? ' (' + i.sku + ')' : ''}`).join('\n');
        toast({ titulo: 'Não conseguimos salvar o pedido neste navegador', texto: 'Seu pedido continua aqui. Envie pelo WhatsApp.', tipo: 'erro',
          acao: { rotulo: 'WhatsApp', fn: () => window.open(wa(`Olá, Street! Quero fazer este pedido (${brl(total)} no ${nomeMetodo(m)}):\nLoja: ${lojista.razao} • CNPJ ${lojista.cnpj}\n\n${resumo}`), '_blank', 'noopener') } });
        return;
      }
      enviando = true;
      DB.lojistas.salvar(lojista);
      DB.lojistas.entrar(cnpj);
      DB.carrinho.limpar();
      DB.ls.set('checkout', { entrega: ent.id, cep: endereco ? endereco.cep : '', logradouro: endereco ? endereco.logradouro : '', numero: endereco ? endereco.numero : '', bairro: endereco ? endereco.bairro : '', complemento: endereco ? endereco.complemento : '', cepCidade: endereco ? endereco.cidade : '', cepUf: endereco ? endereco.uf : '' });
      DB.ls.set('recemCriado', ped.id);
      location.hash = '#/pedido/' + enc(ped.id);
    });

    renderEnd(); renderPag(); renderResumo();
    pg.onCarrinho = () => { if (enviando) return; if (!DB.carrinho.itens().length) { rotear(true); return; } renderPag(); renderResumo(); };
    pg.onLojistas = () => { if (!enviando) { renderPag(); renderResumo(); } };
    pg.aoVivo = () => { if (!enviando) { renderPag(); renderResumo(); } };   // painel mudou config/preços: sem perder o formulário
  }

  /* ======================================================================
     PÁGINA DO PEDIDO (Pix, linha do tempo, confirmação ao vivo)
     ====================================================================== */
  const FLUXO = ['aguardando_pagamento', 'pago', 'separando', 'enviado', 'entregue'];
  const fmtData = iso => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const nomeMetodo = m => ({ pix: 'Pix', cartao: 'Cartão de crédito', boleto: 'Boleto a prazo' }[m] || m);
  // status com contraste AA: classes .st-<status> no CSS (texto preto no laranja, verde escuro no pago)
  const stClasse = s => 'st-' + (DB.STATUS[s] ? s : 'outro');
  // preço unitário do item: o congelado no pedido (precoPago) ou, em pedidos antigos, o calculado agora
  const precoItem = (i, m) => (i.precoPago != null ? Number(i.precoPago) : m === 'pix' ? DB.precoPix(i.preco) : DB.precoCartao(i.preco));
  // qrcode-generator só carrega quando um QR Pix vai aparecer (não trava a loja se o CDN estiver lento)
  let qrLib = null;
  const carregarQR = () => qrLib || (qrLib = new Promise((ok, falha) => {
    if (typeof window.qrcode === 'function') { ok(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => { qrLib = null; falha(new Error('qrcode-generator não carregou')); };
    document.head.appendChild(s);
  }));
  function resumoZap(p, titulo) {
    const linhas = p.itens.slice(0, 25).map(i => `• ${i.qtd}x ${i.nome}${i.variante ? ' — ' + i.variante : ''}${i.sku ? ' (' + i.sku + ')' : ''}`);
    if (p.itens.length > 25) linhas.push(`• … e mais ${p.itens.length - 25} itens`);
    return `${titulo}\n\nPedido ${p.id} • ${brl(p.total)} (${nomeMetodo(p.pagamento.metodo)})\nLoja: ${p.lojista.razao} • CNPJ ${p.lojista.cnpj}\nEntrega: ${p.entrega.nome}\n\n${linhas.join('\n')}`;
  }

  function rotaPedido(id) {
    let ped = DB.pedidos.get(id);
    if (!ped) { app.innerHTML = vazioHTML('Pedido não encontrado', 'Neste modo de demonstração os pedidos ficam salvos só neste aparelho.', '<a class="btn btn-preto" href="#/conta">Meus pedidos</a>'); return; }
    let timer = null;
    let statusVisto = ped.status;
    const recem = DB.ls.get('recemCriado', null) === id;
    if (recem) DB.ls.set('recemCriado', null);

    function render(celebrar = false) {
      ped = DB.pedidos.get(id);
      document.title = `${ped.status === 'aguardando_pagamento' ? 'Aguardando pagamento' : DB.STATUS[ped.status] ? DB.STATUS[ped.status].nome : ''} • ${ped.id}`;
      const S = DB.STATUS[ped.status] || { nome: ped.status, cor: '#111' };
      const idx = FLUXO.indexOf(ped.status);
      const hist = Object.fromEntries((ped.historico || []).map(h => [h.status, h.em]));
      const m = ped.pagamento && ped.pagamento.metodo;
      const nomes = { aguardando_pagamento: m === 'pix' ? 'Aguardando Pix' : 'Pedido recebido', pago: 'Pago', separando: 'Em separação', enviado: 'Enviado', entregue: 'Entregue' };
      let principal = '';
      if (ped.status === 'cancelado') {
        principal = `<div class="aviso erro"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg><div><b>Pedido cancelado.</b> Se foi engano, fale com a Street no WhatsApp.</div></div>`;
      } else if (ped.status === 'aguardando_pagamento' && m === 'pix') {
        const pag = ped.pagamento || {};
        let cc = pag.copiaECola || '';
        if (!cc) { try { cc = window.StreetPix.brcode({ chave: C.pix.chave, nome: C.pix.nome, cidade: C.pix.cidade, valor: ped.total, txid: ped.id }); } catch (err) { console.error(err); } }
        const qrPronto = typeof window.qrcode === 'function';
        principal = !cc ? `<div class="aviso erro anim-entra"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16v.5"/></svg><div><b>Não foi possível gerar o Pix deste pedido.</b> Fale com a Street no WhatsApp para receber a chave. <a class="link" target="_blank" rel="noopener" href="${wa(resumoZap(ped, 'Olá, Street! Quero pagar este pedido no Pix.'))}">Abrir WhatsApp</a></div></div>` : `<div class="pix-caixa anim-entra">
          ${C.pix.demonstracao ? `<div class="pix-demo" role="note"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/></svg><span>Pedido de demonstração — não pague.</span></div>` : ''}
          <div class="pix-grade">
            <div class="pix-qr" id="pix-qr">${qrPronto ? window.StreetPix.qrSvg(cc, 240) : '<div class="pix-qr-carregando" role="img" aria-label="Gerando QR Code"><span class="spin" aria-hidden="true"></span></div>'}</div>
            <div style="min-width:0">
              <div class="kicker" style="color:var(--verde-txt)">Pague com Pix</div>
              <div class="pix-valor">${brl(ped.total)}</div>
              <div class="pix-tempo" style="margin-top:10px" id="pix-tempo"></div>
              <div class="pix-cc"><label class="sr" for="pix-cc-txt">Pix copia e cola</label><textarea id="pix-cc-txt" readonly>${esc(cc)}</textarea>
                <button type="button" class="btn btn-verde" id="btn-copiar"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>Copiar código Pix</button></div>
            </div>
          </div>
          <ol class="pix-passos"><li>Abra o app do seu banco e escolha <b>Pix &gt; Ler QR Code</b> ou <b>Pix copia e cola</b>.</li><li>Confira o recebedor: <b>${esc(C.pix.nome)}</b>.</li><li>Pague e envie o comprovante no WhatsApp. Esta tela muda sozinha quando o pagamento for confirmado.</li></ol>
          <div class="dir-flex" style="margin-top:14px"><a class="btn btn-preto" target="_blank" rel="noopener" href="${wa(resumoZap(ped, 'Olá, Street! Segue o comprovante do Pix do meu pedido.'))}">Enviar comprovante no WhatsApp</a></div>
          ${C.pix.demonstracao ? `<p class="muted" style="font-size:13px;margin:14px 0 0">Demonstração: abra o <a class="link" href="admin.html" target="_blank" rel="noopener">painel da Street</a> em outra aba e marque este pedido como pago para ver a confirmação chegar aqui ao vivo.</p>` : ''}
        </div>`;
      } else if (ped.status === 'aguardando_pagamento') {
        principal = `<div class="cartao-caixa anim-entra"><h2>${m === 'boleto' ? 'Boleto a caminho' : 'Link de pagamento a caminho'}</h2>
          <p>${m === 'boleto' ? 'Você vai receber o boleto no WhatsApp' : 'Você vai receber o link de pagamento no WhatsApp'} <b>${esc(mascTel(ped.lojista.whatsapp))}</b>. ${m === 'cartao' ? `O valor no cartão já inclui ${Math.round(C.acrescimoCartao * 100)}%.` : ''}</p>
          <p class="muted" style="font-size:14px">Horário de atendimento: ${esc(C.horario)}.</p>
          <a class="btn btn-verde" target="_blank" rel="noopener" href="${wa(resumoZap(ped, `Olá, Street! Acabei de fazer um pedido e quero pagar no ${m === 'boleto' ? 'boleto' : 'cartão'}.`))}">Chamar no WhatsApp agora</a></div>`;
      } else {
        principal = `<div class="pago-caixa${celebrar ? ' anim-entra' : ''}" id="pago-caixa">
          <svg class="check-anim" viewBox="0 0 92 92" aria-hidden="true"><circle cx="46" cy="46" r="44"/><path d="M27 47l13 13 25-27"/></svg>
          <h2>${ped.status === 'pago' ? 'Pagamento confirmado' : esc(S.nome)}</h2>
          <p>${ped.status === 'pago' ? 'Recebemos o seu pagamento. Agora é com a gente: o pedido vai para a separação.' : ped.status === 'separando' ? 'Seu pedido está sendo separado no galpão.' : ped.status === 'enviado' ? 'Seu pedido saiu para entrega.' : 'Pedido entregue. Obrigado pela parceria!'}</p></div>`;
      }

      app.innerHTML = `<div class="wrap ped">
        <div style="min-width:0">
          <div class="ped-cab"><div><div class="kicker">${recem && ped.status === 'aguardando_pagamento' ? 'Pedido enviado com sucesso' : 'Pedido'}</div><h1 class="disp incl">${esc(ped.id)}</h1><div class="muted" style="font-size:14px;margin-top:6px">Feito em ${fmtData(ped.criadoEm)} • ${ped.itens.length} SKUs • ${ped.itens.reduce((s, i) => s + i.qtd, 0)} unidades</div></div>
            <span class="status-pill ${stClasse(ped.status)}">${esc(ped.status === 'aguardando_pagamento' ? nomes.aguardando_pagamento : S.nome)}</span></div>
          ${ped.status !== 'cancelado' ? `<ol class="linha-tempo" aria-label="Andamento do pedido">${FLUXO.map((s, i) => `<li class="lt${i <= idx ? ' feito' : ''}${i === idx ? ' atual' : ''}"${i === idx ? ' aria-current="step"' : ''}><i aria-hidden="true">${i < idx || (i === idx && i > 0) ? '✓' : i + 1}</i>${nomes[s]}${hist[s] ? `<small>${fmtData(hist[s])}</small>` : ''}</li>`).join('')}</ol>` : ''}
          ${principal}
          <div class="ped-itens"><h2>Itens</h2>${ped.itens.map(i => { const pu = precoItem(i, m); return `<div class="ri">${i.img ? `<img src="${esc(imgW(i.img, 100))}" alt="" loading="lazy" width="44" height="44">` : '<span></span>'}<div style="min-width:0"><div class="ri-nome">${esc(i.nome)}</div><small>${i.qtd} × ${brl(pu)}${i.variante ? ' • ' + esc(i.variante) : ''}${i.sku ? ' • ' + esc(i.sku) : ''}</small></div><span class="ri-val">${brl(pu * i.qtd)}</span></div>`; }).join('')}
            <div class="linhas" style="margin-top:12px"><div><span>Subtotal (${nomeMetodo(m)})</span><span>${brl(ped.subtotal)}</span></div><div><span>Entrega</span><span>${ped.entrega.valor == null ? 'A combinar' : ped.entrega.valor === 0 ? 'Grátis' : brl(ped.entrega.valor)}</span></div><div class="total"><span>Total</span><span>${brl(ped.total)}</span></div></div></div>
        </div>
        <aside class="ped-lado">
          <div class="bloco"><h3>Loja</h3><p><b>${esc(ped.lojista.razao)}</b></p><p>CNPJ ${esc(ped.lojista.cnpj)}</p><p>${esc(ped.lojista.nome)} • ${esc(mascTel(ped.lojista.whatsapp))}</p>${ped.lojista.cidade ? `<p>${esc(ped.lojista.cidade)}${ped.lojista.uf ? '/' + esc(ped.lojista.uf) : ''}</p>` : ''}</div>
          <div class="bloco"><h3>Entrega</h3><p><b>${esc(ped.entrega.nome)}</b></p>${ped.entrega.prazo ? `<p>${esc(ped.entrega.prazo)}</p>` : ''}${ped.entrega.endereco ? `<p>${esc([ped.entrega.endereco.logradouro, ped.entrega.endereco.numero].filter(Boolean).join(', '))}${ped.entrega.endereco.complemento ? ' — ' + esc(ped.entrega.endereco.complemento) : ''}</p><p>${esc([ped.entrega.endereco.bairro, ped.entrega.endereco.cidade && ped.entrega.endereco.cidade + (ped.entrega.endereco.uf ? '/' + ped.entrega.endereco.uf : ''), ped.entrega.endereco.cep].filter(Boolean).join(' • '))}</p>` : `<p>${esc(C.endereco)}</p>`}</div>
          <div class="bloco"><h3>Pagamento</h3><p><b>${nomeMetodo(m)}</b></p>${ped.obs ? `<h3 style="margin-top:12px">Observações</h3><p>${esc(ped.obs)}</p>` : ''}</div>
          <div style="display:grid;gap:8px"><button type="button" class="btn" data-repetir="${esc(ped.id)}">Repetir este pedido</button><a class="btn btn-fantasma" href="#/conta">Todos os meus pedidos</a></div>
        </aside></div>`;

      if ($('.pix-qr-carregando')) {
        const ccAgora = $('#pix-cc-txt') ? $('#pix-cc-txt').value : '';
        carregarQR().then(() => { const el = $('#pix-qr'); if (el && ccAgora && $('.pix-qr-carregando', el)) el.innerHTML = window.StreetPix.qrSvg(ccAgora, 240); })
          .catch(() => { const el = $('#pix-qr'); if (el) el.innerHTML = window.StreetPix.qrSvg(ccAgora, 240); });   // sem a biblioteca: aviso "use o copia e cola"
      }
      const btnC = $('#btn-copiar');
      if (btnC) btnC.addEventListener('click', async () => {
        const ta = $('#pix-cc-txt');
        try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
        btnC.innerHTML = '✓ Código copiado'; toast({ titulo: 'Código Pix copiado', texto: 'Cole no app do seu banco', tipo: 'ok' });
        setTimeout(() => { if (document.contains(btnC)) btnC.innerHTML = 'Copiar código Pix'; }, 2600);
      });
      clearInterval(timer);
      const tempo = $('#pix-tempo');
      if (tempo) {
        const ger = new Date((ped.pagamento && ped.pagamento.geradoEm) || ped.criadoEm).getTime();
        const fim = ger + (C.pix.validadeMin || 30) * 60e3;
        const tick = () => {
          const r = Math.max(0, fim - Date.now());
          if (!r) {
            clearInterval(timer);
            tempo.innerHTML = `<span>Este QR Code expirou.</span> <button type="button" class="btn btn-p" id="btn-novo-pix">Gerar novo Pix</button>`;
            $('#btn-novo-pix').addEventListener('click', () => { DB.pedidos.atualizar(ped.id, { pagamento: { ...ped.pagamento, geradoEm: new Date().toISOString() } }); });
            if ($('#pix-qr')) $('#pix-qr').style.opacity = '.25';
            return;
          }
          const mm = String(Math.floor(r / 60000)).padStart(2, '0'), ss = String(Math.floor((r % 60000) / 1000)).padStart(2, '0');
          tempo.innerHTML = `Válido por <b>${mm}:${ss}</b>`;
        };
        tick(); timer = setInterval(tick, 1000);
      }
      if (celebrar) confete($('#pago-caixa'));
    }

    render();
    pg.onPedidos = () => {
      const novo = DB.pedidos.get(id); if (!novo) return;
      const mudou = novo.status !== statusVisto;
      const celebrar = statusVisto === 'aguardando_pagamento' && novo.status === 'pago';
      statusVisto = novo.status;
      const y = window.scrollY;
      render(celebrar);
      if (celebrar) {
        toast({ titulo: 'Pagamento confirmado!', texto: `${novo.id} • ${brl(novo.total)}`, tipo: 'ok' });
        const box = $('#pago-caixa'); if (box) box.scrollIntoView({ block: 'center', behavior: reduzMov ? 'auto' : 'smooth' });
      } else { window.scrollTo(0, y); if (mudou) toast({ titulo: 'Status atualizado', texto: (DB.STATUS[novo.status] || {}).nome || novo.status, tipo: 'ok' }); }
    };
    pg.sair = () => clearInterval(timer);
  }
  function confete(box) {
    if (!box || reduzMov) return;
    const cores = ['#E38420', '#F2A81D', '#FFFFFF', '#111111', '#3DDC84'];
    for (let i = 0; i < 46; i++) {
      const s = document.createElement('span');
      s.className = 'confete';
      s.style.left = Math.random() * 100 + '%';
      s.style.background = cores[i % cores.length];
      s.style.animationDelay = (Math.random() * 0.6) + 's';
      s.style.animationDuration = (1.8 + Math.random() * 1.4) + 's';
      s.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(s);
      setTimeout(() => s.remove(), 4000);
    }
  }

  /* ======================================================================
     MINHA CONTA
     ====================================================================== */
  function rotaConta() {
    document.title = 'Minha conta • Street Distribuidora';
    const l = DB.lojistas.atual();
    if (!l) { contaEntrar(); return; }
    const meus = DB.pedidos.list().filter(p => p.lojista && soDig(p.lojista.cnpj) === soDig(l.cnpj));
    const st = l.status || 'pendente';
    const total = meus.filter(p => p.status !== 'cancelado').reduce((s, p) => s + (p.total || 0), 0);
    app.innerHTML = `<div class="wrap conta-grade">
      <div class="conta-topo"><div style="min-width:0"><div class="kicker" style="color:var(--mostarda)">Minha conta</div><h1>${esc(l.razao || 'Sua loja')}</h1>
        <p>CNPJ ${esc(mascCNPJ(l.cnpj))}${l.cidade ? ` • ${esc(l.cidade)}${l.uf ? '/' + esc(l.uf) : ''}` : ''} • <span class="badge ${esc(st)}">${st === 'aprovado' ? 'Cadastro aprovado' : st === 'recusado' ? 'Cadastro não aprovado' : 'Cadastro em análise'}</span></p></div>
        <button type="button" class="btn btn-p" style="background:transparent;color:#fff;border-color:#fff" id="btn-sair">Sair</button></div>
      <div class="aviso ${st === 'aprovado' ? 'verde' : st === 'recusado' ? 'erro' : 'laranja'}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/></svg><div>${
        st === 'recusado' ? `<b>Cadastro não aprovado.</b> Esta loja não pode comprar pelo site por enquanto. <a class="link" target="_blank" rel="noopener" href="${wa(`Olá, Street! O cadastro da loja ${mascCNPJ(l.cnpj)} não foi aprovado. Podem me ajudar?`)}">Falar com a Street</a>`
        : st === 'aprovado' && l.boleto ? '<b>Cadastro aprovado.</b> Boleto a prazo liberado no checkout, além de Pix e cartão.'
        : st === 'aprovado' ? '<b>Cadastro aprovado.</b> Compre no Pix e no cartão. O boleto a prazo é liberado pela Street para cada loja; peça no WhatsApp.'
        : '<b>Cadastro em análise.</b> Você já pode comprar no Pix e no cartão. O boleto a prazo pode ser liberado depois que a Street aprovar o cadastro.'}</div></div>
      <section class="cartao"><div class="secao-cab" style="margin-bottom:6px"><h2>Meus pedidos</h2>${meus.length ? `<span class="muted" style="font-size:14px">${meus.length} ${meus.length === 1 ? 'pedido' : 'pedidos'} • ${brl(total)}</span>` : ''}</div>
        ${meus.length ? meus.map(p => { const S = DB.STATUS[p.status] || { nome: p.status, cor: '#111' }; return `<div class="pl"><div style="min-width:0"><div class="pl-id">${esc(p.id)} <span class="mini-pill ${stClasse(p.status)}">${esc(p.status === 'aguardando_pagamento' && p.pagamento && p.pagamento.metodo !== 'pix' ? 'Aguardando pagamento' : S.nome)}</span></div><div class="pl-meta">${fmtData(p.criadoEm)} • ${p.itens.length} SKUs • ${nomeMetodo(p.pagamento && p.pagamento.metodo)}</div></div>
          <strong>${brl(p.total)}</strong><div class="pl-acoes"><a class="btn btn-p" href="#/pedido/${enc(p.id)}">${p.status === 'aguardando_pagamento' && p.pagamento && p.pagamento.metodo === 'pix' ? 'Pagar' : 'Ver'}</a><button type="button" class="btn btn-p btn-fantasma" data-repetir="${esc(p.id)}">Repetir pedido</button></div></div>`; }).join('')
        : `<p class="muted">Nenhum pedido ainda.</p><a class="btn btn-preto" href="#/colecao/mais-pedidos">Começar pelos mais pedidos</a>`}
      </section></div>`;
    $('#btn-sair').addEventListener('click', () => { DB.lojistas.sair(); toast({ titulo: 'Você saiu da conta' }); rotear(); });
    pg.onPedidos = () => rotear(true);
    pg.onLojistas = () => rotear(true);
  }
  function contaEntrar() {
    const ex = DB.lojistas.list().filter(x => x.exemplo).slice(0, 3);
    app.innerHTML = `<div class="pagina-cab"><div class="wrap"><div class="kicker">Área do lojista</div><h1 class="disp incl">Minha conta</h1><p class="sub" style="margin-top:10px">Acompanhe pedidos, repita compras com um clique e libere o boleto a prazo.</p></div></div>
      <div class="wrap conta-grade dois">
        <section class="cartao duro" aria-labelledby="t-entrar"><h2 id="t-entrar">Entrar</h2>
          <form id="f-entrar" novalidate><div class="campo"><label for="en-cnpj">CNPJ da loja</label><input id="en-cnpj" inputmode="numeric" placeholder="00.000.000/0000-00" autocomplete="off" required aria-describedby="en-msg"><span class="ajuda" id="en-msg" aria-live="polite"></span></div>
          <button class="btn btn-preto btn-bloco mt2" type="submit">Entrar</button></form>
          <p class="muted" style="font-size:13.5px;margin-top:12px">Demonstração: a entrada é só pelo CNPJ. Na versão final, o acesso é com senha ou com um código enviado no WhatsApp da loja.</p>
          ${ex.length ? `<p style="font-size:14px;margin:12px 0 6px;font-weight:700">Lojistas de exemplo:</p><div class="dir-flex">${ex.map(x => `<button type="button" class="chip" data-ex="${esc(x.cnpj)}">${esc(x.razao)}</button>`).join('')}</div>` : ''}
        </section>
        <section class="cartao" aria-labelledby="t-cad"><h2 id="t-cad">Solicitar acesso</h2><p class="muted" style="font-size:14.5px">Primeira compra? Cadastre a loja. Pix e cartão liberam na hora; boleto a prazo depois da aprovação.</p>
          <form id="f-cad" class="form-grade d2" novalidate>
            <div class="campo col2"><label for="cd-cnpj">CNPJ</label><input id="cd-cnpj" inputmode="numeric" placeholder="00.000.000/0000-00" autocomplete="off" required aria-describedby="cd-msg"><span class="ajuda" id="cd-msg">Buscamos razão social e cidade automaticamente.</span></div>
            <div class="campo col2"><label for="cd-razao">Razão social ou nome da loja</label><input id="cd-razao" autocomplete="organization" required></div>
            <div class="campo"><label for="cd-nome">Seu nome</label><input id="cd-nome" autocomplete="name" required></div>
            <div class="campo"><label for="cd-zap">WhatsApp</label><input id="cd-zap" data-masc="tel" inputmode="tel" placeholder="(71) 99999-9999" required></div>
            <div class="campo"><label for="cd-cidade">Cidade</label><input id="cd-cidade" autocomplete="address-level2"></div>
            <div class="campo"><label for="cd-uf">UF</label><input id="cd-uf" maxlength="2" style="text-transform:uppercase"></div>
            <div class="col2"><button class="btn btn-laranja btn-bloco" type="submit">Solicitar acesso</button></div>
          </form></section>
      </div>`;
    const enC = $('#en-cnpj');
    enC.addEventListener('input', () => { enC.value = mascCNPJ(enC.value); enC.removeAttribute('aria-invalid'); enC.closest('.campo').classList.remove('erro'); });
    const entrar = c => {
      const l = DB.lojistas.get(c);
      const msg = $('#en-msg');
      if (!l) { msg.className = 'msg-erro'; msg.textContent = 'CNPJ sem cadastro. Use “Solicitar acesso” ao lado.'; enC.closest('.campo').classList.add('erro'); enC.setAttribute('aria-invalid', 'true'); enC.focus(); return; }
      DB.lojistas.entrar(c); toast({ titulo: 'Bem-vindo de volta', texto: l.razao || '', tipo: 'ok' }); rotear(true);
    };
    $('#f-entrar').addEventListener('submit', e => { e.preventDefault(); entrar(soDig(enC.value)); });
    $$('[data-ex]').forEach(b => b.addEventListener('click', () => entrar(soDig(b.dataset.ex))));
    const f = $('#f-cad');
    ligarMascaras(f);
    ligarCNPJ($('#cd-cnpj'), $('#cd-msg'), (d) => {
      if (!d) return;
      $('#cd-razao').value = d.nome_fantasia ? `${d.razao_social} (${d.nome_fantasia})` : d.razao_social;
      if (d.municipio) $('#cd-cidade').value = d.municipio.replace(/\b\w+/g, w => w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase());
      if (d.uf) $('#cd-uf').value = d.uf;
    });
    f.addEventListener('submit', e => {
      e.preventDefault();
      limparErros(f);
      const c = soDig($('#cd-cnpj').value);
      const err = [];
      if (!cnpjValido(c)) err.push(['#cd-cnpj', 'Informe um CNPJ válido.']);
      if (!$('#cd-razao').value.trim()) err.push(['#cd-razao', 'Informe a razão social ou o nome da loja.']);
      if (!$('#cd-nome').value.trim()) err.push(['#cd-nome', 'Informe seu nome.']);
      if (soDig($('#cd-zap').value).length < 10) err.push(['#cd-zap', 'Informe o WhatsApp com DDD.']);
      if (err.length) { err.forEach(([id, txt]) => marcarCampo($(id), txt)); $(err[0][0]).focus(); toast({ titulo: err.length === 1 ? 'Confira o campo destacado' : `Confira os ${err.length} campos destacados`, texto: err[0][1], tipo: 'erro' }); return; }
      const existente = DB.lojistas.get(c);
      DB.lojistas.salvar({ cnpj: mascCNPJ(c), razao: $('#cd-razao').value.trim(), nome: $('#cd-nome').value.trim(), whatsapp: soDig($('#cd-zap').value), cidade: $('#cd-cidade').value.trim(), uf: $('#cd-uf').value.trim().toUpperCase(), ...(existente ? {} : { status: 'pendente' }) });
      DB.lojistas.entrar(c);
      toast({ titulo: 'Cadastro enviado', texto: 'A Street vai analisar e liberar o boleto a prazo', tipo: 'ok' });
      rotear(true);
    });
  }

  /* ======================================================================
     PITEIRAS PERSONALIZADAS · SOBRE · POLÍTICAS
     ====================================================================== */
  function rotaPiteiras() {
    document.title = 'Piteiras personalizadas • Street Distribuidora';
    const lista = PRODS.filter(p => p.c === 'Piteiras de Vidro').sort(ordemTop);
    const l = DB.lojistas.atual();
    const noMap = qtdNoPedido();
    app.innerHTML = `<section class="pit-hero escura"><div class="wrap">
        <div class="kicker">Fábrica de piteiras parceira</div>
        <h1 class="disp incl">A piteira <em>da sua loja</em></h1>
        <p>Trabalhamos com uma fábrica de piteiras de vidro parceira para criar modelos com a identidade da sua tabacaria. Quase todas as piteiras de vidro do nosso site são da casa.</p>
        <div class="pit-tipos">
          <div class="pit-tipo"><h3>Simples</h3><p>Vidro com acabamento limpo e a sua marca aplicada. O clássico que gira no balcão.</p></div>
          <div class="pit-tipo"><h3>Full print</h3><p>Arte em toda a superfície da piteira: cores, padrões e personagens de ponta a ponta.</p></div>
          <div class="pit-tipo"><h3>Artísticas</h3><p>Peças com trabalho artístico e formatos especiais para quem quer uma vitrine diferente.</p></div>
        </div>
        <button type="button" class="btn-s claro" data-rolar="pit-form" style="margin-top:24px"><span class="btn-s-txt">Pedir orçamento</span><span class="s-chip" aria-hidden="true"></span></button>
      </div></section>
      ${lista.length ? `<section class="secao"><div class="wrap"><div class="secao-cab"><div><div class="kicker">Feitas pela fábrica parceira</div><h2 class="tit-secao incl">Piteiras de vidro <em>no catálogo</em></h2></div><a class="ver-tudo" href="${linkC('Piteiras de Vidro')}">Ver todas (${lista.length}) →</a></div>
        <div class="grade g5">${lista.slice(0, 10).map(p => card(p, noMap)).join('')}</div></div></section>` : ''}
      <section class="secao cinza" id="pit-form" aria-labelledby="t-orc"><div class="wrap pit-form-grade" style="padding-top:0;padding-bottom:0">
        <form id="f-pit" class="cartao duro" novalidate><h2 id="t-orc">Pedir orçamento</h2><p class="muted" style="font-size:14.5px">Preencha e a conversa abre no WhatsApp da Street com tudo escrito. A arte você anexa lá.</p>
          <div class="form-grade d2">
            <div class="campo col2"><label for="pt-loja">Nome da loja</label><input id="pt-loja" required value="${esc(l ? l.razao : '')}"></div>
            <div class="campo"><label for="pt-tipo">Tipo de piteira</label><select id="pt-tipo"><option>Simples</option><option>Full print</option><option>Artística</option><option>Ainda não sei</option></select></div>
            <div class="campo"><label for="pt-qtd">Quantidade desejada</label><input id="pt-qtd" type="number" inputmode="numeric" min="1" placeholder="Ex.: 100"></div>
            <div class="campo col2"><label for="pt-ideia">Ideia da arte</label><textarea id="pt-ideia" placeholder="Cores, logo, personagens, referências…"></textarea></div>
            <div class="campo col2"><label for="pt-arq">Arte ou referência <small>(pré-visualização, fica só no seu aparelho)</small></label><input id="pt-arq" type="file" accept="image/*"></div>
          </div>
          <button type="submit" class="btn btn-verde btn-g btn-bloco mt2">Enviar no WhatsApp</button>
        </form>
        <div><div class="arte-prev" id="arte-prev"><span style="padding:20px">A pré-visualização da sua arte aparece aqui.</span></div><p class="muted" style="font-size:13px;margin-top:8px">Simulação ilustrativa. O orçamento final depende do modelo e da quantidade.</p></div>
      </div></section>`;
    $('#pt-arq').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const url = URL.createObjectURL(f);
      $('#arte-prev').innerHTML = `<img src="${url}" alt="Sua arte" style="opacity:.22;position:absolute;inset:0"><span class="mock-piteira" style="left:calc(50% - 32px)"><img src="${url}" alt=""></span>`;
    });
    $('#f-pit').addEventListener('submit', e => {
      e.preventDefault();
      const loja = $('#pt-loja').value.trim();
      if (!loja) { $('#pt-loja').closest('.campo').classList.add('erro'); $('#pt-loja').focus(); return; }
      const msg = `Olá, Street! Quero orçamento de piteiras personalizadas.\n\nLoja: ${loja}\nTipo: ${$('#pt-tipo').value}\nQuantidade: ${$('#pt-qtd').value || 'a definir'}\nIdeia: ${$('#pt-ideia').value.trim() || '—'}${$('#pt-arq').files.length ? '\n\nVou anexar a arte aqui na conversa.' : ''}`;
      window.open(wa(msg), '_blank', 'noopener');
    });
  }

  function rotaSobre() {
    document.title = 'Sobre • Street Distribuidora';
    const nMarcas = CAT.marcas.filter(m => m.nome).length;
    const ig = C.instagram ? `https://instagram.com/${C.instagram}` : '';
    app.innerHTML = `<div class="pagina-cab"><div class="wrap"><div class="kicker">Sobre</div><h1 class="disp incl">${esc(C.nome)}</h1><p class="sub" style="margin-top:10px">${esc(C.slogan || '')}</p></div></div>
      <div class="wrap texto">
        <p>A ${esc(C.nome)} abastece tabacarias e headshops com acessórios das principais marcas do cenário. Hoje o catálogo reúne <b>${fmtNum(PRODS.length)} produtos</b> de <b>${nMarcas} marcas</b> em ${Object.keys(CAT.categorias).length} categorias, de sedas e piteiras a bandejas, cases, isqueiros e trituradores.</p>
        <p>A venda é exclusiva para lojistas, com pedido mínimo de ${brl(C.pedidoMinimo)}, Pix sem acréscimo e envio em até 2 dias úteis em Salvador e região metropolitana.</p>
        <h2>Dados da empresa</h2>
        <dl class="dados">
          <div><dt>Razão social</dt><dd>${esc(C.razaoSocial || C.nome)}</dd></div>
          <div><dt>CNPJ</dt><dd>${esc(C.cnpj)}</dd></div>
          <div><dt>Endereço</dt><dd>${esc(C.endereco)}</dd></div>
          <div><dt>Horário</dt><dd>${esc(C.horario)}</dd></div>
          <div><dt>WhatsApp</dt><dd><a class="link" href="${wa('Olá, Street! Vim pelo site.')}" target="_blank" rel="noopener">${esc(C.telefone || C.whatsapp)}</a></dd></div>
          ${ig ? `<div><dt>Instagram</dt><dd><a class="link" href="${ig}" target="_blank" rel="noopener">@${esc(C.instagram)}</a></dd></div>` : ''}
        </dl>
        <p class="aviso-18"><b>+18</b> Venda exclusiva para lojistas. Proibida a venda para menores de 18 anos.</p>
        <div class="dir-flex mt3"><a class="btn-s" href="#/colecao/mais-pedidos"><span class="btn-s-txt">Comprar agora</span><span class="s-chip" aria-hidden="true"></span></a><a class="btn" href="#/politicas">Entrega, trocas e pagamento</a></div>
      </div>`;
  }

  function rotaPoliticas() {
    document.title = 'Políticas • Street Distribuidora';
    app.innerHTML = `<div class="pagina-cab"><div class="wrap"><div class="kicker">Políticas</div><h1 class="disp incl">Entrega, trocas <em style="color:var(--laranja)">e pagamento</em></h1></div></div>
      <div class="wrap texto">
        <h2 id="venda">Venda para lojistas</h2>
        <p>A ${esc(C.nome)} vende exclusivamente no atacado, para lojistas com CNPJ. É proibida a venda para menores de 18 anos. O pedido mínimo é de ${brl(C.pedidoMinimo)}.</p>
        <h2 id="pagamento">Pagamento</h2>
        <ul><li><b>Pix:</b> preço sem acréscimo. O QR Code e o código copia e cola aparecem assim que o pedido é enviado e valem por ${C.pix.validadeMin || 30} minutos.</li>
          <li><b>Cartão de crédito:</b> acréscimo de ${Math.round(C.acrescimoCartao * 100)}%. O link de pagamento é enviado pelo WhatsApp.</li>
          ${(C.pagamentos || []).some(x => x.id === 'boleto') ? '<li><b>Boleto a prazo:</b> disponível para lojistas com cadastro aprovado.</li>' : ''}</ul>
        <h2 id="entrega">Entrega</h2>
        <ul><li><b>Retirada no galpão:</b> ${esc(C.endereco)} — ${esc(C.horario)}.</li>
          <li><b>Salvador e RMS:</b> em até 2 dias úteis.</li>
          <li><b>Bahia:</b> em até 1 semana.</li>
          <li><b>Demais estados:</b> prazo informado na cotação, enviada pelo WhatsApp.</li></ul>
        <h2 id="trocas">Trocas</h2>
        <p>Aceitamos troca em caso de <b>defeito de fabricação</b> ou <b>produto diferente do pedido</b>. Avise em até <b>3 dias</b> após o recebimento, pelo WhatsApp ou Instagram, com fotos do produto e da embalagem.</p>
        <h2 id="privacidade">Privacidade</h2>
        <p>Os dados informados no cadastro e nos pedidos (CNPJ, nome, WhatsApp, e-mail e endereço) são usados só para processar pedidos, emitir documentos e falar com você sobre as suas compras.</p>
        <div class="dir-flex mt3"><a class="btn btn-verde" href="${wa('Olá, Street! Tenho uma dúvida sobre entrega/trocas.')}" target="_blank" rel="noopener">Falar no WhatsApp</a></div>
      </div>`;
  }

  /* ======================================================================
     Roteador
     ====================================================================== */
  const ROTAS = [
    [/^\/?$/, home],
    [/^\/c\/([^/]+)(?:\/([^/]+))?\/?$/, (c, s) => rotaCategoria(dec(c), s ? dec(s) : null)],
    [/^\/m\/([^/]+)\/?$/, m => rotaMarca(dec(m))],
    [/^\/busca\/(.*)$/, q => rotaBusca(dec(q))],
    [/^\/colecao\/([^/]+)\/?$/, c => rotaColecao(dec(c))],
    [/^\/p\/([^/]+)\/?$/, h => rotaProduto(dec(h))],
    [/^\/rapido\/?$/, rotaRapido],
    [/^\/checkout\/?$/, rotaCheckout],
    [/^\/pedido\/([^/]+)\/?$/, id => rotaPedido(dec(id))],
    [/^\/conta\/?$/, rotaConta],
    [/^\/piteiras\/?$/, rotaPiteiras],
    [/^\/sobre\/?$/, rotaSobre],
    [/^\/politicas\/?$/, rotaPoliticas],
  ];
  let rerenderAoVivo = false;   // true durante um re-render da mesma rota (painel mudou algo): páginas restauram o estado
  function rotear(manterScroll = false) {
    if (!CAT) return;
    let hash = location.hash.replace(/^#/, '') || '/';
    if (!hash.startsWith('/')) { // âncora interna
      const alvo = document.getElementById(hash);
      if (alvo && rotaAtual) { alvo.scrollIntoView({ behavior: reduzMov ? 'auto' : 'smooth' }); return; }
      hash = '/';
    }
    // guarda posição da lista para voltar do produto
    if (rotaAtual) posicoes[rotaAtual] = { y: window.scrollY, ...(pg.n ? pg.n() : {}) };
    if (pg.sair) { try { pg.sair(); } catch (e) { console.error(e); } }
    const mesma = hash === rotaAtual;
    rotaAnterior = mesma ? rotaAnterior : rotaAtual;
    rotaAtual = hash;
    rerenderAoVivo = mesma && manterScroll;
    pg = {};
    fecharBusca();
    if (!mesma && gavetaAberta) fecharGaveta();
    if (!mesma && folhaAberta && folhaFechavel) fecharFolha();
    if (!hash.startsWith('/busca/')) { buscaInput.value = ''; $('#busca-limpar').hidden = true; }
    marcarCatbar(null);
    // nome da rota no body (CSS: botão "Instalar app" só na home, topo enxuto no pedido rápido)
    document.body.dataset.rota = hash === '/' ? 'home' : (hash.split('/')[1] || 'home');
    document.title = 'Street Distribuidora';
    const y = window.scrollY;
    let achou = false;
    for (const [re, fn] of ROTAS) {
      const m = hash.match(re);
      if (m) { achou = true; try { fn(...m.slice(1)); } catch (e) { console.error(e); app.innerHTML = vazioHTML('Algo deu errado', 'Recarregue a página. Se continuar, fale com a Street no WhatsApp.'); } break; }
    }
    rerenderAoVivo = false;
    if (!achou) app.innerHTML = vazioHTML('Página não encontrada', 'O link pode estar quebrado.');
    const voltando = rotaAnterior.startsWith('/p/') && posicoes[hash] && !hash.startsWith('/p/');
    if (manterScroll || mesma) window.scrollTo(0, y);
    else if (voltando) { const yy = posicoes[hash].y; window.scrollTo(0, yy); requestAnimationFrame(() => window.scrollTo(0, yy)); }
    else {
      window.scrollTo(0, 0);
      // foco no título da página nova, mas nunca atrás de um modal aberto (portão +18, folha, gaveta)
      const h1 = $('h1', app);
      if (h1 && !folhaAberta && !gavetaAberta) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    }
  }
  // Re-render da rota atual sem perder o que o lojista estava fazendo: guarda quantidades digitadas
  // (grade de variantes, stepper do produto) e devolve depois.
  function rerender() {
    if (pg.aoVivo) { pg.aoVivo(); return; }
    if (folhaAberta && folhaFechavel) fecharFolha();   // folha de filtros/grade ligada ao estado antigo da página
    const vals = $$('#app .vlinha[data-vid] input, #app .prod-add .stepper input').map(i => [i.closest('.vlinha') ? 'v' + i.closest('.vlinha').dataset.vid : 'add', i.value]);
    const ativo = document.activeElement && app.contains(document.activeElement) && document.activeElement.closest('[data-vid], .prod-add');
    const ativoId = ativo ? (ativo.dataset.vid ? 'v' + ativo.dataset.vid : 'add') : null;
    rotear(true);
    vals.forEach(([k, v]) => {
      const inp = k === 'add' ? $('#app .prod-add .stepper input') : $(`#app .vlinha[data-vid="${CSS.escape(k.slice(1))}"] input`);
      if (inp && v !== inp.value) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      if (inp && k === ativoId) inp.focus({ preventScroll: true });
    });
  }
  window.addEventListener('hashchange', () => rotear());

  /* ======================================================================
     Eventos do store (inclusive vindos de outra aba)
     ====================================================================== */
  DB.on('carrinho', () => {
    atualizarTopo();
    if (!gaveta.hidden) renderGaveta();
    const m = qtdNoPedido();
    $$('[data-no]').forEach(el => { const q = m.get(el.dataset.no) || 0; el.hidden = !q; el.textContent = `✓ ${q} no pedido`; });
    if (pg.onCarrinho) pg.onCarrinho();
  });
  DB.on('pedidos', () => { if (pg.onPedidos) pg.onPedidos(); });
  DB.on('lojistas', () => { atualizarTopo(); if (pg.onLojistas) pg.onLojistas(); });
  // Painel mudou pedido mínimo / acréscimo / Pix: atualiza tudo o que está aberto (sem perder formulário nem filtros)
  DB.on('config', d => {
    if (d == null) { const s = DB.ls.get('config', null); if (s && typeof s === 'object') { const { pix, ...resto } = s; Object.assign(C, resto); if (pix) Object.assign(C.pix, pix); } }
    renderRodape(); atualizarTopo();
    if (gavetaAberta) renderGaveta();
    if (!CAT || /^\/(pedido|conta)\b/.test(rotaAtual)) return;
    rerender();
  });
  // Ajustes de produto feitos no painel (preço, esgotado, destaque, oculto) chegam ao vivo
  const copiaV = v => (Array.isArray(v) ? v.map(x => ({ ...x })) : undefined);
  DB.on('overrides', () => {
    if (!CAT) return;
    const o = DB.overrides.todos();
    CAT.produtos.forEach(p => {
      // _base = estado do JSON (antes de qualquer ajuste), inclusive preços das variantes e pmax
      if (!p._base) { const b = p.original || p; p._base = { disp: b.disp, p: b.p, v: copiaV(b.v), pmax: b.pmax }; }
      const b = p._base;
      p.disp = b.disp; p.p = b.p;
      if (b.v) p.v = copiaV(b.v); else delete p.v;
      if (b.pmax != null) p.pmax = b.pmax; else delete p.pmax;
      delete p.destaque; delete p.oculto;
      const x = o[p.id];
      if (x) Object.assign(p, { ...x, ...(x.v ? { v: copiaV(x.v) } : {}) });
    });
    PRODS = CAT.produtos.filter(p => !p.oculto);
    indexar();
    // carrinho acompanha: preço novo, item esgotado/oculto sai (com aviso)
    avisarRevalidacao(revalidarCarrinho());
    if (gavetaAberta) renderGaveta();
    if (['/', ''].includes(rotaAtual) || /^\/(c|m|colecao|busca|p|rapido|checkout|piteiras)\b/.test(rotaAtual)) rerender();
  });

  /* ======================================================================
     Portão +18, PWA, topo compacto, inicialização
     ====================================================================== */
  function portao() {
    if (DB.ls.get('portao', false)) return;
    abrirFolha(`<div class="portao"><img src="assets/img/logo-street.png" alt="Street" width="170" height="68">
      <div class="kicker" style="color:var(--mostarda)">Acesso restrito</div>
      <h2 id="folha-tit">Venda exclusiva para <em>lojistas</em> e maiores de 18 anos</h2>
      <p>Este é o atacado da ${esc(C.nome)}. Para continuar, confirme que você compra para revenda e tem 18 anos ou mais.</p>
      <div class="portao-btns"><button type="button" class="btn btn-laranja btn-g" id="portao-ok" autofocus>Sou lojista e tenho 18+</button><button type="button" class="btn btn-fantasma" id="portao-sair">Sair</button></div></div>`, { classe: 'sem-cab', fechavel: false });
    $('#portao-ok').addEventListener('click', () => { DB.ls.set('portao', Date.now()); folhaFechavel = true; fecharFolha(); });
    $('#portao-sair').addEventListener('click', () => { location.href = 'https://www.google.com.br'; });
  }

  let promptInstalar = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalar = e; $('#btn-instalar').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#btn-instalar').hidden = true; promptInstalar = null; });
  $('#btn-instalar').addEventListener('click', async () => {
    if (!promptInstalar) return;
    promptInstalar.prompt();
    try { await promptInstalar.userChoice; } catch { /* */ }
    promptInstalar = null; $('#btn-instalar').hidden = true;
  });

  /* Altura real do topo → CSS (sticky de filtros, resumo, ferramentas do pedido rápido).
     No celular a barra de categorias é absoluta (fora do fluxo) e some com transform: o topo nunca muda
     de altura ao rolar, então a ancoragem de rolagem do navegador não entra em loop. */
  const topo = $('#topo'), catbar = $('#catbar');
  const catbarFora = () => getComputedStyle(catbar).position === 'absolute';
  const medirTopo = () => {
    const absol = catbarFora();
    const ch = absol ? catbar.offsetHeight : 0;
    document.documentElement.style.setProperty('--catbar-h', ch + 'px');
    const vis = absol && !topo.classList.contains('compacto') ? ch : 0;
    document.documentElement.style.setProperty('--topo-h', (topo.offsetHeight + vis) + 'px');
  };
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(medirTopo); ro.observe(topo); ro.observe(catbar); } else window.addEventListener('resize', medirTopo);
  window.addEventListener('resize', medirTopo);
  let ticking = false, compacto = false;
  window.addEventListener('scroll', () => {
    if (ticking || rolagemPausada) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (rolagemPausada) return;
      const y = window.scrollY;
      // histerese: compacta acima de 160 e só volta abaixo de 90
      const r = compacto ? y > 90 : y > 160;
      if (r !== compacto) { compacto = r; topo.classList.toggle('compacto', r); document.body.classList.toggle('rolou', r); medirTopo(); }
    });
  }, { passive: true });

  // letreiro: duplica o conteúdo para rolar sem emenda; botão para pausar (WCAG 2.2.2)
  const tr = $('.letreiro-trilho'); tr.innerHTML += tr.innerHTML;
  const btnLet = $('#letreiro-pausa');
  if (btnLet) btnLet.addEventListener('click', () => {
    const p = !$('.letreiro').classList.contains('parado');
    $('.letreiro').classList.toggle('parado', p);
    btnLet.setAttribute('aria-pressed', String(p));
    btnLet.setAttribute('aria-label', p ? 'Retomar o letreiro de avisos' : 'Pausar o letreiro de avisos');
  });

  // Inicialização protegida: dado estranho no localStorage não pode travar a loja em "Carregando catálogo…"
  const seguro = (fn, nome) => { try { fn(); } catch (e) { console.error(nome, e); } };
  seguro(renderRodape, 'rodapé');
  seguro(atualizarTopo, 'topo');
  seguro(portao, 'portão');
  seguro(medirTopo, 'medir topo');
  DB.catalogo().then(cat => {
    CAT = cat;
    PRODS = CAT.produtos.filter(p => !p.oculto);
    indexar();
    buscaInput.placeholder = `Buscar entre ${fmtNum(PRODS.length)} produtos, marcas ou SKU`;
    seguro(renderCatbar, 'categorias');
    seguro(medirTopo, 'medir topo');
    // preço/estoque podem ter mudado desde a última visita
    seguro(() => avisarRevalidacao(revalidarCarrinho()), 'revalidar carrinho');
    rotear();
  }).catch(err => {
    console.error(err);
    app.innerHTML = vazioHTML('Não foi possível carregar o catálogo', 'Verifique a conexão e recarregue a página.', `<button type="button" class="btn btn-preto" onclick="location.reload()">Recarregar</button>`);
  });
})();
