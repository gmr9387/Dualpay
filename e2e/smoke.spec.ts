import { test, expect } from '@playwright/test';
import { gotoAuthenticated } from './fixtures';

/**
 * Core-flow navigation smoke test: signs in and walks the primary
 * business-loop pages (Command Center, Claims Workbench, Denial
 * Command, Appeals Workbench, Outcome Log, Contract Recovery, Plan
 * Benefits), asserting each one renders its real breadcrumb rather
 * than an empty/crashed shell. Route -> breadcrumb pairs are taken
 * directly from src/components/clarity/ClarityShell.tsx's SECTIONS
 * and breadcrumbsFor() so this stays in sync with the app's own nav.
 */
const CORE_ROUTES: Array<{ path: string; breadcrumb: string }> = [
  { path: '/', breadcrumb: 'Command Center' },
  { path: '/claims', breadcrumb: 'Claims Workbench' },
  { path: '/denials', breadcrumb: 'Denial Command' },
  { path: '/appeals', breadcrumb: 'Appeals Workbench' },
  { path: '/outcomes', breadcrumb: 'Outcome Log' },
  { path: '/contracts/disputes', breadcrumb: 'Contract Recovery' },
  { path: '/plan-benefits', breadcrumb: 'Plan Benefits' },
];

test('signs in automatically and lands on Command Center', async ({ page }) => {
  await gotoAuthenticated(page, '/');
  await expect(page.getByRole('link', { name: 'Claims Workbench' })).toBeVisible();
});

for (const { path, breadcrumb } of CORE_ROUTES) {
  test(`core route ${path} renders (${breadcrumb})`, async ({ page }) => {
    await gotoAuthenticated(page, path);
    await expect(page.getByText(breadcrumb, { exact: true }).first()).toBeVisible();
  });
}
