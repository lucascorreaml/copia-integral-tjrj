# Revisão de 25/08/2026

Revisão completa do código depois da validação em produção. Feita sob o mesmo regime de evidência do resto do projeto: cada afirmação marcada, cada defeito reproduzido antes de corrigido, cada correção acompanhada de teste.

Ponto de partida: 22 testes passando, execução real de 13.002 folhas sem erro. Ponto de chegada: 38 testes passando e sete defeitos corrigidos, dos quais dois faziam a extensão mentir sobre o próprio resultado.

---

## 1. O defeito que importa

`[OBSERVADO, por simulação do laço de tentativas]`

O tratamento da limitação de taxa em `processarLote` usava `continue`, que **consome a tentativa** do laço `for`. Três respostas 429 seguidas no mesmo lote esgotavam as três tentativas e caíam num `return false` que:

- não gravava registro de erro em `estado.lotes`;
- não escrevia linha de falha na tela, só as três advertências de limite;
- não devolvia o número sequencial já reservado.

Como a decisão final da execução era `estado.lotes.filter(l => l.situacao === 'erro').length === 0`, a extensão então anunciava **"CONCLUÍDO sem erros"** e salvava o manifesto, com um lote inteiro faltando.

Reprodução, com a rede substituída por falha simulada e nada mais alterado:

```
--- lote falha 3x por 500 ---
  estado.lotes     : [{"sequencial":1,"situacao":"erro", ...}]
  contador de erros: 1
  >> executar() diria: "terminou com 1 lote(s) em erro"

--- lote falha 3x por 429 ---
  registro na tela : (nenhuma linha de falha)
  estado.lotes     : []
  contador de erros: 0
  >> executar() diria: *** "CONCLUIDO sem erros" e salvaria o manifesto ***
```

Não apareceu em produção porque exige quinze minutos de espera em 429 dentro do mesmo lote, o que a execução validada não alcançou.

## 2. O defeito gêmeo, na direção oposta

`[OBSERVADO, por leitura verificada com busca exaustiva]`

Nenhum caminho do código removia registro de `estado.lotes`. Um lote que falhava e depois era baixado com sucesso continuava contando como erro para sempre. Efeito prático: depois do primeiro tropeço, a extensão nunca mais conseguia dizer "concluído", o manifesto automático nunca mais era salvo, e o contador de erros da tela deixava de significar alguma coisa.

## 3. A raiz comum, e a correção

`estado.lotes` é um **diário de eventos**, e estava sendo lido como se fosse o **estado atual**. Um diário não sabe se o download ficou completo.

A pergunta "veio tudo?" só tem uma fonte confiável: o próprio índice. Toda peça que alguma janela declarou tem que estar entre as baixadas, e toda janela tem que ter sido varrida.

A correção introduz `src/lib/conciliacao.js`, puro e testado, e passa a registrar em `estado.declaradas` o que cada janela varrida declarou. O veredito exige três condições simultâneas, e nenhuma delas basta sozinha:

1. todas as janelas varridas, porque sem varrer não se sabe o que existe;
2. nenhuma peça declarada faltando;
3. nenhum lote em erro ainda pendente, isto é, cujas peças continuem ausentes.

Isso conserta os dois defeitos ao mesmo tempo e implementa a **RF-17**, que pedia a relação de peças ausentes e nunca havia sido construída.

Verificação, com o mesmo cenário do item 1 rodando contra as funções de produção:

```
--- lote falha 3x por 429 ---
  ultima linha na tela : erro: DESISTINDO, limitacao de taxa persistente apos 3 tentativas.
  sequencial final     : 0 (nao gastou numero de arquivo)
  lotes em erro        : 1
  completo?            : false
  pecas faltantes      : [ 'folha 500 — 500 - Laudo Pericial' ]

--- erro antigo, peca depois baixada ---
  completo?      : true (antes ficava travado em "1 lote em erro" para sempre)
  erros sanados  : 1
```

---

## 4. Os demais defeitos corrigidos

