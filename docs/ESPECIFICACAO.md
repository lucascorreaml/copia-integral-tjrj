# Especificação técnica

**Produto:** extensão Chrome para download integral de autos no Visualizador de Processos Eletrônicos do TJRJ
**Versão da especificação:** 1.0
**Base factual:** `RECON.md`, Fase 0 concluída em 25/08/2026
**Regra de rastreabilidade:** todo requisito abaixo remete a um item `[OBSERVADO]` do `RECON.md`. Requisito sem lastro não entra em código.

---

## 1. Problema e solução

O visualizador limita cada operação a mil folhas. Um processo de treze mil folhas exige quatorze operações manuais, e o modo de faixa ainda entrega páginas repetidas nas bordas, porque o servidor completa a peça que atravessa a janela.

A Fase 0 revelou que o visualizador é cliente de uma interface de programação em JSON, e que essa interface aceita uma lista explícita de peças. A extensão, portanto, não automatiza cliques. Ela conversa com o mesmo serviço que a tela conversa, na mesma sessão do usuário, pedindo as peças que o índice declarou.

**Decisão de via, encerrando a Fase 1 do Project.** A via escolhida é a interface de programação do próprio visualizador. As alternativas foram descartadas com fundamento: automação de tela depende de seletores de fragilidade média-alta e do estado interno de seleção, que persiste de forma silenciosa entre operações; e a via oficial de terceiros, do tipo MNI ou PDPJ, não alcança o acervo digitalizado deste visualizador.

---

## 2. Restrições de conduta

Herdadas das instruções do Project, e vinculantes.

1. A extensão opera exclusivamente dentro da sessão autenticada aberta pelo próprio usuário. Não armazena, não transporta e não reutiliza credenciais.
2. Não contorna controle de acesso. Pede apenas o que o índice devolveu, e o índice devolve apenas o que o usuário pode ver.
3. Opera em lotes seriais, com intervalo configurável entre eles. **Não pede o processo inteiro numa chamada, ainda que o servidor aceite.** A janela de mil é o padrão de carga do serviço, e o incômodo se resolve por repetição ordenada.
4. Todo o processamento é local. Nenhuma requisição a servidor de terceiros, nenhuma telemetria, nenhum dado saindo da máquina.
5. Somente leitura. Nenhuma chamada que altere estado no servidor.
6. Permissões mínimas no manifesto, com `host_permissions` restrito a `https://www3.tjrj.jus.br/*`.

---

## 3. Arquitetura

### 3.1 Componentes

| Componente | Responsabilidade |
|---|---|
| `content.js`, script de conteúdo | Executa **todas** as chamadas de rede, dentro da origem da página. Lê o `codHash` e a versão. |
| `runner.html` e `runner.js`, página de extensão | Orquestra o trabalho, mantém a máquina de estados, exibe progresso, grava o estado. |
| `background.js`, service worker | Abre a página de execução ao clique no ícone, e reaproveita a aba já aberta para o mesmo processo. Não executa trabalho longo. |
| `src/lib/*.js` | Funções puras de decisão: indexação, lotes, conferência, conciliação, estado. Testáveis fora do navegador. |

Não há `popup.html`. O clique no ícone da barra é tratado por `chrome.action.onClicked`, o que dispensa uma página de menu.

### 3.2 Por que a rede vive no script de conteúdo

`[OBSERVADO no RECON]` A autenticação depende do cookie de sessão do domínio do tribunal.

Requisição partindo de uma página de extensão é, do ponto de vista do navegador, requisição de outro sítio. Cookie marcado como `SameSite=Lax`, que é o padrão moderno, **não** acompanha esse tipo de requisição, e a chamada falharia com o usuário logado, de forma difícil de diagnosticar. Executando dentro da página do visualizador, a requisição é de mesma origem e o cookie viaja como viaja para a aplicação oficial.

**Regra de projeto:** nenhuma chamada ao tribunal parte de contexto que não seja o script de conteúdo.

### 3.3 Por que a orquestração não vive no service worker

O service worker do Manifest V3 é encerrado por inatividade. Um download completo leva minutos. A orquestração vive em `runner.html`, que é uma aba comum de extensão e não é encerrada, e que ainda serve de interface de progresso.

### 3.4 Transporte do arquivo

O script de conteúdo recebe o PDF como `ArrayBuffer` e o envia à página de execução por mensagem. A página cria o objeto de blob na própria origem e chama `chrome.downloads.download`, que permite nome próprio e subpasta.

