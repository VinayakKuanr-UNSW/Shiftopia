import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Clock } from 'lucide-react';
import { PageLayout } from '../PageLayout';
import { page, surface } from '../pageTokens';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';

const headerProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

// The protected Global Scope lives inside PersonalPageHeader; stub it so these
// tests exercise only the shell, and capture what the header hands it.
vi.mock('@/modules/core/ui/components/PersonalPageHeader', () => ({
  PersonalPageHeader: (props: Record<string, unknown>) => {
    headerProps.last = props;
    return <div data-testid="personal-page-header" />;
  },
}));

vi.mock('@/modules/core/contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: true }),
}));

const classesOf = (el: Element) => el.className.split(/\s+/);

describe('PageLayout shell', () => {
  it('owns the gutter and a 16px flex gap — not space-y margins', () => {
    const { container } = render(
      <PageLayout>
        <div>header</div>
      </PageLayout>,
    );
    const root = container.firstElementChild!;
    for (const cls of [...page.root.split(' '), ...page.gutter.split(' '), 'gap-4']) {
      expect(classesOf(root)).toContain(cls);
    }
    expect(root.className).not.toMatch(/space-y-/);
  });

  it('clears the floating mobile nav below md and uses the plain gutter above it', () => {
    expect(page.gutter).toContain('pb-[calc(var(--mobile-bottom-nav-clearance,90px)+0.75rem)]');
    expect(page.gutter).toContain('md:pb-4');
    expect(page.gutter).toContain('lg:p-6');
  });

  it('bleed drops every gutter class at every breakpoint, keeping the gap', () => {
    const { container } = render(
      <PageLayout bleed>
        <div>control room</div>
      </PageLayout>,
    );
    const root = container.firstElementChild!;
    // The point of a prop over className="p-0": no responsive padding survives.
    expect(root.className).not.toMatch(/(^|\s)(md:|lg:)?p[btlrxy]?-/);
    expect(classesOf(root)).toContain('gap-4');
  });

  it('renders an optional footer as a non-shrinking region after the body', () => {
    const { container } = render(
      <PageLayout>
        <PageLayout.Body>body</PageLayout.Body>
        <PageLayout.Footer>footer</PageLayout.Footer>
      </PageLayout>,
    );
    const regions = container.firstElementChild!.children;
    expect(regions).toHaveLength(2);
    expect(regions[1]).toHaveTextContent('footer');
    expect(classesOf(regions[1])).toContain('flex-shrink-0');
  });

  it('passes entrance-animation variants to the root without changing its classes', () => {
    const { container } = render(
      <PageLayout variants={{ hidden: {}, show: {} }} initial="hidden" animate="show" className="text-foreground">
        <div>header</div>
      </PageLayout>,
    );
    const root = container.firstElementChild!;
    expect(classesOf(root)).toEqual(expect.arrayContaining(['gap-4', 'text-foreground']));
    // No variant here moves the root, so no transform: a transformed ancestor
    // would become the containing block for fixed children (bulk toolbar).
    expect((root as HTMLElement).style.transform).toBe('');
  });
});

describe('GoldStandardHeader in the shell', () => {
  const renderInShell = () =>
    render(
      <PageLayout>
        <GoldStandardHeader title="Timesheets" Icon={Clock} mode="managerial" />
      </PageLayout>,
    ).container.firstElementChild!.firstElementChild!;

  it('adds no outer padding of its own, so the header→body gap is the shell gap', () => {
    const wrapper = renderInShell();
    expect(wrapper.className).not.toMatch(/(^|\s)(md:|lg:)?p[btlrxy]?-\d/);
    expect(classesOf(wrapper)).toContain('flex-shrink-0');
  });

  it('renders the shared glass card', () => {
    expect(renderInShell().firstElementChild!.className).toBe(surface.headerCard);
  });

  it('passes scope props through to the protected PersonalPageHeader untouched', () => {
    const setScope = vi.fn();
    const scope = { org_ids: ['o'], dept_ids: [], subdept_ids: [] } as never;
    render(
      <PageLayout>
        <GoldStandardHeader
          title="Gross Pay"
          Icon={Clock}
          mode="managerial"
          scope={scope}
          setScope={setScope}
          isGammaLocked
          multiSelect
        />
      </PageLayout>,
    );
    expect(headerProps.last).toMatchObject({
      title: 'Gross Pay',
      scope,
      setScope,
      isGammaLocked: true,
      mode: 'managerial',
      multiSelect: true,
    });
  });
});
