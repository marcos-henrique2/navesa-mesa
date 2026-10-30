import { cn } from "@/lib/utils";

/** Barra pulsante pro skeleton. Usa shimmer Tailwind animate-pulse. */
export function SkeletonBar({ w = "100%", h = "h-3", delay = 0 }: { w?: string; h?: string; delay?: number }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-gradient-to-r from-[var(--bg-muted)] via-[var(--border-soft)] to-[var(--bg-muted)]", h)}
      style={{ width: w, animationDelay: `${delay}ms` }}
    />
  );
}

export function SkeletonCard({ delay = 0, tall = false }: { delay?: number; tall?: boolean }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]",
        tall && "min-h-[180px]",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <SkeletonBar w="40%" />
      <div className="mt-3 h-8 w-3/4">
        <SkeletonBar w="100%" h="h-8" delay={delay + 60} />
      </div>
      <div className="mt-2">
        <SkeletonBar w="60%" delay={delay + 120} />
      </div>
      {tall && (
        <div className="mt-4 space-y-2">
          <SkeletonBar w="100%" delay={delay + 180} />
          <SkeletonBar w="90%" delay={delay + 220} />
          <SkeletonBar w="80%" delay={delay + 260} />
        </div>
      )}
    </div>
  );
}
