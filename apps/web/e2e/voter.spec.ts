import { expect, test } from '@playwright/test';
import { adminLogin, createElectionViaUi, importVotersViaUi, voterLogin } from './helpers';

test.describe('Voter Experience & Verification', () => {
  test('OTP sign-in, single choice, ranked choice with keyboard, review, receipt, and receipt check at /verify', async ({ browser }) => {
    const timestamp = Date.now();
    const voterId = `STU_VOTE_${timestamp}`;
    const voterEmail = `voter_${timestamp}@uni.test`;

    // Step 1: Admin sets up and opens the election with Single + Ranked positions
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminLogin(adminPage);

    const electionTitle = `Voter Flow Election ${timestamp}`;
    const electionId = await createElectionViaUi(adminPage, electionTitle, {
      withRanked: true,
      rankedTitle: 'Sports Director (Ranked)',
    });

    await importVotersViaUi(adminPage, electionId, [{ id: voterId, name: 'Dayo K', email: voterEmail }]);

    // Open election
    await adminPage.click('button[role="tab"]:has-text("Overview")');
    await adminPage.click('button:has-text("Open voting")');
    const dialog = adminPage.locator('div[role="dialog"]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('button:has-text("Yes, continue")').click();
    await expect(adminPage.locator('.chip.OPEN')).toBeVisible();
    await adminContext.close();

    // Step 2: Voter signs in via OTP
    const voterContext = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const voterPage = await voterContext.newPage();
    await voterLogin(voterPage, voterId);

    // Step 3: Navigate to open election
    const electionLink = voterPage.locator(`a[href*="/vote/elections/${electionId}"]`);
    await expect(electionLink).toBeVisible();
    await electionLink.click();
    await expect(voterPage.locator('h1')).toContainText(electionTitle);

    // Step 4: Single choice selection
    const singleFieldset = voterPage.locator('fieldset.card:has-text("President")');
    const candAlpha = singleFieldset.locator('label:has-text("Candidate Alpha") input');
    await candAlpha.check();
    await expect(candAlpha).toBeChecked();

    // Step 5: Ranked choice selection & keyboard up/down controls
    const rankedFieldset = voterPage.locator('fieldset.card:has-text("Sports Director (Ranked)")');
    // Select Candidate 1, then Candidate 2 to rank them
    await rankedFieldset.locator('label:has-text("Ranked Candidate 1")').click();
    await rankedFieldset.locator('label:has-text("Ranked Candidate 2")').click();

    // Move candidate 2 up using keyboard accessibility (Focus Up button and press Enter)
    const moveUpBtn = rankedFieldset.locator('button[aria-label^="Move Ranked Candidate 2 up"]');
    await moveUpBtn.focus();
    await voterPage.keyboard.press('Enter');

    // Verify aria-live announcement
    const liveRegion = voterPage.locator('div[aria-live="polite"].sr-only');
    await expect(liveRegion).toContainText('Ranked Candidate 2 moved to rank 1');

    // Step 6: Review ballot
    const reviewBtn = voterPage.locator('button:has-text("Review my ballot")');
    await expect(reviewBtn).toBeEnabled();
    await reviewBtn.click();

    await expect(voterPage.locator('h2')).toContainText('Check your ballot');
    await expect(voterPage.locator('text=Candidate Alpha')).toBeVisible();
    await expect(voterPage.locator('text=1. Ranked Candidate 2 → 2. Ranked Candidate 1')).toBeVisible();

    // Step 7: Submit vote and verify receipt
    const submitBtn = voterPage.locator('button:has-text("Submit my vote")');
    await submitBtn.click();

    await expect(voterPage.locator('h2')).toContainText('Your vote is recorded');
    await expect(voterPage.locator('.receipt')).toHaveCount(2);

    // Copy receipt codes with "Copied!" feedback
    const copyBtn = voterPage.locator('button:has-text("Copy codes")');
    await copyBtn.click();
    await expect(voterPage.locator('button:has-text("✓ Copied!")')).toBeVisible();

    // Extract receipt code
    const firstReceiptText = await voterPage.locator('.receipt').first().textContent();
    const cleanReceiptCode = firstReceiptText?.replace(/[^A-Fa-f0-9]/g, '') ?? '';
    expect(cleanReceiptCode.length).toBe(16);

    // Step 8: Verify receipt on /verify using "Check receipt" link
    const checkReceiptLink = voterPage.locator('a:has-text("Check receipt")').first();
    await checkReceiptLink.click();
    await voterPage.waitForURL(url => url.pathname.startsWith('/verify'));

    await expect(voterPage.locator('h1')).toContainText('Check a receipt');
    await expect(voterPage.locator('text=Found.')).toBeVisible();
    await expect(voterPage.locator('text=A ballot with this receipt is recorded')).toBeVisible();
    await expect(voterPage.locator('text=Ballot fingerprint')).toBeVisible();

    await voterContext.close();
  });
});