**Reserva**, caso a transferência de blocos grandes se mostre custosa: o script de conteúdo salva pela própria página, com âncora e atributo `download`, aceitando a perda do controle de subpasta.

---

## 4. Contrato com o servidor

Reproduzido do `RECON.md`, seção 2. Todas as chamadas são `POST` com corpo em JSON.

### 4.1 Cabeçalhos obrigatórios

```
Content-Type: application/json;charset=UTF-8
Accept: application/json, text/plain, */*
Authorization: <token de jwt-auth>
ETag: <versão em base64>
```

**RF-01.** O `ETag` deve ser derivado da versão exibida no rodapé da aplicação, codificada em base64, e nunca fixado no código. `[OBSERVADO]` o valor `MC42LjY=` decodifica exatamente para `0.6.6`, a versão em execução. Fixar o valor produz quebra silenciosa na primeira atualização do sistema.

### 4.2 Sequência de cada operação

```
POST /visproc/api/jwt-auth      → token
POST /visproc/api/site-key      → 204
POST /<operação>                → resultado
```

**RF-02.** A extensão reproduz a sequência completa a cada operação, sem reaproveitar token entre lotes. `[OBSERVADO]` é o comportamento do cliente oficial, e elimina a classe de erros por expiração.

### 4.3 Índice

```
POST /visproc/api/consultarProcesso
{ "codHash": "<codHash>", "tiposArquivo": "SD", "paginaInicial": 1, "paginaFinal": 1000 }
```

Resposta em árvore recursiva. Campos relevantes: `ultFolVirt` na raiz, com o total de folhas; `numFolVirt` em cada nó, com a folha de início, em texto; `codDoctoElet` nos nós de documento; `filhos` nos nós de agrupamento.

### 4.4 Download

```
POST /downproc/api/download
{ "codHash": "<codHash>", "paginas": [283, 202, 197], "compact": true,
  "tiposArquivo": "SD", "paginaInicial": 1, "paginaFinal": 1000 }
```

Resposta `application/pdf`. O nome devolvido é sempre o número do processo sem pontuação, e por isso a extensão sempre renomeia.

**RF-02b, e este é o ponto mais delicado do contrato.** O campo `paginas` carrega o `codigo` de cada peça, **jamais a folha**. E o `codigo` é relativo à janela consultada: a mesma peça recebe números diferentes em consultas diferentes. Os campos `paginaInicial` e `paginaFinal` da requisição de download não limitam a lista, eles declaram em que contexto os códigos devem ser lidos, e portanto **têm que ser exatamente os mesmos da consulta de índice que gerou aqueles códigos**.

Código fora do contexto produz falha silenciosa: status 200, tipo `application/pdf`, arquivo de 941 bytes.

### 4.5 Token

`[OBSERVADO]` `jwt-auth` devolve JSON com o campo `jwt`. O valor entra no cabeçalho `Authorization` **cru, sem o prefixo `Bearer`**.

---

## 5. Fluxo de execução

O processamento é **por janela**, e não em duas fases separadas. A razão é o `codigo` relativo: os códigos de uma janela só valem dentro dela, então índice e download da mesma janela têm que andar juntos.

```
INICIO
  └─ lê codHash do hash da URL, decodifica percentual
  └─ lê versão do rodapé, converte para base64
PRIMEIRA JANELA
  └─ consultarProcesso(1, 1000)
  └─ ultFolVirt define quantas janelas existem
PARA CADA JANELA W, de 1000 em 1000 folhas
  ├─ consultarProcesso(W.ini, W.fim)          [se ainda não consultada]
  ├─ achata a árvore, coletando codigo, numFolVirt, codDoctoElet, descricao
  ├─ descarta as peças cujo codDoctoElet já foi baixado em janela anterior
  ├─ atribui a W apenas as peças cujo numFolVirt cai dentro de W
  ├─ particiona essas peças em lotes de tamanho configurável
  └─ para cada lote
       ├─ download(paginas = códigos do lote, paginaInicial = W.ini, paginaFinal = W.fim)
       ├─ confere tamanho mínimo e contagem de páginas
       ├─ salva com nome próprio
       ├─ grava o lote como concluído, com os codDoctoElet incluídos
       └─ aguarda o intervalo configurado
CONFERENCIA FINAL
  └─ compara o entregue com o esperado, gera manifesto e relatório
FIM
```

