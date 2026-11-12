import { expect, test } from '@playwright/test';
import { adminLogin, createElectionViaUi, importVotersViaUi, voterLogin } from './helpers';

test.describe('Accessibility & Responsive Viewport (A11y)', () => {
  test('modal dialog enforces focus trap and returns focus on Escape', async ({ page }) => {
    await adminLogin(page);
    const electionId = await createElectionViaUi(page, `Modal A11y ${Date.now()}`);
    await importVotersViaUi(page, electionId, [{ id: 'V1', name: 'Voter One', email: 'v1@test.local' }]);

    await page.click('button[role="tab"]:has-text("Overview")');
    const triggerBtn = page.locator('button:has-text("Open voting")');
    await triggerBtn.focus();
    await triggerBtn.click();

    const dialog = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');

    // Focus trap: Tab cycling must stay inside the modal dialog
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      const isInside = await dialog.evaluate(el => el.contains(document.activeElement));
      expect(isInside).toBe(true);
    }

    // Reverse Tab cycling (Shift+Tab)
    for (let i = 0; i < 4; i++) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      const isInside = await dialog.evaluate(el => el.contains(document.activeElement));
      expect(isInside).toBe(true);
    }

    // Escape dismissal and focus restoration
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const isTriggerFocused = await triggerBtn.evaluate(el => document.activeElement === el);
    expect(isTriggerFocused).toBe(true);
  });

  test('voter flow provides aria-live announcements and visual feedback', async ({ browser }) => {
    const timestamp = Date.now();
    const voterId = `A11Y_VOT_${timestamp}`;

    // Admin setup with ranked position
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
    const electionId = await createElectionViaUi(adminPage, `Live A11y ${timestamp}`, {
      withRanked: true,
      rankedTitle: 'Executive Member',
    });
    await importVotersViaUi(adminPage, electionId, [{ id: voterId, name: 'Voter Live', email: `voter_${timestamp}@uni.test` }]);

    // Open election
    await adminPage.click('button[role="tab"]:has-text("Overview")');
    await adminPage.click('button:has-text("Open voting")');
    const dialog = adminPage.locator('div[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('button:has-text("Yes, continue")').click();
    await expect(adminPage.locator('.chip.OPEN')).toBeVisible();
    await adminContext.close();

    // Voter flow
    const voterContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const voterPage = await voterContext.newPage();
    await voterLogin(voterPage, voterId);
    await voterPage.click(`a[href*="/vote/elections/${electionId}"]`);

    // Ranked choice selection and aria-live announcements
    const rankedSection = voterPage.locator('fieldset.card:has-text("Executive Member")');
    await rankedSection.locator('label:has-text("Ranked Candidate 1")').click();
    await rankedSection.locator('label:has-text("Ranked Candidate 2")').click();

    // Move candidate 2 up
    const moveUpBtn = rankedSection.locator('button[aria-label^="Move Ranked Candidate 2 up"]');
    await moveUpBtn.click();

    const liveAnnouncement = voterPage.locator('div[aria-live="polite"].sr-only');
    await expect(liveAnnouncement).toContainText('Ranked Candidate 2 moved to rank 1');

    // Single choice selection
    const singleSection = voterPage.locator('fieldset.card:has-text("President")');
    await singleSection.locator('label:has-text("Candidate Alpha") input').check();

    // Complete vote and verify receipt copy feedback
    await voterPage.click('button:has-text("Review my ballot")');
    await voterPage.click('button:has-text("Submit my vote")');
    await expect(voterPage.locator('h2:has-text("Your vote is recorded")')).toBeVisible();

    const copyBtn = voterPage.locator('button:has-text("Copy codes")');
    await copyBtn.click();
    await expect(voterPage.locator('button:has-text("✓ Copied!")')).toBeVisible();

    await voterContext.close();
  });

  test('no horizontal scroll at 375px across all public, voter, observer, and admin routes', async ({ page }) => {
    const timestamp = Date.now();

    // Setup an election with sealed results for complete route coverage
    await adminLogin(page);
    const electionId = await createElectionViaUi(page, `Mobile 375px ${timestamp}`);
    await importVotersViaUi(page, electionId, [{ id: `M_${timestamp}`, name: 'Mobile Voter', email: `m_${timestamp}@uni.test` }]);

    await page.click('button[role="tab"]:has-text("Overview")');
    await page.click('button:has-text("Open voting")');
    const openDialog = page.locator('div[role="dialog"]');
    await openDialog.waitFor({ state: 'visible' });
    await openDialog.locator('button:has-text("Yes, continue")').click();
    await expect(page.locator('.chip.OPEN')).toBeVisible();

    await page.click('button:has-text("Close voting")');
    const closeDialog = page.locator('div[role="dialog"]');
    await closeDialog.waitFor({ state: 'visible' });
    await closeDialog.locator('button:has-text("Yes, continue")').click();
    await expect(page.locator('.chip.CLOSED')).toBeVisible();

    await page.click('button:has-text("Seal and publish results")');
    const sealDialog = page.locator('div[role="dialog"]');
    await sealDialog.waitFor({ state: 'visible' });
    await sealDialog.locator('button:has-text("Yes, continue")').click();
    await expect(page.locator('.chip.SEALED')).toBeVisible();

    // Create an observer account
    const observerEmail = `observer_375_${timestamp}@uni.test`;
    await page.goto('/admin/users');
    await page.locator('label:has-text("Full name") input').fill('Mobile Observer');
    await page.locator('label:has-text("Email") input').fill(observerEmail);
    await page.locator('label:has-text("Temporary password") input').fill('ObserverPass123!');
    await page.locator('label:has-text("Role") select').selectOption('OBSERVER');
    await page.click('button:has-text("Create account")');
    await expect(page.locator('text=Created ' + observerEmail)).toBeVisible();

    // Set viewport to 375px mobile
    await page.setViewportSize({ width: 375, height: 667 });

    // 1. Admin routes at 375px
    const adminRoutes = [
      `/admin`,
      `/admin/elections/new`,
      `/admin/elections/${electionId}`,
      `/admin/elections/${electionId}/edit`,
      `/admin/users`,
    ];

    for (const route of adminRoutes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(hasOverflow, `Horizontal scroll detected at 375px on ${route}`).toBe(false);
    }

    // 2. Clear cookies to test Public / Voter routes at 375px
    await page.context().clearCookies();

    const publicRoutes = [
      `/`,
      `/staff`,
      `/vote`,
      `/verify`,
      `/results`,
      `/results/${electionId}`,
    ];

    for (const route of publicRoutes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(hasOverflow, `Horizontal scroll detected at 375px on ${route}`).toBe(false);
    }

    // 3. Sign in as Observer and check Observer routes at 375px
    await page.goto('/staff');
    await page.fill('input[type="email"]', observerEmail);
    await page.fill('input[type="password"]', 'ObserverPass123!');
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(url => url.pathname.startsWith('/observer'));

    const observerRoutes = [
      `/observer`,
      `/observer/elections/${electionId}`,
    ];

    for (const route of observerRoutes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(hasOverflow, `Horizontal scroll detected at 375px on ${route}`).toBe(false);
    }
  });
});
