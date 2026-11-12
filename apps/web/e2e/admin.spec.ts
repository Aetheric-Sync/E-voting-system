import { expect, test } from '@playwright/test';
import { adminLogin, createElectionViaUi, importVotersViaUi } from './helpers';

test.describe('Admin Election Lifecycle', () => {
  test('staff sign-in, build election, CSV import, edit draft, duplicate, open, close, seal, and verify', async ({ page }) => {
    // 1. Staff sign-in
    await adminLogin(page);
    await expect(page).toHaveURL(/\/admin/);

    // 2. Build draft election
    const timestamp = Date.now();
    const title = `Student Union General Election ${timestamp}`;
    const electionId = await createElectionViaUi(page, title, {
      withRanked: true,
      rankedTitle: 'Sports Secretary',
    });
    expect(electionId).toBeTruthy();
    await expect(page.locator('h1')).toContainText(title);
    await expect(page.locator('.chip.DRAFT')).toBeVisible();

    // 3. Edit draft election
    await page.click('button[role="tab"]:has-text("Overview")');
    await page.click('a:has-text("Edit draft")');
    await expect(page).toHaveURL(`/admin/elections/${electionId}/edit`);
    const editedTitle = `${title} (Edited)`;
    const titleInput = page.getByRole('textbox', { name: 'Title', exact: true });
    await titleInput.fill(editedTitle);
    await page.click('button:has-text("Save changes")');
    await page.waitForURL(`/admin/elections/${electionId}`);
    await expect(page.locator('h1')).toContainText(editedTitle);

    // 4. Duplicate election
    await page.click('button:has-text("Duplicate election")');
    await page.waitForURL((url) => url.pathname.startsWith('/admin/elections/') && !url.pathname.includes(electionId));
    const duplicateUrl = page.url();
    const duplicateId = duplicateUrl.split('/admin/elections/')[1].split(/[?#]/)[0].replace(/\/$/, '');
    expect(duplicateId).not.toBe(electionId);
    await expect(page.locator('h1')).toContainText(`${editedTitle} (Copy)`);
    await expect(page.locator('.chip.DRAFT')).toBeVisible();
    await expect(page.locator('text=No voters yet')).toBeVisible();

    // 5. Return to original election and CSV import voters
    await page.goto(`/admin/elections/${electionId}`);
    const voters = [
      { id: `ADM_V1_${timestamp}`, name: 'Alice Smith', email: `alice_${timestamp}@uni.test` },
      { id: `ADM_V2_${timestamp}`, name: 'Bob Jones', email: `bob_${timestamp}@uni.test` },
      { id: `ADM_V3_${timestamp}`, name: 'Charlie Clark', email: `charlie_${timestamp}@uni.test` },
    ];
    await importVotersViaUi(page, electionId, voters);

    // Verify voter register pagination and counts
    await expect(page.locator('text=Showing 1–3 of 3 voters')).toBeVisible();
    await expect(page.locator(`text=${voters[0].name}`)).toBeVisible();

    // 6. Open election via accessible confirm modal
    await page.click('button[role="tab"]:has-text("Overview")');
    const openTriggerBtn = page.locator('button:has-text("Open voting")');
    await expect(openTriggerBtn).toBeEnabled();
    await openTriggerBtn.click();

    const openDialog = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(openDialog).toBeVisible();
    await expect(openDialog.locator('h2')).toContainText('Open voting now?');
    await openDialog.locator('button:has-text("Yes, continue")').click();
    await expect(openDialog).toBeHidden();
    await expect(page.locator('.chip.OPEN')).toBeVisible();

    // 7. Close election via accessible confirm modal
    const closeTriggerBtn = page.locator('button:has-text("Close voting")');
    await closeTriggerBtn.click();
    const closeDialog = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(closeDialog).toBeVisible();
    await closeDialog.locator('button:has-text("Yes, continue")').click();
    await expect(closeDialog).toBeHidden();
    await expect(page.locator('.chip.CLOSED')).toBeVisible();

    // 8. Seal and publish results via accessible confirm modal
    const sealTriggerBtn = page.locator('button:has-text("Seal and publish results")');
    await sealTriggerBtn.click();
    const sealDialog = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(sealDialog).toBeVisible();
    await sealDialog.locator('button:has-text("Yes, continue")').click();
    await expect(sealDialog).toBeHidden();
    await expect(page.locator('.chip.SEALED')).toBeVisible();

    // Results link is visible and public results can be visited
    const publicResultsLink = page.locator(`a[href="/results/${electionId}"]`);
    await expect(publicResultsLink).toBeVisible();

    // 9. Audit and cryptographic verification
    await page.click('button[role="tab"]:has-text("Audit & verification")');
    await expect(page.locator('text=The audit log is intact')).toBeVisible();
    await expect(page.locator('text=Election created')).toBeVisible();
    await expect(page.locator('text=Election edited')).toBeVisible();
    await expect(page.locator('text=Voter register updated')).toBeVisible();
    await expect(page.locator('text=Voting opened')).toBeVisible();
    await expect(page.locator('text=Voting closed')).toBeVisible();
    await expect(page.locator('text=Results sealed')).toBeVisible();

    // Recompute verification
    await page.click('button:has-text("Run verification")');
    await expect(page.locator('text=recount matches the published result')).toBeVisible();
    await expect(page.locator('text=result fingerprint matches')).toBeVisible();
    await expect(page.locator('text=audit chain is unbroken')).toBeVisible();
  });
});
