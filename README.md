# Cópia Integral dos Autos — TJRJ

Extensão para Chrome, Manifest V3, que baixa a íntegra de autos digitais do Visualizador de Processos Eletrônicos do TJRJ em lotes ordenados, dentro da sessão autenticada do próprio usuário.

O visualizador limita cada exportação a mil folhas. Um processo de treze mil folhas exige quatorze operações manuais, e o modo de faixa ainda devolve páginas repetidas nas bordas, porque o servidor completa a peça que atravessa a janela. Esta extensão faz o mesmo trabalho de uma vez, peça a peça, sem sobreposição, e no fim prova o que baixou.

Validada em produção sobre um processo real de **13.002 folhas**: 4.829 peças, 364 MB, 22 lotes, nenhuma duplicação e nenhuma lacuna de folhas.

JavaScript puro. Sem dependência externa, sem etapa de compilação, sem código remoto. É uma pasta que se carrega sem compactação.

---

## Limites, e eles não são negociáveis

1. **Somente leitura.** Nada que protocole, assine, movimente ou altere estado no servidor.
2. **Dentro da sessão do próprio usuário.** Não armazena, não transporta e não reutiliza credenciais. Não há login, não há servidor, não há conta.
3. **Não contorna controle de acesso.** Pede ao tribunal apenas o que o índice devolveu, e o índice devolve apenas o que aquele usuário já pode ver na tela.
4. **Operações seriais, com intervalo.** Nunca pede o processo inteiro numa chamada, ainda que o servidor aceite.
5. **Todo o processamento é local.** Nenhuma requisição a servidor que não seja `www3.tjrj.jus.br`. Nenhuma telemetria.
6. **Nada de segredo em disco.** Token, cookie e teor de peça nunca são registrados em arquivo, console ou relatório.

Use apenas em processos aos quais você já tem acesso legítimo, com as suas próprias credenciais. A ferramenta automatiza um trabalho que o usuário já poderia fazer à mão, e nada além disso.

---

## Instalar

1. Baixe ou clone o repositório para uma pasta que possa ficar onde está. O Chrome lê os arquivos dali toda vez.
2. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e aponte para a pasta que contém `manifest.json`.

O passo a passo escrito para quem não é programador, com o modo de usar e o que fazer quando algo dá errado, está em **[LEIAME.md](LEIAME.md)**.

---

## Como funciona

```
background.js   abre a aba de execução ao clique no ícone, e reaproveita a que já existe
content.js      TODA a rede, injetado na origem do tribunal
runner.html/js  orquestração, progresso, retomada — só cola e interface
lib/            as decisões, puras e testadas fora do navegador
```

**A rede vive só em `content.js`.** A autenticação depende do cookie de sessão do domínio, e cookie `SameSite=Lax` não acompanha requisição partindo de página de extensão, que o navegador trata como requisição de outro sítio. Mover uma chamada para o service worker faz a extensão falhar com o usuário logado, de um jeito difícil de diagnosticar.

**A orquestração não vive no service worker**, que o Manifest V3 encerra por inatividade enquanto o trabalho leva minutos. Ela vive numa aba comum de extensão.

**O download é peça a peça, nunca por faixa.** A faixa entrega páginas a mais, com sobreposição de tamanho imprevisível. A seleção é honrada com precisão aritmética.

**A conclusão não é contada, é conciliada.** A extensão guarda a lista de peças que o índice declarou e compara com o que foi baixado. Só anuncia conclusão quando as duas fecham e todas as janelas foram varridas. Se faltar algo, ela diz folha e nome de cada peça ausente.

---

## Desenvolver

```
npm test
```

38 testes das funções puras. Não precisa de Chrome, de rede nem de acesso ao tribunal.

Regras para qualquer alteração:

- As funções de `src/lib/` são puras e testáveis fora do navegador. **Manter assim.** Lógica de decisão nova vai para lá, não para `runner.js`, que deve continuar sendo apenas cola e interface.
- Requisito novo entra com teste.
- **Nenhuma saída de falha silenciosa.** Todo caminho que desiste de um lote grava registro e escreve linha na tela. Ao acrescentar um caminho de erro, ele tem que passar pelo mesmo ponto de registro.
- Toda chamada ao tribunal parte de `content.js`, e de nenhum outro lugar.
- Nada de dependência externa, de etapa de compilação ou de código remoto. O Manifest V3 proíbe carregar script externo, e a extensão precisa continuar sendo uma pasta que se carrega sem compactação.
- Identificadores e comentários em português, sem acento, para casar com o domínio. Texto de interface em português com acento.

---

## Documentação

O projeto foi conduzido sob um regime de evidência explícito, porque sistemas judiciais brasileiros não têm documentação pública confiável e afirmação não verificada produz software que falha em silêncio. Toda afirmação técnica é marcada como `[OBSERVADO]`, `[INFERIDO]` ou `[A VERIFICAR]`.

| Documento | O que é |
|---|---|
| [`docs/RECON.md`](docs/RECON.md) | levantamento empírico do sistema alvo, base factual de tudo |
| [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md) | requisitos numerados, cada um rastreável a um `[OBSERVADO]` do RECON |
| [`docs/capturas-rede.json`](docs/capturas-rede.json) | registro bruto do tráfego, evidência primária |
| [`docs/REVISAO.md`](docs/REVISAO.md) | revisão de código posterior à validação, com os defeitos encontrados e reproduzidos |
| [`docs/ERROS-E-DESCOBERTAS.md`](docs/ERROS-E-DESCOBERTAS.md) | os erros cometidos ao construir isto, e como cada um foi descoberto |

Quem for mexer no código deve ler antes o [`docs/ERROS-E-DESCOBERTAS.md`](docs/ERROS-E-DESCOBERTAS.md). Cada um daqueles erros parecia óbvio na direção contrária, e voltaria caso o próximo a mexer não o conhecesse.

---

## Licença

MIT. Ver [LICENSE](LICENSE). A cláusula de ausência de garantia importa: esta ferramenta conversa com um sistema de tribunal cujo comportamento interno não é documentado publicamente, e a conferência que ela faz é da integralidade do download, não do conteúdo dos autos.

---

## Obsolescência

O TJRJ está migrando o acervo do DCP e do PJe para o eproc. Esta extensão fala com o visualizador do acervo legado. A camada `content.js` é isolada o bastante para receber um segundo adaptador sem reescrita do restante.
