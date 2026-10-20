/* Camada de dados compartilhada entre a loja (index.html) e o painel (admin.html).
   No modo demonstração tudo fica no localStorage do navegador. Em produção, cada método
   vira uma chamada ao Supabase (tabelas pedidos, lojistas, produtos) com RLS — a assinatura
   dos métodos não muda, então a interface não precisa ser reescrita.

   Contrato (window.StreetDB):
     catalogo()                 → Promise<{categorias, marcas, produtos}>  (data/catalogo.json, cacheado)
     descricao(id)              → Promise<string>                          (data/descricoes.json)
     precoPix(p) / precoCartao(p) / brl(v)
     carrinho.itens() / add(item, qtd) / setQtd(key, qtd) / remover(key) / limpar()
     carrinho.substituir(itens) → grava a lista inteira (usado para revalidar preço/estoque depois de ajustes do painel)
     carrinho.qtdTotal() / subtotal() / subtotalPix()      (quantidades sempre entre 0 e QTD_MAX = 9999)
     pedidos.list() / get(id) / criar(dados) / atualizar(id, patch, statusNovo?)
       criar() lança Error se o navegador não conseguir gravar (cota cheia / armazenamento bloqueado)
     lojistas.list() / get(cnpj) / salvar(l) / atual() / entrar(cnpj) / sair()
     on(evento, fn)             → eventos: 'carrinho', 'pedidos', 'lojistas' (inclui entrar/sair), 'overrides', 'config'
     seedDemo()                 → cria pedidos/lojistas de exemplo uma vez (para o painel), sem apagar lojistas reais
     ls.get/ls.set              → ls.set devolve true/false (gravou ou não)
   Leituras do localStorage são validadas pelo formato (lista/objeto); dados corrompidos viram o valor padrão.
   catalogo().produtos traz também os ocultos (p.oculto); quem mostra a vitrine filtra. p.original guarda
   {disp, p, v, pmax} do JSON quando um ajuste do painel já veio aplicado no carregamento.
   Item do carrinho: {key:'pid:vid', pid, vid, nome, variante, marca, sku, preco, img, qtd, por, un}
   Pedido: {id:'ST-10234', criadoEm, status, historico:[{status, em}], lojista:{cnpj, razao, nome, whatsapp, email, cidade, uf},
            entrega:{tipo, nome, endereco?, valor}, pagamento:{metodo, txid, copiaECola?}, itens:[...], subtotal, total, obs, demo,
            acrescimo?}  — cada item pode ter precoPago (preço unitário efetivamente cobrado no método escolhido)
   Status: aguardando_pagamento → pago → separando → enviado → entregue  (ou cancelado) */
