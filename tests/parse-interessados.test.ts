/**
 * Testes do parser puro de interessados (lista colada do Auto Avaliar).
 *
 * Cobre extração de campos, normalização do WhatsApp (55+DDD+celular), descarte
 * de linhas lixo/cabeçalho e qtd de visualizações.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseInteressados,
  extrairWhatsapp,
} from "@/lib/repasses/parse-interessados";

// Linhas reais (TAB-separated) da tela do Auto Avaliar.
const LINHA_SPACECAR =
  "spacecar\tUberlândia / MG\t(34) 32123400 (34) 992190088\tmarluslener@hotmail.com\t21/06/2026 15:24:20\t2";
const LINHA_REPASSAMAIS =
  "GRUPO REPASSAMAIS\tSão José dos Campos / SP\t(12) 74022111 (12) 974022111 (12) 74022111\trepassamais@gmail.com\t20/06/2026 09:35:19\t2";
const LINHA_RAVANELLO =
  "RAVANELLO VEICULOS LTDA\tchapecó / SC\t(49) 99164441 (49) 999164441 (49) 99164441\travanelloveiculos@gmail.com\t20/06/2026 21:20:46\t2";

describe("parseInteressados — linhas reais do Auto Avaliar", () => {
  it("parseia as 3 linhas de exemplo com WhatsApp normalizado", () => {
    const texto = [LINHA_SPACECAR, LINHA_REPASSAMAIS, LINHA_RAVANELLO].join("\n");
    const out = parseInteressados(texto);
    assert.equal(out.length, 3);

    assert.deepEqual(
      out.map((o) => o.telefone_whatsapp),
      ["5534992190088", "5512974022111", "5549999164441"],
    );
  });

  it("extrai nome, cidade/UF, email, data e qtd corretamente", () => {
    const [o] = parseInteressados(LINHA_SPACECAR);
    assert.equal(o.nome, "spacecar");
    assert.equal(o.cidade_uf, "Uberlândia / MG");
    assert.equal(o.email, "marluslener@hotmail.com");
    assert.equal(o.data_acesso, "21/06/2026 15:24:20");
    assert.equal(o.qtd_visualizacoes, 2);
    assert.equal(o.telefones_raw, "(34) 32123400 (34) 992190088");
  });
});

describe("parseInteressados — casos de borda", () => {
  it("linha só com telefone fixo (sem celular) → whatsapp null", () => {
    const linha = "FIXO LTDA\tGoiânia / GO\t(62) 32334455\tfixo@loja.com\t01/06/2026\t1";
    const [o] = parseInteressados(linha);
    assert.equal(o.telefone_whatsapp, null);
    assert.equal(o.email, "fixo@loja.com");
  });

  it("ignora linha de cabeçalho/lixo (sem email nem telefone)", () => {
    const texto = ["Nome\tCidade\tTelefones\tE-mail\tAcesso\tViews", LINHA_SPACECAR].join("\n");
    const out = parseInteressados(texto);
    // O cabeçalho não tem email válido nem telefone → descartado. Sobra 1.
    assert.equal(out.length, 1);
    assert.equal(out[0].nome, "spacecar");
  });

  it("múltiplos celulares → pega o primeiro", () => {
    const linha =
      "MULTI\tSP\t(11) 988887777 (11) 977776666\tmulti@x.com\t01/06/2026\t3";
    const [o] = parseInteressados(linha);
    assert.equal(o.telefone_whatsapp, "5511988887777");
  });

  it("string vazia → lista vazia", () => {
    assert.deepEqual(parseInteressados(""), []);
  });

  it("qtd ausente assume default 1", () => {
    const linha = "SEM QTD\tSP\t(11) 988887777\tsemqtd@x.com\t01/06/2026";
    const [o] = parseInteressados(linha);
    assert.equal(o.qtd_visualizacoes, 1);
  });

  it("fallback de split por 2+ espaços quando não há TAB", () => {
    const linha = "LOJA ESPACO   Goiânia / GO   (62) 991112222   loja@x.com   01/06/2026   1";
    const [o] = parseInteressados(linha);
    assert.equal(o.nome, "LOJA ESPACO");
    assert.equal(o.telefone_whatsapp, "5562991112222");
  });
});

describe("extrairWhatsapp — normalização", () => {
  it("DDD separado do celular → 55+DDD+numero", () => {
    assert.equal(extrairWhatsapp("(34) 992190088"), "5534992190088");
  });

  it("bloco único de 11 dígitos começando com 9 no 3º char", () => {
    assert.equal(extrairWhatsapp("34992190088"), "5534992190088");
  });

  it("celular vem depois de fixo na mesma string", () => {
    assert.equal(extrairWhatsapp("(34) 32123400 (34) 992190088"), "5534992190088");
  });

  it("só fixo (8 dígitos) → null", () => {
    assert.equal(extrairWhatsapp("(62) 32334455"), null);
  });

  it("vazio/null → null", () => {
    assert.equal(extrairWhatsapp(""), null);
    assert.equal(extrairWhatsapp(null), null);
    assert.equal(extrairWhatsapp(undefined), null);
  });
});
