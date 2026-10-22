import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'ASSUMED';

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

const RETRO_A = retrocession();
const RETRO_B = retrocession({
  id: '55555555-5555-7555-8555-555555555555',
  retrocessionNumber: 'RET-000000002',
  contractId: '66666666-6666-7666-8666-666666666666',
  status: 'RULE_APPLIED',
  version: 1
});

function notification(overrides = {}) {
  return {
    id: '99999999-9999-7999-8999-999999999991',
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000001',
    notificationType: 'RETROCESSION_RULE_APPLIED',
    channel: 'EMAIL',
    status: 'SENT',
    subject: 'Retro rule applied',
    sourceType: 'RETROCESSION',
    sourceId: RETRO_A.id,
    sourceReference: RETRO_A.retrocessionNumber,
    createdAt: '2026-10-18T12:00:00Z',
    updatedAt: '2026-10-18T12:00:00Z',
    ...overrides
  };
}

// Deliberately newest-last and mixed with rows that point at another retro case
// or another source: the card must show only this case's newest three.
const NOTIFICATION_NEWEST = notification({
  id: '99999999-9999-7999-8999-999999999911',
  notificationNumber: 'NTF-2026-000011',
  notificationType: 'RETROCESSION_HANDOFF_ACKNOWLEDGED',
  status: 'DELIVERED',
  subject: 'FS-RI acknowledged the hand-off',
  createdAt: '2026-10-20T09:30:00Z'
});

const NOTIFICATION_MIDDLE = notification({
  id: '99999999-9999-7999-8999-999999999922',
  notificationNumber: 'NTF-2026-000022',
  notificationType: 'RETROCESSION_RULE_APPLIED',
  status: 'READ',
  subject: 'Retro rule applied',
  createdAt: '2026-10-19T16:15:00Z'
});

const NOTIFICATION_OLD = notification({
  id: '99999999-9999-7999-8999-999999999933',
  notificationNumber: 'NTF-2026-000033',
  notificationType: 'RETROCESSION_CREATED',
  status: 'QUEUED',
  subject: 'Retro case opened',
  createdAt: '2026-10-18T08:05:00Z'
});

const NOTIFICATION_OLDEST = notification({
  id: '99999999-9999-7999-8999-999999999944',
  notificationNumber: 'NTF-2026-000044',
  notificationType: 'RETROCESSION_CREATED',
  status: 'FAILED',
  subject: 'Retro case notification failed',
  createdAt: '2026-10-01T07:00:00Z'
});

const NOTIFICATION_OTHER_RETRO = notification({
  id: '99999999-9999-7999-8999-999999999955',
  notificationNumber: 'NTF-2026-000055',
  sourceId: RETRO_B.id,
  sourceReference: RETRO_B.retrocessionNumber,
  subject: 'Other retro case notice',
  createdAt: '2026-10-21T08:00:00Z'
});

const NOTIFICATION_OTHER_SOURCE = notification({
  id: '99999999-9999-7999-8999-999999999966',
  notificationNumber: 'NTF-2026-000066',
  sourceType: 'PAYMENT',
  subject: 'Recovery payment settled',
  createdAt: '2026-10-22T08:00:00Z'
});

const RELATED = [
  NOTIFICATION_OLD,
  NOTIFICATION_NEWEST,
  NOTIFICATION_MIDDLE,
  NOTIFICATION_OLDEST,
  NOTIFICATION_OTHER_RETRO,
  NOTIFICATION_OTHER_SOURCE
];

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks everything the retro workbench calls on selection: the retro queue, the
 * contract summary, assumed-claims search, the aggregate activity read, and the
 * related-notification lookup. `gate` keeps the notification response pending
 * so a test can observe the record while Notifications is still in flight.
 */
