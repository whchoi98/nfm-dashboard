// Smoke tests for the Phase 9 Sparkline: value→geometry mapping, empty/single
// point safety, flat-series midline and the color/aria contract.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { STATUS, TOKENS } from '@/lib/chart-tokens';
import Sparkline from './Sparkline';

afterEach(cleanup);

const linePoints = () => {
  const line = screen.getByTestId('sparkline').querySelector('polyline');
  expect(line).toBeTruthy();
  return (line as SVGPolylineElement)
    .getAttribute('points')!
    .split(' ')
    .map((p) => p.split(',').map(Number) as [number, number]);
};

describe('Sparkline', () => {
  it('maps values left→right across the full viewBox width, max on top', () => {
    render(<Sparkline values={[0, 5, 10]} />);
    const pts = linePoints();
    expect(pts).toHaveLength(3);
    expect(pts[0][0]).toBe(0);
    expect(pts[2][0]).toBe(100);
    // SVG y grows downward: the max value (last) has the SMALLEST y.
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...ys)).toBe(pts[2][1]);
    expect(Math.max(...ys)).toBe(pts[0][1]);
  });

  it('renders nothing for an empty series', () => {
    render(<Sparkline values={[]} />);
    expect(screen.queryByTestId('sparkline')).toBeNull();
  });

  it('renders a full-width flat midline for a single point', () => {
    render(<Sparkline values={[7]} />);
    const pts = linePoints();
    expect(pts).toEqual([
      [0, 16],
      [100, 16],
    ]);
  });

  it('renders an all-equal series (incl. all-zero) as a flat midline', () => {
    render(<Sparkline values={[0, 0, 0]} />);
    for (const [, y] of linePoints()) expect(y).toBe(16);
  });

  it('strokes with the given token color (default = TOKENS.chartViolet)', () => {
    render(<Sparkline values={[1, 2]} color={STATUS.danger} />);
    expect(screen.getByTestId('sparkline').querySelector('polyline')!.getAttribute('stroke')).toBe(
      STATUS.danger,
    );
    cleanup();
    render(<Sparkline values={[1, 2]} />);
    expect(screen.getByTestId('sparkline').querySelector('polyline')!.getAttribute('stroke')).toBe(
      TOKENS.chartViolet,
    );
  });

  it('is aria-hidden by default but labelled when ariaLabel is given', () => {
    render(<Sparkline values={[1, 2]} />);
    expect(screen.getByTestId('sparkline').getAttribute('aria-hidden')).toBe('true');
    cleanup();
    render(<Sparkline values={[1, 2]} ariaLabel="traffic trend" />);
    const svg = screen.getByTestId('sparkline');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('traffic trend');
  });
});
