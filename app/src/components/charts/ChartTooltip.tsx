'use client';

// Shared recharts tooltip content, theme-aware via Tailwind classes.
// Identity is dual-encoded: color dot + text label on every row.
export interface TooltipRow {
  name: string;
  value: string;
  color?: string;
}

export default function ChartTooltip({ title, rows }: { title?: string; rows: TooltipRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-black/5 bg-white px-3 py-2 text-xs shadow-sm dark:border-white/10 dark:bg-ink">
      {title ? <p className="mb-1 font-medium text-ink/60 dark:text-white/60">{title}</p> : null}
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-1.5 text-ink dark:text-white">
          {r.color ? (
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: r.color }}
              aria-hidden
            />
          ) : null}
          <span className="text-ink/60 dark:text-white/60">{r.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
