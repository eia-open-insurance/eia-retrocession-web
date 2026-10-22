import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'ASSUMED';

const CONTRACT_A = {
  id: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
  tenantId: TENANT,
  contractNumber: 'XOL-2026-00091',
  contractType: 'EXCESS_OF_LOSS',
  status: 'BOUND',
  currency: 'USD'
};

const CONTRACT_B = {
  id: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
  tenantId: TENANT,
  contractNumber: 'QS-2026-00042',
  contractType: 'QUOTA_SHARE',
  status: 'PLACED',
  currency: 'USD'
};

const CONTRACTS = [CONTRACT_A, CONTRACT_B];

function retrocession(overrides = {}) {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    tenantId: TENANT,
    businessBook: BOOK,
    retrocessionNumber: 'RET-2026-0001',
    contractId: CONTRACT_A.id,
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

const RETRO_A = retrocession({
  id: 'aaaaaaaa-1111-7111-8111-111111111111',
  retrocessionNumber: 'RET-2026-0001'
});

const RETRO_B = retrocession({
  id: 'bbbbbbbb-1111-7111-8111-111111111111',
  retrocessionNumber: 'RET-2026-0002',
  contractId: CONTRACT_B.id,
  status: 'CONFIRMED',
  updatedAt: '2026-10-19T13:00:00Z'
});

const RETRO_C = retrocession({
  id: 'cccccccc-1111-7111-8111-111111111111',
  retrocessionNumber: 'RET-2026-0003',
  status: 'HANDOFF_PENDING',
  updatedAt: '2026-10-19T14:00:00Z'
});

const ASSUMED_CLAIMS = [
  {
    id: 'claim-1',
    type: 'ASSUMED_CLAIM',
    label: 'AC-2026-0001',
    secondary: 'CED-77 · OPEN',
    status: 'OPEN',
    href: '/assumed-claims?record=claim-1'
  }
];

function contractItem(contract) {
  return {
    id: contract.id,
    type: 'CONTRACT',
    label: contract.contractNumber,
    secondary: `${contract.contractType} · ${contract.status}`,
    status: contract.status,
    href: `/contract?record=${contract.id}`
  };
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function mockWorkspace(page, options = {}) {
  const state = {
    records: options.records || [RETRO_A, RETRO_B, RETRO_C],
    contractSearches: [],
    assumedSearches: [],
    posts: []
  };

  await page.route('**/api/v1/contracts**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/contracts/search') {
      const term = (url.searchParams.get('q') || '').toLowerCase();
      state.contractSearches.push({
        url: request.url(),
        book: request.headers()['x-eia-book']
      });
      const items = CONTRACTS
        .filter((contract) => [contract.contractNumber, contract.contractType]
          .some((value) => value.toLowerCase().includes(term)))
        .map(contractItem);
      await json(route, 200, {
        query: url.searchParams.get('q') || '',
        limit: Number(url.searchParams.get('limit') || 10),
        items
      });
      return;
    }
    const contract = CONTRACTS.find((item) => url.pathname === `/api/v1/contracts/${item.id}`);
    if (contract) {
      await json(route, 200, contract);
      return;
    }
    await json(route, 404, { message: `unexpected ${request.method()} ${url.pathname}` });
  });

  await page.route('**/api/v1/assumed-claims/search**', async (route) => {
    const request = route.request();
    state.assumedSearches.push({
      url: request.url(),
      book: request.headers()['x-eia-book']
    });
    await json(route, 200, {
      query: new URL(request.url()).searchParams.get('q') || '',
      limit: 5,
      items: ASSUMED_CLAIMS
    });
  });

  // Discovery tests are not about the Overview notifications card; keep the
  // selection-time lookup local and empty so the suite never reaches the proxy.
  await page.route('**/api/v1/notifications**', async (route) => {
    await json(route, 200, { items: [] });
  });

  await page.route('**/api/v1/retrocessions**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/retrocessions') {
      await json(route, 200, state.records);
      return;
    }
    if (request.method() === 'GET') {
      const discoverable = [RETRO_A, RETRO_B, RETRO_C]
        .find((record) => url.pathname === `/api/v1/retrocessions/${record.id}`);
      if (discoverable) {
        await json(route, 200, discoverable);
        return;
      }
    }
    if (request.method() === 'POST' && url.pathname === '/api/v1/retrocessions') {
      const posted = request.postDataJSON();
      const created = retrocession({
        ...posted,
        id: 'dddddddd-1111-7111-8111-111111111111',
        retrocessionNumber: 'RET-2026-0009'
      });
      state.posts.push(posted);
      state.records = [created, ...state.records];
      await json(route, 201, created);
      return;
    }
    await json(route, 404, { message: `unexpected ${request.method()} ${url.pathname}` });
  });

  return state;
}

test('opens a retrocession directly from the record URL and follows popstate', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto(`/?record=${RETRO_B.id}`);

  const panel = page.locator('.eia-record-panel');
  await expect(panel.getByRole('heading', { name: RETRO_B.retrocessionNumber })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${RETRO_B.id}$`));

  await page.locator('.eia-record-list button').filter({ hasText: RETRO_A.retrocessionNumber }).click();
  await expect(panel.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${RETRO_A.id}$`));

  await page.goBack();
  await expect(panel.getByRole('heading', { name: RETRO_B.retrocessionNumber })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${RETRO_B.id}$`));
});

test('discovers a record from the URL when it is outside the loaded queue', async ({ page }) => {
  await mockWorkspace(page, { records: [RETRO_A] });
  await page.goto(`/?record=${RETRO_B.id}`);

  const panel = page.locator('.eia-record-panel');
  await expect(panel.getByRole('heading', { name: RETRO_B.retrocessionNumber })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${RETRO_B.id}$`));
  await expect(page.locator('.eia-record-list button').filter({ hasText: RETRO_B.retrocessionNumber }))
    .toBeVisible();
});

