import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

type AuditPage = {
  name: string;
  path: string;
  heading: string;
};

const AUDIT_PAGES: AuditPage[] = [
  { name: 'my-roster', path: '/my-roster', heading: 'My Roster' },
  {
    name: 'my-availabilities',
    path: '/my-availabilities',
    heading: 'My Availabilities',
  },
  { name: 'my-bids', path: '/my-bids', heading: 'My Bids' },
  { name: 'roster-planner', path: '/rosters', heading: 'Roster Planner' },
  {
    name: 'open-bids-manager',
    path: '/management/bids',
    heading: 'Open Bids Manager',
  },
];

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

async function openAuditPage(page: Page, auditPage: AuditPage) {
  await page.goto(auditPage.path);
  await expect(page).toHaveURL(new RegExp(`${auditPage.path.replace('/', '\\/')}($|\\?)`));
  await expect(
    page.getByRole('heading', { level: 1, name: auditPage.heading }),
  ).toBeVisible({ timeout: 20_000 });
  // Let page-entry motion and the first authenticated data render settle so
  // axe measures the stable UI rather than an opacity transition frame.
  await page.waitForTimeout(1_500);
}

function formatViolations(
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'],
) {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .flatMap((node) => node.target)
        .map(String)
        .join(', ');
      return `[${violation.impact}] ${violation.id}: ${violation.help} (${targets})`;
    })
    .join('\n');
}

async function attachAudit(
  testInfo: TestInfo,
  auditPage: AuditPage,
  results: Awaited<ReturnType<AxeBuilder['analyze']>>,
) {
  await testInfo.attach(`axe-${auditPage.name}.json`, {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: 'application/json',
  });
}

test.describe('WCAG 2.2 AA accessibility audit', () => {
  test('top five pages have no critical or serious axe violations', async ({
    page,
  }, testInfo) => {
    const failures: string[] = [];
    const auditSummary: Array<{
      page: string;
      path: string;
      critical: number;
      serious: number;
      moderate: number;
      minor: number;
      total: number;
    }> = [];

    for (const auditPage of AUDIT_PAGES) {
      await openAuditPage(page, auditPage);

      const results = await new AxeBuilder({ page })
        .withTags(WCAG_22_AA_TAGS)
        .analyze();
      await attachAudit(testInfo, auditPage, results);

      const blockingViolations = results.violations.filter(
        ({ impact }) => impact === 'critical' || impact === 'serious',
      );
      const countImpact = (impact: string) =>
        results.violations.filter((violation) => violation.impact === impact)
          .length;

      auditSummary.push({
        page: auditPage.heading,
        path: auditPage.path,
        critical: countImpact('critical'),
        serious: countImpact('serious'),
        moderate: countImpact('moderate'),
        minor: countImpact('minor'),
        total: results.violations.length,
      });

      if (blockingViolations.length > 0) {
        failures.push(
          `${auditPage.heading}\n${formatViolations(blockingViolations)}`,
        );
      }
    }

    await testInfo.attach('axe-summary.json', {
      body: Buffer.from(JSON.stringify(auditSummary, null, 2)),
      contentType: 'application/json',
    });
    console.info(`Accessibility audit summary: ${JSON.stringify(auditSummary)}`);

    expect(failures, failures.join('\n\n')).toEqual([]);
  });

  test('top five pages support keyboard entry and visible focus', async ({
    page,
  }, testInfo) => {
    const failures: string[] = [];

    for (const auditPage of AUDIT_PAGES) {
      await openAuditPage(page, auditPage);

      await page.keyboard.press('Tab');
      const skipLinkFocused = await page
        .getByRole('link', { name: 'Skip to main content' })
        .evaluate((element) => element === document.activeElement);
      await page.keyboard.press('Enter');
      const mainFocused = await page
        .locator('#main-content')
        .evaluate((element) => element === document.activeElement);

      const focusTrail: Array<{
        tag: string;
        name: string;
        outlineStyle: string;
        outlineWidth: string;
        boxShadow: string;
      }> = [];

      // Four successive controls is enough to prove forward keyboard access
      // without assuming every page has eight focusable controls after main.
      for (let index = 0; index < 4; index += 1) {
        await page.keyboard.press('Tab');
        focusTrail.push(
          await page.evaluate(() => {
            const element = document.activeElement as HTMLElement | null;
            if (!element) {
              return {
                tag: '',
                name: '',
                outlineStyle: '',
                outlineWidth: '',
                boxShadow: '',
              };
            }
            const style = window.getComputedStyle(element);
            return {
              tag: element.tagName.toLowerCase(),
              name:
                element.getAttribute('aria-label') ??
                element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) ??
                '',
              outlineStyle: style.outlineStyle,
              outlineWidth: style.outlineWidth,
              boxShadow: style.boxShadow,
            };
          }),
        );
      }

      await testInfo.attach(`keyboard-${auditPage.name}.json`, {
        body: Buffer.from(JSON.stringify(focusTrail, null, 2)),
        contentType: 'application/json',
      });

      const focusStayedInteractive = focusTrail.every(
        ({ tag }) => tag && tag !== 'body',
      );
      const focusWasVisible = focusTrail.every(
          ({ outlineStyle, outlineWidth, boxShadow }) =>
            (outlineStyle !== 'none' && outlineWidth !== '0px') ||
            boxShadow !== 'none',
      );

      if (
        !skipLinkFocused ||
        !mainFocused ||
        !focusStayedInteractive ||
        !focusWasVisible
      ) {
        failures.push(
          `${auditPage.heading}: skipLinkFocused=${skipLinkFocused}, mainFocused=${mainFocused}, focusStayedInteractive=${focusStayedInteractive}, focusWasVisible=${focusWasVisible}\n${JSON.stringify(focusTrail, null, 2)}`,
        );
      }
    }

    expect(failures, failures.join('\n\n')).toEqual([]);
  });
});
