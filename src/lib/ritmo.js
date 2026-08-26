// Decisoes sobre o ritmo entre operacoes.
//
// Estao aqui, e nao no orquestrador, porque sao decisoes com consequencia:
// pedir rapido demais faz o servidor devolver arquivo vazio com aparencia de
// sucesso, que e a falha mais perigosa do sistema alvo. Ver RECON secao 4.1.

export const INTERVALO_MAXIMO_MS = 120000;

/**
 * Intervalo seguinte apos o servidor recusar por excesso de requisicoes.
 * Dobra, com teto, porque a RF-10b proibe insistir em ritmo igual ou maior.
 */
export function proximoIntervalo(atual, maximo = INTERVALO_MAXIMO_MS) {
  const n = Number(atual);
  if (!Number.isFinite(n) || n <= 0) return maximo;
  return Math.min(n * 2, maximo);
}

/**
 * Intervalo com que uma execucao comeca.
 *
 * Fica com o MAIOR entre o que esta na tela e o que a execucao anterior teve
 * que aprender depois de um 429. Voltar ao valor da tela repetiria o erro que
 * ja custou cinco minutos de espera. Ver RF-22.
 */
export function intervaloInicial(configurado, aprendido, maximo = INTERVALO_MAXIMO_MS) {
  const c = Number(configurado) || 0;
  const a = Number(aprendido) || 0;
  return Math.min(Math.max(c, a), maximo);
}

// Limiares do aviso de estrangulamento de temporizador.
// O fator sozinho nao basta: uma pausa de um segundo que vira dois e ruido,
// nao merece aviso. Por isso o excesso absoluto tambem entra na conta.
export const FATOR_ESTRANGULAMENTO = 1.5;
export const EXCESSO_MINIMO_MS = 3000;

/**
 * O navegador estica temporizador de aba em segundo plano.
 *
 * `[OBSERVADO]` no RECON, apendice A.5. Nao corrompe resultado, e no limite ate
 * reduz a pressao sobre o servico, mas uma execucao que se arrasta sem
 * explicacao parece travada, e o usuario a interrompe achando que deu errado.
 */
export function houveEstrangulamento(pedidoMs, realMs) {
  const pedido = Number(pedidoMs);
  const real = Number(realMs);
  if (!Number.isFinite(pedido) || !Number.isFinite(real) || pedido <= 0) return false;
  return real > pedido * FATOR_ESTRANGULAMENTO && (real - pedido) >= EXCESSO_MINIMO_MS;
}
