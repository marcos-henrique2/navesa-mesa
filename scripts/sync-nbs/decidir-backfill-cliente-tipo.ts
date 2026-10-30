/**
 * Lógica pura do backfill de `vendas.cliente_tipo` (ver
 * backfill-cliente-tipo.ts) — separada do I/O pra ser testável.
 */

export type TipoCliente = "PF" | "PJ" | null;

export type ContagensBackfill = {
  /** Linhas lidas do Oracle (pode ter chassi repetido). */
  lidasOracle: number;
  nullParaPF: number;
  nullParaPJ: number;
  pfParaPJ: number;
  pjParaPF: number;
  semMudanca: number;
  /** Chassi do Oracle que não existe em `vendas` — nunca inserido. */
  inexistentesNoSupabase: number;
  /** Oracle sem classe e sem documento decisivo — valor atual preservado. */
  semTipoResolvivel: number;
  /** Mesmo chassi com tipos diferentes no período — pulado (ambíguo). */
  chassisAmbiguos: number;
};

export type DecisaoBackfill = {
  updates: { chassi: string; cliente_tipo: "PF" | "PJ" }[];
  contagens: ContagensBackfill;
};

/** Só dígitos, sem zeros à esquerda — Oracle (NUMBER) e XLSX (texto/máscara) gravam o mesmo documento de formas diferentes. */
function normalizarCodigo(codigo: string | null): string | null {
  const d = codigo?.replace(/\D/g, "").replace(/^0+/, "") ?? "";
  return d === "" ? null : d;
}

export type VendaOracleTipo = { chassi: string; tipo: TipoCliente; clienteCodigo: string | null };
export type LinhaSupabaseTipo = { tipo: TipoCliente; clienteCodigo: string | null };

/**
 * Decide quais chassis precisam de UPDATE de `cliente_tipo`.
 *
 * - `oracle`: tipo resolvido (resolverTipoCliente) por venda do período.
 *   Chassi repetido com o MESMO tipo conta uma vez; com tipos diferentes
 *   (carro revendido no ano), desempata pela venda cujo cliente é o mesmo da
 *   linha do Supabase; sem desempate, é ambíguo e fica de fora.
 * - `supabase`: chassi -> cliente_tipo e cliente_codigo atuais em `vendas`.
 *
 * Só gera update quando o chassi existe no Supabase, o Oracle resolveu um
 * tipo e ele difere do atual (NULL->tipo ou tipo divergente). Oracle sem tipo
 * nunca apaga um tipo existente.
 */
export function decidirBackfillClienteTipo(
  oracle: readonly VendaOracleTipo[],
  supabase: ReadonlyMap<string, LinhaSupabaseTipo>,
): DecisaoBackfill {
  const contagens: ContagensBackfill = {
    lidasOracle: oracle.length,
    nullParaPF: 0,
    nullParaPJ: 0,
    pfParaPJ: 0,
    pjParaPF: 0,
    semMudanca: 0,
    inexistentesNoSupabase: 0,
    semTipoResolvivel: 0,
    chassisAmbiguos: 0,
  };

  const porChassi = new Map<string, { chassi: string; tipo: TipoCliente; clienteCodigo: string | null }[]>();
  for (const venda of oracle) {
    if (!venda.chassi) continue;
    const lista = porChassi.get(venda.chassi) ?? [];
    lista.push(venda);
    porChassi.set(venda.chassi, lista);
  }

  const tipoUnico = (vendas: { tipo: TipoCliente }[]): TipoCliente | "AMBIGUO" => {
    const tipos = new Set(vendas.map((v) => v.tipo));
    return tipos.size === 1 ? [...tipos][0] : "AMBIGUO";
  };

  const updates: DecisaoBackfill["updates"] = [];
  for (const [chassi, vendas] of porChassi) {
    const linha = supabase.get(chassi);
    if (!linha) {
      contagens.inexistentesNoSupabase++;
      continue;
    }
    let tipo = tipoUnico(vendas);
    // Mesmo chassi vendido mais de uma vez pra clientes de tipos diferentes:
    // usa a venda do MESMO cliente que está gravado na linha do Supabase.
    if (tipo === "AMBIGUO") {
      const alvo = normalizarCodigo(linha.clienteCodigo);
      const doCliente = vendas.filter((v) => alvo !== null && normalizarCodigo(v.clienteCodigo) === alvo);
      if (doCliente.length > 0) tipo = tipoUnico(doCliente);
    }
    if (tipo === "AMBIGUO") {
      contagens.chassisAmbiguos++;
      continue;
    }
    if (tipo === null) {
      contagens.semTipoResolvivel++;
      continue;
    }
    const atual = linha.tipo;
    if (atual === tipo) {
      contagens.semMudanca++;
      continue;
    }
    if (atual === null) {
      if (tipo === "PF") contagens.nullParaPF++;
      else contagens.nullParaPJ++;
    } else if (atual === "PF") contagens.pfParaPJ++;
    else contagens.pjParaPF++;
    updates.push({ chassi, cliente_tipo: tipo });
  }

  return { updates, contagens };
}

/** Único argumento aceito: `--escrever`. Sem ele, dry-run (só leitura). */
export function lerOpcoesBackfill(args: string[]): { escrever: boolean } {
  for (const arg of args) {
    if (arg !== "--escrever") throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (args.length > 1) throw new Error("Informe --escrever apenas uma vez.");
  return { escrever: args.includes("--escrever") };
}
