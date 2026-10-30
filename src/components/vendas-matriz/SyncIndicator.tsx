"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getSupabase } from "@/lib/data/supabase";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

/** Acima disso o dado é considerado possivelmente desatualizado (sync roda a cada 2h). */
const LIMITE_DESATUALIZADO_MS = 3 * 60 * 60 * 1000;

type EstadoSync = { ultimoSucesso: Date; ultimaFalhou: boolean };

async function lerSyncVendas(): Promise<EstadoSync | null> {
  const sb = getSupabase();
  const [sucesso, ultima] = await Promise.all([
    sb
      .from("sync_log")
      .select("finalizado_em")
      .eq("fonte", "vendas")
      .eq("status", "sucesso")
      .not("finalizado_em", "is", null)
      .order("finalizado_em", { ascending: false })
      .limit(1),
    sb.from("sync_log").select("status").eq("fonte", "vendas").order("iniciado_em", { ascending: false }).limit(1),
  ]);
  if (sucesso.error || ultima.error) throw new Error(sucesso.error?.message ?? ultima.error?.message);
  const linha = (sucesso.data as { finalizado_em: string }[] | null)?.[0];
  if (!linha) return null;
  const status = (ultima.data as { status: string }[] | null)?.[0]?.status;
  return { ultimoSucesso: new Date(linha.finalizado_em), ultimaFalhou: status === "erro" };
}

/**
 * "Atualizado há X" a partir do `sync_log` (fonte='vendas'). Falha na consulta ou
 * nenhuma execução registrada → não renderiza nada (nunca quebra a página).
 */
export function SyncIndicator({ recarga }: { /** Muda a cada recarga/tentativa de carga do painel → reconsulta o sync_log. */ recarga: string }) {
  const [estado, setEstado] = useState<EstadoSync | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    let vivo = true;
    lerSyncVendas()
      .then((e) => {
        if (!vivo) return;
        setEstado(e);
        setAgora(Date.now());
      })
      .catch(() => {
        if (vivo) setEstado(null);
      });
    const t = setInterval(() => setAgora(Date.now()), 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [recarga]);

  if (!estado) return null;

  const { ultimoSucesso, ultimaFalhou } = estado;
  const aviso = ultimaFalhou || agora - ultimoSucesso.getTime() > LIMITE_DESATUALIZADO_MS;
  const ha = formatDistanceToNow(ultimoSucesso, { locale: ptBR, addSuffix: false });
  const quando = format(ultimoSucesso, "dd/MM HH:mm", { locale: ptBR });
  const Icon = aviso ? AlertTriangle : RefreshCw;
  const tooltip = aviso
    ? `A importação automática do NBS não roda desde ${quando}. Vendas lançadas depois disso ainda não aparecem.`
    : `Dados importados do NBS a cada 2 horas. Última importação: ${quando}.`;

  return (
    <Tooltip content={tooltip} side="bottom" ariaLabel={`Atualizado há ${ha}. ${tooltip}`}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs",
          aviso ? "font-medium text-amber-700 dark:text-amber-400" : "text-[var(--text-muted)]",
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        Atualizado há {ha}
        {aviso && " — pode estar desatualizado"}
      </span>
    </Tooltip>
  );
}
