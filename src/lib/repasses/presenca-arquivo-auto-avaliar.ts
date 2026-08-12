/**
 * Diff de PRESENÇA entre o `relatorio_VeiculosEmOferta.xls` e os repasses do
 * sistema — Story 2.2 (Fatia 3b).
 *
 * ┌─ POR QUE ISTO EXISTE ──────────────────────────────────────────────────────┐
 * │ O relatório do Auto Avaliar é uma FOTO do momento: carro entra e sai entre  │
 * │ dois downloads. O sync da Fatia 3a só afirma sobre as linhas que o arquivo  │
 * │ TEM (`montarPayloadSyncArquivo`: "ausência não é afirmação"). Quem sumiu    │
 * │ do relatório era informação disponível e ia pro lixo — o Marcos tinha que   │
 * │ caçar carro por carro na lista de repasses pra dar baixa.                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ A ARMADILHA DESTE MÓDULO — o motivo de ele existir separado e testado:
 *
 * O sync sincroniza SÓ a Matriz, então o cliente filtra as outras lojas antes de
 * montar o payload. Mas "sumiu do anúncio" NÃO é o complemento das linhas da
 * Matriz: um carro pode ter sido transferido de loja e continuar anunciado.
 * No arquivo de 2026-08-12, `SCV9H90` (Aparecida) e `SDL6I80` (CIAASA) são
 * exatamente isso. Compará-los contra as placas da Matriz os acusaria de terem
 * saído do anúncio — afirmação FALSA, e a ação sugerida (remover) é destrutiva.
 *
 * Por isso o universo de comparação é `placasVistasNoArquivo(linhas, outraLoja)`:
 * TODAS as placas do arquivo, de QUALQUER loja. Nunca só `linhas`.
 *
 * ⚠️ AUSÊNCIA NÃO É CONCLUSÃO. Sumir do relatório costuma significar venda, mas
 * também é o que acontece quando o anúncio é pausado, o carro é transferido pra
 * uma loja que não aparece nesse relatório, ou o download saiu incompleto. Este
 * módulo classifica PRESENÇA, não desfecho — quem decide é o Marcos, na tela.
 *
 * 100% PURO: sem I/O, sem Date, sem rede, sem banco.
 */

import { normalizarPlaca } from "@/lib/utils/placa";

// ─── Tipos ───────────────────────────────────────────────────────────────────

/**
 * Recorte mínimo do repasse que o diff precisa. Deliberadamente NÃO é `Repasse`:
 * a query que alimenta isto seleciona 8 colunas, não a tabela inteira, e o tipo
 * estreito é o que impede a tela de renderizar campo que não foi buscado.
 *
 * `valor_minimo` e `valor_compre_por` entram porque o `MarcarVendidoModal` os
 * usa pra pintar o semáforo da margem prévia.
 */
export type RepasseRefPresenca = {
  id: number;
  chassi: string;
  placa: string;
  modelo: string;
  status: string;
  /** Custo-base do repasse. Junto com Σ `repasse_gastos` forma o `custo_real`. */
  valor_compra_repasse: number | null;
  valor_minimo: number | null;
  valor_compre_por: number | null;
};

/** Status que significam "o carro deveria estar anunciado agora". */
export const STATUS_ATIVOS_NO_ANUNCIO: ReadonlyArray<string> = ["subido", "marcado"];

export type DiffPresencaArquivo = {
  /**
   * Estava ativo no sistema e a placa não aparece em NENHUMA linha do arquivo.
   * Candidatos a baixa — não uma baixa.
   */
  sumiram: RepasseRefPresenca[];
  /**
   * O inverso: já marcado como `vendido` no sistema e a placa voltou a aparecer
   * no relatório. Sinal de venda que não se confirmou.
   */
  reapareceram: RepasseRefPresenca[];
  /**
   * Ativos cuja placa está ilegível/vazia no sistema. Não dá pra afirmar nada
   * sobre eles — ficam de fora dos dois grupos em vez de virarem falso positivo.
   */
  sem_placa_comparavel: RepasseRefPresenca[];
  /**
   * Ativos com placa comparável = `sumiram` + os que continuam no arquivo. É o
   * denominador da guarda de arquivo parcial — sem ele, "6 sumiram" não diz se
   * isso é 10% ou 90% do estoque em repasse.
   */
  total_ativos_comparaveis: number;
};

