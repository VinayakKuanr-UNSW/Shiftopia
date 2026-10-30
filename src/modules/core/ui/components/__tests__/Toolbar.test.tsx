import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Filter, RefreshCw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/modules/core/ui/primitives/popover';
import { ToolbarIconButton, ToolbarRow, ToolbarSegmented, toolbar } from '../Toolbar';

const classesOf = (el: Element) => el.className.split(/\s+/);

describe('ToolbarRow — the three zones', () => {
  it('renders zone 1, 2, 3 in order and spreads them with justify-between', () => {
    const { container } = render(
      <ToolbarRow views={<span>views</span>} modes={<span>modes</span>} actions={<span>actions</span>} />,
    );
    const row = container.firstElementChild!;
    expect(classesOf(row)).toContain('md:justify-between');
    expect([...row.children].map((z) => z.textContent)).toEqual(['views', 'modes', 'actions']);
  });

  it('has no horizontal padding, so zone 1 and zone 3 sit on the scope row edges', () => {
    const { container } = render(<ToolbarRow views={<span />} actions={<span />} />);
    expect(container.firstElementChild!.className).not.toMatch(/(^|\s)(md:|lg:)?p[xlr]?-\d/);
  });

  it('keeps an empty zone as a desktop slot but drops it on a phone', () => {
    const { container } = render(<ToolbarRow modes={<span>modes</span>} actions={<span>a</span>} />);
    const [views, modes] = [...container.firstElementChild!.children];
    // Without the slot, the date picker would jump to the left edge on a page with no views toggle.
    expect(classesOf(views)).toEqual(expect.arrayContaining(['hidden', 'md:flex']));
    expect(classesOf(modes)).not.toContain('hidden');
  });

  it('uses the Roster Planner row height on desktop', () => {
    const { container } = render(<ToolbarRow actions={<span />} />);
    expect(classesOf(container.firstElementChild!)).toContain('md:h-16');
  });

  it('names itself as a group only when labelled — never role=toolbar without roving focus', () => {
    const { container, rerender } = render(<ToolbarRow actions={<span />} />);
    expect(container.firstElementChild!.getAttribute('role')).toBeNull();
    rerender(<ToolbarRow actions={<span />} ariaLabel="Grid functions" />);
    expect(screen.getByRole('group', { name: 'Grid functions' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});

describe('ToolbarIconButton', () => {
  it('is a 44px target with a visible focus ring, named by its tooltip', () => {
    render(<ToolbarIconButton icon={<RefreshCw />} tooltip="Reload data" onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Reload data' });
    expect(classesOf(btn)).toEqual(expect.arrayContaining(['h-[44px]', 'w-[44px]', 'focus-visible:ring-2']));
  });

  it('stays focusable when disabled (aria-disabled) and swallows the click', async () => {
    const onClick = vi.fn();
    render(<ToolbarIconButton icon={<RefreshCw />} tooltip="Templates — select a department first" onClick={onClick} disabled />);
    const btn = screen.getByRole('button', { name: /Templates/ });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled(); // native disabled would hide the tooltip from keyboards
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('passes the click event to onClick', async () => {
    const onClick = vi.fn();
    render(<ToolbarIconButton icon={<RefreshCw />} tooltip="Reload" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }));
  });

  it('works as the direct child of a PopoverTrigger (ref + props forwarded)', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <ToolbarIconButton icon={<Filter />} tooltip="Filters" aria-pressed={undefined} />
        </PopoverTrigger>
        <PopoverContent>filter body</PopoverContent>
      </Popover>,
    );
    const btn = screen.getByRole('button', { name: 'Filters' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).not.toHaveAttribute('aria-pressed');
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('filter body')).toBeInTheDocument();
  });

  it('a disabled popover trigger does not open', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <ToolbarIconButton icon={<Filter />} tooltip="Filters" disabled />
        </PopoverTrigger>
        <PopoverContent>filter body</PopoverContent>
      </Popover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByText('filter body')).toBeNull();
  });

  it('shows a corner badge inside the button at 11px, capped at 9+, hidden at 0', () => {
    const { rerender } = render(<ToolbarIconButton icon={<Filter />} tooltip="Filters" badge={3} />);
    const btn = screen.getByRole('button', { name: 'Filters' });
    expect(btn).toHaveTextContent('3');
    expect(btn.querySelector('span[aria-hidden="true"]')!.className).toContain('text-[11px]');
    rerender(<ToolbarIconButton icon={<Filter />} tooltip="Filters" badge={14} />);
    expect(btn).toHaveTextContent('9+');
    rerender(<ToolbarIconButton icon={<Filter />} tooltip="Filters" badge={0} />);
    expect(btn.textContent).toBe('');
  });
});

describe('ToolbarSegmented — zone 1 views toggle', () => {
  const OPTIONS = [
    { id: 'table', label: 'List' },
    { id: 'card', label: 'Card', count: 2 },
  ] as const;

  it('reports the chosen view and ignores a click on the active one', async () => {
    const onValueChange = vi.fn();
    render(<ToolbarSegmented value="table" onValueChange={onValueChange} options={OPTIONS} />);
    await userEvent.click(screen.getByRole('radio', { name: 'List view' }));
    expect(onValueChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: 'Card view' }));
    expect(onValueChange).toHaveBeenCalledWith('card');
  });

  it('shows counts and keeps every label at the 11px floor', () => {
    render(<ToolbarSegmented value="table" onValueChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('radio', { name: 'Card view' })).toHaveTextContent('2');
    expect(toolbar.segment).toContain('text-[11px]');
  });
});

