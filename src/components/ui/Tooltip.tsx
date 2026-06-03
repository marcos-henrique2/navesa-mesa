"use client";

import { ReactNode, useState } from "react";

type Side = "right" | "top" | "bottom" | "left";

export function Tooltip({
  content,
  children,
  side = "right",
}: {
  content: string;
  children: ReactNode;
  side?: Side;
}) {
  const [open, setOpen] = useState(false);

  const pos =
    side === "right"
      ? "left-full ml-2 top-1/2 -translate-y-1/2"
      : side === "left"
        ? "right-full mr-2 top-1/2 -translate-y-1/2"
        : side === "top"
          ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
          : "top-full mt-2 left-1/2 -translate-x-1/2";

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-[var(--border-soft)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-strong)] shadow-md dark:bg-zinc-800 dark:text-white " +
            pos
          }
        >
          {content}
        </span>
      )}
    </span>
  );
}
