import {
  achatar, totalDeFolhas, montarJanelas, pecasDaJanela,
  removerJaVistas, calcularExtensoes, ordenar
} from '../src/lib/indexador.js';
import { particionar, nomeArquivo, nomeArquivoConservador, nomeManifesto, nomeSeguro, limparCnj } from '../src/lib/lotes.js';
import { proximoIntervalo, intervaloInicial, houveEstrangulamento } from '../src/lib/ritmo.js';
import { verificarLote, parecePdf, contarPaginas, pisoDeBytes } from '../src/lib/conferencia.js';
import {
  registrarErro, errosPendentes, pecasFaltantes, janelaVaziaEhLegitima, conciliar
} from '../src/lib/conciliacao.js';
import {
  decodificarStringPdf, extrairTitulos, folhaDoTitulo, conferir
} from '../src/lib/marcadores.js';
import {
  janela1a1000, janela500a1000, janela1001a2000, pdfFalso, pdfDegenerado,
  pdfComMarcadores, pdfComMarcadoresComprimidos, pdfComImagemComprimida
} from './amostras.mjs';

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); console.log(`  ok   ${nome}`); passou++; }
  catch (e) { console.log(`  FALHA ${nome}\n        ${e.message}`); falhou++; }
}
function igual(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg || 'esperava'} ${y}, veio ${x}`);
}
function verdade(v, msg) { if (!v) throw new Error(msg || 'esperava verdadeiro'); }
async function testeA(nome, fn) {
  try { await fn(); console.log(`  ok   ${nome}`); passou++; }
  catch (e) { console.log(`  FALHA ${nome}\n        ${e.message}`); falhou++; }
}

// Amostras de conciliacao. Tres pecas declaradas pelo indice, uma delas la no fim.
const declaradas3 = [
  { codDoctoElet: 'A', folha: 1, rotulo: '1 - Capa' },
  { codDoctoElet: 'B', folha: 2, rotulo: '2 - Peticao Inicial' },
  { codDoctoElet: 'C', folha: 974, rotulo: '974 - Laudo Pericial' }
];
const loteEmErro = (chaves, causa = 'download devolveu 500') => ({
  situacao: 'erro',
  janela: { paginaInicial: 1, paginaFinal: 1000 },
  folhaInicial: 1, folhaFinal: 1000,
  pecas: chaves.map(c => ({ codDoctoElet: c })),
  erro: causa
});

console.log('\nT-04  achatamento da arvore recursiva');
teste('so entram nos com codDoctoElet, agrupamentos ficam de fora', () => {
  const pecas = achatar(janela1a1000);
  igual(pecas.length, 7);
  verdade(!pecas.some(p => p.rotulo.startsWith('Volume')), 'nenhum Volume deveria entrar');
});
teste('desce ate o quarto nivel, pegando anexo dentro de documento', () => {
  const chaves = achatar(janela1a1000).map(p => p.codDoctoElet);
  verdade(chaves.includes('AAA6'), 'o anexo AAA6 esta no quarto nivel e precisa entrar');
});
teste('tolera o agrupamento por Juntada, e nao so por Volume', () => {
  igual(achatar(janela1001a2000).map(p => p.codDoctoElet), ['BBB1', 'BBB2']);
});
teste('le o total de folhas do no raiz', () => igual(totalDeFolhas(janela1a1000), 13002));

console.log('\nT-05  deduplicacao por codDoctoElet, nunca por codigo');
teste('a mesma peca com codigo diferente e reconhecida como repetida', () => {
  const a = achatar(janela1a1000).find(p => p.codDoctoElet === 'AAA7');
  const b = achatar(janela500a1000).find(p => p.codDoctoElet === 'AAA7');
  verdade(a.codigo !== b.codigo, 'as amostras precisam ter codigos diferentes');
  igual(a.folha, b.folha);
  igual(removerJaVistas([b], new Set(['AAA7'])).length, 0, 'deveria remover');
});
teste('deduplicar por codigo produziria falso positivo, o que o codigo evita', () => {
  const a = achatar(janela1a1000).find(p => p.codDoctoElet === 'AAA1');   // codigo 3
  const b = achatar(janela500a1000).find(p => p.codDoctoElet === 'AAA5'); // codigo 3, peca diferente
  igual(a.codigo, b.codigo, 'as duas pecas distintas compartilham o codigo 3');
  igual(removerJaVistas([b], new Set(['AAA1'])).length, 1, 'nao pode remover peca distinta');
});

console.log('\nT-06  extensao de peca na ordenacao global');
teste('a ultima peca de uma janela NAO e tratada como ultima do processo', () => {
  const so1000 = ordenar(achatar(janela1a1000));
  const parcial = calcularExtensoes(so1000, 13002, { completo: false });
  const laudo = parcial.find(p => p.codDoctoElet === 'AAA7');
  igual(laudo.paginas, null, 'sem a janela seguinte a extensao fica pendente, e nao 12028');
});
teste('com a janela seguinte carregada, a extensao fecha com valor correto', () => {
  const global = ordenar([...achatar(janela1a1000), ...achatar(janela1001a2000)]);
  const comExt = calcularExtensoes(global, 13002, { completo: false });
  igual(comExt.find(p => p.codDoctoElet === 'AAA7').paginas, 1041 - 974);
});
teste('a ultima peca do processo usa ultFolVirt', () => {
  const global = ordenar(achatar(janela1001a2000));
  const comExt = calcularExtensoes(global, 13002, { completo: true });
  igual(comExt[comExt.length - 1].paginas, 13002 - 1050 + 1);
});
teste('extensao da capa e de uma pagina', () => {
  const comExt = calcularExtensoes(ordenar(achatar(janela1a1000)), 13002);
  igual(comExt.find(p => p.codDoctoElet === 'AAA1').paginas, 1);
});

console.log('\nT-06b  pareamento entre lote e janela');
teste('o lote carrega a janela que gerou os codigos', () => {
  const janela = { paginaInicial: 500, paginaFinal: 1000 };
  const pecas = pecasDaJanela(achatar(janela500a1000), janela);
  const lotes = particionar(pecas, janela, 50);
  igual(lotes[0].janela, janela);
  igual(lotes[0].paginas, pecas.map(p => p.codigo));
});
teste('cada peca vai para a janela em que a folha de inicio cai', () => {
  const pecas = achatar(janela1a1000);
  igual(pecasDaJanela(pecas, { paginaInicial: 1, paginaFinal: 500 }).map(p => p.folha), [1, 2, 11, 13, 500]);
  igual(pecasDaJanela(pecas, { paginaInicial: 501, paginaFinal: 1000 }).map(p => p.folha), [501, 974]);
});

console.log('\nT-07  particionamento e janelas');
teste('particiona com resto', () => {
  const pecas = Array.from({ length: 7 }, (_, i) => ({ codigo: i + 3, folha: i + 1, rotulo: 'x', codDoctoElet: 'K' + i, paginas: 1 }));
  const lotes = particionar(pecas, { paginaInicial: 1, paginaFinal: 1000 }, 3);
  igual(lotes.map(l => l.paginas.length), [3, 3, 1]);
  igual(lotes[0].paginasEsperadas, 3);
});
teste('lote com extensao pendente nao declara paginas esperadas', () => {
  const pecas = [{ codigo: 3, folha: 1, rotulo: 'x', codDoctoElet: 'K', paginas: null }];
  igual(particionar(pecas, { paginaInicial: 1, paginaFinal: 1000 }, 50)[0].paginasEsperadas, null);
});
teste('janelas cobrem o processo inteiro sem lacuna', () => {
  const js = montarJanelas(13002);
  igual(js.length, 14);
  igual(js[0], { paginaInicial: 1, paginaFinal: 1000 });
  igual(js[13], { paginaInicial: 13001, paginaFinal: 13002 });
  for (let i = 1; i < js.length; i++) igual(js[i].paginaInicial, js[i - 1].paginaFinal + 1);
});

console.log('\nT-09  resposta degenerada nao pode ser gravada');
teste('o PDF de 941 bytes e rejeitado', () => {
  const r = verificarLote(pdfDegenerado(), 50);
  verdade(!r.valido, 'tinha que ser invalido');
  verdade(r.problemas.some(p => p.includes('degenerado')), 'devia acusar arquivo degenerado');
});
teste('arquivo que nao e PDF e rejeitado', () => {
  const lixo = new Uint8Array(20000);
  verdade(!verificarLote(lixo, 10).valido);
});
teste('arquivo valido passa', () => {
  const r = verificarLote(pdfFalso(50, 60000), 50);
  verdade(r.valido, r.problemas.join('; '));
  igual(r.paginasLidas, 50);
  igual(r.avisos, []);
});
teste('divergencia de contagem e aviso, e nao rejeicao', () => {
  const r = verificarLote(pdfFalso(48, 60000), 50);
  verdade(r.valido, 'divergencia de contagem nao pode barrar o arquivo');
  verdade(r.avisos.some(a => a.includes('divergente')));
});
teste('assinatura de PDF', () => {
  verdade(parecePdf(pdfFalso(1, 20000)));
  verdade(!parecePdf(new Uint8Array([1, 2, 3, 4, 5])));
  igual(contarPaginas(pdfFalso(3, 20000)), 3);
});

console.log('\nT-17  nomeacao dos arquivos de saida');
teste('processo na frente, folhas no meio, Parte no fim', () => {
  // Numero sintetico. Nenhum processo real entra no repositorio.
  igual(nomeArquivo('1234567-89.2020.8.19.0001', 7, 974, 1040),
    '12345678920208190001/12345678920208190001 - fls 00974 a 01040 - Parte 007.pdf');
});
teste('as folhas levam zeros a esquerda, para ordenar certo fora da pasta', () => {
  const nomes = [[1, 489], [974, 1040], [12001, 13002]]
    .map(([a, b], i) => nomeArquivo('1234567-89.2020.8.19.0001', i + 1, a, b).split('/')[1]);
  igual(nomes.map(n => n.slice(0, 21).trim()), ['12345678920208190001', '12345678920208190001', '12345678920208190001']);
  verdade(nomes[0].includes('fls 00001 a 00489'));
  verdade(nomes[2].includes('fls 12001 a 13002'));
  // ordenacao alfabetica tem que coincidir com a ordem das folhas
  igual([...nomes].sort(), nomes);
});
teste('folha acima de cinco digitos nao e truncada', () => {
  verdade(nomeArquivo('1', 1, 100000, 123456).includes('fls 100000 a 123456'));
});
teste('parte passa de cem sem quebrar', () => {
  verdade(nomeArquivo('1', 137, 1, 2).includes('Parte 137'));
});
teste('o manifesto acompanha o mesmo padrao', () => {
  igual(nomeManifesto('1234567-89.2020.8.19.0001'),
    '12345678920208190001/12345678920208190001 - manifesto.json');
});
teste('cnj ausente nao quebra a nomeacao', () => {
  igual(limparCnj(null), 'processo');
  igual(nomeArquivo(null, 1, 1, 2), 'processo/processo - fls 00001 a 00002 - Parte 001.pdf');
});
teste('caractere que o Windows recusa e removido do nome', () => {
  // Nome recusado pelo sistema de arquivos vira download interrompido, que e
  // exatamente o que o usuario ve como "Failed".
  igual(nomeSeguro('Peticao: parte 1/2 <urgente>?'), 'Peticao parte 1 2 urgente');
  igual(nomeSeguro('  espacos nas pontas  '), 'espacos nas pontas');
  igual(nomeSeguro('termina com ponto.'), 'termina com ponto');
  igual(nomeSeguro(''), 'arquivo');
});
teste('nome reservado do Windows nao passa cru', () => {
  igual(nomeSeguro('CON.pdf'), '_CON.pdf');
  igual(nomeSeguro('nul'), '_nul');
});
teste('nome longo e cortado sem perder a extensao', () => {
  const r = nomeSeguro('x'.repeat(300) + '.pdf', 120);
  igual(r.length, 120);
  verdade(r.endsWith('.pdf'), 'a extensao tem que sobreviver ao corte');
});
teste('o nome conservador reproduz o formato que rodou 364 MB sem erro', () => {
  igual(nomeArquivoConservador('1234567-89.2020.8.19.0001', 7, 974, 1040),
    '12345678920208190001/12345678920208190001_007_974-1040.pdf');
});

console.log('\nT-18  ritmo entre operacoes');
teste('o intervalo dobra ao bater no limite de requisicoes', () => {
  igual(proximoIntervalo(8000), 16000);
  igual(proximoIntervalo(16000), 32000);
});
teste('o intervalo tem teto, para nao virar espera infinita', () => {
  igual(proximoIntervalo(90000), 120000);
  igual(proximoIntervalo(120000), 120000);
});
teste('a retomada comeca pelo maior entre o configurado e o aprendido', () => {
  igual(intervaloInicial(8000, 32000), 32000, 'o aprendido apos um 429 nao pode ser esquecido');
  igual(intervaloInicial(20000, 8000), 20000, 'o configurado maior prevalece');
  igual(intervaloInicial(8000, null), 8000);
  igual(intervaloInicial(8000, 999999), 120000, 'nem o aprendido escapa do teto');
});
teste('pausa que estica muito alem do pedido e estrangulamento', () => {
  verdade(houveEstrangulamento(8000, 30000), 'oito segundos que viraram trinta');
  verdade(!houveEstrangulamento(8000, 8400), 'variacao normal de temporizador');
  verdade(!houveEstrangulamento(8000, 9500), 'um segundo e meio a mais nao merece aviso');
});
teste('pausa curta esticada nao dispara aviso, porque o desvio absoluto e pequeno', () => {
  verdade(!houveEstrangulamento(1000, 2500), 'dobrou, mas sao 1,5 s de diferenca');
});

console.log('\nT-08  conciliacao entre o que o indice declarou e o que foi baixado');
teste('peca declarada e nunca baixada aparece na relacao de faltantes', () => {
  igual(pecasFaltantes(declaradas3, new Set(['A', 'C'])),
    [{ codDoctoElet: 'B', folha: 2, rotulo: '2 - Peticao Inicial' }]);
});
teste('a relacao de faltantes sai ordenada por folha', () => {
  igual(pecasFaltantes(declaradas3, new Set([])).map(p => p.folha), [1, 2, 974]);
});
teste('lote perdido SEM registro de erro ainda assim vira peca faltante', () => {
  // Este e o defeito do 429 esgotado: o lote sumiu sem deixar registro em estado.lotes.
  // A conciliacao nao pergunta ao diario de lotes, pergunta ao indice.
  const v = conciliar({
    declaradas: declaradas3, vistos: ['A', 'B'], lotes: [],
    janelasEsperadas: ['1-1000'], janelasConcluidas: ['1-1000']
  });
  verdade(!v.completo, 'nao pode declarar completo com peca faltando');
  igual(v.faltantes.map(p => p.codDoctoElet), ['C']);
});
teste('lote em erro que depois foi baixado deixa de contar como pendente', () => {
  const lotes = [loteEmErro(['A', 'B'])];
  igual(errosPendentes(lotes, new Set(['A'])).length, 1, 'ainda falta B');
  igual(errosPendentes(lotes, new Set(['A', 'B'])).length, 0, 'nada mais falta');
});
teste('falhar duas vezes no mesmo lote nao cria dois registros de erro', () => {
  const um = registrarErro([], loteEmErro(['A', 'B'], 'primeira causa'));
  const dois = registrarErro(um, loteEmErro(['A', 'B'], 'segunda causa'));
  igual(dois.length, 1, 'o registro e substituido, nao acumulado');
  igual(dois[0].erro, 'segunda causa');
});
teste('lote diferente na mesma janela gera registro proprio', () => {
  const um = registrarErro([], loteEmErro(['A', 'B']));
  igual(registrarErro(um, loteEmErro(['C'])).length, 2);
});
teste('janela nao consultada impede declarar o processo completo', () => {
  const v = conciliar({
    declaradas: declaradas3, vistos: ['A', 'B', 'C'], lotes: [],
    janelasEsperadas: ['1-1000', '1001-2000'], janelasConcluidas: ['1-1000']
  });
  verdade(!v.completo, 'faltou varrer uma janela, entao nao se sabe o que falta');
  igual(v.janelasPendentes, ['1001-2000']);
});
teste('processo integro e declarado completo', () => {
  const v = conciliar({
    declaradas: declaradas3, vistos: ['A', 'B', 'C'], lotes: [loteEmErro(['A'])],
    janelasEsperadas: ['1-1000'], janelasConcluidas: ['1-1000']
  });
  verdade(v.completo, 'erro ja sanado nao pode impedir o completo');
  igual(v.faltantes, []);
  igual(v.errosSanados, 1);
  igual(v.lotesPendentes, []);
});

console.log('\nT-14  janela sem pecas proprias');
teste('janela atravessada por uma unica peca longa e legitima', () => {
  const decl = ordenar([{ codDoctoElet: 'A', folha: 900, codigo: 1 }, { codDoctoElet: 'B', folha: 3500, codigo: 2 }]);
  verdade(janelaVaziaEhLegitima(decl, { paginaInicial: 2001, paginaFinal: 3000 }));
});
teste('janela vazia sem peca anterior que a atravesse e lacuna, e nao janela vazia', () => {
  const decl = ordenar([{ codDoctoElet: 'A', folha: 900, codigo: 1 }, { codDoctoElet: 'B', folha: 2500, codigo: 2 }]);
  verdade(!janelaVaziaEhLegitima(decl, { paginaInicial: 2001, paginaFinal: 3000 }));
});
teste('a primeira janela nunca pode estar legitimamente vazia', () => {
  verdade(!janelaVaziaEhLegitima([], { paginaInicial: 1, paginaFinal: 1000 }));
});

console.log('\nT-09b  piso de bytes proporcional ao tamanho do lote');
teste('lote de uma peca continua no piso absoluto de dez mil bytes', () => {
  igual(pisoDeBytes(1), 10000);
});
teste('lote de cinquenta pecas exige mais que o piso absoluto', () => {
  igual(pisoDeBytes(50), 50000);
});
teste('lote de cinquenta pecas com arquivo de 12 mil bytes e rejeitado', () => {
  // 12 mil bytes passa no piso absoluto, mas para cinquenta pecas e degenerado.
  // A menor razao ja medida contra o tribunal foi de 20 mil bytes por peca.
  const r = verificarLote(pdfFalso(3, 12000), 50, 50);
  verdade(!r.valido, 'tinha que ser invalido');
  verdade(r.problemas.some(p => p.includes('degenerado')));
});
teste('lote de cinquenta pecas com arquivo plausivel passa', () => {
  verdade(verificarLote(pdfFalso(50, 1000000), 50, 50).valido);
});
teste('sem informar o numero de pecas, vale o piso absoluto de antes', () => {
  verdade(verificarLote(pdfFalso(50, 60000), 50).valido);
});

console.log('\nT-15  leitura dos marcadores do PDF');
teste('decodifica string literal', () => igual(decodificarStringPdf('(1 - Capa)'), '1 - Capa'));
teste('decodifica parentese e barra escapados', () => {
  igual(decodificarStringPdf('(Peticao \\(fls. 2\\) inicial)'), 'Peticao (fls. 2) inicial');
  igual(decodificarStringPdf('(a\\\\b)'), 'a\\b');
});
teste('decodifica escape octal', () => igual(decodificarStringPdf('(\\101\\102)'), 'AB'));
teste('decodifica string hexadecimal', () => igual(decodificarStringPdf('<312D43617061>'), '1-Capa'));
teste('decodifica UTF-16BE com marca de ordem, que e como o acento chega', () => {
  igual(decodificarStringPdf('<FEFF005000650074006900E700E3006F>'), 'Petição');
});
teste('extrai varios titulos de um texto', () => {
  igual(extrairTitulos('<< /Title (1 - Capa) >> lixo << /Title (974 - Laudo) /Parent 5 0 R >>'),
    ['1 - Capa', '974 - Laudo']);
});
teste('titulo com parentese aninhado nao trunca', () => {
  igual(extrairTitulos('/Title (Peticao (fls. 2) inicial)'), ['Peticao (fls. 2) inicial']);
});
teste('ignora /Title que nao seja string', () => igual(extrairTitulos('/Title 9 0 R'), []));
teste('a folha vem na frente do rotulo', () => {
  igual(folhaDoTitulo('974 - Laudo Pericial'), 974);
  igual(folhaDoTitulo('1 - Capa'), 1);
});
teste('rotulo sem folha a frente devolve nulo', () => {
  igual(folhaDoTitulo('Laudo Pericial'), null);
  igual(folhaDoTitulo(''), null);
});

console.log('\nT-16  conferencia pelos marcadores, a Camada 3');
const pecas3 = [
  { folha: 1, rotulo: '1 - Capa', codDoctoElet: 'A' },
  { folha: 974, rotulo: '974 - Laudo Pericial', codDoctoElet: 'B' }
];

await testeA('le marcadores de PDF sem compressao', async () => {
  const r = await conferir(pdfComMarcadores(['1 - Capa', '974 - Laudo Pericial'], 2), pecas3);
  verdade(r.legivel, 'devia conseguir ler');
  verdade(r.confere, `devia conferir, ausentes: ${JSON.stringify(r.ausentes)}`);
});
await testeA('le marcadores de dentro de fluxo comprimido', async () => {
  const bytes = await pdfComMarcadoresComprimidos(['1 - Capa', '974 - Laudo Pericial'], 2);
  verdade(!String.fromCharCode(...bytes).includes('974 - Laudo'), 'a amostra precisa esconder o titulo do texto cru');
  const r = await conferir(bytes, pecas3);
  verdade(r.legivel, 'devia inflar o fluxo de objetos e achar os marcadores');
  verdade(r.confere, `devia conferir, ausentes: ${JSON.stringify(r.ausentes)}`);
});
await testeA('nao vasculha fluxo de imagem, so fluxo de objetos', async () => {
  const r = await conferir(await pdfComImagemComprimida(), pecas3);
  verdade(!r.legivel, 'nao ha marcador neste arquivo, e o /Title dentro da imagem nao vale');
});
await testeA('peca pedida sem marcador correspondente e apontada', async () => {
  const r = await conferir(pdfComMarcadores(['1 - Capa'], 1), pecas3);
  verdade(r.legivel);
  verdade(!r.confere, 'faltou a peca da folha 974');
  igual(r.ausentes.map(p => p.folha), [974]);
});
await testeA('marcador sem peca correspondente e apontado', async () => {
  const r = await conferir(pdfComMarcadores(['1 - Capa', '974 - Laudo Pericial', '2000 - Intrusa'], 3), pecas3);
  verdade(!r.confere, 'veio peca que nao foi pedida');
  igual(r.inesperadas, [2000]);
});
await testeA('PDF ilegivel nao acusa ausencia, so declara que nao leu', async () => {
  const r = await conferir(pdfFalso(3, 20000), pecas3);
  verdade(!r.legivel, 'nao ha marcador neste PDF');
  igual(r.ausentes, [], 'sem conseguir ler, nao pode acusar peca faltando');
  verdade(!r.confere);
});

console.log(`\n${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou === 0 ? 0 : 1);
