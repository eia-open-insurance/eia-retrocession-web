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

const CREATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1';
const ACK_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee2';

/** One aggregate event in the shape the event service embeds. */
function aggregateEvent({
  eventId,
  eventType,
  occurredAt,
  aggregateVersion,
  aggregateId = RETRO_A.id,
  status = 'PROCESSED',
  data = {},
  payload
}) {
  return {
    eventId,
    eventType,
    eventVersion: 1,
    tenantId: TENANT,
    book: BOOK,
    aggregateType: 'RetrocessionCase',
    aggregateId,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status,
    payload: payload ?? {
      eventId,
      eventType,
      eventVersion: 1,
      aggregateId,
      aggregateVersion,
      occurredAt,
      data
    }
  };
}

function createdEvent(aggregateId = RETRO_A.id) {
  return aggregateEvent({
    eventId: CREATED_EVENT_ID,
    eventType: 'retrocession.case.created',
    occurredAt: '2026-10-18T12:00:00Z',
    aggregateVersion: 1,
    aggregateId,
    data: {
      caseNumber: RETRO_A.retrocessionNumber,
      contractId: RETRO_A.contractId,
      status: 'OPEN',
      version: 0
    }
  });
}

function acknowledgedEvent(aggregateId = RETRO_A.id) {
  return aggregateEvent({
    eventId: ACK_EVENT_ID,
    eventType: 'retrocession.handoff.acknowledged',
    occurredAt: '2026-10-19T09:30:00Z',
    aggregateVersion: 2,
    aggregateId,
    data: { from: 'HANDOFF_PENDING', to: 'HANDED_OFF', version: 1 }
  });
}

async function json(route, status, body) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Mocks the retro queue and the aggregate activity endpoint, plus the two
 * upstream reads the record makes on selection (contract and assumed claims).
 */
async function mockRetroApi(page, {
  retrocessions = [RETRO_A],
  onEvents = null,
  eventsBody = { items: [] },
  eventsStatus = 200
} = {}) {
  await page.route('**/api/v1/retrocessions**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/v1/retrocessions') {
      await json(route, 200, retrocessions);
      return;
    }
    if (request.method() === 'GET') {
      const id = path.split('/').pop();
      const match = retrocessions.find((record) => record.id === id);
      await json(route, match ? 200 : 404, match || { code: 'RETROCESSION_NOT_FOUND' });
      return;
    }
    await json(route, 200, retrocessions[0]);
  });

  await page.route('**/api/v1/contracts/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const contractId = path.split('/').pop();
    await json(route, 200, {
      id: contractId,
      contractNumber: 'XOL-2026-00091',
      contractType: 'EXCESS_OF_LOSS',
      status: 'BOUND'
    });
  });

  await page.route('**/api/v1/assumed-claims/search**', async (route) => {
    await json(route, 200, { items: [] });
  });

  // Activity tests are not about the Overview notifications card; keep the
  // selection-time lookup local and empty so the suite never reaches the proxy.
  await page.route('**/api/v1/notifications**', async (route) => {
    await json(route, 200, { items: [] });
  });

  await page.route('**/api/v1/events/aggregate/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (onEvents) await onEvents({ route, url, request });
    if (eventsBody) await json(route, eventsStatus, eventsBody);
  });
}

