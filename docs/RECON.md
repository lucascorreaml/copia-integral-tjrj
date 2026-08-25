# RECON, Visualizador de Processos Eletrônicos do TJRJ

**Alvo:** `https://www3.tjrj.jus.br/visproc/`, PJERJ, versão 0.6.6
**Pilha:** Angular 14.3.0, Angular Material, empacotamento de produção
**Data do levantamento:** 25/08/2026
**Processo de amostra:** falência de 1997, 13.002 páginas, referido como `<CNJ>`
**Fontes:** observação direta da aba pela extensão Claude para Chrome, mais três capturas de tráfego por instrumentação de `fetch`, `XMLHttpRequest`, formulário, link e abertura de janela

**Convenção de evidência.** `[OBSERVADO]` visto ou capturado diretamente, com indicação da fonte. `[INFERIDO]` deduzido de um observado, com o raciocínio escrito. `[A VERIFICAR]` lacuna, com o teste que resolve.

**Nada neste documento contém teor de peça, dado de parte, valor de cookie ou token.**

**Redação de identificadores, ampliada em 25/08/2026 para a publicação.** Além do `codHash`, que já aparecia como `<codHash>` desde o levantamento, foram substituídos: o número do processo de amostra, por `<CNJ-REDIGIDO>` e `<CNJ-REDIGIDO-SEM-PONTUACAO>`; as chaves `codDoctoElet` reais, por `<codDoctoElet-48-hex-REDIGIDO>`; e os identificadores de arquivo em formato UUID, por `<uuid-REDIGIDO>`. As substituições são textuais e não alteram nenhuma medição, estrutura de requisição ou conclusão registrada aqui.

---

## 1. Ambiente

`[OBSERVADO]` A aplicação é de página única, com rota em hash. O endereço tem a forma `https://www3.tjrj.jus.br/visproc/#/<codHash-percent-encoded>`.

`[OBSERVADO]` O `codHash` é uma cadeia em base64 de 88 caracteres, terminada em `==`, transportada no hash da URL em codificação percentual. Não é o número do processo em formato CNJ, e não é derivável dele.

`[INFERIDO]` A extensão não pode montar o endereço a partir do número do processo. Ela precisa ler o `codHash` da aba já aberta, com `decodeURIComponent` sobre o hash. Raciocínio: o valor é opaco, não guarda relação visível com o CNJ, e é o único identificador que todas as chamadas exigem.

`[OBSERVADO]` A página não contém quadros embutidos. O contexto de execução é único.

`[OBSERVADO]` A aplicação envia telemetria para o Google Analytics, bloqueada no ambiente de teste por extensão de bloqueio. Irrelevante para o produto, registrado por completude.

`[A VERIFICAR]` Validade do `codHash` ao longo do tempo, e se ele sobrevive ao encerramento da sessão. Teste: guardar o valor, encerrar a sessão, autenticar de novo e tentar a mesma URL.

---

## 2. Interface de programação

Esta é a base da extensão. Todas as chamadas são `POST`, com corpo em JSON, e todas exigem os mesmos três cabeçalhos.

### 2.1 Cabeçalhos comuns

| Cabeçalho | Valor | Observação |
|---|---|---|
| `Content-Type` | `application/json;charset=UTF-8` | `[OBSERVADO]` |
| `Accept` | `application/json, text/plain, */*` | `[OBSERVADO]` |
| `Authorization` | token obtido em `jwt-auth` | `[OBSERVADO]` valor jamais registrado |
| `ETag` | `MC42LjY=` | `[OBSERVADO]` base64 de `0.6.6`, a versão do sistema |

`[INFERIDO]` O `ETag` é verificação de versão do cliente. A extensão precisa enviá-lo, e precisa lê-lo do rodapé da própria aplicação em vez de fixá-lo no código, sob pena de quebrar na primeira atualização do sistema. Raciocínio: o valor decodificado coincide exatamente com a versão exibida no rodapé.

### 2.2 `POST /visproc/api/jwt-auth`

`[OBSERVADO]` Sem corpo. Devolve `200` com JSON. É a origem do token usado no cabeçalho `Authorization`.

