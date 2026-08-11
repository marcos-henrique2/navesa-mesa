/**
 * BACKUP / RESTORE — exporta e importa todo o estado do app.
 *
 * Captura TODAS as chaves localStorage com prefixo "navesa-mesa:" de forma genérica,
 * então qualquer dado novo (estoque, vendas, custos, FIPE, cautelar, chat, etc.)
 * entra no backup automaticamente sem precisar atualizar este arquivo.
 */

import { hojeLocal } from "@/lib/utils/data-local";

const PREFIX = "navesa-mesa:";
const FORMATO_VERSAO = 1;

export type BackupMeta = {
  app: string;
  formato: number;
  exportadoEm: string;
  totalChaves: number;
  tamanhoKB: number;
};

export type BackupFile = {
  _meta: BackupMeta;
  data: Record<string, string>;
};

/** Lê todas as chaves navesa-mesa:* do localStorage. */
function coletarChaves(): Record<string, string> {
  const data: Record<string, string> = {};
  if (typeof window === "undefined") return data;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) {
      const v = localStorage.getItem(k);
      if (v != null) data[k] = v;
    }
  }
  return data;
}

/** Gera o conteúdo JSON do backup (string pronta pra download). */
export function gerarBackup(): { json: string; meta: BackupMeta } {
  const data = coletarChaves();
  const payload: Omit<BackupFile, "_meta"> = { data };
  const corpo = JSON.stringify(payload);
  const meta: BackupMeta = {
    app: "navesa-mesa",
    formato: FORMATO_VERSAO,
    exportadoEm: new Date().toISOString(),
    totalChaves: Object.keys(data).length,
    tamanhoKB: Math.round(corpo.length / 1024),
  };
  const json = JSON.stringify({ _meta: meta, data }, null, 2);
  return { json, meta };
}

/** Dispara o download do backup como arquivo .json. */
export function baixarBackup(): BackupMeta {
  const { json, meta } = gerarBackup();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  // Nome do arquivo leva a data LOCAL do usuário. (`exportadoEm` acima segue
  // ISO/UTC de propósito: lá é instante técnico, não dia de calendário.)
  const data = hojeLocal();
  a.href = url;
  a.download = `navesa-mesa-backup-${data}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return meta;
}

export type ResultadoImport = {
  aplicadas: number;
  ignoradas: number;
  meta: BackupMeta | null;
};

/**
 * Restaura um backup. Por padrão SUBSTITUI as chaves do backup
 * (mantém chaves locais que não estão no backup).
 * Passe { limparAntes: true } pra apagar tudo antes (restauração limpa).
 */
export function restaurarBackup(json: string, opts: { limparAntes?: boolean } = {}): ResultadoImport {
  const parsed = JSON.parse(json) as Partial<BackupFile> & Record<string, unknown>;
  // Tolera 2 formatos: { _meta, data } ou um objeto raw de chaves
  const data: Record<string, unknown> =
    parsed.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : (parsed as Record<string, unknown>);

  if (typeof window === "undefined") return { aplicadas: 0, ignoradas: 0, meta: null };

  if (opts.limparAntes) {
    const remover: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) remover.push(k);
    }
    remover.forEach((k) => localStorage.removeItem(k));
  }

  let aplicadas = 0;
  let ignoradas = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith(PREFIX) && typeof v === "string") {
      localStorage.setItem(k, v);
      aplicadas++;
    } else {
      ignoradas++;
    }
  }

  const meta = (parsed._meta as BackupMeta | undefined) ?? null;
  return { aplicadas, ignoradas, meta };
}

/** Resumo do que está salvo agora (pra mostrar na UI antes de exportar). */
export function resumoEstadoAtual(): { totalChaves: number; tamanhoKB: number; pctLimite: number } {
  const data = coletarChaves();
  const bytes = Object.entries(data).reduce((s, [k, v]) => s + k.length + v.length, 0);
  const kb = Math.round(bytes / 1024);
  // Limite típico de localStorage ~5MB
  const pctLimite = Math.round((bytes / (5 * 1024 * 1024)) * 100);
  return { totalChaves: Object.keys(data).length, tamanhoKB: kb, pctLimite };
}