async function mockRetroApi(page, {
  retrocessions = [RETRO_A],
  notificationsResponse = RELATED,
  notificationsStatus = 200,
  notificationsTotal = undefined,
  gate = null,
  onNotifications = null
} = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/retrocessions') {
      await json(route, 200, retrocessions);
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/retrocessions\/[^/]+$/.test(path)) {
      const id = path.split('/').pop();
      const match = retrocessions.find((record) => record.id === id);
      await json(route, match ? 200 : 404, match || { code: 'RETROCESSION_NOT_FOUND' });
      return;
    }
    if (method === 'GET' && /^\/api\/v1\/contracts\/[^/]+$/.test(path)) {
      const contractId = path.split('/').pop();
      await json(route, 200, {
        id: contractId,
        contractNumber: 'XOL-2026-00091',
        contractType: 'EXCESS_OF_LOSS',
        status: 'BOUND'
      });
      return;
    }
    if (method === 'GET' && path === '/api/v1/assumed-claims/search') {
      await json(route, 200, { items: [] });
      return;
    }
    if (method === 'GET' && path.startsWith('/api/v1/events/aggregate/')) {
      await json(route, 200, { items: [] });
      return;
    }
    if (method === 'GET' && path === '/api/v1/notifications') {
      if (onNotifications) onNotifications(request, url);
      if (gate) await gate;
      const body = notificationsTotal === undefined
        ? notificationsResponse
        : { items: notificationsResponse, total: notificationsTotal };
      await json(route, notificationsStatus, body);
      return;
    }
    await json(route, 404, { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` });
  });
}

test('shows the count and newest three related notifications with the source query', async ({ page }) => {
  const requests = [];

  await mockRetroApi(page, {
    retrocessions: [RETRO_A, RETRO_B],
    onNotifications: (request, url) => {
      requests.push({
        method: request.method(),
        path: url.pathname,
        sourceType: url.searchParams.get('sourceType'),
        sourceId: url.searchParams.get('sourceId'),
        tenant: request.headers()['x-eia-tenant'],
        book: request.headers()['x-eia-book'] || null
      });
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Related notifications' })).toBeVisible();
  await expect(card.getByTestId('related-notifications-count')).toHaveText('4 notifications');
  await expect(card.getByTestId('related-notifications-more'))
    .toHaveText('Showing the newest 3 of 4.');

  const rows = card.getByTestId('related-notification-row');
  await expect(rows).toHaveCount(3);

  // Newest first; the oldest related row and the unrelated rows stay hidden.
  await expect(rows.nth(0)).toContainText(NOTIFICATION_NEWEST.notificationNumber);
  await expect(rows.nth(0)).toContainText(NOTIFICATION_NEWEST.subject);
  await expect(rows.nth(0)).toContainText('DELIVERED');
  await expect(rows.nth(0).getByTestId('related-notification-status')).toHaveClass(/green/);
  await expect(rows.nth(0)).toContainText(/Oct 20, 2026/);
  await expect(rows.nth(1)).toContainText(NOTIFICATION_MIDDLE.notificationNumber);
  await expect(rows.nth(1)).toContainText('READ');
  await expect(rows.nth(2)).toContainText(NOTIFICATION_OLD.notificationNumber);
  await expect(rows.nth(2)).toContainText('QUEUED');
  await expect(rows.nth(2).getByTestId('related-notification-status')).toHaveClass(/amber/);
  await expect(card.getByText(NOTIFICATION_OLDEST.notificationNumber)).toHaveCount(0);
  await expect(card.getByText(NOTIFICATION_OTHER_RETRO.notificationNumber)).toHaveCount(0);
  await expect(card.getByText(NOTIFICATION_OTHER_SOURCE.notificationNumber)).toHaveCount(0);

  // Each notification number opens that notification record.
  await expect(card.getByTestId(`related-notification-link-${NOTIFICATION_NEWEST.id}`))
    .toHaveAttribute('href', `/notifications?record=${NOTIFICATION_NEWEST.id}`);

  // View all keeps the retro case's source filter.
  await expect(card.getByTestId('related-notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=RETROCESSION&sourceId=${RETRO_A.id}`
  );
  await expect(card).toContainText('opens the Notifications queue filtered to this retrocession');

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    method: 'GET',
    path: '/api/v1/notifications',
    sourceType: 'RETROCESSION',
    sourceId: RETRO_A.id,
    tenant: TENANT,
    // Notifications is tenant-scoped, so the ASSUMED wall is not sent.
    book: null
  });

  // Selecting another retro case refetches notifications for its source id.
  await page.getByRole('button', { name: `Open record ${RETRO_B.retrocessionNumber}` }).click();
  await expect(page.getByRole('heading', { name: RETRO_B.retrocessionNumber })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].sourceType).toBe('RETROCESSION');
  expect(requests[1].sourceId).toBe(RETRO_B.id);
  expect(requests[1].tenant).toBe(TENANT);
  await expect(card.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card).toContainText(NOTIFICATION_OTHER_RETRO.subject);
});

