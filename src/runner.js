// Orquestracao. Vive numa aba de extensao, e nao no service worker, porque o
// service worker do MV3 e encerrado por inatividade e o trabalho leva minutos.
//
// Este arquivo e cola e interface. Toda decisao vive em src/lib/, onde e pura
// e testavel fora do navegador.

import {
  achatar, totalDeFolhas, montarJanelas, pecasDaJanela,
  removerJaVistas, calcularExtensoes, ordenar
} from './lib/indexador.js';
import { particionar, nomeArquivo, limparCnj } from './lib/lotes.js';
import { verificarLote } from './lib/conferencia.js';
import { carregar, salvar, apagar, estadoNovo } from './lib/estado.js';
import { registrarErro, errosPendentes, conciliar, janelaVaziaEhLegitima } from './lib/conciliacao.js';
import { conferir as conferirMarcadoresDoLote } from './lib/marcadores.js';

const ESPERA_APOS_LIMITE_MS = 5 * 60 * 1000;
const MAX_TENTATIVAS = 3;
const INTERVALO_MAXIMO_MS = 120000;
const LIMITE_GRAVACAO_MS = 120000;

// DA = documentos e anexos, SD = somente documentos, SA = somente anexos.
// O padrao e DA, porque e a integra dos autos. Com SD a numeracao de folhas
// continua correndo por cima dos anexos, e por isso a conferencia de paginas
// acusa divergencia legitima: as folhas existem, os arquivos nao vieram.
const NOMES_TIPOS = { DA: 'documentos e anexos', SD: 'somente documentos', SA: 'somente anexos' };

const el = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const abaId = Number(params.get('aba'));
const marcaDe = (j) => `${j.paginaInicial}-${j.paginaFinal}`;

let ctx = null;          // { codHash, versao, etag }
let estado = null;
let rodando = false;
let pausaPedida = false;
let intervaloMs = 8000;
let tiposArquivo = 'DA';
let relatorio = null;
let declaradasConhecidas = new Set();
let totalMudou = false;

// ------------------------------------------------------------------ registro

function reg(texto, classe) {
  const hora = new Date().toLocaleTimeString('pt-BR');
  const linha = document.createElement('div');
  if (classe) linha.className = classe;
  linha.textContent = `${hora}  ${texto}`;
  el('registro').appendChild(linha);
  el('registro').scrollTop = el('registro').scrollHeight;
}

function pintar() {
  if (!estado) return;
  el('vCnj').textContent = estado.cnj || '—';
  el('vTotal').textContent = estado.total ? estado.total.toLocaleString('pt-BR') : '—';
  el('vPecas').textContent = estado.vistos.length.toLocaleString('pt-BR');
  el('vLotes').textContent = String(estado.lotes.filter(l => l.situacao === 'concluido').length);
  // Erro PENDENTE, e nao erro historico: lote que falhou e depois foi baixado
  // nao pode continuar contando para sempre.
  el('vErros').textContent = String(errosPendentes(estado.lotes, new Set(estado.vistos)).length);
  const pct = estado.total ? Math.min(100, Math.round((maiorFolhaVista() / estado.total) * 100)) : 0;
  el('progresso').style.width = pct + '%';
}

function maiorFolhaVista() {
  let m = 0;
  for (const l of estado.lotes) if (l.situacao === 'concluido' && l.folhaFinal > m) m = l.folhaFinal;
  return m;
}

// -------------------------------------------------------------------- ponte

async function pedir(tipo, args) {
  let r;
  try {
    r = await chrome.tabs.sendMessage(abaId, { tipo, args });
  } catch (e) {
    throw new Error('a aba do processo não respondeu. Ela foi fechada ou recarregada?');
  }
  if (!r) throw new Error('resposta vazia da aba do processo');
  if (!r.ok) {
    const erro = new Error(r.erro || 'erro desconhecido');
    erro.limitado = Boolean(r.limitado);
    erro.status = r.status;
    throw erro;
  }
  return r.dados;
}

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Espera longa que atende o botao Pausar. A espera de cinco minutos do limite
 * de requisicoes ficaria surda ao usuario se dormisse de uma vez so.
 * Devolve false quando foi interrompida.
 */