**Estados persistidos:** por janela e por lote, com os valores `pendente`, `em_andamento`, `concluido` e `erro`, em `chrome.storage.local`, chaveados pelo `codHash`. O registro de cada lote concluído guarda a lista de `codDoctoElet`, que é o que permite deduplicar na retomada, já que o `codigo` não é estável.

---

## 6. Requisitos funcionais

**RF-03.** Ler o `codHash` do hash da URL da aba ativa, com `decodeURIComponent`. Não tentar derivá-lo do número do processo. `[OBSERVADO]` o valor é opaco e sem relação com o CNJ.

**RF-04.** Obter o total de folhas do campo `ultFolVirt` da primeira resposta do índice. Não abrir documento algum para isso. `[OBSERVADO]` o campo está presente em toda resposta.

**RF-05.** Processar janela por janela, de mil em mil folhas, de 1 até `ultFolVirt`. Para cada janela, achatar a árvore recursiva e coletar, de cada nó que possua `codDoctoElet`, os campos `codigo`, `numFolVirt`, `codDoctoElet` e `descricao`. **Não montar lista global de peças para baixar depois**, porque o `codigo` só vale dentro da janela que o produziu.

**RF-06.** Deduplicar as peças por `codDoctoElet`, jamais por `codigo`. `[OBSERVADO]` o índice devolve peças que começam antes da janela pedida, e o `codigo` da mesma peça muda de uma janela para outra. Atribuir cada peça à janela em que seu `numFolVirt` cai.

**RF-07.** Calcular a extensão de cada peça pela diferença entre seu `numFolVirt` e o da peça seguinte **na ordenação global**, não na ordenação da janela. Apenas a última peça do processo inteiro usa `ultFolVirt` como referência. `[OBSERVADO]` tratar a última peça de uma janela como última do processo produziu o valor absurdo de 12.028 páginas para uma peça de 67. A consequência prática é que a conferência de uma janela só se fecha depois de consultado o índice da janela seguinte.

**RF-08.** Baixar **exclusivamente pelo modo de seleção**, enviando em `paginas` a lista de `codigo` do lote, acompanhada de `paginaInicial` e `paginaFinal` **idênticos aos da consulta de índice que gerou aqueles códigos**. `[OBSERVADO]` o modo de faixa entrega páginas a mais, com sobreposição imprevisível, ao passo que o modo de seleção é honrado peça a peça com precisão aritmética.

**RF-09.** Tamanho de lote configurável, com valor inicial de cinquenta peças. `[OBSERVADO]` cinquenta peças passaram sem perda, em 8,4 segundos. `[INFERIDO]` o custo de tempo acompanha a quantidade de peças, não o volume de páginas, e por isso o lote precisa ser calibrado por medição.

**RF-10.** Intervalo configurável entre operações, com valor inicial de **oito segundos**. `[OBSERVADO]` uma bateria de cerca de quinze chamadas sem intervalo recebeu status 429; a mesma bateria com oito segundos de intervalo passou inteira. Cada operação custa três requisições, porque `jwt-auth` e `site-key` a precedem.

**RF-10b.** Ao receber status 429, interromper a execução, aguardar no mínimo cinco minutos e retomar com o intervalo dobrado. **Nunca insistir em ritmo igual ou maior.**

**RF-11.** Salvar cada lote com nome próprio, no formato `<cnj-sem-pontuacao>_<sequencial-com-zeros>_<folhaInicial>-<folhaFinal>.pdf`, em subpasta nomeada pelo número do processo.

**RF-12.** Gravar, ao lado dos arquivos, um manifesto em JSON contendo, por lote, a lista de folhas pedidas, os rótulos das peças, o tamanho do arquivo, o tempo de resposta e o resultado da conferência.

**RF-13.** Persistir o estado após cada lote, de modo que o trabalho seja retomável após fechamento do navegador, queda de sessão ou falha.

**RF-14.** Ao retomar, pular lotes já concluídos e refazer apenas os pendentes e os que ficaram em erro.

**RF-15.** Detectar sessão expirada. Se qualquer chamada devolver código diferente de 200, ou devolver conteúdo que não seja `application/pdf` quando se espera PDF, interromper, marcar o lote como erro e avisar o usuário. **Nunca gravar arquivo de resposta inesperada.**