test('opens the create form from ?new=1 and keeps the URL in step', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto('/?new=1');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create retrocession' })).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/new=1/);

  await page.getByRole('button', { name: 'Create retrocession' }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/new=1/);
});

test('filters the queue by number, contract, and status with a clear action', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto('/');

  const filter = page.getByPlaceholder('Filter retrocessions by number, contract, or status…');
  const queue = page.locator('.eia-record-list');
  const retroA = queue.locator('button').filter({ hasText: RETRO_A.retrocessionNumber });
  const retroB = queue.locator('button').filter({ hasText: RETRO_B.retrocessionNumber });
  const retroC = queue.locator('button').filter({ hasText: RETRO_C.retrocessionNumber });

  await expect(filter).toBeVisible();
  await expect(retroA).toBeVisible();
  await expect(retroB).toBeVisible();
  await expect(retroC).toBeVisible();

  await filter.fill('RET-2026-0002');
  await expect(retroB).toBeVisible();
  await expect(retroA).toHaveCount(0);
  await expect(page.getByTestId('queue-filter-count')).toHaveText('1 of 3 retrocessions');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(retroA).toBeVisible();
  await expect(retroB).toBeVisible();

  await filter.fill('CONFIRMED');
  await expect(retroB).toBeVisible();
  await expect(retroA).toHaveCount(0);

  await filter.fill('aaaaaaaa');
  await expect(retroA).toBeVisible();
  await expect(retroC).toBeVisible();
  await expect(retroB).toHaveCount(0);
  await expect(page.getByTestId('queue-filter-count')).toHaveText('2 of 3 retrocessions');

  await filter.fill('no-such-retro');
  await expect(page.getByTestId('queue-filter-empty')).toBeVisible();
  await expect(page.getByTestId('queue-filter-count')).toHaveText('0 of 3 retrocessions');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(retroA).toBeVisible();
  await expect(retroB).toBeVisible();
  await expect(retroC).toBeVisible();
});

test('picks the source contract predictively and posts its ASSUMED-book id', async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto('/?new=1');

  const dialog = page.getByRole('dialog');
  const picker = dialog.getByPlaceholder('Search contracts by number or type…');
  await expect(picker).toBeVisible();

  await picker.fill('XOL');
  await page.locator('.eia-picker-option').filter({ hasText: CONTRACT_A.contractNumber }).click();
  await expect(dialog.locator('.eia-picker-selected')).toContainText(CONTRACT_A.contractNumber);
  await expect(page.getByTestId('create-contract-link')).toHaveAttribute(
    'href',
    `/contract?record=${CONTRACT_A.id}`
  );

  await dialog.getByLabel('Retro contract ID').fill('44444444-4444-7444-8444-444444444444');
  await dialog.getByLabel('Ceded premium').fill('1250000');
  await dialog.getByLabel('Ceded loss').fill('500000');
  await dialog.getByLabel('Currency').fill('usd');
  await dialog.getByRole('button', { name: 'Create retrocession' }).click();

  await expect(dialog).toBeHidden();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toMatchObject({
    contractId: CONTRACT_A.id,
    retroContractId: '44444444-4444-7444-8444-444444444444',
    cededPremium: 1250000,
    cededLoss: 500000,
    currency: 'USD'
  });

  expect(state.contractSearches.length).toBeGreaterThan(0);
  const search = state.contractSearches[0];
  expect(search.url).toContain('/api/v1/contracts/search?q=XOL&limit=8');
  expect(search.book).toBe(BOOK);
});

test('shows the assumed-contract context panel and cross-links to upstream records', async ({ page }) => {
  const state = await mockWorkspace(page);
  await page.goto(`/?record=${RETRO_A.id}`);

  const context = page.getByTestId('why-this-matters');
  await expect(context).toContainText('This retrocession sits behind the assumed contract');
  await expect(context).toContainText('contract and its assumed claims are upstream');
  await expect(context).toContainText('FS-RI-owned');

  await expect(page.getByTestId('source-contract-link')).toHaveText(CONTRACT_A.contractNumber);
  await expect(page.getByTestId('source-contract-link')).toHaveAttribute(
    'href',
    `/contract?record=${CONTRACT_A.id}`
  );
  await expect(page.getByTestId('context-contract-link')).toHaveAttribute(
    'href',
    `/contract?record=${CONTRACT_A.id}`
  );

  const relatedContract = page.getByTestId('related-contract');
  await expect(relatedContract.getByRole('link')).toHaveAttribute(
    'href',
    `/contract?record=${CONTRACT_A.id}`
  );

  const relatedClaims = page.getByTestId('related-assumed-claims');
  await expect(relatedClaims.getByRole('link', { name: /AC-2026-0001/ })).toHaveAttribute(
    'href',
    '/assumed-claims?record=claim-1'
  );

  await expect.poll(() => state.assumedSearches.length).toBeGreaterThan(0);
  const claimSearch = state.assumedSearches[0];
  expect(claimSearch.url).toContain(
    `/api/v1/assumed-claims/search?q=${CONTRACT_A.id}&limit=5`
  );
  expect(claimSearch.book).toBe(BOOK);
});