test('loads activity for the selected retro case with tenant header, newest first, and refetches on selection', async ({ page }) => {
  const requests = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  await mockRetroApi(page, {
    retrocessions: [RETRO_A, RETRO_B],
    eventsBody: null,
    onEvents: async ({ route, url, request }) => {
      const position = requests.push({
        method: request.method(),
        path: url.pathname,
        limit: url.searchParams.get('limit'),
        tenant: request.headers()['x-eia-tenant'],
        book: request.headers()['x-eia-book'],
        retrocessionId: url.pathname.split('/').pop()
      });

      if (position === 1) await firstGate;

      if (url.pathname.endsWith(RETRO_A.id)) {
        // Deliberately oldest-first: the card must present newest-first.
        await json(route, 200, {
          aggregateId: RETRO_A.id,
          limit: 50,
          items: [createdEvent(), acknowledgedEvent()]
        });
        return;
      }
      await json(route, 200, {
        aggregateId: RETRO_B.id,
        limit: 50,
        items: [createdEvent(RETRO_B.id)]
      });
    }
  });

  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();

    // Selection alone fetches the timeline, before the Activity tab is opened.
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({
      method: 'GET',
      path: `/api/v1/events/aggregate/${RETRO_A.id}`,
      limit: '50',
      tenant: TENANT,
      book: BOOK,
      retrocessionId: RETRO_A.id
    });

    await page.getByRole('tab', { name: 'Activity' }).click();
    const card = page.getByTestId('retro-activity');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('activity-loading')).toBeVisible();
    await expect(card.getByTestId('activity-count')).toHaveText('…');
    releaseFirst();

    await expect(card.getByTestId('activity-count')).toHaveText('2 events');
    const items = card.getByTestId('activity-item');
    await expect(items).toHaveCount(2);

    const newest = items.nth(0);
    await expect(newest.getByTestId('activity-type')).toHaveText('Retrocession hand-off acknowledged');
    await expect(newest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(newest.getByTestId('activity-status')).toHaveClass(/green/);
    await expect(newest.getByTestId('activity-time')).toHaveAttribute(
      'dateTime',
      '2026-10-19T09:30:00Z'
    );
    await expect(newest.getByTestId('activity-time')).toContainText('Oct 19, 2026');
    await expect(newest.getByTestId('activity-fact-status')).toContainText(
      'HANDOFF_PENDING → HANDED_OFF'
    );
    await expect(newest.getByTestId('activity-fact-version')).toContainText('Version 1');

    const oldest = items.nth(1);
    await expect(oldest.getByTestId('activity-type')).toHaveText('Retrocession case created');
    await expect(oldest.getByTestId('activity-fact-status')).toContainText('OPEN');
    await expect(oldest.getByTestId('activity-fact-version')).toContainText('Version 0');

    // Selecting another retro case refetches the timeline for its aggregate id.
    await page.getByRole('button', { name: `Open record ${RETRO_B.retrocessionNumber}` }).click();
    await expect(page.getByRole('heading', { name: RETRO_B.retrocessionNumber })).toBeVisible();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].path).toBe(`/api/v1/events/aggregate/${RETRO_B.id}`);
    expect(requests[1].tenant).toBe(TENANT);

    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(card.getByTestId('activity-count')).toHaveText('1 event');
    await expect(card.getByTestId('activity-item')).toHaveCount(1);

    // The card's own Refresh re-reads the same aggregate without changing selection.
    await card.getByRole('button', { name: 'Refresh activity timeline' }).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2].path).toBe(`/api/v1/events/aggregate/${RETRO_B.id}`);
    expect(requests[2].limit).toBe('50');
    expect(requests[2].tenant).toBe(TENANT);
    await expect(card.getByTestId('activity-count')).toHaveText('1 event');
  } finally {
    releaseFirst();
  }
});

