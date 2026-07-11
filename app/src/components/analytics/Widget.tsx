'use client';
// Datadog-style widget chrome for the insights hub: Card look with a title bar
// and a right-aligned actions slot (deep links, menus) the hub passes in.
// The chrome itself (hairline border, padding, .ui-section-title header) is
// unified in ui/Controls.tsx Card — Widget adds only the slug-derived testId,
// so Card and Widget consumers stay pixel-identical.
import { Card } from '@/components/ui/Controls';

/** Lowercase + replace non-alphanumerics with '-' (collapsed, trimmed). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function Widget({
  title,
  actions,
  children,
  className,
  testId,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card title={title} action={actions} className={className} testId={testId ?? `widget-${slugify(title)}`}>
      {children}
    </Card>
  );
}