(() => {
  const C = window.STREET_CONFIG;
  const PFX = 'street.';
  const ls = {
    get(k, f) { try { const v = localStorage.getItem(PFX + k); if (v == null) return f; const r = JSON.parse(v); return r == null ? f : r; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); return true; } catch { return false; /* modo privado / cota cheia */ } },
  };
  const ehObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const lista = (k, ok = ehObj) => { const v = ls.get(k, []); return Array.isArray(v) ? v.filter(ok) : []; };
  const objeto = k => { const v = ls.get(k, {}); return ehObj(v) ? v : {}; };
  const QTD_MAX = 9999;
  const clampQtd = q => Math.max(0, Math.min(QTD_MAX, Math.floor(Number(q)) || 0));
  const ouvintes = {};
  const emit = (ev, d) => (ouvintes[ev] || []).forEach(fn => { try { fn(d); } catch (e) { console.error(e); } });
  window.addEventListener('storage', e => {
    if (!e.key || !e.key.startsWith(PFX)) return;
    const k = e.key.slice(PFX.length);
    emit(k === 'sessao' ? 'lojistas' : k, null);
  });

  // Configurações salvas pelo painel (admin.html → Configurações) sobrescrevem o config.js.
  const cfgSalva = ls.get('config', null);
  if (ehObj(cfgSalva)) { const { pix, ...resto } = cfgSalva; Object.assign(C, resto); if (ehObj(pix)) Object.assign(C.pix, pix); }

  const r2 = v => Math.round(v * 100) / 100;
  const precoPix = p => r2(p / (1 + C.acrescimoCartao));
  const precoCartao = p => r2(p);
  const brl = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const soDig = s => String(s || '').replace(/\D/g, '');

  let _cat, _desc;
  const base = (document.currentScript && document.currentScript.src.replace(/assets\/js\/store\.js.*$/, '')) || './';
  // Ajustes de produto feitos no painel: {pid: {disp?, p?, destaque?, oculto?}}
  const overrides = {
    todos: () => objeto('overrides'),
    set(pid, patch) { const o = overrides.todos(); o[pid] = { ...(o[pid] || {}), ...patch }; ls.set('overrides', o); emit('overrides', o); },
    limpar(pid) { const o = overrides.todos(); delete o[pid]; ls.set('overrides', o); emit('overrides', o); },
  };
  const catalogo = () => _cat || (_cat = fetch(base + 'data/catalogo.json').then(r => r.json()).then(d => {
    const o = overrides.todos();
    d.produtos.forEach(p => {
      const x = o[p.id];
      if (x) { p.original = { disp: p.disp, p: p.p, v: p.v ? p.v.map(y => ({ ...y })) : undefined, pmax: p.pmax }; Object.assign(p, x); }
    });
    // Os ocultos continuam no catálogo (a loja filtra) para poderem reaparecer ao vivo quando o painel reexibir.
    d.porId = new Map(d.produtos.map(p => [String(p.id), p]));
    d.porHandle = new Map(d.produtos.map(p => [p.h, p]));
    return d;
  }));
  // Falha de rede não fica em cache: devolve null (≠ '' = produto sem descrição) e tenta de novo na próxima vez.
  const descricao = id => (_desc || (_desc = fetch(base + 'data/descricoes.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .catch(() => { _desc = null; return null; })))
    .then(d => (d ? d[String(id)] || '' : null));

  /* ---------- carrinho ---------- */
  const itemOk = i => ehObj(i) && typeof i.key === 'string' && Number.isFinite(Number(i.qtd)) && Number.isFinite(Number(i.preco));
  const carrinho = {
    itens: () => lista('carrinho', itemOk).map(i => ({ ...i, qtd: clampQtd(i.qtd), preco: Number(i.preco) })).filter(i => i.qtd > 0),
    _salvar(itens) { ls.set('carrinho', itens); emit('carrinho', itens); },
    substituir(itens) { carrinho._salvar((Array.isArray(itens) ? itens : []).filter(itemOk).map(i => ({ ...i, qtd: clampQtd(i.qtd) })).filter(i => i.qtd > 0)); },
    add(item, qtd = 1) {
      const itens = carrinho.itens();
      const key = item.key || `${item.pid}:${item.vid || 0}`;
      const ex = itens.find(i => i.key === key);
      if (ex) ex.qtd = clampQtd(ex.qtd + clampQtd(qtd)); else itens.push({ ...item, key, qtd: clampQtd(qtd) });
      carrinho._salvar(itens.filter(i => i.qtd > 0));
      return key;
    },
    setQtd(key, qtd) {
      const itens = carrinho.itens().map(i => (i.key === key ? { ...i, qtd: clampQtd(qtd) } : i));
      carrinho._salvar(itens.filter(i => i.qtd > 0));
    },
    qtdDe: key => (carrinho.itens().find(i => i.key === key) || {}).qtd || 0,
    remover(key) { carrinho._salvar(carrinho.itens().filter(i => i.key !== key)); },
    limpar() { carrinho._salvar([]); },
    qtdTotal: () => carrinho.itens().reduce((s, i) => s + i.qtd, 0),
    subtotal: () => r2(carrinho.itens().reduce((s, i) => s + precoCartao(i.preco) * i.qtd, 0)),
    subtotalPix: () => r2(carrinho.itens().reduce((s, i) => s + precoPix(i.preco) * i.qtd, 0)),
  };

  /* ---------- pedidos ---------- */
  const pedidos = {
    _todos: () => lista('pedidos', p => ehObj(p) && typeof p.id === 'string' && Array.isArray(p.itens)),
    list: () => pedidos._todos().sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1)),
    get: id => pedidos.list().find(p => p.id === id) || null,
    _salvar(l) { const ok = ls.set('pedidos', l); emit('pedidos', l); return ok; },
    proximoId() {
      const s = Number(ls.get('seq', 10230));
      const n = (Number.isFinite(s) ? s : 10230) + 1; ls.set('seq', n); return 'ST-' + n;
    },
    criar(dados) {
      const agora = new Date().toISOString();
      const p = { id: pedidos.proximoId(), criadoEm: agora, status: 'aguardando_pagamento',
        historico: [{ status: 'aguardando_pagamento', em: agora }], demo: true, ...dados };
      if (!ls.set('pedidos', [p, ...pedidos._todos()]) || !pedidos.get(p.id)) throw new Error('Não foi possível salvar o pedido neste navegador.');
      emit('pedidos', null);
      return p;
    },
    atualizar(id, patch = {}, statusNovo) {
      const lista = pedidos._todos();
      const p = lista.find(x => x.id === id); if (!p) return null;
      Object.assign(p, patch);
      if (statusNovo && statusNovo !== p.status) { p.status = statusNovo; p.historico = [...(p.historico || []), { status: statusNovo, em: new Date().toISOString() }]; }
      pedidos._salvar(lista); return p;
    },
  };
  const STATUS = {
    aguardando_pagamento: { nome: 'Aguardando Pix', cor: '#E38420' },
    pago: { nome: 'Pago', cor: '#1A9E5C' },
    separando: { nome: 'Em separação', cor: '#2D6CDF' },
    enviado: { nome: 'Enviado', cor: '#7A4DD8' },
    entregue: { nome: 'Entregue', cor: '#111111' },
    cancelado: { nome: 'Cancelado', cor: '#C0392B' },
  };

  /* ---------- lojistas ---------- */
  const lojistas = {
    list: () => lista('lojistas', l => ehObj(l) && l.cnpj != null),
    get: cnpj => lojistas.list().find(l => soDig(l.cnpj) === soDig(cnpj)) || null,
    salvar(l) {
      const lista = lojistas.list().filter(x => soDig(x.cnpj) !== soDig(l.cnpj));
      const novo = { status: 'pendente', criadoEm: new Date().toISOString(), ...lojistas.get(l.cnpj), ...l };
      ls.set('lojistas', [novo, ...lista]); emit('lojistas', null); return novo;
    },
    atual: () => { const c = ls.get('sessao', null); return c ? lojistas.get(c) : null; },
    entrar(cnpj) { ls.set('sessao', soDig(cnpj)); emit('lojistas', null); },
    sair() { ls.set('sessao', null); emit('lojistas', null); },
  };

  /* ---------- dados de exemplo para o painel (claramente marcados) ---------- */
  async function seedDemo() {
    if (ls.get('seeded', false)) return;
    const cat = await catalogo();
    const disp = cat.produtos.filter(p => p.disp && p.top && !p.oculto).slice(0, 60);
    const lojas = [
      ['11.222.333/0001-81', 'Headshop Exemplo Rio Vermelho', 'Salvador', 'BA', 'aprovado'],
      ['22.333.444/0001-05', 'Tabacaria Exemplo Pituba', 'Salvador', 'BA', 'aprovado'],
      ['33.444.555/0001-30', 'Loja Exemplo Feira', 'Feira de Santana', 'BA', 'aprovado'],
      ['44.555.666/0001-62', 'Tabacaria Exemplo Aracaju', 'Aracaju', 'SE', 'aprovado'],
      ['55.666.777/0001-09', 'Headshop Exemplo Recife', 'Recife', 'PE', 'pendente'],
      ['66.777.888/0001-43', 'Conveniência Exemplo Lauro', 'Lauro de Freitas', 'BA', 'pendente'],
    ].map(([cnpj, razao, cidade, uf, status], i) => ({ cnpj, razao, nome: 'Contato ' + (i + 1), whatsapp: '71900000000', email: '', cidade, uf, status, exemplo: true,
      criadoEm: new Date(Date.now() - (i + 2) * 86400e3 * 3).toISOString() }));
    // Mescla: mantém os lojistas reais (cadastrados na loja antes do primeiro acesso ao painel).
    const reais = lojistas.list().filter(l => !l.exemplo && !lojas.some(x => soDig(x.cnpj) === soDig(l.cnpj)));
    ls.set('lojistas', [...reais, ...lojas]);
    const fluxo = ['aguardando_pagamento', 'pago', 'separando', 'enviado', 'entregue'];
    const lista = [];
    let seq = 10180;
    for (let i = 0; i < 26; i++) {
      const loja = lojas[i % 4];
      const n = 3 + (i * 7) % 6;
      const itens = Array.from({ length: n }, (_, k) => {
        const p = disp[(i * 5 + k * 3) % disp.length];
        const v = p.v ? p.v.find(x => x.d) || p.v[0] : null;
        return { key: `${p.id}:${v ? v.id : p.vid}`, pid: p.id, vid: v ? v.id : p.vid, nome: p.n, variante: v ? v.t : '', marca: p.m, sku: v ? v.sku : p.sku,
          preco: v ? v.p : p.p, img: (v && v.img) || p.img[0], qtd: 2 + ((i + k) % 5) * 2, por: p.por, un: p.un };
      });
      const metodo = i % 5 === 3 ? 'cartao' : 'pix';
      const subtotal = r2(itens.reduce((s, it) => s + (metodo === 'pix' ? precoPix(it.preco) : it.preco) * it.qtd, 0));
      const dias = Math.floor(i * 0.9);
      const criado = new Date(Date.now() - dias * 86400e3 - (i % 7) * 3600e3);
      const st = i < 3 ? 'aguardando_pagamento' : fluxo[Math.min(4, Math.floor(i / 3) % 5)];
      const hist = fluxo.slice(0, fluxo.indexOf(st) + 1).map((s, k) => ({ status: s, em: new Date(criado.getTime() + k * 5 * 3600e3).toISOString() }));
      lista.push({ id: 'ST-' + (++seq), criadoEm: criado.toISOString(), status: st, historico: hist, exemplo: true, demo: true,
        lojista: { cnpj: loja.cnpj, razao: loja.razao, nome: loja.nome, whatsapp: loja.whatsapp, cidade: loja.cidade, uf: loja.uf },
        entrega: { tipo: ['retirada', 'local', 'brasil'][i % 3], nome: C.entrega[i % 3].nome, valor: C.entrega[i % 3].valor },
        pagamento: { metodo, txid: 'ST' + seq }, itens, subtotal, total: subtotal, obs: '' });
    }
    ls.set('pedidos', [...pedidos._todos().filter(p => !p.exemplo), ...lista]);
    ls.set('seq', Math.max(Number(ls.get('seq', 10230)) || 10230, seq + 50));
    ls.set('seeded', true);
    emit('pedidos', null); emit('lojistas', null);
  }

  window.StreetDB = {
    config: C, ls, on(ev, fn) { (ouvintes[ev] = ouvintes[ev] || []).push(fn); },
    catalogo, descricao, precoPix, precoCartao, brl, soDig, r2, QTD_MAX, carrinho, pedidos, lojistas, overrides, STATUS, seedDemo,
    salvarConfig(patch) { const atual = ls.get('config', {}) || {}; const novo = { ...atual, ...patch, pix: { ...(atual.pix || {}), ...(patch.pix || {}) } };
      ls.set('config', novo); const { pix, ...resto } = novo; Object.assign(C, resto); Object.assign(C.pix, pix); emit('config', C); },
  };
})();
