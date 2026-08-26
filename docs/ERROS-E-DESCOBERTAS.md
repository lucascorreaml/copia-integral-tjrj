# Erros cometidos, e como foram descobertos

Cada item aqui é um erro que parecia óbvio na direção contrária, e que voltaria caso o próximo a mexer no código não o conhecesse. Nenhum foi descoberto por raciocínio: todos apareceram em teste, depois que a hipótese errada já estava escrita.

É a leitura obrigatória de quem for alterar este código.

Os seis primeiros são do levantamento e da implementação. O sétimo veio da revisão de código posterior, e o relato longo dele está em [`REVISAO.md`](REVISAO.md). O oitavo foi cometido **pela própria revisão**, e está aqui porque é o mais instrutivo de todos: uma trava de segurança mal escrita derrubou uma ferramenta que funcionava.

---

## 1. Confundir `codigo` com folha

**O erro.** Assumir que o campo `paginas` do download carregava números de folha, porque a interface exibe folhas e a lista parecia de folhas.

**Como apareceu.** Um teste mandou `paginas: [1, 13]` tratando os valores como folhas. As respostas vieram com tamanhos inconsistentes entre si, todas pequenas.

**A verdade.** `paginas` carrega `codigo`, e `codigo` é relativo à janela consultada.

**Como o código se protege hoje.** A deduplicação é por `codDoctoElet`, que é estável, e o lote carrega a janela junto dos códigos, de modo que nenhum download é montado com códigos de uma consulta e janela de outra. Os testes `T-05` e `T-06b` cobrem exatamente isso, inclusive o caso em que duas peças distintas compartilham o mesmo `codigo` em janelas diferentes.

## 2. Tratar a última peça de uma janela como última do processo

**O erro.** Calcular a extensão da última peça de cada janela contra `ultFolVirt`.

**Como apareceu.** Uma peça de 67 páginas saiu com 12.028 páginas na conta, porque era a última peça da janela de 1 a 1000 e a medição foi feita contra o fim dos autos.

**A verdade.** A extensão de uma peça é a distância até a folha de início da peça seguinte na ordenação global. Apenas a última peça do processo inteiro usa `ultFolVirt`.

**Como o código se protege hoje.** O orquestrador consulta o índice da janela seguinte antes de baixar a janela atual, e só libera o cálculo final quando o índice da última janela já foi carregado. Uma primeira correção condicionou isso ao índice do laço, e falhou de novo em produção, porque a última peça do processo de amostra começa na penúltima janela: a peça da folha 12997 ficou sem extensão e o lote dela foi salvo sem conferência de contagem. A condição atual verifica se o índice da última janela está carregado, e não a posição no laço.

## 3. Fixar o filtro em somente documentos

**O erro.** Deixar `tiposArquivo` fixo em `SD` no código, porque era o valor padrão da tela.

**Como apareceu.** Avisos de contagem divergente numa execução real, com 67 páginas faltando em 13.002.

**A verdade.** `SD` deixa os anexos de fora, e para quem quer a íntegra dos autos isso é lacuna de conteúdo.

**Como o código se protege hoje.** O filtro é opção na tela, com `DA` como padrão. Trocar o filtro no meio de um processo já iniciado é recusado, porque mudaria a árvore inteira e, com ela, os códigos.

## 4. Ignorar a limitação de taxa

**O erro.** Disparar uma bateria de testes sem intervalo.

**Como apareceu.** Status 429 numa chamada, seguido de arquivos de 941 bytes com status 200 nas seguintes.

**A verdade.** O servidor limita por tempo, e depois de atingido o limite passa a devolver conteúdo vazio com aparência de sucesso.

**Como o código se protege hoje.** Intervalo inicial de oito segundos entre operações, tratamento explícito do 429 com espera de cinco minutos e intervalo dobrado, e a trava de tamanho mínimo, hoje proporcional ao número de peças do lote.

## 5. Confiar em metadados de resposta

**O erro latente.** Aceitar como sucesso qualquer resposta com status 200 e tipo `application/pdf`.

**A verdade.** A assinatura da falha do serviço é exatamente essa, com um arquivo de 941 bytes.

**Como o código se protege hoje.** `conferencia.js` rejeita por assinatura de PDF e por tamanho mínimo, este proporcional ao número de peças pedidas. A contagem de páginas é advertência e não rejeição, porque o contador lê apenas objetos não comprimidos e erraria para menos em PDFs de estrutura diferente.

## 6. Colocar a rede no lugar errado

**O erro evitado, e por pouco.** Fazer as chamadas a partir do service worker ou da página de extensão, que é o desenho intuitivo.