async function dormirAtento(ms) {
  const FATIA = 1000;
  for (let passou = 0; passou < ms; passou += FATIA) {
    if (pausaPedida) return false;
    await dormir(Math.min(FATIA, ms - passou));
  }
  return !pausaPedida;
}

// ------------------------------------------------------------------- estado

async function salvarEstado() {
  try {
    await salvar(ctx.codHash, estado);
  } catch (e) {
    throw new Error(
      `não consegui gravar o progresso: ${e.message}. ` +
      'Se a mensagem falar em cota de armazenamento, use Limpar progresso e recomece.'
    );
  }
}

/**
 * Traduz o veredito dos marcadores em linhas legiveis.
 * Nenhuma delas barra o arquivo: sao observacao, para que a divergencia
 * apareca no registro e no manifesto e possa ser medida contra execucao real.
 */
function avisosDeMarcador(marcas) {
  if (!marcas) return [];
  if (!marcas.legivel) return [`não consegui ler os marcadores deste arquivo (${marcas.motivo})`];
  if (marcas.confere) return [];
  const linhas = [];
  const amostrar = (lista, comoTexto) =>
    lista.slice(0, 3).map(comoTexto).join(', ') + (lista.length > 3 ? ' e outras' : '');
  if (marcas.ausentes.length) {
    linhas.push(`os marcadores não trazem ${marcas.ausentes.length} peça(s) que foram pedidas: ` +
      amostrar(marcas.ausentes, p => `folha ${p.folha}`));
  }
  if (marcas.inesperadas.length) {
    linhas.push(`os marcadores trazem ${marcas.inesperadas.length} peça(s) que não foram pedidas: ` +
      amostrar(marcas.inesperadas, f => `folha ${f}`));
  }
  return linhas;
}

/** Registra que o indice declarou estas pecas. E contra isto que se concilia. */
function declararPecas(pecas) {
  for (const p of pecas) {
    if (declaradasConhecidas.has(p.codDoctoElet)) continue;
    declaradasConhecidas.add(p.codDoctoElet);
    estado.declaradas.push({ codDoctoElet: p.codDoctoElet, folha: p.folha, rotulo: p.rotulo });
  }
}

// ------------------------------------------------------------------- salvar

async function salvarPdf(bytes, caminho, bytesEsperados) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  try {
    const id = await chrome.downloads.download({
      url, filename: caminho, saveAs: false, conflictAction: 'uniquify'
    });
    return await confirmarGravacao(id, bytesEsperados);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
}

/**
 * chrome.downloads.download resolve quando o download COMECA.
 * Sem esperar o estado final, disco cheio, antivirus ou interrupcao deixariam o
 * lote registrado como concluido no manifesto sem arquivo nenhum na pasta.
 *
 * A interrupcao e causa de erro, porque e definitiva. A divergencia de bytes e
 * apenas advertencia: [A VERIFICAR] se bytesReceived de um download vindo de
 * blob acompanha sempre o tamanho do blob. Enquanto isso nao for medido, ela
 * nao pode barrar arquivo de uma ferramenta que funciona.
 */