describe('ToolbarSegmented — labels on phones', () => {
  it('a switch of three or fewer always shows its text labels (no icon-only tabs)', () => {
    render(<ToolbarSegmented value="a" onValueChange={() => {}} options={[{ id: 'a', label: 'Ledger' }, { id: 'b', label: 'My leaves' }]} />);
    const label = screen.getByText('Ledger');
    expect(label.className).not.toMatch(/\bhidden\b/);
  });

  it('four or more options become one labelled native select below sm', async () => {
    const onValueChange = vi.fn();
    const opts = ['Profile', 'Security', 'Alerts', 'Billing'].map((l) => ({ id: l.toLowerCase(), label: l }));
    render(<ToolbarSegmented value="profile" onValueChange={onValueChange} options={opts} label="Settings section" />);
    const select = screen.getByRole('combobox', { name: 'Settings section' });
    expect(select.className).toContain('sm:hidden');
    await userEvent.selectOptions(select, 'billing');
    expect(onValueChange).toHaveBeenCalledWith('billing');
  });
});

describe('toolbar tokens', () => {
  const cls = (token: string) => token.split(/\s+/);

  it('never go below the 11px type floor', () => {
    for (const c of Object.values(toolbar)) expect(c).not.toMatch(/text-\[(7|8|9|10)px\]/);
  });

  it('zone 1–2 pills: a real 44px option on a phone, the Roster navigator pill from md', () => {
    for (const item of [toolbar.controlItem, toolbar.segment, toolbar.stepperButton, toolbar.stepperLabel]) {
      expect(cls(item)).toEqual(expect.arrayContaining(['h-[44px]', 'md:h-8']));
    }
    for (const pill of [toolbar.control, toolbar.segmented, toolbar.stepper]) {
      // No fixed phone height: the pill grows to hold its 44px options.
      expect(cls(pill)).toContain('md:h-10');
      expect(pill).not.toMatch(/(^|\s)h-\d/);
    }
    expect(cls(toolbar.field)).toEqual(expect.arrayContaining(['h-[44px]', 'md:h-10']));
  });

  it('zone 3 controls are a real 44px at every width', () => {
    for (const c of [toolbar.iconButton, toolbar.search, toolbar.primaryAction, toolbar.secondaryAction]) {
      expect(cls(c)).toContain('h-[44px]');
      expect(c).not.toMatch(/md:h-/);
    }
  });

  it('touch minimums are in px: the 75% root makes h-11 only 33px', () => {
    // A rem class here would silently shrink the target by a quarter.
    for (const c of Object.values(toolbar)) expect(c).not.toMatch(/(^|\s)(min-)?[hw]-11(\s|$)/);
  });

  it('search text is 16px on a phone, so iOS does not zoom into the field', () => {
    expect(cls(toolbar.searchInput)).toEqual(expect.arrayContaining(['text-[16px]', 'md:text-[11px]']));
  });

  it('a selected mode keeps its on-colour in dark mode', () => {
    // dark:text-muted-foreground (off) and data-[state=on]:… tie on specificity;
    // without the dark: on-variant a selected MONTH read as muted on the fill.
    expect(cls(toolbar.modeOnByState)).toContain('dark:data-[state=on]:text-primary-foreground');
  });

  it('no token relies on text-xs/sm, which are 9px/10.5px under the 75% root', () => {
    for (const c of Object.values(toolbar)) expect(c).not.toMatch(/(^|\s)(md:)?text-(xs|sm)(\s|$)/);
  });
});