**RF-15b.** Rejeitar resposta degenerada mesmo com status 200 e tipo correto. Todo arquivo abaixo do piso de tamanho é tratado como erro e não é gravado. O piso era fixo em dez mil bytes e passou a ser proporcional ao número de peças do lote; ver **RF-23**, que substitui esta parte. A contagem de páginas ficou como advertência, e não como causa de rejeição, porque o contador lê apenas objetos não comprimidos e erraria para menos. `[OBSERVADO]` a assinatura da falha é um PDF de 941 bytes, devolvido tanto após limitação de taxa quanto por código inválido, sempre com status 200 e tipo `application/pdf`. **Sem esta trava, a extensão gravaria dezenas de arquivos vazios sem emitir um único aviso.**

**RF-16.** Exibir progresso com o total de peças, o total de folhas, o lote corrente, os lotes concluídos e os lotes em erro. Oferecer pausa e retomada.

**RF-17.** Ao final, produzir relatório legível com o total de folhas esperado, o total entregue, a relação de peças ausentes se houver, e a lista de lotes em erro.

---

## 6.1 Requisitos acrescidos na revisão de 25/08/2026

Todos nascem de defeito encontrado por leitura e reproduzido em simulação, e cada um entrou acompanhado de teste. O relato completo está em `REVISAO.md`.

**RF-18, e este substitui a leitura ingênua do diário de lotes.** O veredito sobre a integralidade da execução é obtido por **conciliação**: toda peça que alguma janela declarou tem que estar entre as baixadas, e toda janela tem que ter sido varrida. A extensão só anuncia conclusão quando as duas condições se verificam, e nunca por contagem de registros de lote.

`[OBSERVADO, por simulação do laço anterior]` A contagem de registros mentia nos dois sentidos. Um lote que esgotava as tentativas por limitação de taxa não deixava registro nenhum, e a execução anunciava conclusão com o lote faltando. Um lote que falhava e depois era refeito deixava registro que nunca saía, e a execução passava a acusar erro para sempre.

**RF-18b.** A relação de peças ausentes, exigida pela RF-17, sai dessa conciliação, com folha e rótulo de cada peça, no registro da tela e no manifesto.

**RF-19.** Todo caminho de desistência de lote grava registro de erro e escreve linha de falha na tela. Não pode existir saída de falha silenciosa. A falha por limitação de taxa esgotada é nomeada como tal, e não confundida com erro de rede.

**RF-19b.** Falhar o mesmo lote outra vez **substitui** o registro anterior em vez de acumular, para que a contagem de erros continue significando alguma coisa depois de várias retomadas.

**RF-20.** O lote só é dado por concluído depois que o Chrome confirma a gravação do arquivo em disco. `chrome.downloads.download` resolve quando o download **começa**, e sem essa espera disco cheio ou interrupção deixariam o manifesto declarando arquivo que não existe. Interrupção é erro. Divergência entre bytes recebidos e bytes gravados é advertência, porque `[A VERIFICAR]` se `bytesReceived` acompanha sempre o tamanho do blob.

**RF-21.** Janela que não declara peça alguma só é dada por concluída quando uma peça iniciada antes dela a atravessa inteira, o que acontece em peça muito longa. Fora desse caso é consulta truncada, e marcar a janela como concluída apagaria aquelas folhas dos autos sem emitir aviso. `[INFERIDO]` do fato de o índice devolver a peça que atravessa a borda da janela.

**RF-22.** O intervalo aprendido após limitação de taxa é persistido junto do progresso, e a execução seguinte começa por ele. Reler o valor da tela repetiria o erro que já custou espera de cinco minutos.

**RF-23.** O piso de tamanho de arquivo é proporcional ao número de peças do lote, com mil bytes por peça e o piso absoluto de dez mil como mínimo. `[OBSERVADO]` a menor razão medida contra o tribunal foi de vinte mil bytes por peça. O piso fixo de dez mil deixava passar como bom um lote de cinquenta peças que voltasse com doze mil bytes.

**RF-24.** Um único painel de execução por processo. Dois painéis escreveriam no mesmo registro de progresso, e o que salvasse por último apagaria os avanços do outro, produzindo peça baixada duas vezes e peça perdida, além de dobrar a pressão sobre o limite de requisições.

**RF-25.** Alteração do `ultFolVirt` no meio da execução, que significa juntada nova, é detectada, avisada e impede o anúncio de conclusão. A execução seguinte varre as janelas que passaram a existir.

