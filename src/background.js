// Ponte minima. Nao executa trabalho longo, porque o service worker do MV3
// e encerrado por inatividade. Toda a orquestracao vive em runner.html.

const PREFIXO = 'https://www3.tjrj.jus.br/visproc/';

/**
 * Duas abas de execucao para o mesmo processo escreveriam no mesmo registro de
 * progresso, e a que salvasse por ultimo apagaria os avancos da outra, o que
 * produz peca baixada duas vezes e peca perdida. Alem disso dobraria a pressao
 * sobre o limite de requisicoes do tribunal, que e o perigo numero um.
 *
 * Por isso o clique reaproveita a aba que ja existe em vez de abrir outra.
 * A aba e localizada pelo identificador guardado, e nao por consulta de URL,
 * que exigiria a permissao "tabs" so para isso.
 */
async function abaGuardada(chave) {
  const guardado = (await chrome.storage.session.get(chave))[chave];
  if (!guardado) return null;
  try {
    return await chrome.tabs.get(guardado);
  } catch (_) {
    return null; // fechada pelo usuario
  }
}

chrome.action.onClicked.addListener(async (aba) => {
  const base = chrome.runtime.getURL('src/runner.html');
  const ehVisproc = aba && typeof aba.url === 'string' && aba.url.startsWith(PREFIXO);
  const destino = ehVisproc ? `${base}?aba=${aba.id}` : `${base}?erro=aba`;
  const chave = `runner:${ehVisproc ? aba.id : 'erro'}`;

  const existente = await abaGuardada(chave);
  if (existente) {
    await chrome.tabs.update(existente.id, { active: true });
    if (existente.windowId != null) {
      await chrome.windows.update(existente.windowId, { focused: true });
    }
    return;
  }

  const nova = await chrome.tabs.create({ url: destino });
  await chrome.storage.session.set({ [chave]: nova.id });
});