async function confirmarGravacao(id, bytesEsperados) {
  const PASSO = 500;
  for (let esperou = 0; esperou <= LIMITE_GRAVACAO_MS; esperou += PASSO) {
    const [item] = await chrome.downloads.search({ id });
    if (!item) throw new Error('o Chrome não registrou este download');
    if (item.state === 'interrupted') {
      throw new Error(`o Chrome interrompeu a gravação: ${item.error || 'motivo não informado'}`);
    }
    if (item.state === 'complete') {
      const aviso = (Number.isFinite(bytesEsperados) && Number.isFinite(item.bytesReceived)
        && item.bytesReceived !== bytesEsperados)
        ? `gravado com ${item.bytesReceived} bytes, recebido do tribunal com ${bytesEsperados}`
        : null;
      return {
        // So o nome do arquivo, nunca o caminho completo, que carrega o nome de
        // usuario da maquina e acabaria dentro do manifesto.
        nome: String(item.filename || '').split(/[\\/]/).pop() || null,
        aviso
      };
    }
    await dormir(PASSO);
  }
  throw new Error('a gravação do arquivo não terminou em dois minutos');
}

async function salvarRelatorio() {
  if (!relatorio) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(relatorio, null, 2)], { type: 'application/json' }));
  const pasta = limparCnj(estado.cnj);
  await chrome.downloads.download({
    url, filename: `${pasta}/${pasta}_manifesto.json`, saveAs: false, conflictAction: 'uniquify'
  });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  reg('manifesto salvo na pasta do processo', 'm-ok');
}

// ------------------------------------------------------------------ execucao

