// Conciliacao entre o que o indice declarou e o que efetivamente foi baixado.
//
// A pergunta "os autos vieram inteiros?" NAO pode ser respondida pelo diario de
// lotes, e essa foi a origem de duas falhas silenciosas:
//
//   1. Lote que esgota as tentativas por limitacao de taxa pode nem chegar a
//      deixar registro de erro. O diario fica limpo e o processo parece completo.
//   2. Lote que falhou e depois foi refeito deixa registro que nunca sai, e o
//      processo passa a parecer defeituoso para sempre.
//
// A unica fonte confiavel e o proprio indice: toda peca que alguma janela
// declarou tem que estar entre as baixadas, e toda janela tem que ter sido
// varrida. Ver RF-17.

function comoConjunto(vistos) {
  return vistos instanceof Set ? vistos : new Set(vistos || []);
}

/**
 * Chave estavel de um lote, formada pela janela que gerou os codigos mais as
 * pecas pedidas. Nao usa o sequencial, que muda entre execucoes, nem o codigo,
 * que e relativo a janela.
 */
export function chaveDoLote(lote) {
  const j = lote && lote.janela
    ? `${lote.janela.paginaInicial}-${lote.janela.paginaFinal}`
    : '?';
  const pecas = ((lote && lote.pecas) || []).map(p => p.codDoctoElet).sort().join(',');
  return `${j}|${pecas}`;
}

/**
 * Grava a falha de um lote, substituindo a falha anterior do MESMO lote em vez
 * de acumular. Sem isso, refazer um lote problematico tres vezes deixa tres
 * registros identicos e a contagem de erros deixa de significar alguma coisa.
 */
export function registrarErro(lotes, registro) {
  const chave = chaveDoLote(registro);
  const outros = (lotes || []).filter(l => l.situacao !== 'erro' || chaveDoLote(l) !== chave);
  return [...outros, registro];
}

/**
 * Lotes em erro cujas pecas continuam ausentes.
 * Erro sanado por execucao posterior sai da conta, porque o que importa nao e
 * ter falhado um dia, e sim faltar agora.
 */
export function errosPendentes(lotes, vistos) {
  const v = comoConjunto(vistos);
  return (lotes || []).filter(l =>
    l.situacao === 'erro' && (l.pecas || []).some(p => !v.has(p.codDoctoElet)));
}

/** Pecas declaradas pelo indice e nao baixadas, na ordem das folhas. */
export function pecasFaltantes(declaradas, vistos) {
  const v = comoConjunto(vistos);
  return (declaradas || [])
    .filter(p => !v.has(p.codDoctoElet))
    .sort((a, b) => a.folha - b.folha);
}

/**
 * Uma janela que nao declara peca alguma so e legitima quando uma unica peca
 * comecada antes dela a atravessa inteira, o que acontece em peca muito longa.
 *
 * Fora desse caso, janela vazia e sinal de consulta truncada, e trata-la como
 * concluida apagaria aquelas folhas dos autos sem emitir aviso.
 */
export function janelaVaziaEhLegitima(declaradasOrdenadas, janela) {
  const lista = declaradasOrdenadas || [];
  const antes = lista.filter(p => p.folha < janela.paginaInicial);
  if (antes.length === 0) return false;
  const ultimaAntes = antes[antes.length - 1];
  const seguinte = lista.find(p => p.folha > ultimaAntes.folha);
  return !seguinte || seguinte.folha > janela.paginaFinal;
}

/**
 * Veredito unico sobre a execucao.
 *
 * `completo` exige as tres condicoes ao mesmo tempo, e nenhuma delas basta:
 * todas as janelas varridas, porque sem varrer nao se sabe o que existe;
 * nenhuma peca declarada faltando; nenhum lote em erro ainda pendente.
 */
export function conciliar({
  declaradas = [], vistos = [], lotes = [],
  janelasEsperadas = [], janelasConcluidas = []
} = {}) {
  const v = comoConjunto(vistos);
  const faltantes = pecasFaltantes(declaradas, v);
  const lotesPendentes = errosPendentes(lotes, v);
  const janelasPendentes = janelasEsperadas.filter(m => !janelasConcluidas.includes(m));
  const errosTotais = (lotes || []).filter(l => l.situacao === 'erro').length;
  return {
    completo: faltantes.length === 0
      && lotesPendentes.length === 0
      && janelasPendentes.length === 0,
    faltantes,
    lotesPendentes,
    janelasPendentes,
    errosSanados: errosTotais - lotesPendentes.length
  };
}
