// Camada 3 da conferencia: ler os marcadores do PDF entregue e compara-los,
// item a item, com a lista de pecas que o lote pediu.
//
// Por que os marcadores. `[OBSERVADO]` no RECON secao 5: o PDF nao tem
// /PageLabels, e a numeracao dos autos viaja nos marcadores, cujos titulos
// reproduzem os rotulos da arvore com a folha a frente. No teste de cinquenta
// pecas, a lista de marcadores reproduziu a lista pedida sem omissao,
// substituicao nem reordenacao. E, portanto, o proprio arquivo declarando o
// que contem, e nao a extensao deduzindo por tamanho.
//
// ESTA CONFERENCIA E ADVERTENCIA, NUNCA REJEICAO. O leitor abaixo e de melhor
// esforco, e nunca foi exercitado contra um PDF real do tribunal, produzido
// por iText 7.2.6. Barrar arquivo com base nele seria trocar uma ferramenta
// que funciona por uma suposicao. Depois de medido contra execucao real, a
// promocao para trava dura passa a ser defensavel.
//
// Sem dependencia externa: a descompressao usa DecompressionStream, que e API
// nativa do navegador e do Node.

const MAX_FLUXOS = 64;                     // fluxos de objetos examinados por arquivo
const MAX_INFLADO = 32 * 1024 * 1024;      // teto de memoria da inflacao
const MAX_ARQUIVO = 120 * 1024 * 1024;     // acima disto, nem tenta ler
const PEDACO = 32768;

// --------------------------------------------------------------- codificacao

function comoLatin1(bytes) {
  let texto = '';
  for (let i = 0; i < bytes.length; i += PEDACO) {
    texto += String.fromCharCode.apply(null, bytes.subarray(i, i + PEDACO));
  }
  return texto;
}

/** Desfaz os escapes de uma string literal de PDF, devolvendo octetos. */
function desescapar(corpo) {
  const saida = [];
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i];
    if (c !== '\\') { saida.push(corpo.charCodeAt(i)); continue; }
    const p = corpo[++i];
    if (p === undefined) break;
    if (p >= '0' && p <= '7') {
      let oct = p;
      while (oct.length < 3 && corpo[i + 1] >= '0' && corpo[i + 1] <= '7') oct += corpo[++i];
      saida.push(parseInt(oct, 8) & 0xff);
    } else if (p === 'n') saida.push(10);
    else if (p === 'r') saida.push(13);
    else if (p === 't') saida.push(9);
    else if (p === 'b') saida.push(8);
    else if (p === 'f') saida.push(12);
    else if (p === '\n') { /* continuacao de linha, nao produz caractere */ }
    else if (p === '\r') { if (corpo[i + 1] === '\n') i++; }
    else saida.push(corpo.charCodeAt(i));   // \( \) \\ e qualquer outro
  }
  return saida;
}

/**
 * Converte os octetos no texto final.
 *
 * Marca de ordem de bytes FE FF indica UTF-16BE, que e como os acentos chegam.
 * Sem ela vale PDFDocEncoding, aproximado aqui por Latin-1: os dois coincidem
 * na faixa que interessa aos rotulos do tribunal.
 */
function comoTexto(octetos) {
  if (octetos.length >= 2 && octetos[0] === 0xFE && octetos[1] === 0xFF) {
    let texto = '';
    for (let i = 2; i + 1 < octetos.length; i += 2) {
      texto += String.fromCharCode((octetos[i] << 8) | octetos[i + 1]);
    }
    return texto;
  }
  return octetos.map(b => String.fromCharCode(b)).join('');
}

/** Decodifica uma string de PDF, literal entre parenteses ou hexadecimal. */
export function decodificarStringPdf(bruto) {
  const s = String(bruto == null ? '' : bruto).trim();
  if (s.startsWith('<')) {
    const hex = s.slice(1, s.endsWith('>') ? -1 : undefined).replace(/[^0-9A-Fa-f]/g, '');
    const par = hex.length % 2 ? hex + '0' : hex;
    const octetos = [];
    for (let i = 0; i < par.length; i += 2) octetos.push(parseInt(par.slice(i, i + 2), 16));
    return comoTexto(octetos);
  }
  const corpo = s.startsWith('(') ? s.slice(1, s.endsWith(')') ? -1 : undefined) : s;
  return comoTexto(desescapar(corpo));
}

// ------------------------------------------------------------------ leitura

/**
 * Colhe os titulos de marcador de um texto de PDF ja legivel.
 *
 * Feito a mao, e nao por expressao regular, porque titulo pode conter
 * parentese aninhado e parentese escapado, e a expressao truncaria no primeiro
 * fechamento. Um rotulo do tipo "Peticao (fls. 2) inicial" e caso real.
 */
export function extrairTitulos(texto) {
  const t = String(texto || '');
  const titulos = [];
  let i = 0;
  for (;;) {
    i = t.indexOf('/Title', i);
    if (i < 0) break;
    i += 6;
    if (/[0-9A-Za-z]/.test(t[i] || '')) continue;   // /TitleQualquerCoisa nao e /Title
    while (i < t.length && /\s/.test(t[i])) i++;

    if (t[i] === '(') {
      let profundidade = 1, j = i + 1, corpo = '';
      while (j < t.length && profundidade > 0) {
        const c = t[j];
        if (c === '\\') { corpo += c + (t[j + 1] || ''); j += 2; continue; }
        if (c === '(') profundidade++;
        else if (c === ')') { profundidade--; if (profundidade === 0) break; }
        corpo += c; j++;
      }
      if (profundidade === 0) titulos.push(decodificarStringPdf('(' + corpo + ')'));
      i = j + 1;
    } else if (t[i] === '<' && t[i + 1] !== '<') {
      const fim = t.indexOf('>', i);
      if (fim < 0) break;
      titulos.push(decodificarStringPdf(t.slice(i, fim + 1)));
      i = fim + 1;
    }
  }
  return titulos;
}