`[OBSERVADO]` A aplicação chama este endereço antes de cada operação **de consulta**. Nas capturas 0 a 51 de `capturas-rede.json`, todo `consultarInfo`, `consultarProcesso` e `obterDocumento` vem precedido do par `jwt-auth` mais `site-key`.

`[OBSERVADO, correção de 25/08/2026]` **Nos dois downloads capturados isso não acontece.** A sequência das capturas 51 a 55 é `consultarProcesso`, `site-key`, `download`, `site-key`, `download`: o cliente oficial reaproveitou o token da consulta anterior e chamou apenas `site-key` antes de cada download.

A redação anterior desta seção dizia que o token nunca era reaproveitado, o que a evidência primária não sustenta.

`[INFERIDO]` O token vale por mais de uma operação, ao menos por alguns segundos. Não se sabe por quanto tempo.

**Posição adotada.** A extensão pede token novo a cada operação, inclusive antes de cada download. Isso a torna imune a expiração, ao custo de três requisições por operação onde o cliente oficial gasta duas nos downloads, ou seja, cerca de cinquenta por cento mais pressão sobre o limite de taxa, que é o perigo número um do serviço. A troca só compensa enquanto o prazo do token for desconhecido.

`[A VERIFICAR, e resolve a troca acima]` Prazo de validade do token. Teste: obter um token, guardá-lo, e reutilizá-lo em downloads sucessivos com intervalo de oito segundos, anotando em qual deles a resposta deixa de ser um PDF de tamanho plausível. Se o token durar uma janela inteira, a extensão passa a gastar duas requisições por download, e o intervalo entre lotes pode cair na mesma proporção.

`[A VERIFICAR]` Nome do campo que carrega o token na resposta, e se há prazo declarado.

### 2.3 `POST /visproc/api/site-key`

`[OBSERVADO]` Sem corpo. Devolve `204`, sem conteúdo. Chamado sempre entre o `jwt-auth` e a operação real.

`[INFERIDO]` Provável aquecimento ou registro de sessão. A extensão deve reproduzi-lo por precaução, já que custa nada e o cliente oficial nunca o omite.

### 2.4 `POST /visproc/api/consultarInfo`

`[OBSERVADO]` Corpo: `{ "codHash": "<codHash>" }`. Devolve JSON com os metadados do processo, os mesmos exibidos no painel Dados do processo, entre eles Comarca, Serventia, Competência, Data da Distribuição, Observação e a relação de partes.

### 2.5 `POST /visproc/api/consultarProcesso`

Devolve o índice das peças. Aceita dois modos, mutuamente exclusivos.

**Modo faixa.**

```json
{ "codHash": "<codHash>", "tiposArquivo": "SD", "paginaInicial": 1, "paginaFinal": 1000 }
```

**Modo últimas N folhas.**

```json
{ "codHash": "<codHash>", "tiposArquivo": "SD", "numFolhas": "1000" }
```

`[OBSERVADO]` `numFolhas` corresponde ao campo Exibir da tela, com valores `50`, `100`, `250`, `500` e `1000`, enviados como texto.

`[OBSERVADO]` Os dois modos nunca aparecem na mesma chamada. A tela apaga um campo quando o outro é preenchido.

`[OBSERVADO]` O modo faixa não gera erro quando a janela ultrapassa o fim do processo. A chamada `paginaInicial: 13000, paginaFinal: 13999` devolveu os últimos itens existentes, sem erro e sem lista vazia.

`[INFERIDO]` O servidor grampeia a janela ao fim do processo em vez de recusá-la. Isso dá à extensão uma sondagem barata do fim do índice. Raciocínio: quatro consultas com janelas distintas convergiram no mesmo item máximo.

**Forma da resposta.** `[OBSERVADO]` Árvore recursiva, com a mesma estrutura de nó em todos os níveis.

```json
{
  "codigo": 1,
  "descricao": "Processo: <CNJ>",
  "numFolVirt": "-1",
  "ultFolVirt": "13002",
  "codCnj": "<CNJ>",
  "filtros": "S;;SD",
  "filhos": [
    {
      "codigo": 2,
      "descricao": "Volume 1",
      "numFolVirt": "0",
      "filhos": [
        {
          "codigo": 3,
          "descricao": "1 - Capa",
          "numFolVirt": "1",
          "codDoctoElet": "<48 caracteres hexadecimais>"
        }
      ]
    }
  ]
}
```

