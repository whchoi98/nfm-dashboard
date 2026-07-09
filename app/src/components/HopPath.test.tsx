// Render smoke tests for HopPath (Task 3): buildHops(edge) as a horizontal
// AWS-style network-path stepper with SNAT/DNAT/port badges.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import type { FlowEdge } from '@/lib/types';
import HopPath from './HopPath';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

function makeEdge(over: Partial<FlowEdge> = {}): FlowEdge {
  return {
    edgeHash: 'e1',
    monitor: 'nfm-eks',
    metric: 'DATA_TRANSFERRED',
    category: 'INTER_AZ',
    bucket: '2026-07-08T00:00:00Z',
    value: 1234,
    unit: 'Bytes',
    a: {
      podName: 'web-7f9c4-abc12',
      podNamespace: 'default',
      ip: '10.11.90.1',
      az: 'ap-northeast-2a',
      region: 'ap-northeast-2',
    },
    b: { instanceId: 'i-071f581616382dde7', ip: '10.11.82.5', az: 'ap-northeast-2b' },
    traversedConstructs: [],
    ...over,
  };
}

describe('HopPath', () => {
  it('renders endpoint + traversed hops with per-kind icons and labels', () => {
    wrap(
      <HopPath
        edge={makeEdge({
          traversedConstructs: [{ componentType: 'TransitGateway', componentId: 'tgw-0abc123' }],
        })}
      />,
    );
    const root = screen.getByTestId('hop-path');
    // pod (a) → tgw (traversed) → instance (b), dual-encoded icon + label.
    expect(within(root).getByTestId('resicon-pod')).toBeTruthy();
    expect(within(root).getByTestId('resicon-tgw')).toBeTruthy();
    expect(within(root).getByTestId('resicon-instance')).toBeTruthy();
    expect(within(root).getAllByTestId('hop-step')).toHaveLength(3);
    expect(within(root).getByText('default/web-7f9c4-abc12')).toBeTruthy();
  });

  it('shows title with metric label and SNAT/DNAT/port badges when present', () => {
    wrap(
      <HopPath
        edge={makeEdge({ snatIp: '100.64.0.7', dnatIp: '10.11.99.9', targetPort: 8443 })}
        metricLabel="Data transferred"
      />,
    );
    const root = screen.getByTestId('hop-path');
    expect(
      within(root).getByText(`${ko['paths.networkPath']} (Data transferred)`),
    ).toBeTruthy();
    expect(within(root).getByText(/100\.64\.0\.7/)).toBeTruthy();
    expect(within(root).getByText(/10\.11\.99\.9/)).toBeTruthy();
    expect(within(root).getByText(/8443/)).toBeTruthy();
  });

  it('still renders the two endpoint hops with empty traversedConstructs', () => {
    wrap(<HopPath edge={makeEdge()} />);
    const root = screen.getByTestId('hop-path');
    expect(within(root).getAllByTestId('hop-step')).toHaveLength(2);
    expect(within(root).getByTestId('resicon-pod')).toBeTruthy();
    expect(within(root).getByTestId('resicon-instance')).toBeTruthy();
    // No badges when SNAT/DNAT/port are absent.
    expect(within(root).queryByText(/SNAT/)).toBeNull();
    expect(within(root).queryByText(/DNAT/)).toBeNull();
  });
});
