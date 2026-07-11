# app/src/components — UI Components

## Role
Presentational React components for the dashboard: chart primitives, topology graph, chat UI, page widgets, and the app shell. Components receive data via props/hooks — no direct AWS SDK access.

## Key Files
- `charts/` — recharts + custom SVG charts (TimeSeries, Sankey, Heatmap, Treemap, Icicle, Pareto, Gauge, StreamGraph, RegionArcMap, …) and `ChartTooltip.tsx`
- `topology/` — reactflow-based pod/service topology view
- `chat/` — `FloatingChat.tsx`, `ChatPanel.tsx`, `ChatMessages.tsx` (AI chatbot UI)
- `layout/` — `AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `MobileTabs.tsx`, `nav.ts`
- `cards/`, `analytics/`, `monitors/` — page-level widgets
- `ui/Controls.tsx` — shared controls
- Root: `FlowTable.tsx`, `HopPath.tsx`, `Markdown.tsx`, `CodeBlock.tsx`

## Rules
- Colors only via `app/src/lib/chart-tokens.ts` (`TOKENS`, series palettes) — never hardcode hex.
- Per the `chart-tokens.ts` header: pastel palette is not fully CVD-safe/contrast-safe, so ALWAYS dual-encode (legend + tooltip/value labels/side table).
- All visible strings through `t()` (`app/src/lib/i18n`), added to both `ko.json` and `en.json`.
- Tests co-located (`*.test.tsx`); chart tests split into `charts-recharts.test.tsx` / `charts-custom.test.tsx`.
