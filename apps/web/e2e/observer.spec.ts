import { expect, test } from '@playwright/test';
import { adminLogin, createElectionViaUi, importVotersViaUi } from './helpers';

test.describe('Observer Role (Read-only)', () => {
  test('observer is read-only (no Voters tab, no action buttons) and blocked from /admin', async ({ browser }) => {
    const timestamp = Date.now();
    const observerEmail = `observer_${timestamp}@uni.test`;
    const observerPassword = 'ObserverPassword123!';

    // Step 1: Admin creates an election, registers voters, opens voting, and registers an observer account
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminLogin(adminPage);

    const electionTitle = `Observer Audit Election ${timestamp}`;
    const electionId = await createElectionViaUi(adminPage, electionTitle);

    // Import a voter so opening is permitted
    await importVotersViaUi(adminPage, electionId, [{ id: `OBS_V_${timestamp}`, name: 'Observer Voter', email: `voter_${timestamp}@uni.test` }]);

    // Open election so it appears in the observer's elections list (observers only view non-draft elections)
    await adminPage.click('button[role="tab"]:has-text("Overview")');
    await adminPage.click('button:has-text("Open voting")');
    const dialog = adminPage.locator('div[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('button:has-text("Yes, continue")').click();
    await expect(adminPage.locator('.chip.OPEN')).toBeVisible();

    // Create observer user via /admin/users
    await adminPage.goto('/admin/users');
    await adminPage.locator('label:has-text("Full name") input').fill('Observer John');
    await adminPage.locator('label:has-text("Email") input').fill(observerEmail);
    await adminPage.locator('label:has-text("Temporary password") input').fill(observerPassword);
    await adminPage.locator('label:has-text("Role") select').selectOption('OBSERVER');
    await adminPage.click('button:has-text("Create account")');
    await expect(adminPage.locator('text=Created ' + observerEmail)).toBeVisible();
    await adminContext.close();

    // Step 2: Observer signs in via /staff
    const observerContext = await browser.newContext();
    const observerPage = await observerContext.newPage();

    await observerPage.goto('/staff');
    await observerPage.fill('input[type="email"]', observerEmail);
    await observerPage.fill('input[type="password"]', observerPassword);
    await observerPage.click('button:has-text("Sign in")');
    await observerPage.waitForURL(url => url.pathname.startsWith('/observer'));

    // Step 3: Blocked from /admin
    await observerPage.goto('/admin');
    await observerPage.waitForURL(url => !url.pathname.startsWith('/admin') || url.pathname.includes('/staff'));
    expect(observerPage.url()).not.toContain('/admin');

    await observerPage.goto('/admin/elections/new');
    await observerPage.waitForURL(url => !url.pathname.startsWith('/admin') || url.pathname.includes('/staff'));
    expect(observerPage.url()).not.toContain('/admin/elections/new');

    await observerPage.goto('/admin/users');
    await observerPage.waitForURL(url => !url.pathname.startsWith('/admin') || url.pathname.includes('/staff'));
    expect(observerPage.url()).not.toContain('/admin/users');

    // Step 4: Observer views election in /observer portal
    await observerPage.goto('/observer');
    await expect(observerPage.locator('h1')).toContainText('Elections');
    const electionRow = observerPage.locator(`a[href*="/observer/elections/${electionId}"]`);
    await expect(electionRow).toBeVisible();
    await electionRow.click();
    await observerPage.waitForURL(`/observer/elections/${electionId}`);

    // Verify Read-Only interface
    // 1. No Voters tab
    await expect(observerPage.locator('button[role="tab"]:has-text("Voters")')).toHaveCount(0);

    // 2. No modification or action buttons
    await expect(observerPage.locator('button:has-text("Open voting")')).toHaveCount(0);
    await expect(observerPage.locator('button:has-text("Close voting")')).toHaveCount(0);
    await expect(observerPage.locator('button:has-text("Seal and publish results")')).toHaveCount(0);
    await expect(observerPage.locator('button:has-text("Edit draft")')).toHaveCount(0);
    await expect(observerPage.locator('button:has-text("Duplicate election")')).toHaveCount(0);
    await expect(observerPage.locator('button:has-text("Delete draft")')).toHaveCount(0);

    // 3. Observer can inspect Audit & verification tab
    await observerPage.click('button[role="tab"]:has-text("Audit & verification")');
    await expect(observerPage.locator('text=The audit log is intact')).toBeVisible();
    await expect(observerPage.locator('text=Election created')).toBeVisible();

    await observerContext.close();
  });
});
