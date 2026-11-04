import { chromium } from 'playwright';

async function audit() {
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile-375', width: 375, height: 667 },
  ];

  const issues = [];

  for (const vp of viewports) {
    console.log(`\nAuditing viewport: ${vp.name} (${vp.width}x${vp.height})`);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    // 1. Staff sign-in /staff
    await page.goto('http://localhost:3001/staff');
    await checkPage(page, vp, '/staff', issues);

    // Sign in as admin
    await page.fill('input[type="email"]', 'admin@uni.test');
    await page.fill('input[type="password"]', 'administrator123');
    await page.click('button:has-text("Sign in")');
    await page.waitForURL('**/admin');

    // 2. /admin
    await checkPage(page, vp, '/admin', issues);

    // 3. /admin/elections/new
    await page.goto('http://localhost:3001/admin/elections/new');
    await checkPage(page, vp, '/admin/elections/new', issues);

    // 4. /admin/users
    await page.goto('http://localhost:3001/admin/users');
    await checkPage(page, vp, '/admin/users', issues);

    // Get an election id to check
    await page.goto('http://localhost:3001/admin');
    const firstElectionLink = await page.locator('a.card.link').first();
    let electionHref = await firstElectionLink.getAttribute('href');
    if (electionHref) {
      await page.goto(`http://localhost:3001${electionHref}`);
      // Check tabs
      const tabs = ['overview', 'voters', 'ballot', 'results', 'audit'];
      for (const t of tabs) {
        const tabBtn = page.locator(`button[role="tab"]:has-text("${t === 'audit' ? 'Audit' : t.charAt(0).toUpperCase() + t.slice(1)}")`);
        if (await tabBtn.count() > 0) {
          await tabBtn.click();
          await page.waitForTimeout(300);
          await checkPage(page, vp, `${electionHref} [tab=${t}]`, issues);
        }
      }
    }

    // 5. /verify
    await page.goto('http://localhost:3001/verify');
    await checkPage(page, vp, '/verify', issues);

    // 6. /results
    await page.goto('http://localhost:3001/results');
    await checkPage(page, vp, '/results', issues);

    // 7. /results/:id
    const resLink = page.locator('a.card.link').first();
    if (await resLink.count() > 0) {
      const resHref = await resLink.getAttribute('href');
      if (resHref) {
        await page.goto(`http://localhost:3001${resHref}`);
        await checkPage(page, vp, resHref, issues);
      }
    }

    // 8. /vote
    const voterContext = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const voterPage = await voterContext.newPage();
    await voterPage.goto('http://localhost:3001/vote');
    await checkPage(voterPage, vp, '/vote (id step)', issues);

    await voterPage.fill('input[autoComplete="username"]', 'VOTER1');
    await voterPage.click('button:has-text("Send me a code")');
    await voterPage.waitForSelector('text=Demo mode: your code is');
    await checkPage(voterPage, vp, '/vote (otp step)', issues);

    const banner = await voterPage.textContent('.alert');
    const match = banner?.match(/\b(\d{6})\b/);
    if (match) {
      await voterPage.fill('input.code-input', match[1]);
      await voterPage.click('button:has-text("Sign in")');
      await voterPage.waitForURL('**/vote/elections');
      await checkPage(voterPage, vp, '/vote/elections', issues);
    }

    // 9. Observer
    const observerContext = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const obsPage = await observerContext.newPage();
    await obsPage.goto('http://localhost:3001/staff');
    await obsPage.fill('input[type="email"]', 'observer@uni.test');
    await obsPage.fill('input[type="password"]', 'observerpass123');
    await obsPage.click('button:has-text("Sign in")');
    await obsPage.waitForURL('**/observer');
    await checkPage(obsPage, vp, '/observer', issues);

    await context.close();
    await voterContext.close();
    await observerContext.close();
  }

  await browser.close();

  console.log('\n--- DETECTED ISSUES ---');
  if (issues.length === 0) {
    console.log('No layout or a11y issues detected automatically.');
  } else {
    for (const iss of issues) {
      console.log(`[${iss.viewport}] ${iss.path}: ${iss.type} - ${iss.message}`);
    }
  }
}

async function checkPage(page, vp, path, issues) {
  // Check horizontal overflow
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  if (overflow) {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    issues.push({
      viewport: vp.name,
      path,
      type: 'HORIZONTAL_OVERFLOW',
      message: `Page has horizontal overflow: scrollWidth=${scrollWidth}px > viewport=${vp.width}px`,
    });
  }

  // Check form inputs without labels or aria-label
  const unlabelled = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'));
    const bad = [];
    for (const el of inputs) {
      const hasAriaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      const hasParentLabel = el.closest('label');
      const hasIdWithLabel = el.id && document.querySelector(`label[for="${el.id}"]`);
      if (!hasAriaLabel && !hasParentLabel && !hasIdWithLabel) {
        bad.push(el.outerHTML.slice(0, 80));
      }
    }
    return bad;
  });
  if (unlabelled.length > 0) {
    issues.push({
      viewport: vp.name,
      path,
      type: 'UNLABELLED_INPUTS',
      message: `${unlabelled.length} inputs without label/aria: ${unlabelled.join('; ')}`,
    });
  }

  // Check buttons without text or aria-label
  const unlabelledBtns = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const bad = [];
    for (const b of btns) {
      const text = b.textContent?.trim();
      const aria = b.getAttribute('aria-label');
      if (!text && !aria) {
        bad.push(b.outerHTML.slice(0, 80));
      }
    }
    return bad;
  });
  if (unlabelledBtns.length > 0) {
    issues.push({
      viewport: vp.name,
      path,
      type: 'UNLABELLED_BUTTONS',
      message: `${unlabelledBtns.length} buttons without text/aria: ${unlabelledBtns.join('; ')}`,
    });
  }
}

audit();