async function executar() {
  rodando = true;
  pausaPedida = false;
  totalMudou = false;
  el('btIniciar').disabled = true;
  el('btPausar').disabled = false;
  intervaloMs = Math.max(2, Number(el('cfgIntervalo').value) || 8) * 1000;
  tiposArquivo = el('cfgTipos').value || 'DA';
  const tamanhoLote = Math.max(1, Number(el('cfgLote').value) || 50);

  try {
    ctx = await pedir('contexto');
    if (!ctx.codHash) throw new Error('não encontrei o identificador do processo na aba. Abra o processo no visualizador.');
    if (!ctx.etag) throw new Error('não encontrei a versão do sistema no rodapé da aba. Recarregue a aba do processo e tente de novo.');
    reg(`contexto lido, versão ${ctx.versao}`);
    if (ctx.versoesCandidatas && ctx.versoesCandidatas.length > 1) {
      reg(`atenção: a página traz mais de um número com cara de versão (${ctx.versoesCandidatas.join(', ')}). Foi usado ${ctx.versao}. Se as chamadas falharem, é aqui que se olha primeiro.`, 'm-aviso');
    }

    // O estado e lido ANTES da primeira chamada de rede, para que o conflito de
    // filtro seja recusado sem custar requisicao ao tribunal.
    const anterior = await carregar(ctx.codHash);
    // Trocar o filtro no meio de um processo ja iniciado muda a arvore inteira e,
    // com ela, os codigos. Misturar os dois modos produziria arquivos incoerentes
    // e conferencia sem sentido, entao a execucao para e pede uma decisao.
    if (anterior && anterior.tiposArquivo && anterior.tiposArquivo !== tiposArquivo) {
      throw new Error(
        `este processo já foi iniciado com "${NOMES_TIPOS[anterior.tiposArquivo]}" e agora está em ` +
        `"${NOMES_TIPOS[tiposArquivo]}". Volte a opção anterior para continuar de onde parou, ` +
        `ou use Limpar progresso para recomeçar com a nova opção.`
      );
    }
    // O intervalo aprendido depois de um 429 sobrevive ao fechamento do
    // navegador. Voltar ao valor da tela repetiria o erro que ja custou espera.
    if (anterior && anterior.intervaloEfetivoMs > intervaloMs) {
      intervaloMs = Math.min(anterior.intervaloEfetivoMs, INTERVALO_MAXIMO_MS);
      reg(`a execução anterior teve que subir o intervalo para ${intervaloMs / 1000} s. Começando por esse valor.`, 'm-aviso');
    }

    const indices = new Map();
    async function garantirIndice(janela) {
      const c = janela.paginaInicial;
      if (indices.has(c)) return indices.get(c);
      reg(`consultando índice das folhas ${janela.paginaInicial} a ${janela.paginaFinal}`);
      const bruto = await pedir('indice', { codHash: ctx.codHash, etag: ctx.etag, tiposArquivo, ...janela });
      indices.set(c, bruto);
      await dormir(intervaloMs);
      return bruto;
    }

    const primeira = await garantirIndice({ paginaInicial: 1, paginaFinal: 1000 });
    const total = totalDeFolhas(primeira);
    if (!total) throw new Error('a resposta do índice não trouxe ultFolVirt');

    estado = anterior || estadoNovo(ctx.codHash, primeira.codCnj, total, tiposArquivo);
    // Estado gravado por versao anterior da extensao nao tem estes campos.
    if (!Array.isArray(estado.declaradas)) {
      estado.declaradas = [];
      if (estado.janelasConcluidas.length > 0) {
        reg('o progresso salvo vem de uma versão anterior, que não registrava o que o índice declarou. A conferência final cobre apenas as janelas varridas de agora em diante.', 'm-aviso');
      }
    }
    estado.total = total;
    estado.tiposArquivo = tiposArquivo;
    declaradasConhecidas = new Set(estado.declaradas.map(p => p.codDoctoElet));
    reg(`filtro: ${NOMES_TIPOS[tiposArquivo]}`);
    if (anterior) reg(`progresso anterior encontrado, ${anterior.lotes.filter(l => l.situacao === 'concluido').length} lotes já concluídos`, 'm-ok');
    pintar();

    const janelas = montarJanelas(total);
    reg(`processo com ${total.toLocaleString('pt-BR')} folhas, ${janelas.length} janelas`);

    const vistos = new Set(estado.vistos);

    for (let i = 0; i < janelas.length; i++) {
      if (pausaPedida) { reg('pausado a pedido', 'm-aviso'); break; }
      const janela = janelas[i];
      const marca = marcaDe(janela);
      if (estado.janelasConcluidas.includes(marca)) { reg(`janela ${marca} já concluída, pulando`); continue; }

      const bruto = await garantirIndice(janela);
      // A janela seguinte e consultada antes de baixar esta, para que a ultima
      // peca desta janela tenha sucessora conhecida e a extensao dela feche.
      if (janelas[i + 1]) await garantirIndice(janelas[i + 1]);

      // O processo pode receber juntada nova no meio de uma execucao longa.
      const totalAgora = totalDeFolhas(bruto);
      if (totalAgora && totalAgora !== estado.total && !totalMudou) {
        totalMudou = true;
        reg(`o total de folhas passou de ${estado.total.toLocaleString('pt-BR')} para ${totalAgora.toLocaleString('pt-BR')} durante a execução. Houve juntada nova. Ao terminar, clique em Iniciar outra vez para pegar o que entrou.`, 'm-aviso');
      }

      // Lista global, para calcular extensao na ordenacao correta.
      const global = [];
      const jaNaGlobal = new Set();
      for (const arvore of indices.values()) {
        for (const p of achatar(arvore)) {
          if (!jaNaGlobal.has(p.codDoctoElet)) { jaNaGlobal.add(p.codDoctoElet); global.push(p); }
        }
      }
      // A ultima peca do processo so pode usar ultFolVirt quando o indice da
      // ULTIMA janela ja foi carregado. Condicionar isso ao indice do laco erra
      // sempre que a ultima peca comeca antes da ultima janela, e foi o que
      // aconteceu no processo de teste: a peca da folha 12997 ficou sem
      // extensao, e o lote dela foi salvo sem conferencia de contagem.
      const ultimaJanela = janelas[janelas.length - 1];
      const temTudo = indices.has(ultimaJanela.paginaInicial);
      const comExtensao = calcularExtensoes(ordenar(global), total, { completo: temTudo });
      const mapaExtensao = new Map(comExtensao.map(p => [p.codDoctoElet, p.paginas]));

      // Os codigos TEM que vir do indice DESTA janela, porque sao relativos a ela.
      const todasDoIndice = achatar(bruto);
      const daJanela = pecasDaJanela(todasDoIndice, janela);

      if (daJanela.length === 0) {
        // Janela sem peca propria e legitima quando uma unica peca comecada
        // antes dela a atravessa inteira. Fora disso e consulta truncada, e
        // marcar concluida apagaria estas folhas dos autos sem emitir aviso.
        const atravessada = todasDoIndice.length > 0
          || janelaVaziaEhLegitima(ordenar(estado.declaradas), janela);
        if (!atravessada) {
          reg(`janela ${marca}: o índice não declarou peça alguma e nenhuma peça anterior atravessa esta faixa. Consulta possivelmente truncada. A janela NÃO foi dada por concluída.`, 'm-erro');
          continue;
        }
        reg(`janela ${marca} atravessada por peça iniciada antes dela, sem peça própria`, 'm-aviso');
        estado.janelasConcluidas.push(marca);
        await salvarEstado();
        continue;
      }

      declararPecas(daJanela);
      const novas = removerJaVistas(daJanela, vistos)
        .map(p => ({ ...p, paginas: mapaExtensao.get(p.codDoctoElet) ?? null }));

      if (novas.length === 0) {
        reg(`janela ${marca}: ${daJanela.length} peça(s), todas já baixadas`);
        estado.janelasConcluidas.push(marca);
        await salvarEstado();
        continue;
      }

      const lotes = particionar(ordenar(novas), janela, tamanhoLote);
      reg(`janela ${marca}: ${novas.length} peças em ${lotes.length} lote(s)`);

      let janelaInteiraOk = true;
      for (const lote of lotes) {
        if (pausaPedida) { reg('pausado a pedido', 'm-aviso'); janelaInteiraOk = false; break; }
        const ok = await processarLote(lote, vistos);
        if (!ok) janelaInteiraOk = false;
        await dormirAtento(intervaloMs);
      }

      if (janelaInteiraOk) estado.janelasConcluidas.push(marca);
      await salvarEstado();
      pintar();
    }

    const veredito = conciliar({
      declaradas: estado.declaradas,
      vistos,
      lotes: estado.lotes,
      janelasEsperadas: janelas.map(marcaDe),
      janelasConcluidas: estado.janelasConcluidas
    });
    montarRelatorio(veredito);
    el('btRelatorio').disabled = false;
    await anunciarVeredito(veredito);

  } catch (e) {
    reg(`ERRO: ${e.message}`, 'm-erro');
  } finally {
    rodando = false;
    el('btIniciar').disabled = false;
    el('btPausar').disabled = true;
    if (estado && ctx) {
      try { await salvarEstado(); } catch (e) { reg(`ERRO: ${e.message}`, 'm-erro'); }
    }
    pintar();
  }
}

