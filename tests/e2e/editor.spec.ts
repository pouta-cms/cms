import { test, expect } from '@playwright/test';
import { encryptToken } from '../../src/utils/crypto';

test.describe('CMS Workspace Editor and Publishing', () => {
  test.beforeEach(async ({ context }) => {
    // 1. Programmatically seal a mock GitHub token using the default session secret
    const sessionSecret = process.env.SESSION_SECRET || 'default-fallback-pouta-key-32-chars-minimum';
    const sealedCookie = await encryptToken('mock-github-token', sessionSecret);

    // 2. Pre-inject the pouta_session cookie to bypass the login redirection UI
    await context.addCookies([
      {
        name: 'pouta_session',
        value: sealedCookie,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false, // localhost dev server is http
        sameSite: 'Lax',
      },
    ]);
  });

  test('should allow creating, editing, and publishing a document', async ({ page }) => {
    // Debug helper: capture browser logs and exceptions
    page.on('console', msg => console.log(`[BROWSER LOG] [${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => console.log(`[BROWSER EXCEPTION] ${err.stack || err.message}`));
    page.on('request', req => console.log(`[BROWSER REQ] ${req.method()} ${req.url()}`));
    page.on('response', async res => {
      const url = res.url();
      console.log(`[BROWSER RES] ${res.status()} ${url}`);
      if (process.env.DEBUG_E2E_LOGS === 'true' && url.includes('/api/')) {
        try {
          const text = await res.text();
          let loggedText = text;
          try {
            const parsed = JSON.parse(text);
            const redactKeys = ['token', 'password', 'authorization', 'ssn', 'email', 'pouta_session', 'secret', 'client_secret'];
            const redact = (obj: unknown): unknown => {
              if (typeof obj !== 'object' || obj === null) return obj;
              if (Array.isArray(obj)) return obj.map(redact);
              const result: Record<string, unknown> = {};
              const objectEntries = Object.entries(obj as Record<string, unknown>);
              for (const [k, v] of objectEntries) {
                if (redactKeys.some(rk => k.toLowerCase().includes(rk))) {
                  result[k] = '[REDACTED]';
                } else {
                  result[k] = redact(v);
                }
              }
              return result;
            };
            loggedText = JSON.stringify(redact(parsed));
          } catch (jsonErr) {}
          console.log(`[API RESPONSE BODY] [${url}]: ${loggedText}`);
        } catch (e) {}
      }
    });

    // 1. Visit the home page (should directly load authenticated dashboard)
    await page.goto('/');
    
    // 2. Verify that workspace selects our mock repository
    const workspaceSelect = page.locator('select.site-select');
    await expect(workspaceSelect).toBeVisible();
    await workspaceSelect.selectOption('test-owner/sandbox-repo');

    // 3. Create a new draft
    const createDraftBtn = page.locator('button.btn-create-new-draft');
    await expect(createDraftBtn).toBeVisible();
    await createDraftBtn.click();

    // 4. Fill in the document title
    const titleInput = page.locator('.canvas-title-input');
    await expect(titleInput).toBeVisible();
    await titleInput.clear();
    await titleInput.fill('My E2E Mock Post');

    // 5. Fill out dynamic metadata fields
    const descriptionInput = page.locator('input[placeholder="Enter description..."]');
    await expect(descriptionInput).toBeVisible();
    await descriptionInput.fill('A beautifully automated test case.');

    const authorInput = page.locator('input[placeholder="Enter author..."]');
    await expect(authorInput).toBeVisible();
    await authorInput.fill('Antigravity Playwright Bot');

    // 6. Focus and type in the BlockNote editor canvas
    const editorCanvas = page.locator('[contenteditable="true"]');
    await expect(editorCanvas).toBeVisible();
    await editorCanvas.click();
    await editorCanvas.fill('This document was written fully automatically by Playwright E2E tests running offline.');

    // 7. Click the publish button
    const publishBtn = page.locator('.btn-header-publish');
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();

    // 8. Assert that the status successfully updates to "Published!"
    await expect(publishBtn).toContainText('Published! 🎉');

    // 9. Verify the document is added/listed in the side panel list
    const draftItem = page.locator('.draft-item-card');
    await expect(draftItem.first()).toBeVisible();
    await expect(draftItem.first()).toContainText('My E2E Mock Post');
  });
});
