/* Painel da Street (admin.html) — recebe, cobra, separa e despacha pedidos.
   Usa só window.StreetDB (store.js). No modo demonstração os dados ficam no localStorage;
   a aba da loja e a do painel conversam pelo evento 'storage', então um pedido feito na loja
   aparece aqui na hora (toast + som). Rotas por hash: #/visao #/pedidos #/separacao #/lojistas #/produtos #/config */
(() => {
  const DB = window.StreetDB;
  const C = DB.config;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = DB.brl;
  const r2 = v => Math.round(v * 100) / 100;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ico = (n, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const imgW = (u, w) => (u ? u + (u.includes('?') ? '&' : '?') + 'width=' + w : '');
  const thumb = (u, w = 56, cls = '') => (u
    ? `<img class="${cls}" src="${esc(imgW(u, w * 2))}" alt="" width="${w}" height="${w}" loading="lazy" decoding="async">`
    : `<span class="ph ${cls}"></span>`);
  const dataHora = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const dataCurta = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const num = n => Number(n || 0).toLocaleString('pt-BR');
  const dig = DB.soDig;
  const fmtCnpj = c => { const d = dig(c); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '—'); };
  const fmtFone = f => { let d = dig(f); if (d.startsWith('55') && d.length > 11) d = d.slice(2);
    return d.length === 11 ? d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3') : d.length === 10 ? d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3') : (f || '—'); };
  const waLink = (fone, msg) => { let d = dig(fone); if (!d) return ''; if (!d.startsWith('55')) d = '55' + d; return `https://wa.me/${d}${msg ? '?text=' + encodeURIComponent(msg) : ''}`; };
  // Número em pt-BR: "1.234,56", "35,7", "1.500" (= mil e quinhentos), "1.200.000"; "35.70" (ponto + 1 ou 2 casas) ainda é decimal.
  const parseNum = v => {
    const s = String(v == null ? '' : v).trim().replace(/[^\d.,-]/g, '');
    if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ''));
    return parseFloat(s);
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const FLUXO = ['aguardando_pagamento', 'pago', 'separando', 'enviado', 'entregue'];
  const FATURADO = new Set(['pago', 'separando', 'enviado', 'entregue']);
  // STATUS.aguardando_pagamento se chama "Aguardando Pix" no store; para cartão/boleto o painel mostra "Aguardando pagamento".
  const ehPix = p => !!(p && p.pagamento && p.pagamento.metodo === 'pix');
  const stNome = (s, p) => (s === 'aguardando_pagamento' && p && !ehPix(p) ? 'Aguardando pagamento' : (DB.STATUS[s] || { nome: s }).nome);
  const stPill = (s, p) => `<span class="st st-${esc(s)}">${esc(stNome(s, p))}</span>`;
  const nomeAba = k => (k === 'aguardando_pagamento' ? 'Aguardando pagamento' : stNome(k));
  const METODO = { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto' };
  const metodoNome = m => METODO[m] || (m ? String(m) : '—');
  const qtdItens = p => (p.itens || []).reduce((s, i) => s + (Number(i.qtd) || 0), 0);
  const totalDe = p => Number(p.total != null ? p.total : p.subtotal) || 0;
  const loj = p => p.lojista || {};
  const precoUnit = (p, it) => (it.precoPago != null ? Number(it.precoPago) : p.pagamento && p.pagamento.metodo === 'pix' ? DB.precoPix(it.preco) : DB.precoCartao(it.preco));

  /* ---------------- estado ---------------- */
  const S = {
    view: 'visao', aba: 'todos', busca: '', sepModo: 'pedidos', lojBusca: '',
    prod: { busca: '', cat: '', marca: '', disp: '', pag: 0 },
    aberto: null, rascunho: {}, som: true,
  };
  try { S.som = localStorage.getItem('street.admin.som') !== '0'; } catch { /* sem storage */ }
  let conhecidos = new Set();
  const destacados = new Set();
  let suprimirAlerta = false;
  let cat = null, pristino = null;

  /* ---------------- login ---------------- */
  const SESS = 'street.admin.sessao';
  const logado = () => { try { return sessionStorage.getItem(SESS) === '1'; } catch { return false; } };

  function mostrarLogin() {
    $('#login').hidden = false; $('#app').hidden = true;
    setTimeout(() => $('#senha').focus(), 50);
  }
  $('#form-login').addEventListener('submit', e => {
    e.preventDefault();
    const ok = $('#senha').value.trim().toLowerCase() === String((C.painel && C.painel.senhaDemo) || 'street').toLowerCase();
    if (!ok) { $('#login-erro').hidden = false; $('#senha').select(); return; }
    try { sessionStorage.setItem(SESS, '1'); } catch { /* ok */ }
    destravarAudio();
    iniciar();
  });

  /* ---------------- som (WebAudio, sem arquivo) ---------------- */
  let ac = null;
  function destravarAudio() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch { ac = null; }
  }
  document.addEventListener('pointerdown', destravarAudio, { passive: true });
  document.addEventListener('keydown', destravarAudio);
  function apitar() {
    if (!S.som) return;
    destravarAudio(); if (!ac) return;
    const t0 = ac.currentTime + 0.02;
    [[880, 0], [1318.5, 0.16], [1760, 0.32]].forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.28, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.45);
      o.connect(g).connect(ac.destination); o.start(t0 + d); o.stop(t0 + d + 0.5);
    });
  }
  function atualizarBotaoSom() {
    const b = $('#btn-som');
    b.setAttribute('aria-pressed', String(S.som));
    b.setAttribute('aria-label', S.som ? 'Som de novo pedido ligado' : 'Som de novo pedido desligado');
    b.innerHTML = ico(S.som ? 'som' : 'mudo');
  }

  /* ---------------- toasts ---------------- */
  function toast(msg, icone = 'ok', ms = 3200) {
    const el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status');
    el.innerHTML = `${ico(icone)}<span>${esc(msg)}</span>`;
    $('#toasts').append(el);
    setTimeout(() => { el.classList.add('sai'); setTimeout(() => el.remove(), 260); }, ms);
  }
  let tituloOrig = document.title, piscaT = null;
  function alertaNovoPedido(p) {
    const l = loj(p);
    const el = document.createElement('div');
    el.className = 'toast toast-novo'; el.setAttribute('role', 'alert');
    el.innerHTML = `
      <div class="cab">${ico('sino')}<span class="tit">Novo pedido!</span>
        <button class="btn-ico fechar" aria-label="Fechar aviso">${ico('x')}</button></div>
      <div class="corpo">${esc(p.id)} — ${brl(totalDe(p))}<span>${esc(l.razao || l.nome || 'Lojista')}${l.cidade ? ' • ' + esc(l.cidade) + (l.uf ? '/' + esc(l.uf) : '') : ''} • ${qtdItens(p)} un.</span></div>
      <div class="linha"><button class="btn btn-preto btn-peq" data-abrir="${esc(p.id)}">Abrir pedido</button></div>`;
    const fechar = () => { el.classList.add('sai'); setTimeout(() => el.remove(), 260); };
    el.querySelector('.fechar').onclick = fechar;
    el.querySelector('[data-abrir]').onclick = () => { fechar(); abrirPedido(p.id); };
    $('#toasts').prepend(el);
    setTimeout(fechar, 14000);
    apitar();
    clearInterval(piscaT); let n = 0;
    piscaT = setInterval(() => { document.title = n++ % 2 ? tituloOrig : `(!) Novo pedido ${p.id}`; if (n > 12) { clearInterval(piscaT); document.title = tituloOrig; } }, 900);
  }

  /* ---------------- modal de confirmação ---------------- */
  function confirmar({ titulo, html, sim = 'Confirmar', perigo = false }) {
    return new Promise(res => {
      const m = $('#modal');
      $('#modal-tit').textContent = titulo;
      $('#modal-txt').innerHTML = html;
      const bs = $('#modal-sim');
      bs.textContent = sim; bs.className = 'btn ' + (perigo ? 'btn-perigo-cheio' : 'btn-pri');
      const origem = document.activeElement;
      m.hidden = false;
      const fim = v => {
        m.hidden = true; m.onclick = null; document.removeEventListener('keydown', tecla, true); res(v);
        if (origem && origem !== document.body && document.contains(origem)) origem.focus();
      };
      const tecla = e => {
        if (e.key === 'Escape') { e.stopPropagation(); fim(false); }
        else if (e.key === 'Tab') prenderTab(e, $('.modal-card', m));
      };
      document.addEventListener('keydown', tecla, true);
      m.onclick = e => {
        if (e.target === m || e.target.closest('[data-act="modal-nao"]')) fim(false);
        else if (e.target.closest('[data-act="modal-sim"]')) fim(true);
      };
      // Ação destrutiva: o foco começa no campo de motivo (se houver) ou em "Voltar", nunca no botão vermelho.
      const primeiro = perigo ? ($('input, textarea', $('#modal-txt')) || $('[data-act="modal-nao"]', m)) : bs;
      setTimeout(() => primeiro.focus(), 30);
    });
  }

  /* ---------------- início ---------------- */
  let iniciado = false;
  async function iniciar() {
    $('#login').hidden = true; $('#app').hidden = false;
    atualizarBotaoSom();
    suprimirAlerta = true;
    try { await DB.seedDemo(); } catch (e) { console.error(e); }
    conhecidos = new Set(DB.pedidos.list().map(p => p.id));
    suprimirAlerta = false;
    if (!iniciado) {
      iniciado = true;
      DB.on('pedidos', aoMudarPedidos);
      DB.on('lojistas', () => { contadores(); if (S.view === 'lojistas' || S.view === 'visao') render(); });
      DB.on('config', () => { if (S.view === 'config') render(); });
      window.addEventListener('hashchange', rota);
      window.addEventListener('resize', debounce(() => { if (S.view === 'visao') desenharGrafico(); }, 150));
    }
    rota();
    carregarCatalogo(); // nunca rejeita: em falha devolve null e a aba Produtos mostra "Tentar de novo"
  }

  let catP = null, catErro = false;
  const buscarJson = u => fetch(u, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  // Resolve com o catálogo ou com null (nunca rejeita). Em falha zera catP para a próxima chamada tentar de novo.
  // Obs.: store.js guarda em cache a promessa rejeitada de DB.catalogo(); por isso, se ela falhar, o painel monta
  // o catálogo a partir da cópia que ele mesmo baixou (que também serve de "original" para desfazer ajustes).
  const carregarCatalogo = () => catP || (catP = (async () => {
    catErro = false;
    try {
      const base = (document.querySelector('script[src*="store.js"]').src || '').replace(/assets\/js\/store\.js.*$/, '');
      const [rDb, rCopia] = await Promise.allSettled([DB.catalogo(), buscarJson(base + 'data/catalogo.json')]);
      const d = rCopia.status === 'fulfilled' && rCopia.value && Array.isArray(rCopia.value.produtos) ? rCopia.value : null;
      const ov = DB.overrides.todos();
      if (rDb.status === 'fulfilled') cat = rDb.value;
      else if (d) {
        const prods = d.produtos.map(p => { const x = ov[p.id]; return x ? { ...p, original: { disp: p.disp, p: p.p }, ...x } : { ...p }; });
        cat = { ...d, produtos: prods, porId: new Map(prods.map(p => [String(p.id), p])), porHandle: new Map(prods.map(p => [p.h, p])) };
      } else throw rDb.reason;
      // Cópia intacta do JSON para poder desfazer ajustes e reexibir produtos ocultos.
      if (d) {
        pristino = new Map(d.produtos.map(p => [String(p.id), p]));
        d.produtos.forEach(p => { if (!cat.porId.has(String(p.id))) { const c = { ...p, ...(ov[p.id] || {}) }; cat.produtos.push(c); cat.porId.set(String(p.id), c); } });
      } else pristino = new Map();
      cat.produtos.forEach(p => {
        p._q = norm([p.n, p.m, p.sku, p.c, p.s, ...(p.v || []).map(v => v.sku + ' ' + v.t)].join(' '));
      });
      if (S.view === 'produtos') render();
      return cat;
    } catch (e) {
      console.error('Catálogo indisponível', e);
      cat = null; catP = null; catErro = true;
      if (S.view === 'produtos') render();
      return null;
    }
  })());

  /* ---------------- ao vivo ---------------- */
  function aoMudarPedidos() {
    const lista = DB.pedidos.list();
    const novos = lista.filter(p => !conhecidos.has(p.id));
    lista.forEach(p => conhecidos.add(p.id));
    if (!suprimirAlerta && novos.length && novos.length <= 5) {
      novos.forEach(p => { destacados.add(p.id); alertaNovoPedido(p); setTimeout(() => destacados.delete(p.id), 90000); });
    }
    contadores();
    if (['visao', 'pedidos', 'separacao', 'lojistas'].includes(S.view)) render();
    if (S.aberto) renderGaveta();
  }

  function contadores() {
    const ped = DB.pedidos.list();
    const pix = ped.filter(p => p.status === 'aguardando_pagamento').length; // todos os métodos: o selo se chama "A receber"
    const sep = ped.filter(p => p.status === 'pago' || p.status === 'separando').length;
    const pend = DB.lojistas.list().filter(l => l.status === 'pendente').length;
    const set = (id, n) => { const el = $(id); if (!el) return; el.hidden = !n; el.textContent = n; };
    set('#cont-pix', pix); set('#cont-pix-m', pix); set('#cont-sep', sep); set('#cont-loj', pend); set('#cont-loj-m', pend);
    const temEx = ped.some(p => p.exemplo) || DB.lojistas.list().some(l => l.exemplo);
    $('#selo-exemplo').hidden = !temEx;
  }

  /* ---------------- rotas ---------------- */
  const TITULOS = { visao: 'Visão geral', pedidos: 'Pedidos', separacao: 'Separação', lojistas: 'Lojistas', produtos: 'Produtos', config: 'Configurações' };
  function rota() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    const v = TITULOS[h[0]] ? h[0] : 'visao';
    const mudou = v !== S.view;
    S.view = v;
    $$('[data-nav]').forEach(a => { const at = a.dataset.nav === v; a.classList.toggle('ativo', at); if (at) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('#titulo').textContent = TITULOS[v];
    document.title = tituloOrig = `${TITULOS[v]} • Painel Street`;
    const menuEstavaAberto = $('#sidebar').classList.contains('aberto');
    fecharMenu(false);
    contadores();
    render();
    if (mudou) { window.scrollTo(0, 0); }
    if (menuEstavaAberto) $('#view').focus({ preventScroll: true }); // o link clicado sumiu junto com o menu
    if (h[1] && v === 'pedidos') abrirPedido(decodeURIComponent(h[1]));
  }

  const VIEWS = {};
  function render() {
    const a = document.activeElement;
    const foco = a && a.id && $('#view').contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
    const y = window.scrollY;
    $('#view').innerHTML = VIEWS[S.view]();
    if (VIEWS[S.view].depois) VIEWS[S.view].depois();
    if (foco) { const el = document.getElementById(foco.id); if (el) { el.focus(); try { if (foco.s != null) el.setSelectionRange(foco.s, foco.e); } catch { /* select */ } } }
    window.scrollTo(0, y);
  }

  /* ================= VISÃO GERAL ================= */
  let serie14 = [];
  VIEWS.visao = () => {
    const ped = DB.pedidos.list();
    const agora = new Date();
    const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const doMes = ped.filter(p => new Date(p.criadoEm) >= iniMes && p.status !== 'cancelado');
    const fat = doMes.filter(p => FATURADO.has(p.status));
    const fatTot = fat.reduce((s, p) => s + totalDe(p), 0);
    const aguard = ped.filter(p => p.status === 'aguardando_pagamento');
    const aguardTot = aguard.reduce((s, p) => s + totalDe(p), 0);
    const aguardPix = aguard.filter(ehPix).length;
    const mesNome = agora.toLocaleDateString('pt-BR', { month: 'long' });

    // série 14 dias (faturado por dia de criação)
    const hoje0 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    serie14 = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(hoje0); d.setDate(d.getDate() - (13 - i));
      return { d, valor: 0, n: 0 };
    });
    ped.forEach(p => {
      if (!FATURADO.has(p.status)) return;
      const c = new Date(p.criadoEm); const k = new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime();
      const s = serie14.find(x => x.d.getTime() === k); if (s) { s.valor += totalDe(p); s.n++; }
    });
    const tot14 = serie14.reduce((s, x) => s + x.valor, 0);
    const ped14 = serie14.reduce((s, x) => s + x.n, 0);

    // top produtos (mês, sem cancelados)
    const prods = new Map();
    doMes.forEach(p => (p.itens || []).forEach(it => {
      const k = String(it.pid);
      const o = prods.get(k) || { nome: it.nome, marca: it.marca, img: it.img, qtd: 0, valor: 0 };
      o.qtd += Number(it.qtd) || 0; o.valor += precoUnit(p, it) * (Number(it.qtd) || 0); prods.set(k, o);
    }));
    const topProd = [...prods.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 10);

    // top lojistas (mês, faturado)
    const ljs = new Map();
    fat.forEach(p => { const l = loj(p); const k = dig(l.cnpj) || l.razao;
      const o = ljs.get(k) || { razao: l.razao || l.nome, cidade: l.cidade, uf: l.uf, n: 0, valor: 0 };
      o.n++; o.valor += totalDe(p); ljs.set(k, o); });
    const topLoj = [...ljs.values()].sort((a, b) => b.valor - a.valor).slice(0, 6);

    // por UF / cidade (mês, sem cancelados)
    const ufs = new Map(), cids = new Map();
    doMes.forEach(p => { const l = loj(p); const uf = l.uf || '—'; const cid = (l.cidade || 'Sem cidade') + (l.uf ? '/' + l.uf : '');
      const u = ufs.get(uf) || { n: 0, valor: 0 }; u.n++; u.valor += totalDe(p); ufs.set(uf, u);
      const c = cids.get(cid) || { n: 0, valor: 0 }; c.n++; c.valor += totalDe(p); cids.set(cid, c); });
    const cidOrd = [...cids.entries()].sort((a, b) => b[1].valor - a[1].valor).slice(0, 7);
    const maxCid = Math.max(1, ...cidOrd.map(c => c[1].valor));

    const recentes = ped.slice(0, 5);

    return `
    <div class="pilha">
      ${ped.some(p => p.exemplo) ? `<div class="aviso">${ico('sino')}<p><strong>Dados de exemplo.</strong> Os números abaixo são de pedidos fictícios para demonstração. Faça um pedido na <a href="index.html" target="_blank" rel="noopener"><strong>loja</strong></a> em outra aba e veja ele chegar aqui na hora.</p></div>` : ''}
      <div class="kpis">
        <div class="kpi"><span class="rot">Faturamento de ${esc(mesNome)}</span><span class="val mono">${brl(fatTot)}</span><span class="det">${fat.length} pedido${fat.length === 1 ? '' : 's'} pago${fat.length === 1 ? '' : 's'}</span></div>
        <div class="kpi"><span class="rot">Pedidos no mês</span><span class="val mono">${num(doMes.length)}</span><span class="det">sem contar cancelados</span></div>
        <div class="kpi"><span class="rot">Ticket médio</span><span class="val mono">${brl(fat.length ? fatTot / fat.length : 0)}</span><span class="det">por pedido pago</span></div>
        <a class="kpi kpi-pix" href="#/pedidos" data-aba="aguardando_pagamento"><span class="rot">A receber</span><span class="val mono">${num(aguard.length)}</span><span class="det">${brl(aguardTot)}${aguard.length ? ` • ${aguardPix === aguard.length ? 'todos no Pix' : `${aguardPix} no Pix`}` : ''} →</span></a>
      </div>

      <section class="card">
        <div class="card-tit"><h2>Faturamento — últimos 14 dias</h2><span class="sub">pedidos pagos, por dia do pedido</span></div>
        <div class="grafico" id="grafico" role="img" aria-label="Faturamento dos últimos 14 dias: total ${esc(brl(tot14))} em ${ped14} pedidos"></div>
        <div class="resumo-graf"><span>Total: <b class="mono">${brl(tot14)}</b></span><span>Pedidos pagos: <b>${ped14}</b></span><span>Média por dia: <b class="mono">${brl(tot14 / 14)}</b></span></div>
      </section>

      <div class="grade g2">
        <section class="card">
          <div class="card-tit"><h2>Mais pedidos</h2><span class="sub">top 10 por quantidade no mês</span></div>
          ${topProd.length ? `<ol class="rank">${topProd.map((p, i) => `
            <li><span class="pos">${i + 1}</span>${thumb(p.img, 48)}<span class="nm">${esc(p.nome)}<small>${esc(p.marca || '')}</small></span>
            <span class="q mono">${num(p.qtd)} un.<small>${brl(p.valor)}</small></span></li>`).join('')}</ol>` : vazio('Sem vendas no mês ainda')}
        </section>
        <div class="pilha">
          <section class="card">
            <div class="card-tit"><h2>Melhores lojistas</h2><span class="sub">por valor pago no mês</span></div>
            ${topLoj.length ? `<ol class="rank sem-img">${topLoj.map((l, i) => `
              <li><span class="pos">${i + 1}</span><span class="nm">${esc(l.razao)}<small>${esc(l.cidade || '')}${l.uf ? '/' + esc(l.uf) : ''} • ${l.n} pedido${l.n === 1 ? '' : 's'}</small></span>
              <span class="q mono">${brl(l.valor)}</span></li>`).join('')}</ol>` : vazio('Nenhum pedido pago no mês')}
          </section>
          <section class="card">
            <div class="card-tit"><h2>Para onde vai</h2><span class="sub">pedidos do mês por estado e cidade</span></div>
            <div class="ufs">${[...ufs.entries()].sort((a, b) => b[1].n - a[1].n).map(([u, o]) => `<span class="uf">${esc(u)}<b>${o.n}</b></span>`).join('') || ''}</div>
            <div class="barras-h">${cidOrd.map(([c, o]) => `
              <div class="linha"><div class="top"><b>${esc(c)}</b><span class="mono">${o.n} ped. • ${brl(o.valor)}</span></div>
              <div class="trilho"><div class="enche" style="width:${Math.max(4, (o.valor / maxCid) * 100).toFixed(1)}%"></div></div></div>`).join('') || vazio('Sem pedidos no mês')}</div>
          </section>
        </div>
      </div>

      <section class="card">
        <div class="card-tit"><h2>Últimos pedidos</h2><a class="btn btn-sec btn-peq dir" href="#/pedidos">Ver todos</a></div>
        ${tabelaPedidos(recentes)}
      </section>
    </div>`;
  };
  VIEWS.visao.depois = () => desenharGrafico();

  function desenharGrafico() {
    const box = $('#grafico'); if (!box) return;
    const W = Math.max(300, Math.round(box.clientWidth || 640));
    const H = W < 520 ? 220 : 260;
    const m = { t: 16, r: W < 520 ? 18 : 10, b: 30, l: W < 520 ? 50 : 70 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(...serie14.map(x => x.valor), 1);
    const passo = (() => { const bruto = max / 3; const p10 = Math.pow(10, Math.floor(Math.log10(bruto))); return [1, 2, 2.5, 5, 10].map(k => k * p10).find(k => k >= bruto) || bruto; })();
    const topo = passo * Math.ceil(max / passo);
    const y = v => m.t + ih - (v / topo) * ih;
    const col = iw / 14, bw = Math.min(36, col * 0.62);
    const rs = W < 520 ? '' : 'R$ ';
    const compacto = v => (v >= 1000 ? rs + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : rs + Math.round(v));
    let g = '';
    for (let v = 0; v <= topo + 0.01; v += passo) {
      g += `<line class="${v === 0 ? 'base-l' : 'grade-l'}" x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
      g += `<text class="eixo" x="${m.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${compacto(v)}</text>`;
    }
    const hojeK = serie14[13].d.getTime();
    serie14.forEach((s, i) => {
      const cx = m.l + col * i + col / 2;
      const h = s.valor > 0 ? Math.max(3, ih - (y(s.valor) - m.t)) : 0;
      const x0 = cx - bw / 2, yb = m.t + ih, rr = Math.min(4, bw / 2, h);
      const path = h ? `M${x0},${yb} V${yb - h + rr} Q${x0},${yb - h} ${x0 + rr},${yb - h} H${x0 + bw - rr} Q${x0 + bw},${yb - h} ${x0 + bw},${yb - h + rr} V${yb} Z` : '';
      const rot = s.d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const mostra = W >= 640 || (W >= 440 ? i % 2 === 1 : i % 3 === 1);
      g += `<g class="col" tabindex="0" data-i="${i}" aria-label="${rot}: ${brl(s.valor)}, ${s.n} pedidos">
        <rect class="alvo" x="${m.l + col * i}" y="${m.t}" width="${col}" height="${ih}"/>
        ${path ? `<path class="barra${s.d.getTime() === hojeK ? ' hoje' : ''}" d="${path}"/>` : ''}
        ${mostra ? `<text class="eixo-x" x="${cx}" y="${H - 8}" text-anchor="middle">${s.d.getTime() === hojeK ? 'Hoje' : rot}</text>` : ''}
      </g>`;
    });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${g}</svg><div class="dica" hidden></div>`;
    const dica = box.querySelector('.dica');
    const mostrar = el => {
      const s = serie14[+el.dataset.i];
      const cx = m.l + col * (+el.dataset.i) + col / 2;
      dica.innerHTML = `${s.d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}<br><b>${brl(s.valor)}</b> • ${s.n} pedido${s.n === 1 ? '' : 's'}`;
      dica.hidden = false;
      const px = Math.min(Math.max(cx, 90), W - 90);
      dica.style.left = px + 'px'; dica.style.top = Math.min(y(s.valor), m.t + ih - 10) + 'px';
    };
    box.querySelectorAll('.col').forEach(el => {
      el.addEventListener('pointerenter', () => mostrar(el));
      el.addEventListener('focus', () => mostrar(el));
      el.addEventListener('pointerleave', () => { dica.hidden = true; });
      el.addEventListener('blur', () => { dica.hidden = true; });
    });
  }

  const vazio = (t, s = '') => `<div class="vazio"><strong>${esc(t)}</strong>${esc(s)}</div>`;

  /* ================= PEDIDOS ================= */
  function tabelaPedidos(lista) {
    if (!lista.length) return vazio('Nenhum pedido aqui', 'Quando a loja receber um pedido ele aparece nesta lista na hora.');
    return `<div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Pedido</th><th>Data</th><th>Lojista</th><th>Cidade</th><th class="num">Itens</th><th class="num">Total</th><th>Pagamento</th><th>Status</th></tr></thead>
      <tbody>${lista.map(p => { const l = loj(p); return `
        <tr class="clicavel${destacados.has(p.id) ? ' novo' : ''}" tabindex="0" data-pedido="${esc(p.id)}">
          <td class="id cab-cel">${esc(p.id)}${destacados.has(p.id) ? ' <span class="etq etq-dest">Novo</span>' : ''}<span class="so-cel">${stPill(p.status, p)}</span></td>
          <td data-l="Data" class="mono nowrap">${dataHora(p.criadoEm)}</td>
          <td data-l="Lojista" class="bloco-cel"><span class="forte">${esc(l.razao || l.nome || '—')}</span><span class="sub mono">${esc(fmtCnpj(l.cnpj))}</span></td>
          <td data-l="Cidade">${esc(l.cidade || '—')}${l.uf ? '/' + esc(l.uf) : ''}</td>
          <td data-l="Itens" class="num mono"><span>${num(qtdItens(p))} un.<span class="sub">${(p.itens || []).length} produto${(p.itens || []).length === 1 ? '' : 's'}</span></span></td>
          <td data-l="Total" class="num mono forte">${brl(totalDe(p))}</td>
          <td data-l="Pagamento">${esc(metodoNome(p.pagamento && p.pagamento.metodo))}</td>
          <td data-l="Status" class="so-desk">${stPill(p.status, p)}</td>
        </tr>`; }).join('')}</tbody></table></div>`;
  }

  VIEWS.pedidos = () => {
    const todos = DB.pedidos.list();
    const abas = [['todos', 'Todos'], ...Object.keys(DB.STATUS).map(k => [k, nomeAba(k)])];
    const cont = k => (k === 'todos' ? todos.length : todos.filter(p => p.status === k).length);
    const q = norm(S.busca), qd = dig(S.busca);
    const lista = todos.filter(p => (S.aba === 'todos' || p.status === S.aba) && (!q || (() => {
      const l = loj(p);
      return norm(p.id).includes(q) || norm(l.razao).includes(q) || norm(l.nome).includes(q) || norm(l.cidade).includes(q) || (qd.length >= 3 && dig(l.cnpj).includes(qd));
    })()));
    return `
      <div class="abas" role="tablist" aria-label="Filtrar por status">${abas.map(([k, n]) => `
        <button class="aba${S.aba === k ? ' ativo' : ''}" role="tab" aria-selected="${S.aba === k}" data-aba-ped="${k}">${esc(n)} <span class="n">${cont(k)}</span></button>`).join('')}</div>
      <div class="barra-acoes">
        <label class="busca" style="flex:1 1 320px"><span class="sr">Buscar pedido</span>${ico('busca')}
          <input id="busca-ped" class="inp" type="search" placeholder="Buscar por nº do pedido, lojista ou CNPJ" value="${esc(S.busca)}" autocomplete="off"></label>
        <span class="contagem dir">${lista.length} pedido${lista.length === 1 ? '' : 's'} • ${brl(lista.reduce((s, p) => s + totalDe(p), 0))}</span>
      </div>
      ${tabelaPedidos(lista)}`;
  };

  /* ---------- gaveta do pedido ---------- */
  function abrirPedido(id) {
    if (!DB.pedidos.get(id)) { toast('Pedido não encontrado', 'x'); return; }
    S.aberto = id;
    $('#gaveta').hidden = false; $('#gaveta-fundo').hidden = false;
    document.body.style.overflow = 'hidden';
    renderGaveta(true);
  }
  function fecharGaveta() {
    if (!S.aberto) return;
    const id = S.aberto; S.aberto = null;
    $('#gaveta').hidden = true; $('#gaveta-fundo').hidden = true; document.body.style.overflow = '';
    if (/^#\/pedidos\//.test(location.hash)) history.replaceState(null, '', '#/pedidos');
    const linha = document.querySelector(`[data-pedido="${CSS.escape(id)}"]`); if (linha) linha.focus();
  }

  function renderGaveta(focar) {
    const p = DB.pedidos.get(S.aberto); const g = $('#gaveta');
    if (!p) { fecharGaveta(); return; }
    const corpoAnt = g.querySelector('.gav-corpo'); const sc = corpoAnt ? corpoAnt.scrollTop : 0;
    const l = loj(p); const pg = p.pagamento || {}; const ent = p.entrega || {};
    const rasc = S.rascunho[p.id] || {};
    const subtotal = Number(p.subtotal) || (p.itens || []).reduce((s, it) => s + precoUnit(p, it) * it.qtd, 0);
    const msgLoj = `Olá${l.nome ? ', ' + l.nome : ''}! Aqui é da ${C.nome}, sobre o pedido ${p.id} (${brl(totalDe(p))}).`;
    const endereco = ent.endereco ? (typeof ent.endereco === 'string' ? ent.endereco
      : [ent.endereco.rua || ent.endereco.logradouro, ent.endereco.numero, ent.endereco.complemento, ent.endereco.bairro, ent.endereco.cidade, ent.endereco.uf, ent.endereco.cep].filter(Boolean).join(', ')) : '';
    const opEnt = (C.entrega || []).find(e => e.id === ent.tipo) || {};

    let acoes = '';
    const cancelar = `<button class="btn btn-perigo btn-peq" data-act="cancelar">Cancelar pedido</button>`;
    const imprimir = `<button class="btn btn-sec btn-peq" data-act="imprimir-um">${ico('print')} Lista de separação</button>`;
    if (p.status === 'aguardando_pagamento') {
      const cobranca = `Olá${l.nome ? ', ' + l.nome : ''}! Seu pedido ${p.id} na ${C.nome} ficou em ${brl(totalDe(p))}. ` +
        (pg.metodo === 'pix' ? `Assim que o Pix cair a gente já começa a separar. Chave Pix: ${C.pix.chave}` : 'Assim que o pagamento for confirmado a gente começa a separar.');
      acoes = `<p class="prox">Próximo passo: conferir se o ${pg.metodo === 'pix' ? 'Pix' : 'pagamento'} caiu na conta.</p>
        <button class="btn btn-verde btn-grande" data-act="st" data-st="pago">${ico(pg.metodo === 'pix' ? 'pix' : 'ok')} Confirmar ${pg.metodo === 'pix' ? 'Pix recebido' : 'pagamento recebido'}</button>
        <div class="linha">${l.whatsapp ? `<a class="btn btn-zap btn-peq" target="_blank" rel="noopener" href="${esc(waLink(l.whatsapp, cobranca))}">${ico('zap')} Cobrar no WhatsApp</a>` : ''}${cancelar}</div>`;
    } else if (p.status === 'pago') {
      acoes = `<p class="prox">Próximo passo: separar os produtos no galpão.</p>
        <button class="btn btn-pri btn-grande" data-act="st" data-st="separando">${ico('sep')} Iniciar separação</button>
        <div class="linha">${imprimir}${cancelar}</div>`;
    } else if (p.status === 'separando') {
      acoes = `<p class="prox">Próximo passo: despachar ou liberar para retirada.</p>
        <label class="campo"><span>Código de rastreio ou forma de envio</span>
          <input id="rastreio" type="text" placeholder="Ex.: AB123456789BR, Uber Flash, retirado no balcão" value="${esc(rasc.rastreio || '')}"></label>
        <label class="campo"><span>Observação para o lojista (opcional)</span>
          <textarea id="obs-envio" placeholder="Ex.: saiu às 15h com o motoboy">${esc(rasc.obs || '')}</textarea></label>
        <button class="btn btn-preto btn-grande" data-act="enviar">${ico('caminhao')} Marcar como enviado</button>
        <div class="linha">${imprimir}${cancelar}</div>`;
    } else if (p.status === 'enviado') {
      acoes = `<p class="prox">Próximo passo: confirmar que o lojista recebeu.</p>
        <button class="btn btn-verde btn-grande" data-act="st" data-st="entregue">${ico('ok')} Marcar como entregue</button>`;
    } else if (p.status === 'cancelado') {
      acoes = `<p class="prox">Pedido cancelado${p.motivoCancelamento ? ': ' + esc(p.motivoCancelamento) : '.'}</p>`;
    } else {
      acoes = `<p class="prox">Pedido concluído. ${ico('ok')}</p>`;
    }

    const hist = p.historico || [];
    const quando = s => { const h = [...hist].reverse().find(x => x.status === s); return h ? dataHora(h.em) : ''; };
    const passos = p.status === 'cancelado'
      ? [...hist.filter(h => h.status !== 'cancelado').map(h => h.status), 'cancelado']
      : FLUXO;
    const idxAtual = FLUXO.indexOf(p.status);

    g.innerHTML = `
      <div class="gav-topo">
        <div><h2 class="tit" id="gaveta-tit">Pedido ${esc(p.id)}</h2>
          <div class="quando">${stPill(p.status, p)}<span>${dataHora(p.criadoEm)}</span>${p.exemplo ? '<span class="etq etq-alt">Exemplo</span>' : ''}</div></div>
        <button class="btn-ico" data-act="gaveta-fechar" aria-label="Fechar pedido">${ico('x')}</button>
      </div>
      <div class="gav-corpo">
        <div class="gav-acoes">${acoes}</div>

        <section class="bloco"><h3>Lojista</h3>
          <dl class="dados">
            <dt>Empresa</dt><dd>${esc(l.razao || '—')}</dd>
            ${l.nome ? `<dt>Contato</dt><dd>${esc(l.nome)}</dd>` : ''}
            <dt>CNPJ</dt><dd class="mono">${esc(fmtCnpj(l.cnpj))}</dd>
            <dt>Cidade</dt><dd>${esc(l.cidade || '—')}${l.uf ? '/' + esc(l.uf) : ''}</dd>
            ${l.email ? `<dt>E-mail</dt><dd>${esc(l.email)}</dd>` : ''}
            <dt>WhatsApp</dt><dd class="mono">${esc(fmtFone(l.whatsapp))}</dd>
          </dl>
          ${l.whatsapp ? `<div style="margin-top:12px"><a class="btn btn-zap btn-bloco" target="_blank" rel="noopener" href="${esc(waLink(l.whatsapp, msgLoj))}">${ico('zap')} Chamar no WhatsApp</a></div>` : ''}
        </section>

        <section class="bloco"><h3>Itens (${(p.itens || []).length} produto${(p.itens || []).length === 1 ? '' : 's'} • ${num(qtdItens(p))} un.)</h3>
          <ul class="itens">${(p.itens || []).map(it => { const u = precoUnit(p, it); return `
            <li>${thumb(it.img, 56)}
              <div><div class="nm">${esc(it.nome)}</div>
                <div class="meta">${it.variante ? esc(it.variante) + ' • ' : ''}SKU <span class="mono">${esc(it.sku || '—')}</span>${it.por ? ` • display c/ ${esc(it.por)}` : ''}</div></div>
              <div class="vl mono"><span>${num(it.qtd)} × ${brl(u)}</span><b>${brl(r2(u * it.qtd))}</b></div>
            </li>`; }).join('')}</ul>
          <div class="totais">
            <div><span>Subtotal${pg.metodo === 'pix' ? ' (preço Pix)' : ''}</span><span class="mono">${brl(subtotal)}</span></div>
            <div><span>Entrega</span><span>${ent.valor == null ? 'A combinar' : ent.valor === 0 ? 'Grátis' : brl(ent.valor)}</span></div>
            ${p.desconto ? `<div><span>Desconto</span><span class="mono">− ${brl(p.desconto)}</span></div>` : ''}
            <div class="total"><span>Total</span><span class="mono">${brl(totalDe(p))}</span></div>
          </div>
        </section>

        <div class="grade g2">
          <section class="bloco"><h3>Entrega</h3>
            <dl class="dados">
              <dt>Forma</dt><dd>${esc(ent.nome || opEnt.nome || '—')}</dd>
              ${opEnt.prazo ? `<dt>Prazo</dt><dd>${esc(opEnt.prazo)}</dd>` : ''}
              ${endereco ? `<dt>Endereço</dt><dd>${esc(endereco)}</dd>` : ''}
              ${p.rastreio ? `<dt>Rastreio</dt><dd class="mono">${esc(p.rastreio)}</dd>` : ''}
              ${p.obsEnvio ? `<dt>Obs. envio</dt><dd>${esc(p.obsEnvio)}</dd>` : ''}
            </dl>
          </section>
          <section class="bloco"><h3>Pagamento</h3>
            <dl class="dados">
              <dt>Forma</dt><dd>${esc(metodoNome(pg.metodo))}</dd>
              ${pg.txid ? `<dt>TXID</dt><dd class="mono">${esc(pg.txid)}</dd>` : ''}
              ${pg.parcelas ? `<dt>Parcelas</dt><dd>${esc(pg.parcelas)}x</dd>` : ''}
            </dl>
            ${pg.copiaECola ? `<div class="copia"><code>${esc(pg.copiaECola)}</code><button class="btn-ico" data-act="copiar" data-txt="${esc(pg.copiaECola)}" aria-label="Copiar Pix copia e cola">${ico('copiar')}</button></div>` : ''}
          </section>
        </div>

        ${p.obs ? `<section class="bloco"><h3>Observação do lojista</h3><p style="margin:0">${esc(p.obs)}</p></section>` : ''}

        <section class="bloco"><h3>Linha do tempo</h3>
          <ol class="linha-tempo">${passos.map(s => {
            const feito = p.status === 'cancelado' ? true : FLUXO.indexOf(s) <= idxAtual;
            const cls = s === 'cancelado' ? 'feito cancel' : feito ? 'feito' : 'pend';
            const extra = s === 'enviado' && p.rastreio ? ` • ${esc(p.rastreio)}` : '';
            return `<li class="${cls}"><span class="pt">${feito ? ico(s === 'cancelado' ? 'x' : 'ok') : ''}</span>
              <div><div class="nm">${esc(stNome(s, p))}</div><div class="em">${quando(s) || (feito ? '' : 'pendente')}${extra}</div></div></li>`;
          }).join('')}</ol>
        </section>
      </div>`;
    const corpo = g.querySelector('.gav-corpo'); corpo.scrollTop = focar ? 0 : sc;
    const r = g.querySelector('#rastreio'), o = g.querySelector('#obs-envio');
    const salvaRasc = () => { S.rascunho[p.id] = { rastreio: r.value, obs: o.value }; };
    if (r) { r.addEventListener('input', salvaRasc); o.addEventListener('input', salvaRasc); }
    if (focar) g.querySelector('[data-act="gaveta-fechar"]').focus();
  }

  async function mudarStatus(st) {
    const p = DB.pedidos.get(S.aberto); if (!p) return;
    const patch = {};
    if (st === 'enviado') {
      const r = ($('#rastreio') || {}).value || '', o = ($('#obs-envio') || {}).value || '';
      patch.rastreio = r.trim(); patch.obsEnvio = o.trim();
      delete S.rascunho[p.id];
    }
    DB.pedidos.atualizar(p.id, patch, st);
    const msgs = { pago: `${p.id}: pagamento confirmado`, separando: `${p.id}: separação iniciada`, enviado: `${p.id}: marcado como enviado`, entregue: `${p.id}: entregue`, cancelado: `${p.id}: cancelado` };
    toast(msgs[st] || 'Pedido atualizado');
  }

  /* ================= SEPARAÇÃO ================= */
  const paraSeparar = () => DB.pedidos.list().filter(p => p.status === 'pago' || p.status === 'separando')
    .sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : 1));

  function consolidado(lista) {
    const m = new Map();
    lista.forEach(p => (p.itens || []).forEach(it => {
      const k = it.sku || `${it.pid}:${it.vid}`;
      const o = m.get(k) || { sku: it.sku || '—', nome: it.nome, variante: it.variante, img: it.img, qtd: 0, pedidos: [] };
      o.qtd += Number(it.qtd) || 0; if (!o.pedidos.includes(p.id)) o.pedidos.push(p.id); m.set(k, o);
    }));
    return [...m.values()].sort((a, b) => String(a.sku).localeCompare(String(b.sku), 'pt-BR', { numeric: true }));
  }

  VIEWS.separacao = () => {
    const lista = paraSeparar();
    const abas = `<div class="abas" role="tablist">
      <button class="aba${S.sepModo === 'pedidos' ? ' ativo' : ''}" role="tab" aria-selected="${S.sepModo === 'pedidos'}" data-sep="pedidos">Por pedido <span class="n">${lista.length}</span></button>
      <button class="aba${S.sepModo === 'dia' ? ' ativo' : ''}" role="tab" aria-selected="${S.sepModo === 'dia'}" data-sep="dia">Consolidado do dia</button></div>`;
    if (!lista.length) return abas + `<div class="card">${vazio('Nada para separar agora', 'Pedidos aparecem aqui assim que o pagamento é confirmado.')}</div>`;
    if (S.sepModo === 'dia') {
      const cons = consolidado(lista);
      const tot = cons.reduce((s, x) => s + x.qtd, 0);
      return abas + `
        <div class="barra-acoes"><span class="contagem">${cons.length} SKUs • ${num(tot)} unidades • ${lista.length} pedidos pagos para separar</span>
          <button class="btn btn-preto dir" data-act="imprimir-cons">${ico('print')} Imprimir consolidado</button></div>
        <div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>SKU</th><th>Produto</th><th class="num">Qtd. total</th><th>Pedidos</th></tr></thead>
          <tbody>${cons.map(x => `<tr>
            <td class="cab-cel mono forte">${esc(x.sku)}</td>
            <td data-l="Produto"><div class="prod-mini">${thumb(x.img, 44, 'thumb')}<span><span class="nome-prod">${esc(x.nome)}</span>${x.variante ? `<span class="sub">${esc(x.variante)}</span>` : ''}</span></div></td>
            <td data-l="Qtd. total" class="num mono forte" style="font-size:18px">${num(x.qtd)}</td>
            <td data-l="Pedidos" class="mono">${x.pedidos.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table></div>`;
    }
    return abas + `
      <div class="barra-acoes"><span class="contagem">${lista.length} pedido${lista.length === 1 ? '' : 's'} na fila • mais antigos primeiro</span>
        <button class="btn btn-preto dir" data-act="imprimir-todos">${ico('print')} Imprimir todas as listas</button></div>
      <div class="sep-lista">${lista.map(p => { const l = loj(p); return `
        <article class="sep-item">
          <div><h3>${esc(p.id)} ${stPill(p.status, p)}</h3>
            <p><strong>${esc(l.razao || '—')}</strong> • ${esc(l.cidade || '')}${l.uf ? '/' + esc(l.uf) : ''}</p>
            <p>${(p.itens || []).length} produtos • ${num(qtdItens(p))} un. • ${esc((p.entrega || {}).nome || '')} • pedido em ${dataHora(p.criadoEm)}</p></div>
          <div class="acoes">
            ${p.status === 'pago' ? `<button class="btn btn-pri btn-peq" data-sep-iniciar="${esc(p.id)}">Iniciar separação</button>` : ''}
            <button class="btn btn-sec btn-peq" data-imprimir="${esc(p.id)}">${ico('print')} Imprimir lista</button>
            <button class="btn btn-sec btn-peq" data-pedido="${esc(p.id)}">Abrir</button>
          </div>
        </article>`; }).join('')}</div>`;
  };

  /* ---------- impressão ---------- */
  function folhaPedido(p) {
    const l = loj(p); const ent = p.entrega || {}; const pg = p.pagamento || {};
    const itens = [...(p.itens || [])].sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || ''), 'pt-BR', { numeric: true }));
    return `<section class="folha">
      <div class="folha-cab"><img src="assets/img/logo-street.png" alt="Street"><h1>Lista de separação</h1>
        <div class="id">${esc(p.id)}<small>Pedido em ${dataHora(p.criadoEm)} • ${esc(stNome(p.status, p))}</small></div></div>
      <div class="folha-dados">
        <div><b>Lojista</b>${esc(l.razao || '—')}</div><div><b>CNPJ</b>${esc(fmtCnpj(l.cnpj))}</div>
        <div><b>Cidade</b>${esc(l.cidade || '—')}${l.uf ? '/' + esc(l.uf) : ''}</div><div><b>WhatsApp</b>${esc(fmtFone(l.whatsapp))}</div>
        <div><b>Entrega</b>${esc(ent.nome || '—')}</div><div><b>Pagamento</b>${esc(metodoNome(pg.metodo))} • ${brl(totalDe(p))}</div>
      </div>
      <table><thead><tr><th style="width:28px"></th><th>SKU</th><th>Produto</th><th>Variante</th><th style="text-align:center">Qtd.</th><th style="text-align:center">Conferido</th></tr></thead>
      <tbody>${itens.map(it => `<tr><td><span class="cx"></span></td><td class="sku">${esc(it.sku || '—')}</td><td>${esc(it.nome)}</td><td>${esc(it.variante || '—')}</td>
        <td class="q">${num(it.qtd)}</td><td style="text-align:center"><span class="cx"></span></td></tr>`).join('')}</tbody></table>
      <div class="folha-tot">${itens.length} produtos • ${num(qtdItens(p))} unidades</div>
      ${p.obs ? `<div class="folha-obs"><b>Obs. do lojista:</b> ${esc(p.obs)}</div>` : ''}
      <div class="folha-pe"><div>Separado por</div><div>Conferido por</div><div>Data / hora</div></div>
    </section>`;
  }
  function folhaConsolidado(lista) {
    const cons = consolidado(lista);
    return `<section class="folha">
      <div class="folha-cab"><img src="assets/img/logo-street.png" alt="Street"><h1>Consolidado do dia</h1>
        <div class="id">${new Date().toLocaleDateString('pt-BR')}<small>${lista.length} pedidos • ${num(cons.reduce((s, x) => s + x.qtd, 0))} unidades</small></div></div>
      <table><thead><tr><th style="width:28px"></th><th>SKU</th><th>Produto</th><th>Variante</th><th style="text-align:center">Qtd.</th><th>Pedidos</th></tr></thead>
      <tbody>${cons.map(x => `<tr><td><span class="cx"></span></td><td class="sku">${esc(x.sku)}</td><td>${esc(x.nome)}</td><td>${esc(x.variante || '—')}</td>
        <td class="q">${num(x.qtd)}</td><td style="font-size:9.5pt">${x.pedidos.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table>
      <div class="folha-pe"><div>Separado por</div><div>Conferido por</div><div>Data / hora</div></div>
    </section>`;
  }
  function imprimir(html) {
    $('#print-area').innerHTML = html;
    document.body.classList.add('imprimindo');
    const fim = () => { document.body.classList.remove('imprimindo'); window.removeEventListener('afterprint', fim); };
    window.addEventListener('afterprint', fim);
    // espera as imagens (logo) carregarem antes de abrir a impressão
    const imgs = $$('#print-area img').filter(i => !i.complete);
    Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 50));
  }

  /* ================= LOJISTAS ================= */
  function statsLojistas() {
    const m = new Map();
    DB.pedidos.list().forEach(p => {
      if (p.status === 'cancelado') return;
      const k = dig(loj(p).cnpj); if (!k) return;
      const o = m.get(k) || { n: 0, valor: 0, ultimo: null };
      o.n++; o.valor += totalDe(p); if (!o.ultimo || p.criadoEm > o.ultimo) o.ultimo = p.criadoEm; m.set(k, o);
    });
    return m;
  }
  VIEWS.lojistas = () => {
    const todos = DB.lojistas.list();
    const st = statsLojistas();
    const pend = todos.filter(l => l.status === 'pendente');
    const q = norm(S.lojBusca), qd = dig(S.lojBusca);
    const resto = todos.filter(l => l.status !== 'pendente')
      .filter(l => !q || norm(l.razao).includes(q) || norm(l.nome).includes(q) || norm(l.cidade).includes(q) || (qd.length >= 3 && dig(l.cnpj).includes(qd)))
      .map(l => ({ l, s: st.get(dig(l.cnpj)) || { n: 0, valor: 0, ultimo: null } }))
      .sort((a, b) => (a.l.status === 'recusado') - (b.l.status === 'recusado') || b.s.valor - a.s.valor);
    const msg = l => `Olá${l.nome ? ', ' + l.nome : ''}! Aqui é da ${C.nome}.`;
    return `<div class="pilha">
      <section>
        <div class="card-tit"><h2>Cadastros para aprovar</h2><span class="sub">${pend.length ? `${pend.length} aguardando` : 'nenhum pendente'}</span></div>
        ${pend.length ? `<div class="pendentes">${pend.map(l => `
          <article class="pend">
            <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between"><h3>${esc(l.razao || '—')}</h3>${stPillLoj('pendente')}</div>
            <dl><dt>CNPJ</dt><dd class="mono">${esc(fmtCnpj(l.cnpj))}</dd>
              <dt>Contato</dt><dd>${esc(l.nome || '—')}</dd>
              <dt>Cidade</dt><dd>${esc(l.cidade || '—')}${l.uf ? '/' + esc(l.uf) : ''}</dd>
              <dt>WhatsApp</dt><dd class="mono">${esc(fmtFone(l.whatsapp))}</dd>
              ${l.email ? `<dt>E-mail</dt><dd>${esc(l.email)}</dd>` : ''}
              ${l.criadoEm ? `<dt>Cadastro</dt><dd>${dataCurta(l.criadoEm)}</dd>` : ''}</dl>
            <div class="acoes">
              <button class="btn btn-verde btn-peq" data-loj-aprovar="${esc(l.cnpj)}">${ico('ok')} Aprovar</button>
              <button class="btn btn-perigo btn-peq" data-loj-recusar="${esc(l.cnpj)}">Recusar</button>
              ${l.whatsapp ? `<a class="btn btn-zap btn-peq" target="_blank" rel="noopener" href="${esc(waLink(l.whatsapp, msg(l)))}" aria-label="WhatsApp de ${esc(l.razao)}">${ico('zap')}</a>` : ''}
            </div>
          </article>`).join('')}</div>` : `<div class="card">${vazio('Tudo em dia', 'Novos cadastros feitos na loja aparecem aqui para aprovação.')}</div>`}
      </section>
      <section>
        <div class="card-tit"><h2>Lojistas</h2><span class="sub">${todos.length - pend.length} cadastrados</span></div>
        <div class="barra-acoes"><label class="busca" style="flex:1 1 320px"><span class="sr">Buscar lojista</span>${ico('busca')}
          <input id="busca-loj" class="inp" type="search" placeholder="Buscar por nome, cidade ou CNPJ" value="${esc(S.lojBusca)}" autocomplete="off"></label></div>
        ${resto.length ? `<div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>Lojista</th><th>Cidade</th><th>Status</th><th class="num">Pedidos</th><th class="num">Total comprado</th><th>Último pedido</th><th>Boleto a prazo</th><th></th></tr></thead>
          <tbody>${resto.map(({ l, s }) => `<tr>
            <td class="cab-cel"><span><span class="forte">${esc(l.razao || '—')}</span><span class="sub"><span class="mono nowrap">${esc(fmtCnpj(l.cnpj))}</span>${l.nome ? ' • ' + esc(l.nome) : ''}</span></span></td>
            <td data-l="Cidade">${esc(l.cidade || '—')}${l.uf ? '/' + esc(l.uf) : ''}</td>
            <td data-l="Status">${stPillLoj(l.status)}</td>
            <td data-l="Pedidos" class="num mono">${s.n}</td>
            <td data-l="Total comprado" class="num mono forte">${brl(s.valor)}</td>
            <td data-l="Último pedido" class="mono">${s.ultimo ? dataCurta(s.ultimo) : '—'}</td>
            <td data-l="Boleto a prazo">${l.status === 'aprovado' ? `<label class="chave"><input type="checkbox" data-loj-boleto="${esc(l.cnpj)}" ${l.boleto ? 'checked' : ''}><span class="tr"></span><span>${l.boleto ? 'Liberado' : 'Não'}</span></label>` : '—'}</td>
            <td data-l="">${l.status === 'recusado' ? `<button class="btn btn-sec btn-peq" data-loj-aprovar="${esc(l.cnpj)}">Aprovar</button>` : ''}
              ${l.whatsapp ? `<a class="btn btn-zap btn-peq" target="_blank" rel="noopener" href="${esc(waLink(l.whatsapp, msg(l)))}">${ico('zap')} WhatsApp</a>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="card">${vazio('Nenhum lojista encontrado')}</div>`}
      </section></div>`;
  };
  const stPillLoj = s => `<span class="st st-${esc(s)}">${esc({ pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' }[s] || s || '—')}</span>`;

  /* ================= PRODUTOS ================= */
  const POR_PAG = 40;
  function filtrarProdutos() {
    if (!cat) return [];
    const { busca, cat: c, marca, disp } = S.prod;
    const termos = norm(busca).split(/\s+/).filter(Boolean);
    const ov = DB.overrides.todos();
    return cat.produtos.filter(p =>
      (!c || p.c === c) && (!marca || p.m === marca) &&
      (!disp || (disp === 'disp' && p.disp && !p.oculto) || (disp === 'esg' && !p.disp) || (disp === 'oculto' && p.oculto) ||
        (disp === 'dest' && p.destaque) || (disp === 'alt' && ov[p.id])) &&
      (!termos.length || termos.every(t => p._q.includes(t))));
  }
  VIEWS.produtos = () => {
    if (!cat) return catErro
      ? `<div class="card">${vazio('Não foi possível carregar o catálogo', 'Confira a conexão e tente de novo.')}<div style="text-align:center;margin-top:12px"><button class="btn btn-preto" data-act="cat-tentar">${ico('desfazer')} Tentar de novo</button></div></div>`
      : `<div class="card">${vazio('Carregando catálogo…')}</div>`;
    const cats = Object.keys(cat.categorias).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const marcas = cat.marcas.map(m => m.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const nAlt = Object.keys(DB.overrides.todos()).length;
    return `
      <div class="aviso" style="margin-bottom:14px">${ico('tag')}<p>Ajuste preço, disponibilidade e destaque. A mudança vale <strong>na hora</strong> para a loja. O preço editado é o de lista/cartão; o Pix é calculado com ${Math.round(C.acrescimoCartao * 100)}% a menos de acréscimo.${nAlt ? ` <strong>${nAlt} produto${nAlt === 1 ? '' : 's'} alterado${nAlt === 1 ? '' : 's'}.</strong>` : ''}</p></div>
      <div class="filtros">
        <label class="busca"><span class="sr">Buscar produto</span>${ico('busca')}<input id="busca-prod" class="inp" type="search" placeholder="Nome, marca ou SKU" value="${esc(S.prod.busca)}" autocomplete="off"></label>
        <label><span class="sr">Categoria</span><select id="f-cat" class="inp"><option value="">Todas as categorias</option>${cats.map(c => `<option${S.prod.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label><span class="sr">Marca</span><select id="f-marca" class="inp"><option value="">Todas as marcas</option>${marcas.map(m => `<option${S.prod.marca === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label><span class="sr">Situação</span><select id="f-disp" class="inp">${[['', 'Todas as situações'], ['disp', 'Disponíveis'], ['esg', 'Esgotados'], ['dest', 'Em destaque'], ['oculto', 'Ocultos'], ['alt', 'Alterados no painel']]
          .map(([v, n]) => `<option value="${v}"${S.prod.disp === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div id="prod-lista">${listaProdutos()}</div>`;
  };
  function listaProdutos() {
    const lista = filtrarProdutos();
    const pags = Math.max(1, Math.ceil(lista.length / POR_PAG));
    if (S.prod.pag >= pags) S.prod.pag = pags - 1;
    const ini = S.prod.pag * POR_PAG; const pag = lista.slice(ini, ini + POR_PAG);
    const ov = DB.overrides.todos();
    if (!lista.length) return `<div class="card">${vazio('Nenhum produto encontrado', 'Tente outra busca ou limpe os filtros.')}</div>`;
    const pagin = pags > 1 ? `<nav class="paginacao" aria-label="Páginas">
      <button class="btn btn-sec btn-peq" data-pag="${S.prod.pag - 1}" ${S.prod.pag === 0 ? 'disabled' : ''}>← Anterior</button>
      <span class="pg">Página ${S.prod.pag + 1} de ${pags}</span>
      <button class="btn btn-sec btn-peq" data-pag="${S.prod.pag + 1}" ${S.prod.pag >= pags - 1 ? 'disabled' : ''}>Próxima →</button></nav>` : '';
    return `<div class="barra-acoes"><span class="contagem">${num(lista.length)} produto${lista.length === 1 ? '' : 's'} • mostrando ${ini + 1}–${ini + pag.length}</span></div>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Produto</th><th>Categoria</th><th>Preço lista/cartão</th><th>Disp.</th><th>Destaque</th><th>Oculto</th><th></th></tr></thead>
        <tbody>${pag.map(p => { const alt = !!ov[p.id]; return `<tr data-pid="${p.id}">
          <td class="cel-prod">${thumb(p.img && p.img[0], 52, 'thumb')}<div><div class="nome-prod">${esc(p.n)}</div>
            <span class="sub">${esc(p.m || 'Sem marca')} • SKU <span class="mono">${esc(p.sku || '—')}</span>${p.v && p.v.length > 1 ? ` • ${p.v.length} variantes` : ''}</span>
            <div class="etqs">${alt ? '<span class="etq etq-alt">Alterado</span>' : ''}${!p.disp ? '<span class="etq etq-esg">Esgotado</span>' : ''}${p.oculto ? '<span class="etq etq-oc">Oculto</span>' : ''}${p.destaque ? '<span class="etq etq-dest">Destaque</span>' : ''}${p.top && p.top <= 50 ? '<span class="etq">Mais pedido</span>' : ''}</div></div></td>
          <td data-l="Categoria"><span>${esc(p.c || '—')}${p.s ? `<span class="sub">${esc(p.s)}</span>` : ''}</span></td>
          <td data-l="Preço"><div class="preco-edit"><label class="rs">R$ <input class="inp mono" type="text" inputmode="decimal" data-preco="${p.id}" value="${p.p.toFixed(2).replace('.', ',')}" aria-label="Preço de lista de ${esc(p.n)}"></label>
            <span class="pix" data-pix="${p.id}">Pix ${brl(DB.precoPix(p.p))}</span></div></td>
          <td data-l="Disponível"><label class="chave"><input type="checkbox" data-tog="disp" ${p.disp ? 'checked' : ''}><span class="tr"></span><span class="sr">Disponível</span></label></td>
          <td data-l="Destaque"><label class="chave laranja"><input type="checkbox" data-tog="destaque" ${p.destaque ? 'checked' : ''}><span class="tr"></span><span class="sr">Destaque</span></label></td>
          <td data-l="Oculto"><label class="chave preto"><input type="checkbox" data-tog="oculto" ${p.oculto ? 'checked' : ''}><span class="tr"></span><span class="sr">Ocultar da loja</span></label></td>
          <td data-l="">${alt ? `<button class="btn btn-sec btn-peq" data-desfazer="${p.id}" title="Voltar ao original">${ico('desfazer')} <span>Desfazer</span></button>` : ''}</td>
        </tr>`; }).join('')}</tbody></table></div>${pagin}`;
  }
  function renderProdLista(topo) {
    const box = $('#prod-lista'); if (!box) return;
    box.innerHTML = listaProdutos();
    if (topo) box.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function setOverride(p, patch) {
    if (!p.original) p.original = { disp: p.disp, p: p.p };
    Object.assign(p, patch);
    DB.overrides.set(p.id, patch);
  }
  function salvarPreco(input) {
    const p = cat.porId.get(String(input.dataset.preco)); if (!p) return;
    const v = r2(parseNum(input.value));
    if (!(v > 0) || v > 100000) { toast('Preço inválido', 'x'); input.value = p.p.toFixed(2).replace('.', ','); return; }
    if (v === p.p) { input.value = v.toFixed(2).replace('.', ','); return; }
    const orig = pristino && pristino.get(String(p.id));
    const baseP = orig ? orig.p : p.p;
    const patch = { p: v };
    if (p.v && p.v.length) {
      const baseV = (orig && orig.v) || p.v;
      patch.v = p.v.map(x => { const b = baseV.find(y => y.id === x.id) || x; return { ...x, p: r2(b.p * (v / baseP)) }; });
    }
    if (p.pmax) patch.pmax = r2(((orig && orig.pmax) || p.pmax) * (v / baseP));
    setOverride(p, patch);
    toast(`${p.n}: ${brl(v)} (Pix ${brl(DB.precoPix(v))})`);
    renderProdLista();
  }
  function desfazer(pid) {
    const p = cat.porId.get(String(pid)); if (!p) return;
    const o = pristino && pristino.get(String(pid));
    DB.overrides.limpar(p.id);
    if (o) { p.disp = o.disp; p.p = o.p; if (o.v) p.v = o.v; if (o.pmax) p.pmax = o.pmax; }
    else if (p.original) { p.disp = p.original.disp; p.p = p.original.p; }
    delete p.destaque; delete p.oculto; delete p.original;
    toast('Produto voltou ao original', 'desfazer');
    renderProdLista();
  }

  /* ================= CONFIGURAÇÕES ================= */
  // Chave Pix no formato que o DICT aceita (o BR Code leva a chave exatamente como gravada):
  // CNPJ/CPF só dígitos, telefone +55DDDNÚMERO, e-mail minúsculo, aleatória (EVP) minúscula com hífens.
  const TIPOS_CHAVE = {
    cnpj: { nome: 'CNPJ', norm: s => dig(s), ok: k => k.length === 14 },
    cpf: { nome: 'CPF', norm: s => dig(s), ok: k => k.length === 11 },
    telefone: { nome: 'Telefone (celular)', norm: s => { const d = dig(s); return d ? '+' + ((d.length >= 12 && d.startsWith('55')) ? d : '55' + d) : ''; }, ok: k => /^\+55\d{10,11}$/.test(k) },
    email: { nome: 'E-mail', norm: s => String(s || '').trim().toLowerCase(), ok: k => k.length <= 77 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k) },
    aleatoria: { nome: 'Chave aleatória', norm: s => String(s || '').trim().toLowerCase(), ok: k => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k) },
  };
  const cpfValido = d => {
    if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
    const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === +d[9] && dv(10) === +d[10];
  };
  function detectarTipoChave(raw) {
    const s = String(raw || '').trim(); const d = dig(s);
    if (!s) return '';
    if (s.includes('@')) return 'email';
    if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s) && /[a-f]/i.test(s)) return 'aleatoria';
    if (s.startsWith('+')) return 'telefone';
    if (d.length === 14) return 'cnpj';
    if (d.length === 11) return cpfValido(d) ? 'cpf' : 'telefone';
    if (d.length === 10 || ((d.length === 12 || d.length === 13) && d.startsWith('55'))) return 'telefone';
    return '';
  }
  const tipoChaveInicial = pix => (pix.tipoChave && TIPOS_CHAVE[pix.tipoChave] ? pix.tipoChave : detectarTipoChave(pix.chave) || 'cnpj');
  function viraChaveHtml(tipo, raw) {
    const t = TIPOS_CHAVE[tipo]; const k = t ? t.norm(raw) : '';
    if (!String(raw || '').trim()) return 'Informe a chave Pix que vai no QR Code.';
    if (!t || !t.ok(k)) return `<span class="ruim">Essa chave não parece um ${esc(t ? t.nome : 'tipo válido')} válido. Confira o tipo e os números.</span>`;
    return `Vai no QR Code como: <b class="mono">${esc(k)}</b>`;
  }
  VIEWS.config = () => {
    const pix = C.pix || {};
    return `<div class="pilha" style="max-width:920px">
      <div class="aviso">${ico('cfg')}<p><strong>Na demonstração</strong> estes ajustes ficam salvos só neste navegador. <strong>Em produção</strong> eles ficam no banco de dados (Supabase), com login individual para cada pessoa da equipe e registro de quem alterou o quê.</p></div>
      <form id="form-cfg" class="card" novalidate>
        <div class="card-tit"><h2>Regras da loja</h2></div>
        <div class="form-cfg">
          <label class="campo"><span>Pedido mínimo</span><div class="prefixo"><b>R$</b><input id="cfg-min" type="text" inputmode="decimal" value="${String(C.pedidoMinimo).replace('.', ',')}" aria-describedby="cfg-min-vira"></div><small>Valor mínimo do carrinho (preço de lista). <span id="cfg-min-vira" class="vira">Fica: <b>${brl(C.pedidoMinimo)}</b></span></small></label>
          <label class="campo"><span>Acréscimo no cartão</span><div class="sufixo"><input id="cfg-acr" type="text" inputmode="decimal" value="${String(r2(C.acrescimoCartao * 100)).replace('.', ',')}"><b>%</b></div><small>O Pix sai sem esse acréscimo.</small></label>
          <label class="campo cheio"><span>WhatsApp da loja</span><input id="cfg-zap" type="tel" inputmode="tel" value="${esc(C.whatsapp)}"><small>Com DDI e DDD, só números. Ex.: 5571991479076.</small></label>
        </div>
        <div class="card-tit" style="margin-top:24px"><h2>Pix</h2></div>
        <div class="form-cfg">
          <label class="campo"><span>Chave Pix</span><input id="cfg-chave" type="text" value="${esc(pix.chave || '')}" autocomplete="off" spellcheck="false" aria-describedby="cfg-chave-vira"></label>
          <label class="campo"><span>Tipo da chave</span><select id="cfg-tipo">${Object.entries(TIPOS_CHAVE).map(([k, t]) => `<option value="${k}"${tipoChaveInicial(pix) === k ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
          <p class="campo cheio vira-chave" id="cfg-chave-vira" aria-live="polite">${viraChaveHtml(tipoChaveInicial(pix), pix.chave)}</p>
          <label class="campo"><span>Nome do recebedor</span><input id="cfg-nome" type="text" maxlength="25" value="${esc(pix.nome || '')}"><small>Até 25 letras, sem acento (vai no QR Code).</small></label>
          <label class="campo"><span>Cidade do recebedor</span><input id="cfg-cidade" type="text" maxlength="15" value="${esc(pix.cidade || '')}"><small>Até 15 letras, sem acento.</small></label>
          <div class="campo cheio"><label class="chave laranja"><input id="cfg-demo" type="checkbox" ${pix.demonstracao ? 'checked' : ''}><span class="tr"></span><span>Modo demonstração do Pix — a loja avisa “pedido de demonstração, não pague”</span></label></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px"><button type="submit" class="btn btn-pri btn-grande" style="flex:1 1 260px">${ico('ok')} Salvar configurações</button></div>
      </form>

      <section class="card">
        <div class="card-tit"><h2>Demonstração</h2></div>
        <p style="margin:0 0 14px">Para mostrar o alerta ao vivo: abra a <a href="index.html" target="_blank" rel="noopener"><strong>loja</strong></a> em outra aba deste mesmo navegador, faça um pedido e volte aqui. (Na demonstração os dados ficam no navegador; em produção o alerta chega em qualquer aparelho.) Ou simule um pedido agora:</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-preto" data-act="simular">${ico('sino')} Simular pedido novo</button>
          <button class="btn btn-perigo" data-act="restaurar">${ico('desfazer')} Restaurar dados de exemplo</button>
          <button class="btn btn-sec" data-act="sair">${ico('sair')} Sair do painel</button>
        </div>
      </section>
    </div>`;
  };
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  async function salvarConfig() {
    const n = id => parseNum($(id).value);
    const min = n('#cfg-min'), acr = n('#cfg-acr');
    if (!(min >= 0)) { toast('Pedido mínimo inválido', 'x'); $('#cfg-min').focus(); return; }
    if (!(acr >= 0 && acr <= 30)) { toast('Acréscimo deve ficar entre 0% e 30%', 'x'); $('#cfg-acr').focus(); return; }
    const zap = dig($('#cfg-zap').value);
    if (zap.length < 12) { toast('WhatsApp precisa de DDI + DDD + número', 'x'); $('#cfg-zap').focus(); return; }
    const bruta = $('#cfg-chave').value.trim();
    if (!bruta) { toast('Informe a chave Pix', 'x'); $('#cfg-chave').focus(); return; }
    const tipoChave = $('#cfg-tipo').value; const tc = TIPOS_CHAVE[tipoChave];
    const chave = tc ? tc.norm(bruta) : '';
    if (!tc || !tc.ok(chave)) { toast(`Chave Pix inválida para o tipo ${tc ? tc.nome : 'escolhido'}`, 'x'); $('#cfg-chave').focus(); return; }
    const minAtual = Number(C.pedidoMinimo) || 0;
    if (minAtual > 0 && r2(min) < minAtual * 0.5) {
      const ok = await confirmar({ titulo: 'Baixar o pedido mínimo?', sim: `Sim, ${brl(r2(min))}`,
        html: `<p>O pedido mínimo vai de <strong>${brl(minAtual)}</strong> para <strong>${brl(r2(min))}</strong>. A loja passa a usar esse valor na hora.</p>` });
      if (!ok) { $('#cfg-min').focus(); return; }
    }
    DB.salvarConfig({
      pedidoMinimo: r2(min), acrescimoCartao: r2(acr) / 100, whatsapp: zap,
      pix: { chave, tipoChave, nome: semAcento($('#cfg-nome').value).slice(0, 25).trim(), cidade: semAcento($('#cfg-cidade').value).slice(0, 15).trim(), demonstracao: $('#cfg-demo').checked },
    });
    toast('Configurações salvas — a loja já usa os novos valores');
    render();
  }
  async function simularPedido() {
    const c = await carregarCatalogo();
    const base = c ? c.produtos.filter(p => p.disp && !p.oculto && p.top && p.img && p.img.length) : [];
    if (!base.length) { toast('Não foi possível carregar o catálogo. Tente de novo.', 'x'); return; }
    const lojas = DB.lojistas.list().filter(l => l.status === 'aprovado');
    const l = lojas[Math.floor(Math.random() * lojas.length)] || { cnpj: '11.222.333/0001-81', razao: 'Headshop Exemplo', nome: 'Contato', whatsapp: '71900000000', cidade: 'Salvador', uf: 'BA' };
    const n = 3 + Math.floor(Math.random() * 4);
    const itens = Array.from({ length: n }, () => {
      const p = base[Math.floor(Math.random() * base.length)];
      const v = p.v ? p.v.find(x => x.d) || p.v[0] : null;
      return { key: `${p.id}:${v ? v.id : p.vid}`, pid: p.id, vid: v ? v.id : p.vid, nome: p.n, variante: v ? v.t : '', marca: p.m, sku: v ? v.sku : p.sku,
        preco: v ? v.p : p.p, img: (v && v.img) || p.img[0], qtd: 2 + Math.floor(Math.random() * 5) * 2, por: p.por, un: p.un };
    }).filter((it, i, a) => a.findIndex(x => x.key === it.key) === i);
    const subtotal = r2(itens.reduce((s, it) => s + DB.precoPix(it.preco) * it.qtd, 0));
    const ent = C.entrega[1] || C.entrega[0];
    DB.pedidos.criar({
      exemplo: true, lojista: { cnpj: l.cnpj, razao: l.razao, nome: l.nome, whatsapp: l.whatsapp, email: l.email || '', cidade: l.cidade, uf: l.uf },
      entrega: { tipo: ent.id, nome: ent.nome, valor: ent.valor }, pagamento: { metodo: 'pix', txid: 'ST' + Date.now().toString().slice(-8) },
      itens, subtotal, total: subtotal, obs: '',
    });
  }
  async function restaurar() {
    const ok = await confirmar({ titulo: 'Restaurar dados de exemplo?', perigo: true, sim: 'Restaurar',
      html: '<p>Apaga pedidos, lojistas, carrinho e ajustes de produto deste navegador e recria os dados de exemplo. As configurações da loja são mantidas.</p>' });
    if (!ok) return;
    try {
      const chaves = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('street.') && k !== 'street.config' && k !== 'street.admin.som') chaves.push(k); }
      chaves.forEach(k => localStorage.removeItem(k));
    } catch { /* sem storage */ }
    location.reload();
  }

  /* ================= eventos ================= */
  // No celular a barra lateral é uma gaveta: ao abrir o foco entra nela (e fica preso), ao fechar volta para quem abriu.
  let menuOrigem = null;
  const mqMenu = window.matchMedia('(max-width: 1023px)');
  const menuGaveta = () => mqMenu.matches;
  // Fechada no celular: além do visibility do CSS, `inert` tira os links do Tab mesmo se a transição não rodar.
  const ajustarInert = () => { const sb = $('#sidebar'); sb.inert = menuGaveta() && !sb.classList.contains('aberto'); };
  if (mqMenu.addEventListener) mqMenu.addEventListener('change', ajustarInert);
  window.addEventListener('resize', ajustarInert); // reforço (girar o tablet, redimensionar a janela)
  function abrirMenu() {
    const sb = $('#sidebar');
    menuOrigem = document.activeElement;
    sb.inert = false;
    sb.classList.add('aberto'); $('.menu-fundo').hidden = false;
    if (menuGaveta()) { sb.setAttribute('role', 'dialog'); sb.setAttribute('aria-modal', 'true'); setTimeout(() => $('.side-fechar').focus(), 30); }
  }
  function fecharMenu(devolverFoco = true) {
    const sb = $('#sidebar');
    const estavaAberto = sb.classList.contains('aberto');
    sb.classList.remove('aberto'); $('.menu-fundo').hidden = true;
    sb.removeAttribute('role'); sb.removeAttribute('aria-modal');
    ajustarInert();
    if (estavaAberto && devolverFoco && menuOrigem && document.contains(menuOrigem)) menuOrigem.focus();
    if (estavaAberto) menuOrigem = null;
  }
  // Tab circular dentro de um contêiner (menu aberto no celular, modal de confirmação)
  function prenderTab(e, box) {
    const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', box)
      .filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const pri = f[0], ult = f[f.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); pri.focus(); return; }
    if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
    else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
  }

  document.addEventListener('click', async e => {
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'menu-abrir') return abrirMenu();
      if (a === 'menu-fechar') return fecharMenu();
      if (a === 'gaveta-fechar') return fecharGaveta();
      if (a === 'som') { S.som = !S.som; try { localStorage.setItem('street.admin.som', S.som ? '1' : '0'); } catch { /* ok */ } atualizarBotaoSom(); if (S.som) apitar(); return; }
      if (a === 'sair') { try { sessionStorage.removeItem(SESS); } catch { /* ok */ } location.hash = ''; location.reload(); return; }
      if (a === 'st') return mudarStatus(act.dataset.st);
      if (a === 'enviar') return mudarStatus('enviado');
      if (a === 'cancelar') {
        const p = DB.pedidos.get(S.aberto); if (!p) return;
        const ok = await confirmar({ titulo: `Cancelar ${p.id}?`, perigo: true, sim: 'Sim, cancelar',
          html: `<p>O pedido de <strong>${esc(loj(p).razao || 'lojista')}</strong> (${brl(totalDe(p))}) será cancelado. Avise o lojista no WhatsApp.</p>
            <label class="campo" style="margin-top:12px"><span>Motivo (opcional)</span><input id="motivo-cancel" type="text" placeholder="Ex.: sem estoque, lojista desistiu"></label>` });
        if (!ok) return;
        const motivo = (($('#motivo-cancel') || {}).value || '').trim(); // o modal só é escondido, o campo continua no DOM
        DB.pedidos.atualizar(p.id, { motivoCancelamento: motivo }, 'cancelado');
        toast(`${p.id}: cancelado`, 'x');
        const fg = $('#gaveta [data-act="gaveta-fechar"]'); if (fg && !$('#gaveta').hidden) fg.focus(); // o botão de origem sumiu no re-render
        return;
      }
      if (a === 'imprimir-um') { const p = DB.pedidos.get(S.aberto); if (p) imprimir(folhaPedido(p)); return; }
      if (a === 'imprimir-todos') return imprimir(paraSeparar().map(folhaPedido).join(''));
      if (a === 'imprimir-cons') return imprimir(folhaConsolidado(paraSeparar()));
      if (a === 'copiar') { try { await navigator.clipboard.writeText(act.dataset.txt); toast('Copiado'); } catch { toast('Não deu para copiar', 'x'); } return; }
      if (a === 'simular') { try { await simularPedido(); } catch (err) { console.error(err); toast('Não deu para simular o pedido', 'x'); } return; }
      if (a === 'cat-tentar') { catErro = false; render(); carregarCatalogo(); return; }
      if (a === 'restaurar') return restaurar();
      return;
    }
    const kpiAba = t.closest('[data-aba]'); if (kpiAba) { S.aba = kpiAba.dataset.aba; }
    const ab = t.closest('[data-aba-ped]'); if (ab) { S.aba = ab.dataset.abaPed; render(); return; }
    const sp = t.closest('[data-sep]'); if (sp) { S.sepModo = sp.dataset.sep; render(); return; }
    const si = t.closest('[data-sep-iniciar]'); if (si) { DB.pedidos.atualizar(si.dataset.sepIniciar, {}, 'separando'); toast(`${si.dataset.sepIniciar}: separação iniciada`); return; }
    const im = t.closest('[data-imprimir]'); if (im) { const p = DB.pedidos.get(im.dataset.imprimir); if (p) imprimir(folhaPedido(p)); return; }
    const la = t.closest('[data-loj-aprovar]'); if (la) { const l = DB.lojistas.get(la.dataset.lojAprovar); DB.lojistas.salvar({ ...l, status: 'aprovado', aprovadoEm: new Date().toISOString() }); toast(`${l.razao}: cadastro aprovado`); return; }
    const lr = t.closest('[data-loj-recusar]'); if (lr) {
      const l = DB.lojistas.get(lr.dataset.lojRecusar);
      if (await confirmar({ titulo: 'Recusar cadastro?', perigo: true, sim: 'Recusar', html: `<p><strong>${esc(l.razao)}</strong> não poderá comprar até ser aprovado.</p>` })) {
        DB.lojistas.salvar({ ...l, status: 'recusado' }); toast(`${l.razao}: cadastro recusado`, 'x');
      }
      return;
    }
    const pg = t.closest('[data-pag]'); if (pg && !pg.disabled) { S.prod.pag = +pg.dataset.pag; renderProdLista(true); return; }
    const dz = t.closest('[data-desfazer]'); if (dz) { desfazer(dz.dataset.desfazer); return; }
    const row = t.closest('[data-pedido]');
    if (row && !t.closest('a, input, label')) { abrirPedido(row.dataset.pedido); }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'busca-ped') { S.busca = t.value; buscaPed(); }
    if (t.id === 'busca-loj') { S.lojBusca = t.value; buscaLoj(); }
    if (t.id === 'busca-prod') { S.prod.busca = t.value; S.prod.pag = 0; buscaProd(); }
    if (t.id === 'cfg-min') { const v = parseNum(t.value); $('#cfg-min-vira').innerHTML = v >= 0 ? `Fica: <b>${brl(r2(v))}</b>` : '<span class="ruim">Valor inválido</span>'; }
    if (t.id === 'cfg-chave') {
      const tp = detectarTipoChave(t.value); const sel = $('#cfg-tipo');
      if (tp && sel) sel.value = tp;
      $('#cfg-chave-vira').innerHTML = viraChaveHtml(sel ? sel.value : tp, t.value);
    }
    if (t.dataset && t.dataset.preco) {
      const v = parseNum(t.value);
      const el = document.querySelector(`[data-pix="${t.dataset.preco}"]`);
      if (el) el.textContent = v > 0 ? 'Pix ' + brl(DB.precoPix(v)) : 'Pix —';
    }
  });
  const buscaPed = debounce(() => S.view === 'pedidos' && render(), 180);
  const buscaLoj = debounce(() => S.view === 'lojistas' && render(), 180);
  const buscaProd = debounce(() => renderProdLista(), 200);

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'f-cat') { S.prod.cat = t.value; S.prod.pag = 0; renderProdLista(); return; }
    if (t.id === 'f-marca') { S.prod.marca = t.value; S.prod.pag = 0; renderProdLista(); return; }
    if (t.id === 'f-disp') { S.prod.disp = t.value; S.prod.pag = 0; renderProdLista(); return; }
    if (t.id === 'cfg-tipo') { $('#cfg-chave-vira').innerHTML = viraChaveHtml(t.value, $('#cfg-chave').value); return; }
    if (t.dataset.preco) { salvarPreco(t); return; }
    if (t.dataset.tog) {
      const tr = t.closest('[data-pid]'); const p = cat && cat.porId.get(String(tr.dataset.pid)); if (!p) return;
      const k = t.dataset.tog; setOverride(p, { [k]: t.checked });
      const msg = { disp: t.checked ? 'disponível' : 'esgotado', destaque: t.checked ? 'em destaque' : 'sem destaque', oculto: t.checked ? 'oculto na loja' : 'visível na loja' }[k];
      toast(`${p.n}: ${msg}`);
      renderProdLista();
      return;
    }
    if (t.dataset.lojBoleto) {
      const l = DB.lojistas.get(t.dataset.lojBoleto);
      DB.lojistas.salvar({ ...l, boleto: t.checked });
      toast(`${l.razao}: boleto a prazo ${t.checked ? 'liberado' : 'bloqueado'}`);
    }
  });
  document.addEventListener('submit', e => {
    if (e.target.id === 'form-cfg') { e.preventDefault(); salvarConfig(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' && $('#modal').hidden && $('#sidebar').classList.contains('aberto') && menuGaveta()) prenderTab(e, $('#sidebar'));
    if (e.key === 'Escape' && $('#modal').hidden) {
      if (S.aberto) fecharGaveta(); else fecharMenu();
    }
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.preco) { e.preventDefault(); e.target.blur(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-pedido]')) { e.preventDefault(); abrirPedido(e.target.dataset.pedido); }
  });

  /* ---------------- partida ---------------- */
  if (logado()) iniciar(); else mostrarLogin();
})();
