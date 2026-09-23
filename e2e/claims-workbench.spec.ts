import { test, expect } from '@playwright/test';
import { gotoAuthenticated } from './fixtures';

/**
 * Claims Workbench is a master-detail page (src/pages/ClaimsWorkbench.tsx):
 * src/components/admin/ClaimList.tsx renders each seeded claim as a
 * <button> keyed by its claim_id (font-mono, pattern CLM-####-#####),
 * clicking it sets local selection state (no route change) and the
 * adjudication detail panel renders for that claim.
 */
test('opens a seeded claim and renders its adjudication detail', async ({ page }) => {
  await gotoAuthenticated(page, '/claims');

  const claimButton = page.getByRole('button', { name: /^CLM-/ }).first();
  await expect(claimButton).toBeVisible();
  const claimId = (await claimButton.locator('span.font-mono').first().textContent())?.trim();
  expect(claimId).toMatch(/^CLM-/);

  await claimButton.click();

  // Selecting a claim highlights its row (bg-accent) and renders a detail
  // panel scoped to that same claim id elsewhere on the page.
  await expect(claimButton).toHaveClass(/bg-accent/);
  await expect(page.getByText(claimId!, { exact: false }).nth(1)).toBeVisible();
});
