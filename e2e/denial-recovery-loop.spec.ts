import { test, expect } from '@playwright/test';
import { gotoAuthenticated } from './fixtures';

/**
 * Exercises the start of DualPay's real denial -> appeal -> outcome
 * closed loop (README "Denial -> Appeal -> Outcome is a single closed
 * loop"): Denial Command lists real seeded denials, each row links to
 * /denials/:claimId (src/pages/DenialIntelligence.tsx renders
 * <Link to={`/denials/${claim.claim_id}`}>), and the detail page is
 * expected to surface CARC/root-cause data for that specific claim.
 */
test('opens a denied claim from Denial Command and reaches its detail page', async ({ page }) => {
  await gotoAuthenticated(page, '/denials');

  const denialLink = page.locator('a[href^="/denials/"]').first();
  await expect(denialLink).toBeVisible();
  const href = await denialLink.getAttribute('href');
  expect(href).toMatch(/^\/denials\/CLM-/);

  await denialLink.click();
  await expect(page).toHaveURL(new RegExp(href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