| Campo | Onde aparece | Significado |
|---|---|---|
| `codigo` | todos os nós | numeração sequencial do nó na árvore devolvida, do tipo número. **Relativa à janela consultada**, ver 2.5.1 |
| `descricao` | todos os nós | rótulo exibido na tela |
| `numFolVirt` | todos os nós | folha virtual de início, **como texto**. Vale `-1` na raiz e `0` nos nós de agrupamento |
| `ultFolVirt` | **apenas na raiz** | **última folha virtual do processo, ou seja, o total** |
| `codCnj` | apenas na raiz | número do processo em formato CNJ |
| `filtros` | apenas na raiz | eco do filtro aplicado, no formato observado `S;;SD` |
| `filhos` | nós de agrupamento | lista de nós descendentes |
| `codDoctoElet` | nós de documento | chave da peça, usada em `obterDocumento` |

`[OBSERVADO]` **`ultFolVirt` traz o total de páginas do processo em toda resposta do índice.** No processo de amostra, `13002`, coincidindo exatamente com o contador da interface.

`[INFERIDO]` **A extensão não precisa abrir documento algum para descobrir o total.** A primeira consulta ao índice já entrega o número. Isso elimina a dependência do campo `#txtNumFolVirt` descrita na seção 3.3, que era a última amarra da arquitetura à tela. Raciocínio: o valor está no nó raiz de qualquer consulta, independentemente da janela pedida.

`[INFERIDO]` A extensão de cada peça se obtém pela diferença entre o `numFolVirt` de um nó de documento e o do nó de documento seguinte, e a extensão da última peça, pela diferença para `ultFolVirt`. Não há campo declarando o número de páginas de cada peça. Raciocínio: os nós de documento observados trazem apenas quatro campos, e a numeração é contínua.

`[A VERIFICAR]` Se nós de anexo, de nível quatro, têm a mesma forma dos nós de documento. A captura de esquema mostrou apenas o primeiro descendente de cada nível.

### 2.5.1 O campo `codigo` é relativo à janela

`[OBSERVADO]` A mesma peça, identificada pela folha 974, recebeu `codigo` **283** na consulta da janela de 1 a 1000, e `codigo` **202** na consulta da janela de 500 a 1000. Rótulo e folha idênticos nas duas.

`[INFERIDO]` `codigo` é um contador atribuído na ordem de montagem da árvore devolvida, e não um identificador estável da peça. Raciocínio: as duas janelas devolvem conjuntos de tamanhos diferentes, 278 e 199 peças, e a diferença entre os códigos, 81, é da ordem da diferença entre os conjuntos.

`[INFERIDO]` **O identificador estável da peça é o `codDoctoElet`.** É o único campo que não depende da consulta, e é por ele que a extensão deve deduplicar entre janelas.

### 2.6 `POST /visproc/api/obterDocumento`

```json
{ "codHash": "<codHash>", "codDoctoElet": "<48 caracteres hexadecimais>", "compact": false }
```

`[OBSERVADO]` Devolve `application/pdf` com `Content-Disposition: inline` e nome de arquivo em formato UUID. É a peça isolada exibida no visualizador.

`[OBSERVADO]` O `codDoctoElet` tem 48 caracteres hexadecimais e **não** é o número de doze dígitos que aparece no rótulo da árvore.

`[INFERIDO]` O `codDoctoElet` vem de dentro da resposta de `consultarProcesso`. Raciocínio: é o único lugar de onde o cliente poderia tê-lo obtido, já que não aparece na tela.

### 2.7 `POST /downproc/api/download`

**O endereço central do produto.** Note o prefixo distinto, `/downproc/`, e não `/visproc/`.

**Modo faixa**, correspondente ao botão *Salvar Documentos Carregados*:

```json
{ "codHash": "<codHash>", "compact": true, "tiposArquivo": "SD",
  "paginaInicial": 1, "paginaFinal": 5 }
```

**Modo seleção**, correspondente ao botão *Salvar Documentos Selecionados*:

