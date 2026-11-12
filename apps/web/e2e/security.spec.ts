import { expect, test } from '@playwright/test';
import { adminLogin, createElectionViaUi, importVotersViaUi, voterLogin } from './helpers';

test.describe('Security & Access Control', () => {
  test('unauthenticated users are redirected to /staff from staff routes', async ({ page }) => {
    // No session cookie
    await page.goto('/admin');
    await page.waitForURL(url => url.pathname.includes('/staff'));
    expect(page.url()).toContain('/staff');

    await page.goto('/admin/elections/new');
    await page.waitForURL(url => url.pathname.includes('/staff'));
    expect(page.url()).toContain('/staff');

    await page.goto('/observer');
    await page.waitForURL(url => url.pathname.includes('/staff'));
    expect(page.url()).toContain('/staff');
  });

  test('voter gets 403 on staff APIs and cannot access /admin in browser', async ({ browser }) => {
    const timestamp = Date.now();
    const voterId = `VOT_SEC_${timestamp}`;

    // Admin sets up election and voter
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
    const electionId = await createElectionViaUi(adminPage, `Security Spec ${timestamp}`);
    await importVotersViaUi(adminPage, electionId, [{ id: voterId, name: 'Sec Voter', email: `voter_${timestamp}@uni.test` }]);
    await adminContext.close();

    // Voter signs in
    const voterContext = await browser.newContext();
    const voterPage = await voterContext.newPage();
    await voterLogin(voterPage, voterId);

    // Voter tries calling staff endpoints through the proxied /api
    const resCreate = await voterPage.request.post('/api/elections', {
      data: {
        title: 'Malicious Election',
        mode: 'ANONYMOUS_AUDIT',
        positions: [{ title: 'Hacked', type: 'SINGLE', seats: 1, allowAbstain: false, candidates: [{ name: 'Evil' }, { name: 'Bad' }] }],
      },
    });
    expect(resCreate.status()).toBe(403);

    const resListStaff = await voterPage.request.get('/api/elections');
    expect(resListStaff.status()).toBe(403);

    const resPut = await voterPage.request.put(`/api/elections/${electionId}`, {
      data: {
        title: 'Tampered Title',
        mode: 'ANONYMOUS_AUDIT',
        positions: [{ title: 'P1', type: 'SINGLE', seats: 1, allowAbstain: false, candidates: [{ name: 'A' }, { name: 'B' }] }],
      },
    });
    expect(resPut.status()).toBe(403);

    const resDuplicate = await voterPage.request.post(`/api/elections/${electionId}/duplicate`);
    expect(resDuplicate.status()).toBe(403);

    const resUsers = await voterPage.request.get('/api/users');
    expect(resUsers.status()).toBe(403);

    // Browser navigation to /admin is denied
    await voterPage.goto('/admin');
    await voterPage.waitForURL(url => !url.pathname.startsWith('/admin') || url.pathname.includes('/staff'));
    expect(voterPage.url()).not.toContain('/admin');

    await voterContext.close();
  });

  test('results are strictly hidden until election is sealed', async ({ browser }) => {
    const timestamp = Date.now();
    const voterId = `VOT_RES_${timestamp}`;

    // 1. Admin creates draft election
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminLogin(adminPage);
    const electionId = await createElectionViaUi(adminPage, `Results Secrecy ${timestamp}`);
    await importVotersViaUi(adminPage, electionId, [{ id: voterId, name: 'Secret Voter', email: `secvoter_${timestamp}@uni.test` }]);

    // API check while in DRAFT
    const resDraft = await adminPage.request.get(`/api/public/elections/${electionId}/results`);
    expect([404, 409]).toContain(resDraft.status());

    // Open election
    await adminPage.click('button[role="tab"]:has-text("Overview")');
    await adminPage.click('button:has-text("Open voting")');
    const openDialog = adminPage.locator('div[role="dialog"]');
    await openDialog.waitFor({ state: 'visible' });
    await openDialog.locator('button:has-text("Yes, continue")').click();
    await expect(adminPage.locator('.chip.OPEN')).toBeVisible();

    // API check while OPEN
    const resOpen = await adminPage.request.get(`/api/public/elections/${electionId}/results`);
    expect([404, 409]).toContain(resOpen.status());

    // Public web check while OPEN: Results tab shows secrecy notice
    await adminPage.click('button[role="tab"]:has-text("Results")');
    await expect(adminPage.locator('text=Counts are never visible while voting is open')).toBeVisible();

    // Cast a ballot
    const voterContext = await browser.newContext();
    const voterPage = await voterContext.newPage();
    await voterLogin(voterPage, voterId);
    await voterPage.click(`a[href*="/vote/elections/${electionId}"]`);
    await voterPage.locator('label:has-text("Candidate Alpha") input').check();
    await voterPage.click('button:has-text("Review my ballot")');
    await voterPage.click('button:has-text("Submit my vote")');
    await expect(voterPage.locator('h2:has-text("Your vote is recorded")')).toBeVisible();
    await voterContext.close();

    // Close election (now CLOSED, still unsealed)
    await adminPage.click('button[role="tab"]:has-text("Overview")');
    await adminPage.click('button:has-text("Close voting")');
    const closeDialog = adminPage.locator('div[role="dialog"]');
    await closeDialog.waitFor({ state: 'visible' });
    await closeDialog.locator('button:has-text("Yes, continue")').click();
    await expect(adminPage.locator('.chip.CLOSED')).toBeVisible();

    // API check while CLOSED (not sealed yet)
    const resClosed = await adminPage.request.get(`/api/public/elections/${electionId}/results`);
    expect([404, 409]).toContain(resClosed.status());

    // Now seal results
    await adminPage.click('button:has-text("Seal and publish results")');
    const sealDialog = adminPage.locator('div[role="dialog"]');
    await sealDialog.waitFor({ state: 'visible' });
    await sealDialog.locator('button:has-text("Yes, continue")').click();
    await expect(adminPage.locator('.chip.SEALED')).toBeVisible();

    // API check after SEALED: returns 200 with resultHash and tallies
    const resSealed = await adminPage.request.get(`/api/public/elections/${electionId}/results`);
    expect(resSealed.status()).toBe(200);
    const sealedData = await resSealed.json();
    expect(sealedData.sealed?.resultHash).toBeTruthy();
    expect(sealedData.sealed?.auditHead).toBeTruthy();
    expect(sealedData.sealed?.results).toBeInstanceOf(Array);

    // Public results page on web
    await adminPage.goto(`/results/${electionId}`);
    await expect(adminPage.locator('h1')).toContainText(`Results Secrecy ${timestamp}`);
    await expect(adminPage.locator('.winner-tag:has-text("ELECTED")').first()).toBeVisible();

    await adminContext.close();
  });
});
