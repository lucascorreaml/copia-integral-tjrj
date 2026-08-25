// Conferencia de integridade do arquivo recebido.
//
// A trava que importa e o tamanho minimo. O servidor responde a codigo invalido
// e a limitacao de taxa com status 200, tipo application/pdf e um arquivo de
// 941 bytes. A assinatura da falha e indistinguivel do sucesso pelos metadados
// da resposta, e por isso a conferencia de tamanho e obrigatoria. Ver RF-15b.

export const BYTES_MINIMOS = 10000;

// Piso proporcional ao tamanho do lote.
//
// O piso absoluto de dez mil bytes pega a resposta degenerada de 941 bytes, mas
// nao pega um lote de cinquenta pecas que volte com doze mil, que tambem e
// degenerado e hoje passaria. A menor razao ja medida contra o tribunal foi de
// vinte mil bytes por peca, no teste de cinquenta pecas de uma pagina. Mil bytes
// por peca fica vinte vezes abaixo disso, margem suficiente para nunca barrar
// arquivo legitimo. Ver RECON secao 4.
export const BYTES_MINIMOS_POR_PECA = 1000;

/** Menor tamanho aceitavel para um lote de `nPecas` pecas. */
export function pisoDeBytes(nPecas) {
  const n = Number(nPecas);
  if (!Number.isFinite(n) || n <= 0) return BYTES_MINIMOS;
  return Math.max(BYTES_MINIMOS, Math.round(n * BYTES_MINIMOS_POR_PECA));
}

/** Assinatura de PDF nos primeiros bytes. */
export function parecePdf(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Contagem de paginas, melhor esforco.
 *
 * Le os objetos de pagina nao comprimidos. PDFs que guardam os objetos em
 * fluxos comprimidos devolvem contagem baixa ou zero, e por isso o resultado
 * e ADVERTENCIA, nunca causa de rejeicao. A rejeicao vem do tamanho.
 */
export function contarPaginas(bytes) {
  let texto = '';
  const pedaco = 32768;
  for (let i = 0; i < bytes.length; i += pedaco) {
    texto += String.fromCharCode.apply(null, bytes.subarray(i, i + pedaco));
  }
  const casadas = texto.match(/\/Type\s*\/Page(?![sC])/g);
  return casadas ? casadas.length : 0;
}

/**
 * Verifica um lote recebido.
 * `paginasEsperadas` pode ser null quando alguma peca do lote ainda nao teve a
 * extensao fechada, o que acontece na ultima peca de cada janela.
 * `nPecas` eleva o piso de tamanho, e quando omitido vale o piso absoluto.
 */
export function verificarLote(bytes, paginasEsperadas, nPecas) {
  const problemas = [];
  const avisos = [];
  const piso = pisoDeBytes(nPecas);

  if (!parecePdf(bytes)) problemas.push('o arquivo nao comeca com assinatura de PDF');
  if (bytes.length < piso) {
    problemas.push(`arquivo degenerado, ${bytes.length} bytes, abaixo do minimo de ${piso}`);
  }

  const paginas = contarPaginas(bytes);
  if (paginas === 0) {
    avisos.push('nao foi possivel contar paginas, provavelmente objetos comprimidos');
  } else if (Number.isFinite(paginasEsperadas) && paginasEsperadas !== null && paginas !== paginasEsperadas) {
    avisos.push(`contagem de paginas divergente, ${paginas} lidas contra ${paginasEsperadas} esperadas`);
  }

  return { valido: problemas.length === 0, problemas, avisos, paginasLidas: paginas };
}
