// Persistencia do progresso, para permitir retomada apos fechamento do
// navegador, queda de sessao ou falha. Chaveado pelo codHash do processo.

const PREFIXO = 'tjrj:';

function chave(codHash) {
  return PREFIXO + codHash;
}

export async function carregar(codHash) {
  const c = chave(codHash);
  const dados = await chrome.storage.local.get(c);
  return dados[c] || null;
}

export async function salvar(codHash, estado) {
  await chrome.storage.local.set({ [chave(codHash)]: estado });
}

export async function apagar(codHash) {
  await chrome.storage.local.remove(chave(codHash));
}

export function estadoNovo(codHash, cnj, total, tiposArquivo) {
  return {
    codHash,
    cnj,
    total,
    tiposArquivo,
    iniciadoEm: new Date().toISOString(),
    sequencial: 0,
    vistos: [],           // codDoctoElet ja baixados, garante deduplicacao
    declaradas: [],       // codDoctoElet que o indice declarou; base da conferencia final
    lotes: [],            // diario de cada lote concluido ou em erro
    janelasConcluidas: [],
    intervaloEfetivoMs: null  // intervalo aprendido apos limitacao de taxa
  };
}

export async function listarProcessos() {
  const tudo = await chrome.storage.local.get(null);
  return Object.entries(tudo)
    .filter(([k]) => k.startsWith(PREFIXO))
    .map(([, v]) => v);
}
