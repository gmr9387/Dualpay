import { Page, expect } from '@playwright/test';

/**
 * Navigate to an authenticated route and wait past RequireAuth's
 * "Loading session…" gate (src/components/auth/RequireAuth.tsx) so
 * assertions run against the real post-auth page, not the loading
 * placeholder. Relies on VITE_DEV_AUTO_LOGIN_EMAIL/PASSWORD (.env)
 * signing in automatically — see src/hooks/use-auth.tsx.
 */
export async function gotoAuthenticated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByText('Loading session…')).toHaveCount(0, { timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/login/);
}
