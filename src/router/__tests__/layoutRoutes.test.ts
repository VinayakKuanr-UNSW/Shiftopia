import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isCanvasRoute } from '../layoutRoutes';

describe('layout routes', () => {
  it.each(['/rosters', '/timesheet', '/templates', '/management/payroll', '/management/leave', '/settings'])(
    '%s is a canvas route (main adds no padding)', (p) => expect(isCanvasRoute(p)).toBe(true));

  it('index.css has no page-level zoom/scale on html or body', () => {
    const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/\bzoom\s*:/);
    expect(css).not.toMatch(/(html|body)[^{]*\{[^}]*transform\s*:\s*scale/);
  });

  it('AppLayout main reserves the sidebar width when expanded, and the icon rail width when collapsed', () => {
    const src = readFileSync('src/modules/core/ui/layout/AppLayout.tsx', 'utf8');
    expect(src).toMatch(/isCollapsed \? "md:ml-\[92px\]" : "md:ml-\[256px\]"/);
  });
});
