'use client';

// AdjacencyMatrix (Task 5) — source × target traffic matrix of a
// TopologySnapshot at the chosen tier level. buildMatrix aggregates the
// snapshot edges; rendering is delegated to the Phase-2 Heatmap (values
// formatted per metric). Clicking a value cell reports the (row, col)
// entity pair via onCellSelect.
//
// Task 8 adds a second render mode: 'health' (Datadog-CNM-style) colors each
// source→dest cell by connection health (STATUS ok/warn/danger from
// retransmission/timeout rate per GB) instead of raw metric magnitude. It
// needs raw FlowEdge[] — a TopologySnapshot's TopoEdge doesn't carry az/vpcId
// or an un-aggregated serviceName per edge — so it renders a small parallel
// grid (not the Heatmap, which is intensity/min-max shaped, not categorical)
// via buildHealthMatrix. 'metric' stays the default and is otherwise
// byte-for-byte unchanged. Health cells are informational only (no
// onCellSelect wiring): the underlying (service/namespace/az/vpc) grouping
// doesn't line up with the tier-map TopoEdge ids resolveEdge expects, so a
// click could resolve to the wrong edge — printed rate + tooltip already
// dual-encode the color.
import { Fragment, useMemo } from 'react';
import type { FlowEdge, MetricName, TopologySnapshot } from '@/lib/types';
import { buildMatrix, type TierLevel } from '@/lib/topology';
import { buildHealthMatrix, type HealthLevel } from '@/lib/analytics/edge-health';
import { formatBytes, formatMetricValue } from '@/lib/format';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS } from '@/lib/chart-tokens';
import Heatmap from '@/components/charts/Heatmap';

/** 1 decimal, trailing '.0' dropped — same rounding rule as format.ts's trim1 (not exported there). */
function fmtRate(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Composite (row, col) map key; the unit-separator escape avoids collisions with label text. */
const cellKey = (row: string, col: string) => `${row}\x1f${col}`;

export default function AdjacencyMatrix({
  topology,
  metric,
  level,
  onCellSelect,
  mode = 'metric',
  flows,
  healthLevel = 'service',
}: {
  topology: TopologySnapshot;
  metric: MetricName;
  level: TierLevel;
  onCellSelect?: (row: string, col: string) => void;
  /** 'metric' (default, unchanged behavior): color by raw metric magnitude via Heatmap.
   *  'health': RED/AMBER/GREEN by connection health (buildHealthMatrix). */
  mode?: 'metric' | 'health';
  /** Raw flows for health mode — ignored in metric mode. */
  flows?: FlowEdge[];
  /** Grouping granularity for health mode (independent of the tier-map `level`). */
  healthLevel?: HealthLevel;
}) {
  const { t } = useLanguage();
  const matrix = useMemo(() => buildMatrix(topology, metric, level), [topology, metric, level]);
  const health = useMemo(
    () => (mode === 'health' ? buildHealthMatrix(flows ?? [], healthLevel) : null),
    [mode, flows, healthLevel],
  );

  if (mode === 'health') {
    if (!health || health.rows.length === 0 || health.cols.length === 0) {
      return (
        <div
          data-testid="adjacency-matrix-health"
          className="flex h-40 items-center justify-center text-sm text-ink/50 dark:text-white/50"
        >
          {t('topology.empty')}
        </div>
      );
    }
    const byKey = new Map(health.cells.map((c) => [cellKey(c.row, c.col), c]));
    return (
      <div data-testid="adjacency-matrix-health" className="text-ink dark:text-white">
        <div
          className="grid gap-px overflow-x-auto"
          style={{ gridTemplateColumns: `minmax(0, auto) repeat(${health.cols.length}, minmax(48px, 1fr))` }}
        >
          <div aria-hidden />
          {health.cols.map((c) => (
            <div
              key={`hcol-${c}`}
              className="truncate px-1 pb-1 text-center text-[11px] font-medium text-ink/60 dark:text-white/60"
              title={c}
            >
              {c}
            </div>
          ))}
          {health.rows.map((r) => (
            <Fragment key={r}>
              <div
                className="truncate py-1 pr-2 text-right text-[11px] font-medium text-ink/60 dark:text-white/60"
                title={r}
              >
                {r}
              </div>
              {health.cols.map((c) => {
                const cell = byKey.get(cellKey(r, c));
                if (!cell) {
                  return (
                    <div
                      key={`${r}-${c}`}
                      className="flex h-9 items-center justify-center rounded-sm bg-black/[0.03] text-[11px] text-ink/25 dark:bg-white/[0.06] dark:text-white/25"
                      title={`${r} × ${c}: —`}
                    >
                      –
                    </div>
                  );
                }
                const title = `${r} × ${c}: ${t(`graph.status.${cell.status}`)} — `
                  + `${t('metric.RETRANSMISSIONS')} ${fmtRate(cell.retransRate)}/GB, `
                  + `${t('metric.TIMEOUTS')} ${fmtRate(cell.timeoutRate)}/GB, ${formatBytes(cell.bytes)}`;
                return (
                  <div
                    key={`${r}-${c}`}
                    className="flex h-9 items-center justify-center rounded-sm text-[11px] font-medium tabular-nums text-ink"
                    style={{ backgroundColor: STATUS[cell.status] }}
                    title={title}
                  >
                    {fmtRate(Math.max(cell.retransRate, cell.timeoutRate))}/GB
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    );
  }

  if (matrix.rows.length === 0 || matrix.cols.length === 0) {
    return (
      <div
        data-testid="adjacency-matrix"
        className="flex h-40 items-center justify-center text-sm text-ink/50 dark:text-white/50"
      >
        {t('topology.empty')}
      </div>
    );
  }

  return (
    <div data-testid="adjacency-matrix">
      <Heatmap
        rows={matrix.rows}
        cols={matrix.cols}
        cells={matrix.cells}
        valueFormatter={(v) => formatMetricValue(metric, v)}
        onCellSelect={onCellSelect}
      />
    </div>
  );
}
