import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3001';
const API_URL = 'http://localhost:3000';

async function run() {
  console.log('--- Starting Stage 2 Verification ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // 1. Public results empty state (when nothing sealed)
  console.log('1. Checking Public Results empty state...');
  await page.goto(`${BASE_URL}/results`);
  await page.waitForSelector('main');
  const bodyText = await page.textContent('body');
  if (bodyText.includes('No sealed election results are publicly available yet.') || bodyText.includes('Check a receipt') || bodyText.includes('Published results')) {
    console.log('✓ Public results page loaded and displays empty state/instructions correctly.');
  } else {
    throw new Error('Public results page unexpected content: ' + bodyText.slice(0, 150));
  }

  // 2. Staff Sign-in
  console.log('2. Signing in as admin...');
  await page.goto(`${BASE_URL}/staff`);
  await page.fill('input[type="email"]', 'admin@uni.test');
  await page.fill('input[type="password"]', 'administrator123');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/admin');
  console.log('✓ Admin signed in.');

  // 3. Create Draft Election with Ranked Choice and Multi-Choice
  console.log('3. Creating draft election with Ranked Choice & Multi-Choice...');
  await page.goto(`${BASE_URL}/admin/elections/new`);
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Stage 2 UI Test Election');
  await page.locator('label:has-text("Description") textarea').fill('Testing accessible UI, ranking, and modals.');

  // Position 1: Multi (Choose 2 of 3)
  const pos1 = page.locator('fieldset.card').nth(0);
  await pos1.locator('label:has-text("Position title") input').fill('Board Members');
  await pos1.locator('select').selectOption('MULTI');
  await pos1.locator('label:has-text("Seats") input').fill('2');
  await pos1.locator('input[aria-label="Name 1"]').fill('Candidate Alpha');
  await pos1.locator('input[aria-label="Name 2"]').fill('Candidate Beta');
  await pos1.locator('button:has-text("+ Add candidate")').click();
  await pos1.locator('input[aria-label="Name 3"]').fill('Candidate Gamma');

  // Add Position 2: Ranked Choice
  await page.click('button:has-text("+ Add another position")');
  const pos2 = page.locator('fieldset.card').nth(1);
  await pos2.locator('label:has-text("Position title") input').fill('President (Ranked)');
  await pos2.locator('select').selectOption('RANKED');
  await pos2.locator('input[aria-label="Name 1"]').fill('Ranked Candidate 1');
  await pos2.locator('input[aria-label="Name 2"]').fill('Ranked Candidate 2');
  await pos2.locator('button:has-text("+ Add candidate")').click();
  await pos2.locator('input[aria-label="Name 3"]').fill('Ranked Candidate 3');

  await page.click('button:has-text("Create draft election")');
  await page.waitForURL(url => url.pathname.startsWith('/admin/elections/') && url.pathname !== '/admin/elections/new');
  const electionUrl = page.url();
  const electionId = electionUrl.split('/').pop();
  console.log(`✓ Draft election created with id ${electionId}`);

  // 4. Modal Dialog Accessibility Verification
  console.log('4. Testing Confirm Dialog accessibility (Focus trap, ESC, ARIA, focus return)...');
  // First import voters so we can open
  await page.click('button[role="tab"]:has-text("Voters")');
  const voterEmail = `voter_${Date.now()}@uni.test`;
  await page.fill('textarea[aria-label="Voter CSV"]', `id,name,email,phone\nVOTER_A,Voter A,${voterEmail},\n`);
  await page.click('button:has-text("Import voters")');
  await page.waitForSelector('text=Added 1 voter');

  await page.click('button[role="tab"]:has-text("Overview")');
  const openTriggerBtn = page.locator('button:has-text("Open voting")');
  await openTriggerBtn.focus();
  await openTriggerBtn.click();

  // Verify dialog is visible and has proper ARIA attributes
  const dialog = page.locator('div[role="dialog"][aria-modal="true"]');
  await dialog.waitFor({ state: 'visible' });
  const labelledBy = await dialog.getAttribute('aria-labelledby');
  if (labelledBy !== 'confirm-dialog-title') {
    throw new Error(`Expected aria-labelledby to be confirm-dialog-title, got ${labelledBy}`);
  }
  console.log('✓ Modal has role="dialog", aria-modal="true", and aria-labelledby="confirm-dialog-title".');

  // Test ESC dismiss
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  // Verify focus returned to trigger button
  const isTriggerFocused = await openTriggerBtn.evaluate(el => document.activeElement === el);
  if (!isTriggerFocused) {
    throw new Error('Focus did not return to the trigger button after Escape!');
  }
  console.log('✓ Escape dismissed dialog and returned focus to trigger button.');

  // Re-open dialog and confirm
  await openTriggerBtn.click();
  await dialog.waitFor({ state: 'visible' });
  const confirmBtn = dialog.locator('button:has-text("Yes, continue")');
  await confirmBtn.click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForSelector('.chip.OPEN', { timeout: 5000 });
  console.log('✓ Dialog confirm succeeded and election is now OPEN.');

  // 5. Voter Portal: Multi-choice count live region, Ranked Choice Up/Down & Live Region
  console.log('5. Testing Voter Portal (Live regions, Up/Down ranking, Receipt copy feedback)...');
  const voterContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const voterPage = await voterContext.newPage();

  await voterPage.goto(`${BASE_URL}/vote`);
  await voterPage.locator('label:has-text("Matric / voter number") input').fill('VOTER_A');
  await voterPage.click('button:has-text("Send me a code")');
  await voterPage.waitForSelector('text=Demo mode: your code is');
  const otpText = await voterPage.locator('text=Demo mode: your code is').textContent();
  const otp = otpText.match(/\d{6}/)[0];
  await voterPage.locator('input.code-input').fill(otp);
  await voterPage.click('button:has-text("Sign in")');
  await voterPage.waitForURL('**/vote/elections');

  // Go to election ballot
  await voterPage.click(`a[href*="/vote/elections/${electionId}"]`);
  await voterPage.waitForSelector('h1:has-text("Stage 2 UI Test Election")');

  // Test Multi-choice selection live region
  const alphaOption = voterPage.locator('label:has-text("Candidate Alpha") input');
  await alphaOption.check();
  const countLiveBadge = await voterPage.locator('.chip[aria-live="polite"]').textContent();
  console.log(`Badge selection count text: "${countLiveBadge.trim()}"`);
  if (!countLiveBadge.includes('1 of 2 selected')) {
    throw new Error(`Expected "1 of 2 selected", got "${countLiveBadge}"`);
  }
  const srLiveAnnouncement = await voterPage.locator('div[aria-live="polite"].sr-only').textContent();
  console.log(`Screen-reader live text: "${srLiveAnnouncement.trim()}"`);
  if (!srLiveAnnouncement.includes('1 of 2 selected')) {
    throw new Error(`Expected sr live text to include selection count, got "${srLiveAnnouncement}"`);
  }
  console.log('✓ Multi-choice selection count announced via aria-live badge and sr live region.');

  // Test Ranked Choice: Click Candidate 1, then Candidate 2 to rank them
  const rankedFieldset = voterPage.locator('fieldset.card:has-text("President (Ranked)")');
  await rankedFieldset.locator('label:has-text("Ranked Candidate 1")').click();
  await rankedFieldset.locator('label:has-text("Ranked Candidate 2")').click();

  // Find candidate 2 and click its "Move up" button
  const moveUpBtnCand2 = rankedFieldset.locator('button[aria-label^="Move Ranked Candidate 2 up"]');
  await moveUpBtnCand2.click();

  // Check live message announcement
  const liveAnnouncement = await voterPage.locator('div[aria-live="polite"].sr-only').textContent();
  console.log(`Rank live announcement: "${liveAnnouncement}"`);
  if (!liveAnnouncement.includes('moved to rank 1')) {
    throw new Error(`Expected live announcement to mention "moved to rank 1", got "${liveAnnouncement}"`);
  }
  console.log('✓ Ranked choice Up/Down button moved candidate and announced via aria-live ("Ranked Candidate 2 moved to rank 1").');

  // Cast ballot
  await voterPage.click('button:has-text("Review my ballot")');
  await voterPage.waitForSelector('text=Check your ballot');
  await voterPage.click('button:has-text("Submit my vote")');
  await voterPage.waitForSelector('text=Your vote is recorded');
  console.log('✓ Ballot cast successfully.');

  // Test "Copied!" feedback on receipt copy button
  const copyBtn = voterPage.locator('button:has-text("Copy codes")');
  await copyBtn.click();
  await voterPage.waitForSelector('button:has-text("✓ Copied!")');
  console.log('✓ Receipt copy button provides "✓ Copied!" feedback.');

  await voterContext.close();

  // 6. Close, Seal, and Verify Results Table Alternative
  console.log('6. Closing, Sealing, and testing Results Table alternative...');
  await page.bringToFront();
  await page.reload();
  await page.click('button:has-text("Close voting")');
  const closeDialog = page.locator('div[role="dialog"]');
  await closeDialog.waitFor({ state: 'visible' });
  await closeDialog.locator('button:has-text("Yes, continue")').click();
  await page.waitForSelector('.chip.CLOSED');

  await page.click('button:has-text("Seal and publish results")');
  const sealDialog = page.locator('div[role="dialog"]');
  await sealDialog.waitFor({ state: 'visible' });
  await sealDialog.locator('button:has-text("Yes, continue")').click();
  await page.waitForSelector('.chip.SEALED');
  console.log('✓ Election closed and sealed.');

  // Go to results view
  await page.goto(`${BASE_URL}/results/${electionId}`);
  await page.waitForSelector('h1:has-text("Stage 2 UI Test Election")');

  // Check Results format toggle
  const toggleTableBtn = page.locator('button:has-text("Table only")');
  await toggleTableBtn.click();
  const summaryTable = page.locator('table[aria-label^="Summary table"]');
  await summaryTable.first().waitFor({ state: 'visible' });
  const tableHeaders = await summaryTable.first().locator('th').allTextContents();
  console.log(`Table headers: ${JSON.stringify(tableHeaders)}`);
  if (!tableHeaders.includes('Candidate / Option') || !tableHeaders.includes('Votes') || !tableHeaders.includes('Share')) {
    throw new Error(`Summary table missing standard headers: ${JSON.stringify(tableHeaders)}`);
  }
  console.log('✓ Results summary table alternative is visible and accessible.');

  // 7. 375px Mobile Viewport & Touch Target Audit
  console.log('7. Testing 375px mobile viewport and touch targets across all portals...');
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();

  const urlsToTest = [
    `${BASE_URL}/results/${electionId}`,
    `${BASE_URL}/results`,
    `${BASE_URL}/verify`,
    `${BASE_URL}/staff`,
    `${BASE_URL}/vote`,
  ];

  for (const url of urlsToTest) {
    await mobilePage.goto(url);
    const hasOverflow = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    if (hasOverflow) {
      const scrollW = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
      throw new Error(`Horizontal overflow detected at 375px on ${url}: scrollWidth=${scrollW}`);
    }
  }
  console.log('✓ No horizontal overflow at 375px across public, verify, staff, and voter pages.');

  // Touch targets check on /staff button
  await mobilePage.goto(`${BASE_URL}/staff`);
  const btnBox = await mobilePage.locator('button:has-text("Sign in")').boundingBox();
  if (btnBox.height < 44) {
    throw new Error(`Button height on /staff is ${btnBox.height}px (< 44px)`);
  }
  console.log(`✓ Button height is ${btnBox.height}px (>= 44px).`);

  await mobileContext.close();
  await browser.close();

  console.log('--- ALL STAGE 2 VERIFICATIONS PASSED ---');
}

run().catch(err => {
  console.error('STAGE 2 VERIFICATION FAILED:', err);
  process.exit(1);
});
