import { test, expect } from '@playwright/test';

test('should load landing page and login successfully in mock mode', async ({ page }) => {
  // 1. Visit index page (should show login screen)
  await page.goto('/');

  // 2. Expect page title to be correct
  await expect(page).toHaveTitle(/Pouta CMS Workspace/);

  // 3. Find and verify "Sign in with GitHub" button
  const loginButton = page.locator('a.btn-login-github');
  await expect(loginButton).toBeVisible();
  await expect(loginButton).toContainText('Sign in with GitHub');

  // 4. Directly trigger mock authentication callback redirect
  await page.goto('/api/auth/callback?code=mock-e2e-code');

  // 5. Verify we are logged in and redirected back to the main CMS Workspace dashboard
  await expect(page).toHaveURL('/');
  
  // 6. Verify that the workspace dashboard layout loads successfully
  const cmsLayout = page.locator('.cms-layout');
  await expect(cmsLayout).toBeVisible();
  
  // 7. Verify the workspace dropdown selector displays our mock repository
  const selectWorkspace = page.locator('select.site-select');
  await expect(selectWorkspace).toBeVisible();
  await expect(selectWorkspace.locator('option')).toHaveCount(1);
  await expect(selectWorkspace.locator('option')).toContainText('test-owner/sandbox-repo');
});
