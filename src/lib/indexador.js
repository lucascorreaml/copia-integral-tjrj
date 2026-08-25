// Funcoes puras sobre a resposta do indice. Sem acesso a rede, sem estado.
// Sao estas as funcoes cobertas pelos testes automatizados.

export const TAMANHO_JANELA = 1000;

/**
 * Achata a arvore recursiva devolvida por consultarProcesso.
 * So entram nos que possuem codDoctoElet, isto e, pecas de verdade.
 * Nos de agrupamento (Processo, Volume, Juntada) nao tem esse campo.
 */
export function achatar(no, saida = []) {
  if (!no || typeof no !== 'object') return saida;
  if (no.codDoctoElet) {
    saida.push({
      codigo: Number(no.codigo),
      folha: Number(no.numFolVirt),
      rotulo: String(no.descricao || '').trim(),
      codDoctoElet: String(no.codDoctoElet)
    });
  }
  const filhos = Array.isArray(no.filhos) ? no.filhos : [];
  for (const filho of filhos) achatar(filho, saida);
  return saida;
}

/** Total de folhas do processo, presente no no raiz de qualquer consulta. */
export function totalDeFolhas(raiz) {
  const n = Number(raiz && raiz.ultFolVirt);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Janelas de mil folhas cobrindo o processo inteiro. */
export function montarJanelas(total, tamanho = TAMANHO_JANELA) {
  const janelas = [];
  for (let inicio = 1; inicio <= total; inicio += tamanho) {
    janelas.push({ paginaInicial: inicio, paginaFinal: Math.min(inicio + tamanho - 1, total) });
  }
  return janelas;
}

/**
 * Pecas que pertencem a esta janela.
 *
 * O indice devolve pecas que COMECAM antes da janela pedida, porque o servidor
 * inclui a peca que atravessa a borda. Atribuir cada peca a janela em que a sua
 * folha de inicio cai evita que a mesma peca seja baixada duas vezes.
 */
export function pecasDaJanela(pecas, janela) {
  return pecas.filter(p => p.folha >= janela.paginaInicial && p.folha <= janela.paginaFinal);
}

/**
 * Remove pecas ja processadas, comparando por codDoctoElet.
 *
 * NUNCA comparar por codigo: o codigo e relativo a janela consultada, e a mesma
 * peca recebe numeros diferentes em janelas diferentes. Ver RECON secao 2.5.1.
 */
export function removerJaVistas(pecas, vistos) {
  return pecas.filter(p => !vistos.has(p.codDoctoElet));
}

/**
 * Extensao em paginas de cada peca, calculada na ordenacao GLOBAL.
 *
 * A extensao de uma peca e a distancia ate a folha de inicio da peca seguinte.
 * Apenas a ultima peca do PROCESSO usa ultFolVirt como referencia. Tratar a
 * ultima peca de uma janela como ultima do processo produz valores absurdos,
 * porque a distancia passa a ser medida contra o fim dos autos. Ver RF-07.
 *
 * Pecas cuja seguinte ainda nao e conhecida recebem extensao null, e a
 * conferencia delas fica pendente ate a janela seguinte ser consultada.
 */
export function calcularExtensoes(pecasOrdenadas, ultFolVirt, { completo = false } = {}) {
  return pecasOrdenadas.map((peca, i) => {
    const seguinte = pecasOrdenadas[i + 1];
    let paginas = null;
    if (seguinte) paginas = seguinte.folha - peca.folha;
    else if (completo && Number.isFinite(Number(ultFolVirt))) paginas = Number(ultFolVirt) - peca.folha + 1;
    return { ...peca, paginas };
  });
}

/** Ordenacao canonica, por folha de inicio. */
export function ordenar(pecas) {
  return [...pecas].sort((a, b) => a.folha - b.folha || a.codigo - b.codigo);
}
