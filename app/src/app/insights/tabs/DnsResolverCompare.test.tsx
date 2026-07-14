import type { ReactNode } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ResolverCompare } from './DnsTab';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

// No vitest globals / jest-dom in this repo — clean up explicitly and assert
// via plain DOM (.toBeTruthy() / .textContent / .getAttribute()).
afterEach(cleanup);

const wrap = (ui: ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>);

describe('ResolverCompare', () => {
  it('renders coredns + resolver rows with latency and fail-rate', () => {
    wrap(
      <ResolverCompare
        bySource={{
          coredns: { latencyP50: 2, latencyP95: 5, latencySampleCount: 100, failRate: 0, count: 100 },
          resolver: { latencyP50: 10, latencyP95: 40, latencySampleCount: 50, failRate: 0.2, count: 50 },
        }}
      />,
    );
    expect(screen.getByTestId('dns-resolver-compare')).toBeTruthy();
    // The footnote also mentions "CoreDNS", so scope to >=1 rather than a
    // single unambiguous match.
    expect(screen.getAllByText(/coredns/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/resolver/i).length).toBeGreaterThan(0);
    // coredns has real latency samples -> renders the formatted ms value.
    expect(screen.getByText('2.0 ms')).toBeTruthy();
  });

  it('never renders "0.0 ms" for a source with latencySampleCount 0 — shows noLatency text and a real fail-rate', () => {
    wrap(
      <ResolverCompare
        bySource={{
          coredns: { latencyP50: 2, latencyP95: 5, latencySampleCount: 100, failRate: 0, count: 100 },
          resolver: { latencyP50: 0, latencyP95: 0, latencySampleCount: 0, failRate: 0.2, count: 50 },
        }}
      />,
    );
    const panel = screen.getByTestId('dns-resolver-compare');
    expect(panel.textContent).not.toContain('0.0 ms');
    // noLatency placeholder text renders (ko default locale).
    const noLatencyCells = screen.getAllByText('지연 데이터 없음');
    expect(noLatencyCells.length).toBeGreaterThan(0);
    // fail-rate is real for both sources — resolver's 20% must still render.
    expect(screen.getByText('20.0%')).toBeTruthy();
  });

  it('shows an awaiting-data state when bySource is undefined', () => {
    wrap(<ResolverCompare bySource={undefined} />);
    expect(screen.getByTestId('dns-resolver-compare-empty')).toBeTruthy();
  });
});
