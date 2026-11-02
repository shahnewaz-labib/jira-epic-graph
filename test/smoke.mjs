// Loads the unpacked extension against a fake Jira site and checks the panel.
// Usage: npm test            (SCREENSHOT=1 also writes docs/screenshot.png)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';

const ext = path.resolve(import.meta.dirname, '../extension');
const SITE = 'https://demo.atlassian.net';

// Made-up epic: DEMO-1 "Checkout redesign"
const t = (key, summary, cat, blocks = [], extra = {}) => ({
  key,
  fields: {
    summary, updated: '2026-11-01T10:00:00.000+0000',
    status: { name: { done: 'Done', indeterminate: 'In Progress', new: 'To Do' }[cat], statusCategory: { key: cat } },
    issuetype: { name: 'Task' }, priority: { name: 'Medium' },
    assignee: extra.assignee ? { displayName: extra.assignee } : null,
    customfield_10020: [{ name: extra.sprint ?? 'Sprint 12' }],
    issuelinks: blocks.map(k => ({ type: { outward: 'blocks' }, outwardIssue: { key: k } })),
  },
});
const ISSUES = [
  t('DEMO-2', '[api] Add the cart totals endpoint', 'done', ['DEMO-4', 'DEMO-5'], { assignee: 'Ada' }),
  t('DEMO-3', '[api] Add the payment intents table', 'done', ['DEMO-5'], { assignee: 'Linus' }),
  t('DEMO-4', '[web] Show totals on the cart page', 'indeterminate', ['DEMO-7'], { assignee: 'Grace' }),
  t('DEMO-5', '[api] Add the endpoint to confirm a payment', 'new', ['DEMO-6', 'DEMO-7']),
  t('DEMO-6', '[web] Add the payment step', 'new', ['DEMO-8']),
  t('DEMO-7', '[web] Add the order summary', 'new', ['DEMO-8'], { assignee: 'Grace' }),
  t('DEMO-8', '[web] Remove the old checkout', 'new', [], { sprint: 'Backlog' }),
  t('DEMO-9', '[ops] Add a payment failure alert', 'new', [], { assignee: 'Linus' }),
];

const ctx = await chromium.launchPersistentContext('', {
  executablePath: process.env.CHROME_PATH, channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1500, height: 1000 },
});
const hosts = new Set();
ctx.on('request', r => { const u = new URL(r.url()); if (u.protocol.startsWith('http')) hosts.add(u.host); });
await ctx.route(`${SITE}/**`, r => {
  const u = r.request().url();
  const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
  if (u.includes('/rest/api/3/issue/')) return json({ fields: { summary: 'Checkout redesign', status: { name: 'In Progress' }, issuetype: { name: 'Epic', hierarchyLevel: 1 } } });
  if (u.endsWith('/rest/api/3/field')) return json([{ id: 'customfield_10020', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } }]);
  if (u.includes('/rest/api/3/search/jql')) return json({ issues: ISSUES });
  return r.fulfill({ contentType: 'text/html', body: '<h2>Jira</h2>' });
});

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`${SITE}/browse/DEMO-1`);

// Same call background.js makes on a toolbar click; headless Chrome cannot click the icon.
const click = () => sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['graph.js'] });
});
const panel = () => page.evaluate(() => {
  const s = document.body.lastElementChild.shadowRoot;
  return s && { cards: s.querySelectorAll('.card').length, ready: [...s.querySelectorAll('.card.ready')].map(c => c.dataset.k).sort() };
});

// A stale global from an older injected copy must not hijack the click.
await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__epicGraph = () => {}; } });
});
await click();
await page.locator('.card').first().waitFor();
await page.waitForTimeout(300);
assert.deepEqual(await panel(), { cards: 8, ready: ['DEMO-5', 'DEMO-9'] });
// Done cards are greyed with solid colours, not opacity, so arrows do not show through.
const look = await page.evaluate(() => Object.fromEntries(['DEMO-2', 'DEMO-6'].map(k => {
  const cs = getComputedStyle(document.body.lastElementChild.shadowRoot.querySelector(`.card[data-k="${k}"]`));
  return [k, [cs.backgroundColor, cs.opacity]];
})));
assert.deepEqual(look, { 'DEMO-2': ['rgb(244, 245, 247)', '1'], 'DEMO-6': ['rgb(255, 255, 255)', '1'] });
const blocks = await page.evaluate(() => Object.fromEntries([...document.body.lastElementChild.shadowRoot.querySelectorAll('.card')]
  .map(c => [c.dataset.k, c.querySelector('.bk')?.textContent ?? null])));
assert.deepEqual(blocks, { 'DEMO-2': null, 'DEMO-3': null, 'DEMO-4': 'blocks 2', 'DEMO-5': 'blocks 3', 'DEMO-6': 'blocks 1', 'DEMO-7': 'blocks 1', 'DEMO-8': null, 'DEMO-9': null });

await page.locator('.card[data-k="DEMO-5"]').hover();
const chain = await page.evaluate(() => {
  const s = document.body.lastElementChild.shadowRoot;
  const keys = c => [...s.querySelectorAll(`.card.${c}`)].map(e => e.dataset.k).sort();
  return { up: keys('up'), down: keys('down') };
});
assert.deepEqual(chain, { up: ['DEMO-2', 'DEMO-3'], down: ['DEMO-6', 'DEMO-7', 'DEMO-8'] });
if (process.env.SCREENSHOT) await page.screenshot({ path: path.resolve(import.meta.dirname, '../docs/screenshot.png') });
await page.mouse.move(5, 5);

await click();
assert.equal(await panel(), null, 'second click closes the panel');

assert.deepEqual(errors, []);
assert.deepEqual([...hosts].filter(h => h !== 'demo.atlassian.net'), [], 'no request leaves the Jira site');
await ctx.close();
console.log('ok');
