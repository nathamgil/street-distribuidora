/* Configuração da loja — tudo que muda por cliente fica aqui.
   Itens marcados "A CONFIRMAR" vêm do site atual e precisam do OK da Street antes de ir ao ar. */
window.STREET_CONFIG = {
  nome: 'Street Distribuidora',
  slogan: 'A maior distribuidora do Nordeste',
  razaoSocial: 'Street Distribuidora',
  cnpj: '27.795.158/0001-51',
  whatsapp: '5571991479076',            // wa.me do site atual
  telefone: '(71) 99147-9076',
  instagram: 'streetdistribuidora',
  endereco: 'Galpão Kallas Mídia — R. Araponga, 428 (interfone 2), Lauro de Freitas (BA)',
  horario: 'Seg a Sex, 8h30 às 17h30',
  dominio: 'streetdistribuidora.com.br',

  pedidoMinimo: 300,                    // R$, igual ao banner do site atual
  // O preço da Shopify hoje é o preço-base + 5% (campo "compare_at_price"). Aqui o Pix sai pelo preço-base
  // e o cartão mantém os 5%. A CONFIRMAR com a Street.
  acrescimoCartao: 0.05,

  pix: {
    chave: '27795158000151',            // CNPJ — A CONFIRMAR se é a chave Pix da Street
    nome: 'STREET DISTRIBUIDORA',       // até 25 caracteres, sem acento
    cidade: 'LAURO DE FREITAS',         // até 15 caracteres (o gerador corta)
    validadeMin: 30,
    demonstracao: true,                 // mostra o aviso "pedido de demonstração, não pague"
  },

  entrega: [
    { id: 'retirada', nome: 'Retirada no galpão', detalhe: 'Lauro de Freitas — Seg a Sex, 8h30 às 17h30', prazo: 'Combine o horário no WhatsApp', valor: 0 },
    { id: 'local', nome: 'Entrega Salvador e RMS', detalhe: 'Uber Flash — valor do app, combinado no WhatsApp', prazo: 'Até 2 dias úteis', valor: null },
    { id: 'brasil', nome: 'Envio para todo o Brasil', detalhe: 'Correios ou transportadora — cotação enviada no WhatsApp', prazo: 'Bahia em até 1 semana', valor: null },
  ],

  pagamentos: [
    { id: 'pix', nome: 'Pix', detalhe: 'Preço sem acréscimo, QR Code na hora' },
    { id: 'cartao', nome: 'Cartão de crédito', detalhe: 'Link de pagamento enviado no WhatsApp (+5%)' },
    { id: 'boleto', nome: 'Boleto a prazo', detalhe: 'Só para lojistas com cadastro aprovado' },
  ],

  painel: { senhaDemo: 'street' },      // senha do admin.html no modo demonstração
};
