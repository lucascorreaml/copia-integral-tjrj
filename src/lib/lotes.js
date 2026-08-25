// Particionamento das pecas em lotes e nomeacao dos arquivos.

export const TAMANHO_LOTE_PADRAO = 50;

/**
 * Particiona as pecas de UMA janela em lotes.
 *
 * O lote carrega a janela junto, e nao apenas os codigos, porque o download
 * precisa declarar exatamente a mesma janela que gerou aqueles codigos.
 * Um lote nunca mistura codigos de consultas diferentes. Ver RF-08.
 */
export function particionar(pecas, janela, tamanho = TAMANHO_LOTE_PADRAO) {
  const lotes = [];
  for (let i = 0; i < pecas.length; i += tamanho) {
    const fatia = pecas.slice(i, i + tamanho);
    lotes.push({
      janela: { paginaInicial: janela.paginaInicial, paginaFinal: janela.paginaFinal },
      paginas: fatia.map(p => p.codigo),
      pecas: fatia,
      folhaInicial: fatia[0].folha,
      folhaFinal: fatia[fatia.length - 1].folha,
      paginasEsperadas: fatia.every(p => Number.isFinite(p.paginas))
        ? fatia.reduce((s, p) => s + p.paginas, 0)
        : null
    });
  }
  return lotes;
}

/** Numero do processo sem pontuacao, usado como prefixo e nome de subpasta. */
export function limparCnj(cnj) {
  return String(cnj || '').replace(/\D/g, '') || 'processo';
}

export function nomeArquivo(cnj, sequencial, folhaInicial, folhaFinal) {
  const limpo = limparCnj(cnj);
  const seq = String(sequencial).padStart(3, '0');
  return `${limpo}/${limpo}_${seq}_${folhaInicial}-${folhaFinal}.pdf`;
}