```json
{ "codHash": "<codHash>", "paginas": [3], "compact": true, "tiposArquivo": "SD",
  "paginaInicial": 1, "paginaFinal": 5 }
```

`[OBSERVADO]` A resposta é `application/pdf` com `Content-Disposition: attachment; filename="<CNJ-REDIGIDO-SEM-PONTUACAO>.pdf"`, isto é, o número do processo sem pontuação. **O nome é sempre o mesmo**, e o navegador é quem numera as repetições.

`[INFERIDO]` A extensão precisa renomear cada bloco no momento de salvar, porque o servidor não distingue um bloco do outro pelo nome. Raciocínio: dois downloads consecutivos produziram `arquivo.pdf` e `arquivo (1).pdf`.

`[OBSERVADO]` **O campo `paginas` carrega o `codigo` de cada peça, não a folha.** Prova por três caminhos independentes:

1. Na captura da interface, com a janela de 1 a 5 carregada, marcar apenas a Capa produziu `paginas: [3]`. A Capa está na folha 1, e tem `codigo` 3 naquela árvore.
2. Pedir o download de uma peça de 67 páginas pelo seu `codigo`, 283 na janela de 1 a 1000, devolveu 1.117.780 bytes. Pedir a mesma peça pela folha, 974, devolveu 941 bytes, arquivo degenerado.
3. Pedir a mesma peça pelo `codigo` que ela tem em outra janela, 202 na janela de 500 a 1000, pareado com essa janela, devolveu exatamente os mesmos 1.117.780 bytes.

`[OBSERVADO]` **`paginaInicial` e `paginaFinal` não limitam a lista. Eles definem o contexto em que os códigos são interpretados.** Lacuna encerrada.

`[INFERIDO]` **Todo download tem que ser pareado com a consulta de índice que gerou seus códigos.** Não existe lista global de peças do processo utilizável numa chamada única. Raciocínio: o código é relativo à janela, conforme 2.5.1, e o mesmo número designa peças distintas em janelas distintas.

`[OBSERVADO]` **Código inválido produz falha silenciosa.** A requisição devolve status 200, tipo `application/pdf` e um arquivo de 941 bytes, que nenhum leitor exibe como página. Não há mensagem de erro.

`[INFERIDO]` A conferência de tamanho mínimo é obrigatória, e não opcional. Raciocínio: a assinatura da falha é indistinguível do sucesso pelos metadados da resposta.

`[OBSERVADO]` `tiposArquivo` aceita três valores, confirmados por variação controlada no campo Incluir: `SD` para Somente Documentos, `DA` para Documentos e Anexos, `SA` para Somente Anexos.

`[A VERIFICAR]` O que o campo `compact` altera. A consulta de peça isolada usa `false`, o download usa `true`.

---

## 3. Interface gráfica

Registrada por completude e como plano de reserva. A arquitetura escolhida dispensa manipulação de tela.

### 3.1 Regiões com identificador de autoria

`[OBSERVADO]` `#div-filter`, `#div-idx`, `#toolbar-idx`, `#toolbar-doc`, `#div-doc`. Fragilidade baixa.

### 3.2 Campos aproveitáveis

| Elemento | Seletor | Fragilidade |
|---|---|---|
| Pág. Inicial | `#paginaInicial` | Baixa, identificador de autoria |
| Pág. Final | `#paginaFinal` | Baixa, identificador de autoria |
| Contador de páginas | `#txtNumFolVirt` | Baixa, valor no formato `"12997 de 13002"` |
| Botão de download | `#toolbar-idx button[aria-label="Baixar o processo atual em PDF"]` | Média-alta, texto de rótulo |
| Botão Filtrar | texto `"Filtrar"` em `#div-filter button.mat-raised-button` | Alta, sem identificador, sem rótulo acessível |
| Campos Exibir e Incluir | `#mat-select-0` e `#mat-select-2` | Alta, contador global do Material |

`[OBSERVADO]` Não existe `<form>`, nem `formcontrolname`, nem `ng-reflect-*` em toda a aplicação. Varredura completa sobre `document.querySelectorAll('*')`.

### 3.2.1 Armadilha do modo de seleção

