import { expect, type Page } from '@playwright/test';

export const ADMIN_CREDENTIALS = {
  email: 'admin@uni.test',
  password: 'administrator123',
};

export async function adminLogin(page: Page, email = ADMIN_CREDENTIALS.email, password = ADMIN_CREDENTIALS.password) {
  await page.goto('/staff');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(url => url.pathname.startsWith('/admin') && !url.pathname.includes('/staff'));
}

export async function createElectionViaUi(
  page: Page,
  title: string,
  options?: {
    withRanked?: boolean;
    rankedTitle?: string;
  },
): Promise<string> {
  await page.goto('/admin/elections/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.locator('label:has-text("Description") textarea').fill(`E2E automated test election for ${title}`);

  // Position 1 (Default Single Choice)
  const pos1 = page.locator('fieldset.card').nth(0);
  await pos1.locator('label:has-text("Position title") input').fill('President');
  await pos1.locator('input[aria-label="Name 1"]').fill('Candidate Alpha');
  await pos1.locator('input[aria-label="Name 2"]').fill('Candidate Beta');

  if (options?.withRanked) {
    await page.click('button:has-text("+ Add another position")');
    const pos2 = page.locator('fieldset.card').nth(1);
    await pos2.locator('label:has-text("Position title") input').fill(options.rankedTitle ?? 'Vice President');
    await pos2.locator('select').selectOption('RANKED');
    await pos2.locator('input[aria-label="Name 1"]').fill('Ranked Candidate 1');
    await pos2.locator('input[aria-label="Name 2"]').fill('Ranked Candidate 2');
    await pos2.locator('button:has-text("+ Add candidate")').click();
    await pos2.locator('input[aria-label="Name 3"]').fill('Ranked Candidate 3');
  }

  await page.click('button:has-text("Create draft election")');
  await page.waitForURL(url => url.pathname.startsWith('/admin/elections/') && url.pathname !== '/admin/elections/new');
  const url = page.url();
  const id = url.split('/admin/elections/')[1].split(/[?#]/)[0].replace(/\/$/, '');
  return id;
}

export async function importVotersViaUi(
  page: Page,
  electionId: string,
  voters: Array<{ id: string; name: string; email?: string; phone?: string }>,
) {
  await page.goto(`/admin/elections/${electionId}`);
  await page.click('button[role="tab"]:has-text("Voters")');
  const csvLines = ['id,name,email,phone'];
  for (const v of voters) {
    csvLines.push(`${v.id},${v.name},${v.email ?? ''},${v.phone ?? ''}`);
  }
  await page.fill('textarea[aria-label="Voter CSV"]', csvLines.join('\n'));
  await page.click('button:has-text("Import voters")');
  await page.waitForSelector(`text=Added ${voters.length} voter`);
}

export async function voterLogin(page: Page, voterId: string) {
  await page.goto('/vote');
  await page.locator('label:has-text("Matric / voter number") input').fill(voterId);
  await page.click('button:has-text("Send me a code")');
  await page.waitForSelector('text=Demo mode: your code is');
  const otpBanner = await page.locator('text=Demo mode: your code is').textContent();
  const match = otpBanner?.match(/\d{6}/);
  if (!match) throw new Error('Could not find demo OTP on voter login page');
  const otp = match[0];
  await page.locator('input.code-input').fill(otp);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('**/vote/elections');
}