**RF-26.** A leitura da versão do rodapé exige a forma de número pontuado e fica com a **última** ocorrência da página, porque a árvore do índice carrega texto livre das peças e vem antes do rodapé. Havendo mais de uma candidata, a aba de execução avisa qual foi usada.

**RF-27, a Camada 3 da conferência.** Cada lote recebido tem seus marcadores lidos e comparados, item a item, com a lista de peças que o lote pediu. A folha de cada peça é extraída do título do marcador, que traz o número à frente do rótulo.

`[OBSERVADO]` No RECON seção 5: o PDF não possui `/PageLabels`, e a numeração dos autos viaja nos marcadores, cujos títulos reproduzem os rótulos da árvore. No teste de cinquenta peças, a lista de marcadores reproduziu a lista pedida sem omissão, substituição nem reordenação.

**RF-27b, e este limite é deliberado.** A Camada 3 é **advertência, nunca rejeição**, e não entra no veredito de `completo`. O leitor de marcadores nunca foi exercitado contra um PDF real do tribunal, produzido por iText 7.2.6. Barrar arquivo com base numa leitura não medida seria trocar uma ferramenta que funciona por uma suposição. O resultado por lote vai para o manifesto, em `lotes[].marcadores`, e o resumo para `conferencia.marcadores`, justamente para permitir a medição que autoriza a promoção a trava dura.

**RF-27c.** A leitura não usa dependência externa: a descompressão é feita por `DecompressionStream`, que é API nativa. Só fluxos marcados como `/ObjStm` são inflados, porque dicionário de marcador ou está solto no arquivo, e o texto cru já o traz, ou está dentro de fluxo de objetos. `[OBSERVADO, por sonda]` inflar tudo significaria descomprimir centenas de megabytes de imagem de página, em `JBIG2Decode` e `JPXDecode`, para não achar nada.

---

## 7. Requisitos não funcionais

**RNF-01.** Manifest V3, sem código remoto. Toda biblioteca empacotada localmente.

**RNF-02.** Permissões: `downloads` e `storage`, e nada além disso. `host_permissions` apenas `https://www3.tjrj.jus.br/*`.

A especificação pedia também `activeTab` e `scripting`. Nenhuma das duas foi necessária: o script de conteúdo é declarado de forma estática no manifesto, e o `url` da aba do tribunal chega ao service worker por força do próprio `host_permissions`. A permissão `tabs` também foi evitada de propósito, e por isso a aba de execução já aberta é localizada pelo identificador guardado em `chrome.storage.session`, e não por consulta de URL.

**RNF-03.** Requisições estritamente seriais. Nenhum paralelismo.

**RNF-04.** Recuo exponencial em erro transitório, com no máximo três tentativas por lote, partindo de cinco segundos.

**RNF-05.** Tempo limite por lote de cento e oitenta segundos. `[OBSERVADO]` mil e quarenta páginas levaram vinte segundos; a margem cobre lotes atípicos.

**RNF-06.** Nenhum registro em disco ou em console contendo token, cookie ou teor de peça.

---

## 8. Conferência de integridade

**Camada 1, sempre.** Código de resposta 200, tipo de conteúdo `application/pdf`, tamanho acima de um mínimo, e presença dos bytes iniciais de PDF.

**Camada 2, sempre.** Soma das extensões esperadas do lote confrontada com o número de páginas do arquivo, obtido pela contagem de objetos de página. `[OBSERVADO]` no teste de cinquenta peças de uma página, o entregue bateu com o esperado.

**Camada 3, construída em 25/08/2026, em modo de observação.** Leitura dos marcadores do PDF e comparação, item a item, com a lista de folhas pedidas. `[OBSERVADO]` os marcadores reproduzem a lista pedida sem omissão, substituição ou reordenação, o que faz deles o instrumento natural de conferência. Ver **RF-27**.

**Não usar carimbo de página como referência.** `[OBSERVADO]` o carimbo é da serventia, aplicado no papel, e diverge da folha virtual em magnitude crescente. Nas medições, folha virtual 517 trazia carimbo 506, e folha virtual 523 trazia carimbo 511.

---

## 9. Plano de testes

### 9.1 Contra a interface de programação, já executados

**T-01. Executado, resultado incorporado.** O campo `paginas` carrega `codigo`, não folha, e o `codigo` é relativo à janela. Os campos de página contextualizam, não limitam. Reescreveu os requisitos RF-05 a RF-08.

