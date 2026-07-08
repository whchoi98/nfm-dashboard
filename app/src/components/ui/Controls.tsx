'use client';

// Small shared SnowUI-styled primitives: flat card, labeled select, text input.

export function Card({
  title,
  action,
  children,
  className = '',
  testId,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className={`rounded-card bg-surface p-5 dark:bg-white/5 ${className}`}>
      {title || action ? (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const fieldCls =
  'h-9 max-w-full rounded-lg border border-black/10 bg-white px-2.5 text-xs text-ink outline-none focus:border-chartViolet dark:border-white/15 dark:bg-ink dark:text-white';

export function Select({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <label className="flex max-w-full flex-col gap-1 text-[11px] font-medium text-ink/60 dark:text-white/60">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldCls}>
        {allLabel != null ? <option value="">{allLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex max-w-full flex-col gap-1 text-[11px] font-medium text-ink/60 dark:text-white/60">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${fieldCls} min-w-32`}
      />
    </label>
  );
}
