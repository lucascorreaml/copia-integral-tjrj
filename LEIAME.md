# Cópia Integral dos Autos — TJRJ

Extensão para Chrome que baixa a íntegra de autos digitais do Visualizador de Processos Eletrônicos do TJRJ, em lotes, sem exigir que você repita a exportação de mil em mil folhas.

Ela conversa com o mesmo serviço que a tela do visualizador conversa, dentro da sua própria sessão autenticada. Não guarda senha, não usa servidor externo, não envia nada para lugar nenhum.

---

## Instalar, primeira vez

1. Descompacte esta pasta em um lugar onde ela possa ficar, por exemplo `Documentos\copia-integral-tjrj`. **Não apague depois de instalar**, porque o Chrome lê os arquivos dali toda vez.
2. Abra o Chrome e digite `chrome://extensions` na barra de endereço.
3. No canto superior direito, ligue o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**, no canto superior esquerdo.
5. Selecione a pasta do projeto, aquela que contém o arquivo `manifest.json`.
6. A extensão aparece na lista. Clique no ícone de peça de quebra-cabeça na barra do Chrome e fixe a **Cópia Integral dos Autos — TJRJ** para ela ficar sempre visível.

---

## Usar

1. Faça login no Portal de Serviços e abra o processo no visualizador.
2. Se o visualizador abrir numa janela pop-up, sem abas, copie o endereço e cole numa aba comum. A extensão não aparece em janela pop-up.
3. Com a aba do processo em primeiro plano, clique no ícone da extensão. Abre uma aba de controle.
4. Confira as duas configurações e clique em **Iniciar**.

**Incluir**, valor inicial *Documentos e anexos*. Define o que entra no download. Essa é a íntegra dos autos, e é o que você quer na maioria dos casos. *Somente documentos* deixa os anexos de fora, e nesse modo o aviso de contagem divergente é esperado: as folhas dos anexos continuam contando na numeração ainda que os arquivos não venham.

Trocar essa opção no meio de um processo já iniciado muda a árvore inteira e, com ela, a numeração interna que a extensão usa para pedir as peças. Por isso a extensão recusa a troca e pede que você volte à opção anterior ou limpe o progresso.

**Peças por lote**, valor inicial 50. Quantas peças processuais entram em cada arquivo PDF gerado.

**Intervalo**, valor inicial 8 segundos. Pausa entre operações. O servidor do tribunal recusa quem pede rápido demais, e essa recusa é silenciosa: ele passa a devolver arquivos vazios que parecem válidos. Oito segundos foi o intervalo verificado como seguro. **Diminuir esse número é a maneira mais fácil de quebrar tudo.**

Os arquivos caem na sua pasta de Downloads, dentro de uma subpasta com o número do processo, assim:

```
12345678920208190001 - fls 00001 a 00489 - Parte 001.pdf
12345678920208190001 - fls 00490 a 00973 - Parte 002.pdf
12345678920208190001 - fls 00974 a 01040 - Parte 003.pdf
```

O número do processo vem na frente de propósito: se você arrastar um desses arquivos para um e-mail ou para a pasta de outro caso, ele continua dizendo de onde veio, e não se confunde com a Parte 001 de outro processo. Os zeros à esquerda também são de propósito, para a ordem alfabética da pasta coincidir com a ordem das folhas. No fim, um arquivo `- manifesto.json` registra o que foi baixado, peça por peça.

---

## Como saber se veio tudo

A extensão não conta arquivos para decidir isso. Ela guarda a lista de todas as peças que o índice do tribunal declarou e, no fim, compara com o que foi efetivamente baixado.

Só aparece **CONCLUÍDO** quando as duas listas fecham e todas as janelas de mil folhas foram varridas. Se faltar qualquer coisa, ela diz quantas peças faltam e mostra folha e nome das primeiras, e a lista completa vai para o manifesto, no campo `conferencia.pecasFaltantes`.

O campo que responde à sua pergunta, dentro do manifesto, é `conferencia.completo`. Se ele for `true`, os autos vieram inteiros dentro do filtro escolhido.

Além disso, cada PDF é conferido contra os próprios marcadores, que são o índice interno do arquivo e trazem a folha de cada peça. É o arquivo declarando o que contém, em vez de a extensão deduzir pelo tamanho. Essa conferência **ainda não barra nada**, porque não foi medida contra arquivo real do tribunal: por ora ela só observa e anota. Se ao final aparecer o aviso de que os marcadores não bateram em algum lote, me mostre, porque é isso que decide se ela pode virar trava de verdade.

---

## Enquanto estiver rodando

A aba de controle pode ficar em segundo plano e você pode usar o computador normalmente. Saiba, porém, que o Chrome estica os temporizadores de abas ocultas, e por isso a pausa entre lotes pode ficar maior do que os oito segundos configurados. A execução continua correta, só demora mais.

Não precisa ficar conferindo: **a extensão percebe e avisa**. Se aparecer no registro uma linha dizendo que o Chrome está esticando as pausas, é isso, e não é defeito. Se quiser velocidade previsível, deixe a aba de controle visível, numa segunda janela ao lado.

O computador não pode hibernar no meio. Em execução longa com você longe da máquina, confira as configurações de energia do Windows.

---

## Se algo der errado

**A extensão avisou que atingiu o limite de requisições.** Ela para sozinha, espera cinco minutos e retoma com o intervalo dobrado. Não faça nada, só deixe a aba aberta. Se quiser interromper durante essa espera, o botão **Pausar** responde na hora, não precisa esperar os cinco minutos acabarem.

O intervalo maior fica guardado. Na próxima vez que você mandar rodar esse processo, ela já começa pelo valor que funcionou, em vez de voltar aos oito segundos e bater no limite de novo.

**Um lote falhou.** Clique em **Iniciar** de novo. Ela pula tudo que já foi baixado e refaz apenas o que faltou. Quando o lote finalmente vem, ele deixa de contar como erro, e o contador de erros na tela volta a zero.

**Ela disse que faltam peças.** O nome e a folha das primeiras aparecem no registro, e a lista completa fica no manifesto. Clique em **Iniciar** de novo. Se depois de duas ou três tentativas as mesmas peças continuarem faltando, aumente o intervalo para vinte segundos antes de tentar outra vez.

**O processo cresceu no meio.** Se alguém protocolou petição enquanto a extensão rodava, ela avisa e não declara conclusão. Clique em **Iniciar** outra vez ao terminar: ela pega só as folhas novas.

**Fechei o navegador no meio.** Reabra o processo, clique no ícone e em **Iniciar**. O progresso está salvo e a retomada é automática.

**A sessão do tribunal expirou.** A extensão para e avisa. Faça login de novo, reabra o processo e clique em **Iniciar**.

**Quero recomeçar do zero.** O botão **Limpar progresso** apaga o registro. Os arquivos já baixados continuam na pasta.

---

## O que ela não faz

Não junta os lotes num PDF único, não lê nem resume o conteúdo, não peticiona, não movimenta processo e não altera nada no servidor. É estritamente leitura e download.

---

## Nota sobre numeração

A folha que a extensão usa é a folha virtual do sistema, que é a mesma que aparece na árvore do visualizador. Ela **não coincide** com o carimbo redondo da serventia impresso no papel digitalizado. Nas medições feitas, a folha virtual 517 trazia carimbo 506. Ao procurar uma peça citada como "fls. 506", conte com essa defasagem.

---

## Para quem for mexer no código

`npm test` roda os testes das funções puras. Não precisa de Chrome nem de acesso ao tribunal. A documentação técnica está em `docs/`, e o `README.md` traz as regras que valem para qualquer alteração.