**T-02. Executado, invalidado.** A tentativa de amplitude superior a mil recebeu status 429. Refazer com intervalo, sem urgência, porque não altera a decisão de operar em lotes.

**T-03. Executado, invalidado.** As duas variantes do campo `compact` devolveram arquivo degenerado, por contaminação da limitação de taxa. Refazer com intervalo de oito segundos.

### 9.2 Testes automatizados sobre respostas gravadas

**T-04.** Achatamento da árvore recursiva, com nós de agrupamento sem `codDoctoElet`, com quatro níveis, e com os dois esquemas de agrupamento observados, por Volume e por Juntada.

**T-05.** Deduplicação por `codDoctoElet` entre janelas consecutivas, verificando que a mesma peça com `codigo` diferente é reconhecida como repetida.

**T-06.** Cálculo de extensão de peça na ordenação global, verificando especificamente que a última peça de uma janela não é tratada como última do processo.

**T-06b.** Pareamento entre lote e janela, verificando que nenhum download é montado com códigos de uma consulta e janela de outra.

**T-07.** Particionamento em lotes, com resto.

**T-08. Executado.** Conciliação entre o que o índice declarou e o que foi baixado, cobrindo retomada a partir de estado parcial: lote em erro depois sanado, lote perdido sem registro de erro, e janela ainda não varrida.

**T-09.** Resposta que não é PDF quando se espera PDF, verificando que nada é gravado.

### 9.3 Teste em ambiente real

**T-10.** Processo pequeno, de menos de mil folhas, conferindo download completo em lote único.

**T-11.** Processo de treze mil folhas, conferindo total entregue contra `ultFolVirt`, ausência de peça faltante e ausência de duplicação.

**T-12.** Interrupção deliberada no meio, seguida de retomada, conferindo que nenhum lote é refeito e nenhum é perdido.

**T-13.** Sessão expirada durante a execução, conferindo que a extensão para e não grava arquivo inválido.

---

## 10. Estrutura do repositório

```
copia-integral-tjrj/
├── README.md                  apresentação, arquitetura em resumo, regras de alteração
├── LEIAME.md                  instalação e uso, para quem não é programador
├── LICENSE
├── manifest.json
├── package.json
├── src/
│   ├── background.js          ponte, abre e reaproveita a aba de execução
│   ├── content.js             TODA a rede, dentro da origem do tribunal
│   ├── runner.html
│   ├── runner.js              orquestração e interface de progresso, só cola
│   └── lib/
│       ├── indexador.js       achatamento, janelas, deduplicação, extensão de peça
│       ├── lotes.js           particionamento e nomeação
│       ├── conferencia.js     travas de integridade do arquivo recebido
│       ├── marcadores.js      leitura dos marcadores do PDF, a Camada 3
│       ├── conciliacao.js     veredito sobre a integralidade da execução
│       └── estado.js          persistência para retomada
├── test/                      amostras e testes das funções puras, rodam em Node
├── icones/
└── docs/
    ├── RECON.md               levantamento empírico do sistema alvo
    ├── ESPECIFICACAO.md       este documento
    ├── capturas-rede.json     registro bruto do tráfego, evidência primária
    ├── ERROS-E-DESCOBERTAS.md os erros cometidos e como cada um apareceu
    └── REVISAO.md             revisão de código posterior à validação
```

---

## 11. Critérios de aceite

1. Baixa a integralidade de um processo com mais de mil folhas, sem intervenção manual entre lotes.
2. O somatório de folhas entregues iguala o `ultFolVirt` do índice, sem peça faltante e sem duplicação.
3. Retoma após interrupção sem refazer lote concluído e sem deixar lacuna.
4. Detecta expiração de sessão, para e não grava arquivo inválido.
5. Produz manifesto e relatório de conferência legíveis.
6. Não faz nenhuma requisição a servidor que não seja `www3.tjrj.jus.br`.
7. Um lote escolhido por amostragem é idêntico ao mesmo conjunto de peças baixado manualmente pela tela.

---

## 12. Fora do escopo desta versão

- Junção dos lotes em PDF único. O manifesto permite fazê-lo depois, por ferramenta separada.
- Conversão entre carimbo físico e folha virtual.
- Leitura, resumo ou indexação de conteúdo.
- Suporte ao eproc, que é o risco de obsolescência registrado desde o início. A camada `content.js` deve ficar isolada o bastante para receber um segundo adaptador sem reescrita do restante.
