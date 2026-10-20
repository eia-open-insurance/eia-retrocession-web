import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'ASSUMED';
const QUEUE_API = '**/api/v1/retrocessions**';

function retrocession(overrides = {}) {
  return {
    id: '22222222-2222-7222-8222-222222222222',
    tenantId: TENANT,
    businessBook: BOOK,
    retrocessionNumber: 'RET-000000001',
    contractId: '33333333-3333-7333-8333-333333333333',
    retroContractId: '44444444-4444-7444-8444-444444444444',
    status: 'OPEN',
    cededPremium: '750000.0000',
    cededLoss: '450000.0000',
    currency: 'USD',
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    fsriHandoffId: null,
    fsriStatus: null,
    fsriHandedOffAt: null,
    fsriLastError: null,
    ...overrides
  };
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

test('renders the shared operational record and sends the ASSUMED book header', async ({ page }) => {
  const books = [];
  const existing = retrocession();

  await page.route(QUEUE_API, async (route) => {
    const request = route.request();
    books.push(request.headers()['x-eia-book']);
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/retrocessions') {
      await json(route, 200, [existing]);
      return;
    }
    await json(route, 404, { message: `unexpected ${request.method()} ${url.pathname}` });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Retrocession', exact: true })).toBeVisible();
  await expect(page.getByText('Reinsurance · Assumed book')).toBeVisible();
  await expect(page.getByTestId('book-header')).toContainText('ASSUMED book');
  await expect(page.locator('.eia-page-head')).toBeVisible();
  await expect(page.locator('.eia-record-layout')).toBeVisible();
  await expect(page.locator('.eia-record-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record RET-000000001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record RET-000000001' })).toContainText(
    'Contract 33333333'
  );
  await expect(page.getByRole('heading', { name: 'RET-000000001' })).toBeVisible();
  await expect(page.getByTestId('retro-status')).toHaveText('OPEN');

  const summaryValues = page.locator('.eia-summary-grid .value');
  await expect(summaryValues).toHaveCount(4);
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('750,000.00 USD');
  await expect(page.getByTestId('summary-ceded-loss')).toHaveText('450,000.00 USD');
  await expect(page.getByTestId('summary-fsri-status')).toHaveText('NOT SENT');
  await expect(page.getByTestId('summary-fsri-handoff')).toHaveText('—');

  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'FS-RI Hand-off' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Status History' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create retrocession' })).toBeVisible();

  expect(books.length).toBeGreaterThan(0);
  expect(books.every((value) => value === BOOK)).toBeTruthy();
});

test('creates a retrocession from the modal against the ASSUMED book', async ({ page }) => {
  let records = [retrocession()];
  let posted = null;
  const books = [];

  await page.route(QUEUE_API, async (route) => {
    const request = route.request();
    books.push(request.headers()['x-eia-book']);
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/retrocessions') {
      await json(route, 200, records);
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/v1/retrocessions') {
      posted = request.postDataJSON();
      const created = retrocession({
        ...posted,
        id: '55555555-5555-7555-8555-555555555555',
        retrocessionNumber: 'RET-000000002'
      });
      records = [created, ...records];
      await json(route, 201, created);
      return;
    }
    await json(route, 404, { message: `unexpected ${request.method()} ${url.pathname}` });
  });
  await page.route('**/api/v1/contracts/search**', async (route) =>
    json(route, 200, {
      query: 'XOL',
      limit: 8,
      items: [
        {
          id: '33333333-3333-7333-8333-333333333333',
          type: 'CONTRACT',
          label: 'XOL-2026-00091',
          secondary: 'EXCESS_OF_LOSS · BOUND',
          status: 'BOUND',
          href: '/contract?record=33333333-3333-7333-8333-333333333333'
        }
      ]
    })
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Create retrocession' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create retrocession' })).toBeVisible();

  await dialog.getByPlaceholder('Search contracts by number or type…').fill('XOL');
  await page.locator('.eia-picker-option').filter({ hasText: 'XOL-2026-00091' }).click();
  await expect(dialog.locator('.eia-picker-selected')).toContainText('XOL-2026-00091');
  await dialog.getByLabel('Retro contract ID').fill('44444444-4444-7444-8444-444444444444');
  await dialog.getByLabel('Ceded premium').fill('1250000');
  await dialog.getByLabel('Ceded loss').fill('500000');
  await dialog.getByLabel('Currency').fill('gbp');
  await dialog.getByRole('button', { name: 'Create retrocession' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'RET-000000002' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('RET-000000002');
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('1,250,000.00 GBP');
  await expect(page.getByTestId('summary-ceded-loss')).toHaveText('500,000.00 GBP');

  expect(posted).toEqual({
    contractId: '33333333-3333-7333-8333-333333333333',
    retroContractId: '44444444-4444-7444-8444-444444444444',
    cededPremium: 1250000,
    cededLoss: 500000,
    currency: 'GBP'
  });
  expect(books.every((value) => value === BOOK)).toBeTruthy();
});

