/* Pix estático (BR Code do Banco Central) + QR Code em SVG.
   window.StreetPix = {
     brcode({chave, nome, cidade, valor, txid}) → string "copia e cola" (EMV/TLV + CRC16-CCITT 0xFFFF)
                                                  lança Error se a chave for inválida (vazia, >77, com espaço/acento)
     qrSvg(texto, tamanhoPx)                    → string <svg> (usa window.qrcode do qrcode-generator@1.4.4)
     crc16(str)                                 → 'ABCD'
   }
   Em produção o ideal é Pix dinâmico (cobrança via API do banco/PSP, com baixa automática por webhook);
   a assinatura de brcode() continua servindo para o fallback estático. */
(() => {
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const limpa = (s, max) => semAcento(s).replace(/[^A-Za-z0-9 .,\-\/@+]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  // O BR Code conta o tamanho em caracteres com 2 dígitos: campo acima de 99 ou com caractere fora do ASCII
  // gera um código que o banco recusa. Melhor falhar alto do que entregar um QR inválido.
  const tlv = (id, v) => {
    v = String(v);
    if (v.length > 99) throw new Error(`Pix: campo ${id} passa de 99 caracteres`);
    if (/[^\x20-\x7E]/.test(v)) throw new Error(`Pix: campo ${id} tem caractere inválido (acento ou símbolo)`);
    return id + String(v.length).padStart(2, '0') + v;
  };

  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function brcode({ chave, nome, cidade, valor, txid } = {}) {
    const k = String(chave || '').trim();
    if (!k) throw new Error('Pix: chave não configurada');
    if (k.length > 77 || /\s/.test(k)) throw new Error('Pix: chave Pix inválida (até 77 caracteres, sem espaços)');
    const conta = tlv('00', 'br.gov.bcb.pix') + tlv('01', k);
    const tx = (String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***';
    let s = tlv('00', '01')
      + tlv('26', conta)
      + tlv('52', '0000')
      + tlv('53', '986');
    const v = Number(valor);
    if (v > 0) s += tlv('54', v.toFixed(2));
    s += tlv('58', 'BR')
      + tlv('59', (limpa(nome, 25) || 'RECEBEDOR').toUpperCase())
      + tlv('60', (limpa(cidade, 15) || 'BRASIL').toUpperCase())
      + tlv('62', tlv('05', tx))
      + '6304';
    return s + crc16(s);
  }

  function qrSvg(texto, tamanhoPx = 240) {
    if (typeof window.qrcode !== 'function') {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanhoPx}" height="${tamanhoPx}" viewBox="0 0 100 100" role="img" aria-label="QR Code indisponível"><rect width="100" height="100" fill="#fff"/><text x="50" y="52" font-size="7" text-anchor="middle" fill="#111">Use o copia e cola</text></svg>`;
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const n = qr.getModuleCount();
    const q = 4; // zona de silêncio
    const t = n + q * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          let w = 1; while (c + w < n && qr.isDark(r, c + w)) w++;
          d += `M${c + q} ${r + q}h${w}v1h-${w}z`;
          c += w - 1;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanhoPx}" height="${tamanhoPx}" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges" role="img" aria-label="QR Code do Pix"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
  }

  const api = { brcode, qrSvg, crc16 };
  if (typeof window !== 'undefined') window.StreetPix = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
