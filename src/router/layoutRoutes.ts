/**
 * Which protected routes let <main> pad the page.
 *
 * Every workspace page renders a GoldStandardHeader (which carries its own
 * `p-4 lg:p-6` gutter) and sizes itself `h-full`. Letting <main> add its own
 * `p-8` on top stacked ~56px gutters on those pages, while Rosters (padding-free)
 * got ~24px — the "zoomed out" look. Canvas is therefore the default; a route
 * opts INTO main padding only by being listed here.
 */
export const PADDED_ROUTES: ReadonlySet<string> = new Set<string>();

export const isCanvasRoute = (pathname: string): boolean => !PADDED_ROUTES.has(pathname);