test('hands a RULE_APPLIED case off to FS-RI and shows the acknowledgement', async ({ page }) => {
  let current = retrocession({
    status: 'RULE_APPLIED',
    version: 1,
    updatedAt: '2026-10-19T13:00:00Z'
  });
  let transitionBody = null;
  let transitionHeaders = null;

  await page.route(QUEUE_API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/retrocessions') {
      await json(route, 200, [current]);
      return;
    }
    if (
      request.method() === 'POST' &&
      url.pathname === `/api/v1/retrocessions/${current.id}/transition`
    ) {
      transitionBody = request.postDataJSON();
      transitionHeaders = request.headers();
      current = retrocession({
        status: 'HANDED_OFF',
        version: 2,
        updatedAt: '2026-10-19T13:05:00Z',
        fsriHandoffId: 'FSRI-HO-000001',
        fsriStatus: 'ACCEPTED',
        fsriHandedOffAt: '2026-10-19T13:05:00Z'
      });
      await json(route, 200, current);
      return;
    }
    await json(route, 404, { message: `unexpected ${request.method()} ${url.pathname}` });
  });

  await page.goto('/');
  await expect(page.getByTestId('retro-status')).toHaveText('RULE_APPLIED');
  await page.getByRole('button', { name: 'Hand off to FS-RI' }).click();

  await expect(page.getByTestId('retro-status')).toHaveText('HANDED_OFF');
  await expect(page.getByTestId('summary-fsri-status')).toHaveText('ACCEPTED');
  await expect(page.getByTestId('summary-fsri-handoff')).toHaveText('FSRI-HO-000001');
  await expect(page.getByRole('status')).toContainText('HANDED_OFF');

  expect(transitionBody).toEqual({ targetStatus: 'HANDOFF_PENDING' });
  expect(transitionHeaders['x-eia-book']).toBe(BOOK);

  await page.getByRole('tab', { name: 'FS-RI Hand-off' }).click();
  await expect(page.getByTestId('fsri-handoff-id')).toHaveText('FSRI-HO-000001');
  await expect(page.getByRole('tabpanel')).toContainText('ACCEPTED');

  await page.getByRole('tab', { name: 'Status History' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('FS-RI hand-off acknowledged');
  await expect(page.getByRole('tabpanel')).toContainText('FSRI-HO-000001');
});

test('applies the retro rule and sends the FS-RI contract number from the hand-off tab', async ({
  page
}) => {
  let current = retrocession();
  const bodies = [];

  await page.route(QUEUE_API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/retrocessions') {
      await json(route, 200, [current]);
      return;
    }
    if (
      request.method() === 'POST' &&
      url.pathname === `/api/v1/retrocessions/${current.id}/transition`
    ) {
      const body = request.postDataJSON();
      bodies.push(body);
      if (body.targetStatus === 'RULE_APPLIED') {
        current = retrocession({
          status: 'RULE_APPLIED',
          version: 1,
          updatedAt: '2026-10-19T13:10:00Z'
        });
      } else {
        current = retrocession({
          status: 'HANDED_OFF',
          version: 2,
          updatedAt: '2026-10-19T13:15:00Z',
          fsriHandoffId: 'FSRI-HO-000002',
          fsriStatus: 'ACCEPTED',
          fsriHandedOffAt: '2026-10-19T13:15:00Z'
        });
      }
      await json(route, 200, current);
      return;
    }
    await json(route, 404, { message: `unexpected ${request.method()} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Apply retro rule' }).click();
  await expect(page.getByTestId('retro-status')).toHaveText('RULE_APPLIED');

  await page.getByRole('tab', { name: 'FS-RI Hand-off' }).click();
  await page.getByLabel('FS-RI contract number (optional)').fill('xol-2025-00091');
  await page.getByRole('button', { name: 'Send hand-off' }).click();

  await expect(page.getByTestId('retro-status')).toHaveText('HANDED_OFF');
  await expect(page.getByRole('status')).toContainText('HANDED_OFF');
  expect(bodies).toEqual([
    { targetStatus: 'RULE_APPLIED' },
    { targetStatus: 'HANDOFF_PENDING', fsriContractNumber: 'XOL-2025-00091' }
  ]);
});

test('renders a problem+json hand-off failure and leaves the case retryable', async ({ page }) => {
  const current = retrocession({ status: 'RULE_APPLIED', version: 1 });

  await page.route(QUEUE_API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/retrocessions') {
      await json(route, 200, [current]);
      return;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/transition')) {
      await route.fulfill({
        status: 502,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.eia-open-insurance.example/retrocession/fsri-unavailable',
          title: 'FS-RI hand-off failed',
          status: 502,
          detail: 'SAP FS-RI rejected the retro hand-off and the case remains retryable.',
          code: 'FSRI_REJECTED',
          errors: [
            {
              field: 'fsriContractNumber',
              code: 'FSRI_REJECTED',
              message: 'contract not found'
            }
          ]
        })
      });
      return;
    }
    await json(route, 404, { message: `unexpected ${request.method()} ${url.pathname}` });
  });

  await page.goto('/');
  await expect(page.getByTestId('retro-status')).toHaveText('RULE_APPLIED');
  await page.getByRole('button', { name: 'Hand off to FS-RI' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('SAP FS-RI rejected the retro hand-off');
  await expect(alert).toContainText('fsriContractNumber: contract not found');
  await expect(page.getByTestId('retro-status')).toHaveText('RULE_APPLIED');
  await expect(page.getByRole('button', { name: 'Hand off to FS-RI' })).toBeEnabled();
});