/**
 * Acima desta fração dos ativos, "sumiu do anúncio" deixa de ser leitura
 * plausível e vira sintoma de download incompleto. Não é ciência: é a linha a
 * partir da qual o custo de errar (remoção em lote irreversível) supera a
 * conveniência do "selecionar todos".
 */
export const LIMITE_SUSPEITA_ARQUIVO_PARCIAL = 0.3;

/**
 * Sintoma de arquivo truncado/incompleto: uma fatia grande demais do estoque
 * ativo sumiu de uma vez.
 *
 * Existe pelo mesmo motivo que `baldesFecham` trava o botão de gravar em vez de
 * só avisar — aviso em prosa não impede clique. Aqui o efeito é desabilitar o
 * "selecionar todos"; a seleção item a item continua livre, porque o caso
 * legítimo (fim de mês, saiu tudo) precisa continuar possível.
 */
export function pareceArquivoParcial(diff: DiffPresencaArquivo): boolean {
  if (diff.total_ativos_comparaveis === 0 || diff.sumiram.length === 0) return false;
  return diff.sumiram.length / diff.total_ativos_comparaveis > LIMITE_SUSPEITA_ARQUIVO_PARCIAL;
}

// ─── Universo de comparação ──────────────────────────────────────────────────

/**
 * Todas as placas normalizadas que aparecem no arquivo, de QUALQUER loja.
 *
 * Os dois argumentos são obrigatórios de propósito: passar só as linhas da loja
 * alvo é o bug que este módulo existe pra impedir (ver o cabeçalho). Placa vazia
 * — linha sem placa legível — não entra no conjunto: ela não prova presença de
 * carro nenhum, e no conjunto viraria um match falso pra qualquer repasse que
 * também estivesse sem placa.
 */
export function placasVistasNoArquivo(
  linhasLojaAlvo: ReadonlyArray<{ placa_norm: string }>,
  linhasOutraLoja: ReadonlyArray<{ placa_norm: string }>,
): Set<string> {
  const vistas = new Set<string>();
  for (const l of linhasLojaAlvo) if (l.placa_norm !== "") vistas.add(l.placa_norm);
  for (const l of linhasOutraLoja) if (l.placa_norm !== "") vistas.add(l.placa_norm);
  return vistas;
}

// ─── Diff ────────────────────────────────────────────────────────────────────

/**
 * Separa os repasses em "sumiu do arquivo", "reapareceu depois de vendido" e
 * "placa não comparável".
 *
 * `placasVistas` DEVE vir de `placasVistasNoArquivo` — é o contrato que carrega
 * a regra do universo. Status fora de `subido`/`marcado`/`vendido`
 * (`nao_vendido`, `cancelado`) é ignorado: o carro já saiu do ciclo por decisão
 * do Marcos, e o arquivo não tem o que dizer sobre ele.
 *
 * Ordem de saída: pela placa normalizada. Estável e independente da ordem em que
 * o banco devolveu as linhas — a lista é conferida a olho antes de uma ação
 * destrutiva, e ordem instável entre dois uploads seria armadilha de leitura.
 */
export function diffPresencaNoArquivo(
  repasses: ReadonlyArray<RepasseRefPresenca>,
  placasVistas: ReadonlySet<string>,
): DiffPresencaArquivo {
  const sumiram: RepasseRefPresenca[] = [];
  const reapareceram: RepasseRefPresenca[] = [];
  const sem_placa_comparavel: RepasseRefPresenca[] = [];
  let total_ativos_comparaveis = 0;

  for (const r of repasses) {
    const placa = normalizarPlaca(r.placa);
    const ativo = STATUS_ATIVOS_NO_ANUNCIO.includes(r.status);

    if (placa === "") {
      if (ativo) sem_placa_comparavel.push(r);
      continue;
    }
    if (ativo) {
      total_ativos_comparaveis++;
      if (!placasVistas.has(placa)) sumiram.push(r);
    } else if (r.status === "vendido" && placasVistas.has(placa)) {
      reapareceram.push(r);
    }
  }

  const porPlaca = (a: RepasseRefPresenca, b: RepasseRefPresenca) =>
    normalizarPlaca(a.placa).localeCompare(normalizarPlaca(b.placa));

  return {
    sumiram: sumiram.sort(porPlaca),
    reapareceram: reapareceram.sort(porPlaca),
    sem_placa_comparavel: sem_placa_comparavel.sort((a, b) => a.id - b.id),
    total_ativos_comparaveis,
  };
}
