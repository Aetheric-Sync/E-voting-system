import { chromium } from 'playwright';
import assert from 'node:assert/strict';

async function testStage1() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('1. Sign in as admin');
  await page.goto('http://localhost:3001/staff');
  await page.fill('input[type="email"]', 'admin@uni.test');
  await page.fill('input[type="password"]', 'administrator123');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/admin');

  console.log('2. Create draft election');
  await page.goto('http://localhost:3001/admin/elections/new');
  await page.fill('input[placeholder="Students\' Union Election 2026"]', 'Stage1 Test Election');
  await page.fill('input[placeholder="President"]', 'Position 1');
  await page.fill('input[aria-label="Name 1"]', 'Candidate Alpha');
  await page.fill('input[aria-label="Name 2"]', 'Candidate Beta');
  await page.click('button:has-text("Create draft election")');
  await page.waitForURL((url) => url.pathname.startsWith('/admin/elections/') && url.pathname !== '/admin/elections/new');
  const electionId = page.url().split('/admin/elections/')[1].split('?')[0].replace(/\/$/, '');
  console.log(`Created election ${electionId}`);

  console.log('3. Edit draft election');
  await page.click('a:has-text("Edit draft")');
  await page.waitForURL(`**/admin/elections/${electionId}/edit`);
  await page.fill('input[value="Stage1 Test Election"]', 'Stage1 Test Election (Edited)');
  await page.click('button:has-text("Save changes")');
  await page.waitForURL(`**/admin/elections/${electionId}`);
  await page.waitForSelector('text=Stage1 Test Election (Edited)');
  console.log('✓ Successfully edited draft election');

  console.log('4. Duplicate election');
  await page.click('button:has-text("Duplicate election")');
  await page.waitForURL((url) => url.pathname.startsWith('/admin/elections/') && !url.pathname.includes(electionId));
  const duplicateId = page.url().split('/admin/elections/')[1].split('?')[0].replace(/\/$/, '');
  await page.waitForSelector('text=Stage1 Test Election (Edited) (Copy)');
  const stateChip = await page.textContent('.chip');
  assert.equal(stateChip?.trim(), 'Draft');
  console.log(`✓ Successfully duplicated election to ${duplicateId}`);

  console.log('5. Test voter register pagination');
  await page.goto(`http://localhost:3001/admin/elections/${electionId}`);
  await page.click('button[role="tab"]:has-text("Voters")');
  const sixtyVoters = Array.from({ length: 60 }, (_, i) => `VOTER_${i + 1},Voter ${i + 1},voter${i + 1}@test.local,`).join('\n');
  await page.fill('textarea[aria-label="Voter CSV"]', `id,name,email,phone\n${sixtyVoters}`);
  await page.click('button:has-text("Import voters")');
  await page.waitForSelector('text=Added 60 voters');
  // Check pagination
  await page.waitForSelector('text=Showing 1–50 of 60 voters');
  await page.waitForSelector('text=Page 1 of 2');
  await page.click('button[aria-label="Next page of voters"]');
  await page.waitForSelector('text=Showing 51–60 of 60 voters');
  await page.waitForSelector('text=Page 2 of 2');
  console.log('✓ Successfully tested voter register pagination');

  console.log('6. Test search and filter on /admin');
  await page.goto('http://localhost:3001/admin');
  await page.fill('input[placeholder="Search elections by title…"]', 'Stage1 Test');
  await page.waitForSelector('text=Found');
  await page.selectOption('select[aria-label="Filter elections by state"]', 'DRAFT');
  await page.waitForSelector('text=Stage1 Test Election (Edited)');
  console.log('✓ Successfully tested search and state filter');

  await browser.close();
  console.log('\nALL STAGE 1 CHECKS PASSED!');
}

testStage1().catch(err => {
  console.error('Stage 1 test failed:', err);
  process.exit(1);
});

