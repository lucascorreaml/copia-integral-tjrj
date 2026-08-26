// Vigia de erros da pagina de execucao.
//
// Carregado ANTES do modulo principal, e de proposito SEM type="module": se
// runner.js falhar ao carregar, por erro de sintaxe ou caminho de import
// errado, o modulo inteiro nao roda e ninguem mostraria o erro na tela. O
// usuario veria uma pagina com botoes que nao respondem e nenhuma explicacao.
//
// Nao pode ser script embutido no HTML: o Manifest V3 proibe, por politica de
// seguranca de conteudo.

(function () {
  'use strict';

  function mostrar(texto) {
    var alvo = document.getElementById('registro');
    if (!alvo) {
      // A pagina nem chegou a montar. Ultimo recurso, para nao sumir o erro.
      document.body && (document.body.textContent = texto);
      return;
    }
    var linha = document.createElement('div');
    linha.className = 'm-erro';
    linha.textContent = new Date().toLocaleTimeString('pt-BR') + '  ' + texto;
    alvo.appendChild(linha);
    alvo.scrollTop = alvo.scrollHeight;
  }

  window.addEventListener('error', function (e) {
    var onde = e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : '';
    mostrar('ERRO na página: ' + (e.message || e.type) + onde +
      '. Copie o registro e mande para quem cuida da extensão.');
  });

  window.addEventListener('unhandledrejection', function (e) {
    var causa = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    mostrar('ERRO não tratado: ' + causa +
      '. Copie o registro e mande para quem cuida da extensão.');
  });
})();