test('shows the card-local empty state and the event-source context note', async ({ page }) => {
  await mockRetroApi(page, {
    eventsBody: { aggregateId: RETRO_A.id, limit: 50, items: [] }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('retro-activity');
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-empty')).toHaveText(
    'No activity has been recorded for this retrocession yet.'
  );
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(card.getByTestId('activity-context-note')).toContainText('Event-derived timeline');
  await expect(card.getByTestId('activity-context-note')).toContainText('append-only');
  await expect(card.getByTestId('activity-context-note')).toContainText('source of truth');
  await expect(card.getByTestId('activity-context-note')).toContainText('SAP FS-RI');

  // The record itself is untouched by an empty timeline.
  await expect(page.getByTestId('retro-status')).toHaveText('OPEN');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a 503 from the event service inside the activity card', async ({ page }) => {
  await mockRetroApi(page, {
    eventsStatus: 503,
    eventsBody: {
      code: 'EVENT_STORE_UNAVAILABLE',
      message: 'Event service unavailable'
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('retro-activity');
  const error = card.getByTestId('activity-error');
  await expect(error).toContainText('Activity timeline is temporarily unavailable');
  await expect(error).toContainText('Event service unavailable');
  await expect(error).toContainText('The retrocession record is unaffected.');
  await expect(card.getByTestId('activity-count')).toHaveText('—');
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);

  // The failure never becomes a page-level alert or replaces the record.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('retro-status')).toHaveText('OPEN');
  await expect(page.getByTestId('summary-ceded-premium')).toHaveText('750,000.00 USD');

  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('region', { name: 'Retrocession details' })).toBeVisible();
});

test('renders status, FS-RI hand-off, and amount facts from the event payload', async ({ page }) => {
  const ackId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee3';
  const rejectedId = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee4';

  await mockRetroApi(page, {
    eventsBody: {
      aggregateId: RETRO_A.id,
      limit: 50,
      items: [
        aggregateEvent({
          eventId: rejectedId,
          eventType: 'retrocession.handoff.rejected',
          occurredAt: '2026-10-20T10:00:00Z',
          aggregateVersion: 3,
          status: 'FAILED',
          data: {
            from: 'HANDOFF_PENDING',
            to: 'REJECTED',
            version: 2,
            retrocessionNumber: RETRO_A.retrocessionNumber,
            fsriContractNumber: 'RET-2026-0001',
            reason: 'FS-RI rejected the retrocession hand-off',
            cededPremium: '750000.0000',
            currency: 'USD'
          }
        }),
        aggregateEvent({
          eventId: ackId,
          eventType: 'retrocession.handoff.acknowledged',
          occurredAt: '2026-10-19T12:30:00Z',
          aggregateVersion: 2,
          data: {
            from: 'HANDOFF_PENDING',
            to: 'HANDED_OFF',
            version: 1,
            retrocessionNumber: RETRO_A.retrocessionNumber,
            fsriHandoffId: 'FSRI-RET-000001',
            fsriStatus: 'ACCEPTED',
            fsriContractNumber: 'RET-2026-0001',
            fsriHandedOffAt: '2026-10-19T12:30:00Z',
            cededPremium: '750000.0000',
            cededLoss: '450000.0000',
            currency: 'USD'
          }
        }),
        createdEvent()
      ]
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: RETRO_A.retrocessionNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const items = page.getByTestId('activity-item');
  await expect(items).toHaveCount(3);

  const rejection = items.nth(0);
  await expect(rejection.getByTestId('activity-type')).toHaveText('Retrocession hand-off rejected');
  await expect(rejection.getByTestId('activity-status')).toHaveText('FAILED');
  await expect(rejection.getByTestId('activity-status')).toHaveClass(/red/);
  await expect(rejection.getByTestId('activity-fact-status')).toContainText(
    'HANDOFF_PENDING → REJECTED'
  );
  await expect(rejection.getByTestId('activity-fact-fsri-contract')).toContainText('RET-2026-0001');
  await expect(rejection.getByTestId('activity-fact-fsri-error')).toContainText(
    'Rejection reason FS-RI rejected the retrocession hand-off'
  );
  await expect(rejection.getByTestId('activity-fact-ceded-premium')).toContainText(
    'Ceded premium 750,000.00 USD'
  );

  const acknowledgement = items.nth(1);
  await expect(acknowledgement.getByTestId('activity-type')).toHaveText(
    'Retrocession hand-off acknowledged'
  );
  await expect(acknowledgement.getByTestId('activity-fact-fsri-handoff')).toContainText(
    'FSRI-RET-000001'
  );
  await expect(acknowledgement.getByTestId('activity-fact-fsri-status')).toContainText('ACCEPTED');
  await expect(acknowledgement.getByTestId('activity-fact-fsri-handoff-at')).toContainText(
    'Oct 19, 2026'
  );
  await expect(acknowledgement.getByTestId('activity-fact-ceded-premium')).toContainText(
    '750,000.00 USD'
  );
  await expect(acknowledgement.getByTestId('activity-fact-ceded-loss')).toContainText(
    '450,000.00 USD'
  );

  const created = items.nth(2);
  await expect(created.getByTestId('activity-type')).toHaveText('Retrocession case created');
  await expect(created.getByTestId('activity-fact-retrocession')).toContainText(
    RETRO_A.retrocessionNumber
  );
  await expect(created.getByTestId('activity-fact-contract')).toContainText(RETRO_A.contractId);
});