| | Defeito | Consequência prática | Requisito |
|---|---|---|---|
| D3 | O sequencial era gasto antes do download e devolvido na falha | Dois registros do manifesto podiam compartilhar o mesmo número, e a falha por 429 queimava um número sem explicação | RF-19 |
| D4 | `chrome.downloads.download` resolve quando o download **começa**, não quando termina | Disco cheio ou interrupção deixavam o manifesto declarando arquivo que não existe na pasta | RF-20 |
| D5 | O intervalo dobrado após 429 era relido da tela a cada execução | A retomada voltava aos oito segundos e batia no limite de novo | RF-22 |
| D6 | Janela vazia era tratada como janela concluída | Consulta truncada apagaria mil folhas dos autos sem emitir aviso | RF-21 |
| D7 | A versão do rodapé era lida como a **primeira** ocorrência de `Versão` em toda a página | A árvore do índice vem antes do rodapé e carrega texto livre das peças; um rótulo com número pontuado envenenaria o ETag de todas as chamadas | RF-26 |
| D8 | Cada clique no ícone abria uma aba de execução nova | Duas abas escrevem no mesmo registro de progresso e uma apaga os avanços da outra, além de dobrar a pressão sobre o limite de taxa | RF-24 |
| D10 | O piso de tamanho era fixo em dez mil bytes, independentemente do tamanho do lote | Um lote de cinquenta peças que voltasse com doze mil bytes passava como bom | RF-23 |

Acrescido também, sem ser defeito: detecção de juntada nova durante a execução (**RF-25**), e o botão Pausar passando a responder durante a espera de cinco minutos do limite de taxa.

---

## 5. Contradição encontrada dentro da própria base de evidência

`[OBSERVADO]`

`RECON.md` seção 2.2 afirmava que o cliente oficial chama `jwt-auth` **antes de cada operação**, sem reaproveitar token. As capturas 51 a 55 de `capturas-rede.json` mostram outra coisa: os dois downloads foram precedidos **apenas** de `site-key`, reaproveitando o token da consulta anterior.

A seção foi corrigida. **O comportamento da extensão não foi alterado**, porque a decisão depende do prazo de validade do token, que continua desconhecido e não pode ser medido sem sessão autenticada.

Custo de manter como está: três requisições por operação onde o cliente oficial gasta duas nos downloads, cerca de cinquenta por cento mais pressão sobre o limite de taxa. O teste que resolve está registrado como `[A VERIFICAR]` no `RECON.md`.

---

## 6. Deriva entre documento e código, corrigida

A especificação descrevia arquivos que não existem (`popup.html`, `api.js`, `fixtures/`), pedia permissões que o código não usa (`activeTab`, `scripting`) e listava o T-08 como teste automatizado quando ele nunca havia sido escrito.

Em todos os casos o **código estava certo e o documento errado**, e o documento foi corrigido. As permissões do manifesto são hoje apenas `downloads` e `storage`, e a permissão `tabs` foi evitada de propósito: a aba de execução já aberta é localizada pelo identificador guardado em `chrome.storage.session`, e não por consulta de URL.

---

## 7. O que continua por verificar

Nada aqui pode ser medido sem a sessão autenticada do tribunal, que é do usuário.

1. **Prazo de validade do token.** Resolve a troca descrita no item 5. Teste em `RECON.md` 2.2.
2. **Se `bytesReceived` de um download vindo de blob acompanha sempre o tamanho do blob.** Enquanto não for medido, a divergência é advertência e não erro, para não barrar arquivo de uma ferramenta que funciona.
3. **Texto literal do rodapé que carrega a versão.** A leitura foi endurecida, mas continua sendo a única dependência de tela do produto. Se a aba de execução avisar que encontrou mais de uma candidata, é sinal de que este ponto precisa de um seletor de verdade.
4. **Se o índice sempre devolve a peça que atravessa a borda da janela.** É `[INFERIDO]`, e é o que sustenta a RF-21. Teste: consultar uma janela inteiramente coberta por uma única peça longa e conferir se a árvore vem com essa peça ou vazia.