`[OBSERVADO]` Desligar e religar o botão de caixa de seleção remove e recria os elementos na tela, **mas não limpa a seleção interna da aplicação**. Ao religar o modo para um novo teste, três peças marcadas numa operação anterior voltaram marcadas, produzindo cinquenta e três itens onde se esperavam cinquenta.

`[INFERIDO]` Qualquer implementação que use a tela precisa desmarcar item a item entre lotes. Ocultar a coluna não é reinicialização, e a falha resultante seria silenciosa, com peças repetidas no download e nenhum sinal na interface. Raciocínio: a contagem só fechou depois da limpeza explícita.

`[OBSERVADO]` Clique sintético em `input.click()` dentro do `mat-checkbox` produz o mesmo efeito de clique real, com `mat-checkbox-checked` e `aria-checked="true"`, e o download honrou a seleção feita dessa forma. O modelo do Angular é atualizado, não apenas o pixel.

### 3.3 Total de páginas

`[OBSERVADO]` **13.002 páginas.** O número existe em um único lugar da interface, o campo `#txtNumFolVirt`, e **só depois de um documento ser aberto no visualizador**. Antes disso, nenhuma tela exibe o total.

`[INFERIDO]` Se a resposta de `consultarProcesso` não trouxer o total, a extensão terá que abrir uma peça qualquer só para lê-lo, ou sondar o fim do índice pela janela fora de alcance descrita em 2.5. Raciocínio: são os dois únicos caminhos observados.

### 3.4 Coerção silenciosa dos campos de página

`[OBSERVADO]` Em cerca de vinte filtragens, nenhum `mat-error`, nenhuma notificação, nenhum `[role=alert]`. **O sistema nunca recusa, ele reescreve o que foi digitado.**

- Trava mútua: `paginaInicial` nunca pode exceder `paginaFinal`, corrigido a cada tecla.
- Janela máxima: `paginaFinal` é reescrito para `paginaInicial + 999`.
- Armadilha de ordem: preencher na ordem errada faz a janela colapsar em uma única página.

`[OBSERVADO]` **A coerção é do navegador, não do servidor.** As requisições capturadas saíram já corrigidas, com amplitude de mil exatas, o que prova que nada acima do teto chega a ser submetido.

`[A VERIFICAR, alto impacto]` Qual o teto real do servidor, se houver. Teste: chamar `consultarProcesso` e `downproc/api/download` diretamente com amplitude superior a mil. Resolve-se na implementação.

**Posição do projeto sobre esse ponto.** Saber que o teto é do cliente não autoriza a extensão a pedir o processo inteiro numa chamada. A janela de mil é o padrão de carga para o qual o serviço foi desenhado, e um pedido gigante tende a estourar tempo limite e a onerar o sistema sem necessidade. O incômodo se resolve por repetição ordenada com intervalo, não por sobrecarga.

---

## 4. Comportamento medido

| Operação | Páginas pedidas | Páginas entregues | Tamanho | Tempo |
|---|---|---|---|---|
| Faixa 1 a 5 | 5 | **10** | 352.381 B | 786 ms |
| Faixa 1 a 1000 | 1000 | **1040** | 26.692.138 B | 20,3 s |
| Seleção de 1 peça | — | 1 | 215.743 B | 552 ms |
| Seleção de 3 peças distantes | — | **70** | 1.206.927 B | 2,6 s |
| Seleção de 50 peças de uma página | — | **50** | 1.006.561 B | 8,4 s |

`[OBSERVADO]` **A faixa entrega páginas a mais.** O montador completa a peça que atravessa a borda da janela. Pedidas as folhas 1 a 5, vieram 1 a 10, porque a petição inicial ocupa da folha 2 à 10. Pedidas 1 a 1000, vieram 1 a 1040, porque o laudo pericial começa na folha 974 e termina na 1040.

`[INFERIDO]` Blocos consecutivos no modo faixa se sobrepõem em magnitude imprevisível, proporcional ao tamanho da peça de borda. Numa peça de centenas de folhas, a sobreposição chega perto de um bloco inteiro duplicado.

