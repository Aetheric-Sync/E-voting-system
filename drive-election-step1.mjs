import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const results = {
    staffSignIn: false,
    electionCreated: false,
    observerUserCreated: false,
    votersImported: false,
    electionOpened: false,
    voter1Voted: false,
    voter2Voted: false,
    voter3Voted: false,
    receiptVerified: false,
    electionClosed: false,
    electionSealed: false,
    auditVerificationPassed: false,
    publicResultsViewed: false,
    observerReadOnlyVerified: false,
    errors: [],
  };

  let electionId = '';
  let voter1Receipt = '';

  try {
    console.log('--- Step 1: Staff Sign-in ---');
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminPage.goto('http://localhost:3001/staff');

    await adminPage.fill('input[type="email"]', 'admin@uni.test');
    await adminPage.fill('input[type="password"]', 'administrator123');
    await adminPage.click('button:has-text("Sign in")');
    await adminPage.waitForURL('**/admin');
    results.staffSignIn = true;
    console.log('✓ Staff sign-in successful');

    console.log('--- Step 2: Create Election ---');
    await adminPage.goto('http://localhost:3001/admin/elections/new');
    await adminPage.fill('input[placeholder="Students\' Union Election 2026"]', 'Campus Election 2026');
    await adminPage.fill('textarea', 'General Campus Elections');
    await adminPage.fill('input[placeholder="President"]', 'Student Union President');
    
    // Fill in candidate names using aria-label
    await adminPage.fill('input[aria-label="Name 1"]', 'Alice Johnson');
    await adminPage.fill('input[aria-label="Name 2"]', 'Bob Smith');

    await adminPage.click('button:has-text("Create draft election")');
    await adminPage.waitForURL((url) => url.pathname.startsWith('/admin/elections/') && url.pathname !== '/admin/elections/new');
    const url = adminPage.url();
    electionId = url.split('/admin/elections/')[1].split('?')[0].replace(/\/$/, '');
    console.log(`✓ Election created with ID: ${electionId}`);
    results.electionCreated = true;

    console.log('--- Step 3: Create Observer Account in /admin/users ---');
    await adminPage.goto('http://localhost:3001/admin/users');
    const observerEmail = `observer_${Date.now()}@uni.test`;
    
    // Check fields on page
    await adminPage.fill('label:has-text("Full name") input', 'Jane Observer');
    await adminPage.fill('label:has-text("Email") input', observerEmail);
    await adminPage.fill('label:has-text("Temporary password") input', 'observerpass123');
    await adminPage.selectOption('label:has-text("Role") select', 'OBSERVER');
    await adminPage.click('button:has-text("Create account")');
    await adminPage.waitForSelector(`text=Created ${observerEmail}`);
    results.observerUserCreated = true;
    console.log(`✓ Observer account created: ${observerEmail}`);

    console.log('--- Step 4: Import Voters and Open Election ---');
    await adminPage.goto(`http://localhost:3001/admin/elections/${electionId}`);
    // Click Voters tab
    await adminPage.click('button[role="tab"]:has-text("Voters")');
    const csvContent = `id,name,email,phone\nVOTER1,Voter One,voter1@test.local,\nVOTER2,Voter Two,voter2@test.local,\nVOTER3,Voter Three,,+2348000000001`;
    await adminPage.fill('textarea[aria-label="Voter CSV"]', csvContent);
    await adminPage.click('button:has-text("Import voters")');
    await adminPage.waitForSelector('text=Added 3 voters');
    results.votersImported = true;
    console.log('✓ 3 voters imported');

    // Switch to Overview tab and open
    await adminPage.click('button[role="tab"]:has-text("Overview")');
    // First click on "Open voting" triggers confirm prompt, then click "Yes, continue"
    await adminPage.click('button:has-text("Open voting")');
    await adminPage.click('button:has-text("Yes, continue")');
    // Wait for state chip or state change
    await adminPage.waitForSelector('.chip.OPEN');
    results.electionOpened = true;
    console.log('✓ Election opened');

    console.log('--- Step 5: Voters Cast Ballots at /vote ---');
    // Voter 1
    const voter1Context = await browser.newContext();
    const voter1Page = await voter1Context.newPage();
    await voter1Page.goto('http://localhost:3001/vote');
    await voter1Page.fill('input[autoComplete="username"]', 'VOTER1');
    await voter1Page.click('button:has-text("Send me a code")');
    await voter1Page.waitForSelector('text=Demo mode: your code is');
    const otpBanner1 = await voter1Page.textContent('.alert');
    const match1 = otpBanner1?.match(/\b(\d{6})\b/);
    if (!match1) throw new Error('Could not find OTP in banner for Voter 1');
    const code1 = match1[1];
    await voter1Page.fill('input.code-input', code1);
    await voter1Page.click('button:has-text("Sign in")');
    await voter1Page.waitForURL('**/vote/elections');

    // Go into election
    await voter1Page.click(`a[href="/vote/elections/${electionId}"]`);
    await voter1Page.waitForURL(`**/vote/elections/${electionId}`);
    // Choose candidate Alice Johnson
    await voter1Page.click('label:has-text("Alice Johnson")');
    await voter1Page.click('button:has-text("Review my ballot")');
    await voter1Page.waitForSelector('text=Check your ballot');
    await voter1Page.click('button:has-text("Submit my vote")');
    await voter1Page.waitForSelector('text=Your vote is recorded');
    const receiptEl1 = await voter1Page.waitForSelector('.receipt');
    voter1Receipt = (await receiptEl1.textContent())?.trim() ?? '';
    console.log(`✓ Voter 1 voted, receipt: ${voter1Receipt}`);
    results.voter1Voted = true;

    // Voter 2
    const voter2Context = await browser.newContext();
    const voter2Page = await voter2Context.newPage();
    await voter2Page.goto('http://localhost:3001/vote');
    await voter2Page.fill('input[autoComplete="username"]', 'VOTER2');
    await voter2Page.click('button:has-text("Send me a code")');
    await voter2Page.waitForSelector('text=Demo mode: your code is');
    const otpBanner2 = await voter2Page.textContent('.alert');
    const match2 = otpBanner2?.match(/\b(\d{6})\b/);
    if (!match2) throw new Error('Could not find OTP in banner for Voter 2');
    const code2 = match2[1];
    await voter2Page.fill('input.code-input', code2);
    await voter2Page.click('button:has-text("Sign in")');
    await voter2Page.waitForURL('**/vote/elections');

    await voter2Page.click(`a[href="/vote/elections/${electionId}"]`);
    await voter2Page.waitForURL(`**/vote/elections/${electionId}`);
    // Choose candidate Bob Smith
    await voter2Page.click('label:has-text("Bob Smith")');
    await voter2Page.click('button:has-text("Review my ballot")');
    await voter2Page.waitForSelector('text=Check your ballot');
    await voter2Page.click('button:has-text("Submit my vote")');
    await voter2Page.waitForSelector('text=Your vote is recorded');
    const receiptEl2 = await voter2Page.waitForSelector('.receipt');
    const voter2Receipt = (await receiptEl2.textContent())?.trim() ?? '';
    console.log(`✓ Voter 2 voted, receipt: ${voter2Receipt}`);
    results.voter2Voted = true;

    // Voter 3 (Abstain)
    const voter3Context = await browser.newContext();
    const voter3Page = await voter3Context.newPage();
    await voter3Page.goto('http://localhost:3001/vote');
    await voter3Page.fill('input[autoComplete="username"]', 'VOTER3');
    await voter3Page.click('button:has-text("Send me a code")');
    await voter3Page.waitForSelector('text=Demo mode: your code is');
    const otpBanner3 = await voter3Page.textContent('.alert');
    const match3 = otpBanner3?.match(/\b(\d{6})\b/);
    if (!match3) throw new Error('Could not find OTP in banner for Voter 3');
    const code3 = match3[1];
    await voter3Page.fill('input.code-input', code3);
    await voter3Page.click('button:has-text("Sign in")');
    await voter3Page.waitForURL('**/vote/elections');

    await voter3Page.click(`a[href="/vote/elections/${electionId}"]`);
    await voter3Page.waitForURL(`**/vote/elections/${electionId}`);
    // Choose Abstain
    await voter3Page.click('label:has-text("Abstain")');
    await voter3Page.click('button:has-text("Review my ballot")');
    await voter3Page.waitForSelector('text=Check your ballot');
    await voter3Page.click('button:has-text("Submit my vote")');
    await voter3Page.waitForSelector('text=Your vote is recorded');
    console.log('✓ Voter 3 voted (abstained)');
    results.voter3Voted = true;

    console.log('--- Step 6: Receipt Check at /verify ---');
    const verifyContext = await browser.newContext();
    const verifyPage = await verifyContext.newPage();
    await verifyPage.goto('http://localhost:3001/verify');
    await verifyPage.fill('label:has-text("Election ID") input', electionId);
    // Remove dashes from receipt if needed or keep raw
    const cleanReceipt = voter1Receipt.replace(/-/g, '');
    await verifyPage.fill('label:has-text("Receipt code") input', cleanReceipt);
    await verifyPage.click('button:has-text("Check receipt")');
    await verifyPage.waitForSelector('text=Found.');
    console.log('✓ Receipt verified successfully');
    results.receiptVerified = true;

    console.log('--- Step 7: Close and Seal Election ---');
    await adminPage.bringToFront();
    await adminPage.goto(`http://localhost:3001/admin/elections/${electionId}`);
    // Close voting
    await adminPage.click('button:has-text("Close voting")');
    await adminPage.click('button:has-text("Yes, continue")');
    await adminPage.waitForSelector('.chip.CLOSED');
    results.electionClosed = true;
    console.log('✓ Election closed');

    // Seal and publish
    await adminPage.click('button:has-text("Seal and publish results")');
    await adminPage.click('button:has-text("Yes, continue")');
    await adminPage.waitForSelector('.chip.SEALED');
    results.electionSealed = true;
    console.log('✓ Election sealed');

    console.log('--- Step 8: Audit and Independent Verification ---');
    await adminPage.click('button[role="tab"]:has-text("Audit & verification")');
    await adminPage.click('button:has-text("Run verification")');
    await adminPage.waitForSelector('text=recount matches the published result');
    await adminPage.waitForSelector('text=result fingerprint matches');
    await adminPage.waitForSelector('text=audit chain is unbroken');
    results.auditVerificationPassed = true;
    console.log('✓ Verification passed');

    console.log('--- Step 9: Public Results at /results/:id ---');
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`http://localhost:3001/results/${electionId}`);
    await publicPage.waitForSelector('text=Campus Election 2026');
    await publicPage.waitForSelector('text=Alice Johnson');
    await publicPage.waitForSelector('text=Bob Smith');
    results.publicResultsViewed = true;
    console.log('✓ Public results verified');

    console.log('--- Step 10: Observer Account Read-Only Access ---');
    const observerContext = await browser.newContext();
    const observerPage = await observerContext.newPage();
    await observerPage.goto('http://localhost:3001/staff');
    await observerPage.fill('input[type="email"]', observerEmail);
    await observerPage.fill('input[type="password"]', 'observerpass123');
    await observerPage.click('button:has-text("Sign in")');
    await observerPage.waitForURL('**/observer');
    console.log('✓ Observer signed in and redirected to /observer');

    await observerPage.click(`a[href="/observer/elections/${electionId}"]`);
    await observerPage.waitForURL(`**/observer/elections/${electionId}`);

    // Verify read-only: no "Voters" tab
    const votersTab = await observerPage.locator('button[role="tab"]:has-text("Voters")').count();
    const openBtn = await observerPage.locator('button:has-text("Open voting")').count();
    const sealBtn = await observerPage.locator('button:has-text("Seal and publish")').count();
    const deleteBtn = await observerPage.locator('button:has-text("Delete draft")').count();

    if (votersTab === 0 && openBtn === 0 && sealBtn === 0 && deleteBtn === 0) {
      results.observerReadOnlyVerified = true;
      console.log('✓ Observer read-only verified (no Voters tab, no action buttons)');
    } else {
      throw new Error(`Observer has write controls: votersTab=${votersTab}, open=${openBtn}, seal=${sealBtn}, delete=${deleteBtn}`);
    }

  } catch (err) {
    console.error('ERROR during test:', err);
    results.errors.push(String(err));
  } finally {
    await browser.close();
  }

  console.log('\n================ SUMMARY ================');
  console.log(JSON.stringify(results, null, 2));
}

run();
