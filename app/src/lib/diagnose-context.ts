// Pure helpers that turn the latest topology snapshot + collection status into a
// human-readable context block for the /api/diagnose LLM prompt. No I/O here so
// everything stays unit-testable.
import type { CollectionStatus, DestCategory, TopologySnapshot } from './types';

export interface Anomaly {
  edgeId: string;
  source: string;
  target: string;
  retransmissions: number;
  timeouts: number;
  category: DestCategory;
}

/**
 * Top-n anomalous edges ranked by RETRANSMISSIONS+TIMEOUTS descending.
 * Edges whose sum is 0 are healthy and excluded — they are not anomalies.
 */
export function topAnomalies(topology: TopologySnapshot | null, n = 20): Anomaly[] {
  return (topology?.edges ?? [])
    .map((e) => ({
      edgeId: e.id, source: e.source, target: e.target, category: e.category,
      retransmissions: e.metrics.RETRANSMISSIONS ?? 0,
      timeouts: e.metrics.TIMEOUTS ?? 0,
    }))
    .filter((a) => a.retransmissions + a.timeouts > 0)
    .sort((x, y) =>
      (y.retransmissions + y.timeouts) - (x.retransmissions + x.timeouts))
    .slice(0, n);
}

/**
 * Context block injected into the diagnose prompt: topology summary
 * (node/edge counts, clusters), collection status, and the top anomalies.
 * A zero-edge (or missing) topology gets an explicit "수집 준비 중 / collecting"
 * marker so the model reports that data is not ready instead of hallucinating.
 */
export function buildDiagnoseContext(
  topology: TopologySnapshot | null,
  status: CollectionStatus | null,
  anomalies: Anomaly[],
): string {
  const nodes = topology?.nodes ?? [];
  const edges = topology?.edges ?? [];
  const lines: string[] = [];

  lines.push('## 토폴로지 요약 / Topology Summary');
  lines.push(`- nodes: ${nodes.length}, edges: ${edges.length}`);
  const clusters = [...new Set(nodes.map((nd) => nd.cluster).filter(Boolean))];
  if (clusters.length) lines.push(`- clusters: ${clusters.join(', ')}`);
  if (topology?.generatedAt) lines.push(`- generatedAt: ${topology.generatedAt}`);
  if (edges.length === 0) {
    lines.push('- 주의: 토폴로지에 플로우 엣지가 없습니다 — 수집 준비 중 (collecting). '
      + 'NFM 플로우 데이터가 아직 준비되지 않았으므로, 데이터가 준비되지 않았다고 안내하십시오.');
  }

  lines.push('');
  lines.push('## 수집 상태 / Collection Status');
  if (status) {
    lines.push(`- last cycle: ${status.cycleTs}`);
    const s = status.stats;
    lines.push(`- monitors started: ${s.started}, succeeded: ${s.succeeded}, `
      + `failed: ${s.failed}, throttled: ${s.throttled}, rows: ${s.rows}`);
  } else {
    lines.push('- 수집 상태 정보 없음 (no collection status yet)');
  }

  lines.push('');
  lines.push('## 상위 이상 징후 / Top Anomalies '
    + `(RETRANSMISSIONS+TIMEOUTS 내림차순, ${anomalies.length}건)`);
  if (anomalies.length === 0) {
    lines.push('- 재전송/타임아웃 이상 엣지 없음 (no anomalous edges)');
  } else {
    anomalies.forEach((a, i) => lines.push(
      `${i + 1}. ${a.source} → ${a.target} [${a.category}] `
      + `retransmissions=${a.retransmissions}, timeouts=${a.timeouts} (edge=${a.edgeId})`));
  }
  return lines.join('\n');
}