/**
 * O veredito nao vem do diario de lotes, e sim da conciliacao contra o indice.
 * Foi confiar no diario que fez a extensao anunciar conclusao com lote faltando.
 */
async function anunciarVeredito(v) {
  if (v.errosSanados > 0) {
    reg(`${v.errosSanados} lote(s) que já haviam falhado estão baixados e deixaram de pesar.`, 'm-ok');
  }

  // Camada 3, em modo de observação. Não altera o veredito, mas precisa ser
  // vista, porque é a medição que decide se ela pode virar trava de verdade.
  const comMarcas = estado.lotes.filter(l => l.situacao === 'concluido' && l.marcadores);
  const divergentes = comMarcas.filter(l => l.marcadores.legivel && !l.marcadores.confere);
  const ilegiveis = comMarcas.filter(l => !l.marcadores.legivel);
  if (divergentes.length) {
    reg(`ATENÇÃO: em ${divergentes.length} de ${comMarcas.length} lote(s), os marcadores do PDF não bateram com a lista de peças pedida. Isso não barrou nada e é só observação. O detalhe está no manifesto, em lotes[].marcadores. Vale me mostrar.`, 'm-aviso');
  } else if (comMarcas.length > 0 && ilegiveis.length === comMarcas.length) {
    reg('não consegui ler os marcadores de nenhum lote. A conferência por tamanho e a conciliação contra o índice continuam valendo.', 'm-aviso');
  } else if (comMarcas.length > 0) {
    reg(`marcadores conferidos em ${comMarcas.length - ilegiveis.length} de ${comMarcas.length} lote(s), sem divergência.`, 'm-ok');
  }

  if (pausaPedida) {
    reg('pausado. Clique em Iniciar para continuar de onde parou.', 'm-aviso');
    return;
  }
  if (v.completo && !totalMudou) {
    reg('CONCLUÍDO. Todas as janelas foram varridas e todas as peças que o índice declarou estão baixadas.', 'm-ok');
    await salvarRelatorio();
    return;
  }
  if (totalMudou) {
    reg('o processo cresceu durante a execução. Clique em Iniciar outra vez para pegar as folhas novas.', 'm-aviso');
  }
  if (v.janelasPendentes.length) {
    reg(`faltou varrer ${v.janelasPendentes.length} janela(s): ${v.janelasPendentes.slice(0, 8).join(', ')}${v.janelasPendentes.length > 8 ? ' e outras' : ''}`, 'm-erro');
  }
  if (v.lotesPendentes.length) {
    reg(`${v.lotesPendentes.length} lote(s) continuam em erro.`, 'm-erro');
  }
  if (v.faltantes.length) {
    reg(`${v.faltantes.length} peça(s) declaradas pelo índice NÃO foram baixadas. As primeiras:`, 'm-erro');
    for (const p of v.faltantes.slice(0, 10)) reg(`      folha ${p.folha} — ${p.rotulo}`, 'm-erro');
    if (v.faltantes.length > 10) reg('      a lista completa está no manifesto.', 'm-erro');
  }
  reg('Clique em Iniciar de novo para refazer só o que falta.', 'm-aviso');
  // O manifesto e salvo tambem quando falta coisa, porque e justamente ai que
  // ele serve: e a prova, peca a peca, do que ficou de fora.
  await salvarRelatorio();
}

