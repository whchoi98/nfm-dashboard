// Render smoke tests for ResourceIcon: every ResourceKind mounts, exposes its
// resicon-<kind> testid, and draws an aria-hidden lucide svg inside the badge.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ResourceKind } from '@/lib/topology';
import ResourceIcon, { KIND_META } from './ResourceIcon';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

const KINDS = Object.keys(KIND_META) as ResourceKind[];

describe('ResourceIcon', () => {
  it('KIND_META covers all 15 resource kinds', () => {
    expect(KINDS).toHaveLength(15);
    for (const kind of KINDS) {
      expect(KIND_META[kind].icon).toBeTruthy();
      expect(KIND_META[kind].color).toBeTruthy();
    }
  });

  for (const kind of KINDS) {
    it(`renders resicon-${kind} badge with an aria-hidden icon`, () => {
      render(<ResourceIcon kind={kind} />);
      const root = screen.getByTestId(`resicon-${kind}`);
      const svg = root.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });
  }

  it('honors the size prop on the badge box', () => {
    render(<ResourceIcon kind="pod" size={40} />);
    expect(screen.getByTestId('resicon-pod').style.width).toBe('40px');
  });
});
