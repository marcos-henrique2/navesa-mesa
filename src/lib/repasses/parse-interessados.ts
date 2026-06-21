/**
 * Parser PURO da lista de interessados colada do Auto Avaliar.
 *
 * O Auto Avaliar mostra, por carro anunciado, quem VISUALIZOU o anúncio. O Marcos
 * seleciona a tabela na tela e cola aqui. Cada linha tem (TAB-separated):
 *
 *   nome <TAB> cidade / UF <TAB> telefones <TAB> email <TAB> data acesso <TAB> qtd
 *
 * Função PURA: sem I/O, sem Date.now. 100% testável.
 *
 * Regras:
 *   - Split por linha; cada linha split por TAB (fallback: 2+ espaços).
 *   - Linha precisa ter email válido OU telefone — senão é cabeçalho/lixo e é ignorada.
 *   - WhatsApp: extrai o primeiro CELULAR (DDD + 9 dígitos começando com 9) dos
 *     telefones, normalizado pra 55+DDD+numero (só dígitos). Fixo (8 dígitos) é
 *     ignorado. Sem celular → telefone_whatsapp = null.
 *   - qtd_visualizacoes: parseInt do último campo (default 1).
 */

export type InteressadoParsed = {
  nome: string;
  cidade_uf: string | null;
  telefone_whatsapp: string | null;
  telefones_raw: string | null;
  email: string | null;
  data_acesso: string | null;
  qtd_visualizacoes: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Quebra a linha em campos: TAB primeiro; fallback pra 2+ espaços. */
function splitCampos(linha: string): string[] {
  if (linha.includes("\t")) {
    return linha.split("\t").map((c) => c.trim());
  }
  return linha.split(/ {2,}/).map((c) => c.trim());
}

/** Valida email (trimado). */
function emailValido(v: string | null | undefined): boolean {
  return v != null && EMAIL_RE.test(v.trim());
}

/**
 * Telefone "real": tem pelo menos um bloco com 8+ dígitos (fixo ou celular).
 * Filtra cabeçalho ("Telefones") e lixo sem número de verdade.
 */
function temTelefoneReal(v: string | null | undefined): boolean {
  if (!v) return false;
  const grupos = v.match(/\d+/g);
  if (!grupos) return false;
  // Soma de dígitos relevantes: um telefone tem no mínimo 8 (fixo sem DDD).
  return grupos.some((g) => g.length >= 8) || grupos.join("").length >= 10;
}

/**
 * Extrai o número de WhatsApp dos telefones brutos.
 *
 * Percorre cada bloco de dígitos. Um celular tem DDD (2 dígitos) + 9 dígitos
 * começando com 9 = 11 dígitos. Fixo tem DDD + 8 dígitos = 10 (ignorado).
 * Pega o PRIMEIRO celular encontrado. Normaliza pra 55+DDD+numero.
 *
 * Ex.: "(34) 32123400 (34) 992190088" → "5534992190088"
 */
export function extrairWhatsapp(telefonesRaw: string | null | undefined): string | null {
  if (!telefonesRaw) return null;

  // Cada token = sequência de dígitos. Em "(34) 992190088" vira ["34","992190088"].
  // Junta DDD + número quando o par forma um celular válido.
  const grupos = telefonesRaw.match(/\d+/g);
  if (!grupos) return null;

  for (let i = 0; i < grupos.length; i++) {
    const g = grupos[i];

    // Caso A: bloco único já com 11 dígitos (DDD + 9XXXXXXXX).
    if (g.length === 11 && g[2] === "9") {
      return `55${g}`;
    }

    // Caso B: DDD (2 díg) separado do número (9 díg começando com 9).
    if (g.length === 2) {
      const num = grupos[i + 1];
      if (num && num.length === 9 && num[0] === "9") {
        return `55${g}${num}`;
      }
    }
  }

  return null;
}

/** Parseia qtd de visualizações; default 1 se ausente/inválido. */
function parseQtd(v: string | undefined): number {
  if (!v) return 1;
  const n = Number.parseInt(v.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Identifica o campo de email numa linha (procura o primeiro campo que casa o
 * regex de email). Robusto a ordem ligeiramente diferente das colunas.
 */
function acharEmail(campos: string[]): string | null {
  const c = campos.find((x) => emailValido(x));
  return c ? c.trim() : null;
}

export function parseInteressados(textoColado: string): InteressadoParsed[] {
  if (!textoColado) return [];

  const out: InteressadoParsed[] = [];

  for (const linhaRaw of textoColado.split(/\r?\n/)) {
    const linha = linhaRaw.trim();
    if (!linha) continue;

    const campos = splitCampos(linha);
    if (campos.length === 0) continue;

    const nome = campos[0] ?? "";
    const cidadeUf = campos[1]?.trim() || null;
    const telefonesRaw = campos[2]?.trim() || null;
    const email = acharEmail(campos);
    const whatsapp = extrairWhatsapp(telefonesRaw);

    // Linha válida precisa de email válido OU telefone com dígitos reais.
    // Cabeçalho ("Nome / Telefones / E-mail") não tem nenhum dos dois → descartado.
    const temContato = emailValido(email) || temTelefoneReal(telefonesRaw);
    if (!nome || !temContato) continue;

    // data_acesso + qtd: assumem as duas últimas posições quando presentes.
    // Procura a qtd no último campo numérico puro; data no penúltimo.
    const dataAcesso = campos[4]?.trim() || null;
    const qtd = parseQtd(campos[5]);

    out.push({
      nome: nome.trim(),
      cidade_uf: cidadeUf,
      telefone_whatsapp: whatsapp,
      telefones_raw: telefonesRaw,
      email,
      data_acesso: dataAcesso,
      qtd_visualizacoes: qtd,
    });
  }

  return out;
}