async function processarLote(lote, vistos) {
  const rotulo = `lote folhas ${lote.folhaInicial} a ${lote.folhaFinal} (${lote.pecas.length} peças)`;
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      reg(`${rotulo}: baixando${tentativa > 1 ? `, tentativa ${tentativa}` : ''}`);
      const r = await pedir('download', {
        codHash: ctx.codHash,
        etag: ctx.etag,
        tiposArquivo,
        paginaInicial: lote.janela.paginaInicial,
        paginaFinal: lote.janela.paginaFinal,
        paginas: lote.paginas
      });

      const binario = atob(r.base64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

      const conf = verificarLote(bytes, lote.paginasEsperadas, lote.pecas.length);
      if (!conf.valido) throw new Error(conf.problemas.join('; '));
      for (const aviso of conf.avisos) {
        const nota = (tiposArquivo === 'SD' && aviso.includes('divergente'))
          ? ' (esperado no modo somente documentos: as folhas dos anexos contam na numeração, mas os arquivos não vêm)'
          : '';
        reg(`${rotulo}: ${aviso}${nota}`, 'm-aviso');
      }

      // Camada 3: os marcadores do PDF declaram, peça a peça, o que o arquivo
      // contém. É a conferência mais forte disponível, porque não depende de
      // metadado de resposta nem de estimativa de tamanho.
      //
      // ADVERTÊNCIA, e não rejeição, enquanto o leitor não tiver sido medido
      // contra execução real. Barrar arquivo com base numa leitura nunca
      // exercitada contra PDF do tribunal seria trocar uma ferramenta que
      // funciona por uma suposição. Ver src/lib/marcadores.js.
      const marcas = await conferirMarcadoresDoLote(bytes, lote.pecas);
      for (const aviso of avisosDeMarcador(marcas)) {
        conf.avisos.push(aviso);
        reg(`${rotulo}: ${aviso}`, 'm-aviso');
      }

      // O sequencial so e consumido quando existe arquivo para carregar o numero.
      // Antes ele era gasto antes do download e devolvido na falha, o que fazia
      // dois registros do manifesto compartilharem o mesmo numero.
      const seq = estado.sequencial + 1;
      const caminho = nomeArquivo(estado.cnj, seq, lote.folhaInicial, lote.folhaFinal);
      const gravacao = await salvarPdf(bytes, caminho, r.bytes);
      estado.sequencial = seq;
      if (gravacao.aviso) {
        conf.avisos.push(gravacao.aviso);
        reg(`${rotulo}: ${gravacao.aviso}`, 'm-aviso');
      }

      for (const p of lote.pecas) vistos.add(p.codDoctoElet);
      estado.vistos = [...vistos];
      estado.lotes.push({
        sequencial: seq, situacao: 'concluido', caminho, nomeGravado: gravacao.nome,
        janela: lote.janela, folhaInicial: lote.folhaInicial, folhaFinal: lote.folhaFinal,
        pecas: lote.pecas.map(p => ({ folha: p.folha, rotulo: p.rotulo, codDoctoElet: p.codDoctoElet, paginas: p.paginas })),
        paginasEsperadas: lote.paginasEsperadas, paginasLidas: conf.paginasLidas,
        marcadores: {
          legivel: marcas.legivel,
          confere: marcas.confere,
          motivo: marcas.motivo,
          folhasSemMarcador: marcas.ausentes.map(p => p.folha),
          marcadoresInesperados: marcas.inesperadas
        },
        bytes: r.bytes, ms: r.ms, avisos: conf.avisos
      });
      await salvarEstado();
      reg(`${rotulo}: salvo como ${gravacao.nome || caminho}, ${(r.bytes / 1048576).toFixed(2)} MB em ${(r.ms / 1000).toFixed(1)} s`, 'm-ok');
      pintar();
      return true;

    } catch (e) {
      ultimoErro = e;
      if (e.limitado) {
        intervaloMs = Math.min(intervaloMs * 2, INTERVALO_MAXIMO_MS);
        estado.intervaloEfetivoMs = intervaloMs;
        reg(`${rotulo}: limite de requisições atingido. Esperando cinco minutos e dobrando o intervalo para ${intervaloMs / 1000} s.`, 'm-aviso');
        try { await salvarEstado(); } catch (_) { /* nao pode mascarar o erro do lote */ }
        if (tentativa < MAX_TENTATIVAS) await dormirAtento(ESPERA_APOS_LIMITE_MS);
      } else {
        reg(`${rotulo}: falhou, ${e.message}`, 'm-erro');
        if (tentativa < MAX_TENTATIVAS) await dormirAtento(5000 * Math.pow(2, tentativa - 1));
      }
      if (pausaPedida) break;
    }
  }

  // Saida UNICA de falha. Antes havia um caminho, o do limite de requisicoes
  // esgotado, que devolvia falso sem gravar registro nenhum: a execucao
  // terminava anunciando "concluído sem erros" com um lote inteiro faltando.
  const causa = pausaPedida
    ? 'pausado antes de concluir o lote'
    : (ultimoErro && ultimoErro.limitado
      ? `limitação de taxa persistente após ${MAX_TENTATIVAS} tentativas`
      : (ultimoErro ? ultimoErro.message : 'motivo desconhecido'));
  reg(`${rotulo}: DESISTINDO, ${causa}. Este lote NÃO foi baixado.`, 'm-erro');
  estado.lotes = registrarErro(estado.lotes, {
    sequencial: null, situacao: 'erro', janela: lote.janela,
    folhaInicial: lote.folhaInicial, folhaFinal: lote.folhaFinal,
    pecas: lote.pecas.map(p => ({ folha: p.folha, rotulo: p.rotulo, codDoctoElet: p.codDoctoElet })),
    erro: causa
  });
  try { await salvarEstado(); } catch (e) { reg(`ERRO: ${e.message}`, 'm-erro'); }
  pintar();
  return false;
}

