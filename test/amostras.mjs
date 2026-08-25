// Amostras montadas com a forma real da resposta observada na Fase 0.
// Reproduzem os dois esquemas de agrupamento que coexistem na arvore, por
// Volume na parte digitalizada e por Juntada na parte eletronica, e o fato de
// o codigo ser relativo a janela consultada.

function doc(codigo, folha, rotulo, chave) {
  return { codigo, descricao: rotulo, numFolVirt: String(folha), codDoctoElet: chave };
}

/** Janela 1 a 1000. Note os codigos: raiz 1, Volume 2, documentos a partir de 3. */
export const janela1a1000 = {
  codigo: 1,
  descricao: 'Processo: 0000000-00.0000.0.00.0000',
  numFolVirt: '-1',
  ultFolVirt: '13002',
  codCnj: '0000000-00.0000.0.00.0000',
  filtros: 'S;;SD',
  filhos: [
    {
      codigo: 2, descricao: 'Volume 1', numFolVirt: '0',
      filhos: [
        doc(3, 1, '1 - Capa', 'AAA1'),
        doc(4, 2, '2 - Peticao Inicial', 'AAA2'),
        doc(5, 11, '11 - Extrato da GRERJ', 'AAA3')
      ]
    },
    {
      codigo: 6, descricao: 'Volume 2', numFolVirt: '0',
      filhos: [
        doc(7, 13, '13 - Documento', 'AAA4'),
        {
          codigo: 8, descricao: '500 - Manifestacao', numFolVirt: '500', codDoctoElet: 'AAA5',
          filhos: [doc(9, 501, '501 - Anexo', 'AAA6')]
        },
        doc(10, 974, '974 - Laudo Pericial', 'AAA7')
      ]
    }
  ]
};

/**
 * Janela 500 a 1000. A MESMA peca AAA7 aparece com codigo diferente, que e
 * exatamente o comportamento observado no processo real: codigo 283 numa
 * janela e 202 na outra, para a mesma peca da folha 974.
 */
export const janela500a1000 = {
  codigo: 1,
  descricao: 'Processo: 0000000-00.0000.0.00.0000',
  numFolVirt: '-1',
  ultFolVirt: '13002',
  codCnj: '0000000-00.0000.0.00.0000',
  filtros: 'S;;SD',
  filhos: [
    {
      codigo: 2, descricao: 'Volume 2', numFolVirt: '0',
      filhos: [
        { codigo: 3, descricao: '500 - Manifestacao', numFolVirt: '500', codDoctoElet: 'AAA5',
          filhos: [doc(4, 501, '501 - Anexo', 'AAA6')] },
        doc(5, 974, '974 - Laudo Pericial', 'AAA7')
      ]
    }
  ]
};

/** Janela 1001 a 2000, parte eletronica, agrupada por Juntada. */
export const janela1001a2000 = {
  codigo: 1,
  descricao: 'Processo: 0000000-00.0000.0.00.0000',
  numFolVirt: '-1',
  ultFolVirt: '13002',
  codCnj: '0000000-00.0000.0.00.0000',
  filtros: 'S;;SD',
  filhos: [
    {
      codigo: 2, descricao: '1041 - Juntada - Peticao - dia 01/02/2020', numFolVirt: '1041',
      filhos: [doc(3, 1041, '1041 - Peticao', 'BBB1'), doc(4, 1050, '1050 - Anexo', 'BBB2')]
    }
  ]
};

/** PDF minimo valido, com duas paginas declaradas sem compressao. */
export function pdfFalso(paginas, bytesAlvo) {
  let corpo = '%PDF-1.7\n';
  for (let i = 0; i < paginas; i++) corpo += `${i + 1} 0 obj\n<< /Type /Page >>\nendobj\n`;
  corpo += '\n% recheio para atingir o tamanho desejado\n';
  while (corpo.length < bytesAlvo) corpo += 'x';
  return new Uint8Array([...corpo].map(c => c.charCodeAt(0)));
}

/** Resposta degenerada observada no processo real: 941 bytes, status 200. */
export function pdfDegenerado() {
  return pdfFalso(0, 941);
}
