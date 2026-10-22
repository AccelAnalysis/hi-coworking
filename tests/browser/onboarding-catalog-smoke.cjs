/* Local mocked smoke only. Never sends payments, emails, or production API requests.
 * Start Next locally on 127.0.0.1:3100 with demo Firebase configuration first.
 * CI installs pinned Playwright in a temporary prefix; repository dependencies stay unchanged.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const ORIGIN = 'http://127.0.0.1:3100';
const ARTIFACTS = process.env.BROWSER_ARTIFACT_DIR || '/tmp/onboarding-browser';
const setup = { id: 'test-room', name: 'Workshop layout', serviceType: 'CONFERENCE', resourceId: 'mode-conference', capacity: 10, description: 'Published test setup', arrangement: 'Boardroom', addOnIds: ['projector'], layoutPath: 'locations/test/floors/test/layouts/test', published: true };

function bounded(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30_000); })]).finally(() => clearTimeout(timer));
}

function quote(data) {
  const extra = data.addOnIds?.includes('projector');
  return { resourceId: 'mode-conference', resourceName: 'Conference room', resourceType: 'MODE', bookingKind: 'single', durationHours: 2, membershipName: null, includedHoursRemaining: 0, includedHoursApplied: 0, billableHours: 2, hourlyRateCents: 5000, subtotalCents: 10000 + (extra ? 2500 : 0), spaceSubtotalCents: 10000, accountCreditAvailableCents: 0, accountCreditAppliedCents: 0, totalCents: 10000 + (extra ? 2500 : 0), dailyCapApplied: false, currency: 'USD', setup, attendeeCount: data.attendeeCount || 1, addOns: extra ? [{ id: 'projector', name: 'Projector', priceCents: 2500 }] : [], addOnTotalCents: extra ? 2500 : 0 };
}

async function runViewport(browser, name, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const calls = [];
  const failures = [];
  const blocked = [];
  let releaseQuote;
  let delayedQuoteSeen;
  let delayNextQuote = false;
  page.on('pageerror', (error) => failures.push(error.message));
  // Exact origin equality, not startsWith: localhost-lookalike domains cannot escape.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) return route.continue();
    const fn = url.pathname.split('/').pop();
    const headers = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let data = {};
    try { data = route.request().postDataJSON()?.data || {}; } catch { /* Non-callable external requests stay blocked. */ }
    let result;
    if (fn === 'space_getPublishedCatalog') result = { setups: [setup], addOns: [{ id: 'projector', name: 'Projector', priceCents: 2500, serviceTypes: ['CONFERENCE'], published: true }] };
    if (fn === 'booking_getDaySchedule') result = { date: data.date, timeZone: 'America/New_York', isOpen: true, intervals: [{ startTime: '08:00', endTime: '20:00' }], hasException: false };
    if (fn === 'booking_getAvailability') result = { start: data.start, end: data.end, options: [{ resourceId: 'mode-conference', name: 'Conference room', type: 'MODE', available: true }], deskChangeOptions: [] };
    if (fn === 'booking_createQuote') {
      calls.push(data);
      if (delayNextQuote) {
        delayNextQuote = false;
        await new Promise((resolve) => { releaseQuote = resolve; delayedQuoteSeen(); });
      }
      result = quote(data);
    }
    if (result) return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ result }) });
    blocked.push({ origin: url.origin, path: url.pathname });
    return route.abort();
  });
  // Service workers are disabled, and non-local WebSockets are blocked as well.
  await context.routeWebSocket('**/*', (socket) => {
    const url = new URL(socket.url());
    if (url.hostname === '127.0.0.1' && url.port === '3100') socket.connectToServer();
    else socket.close();
  });

  try {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.goto(`${ORIGIN}/book?date=${tomorrow}`);
    await page.getByRole('button', { name: /^Meeting room Check/ }).click();
    await page.getByLabel('Published setup (optional)').selectOption('test-room');
    await page.getByLabel(/^Start/).selectOption('08:00');
    await page.getByRole('button', { name: 'Check meeting room', exact: true }).click();
    await page.getByRole('button', { name: 'Review meeting room', exact: true }).waitFor();
    assert.equal(calls.at(-1).setupId, 'test-room');

    // A response from a previous selected time must not restore a stale quote/review.
    delayNextQuote = true;
    const quoteStarted = new Promise((resolve) => { delayedQuoteSeen = resolve; });
    await page.getByRole('checkbox', { name: /Projector/ }).check();
    await bounded(quoteStarted, "Delayed quote request");
    await page.getByLabel(/^Start/).selectOption('10:00');
    const oldResponse = page.waitForResponse((response) => response.url().endsWith('/booking_createQuote'));
    releaseQuote();
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('button', { name: 'Review meeting room', exact: true }).count(), 0, 'Stale quote restored review after time changed');

    await page.getByRole('button', { name: 'Check meeting room', exact: true }).click();
    await page.getByRole('button', { name: 'Review meeting room', exact: true }).waitFor();
    await page.getByLabel('People (maximum 10)').selectOption('3');
    await page.getByRole('button', { name: 'Review meeting room', exact: true }).click();
    await page.getByRole('button', { name: 'Pay $125.00', exact: true }).waitFor();
    assert.equal(calls.at(-1).attendeeCount, 3);
    assert.deepEqual(calls.at(-1).addOnIds, ['projector']);
    assert(!('priceCents' in calls.at(-1)), 'Client sent catalog prices instead of identifiers');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name}: horizontal overflow`);
    await page.screenshot({ path: path.join(ARTIFACTS, `catalog-${name}.png`), fullPage: true });

    // Auth cross-links and browser history retain exact purchase intent; no auth submission.
    const next = '/pricing?tier=coworking&interval=year';
    await page.goto(`${ORIGIN}/register?next=${encodeURIComponent(next)}`);
    await page.waitForFunction((expected) => Array.from(document.querySelectorAll('a')).some((anchor) => anchor.pathname === '/login' && new URL(anchor.href).searchParams.get('next') === expected), next);
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/login?**');
    assert.equal(new URL(page.url()).searchParams.get('next'), next);
    await page.waitForFunction((expected) => Array.from(document.querySelectorAll('a')).some((anchor) => anchor.pathname === '/register' && new URL(anchor.href).searchParams.get('next') === expected), next);
    await page.getByRole('link', { name: 'Sign up', exact: true }).click();
    await page.waitForURL('**/register?**');
    assert.equal(new URL(page.url()).searchParams.get('next'), next);
    await page.goBack();
    await page.getByRole('link', { name: 'Sign up', exact: true }).waitFor();
    assert.equal(new URL(await page.getByRole('link', { name: 'Sign up', exact: true }).getAttribute('href'), ORIGIN).searchParams.get('next'), next);
    assert.deepEqual(failures, [], `${name}: uncaught browser errors`);
    assert(!blocked.some(({ path: value }) => /booking_beginCheckout|sendOobCode|createCheckoutSession/.test(value)), 'Unexpected payment or mail operation attempted');
    return { viewport: name, quoteCalls: calls.length, checks: ['catalog identifiers', 'stale quote rejected', 'attendees', 'server amount', 'no horizontal overflow', 'auth next/back preserved', 'no page errors'], blockedExternalRequests: blocked.length };
  } catch (error) {
    await page.screenshot({ path: path.join(ARTIFACTS, `failure-${name}.png`), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(ARTIFACTS, `failure-${name}.html`), await page.content()).catch(() => {});
    throw error;
  } finally {
    releaseQuote?.();
    await context.close();
  }
}

(async () => {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    const results = [];
    for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) results.push(await runViewport(browser, name, viewport));
    await fs.writeFile(path.join(ARTIFACTS, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