test('accepts an {items} envelope and renders a single notification', async ({ page }) => {
  await mockRetroApi(page, {
    notificationsResponse: [notification({ status: 'SENT' })],
    notificationsTotal: 1
  });

  await page.goto('/');

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('1 notification');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(1);
  await expect(card.getByTestId('related-notification-row')).toContainText('NTF-2026-000001');
  await expect(card.getByTestId('related-notification-row')).toContainText(/Oct 18, 2026/);
  await expect(card.getByTestId('related-notifications-more')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('shows the empty state without disturbing the retrocession record', async ({ page }) => {
  await mockRetroApi(page, { notificationsResponse: { items: [], total: 0 } });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('0 notifications');
  await expect(card.getByTestId('related-notifications-empty'))
    .toHaveText('No notifications reference this retrocession yet.');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByTestId('related-notifications-more')).toHaveCount(0);

  // The card is still a working hand-off, and the record is untouched.
  await expect(card.getByTestId('related-notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=RETROCESSION&sourceId=${RETRO_A.id}`
  );
  await expect(page.getByTestId('retro-status')).toHaveText('OPEN');
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('750,000.00 USD');
  await expect(page.getByTestId('related-records')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a Notifications failure inside the card', async ({ page }) => {
  await mockRetroApi(page, {
    notificationsStatus: 503,
    notificationsResponse: {
      code: 'NOTIFICATIONS_UNAVAILABLE',
      message: 'Notification service is unavailable'
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();

  const card = page.getByTestId('related-notifications');
  const error = card.getByTestId('related-notifications-error');
  await expect(error).toContainText('Related notifications are temporarily unavailable');
  await expect(error).toContainText('NOTIFICATIONS_UNAVAILABLE: Notification service is unavailable');
  await expect(error).toContainText('The retrocession record is unaffected.');
  await expect(card.getByTestId('related-notifications-count')).toHaveText('—');
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByTestId('related-notifications-view-all')).toBeVisible();

  // The failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('retro-status')).toHaveText('OPEN');
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('750,000.00 USD');
  await expect(page.getByTestId('related-records')).toBeVisible();
});

test('renders the retro record while the Notifications API is still in flight', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockRetroApi(page, { notificationsResponse: RELATED, gate });

  await page.goto('/');

  // The record and its existing Overview cards are usable before notifications resolve.
  await expect(page.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();
  await expect(page.getByTestId('retro-status')).toHaveText('OPEN');
  await expect(page.getByTestId('related-records')).toBeVisible();
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('750,000.00 USD');

  const card = page.getByTestId('related-notifications');
  await expect(card.getByTestId('related-notifications-loading')).toHaveText(
    'Loading related notifications…'
  );
  await expect(card.getByTestId('related-notifications-count')).toHaveText('…');

  release();

  await expect(card.getByTestId('related-notifications-count')).toHaveText('4 notifications');
  await expect(card.getByTestId('related-notification-row')).toHaveCount(3);
});

test('opens a notification record and the filtered Notifications queue', async ({ page }) => {
  await mockRetroApi(page);

  await page.goto('/');
  const card = page.getByTestId('related-notifications');
  await expect(card).toBeVisible();

  await card.getByTestId(`related-notification-link-${NOTIFICATION_NEWEST.id}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?record=${NOTIFICATION_NEWEST.id}$`)
  );

  await page.goto('/');
  await expect(page.getByTestId('related-notifications')).toBeVisible();
  await page.getByTestId('related-notifications-view-all').click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?sourceType=RETROCESSION&sourceId=${RETRO_A.id}$`)
  );
});