**A verdade.** A autenticação depende do cookie de sessão do domínio. Requisição partindo de página de extensão é, para o navegador, requisição de outro sítio, e cookie `SameSite=Lax` não a acompanha. A chamada falharia com o usuário logado.

**Como o código se protege hoje.** Toda a rede vive em `content.js`, dentro da origem do tribunal. E o orquestrador não vive no service worker, que o Manifest V3 encerra por inatividade enquanto o trabalho leva minutos.

---

## 7. Ler o diário de lotes como se fosse o estado atual

**O erro.** Decidir se a execução ficou completa contando registros em `estado.lotes`, que é um diário de eventos.

**Como apareceu.** Por leitura do código durante a revisão, e depois reproduzido em simulação do laço de tentativas. O diário mentia nos dois sentidos. Um lote que esgotava as três tentativas por limitação de taxa caía num caminho que não gravava registro nenhum, e a execução anunciava **"CONCLUÍDO sem erros"** com o lote faltando. Um lote que falhava e depois era refeito deixava registro que nunca saía, e a execução passava a acusar erro para sempre, sem nunca mais conseguir dizer que terminou.

**A verdade.** Um diário de eventos não sabe se o download ficou completo. A pergunta só tem uma fonte confiável: o próprio índice. Toda peça que alguma janela declarou tem que estar entre as baixadas, e toda janela tem que ter sido varrida.

**Como o código se protege hoje.** `conciliacao.js` responde ao veredito comparando `estado.declaradas` com `estado.vistos`, e exige as três condições ao mesmo tempo: todas as janelas varridas, nenhuma peça declarada faltando, nenhum lote em erro ainda pendente. Nenhuma contagem de lote decide isso. Além disso, `processarLote` passou a ter saída única de falha, de modo que não existe caminho que desista de um lote sem gravar registro e escrever linha na tela. Os testes `T-08` cobrem os dois sentidos do erro.

## 8. Tratar corrida de API como falha

**O erro.** A revisão acrescentou uma confirmação de que o arquivo chegou ao disco, sondando `chrome.downloads.search({ id })` logo depois de `chrome.downloads.download()` resolver, e tratando lista vazia como falha:

```js
const [item] = await chrome.downloads.search({ id });
if (!item) throw new Error('o Chrome não registrou este download');
```

**Como apareceu.** A extensão parou de funcionar em produção, com o Chrome acusando falha de download. A busca na documentação e nos rastreadores de defeito do Chromium e do Firefox confirmou: **`downloads.search` chamado logo após `download` resolver pode devolver lista vazia**, porque o gerenciador de downloads ainda não registrou o item. É corrida conhecida da interface, não defeito do navegador do usuário.

**Por que o estrago foi maior que o defeito.** A ausência derrubava o lote na primeira sondagem. O lote então repetia, e cada repetição disparava um download novo do mesmo arquivo, o que fazia o próprio Chrome acusar falha. Três tentativas depois, o lote era dado por perdido. Uma verificação criada para impedir falha silenciosa produziu falha ruidosa.

**A verdade.** Confirmação de estado assíncrono precisa de carência. Ausência momentânea não é ausência definitiva, e a diferença entre as duas é tempo.

**Como o código se protege hoje.** A ausência só vira erro depois de quinze segundos de carência, e erro da própria chamada de busca não derruba lote já baixado. Além disso, o nome do arquivo passou a ter um formato de reserva: se o Chrome recusar o nome legível, a extensão cai para o formato conservador que rodou 364 MB sem um único erro, e diz no registro que fez isso. E a página de execução ganhou um vigia de erros carregado antes do módulo principal, para que falha de carregamento apareça na tela em vez de deixar botões mudos.

**A lição que vale para o projeto.** Toda trava nova é código novo, e código novo pode quebrar o que funcionava. Trava de segurança precisa de caminho de degradação, e não só de caminho de erro. As camadas 2 e 3 da conferência já nascem como advertência por essa razão; esta nasceu como erro, e foi a única que derrubou a ferramenta.

---

## O padrão que liga todos eles

Cinco dos oito são a mesma coisa dita de maneiras diferentes: **o sistema falha sem avisar, e a aparência de sucesso é indistinguível do sucesso.**

Código inválido devolve 200 com PDF de 941 bytes. Limitação de taxa devolve 200 com PDF de 941 bytes. Extensão de peça calculada errado produz número absurdo que ninguém confere. Diário de lotes vazio parece execução limpa. Janela truncada parece janela sem novidade.

Daí a regra que governa o código: **nenhuma conferência pode depender de metadado de resposta**, e nenhum caminho de falha pode terminar em silêncio. O que decide se os autos vieram inteiros é a conciliação entre o que o índice declarou e o que foi gravado, e nada além disso.
