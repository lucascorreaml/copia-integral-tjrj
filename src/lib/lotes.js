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

// Nomeacao dos arquivos de saida.
//
// Formato: <processo> - fls 00974 a 01040 - Parte 007.pdf, dentro de subpasta
// nomeada pelo processo. Tres decisoes, cada uma por um motivo pratico:
//
// O processo vem na frente porque arquivo arrastado para fora da pasta, para
// um e-mail ou para a pasta de outro caso, precisa continuar dizendo de que
// processo e, e nao pode colidir com a Parte 001 de outro processo.
//
// As folhas levam zeros a esquerda porque a ordenacao do Explorer e alfabetica:
// sem os zeros, a folha 1000 viria antes da folha 999.
//
// A palavra "Parte" existe porque parede de digito nao se le. O sequencial
// sozinho vira mais um numero no meio de vinte outros.
const LARGURA_FOLHA = 5;
const LARGURA_PARTE = 3;

export function nomeArquivo(cnj, sequencial, folhaInicial, folhaFinal) {
  const limpo = limparCnj(cnj);
  const de = String(folhaInicial).padStart(LARGURA_FOLHA, '0');
  const ate = String(folhaFinal).padStart(LARGURA_FOLHA, '0');
  const parte = String(sequencial).padStart(LARGURA_PARTE, '0');
  return `${limpo}/${limpo} - fls ${de} a ${ate} - Parte ${parte}.pdf`;
}

/** O manifesto acompanha o mesmo padrao, para ficar junto na ordenacao. */
export function nomeManifesto(cnj) {
  const limpo = limparCnj(cnj);
  return `${limpo}/${limpo} - manifesto.json`;
}
