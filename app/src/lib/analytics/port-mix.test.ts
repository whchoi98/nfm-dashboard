import { describe, it, expect } from 'vitest';
import { portMix, portLabel } from './port-mix';
import type { FlowEdge } from '../types';

const flow = (targetPort: number | undefined, metric: FlowEdge['metric'], value: number): FlowEdge => ({
  edgeHash: `${targetPort}-${metric}`, monitor: 'm', metric, category: 'INTRA_AZ',
  bucket: '2026-07-14T00:00:00Z', value, unit: 'Bytes', a: {}, b: {}, targetPort, traversedConstructs: [],
});

describe('portMix', () => {
  it('labels well-known ports and falls back to port N / unknown', () => {
    expect(portLabel(443)).toBe('HTTPS (443)');
    expect(portLabel(12345)).toBe('port 12345');
    expect(portLabel(undefined)).toBe('unknown');
  });
  it('groups DATA_TRANSFERRED bytes by port, carries retransmissions, sorts desc', () => {
    const rows = portMix([
      flow(443, 'DATA_TRANSFERRED', 1000), flow(443, 'DATA_TRANSFERRED', 500),
      flow(443, 'RETRANSMISSIONS', 7), flow(5432, 'DATA_TRANSFERRED', 2000),
      flow(undefined, 'DATA_TRANSFERRED', 100),
    ]);
    expect(rows[0]).toMatchObject({ port: 5432, label: 'PostgreSQL (5432)', bytes: 2000 });
    const https = rows.find((r) => r.port === 443)!;
    expect(https).toMatchObject({ bytes: 1500, retransmissions: 7 });
    expect(rows.find((r) => r.port === null)).toMatchObject({ label: 'unknown', bytes: 100 });
  });
});