`[OBSERVADO]` **A seleção é honrada peça a peça, com precisão aritmética.** Três peças de 2, 1 e 67 páginas entregaram exatamente 70 páginas. Uma faixa contínua entre a primeira e a última teria entregue 1.030.

`[INFERIDO]` **No modo seleção a sobreposição é estruturalmente impossível**, porque a unidade é a peça inteira e não existe borda de janela a atravessar.

`[OBSERVADO]` **Não há teto silencioso de quantidade em cinquenta itens.** A lista `paginas` com 50 folhas devolveu exatamente 50 páginas, e os marcadores do PDF reproduziram a lista pedida item a item, sem omissão, substituição ou reordenação.

`[OBSERVADO]` O custo de tempo não acompanha o número de páginas. Cinquenta peças esparsas levaram 8,4 segundos, contra 20,3 segundos para mil e quarenta páginas contíguas.

`[INFERIDO]` O tempo acompanha a quantidade de peças a localizar e concatenar, não o volume de páginas. Raciocínio: duas medidas apenas, mas com sinal forte, já que a operação de menor volume custou 40% do tempo da de maior volume. Consequência prática: lotes com muitos itens podem ficar caros mesmo com poucas páginas, e o tamanho do lote precisa ser medido antes de ser fixado.

`[OBSERVADO]` Indicador de progresso indeterminado aparece apenas em operações longas. No download de 20 segundos surgiu; no de 786 milissegundos, não.

### 4.1 Limitação de taxa

`[OBSERVADO]` **O servidor limita requisições por tempo.** Uma bateria de cerca de quinze chamadas disparadas em poucos segundos recebeu status **429** em `consultarProcesso`. As chamadas seguintes continuaram devolvendo status 200, porém com arquivos degenerados de 941 bytes.

`[OBSERVADO]` A mesma bateria com oito segundos de intervalo entre operações não recebeu 429 em nenhuma chamada.

`[INFERIDO]` **A degradação silenciosa é o comportamento mais perigoso do serviço.** Depois de atingido o limite, o servidor deixa de recusar e passa a devolver conteúdo vazio com aparência de sucesso. Uma extensão sem conferência de tamanho gravaria dezenas de arquivos inúteis sem emitir um único aviso. Raciocínio: os 941 bytes apareceram tanto após o 429 quanto em requisição com código inválido, o que faz deles a assinatura genérica de falha.

`[INFERIDO]` Cada operação da extensão custa três requisições, porque `jwt-auth` e `site-key` precedem a chamada real. O intervalo entre operações precisa ser dimensionado sobre esse múltiplo.

`[A VERIFICAR]` O limiar exato da limitação, em requisições por intervalo. Determinável por escalada controlada durante a implementação.

`[INFERIDO]` Projeção para o processo inteiro pelo modo faixa: 14 janelas, algo em torno de 350 MB e cinco minutos de geração no servidor, antes de deduplicar. Pelo modo seleção, o volume equivale ao processo real, sem redundância.

---

## 5. Formato de saída

`[OBSERVADO]` PDF 1.7, produzido por iText Core 7.2.6, gerado sob demanda, sem criptografia.

`[OBSERVADO]` O corpo das páginas é imagem, em `JBIG2Decode` na maioria e `JPXDecode` em algumas. Sobre as imagens há camada de texto com fontes base-14 e operadores de texto em todos os fluxos.

`[INFERIDO]` É digitalização com camada de reconhecimento óptico por cima. O texto é selecionável e pesquisável, com a imprecisão própria de OCR. Não é texto nativo.

### 5.1 Numeração de folha, e a divergência entre a física e a virtual

`[OBSERVADO]` **O sistema não aplica carimbo próprio ao montar o PDF.** O que existe nas páginas é o carimbo redondo da serventia, com o número manuscrito, aplicado no papel à época, capturado no escaneamento. As primeiras páginas do acervo antigo, capa e certidões, não têm carimbo algum.

`[OBSERVADO]` **O carimbo físico não coincide com a folha virtual usada pela interface de programação.** Conferência direta do arquivo do Teste 6 contra a lista de marcadores: a vigésima página corresponde à folha virtual 517 e traz carimbo 506; a vigésima primeira corresponde à folha virtual 523 e traz carimbo 511. Defasagem de onze e de doze, respectivamente.

