// Script de conteudo. TODA chamada ao tribunal parte daqui.
//
// Motivo, registrado na especificacao, secao 3.2: a autenticacao depende do
// cookie de sessao do dominio. Requisicao partindo de pagina de extensao e,
// para o navegador, requisicao de outro sitio, e cookie SameSite=Lax nao a
// acompanha. Executando dentro da pagina do visualizador, a requisicao e de
// mesma origem e o cookie viaja como viaja para a aplicacao oficial.

(() => {
  'use strict';

  const VIS = '/visproc/api';
  const DOWN = '/downproc/api';

  // ---------------------------------------------------------------- contexto

  /**
   * A versao do sistema alimenta o ETag (RF-01) e nao pode ser fixada no codigo,
   * sob pena de quebrar na primeira atualizacao do visualizador.
   *
   * Esta e a UNICA dependencia de tela que sobrou, e por isso a leitura e
   * defensiva em dois pontos. Exige a forma de numero pontuado, e nao qualquer
   * sequencia de digitos e pontos, e fica com a ULTIMA ocorrencia da pagina,
   * porque o rodape vem depois da arvore do indice, que carrega texto livre das
   * pecas e poderia oferecer correspondencia falsa. As candidatas descartadas
   * sobem junto, para que a aba de execucao possa avisar quando houver duvida.
   */
  function lerVersao() {
    const texto = document.body ? document.body.innerText : '';
    const numeros = (texto.match(/vers[ãa]o:?\s*\d+(?:\.\d+){1,3}/gi) || [])
      .map(t => (t.match(/\d+(?:\.\d+){1,3}/) || [])[0])
      .filter(Boolean);
    return {
      versao: numeros.length ? numeros[numeros.length - 1] : null,
      candidatas: [...new Set(numeros)]
    };
  }

  function lerContexto() {
    const bruto = location.hash.replace(/^#\/?/, '');
    const codHash = bruto ? decodeURIComponent(bruto) : null;
    const { versao, candidatas } = lerVersao();
    return {
      codHash,
      versao,
      versoesCandidatas: candidatas,
      etag: versao ? btoa(versao) : null,
      origem: location.origin
    };
  }

  // ------------------------------------------------------------------- rede

  class ErroTribunal extends Error {
    constructor(mensagem, status, limitado) {
      super(mensagem);
      this.status = status || null;
      this.limitado = Boolean(limitado);
    }
  }

  async function obterToken() {
    const r = await fetch(`${VIS}/jwt-auth`, { method: 'POST' });
    if (r.status === 429) throw new ErroTribunal('limite de requisicoes atingido em jwt-auth', 429, true);
    if (!r.ok) throw new ErroTribunal(`jwt-auth devolveu ${r.status}`, r.status, false);
    const corpo = await r.json();
    // site-key devolve 204 e sempre precede a operacao real no cliente oficial.
    await fetch(`${VIS}/site-key`, { method: 'POST' }).catch(() => {});
    const token = typeof corpo === 'string' ? corpo : corpo && corpo.jwt;
    if (!token) throw new ErroTribunal('token ausente na resposta de jwt-auth', null, false);
    return token;
  }

  function cabecalhos(token, etag) {
    return {
      'Content-Type': 'application/json;charset=UTF-8',
      'Accept': 'application/json, text/plain, */*',
      // ETag derivado da versao lida do rodape, nunca fixado no codigo (RF-01).
      'ETag': etag,
      // Valor cru, sem prefixo Bearer, conforme observado na Fase 0.
      'Authorization': token
    };
  }

  async function chamar(url, corpo, etag, msLimite) {
    const token = await obterToken();
    const controlador = new AbortController();
    const relogio = setTimeout(() => controlador.abort(), msLimite || 180000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: cabecalhos(token, etag),
        body: JSON.stringify(corpo),
        signal: controlador.signal
      });
      if (r.status === 429) throw new ErroTribunal(`limite de requisicoes atingido em ${url}`, 429, true);
      return r;
    } catch (e) {
      if (e.name === 'AbortError') throw new ErroTribunal('tempo limite excedido', null, false);
      throw e;
    } finally {
      clearTimeout(relogio);
    }
  }

  // --------------------------------------------------------------- operacoes

  async function consultarIndice({ codHash, etag, tiposArquivo, paginaInicial, paginaFinal }) {
    const r = await chamar(`${VIS}/consultarProcesso`, {
      codHash, tiposArquivo, paginaInicial, paginaFinal
    }, etag, 60000);
    if (!r.ok) throw new ErroTribunal(`consultarProcesso devolveu ${r.status}`, r.status, false);
    const tipo = r.headers.get('content-type') || '';
    if (!tipo.includes('json')) throw new ErroTribunal('consultarProcesso nao devolveu JSON, sessao provavelmente expirada', r.status, false);
    return await r.json();
  }

  // Os codigos enviados em `paginas` sao relativos a janela declarada em
  // paginaInicial e paginaFinal. Os dois campos NAO limitam a lista, eles
  // dizem em que contexto os codigos devem ser lidos. Ver especificacao RF-02b.
  async function baixarLote({ codHash, etag, tiposArquivo, paginaInicial, paginaFinal, paginas }) {
    const inicio = Date.now();
    const r = await chamar(`${DOWN}/download`, {
      codHash, paginas, compact: true, tiposArquivo, paginaInicial, paginaFinal
    }, etag, 180000);
    if (!r.ok) throw new ErroTribunal(`download devolveu ${r.status}`, r.status, false);
    const tipo = r.headers.get('content-type') || '';
    if (!tipo.includes('pdf')) throw new ErroTribunal('resposta nao e PDF, sessao provavelmente expirada', r.status, false);
    const buffer = await r.arrayBuffer();
    return {
      base64: paraBase64(buffer),
      bytes: buffer.byteLength,
      ms: Date.now() - inicio,
      nomeServidor: extrairNome(r.headers.get('content-disposition'))
    };
  }

  function extrairNome(disposicao) {
    if (!disposicao) return null;
    const m = disposicao.match(/filename="?([^";]+)"?/i);
    return m ? m[1] : null;
  }

  function paraBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const pedaco = 32768;
    let texto = '';
    for (let i = 0; i < bytes.length; i += pedaco) {
      texto += String.fromCharCode.apply(null, bytes.subarray(i, i + pedaco));
    }
    return btoa(texto);
  }

  // ---------------------------------------------------------------- mensagens

  chrome.runtime.onMessage.addListener((mensagem, _remetente, responder) => {
    (async () => {
      try {
        if (mensagem.tipo === 'contexto') return responder({ ok: true, dados: lerContexto() });
        if (mensagem.tipo === 'indice') return responder({ ok: true, dados: await consultarIndice(mensagem.args) });
        if (mensagem.tipo === 'download') return responder({ ok: true, dados: await baixarLote(mensagem.args) });
        return responder({ ok: false, erro: `mensagem desconhecida: ${mensagem.tipo}` });
      } catch (e) {
        responder({ ok: false, erro: e.message, status: e.status || null, limitado: Boolean(e.limitado) });
      }
    })();
    return true; // resposta assincrona
  });
})();
