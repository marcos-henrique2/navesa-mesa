/**
 * Bearer token → perfil, em tempo constante (doc §3.1).
 * Compara SHA-256 do token recebido com o de cada token configurado via
 * `timingSafeEqual`, percorrendo TODOS (sem saída antecipada), então nem o
 * tamanho do token nem a posição na lista vazam por tempo de resposta.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { TokenPerfil } from "@cerebro/config";
import type { Perfil } from "@cerebro/perfis";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest();

export type Autenticador = (authorization: string | undefined) => Perfil | null;

export function criarAutenticador(tokens: TokenPerfil[]): Autenticador {
  const hashes = tokens.map((t) => ({ perfil: t.perfil, hash: sha(t.token) }));
  return (authorization) => {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
    const recebido = sha(m ? m[1] : "");
    let achado: Perfil | null = null;
    for (const h of hashes) {
      if (timingSafeEqual(recebido, h.hash) && m) achado = h.perfil;
    }
    return achado;
  };
}