function montarRelatorio(veredito) {
  const concluidos = estado.lotes.filter(l => l.situacao === 'concluido');
  const paginasEsperadas = concluidos.reduce((s, l) => s + (l.paginasEsperadas || 0), 0);
  const paginasLidas = concluidos.reduce((s, l) => s + (l.paginasLidas || 0), 0);
  relatorio = {
    processo: estado.cnj,
    totalDeFolhas: estado.total,
    filtro: `${estado.tiposArquivo} (${NOMES_TIPOS[estado.tiposArquivo] || 'desconhecido'})`,
    versaoDoVisualizador: ctx && ctx.versao ? ctx.versao : null,
    geradoEm: new Date().toISOString(),
    // Este e o campo que responde a pergunta que importa. Ele nao vem da
    // contagem de lotes, e sim da conciliacao contra o que o indice declarou.
    conferencia: {
      completo: Boolean(veredito.completo) && !totalMudou,
      totalDeFolhasMudouDurante: totalMudou,
      pecasDeclaradasPeloIndice: estado.declaradas.length,
      pecasBaixadas: estado.vistos.length,
      pecasFaltantes: veredito.faltantes,
      janelasNaoVarridas: veredito.janelasPendentes,
      lotesAindaEmErro: veredito.lotesPendentes.length,
      lotesQueFalharamEForamRefeitos: veredito.errosSanados,
      // Camada 3, em modo de observacao. Nao entra no veredito de completo.
      marcadores: {
        lotesConferidos: concluidos.filter(l => l.marcadores && l.marcadores.legivel).length,
        lotesIlegiveis: concluidos.filter(l => l.marcadores && !l.marcadores.legivel).length,
        lotesDivergentes: concluidos.filter(l => l.marcadores && l.marcadores.legivel && !l.marcadores.confere).length
      }
    },
    resumo: {
      lotesConcluidos: concluidos.length,
      pecasBaixadas: estado.vistos.length,
      paginasEsperadasSomadas: paginasEsperadas,
      paginasLidasSomadas: paginasLidas,
      diferencaDePaginas: paginasLidas - paginasEsperadas,
      lotesSemConferencia: concluidos.filter(l => l.paginasEsperadas === null).length,
      bytesTotais: concluidos.reduce((s, l) => s + (l.bytes || 0), 0)
    },
    lotes: estado.lotes
  };
  reg(`relatório montado: ${estado.declaradas.length} peças declaradas pelo índice, ${estado.vistos.length} baixadas, ${veredito.faltantes.length} faltando`);
}

// ------------------------------------------------------------------ eventos

el('btIniciar').addEventListener('click', () => { if (!rodando) executar(); });
el('btPausar').addEventListener('click', () => { pausaPedida = true; reg('pausa pedida, encerrando após o lote atual', 'm-aviso'); });
el('btRelatorio').addEventListener('click', () => salvarRelatorio());
el('btLimpar').addEventListener('click', async () => {
  if (rodando) { reg('pare a execução antes de limpar o progresso', 'm-aviso'); return; }
  if (!ctx || !ctx.codHash) { reg('nada para limpar ainda'); return; }
  if (!confirm('Apagar o progresso salvo deste processo? Os arquivos já baixados permanecem na pasta.')) return;
  await apagar(ctx.codHash);
  estado = null;
  declaradasConhecidas = new Set();
  reg('progresso apagado', 'm-aviso');
});

if (params.get('erro') === 'aba') {
  reg('Abra o processo no Visualizador de Processos Eletrônicos e clique no ícone da extensão a partir daquela aba.', 'm-erro');
  el('btIniciar').disabled = true;
} else {
  reg('pronto. Confira as configurações e clique em Iniciar.');
}