`[INFERIDO]` A grandeza que `paginaInicial`, `paginaFinal` e `paginas` manipulam é folha virtual, contada pelo sistema sobre o acervo digitalizado, e não a numeração carimbada dos autos físicos. A defasagem tende a crescer ao longo do processo. Raciocínio: duas medições em folhas próximas mostraram desvios distintos e crescentes, o que exclui deslocamento constante.

`[INFERIDO]` **Consequências.** A extensão opera integralmente em folha virtual, do índice ao download, e por isso não é afetada. Mas nenhuma funcionalidade que parta de citação processual, do tipo "vá para fls. 506", pode assumir equivalência entre as duas numerações. Qualquer conversão exigiria leitura do carimbo por reconhecimento óptico, o que está fora do escopo deste produto.

`[INFERIDO]` A conferência de integridade se faz exclusivamente pelos marcadores, que carregam a folha virtual, jamais pelo que está desenhado na página.

`[OBSERVADO]` Não há `/PageLabels`. A numeração dos autos viaja nos marcadores, cujos títulos reproduzem os rótulos da árvore com a folha à frente.

`[INFERIDO]` Os marcadores são o instrumento de conferência da extensão. Cada PDF declara quais peças contém e em que folha cada uma começa, o que permite verificar integridade e detectar duplicação sem abrir imagem nenhuma.

---

## 6. Consequências para a arquitetura

`[INFERIDO]` A extensão não precisa simular clique em lugar nenhum. Ela lê o `codHash` da aba, pede o token, consulta o índice e chama o download. Isso elimina a dependência dos seletores frágeis da seção 3, que eram a maior fonte de risco do projeto.

**Fluxo proposto.**

1. Ler o `codHash` do hash da URL da aba ativa e o `ETag` do rodapé da aplicação.
2. Obter token em `jwt-auth`, chamar `site-key`.
3. Varrer o índice em janelas de mil folhas por `consultarProcesso`, montando a lista completa de peças com folha de início e extensão. A varredura é barata porque devolve JSON, não PDF.
4. Determinar o total de páginas pela resposta do índice, ou pelo contador da interface, ou pela sondagem da janela fora de alcance.
5. Baixar por `downproc/api/download` no modo seleção, em lotes de peças, com token novo a cada lote e intervalo entre lotes.
6. Salvar cada lote por `chrome.downloads`, com nome próprio, e gravar o estado em `chrome.storage.local` para permitir retomada.
7. Conferir integridade pelos marcadores de cada PDF, comparando a lista entregue com a lista esperada do índice, e emitir relatório final.

`[INFERIDO]` O modo seleção é superior ao modo faixa em todos os eixos medidos: sem sobreposição, sem deduplicação, volume igual ao processo real e custo proporcional ao conteúdo pedido.

---

## 7. Lacunas abertas

### 7.1 Resolvidas na Fase 0

1. ~~Forma da resposta de `consultarProcesso`~~. **Resolvida.** Ver seção 2.5. O total de páginas vem em `ultFolVirt`, no nó raiz de qualquer consulta.
2. ~~Teto de quantidade de itens na lista `paginas`~~. **Resolvida em parte.** Cinquenta itens passam sem perda alguma, com a lista de marcadores idêntica à lista pedida. Se houver teto, está acima disso, e o limite prático será o tempo de geração, não a quantidade.

3. ~~Se `paginaInicial` e `paginaFinal` limitam a lista `paginas`~~. **Resolvida.** Não limitam, contextualizam. Ver 2.7.
4. ~~Nome do campo do token em `jwt-auth`~~. **Resolvida.** O campo chama-se `jwt`, e o valor entra em `Authorization` **cru, sem o prefixo `Bearer`**. Verificado por tentativa: a chamada com o valor cru foi aceita de primeira.

### 7.2 Resolvem-se na implementação

5. Qual o teto real do servidor para a amplitude da faixa. Não altera a decisão de operar em lotes.
6. O que o campo `compact` altera no arquivo entregue. O teste anterior foi invalidado pela limitação de taxa, com as duas variantes devolvendo arquivo degenerado.
7. Limiar exato da limitação de taxa.
8. Prazo de validade do token e do `codHash`.

