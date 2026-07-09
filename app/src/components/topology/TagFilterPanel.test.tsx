// Smoke tests for TagFilterPanel (Task 6) — draft→apply semantics: checkbox
// edits touch only the draft; 적용 commits via onApply; 취소 resets the draft;
// select-all toggles everything; search filters visible rows only.
// NOTE: row checkboxes are named "<status label> <node label>" because the
// dual-encoded status dot contributes its aria-label — queries match /label$/.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import TagFilterPanel, { type TagFilterNode } from './TagFilterPanel';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

const NODES: TagFilterNode[] = [
  { id: 'pod:shop/api', label: 'api', status: 'ok' },
  { id: 'pod:shop/db', label: 'db', status: 'warn' },
  { id: 'pod:mon/grafana', label: 'grafana', status: 'idle' },
];

function setup(selected = new Set(NODES.map((n) => n.id))) {
  const onApply = vi.fn();
  render(
    <LanguageProvider>
      <TagFilterPanel nodes={NODES} selected={selected} onApply={onApply} />
    </LanguageProvider>,
  );
  return { onApply };
}

describe('TagFilterPanel', () => {
  it('unchecking a row then 적용 calls onApply without that node', () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: /db$/ }));
    expect(onApply).not.toHaveBeenCalled(); // draft only — nothing applied yet
    fireEvent.click(screen.getByRole('button', { name: ko['graph.apply'] }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect([...onApply.mock.calls[0][0]].sort()).toEqual(['pod:mon/grafana', 'pod:shop/api']);
  });

  it('취소 resets the draft back to the applied selection', () => {
    const { onApply } = setup();
    const db = screen.getByRole('checkbox', { name: /db$/ }) as HTMLInputElement;
    fireEvent.click(db);
    expect(db.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: ko['graph.cancel'] }));
    expect((screen.getByRole('checkbox', { name: /db$/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: ko['graph.apply'] }));
    expect([...onApply.mock.calls[0][0]].sort()).toEqual(NODES.map((n) => n.id).sort());
  });

  it('전체 선택 toggles all nodes on and off', () => {
    const { onApply } = setup(new Set(['pod:shop/api']));
    const all = screen.getByRole('checkbox', { name: ko['graph.selectAll'] }) as HTMLInputElement;
    expect(all.checked).toBe(false);
    fireEvent.click(all); // → select everything
    fireEvent.click(screen.getByRole('button', { name: ko['graph.apply'] }));
    expect([...onApply.mock.calls[0][0]].sort()).toEqual(NODES.map((n) => n.id).sort());
    fireEvent.click(all); // → clear everything
    fireEvent.click(screen.getByRole('button', { name: ko['graph.apply'] }));
    expect([...onApply.mock.calls[1][0]]).toEqual([]);
  });

  it('search filters visible rows without touching the draft', () => {
    setup();
    fireEvent.change(screen.getByLabelText(ko['graph.searchTag']), { target: { value: 'gra' } });
    expect(screen.getByRole('checkbox', { name: /grafana$/ })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /db$/ })).toBeNull();
    // footer still counts the full draft: Total 3 / Selected 3
    expect(screen.getByText(/Total 3.*Selected 3/)).toBeTruthy();
  });

  it('shows the header count and testid', () => {
    setup(new Set(['pod:shop/api', 'pod:shop/db']));
    expect(screen.getByTestId('tag-filter-panel')).toBeTruthy();
    expect(screen.getByText(ko['graph.selectedTags'])).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('dual-encodes each status dot with an accessible label (never color alone)', () => {
    setup();
    // NODES statuses: api=ok, db=warn, grafana=idle.
    for (const key of ['graph.status.ok', 'graph.status.warn', 'graph.status.idle'] as const) {
      const dot = screen.getByRole('img', { name: ko[key] });
      expect(dot).toBeTruthy();
      expect(dot.getAttribute('title')).toBe(ko[key]);
      expect(dot.getAttribute('aria-hidden')).toBeNull();
    }
  });
});