/** A folha vem na frente do rotulo, como em "974 - Laudo Pericial". */
export function folhaDoTitulo(titulo) {
  const m = String(titulo == null ? '' : titulo).match(/^\s*(\d+)\s*-/);
  return m ? Number(m[1]) : null;
}

/**
 * Descomprime aproveitando o que sair antes de qualquer erro.
 *
 * `[OBSERVADO, por sonda em Node 24]` DecompressionStream recusa cauda de lixo
 * depois do fim do fluxo, e varrer ate `endstream` quase sempre traz cauda. A
 * leitura por pedacos guarda tudo que ja saiu, o que torna a varredura viavel
 * sem precisar resolver a referencia indireta de /Length. Dado que nao e Flate,
 * como imagem JBIG2, devolve vazio em vez de estourar.
 */
export async function inflarTolerante(dados) {
  if (!dados || dados.length === 0) return new Uint8Array(0);
  const ds = new DecompressionStream('deflate');
  const escritor = ds.writable.getWriter();
  escritor.write(dados).catch(() => {});
  escritor.close().catch(() => {});
  const leitor = ds.readable.getReader();
  const pedacos = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      pedacos.push(value);
      total += value.length;
      if (total > MAX_INFLADO) break;
    }
  } catch (_) {
    // fim abrupto: fica com o que ja veio, que e onde os marcadores estao
  }
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of pedacos) { saida.set(p, i); i += p.length; }
  return saida;
}

/**
 * Texto do PDF em que vale procurar marcador: o arquivo cru, mais o conteudo
 * inflado dos fluxos de objetos.
 *
 * So fluxos marcados como /ObjStm sao inflados, e a escolha e deliberada. Os
 * dicionarios de marcador nao sao fluxos, entao ou estao soltos no arquivo, e
 * o texto cru ja os traz, ou estao dentro de um fluxo de objetos. Inflar o
 * resto significaria descomprimir centenas de megabytes de imagem de pagina
 * para nao achar nada.
 */
export async function textoLegivel(bytes) {
  const cru = comoLatin1(bytes);
  const partes = [cru];
  let inflado = 0;
  let examinados = 0;
  let i = 0;

  while (examinados < MAX_FLUXOS && inflado < MAX_INFLADO) {
    i = cru.indexOf('/ObjStm', i);
    if (i < 0) break;
    const marca = cru.indexOf('stream', i);
    if (marca < 0) break;

    let inicio = marca + 6;
    if (cru[inicio] === '\r') inicio++;
    if (cru[inicio] === '\n') inicio++;
    let fim = cru.indexOf('endstream', inicio);
    if (fim < 0) fim = cru.length;

    const saida = await inflarTolerante(bytes.subarray(inicio, fim));
    if (saida.length > 0) { partes.push(comoLatin1(saida)); inflado += saida.length; }
    examinados++;
    i = fim;
  }
  return partes.join('\n');
}

// -------------------------------------------------------------- conferencia

/**
 * Compara os marcadores lidos com as pecas que o lote pediu.
 *
 * Sem marcador legivel o resultado e `legivel: false` e nada mais. Nao se pode
 * acusar peca faltando com base numa leitura que nao aconteceu, e essa
 * distincao e o que separa advertencia util de alarme falso.
 */
export function conferirMarcadores(titulos, pecas, motivo) {
  const lista = titulos || [];
  const pedidas = pecas || [];

  if (lista.length === 0) {
    return {
      legivel: false, confere: false, titulos: [],
      folhasEncontradas: [], ausentes: [], inesperadas: [],
      motivo: motivo || 'nenhum marcador encontrado no arquivo'
    };
  }

  const encontradas = new Set();
  for (const t of lista) {
    const f = folhaDoTitulo(t);
    if (f !== null) encontradas.add(f);
  }
  const folhasPedidas = new Set(pedidas.map(p => Number(p.folha)));
  const ausentes = pedidas.filter(p => !encontradas.has(Number(p.folha)));
  const inesperadas = [...encontradas].filter(f => !folhasPedidas.has(f)).sort((a, b) => a - b);

  return {
    legivel: true,
    confere: ausentes.length === 0 && inesperadas.length === 0,
    titulos: lista,
    folhasEncontradas: [...encontradas].sort((a, b) => a - b),
    ausentes,
    inesperadas,
    motivo: null
  };
}

/** Conferencia completa de um lote recebido, do arquivo ao veredito. */
export async function conferir(bytes, pecas) {
  if (!bytes || bytes.length === 0) {
    return conferirMarcadores([], pecas, 'arquivo vazio');
  }
  if (bytes.length > MAX_ARQUIVO) {
    return conferirMarcadores([], pecas,
      `arquivo de ${Math.round(bytes.length / 1048576)} MB, acima do teto de leitura de marcadores`);
  }
  let texto = '';
  let motivo = null;
  try {
    texto = await textoLegivel(bytes);
  } catch (e) {
    texto = '';   // arquivo ilegivel nao pode derrubar a execucao
    motivo = `falha ao ler o arquivo: ${e.message}`;
  }
  return conferirMarcadores(extrairTitulos(texto), pecas, motivo);
}