### 7.3 Fora do alcance da amostra

8. Peças sigilosas ou restritas. Nada encontrado nas janelas inspecionadas, mas o exame foi parcial e o processo de amostra pode não conter nenhuma.
9. Se a observação de processo volumoso existe em processos pequenos. Exige outro processo.
10. Comportamento em processo já migrado para o eproc, que é o risco de obsolescência registrado desde o início do projeto.

---

## Apêndice A. Caminho de reserva pela interface

Registrado como seguro contra mudança no contrato da interface de programação. **Não é o caminho em uso.** A extensão fala direto com o serviço, e esta seção existe para o dia em que isso deixar de funcionar.

A fonte é uma execução manual assistida do download completo, feita pela interface, antes de o tráfego ser inspecionado. Vale como levantamento independente, e as observações que se sobrepõem ao restante deste documento coincidem.

### A.1 A coerção roda a cada tecla, e reescreve o campo oposto

`[OBSERVADO]` A validação dos campos de página não roda na saída do campo. Roda a cada evento `input`, isto é, a cada tecla, e não recusa o valor: reescreve o outro campo para restaurar o invariante.

Dois invariantes, mantidos o tempo todo:

1. `paginaInicial <= paginaFinal`
2. `paginaFinal <= paginaInicial + 999`

Efeitos reproduzidos:

- Digitar `2000` em Pág. Final com Pág. Inicial em `1001` leva Pág. Inicial a `1999`, porque os estados intermediários `2`, `20` e `200` violaram o primeiro invariante e arrastaram o campo oposto a cada tecla.
- Digitar `14000` em Pág. Final com Pág. Inicial em `1999` resulta em `2998`.
- Clicar em Filtrar com amplitude acima de mil faz o próprio Filtrar reduzir Pág. Final.

`[INFERIDO]` Digitação simulada tecla a tecla é inviável. O preenchimento precisa ser atômico.

### A.2 Escrita atômica com notificação ao Angular

`[OBSERVADO]` Atribuir `el.value` diretamente não notifica o Angular. É preciso o setter nativo do protótipo, seguido de um único evento `input`.

```js
function escrever(indice, valor) {
  const campo = document.querySelectorAll('#div-filter input[type=number]')[indice];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(campo, String(valor));
  campo.dispatchEvent(new Event('input', { bubbles: true }));
}
```

### A.3 Caminhada por estados sempre válidos

`[OBSERVADO]` Mesmo com escrita atômica, ir de uma janela para a seguinte em dois passos quebra, porque o estado intermediário viola o primeiro invariante. A sequência abaixo passa apenas por estados válidos, subindo ou descendo.

```js
function definirFaixa(inicio, fim) {
  const finalAtual = Number(document.querySelectorAll('#div-filter input[type=number]')[1].value);
  const ponte = Math.min(inicio, finalAtual);
  escrever(0, ponte);
  escrever(1, Math.min(fim, ponte + 999));
  escrever(0, inicio);
  escrever(1, fim);
}
```

`[OBSERVADO]` Conferir os dois campos depois de escrever, e repetir a operação em caso de divergência, é obrigatório. Foi essa conferência que evitou baixar a mesma faixa duas vezes na execução manual.

### A.4 Sinais de término

`[OBSERVADO]` O fim do carregamento da árvore se detecta pelo aparecimento e sumiço do indicador circular, entre cinco e dez segundos. Espera fixa não serve como mecanismo principal, porque o tempo varia muito com o peso do trecho.

`[OBSERVADO]` O download por bloco cheio levou entre vinte e quarenta e cinco segundos na execução manual, e disparar o bloco seguinte com o anterior ainda gerando provocou perda de download.

### A.5 Limitação de timers em aba oculta

`[OBSERVADO]` O Chrome estica temporizadores em aba de segundo plano. Uma implementação que dependa de `setTimeout` para as pausas entre operações fica mais lenta quando o usuário troca de aba.

`[INFERIDO]` Isso não corrompe resultado, e no limite até reduz a pressão sobre o serviço. Precisa, porém, constar da interface, porque uma execução que se arrasta sem explicação parece travada.
