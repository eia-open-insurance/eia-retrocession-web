import React, { useEffect, useRef, useState } from 'react';
import EntityPicker from './EntityPicker.jsx';
import ActivityPanel from './ActivityPanel.jsx';
import { activityEndpoint, activityItems } from './activity.js';
import { navigate, recordHref } from './navigation.js';
import './ui.css';
import './ui-overrides.css';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'ASSUMED';
const CONTRACT_SEARCH = '/api/v1/contracts/search';
const ASSUMED_CLAIMS_SEARCH = '/api/v1/assumed-claims/search';

const BOOK_HEADERS = {
  'X-EIA-Tenant': TENANT,
  'X-EIA-Book': BOOK
};

const NEXT_STATUS = {
  OPEN: ['RULE_APPLIED', 'CANCELLED'],
  RULE_APPLIED: ['HANDOFF_PENDING', 'CANCELLED'],
  HANDOFF_PENDING: ['HANDED_OFF', 'REJECTED', 'CANCELLED'],
  HANDED_OFF: ['CONFIRMED', 'REJECTED'],
  REJECTED: ['HANDOFF_PENDING', 'CANCELLED'],
  CONFIRMED: [],
  CANCELLED: []
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'handoff', label: 'FS-RI Hand-off' },
  { id: 'history', label: 'Status History' },
  { id: 'activity', label: 'Activity' }
];

const EMPTY_FORM = {
  contractId: '',
  retroContractId: '',
  cededPremium: '0.0000',
  cededLoss: '0.0000',
  currency: 'USD'
};

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DIALOG_STYLE = {
  width: 'min(820px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

const ACTION_LABELS = {
  RULE_APPLIED: 'Apply retro rule',
  CONFIRMED: 'Confirm',
  REJECTED: 'Reject',
  CANCELLED: 'Cancel retrocession'
};

function actionLabel(target) {
  return ACTION_LABELS[target] || String(target ?? '').replaceAll('_', ' ');
}

function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

/** Reads the shell deep-link parameters for this remote. */
function readRoute() {
  if (typeof window === 'undefined' || !window.location) {
    return { record: null, isNew: false };
  }
  const params = new URLSearchParams(window.location.search);
  return { record: params.get('record'), isNew: params.get('new') === '1' };
}

/** Search endpoints return either the shared envelope or a bare list. */
function searchItems(body) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.items) ? body.items : [];
}

function matchesQueueFilter(record, needle) {
  if (!needle) return true;
  return [record.retrocessionNumber, record.contractId, record.retroContractId, record.status]
    .some((value) => value !== null && value !== undefined
      && String(value).toLowerCase().includes(needle));
}

function contractOptionLabel(item) {
  if (!item) return '';
  return [item.label, item.secondary].filter(Boolean).join(' · ');
}

function ContractLink({ contractId, label, testId, className = 'eia-mono' }) {
  if (!contractId) return <span>—</span>;
  const href = recordHref('contract', contractId);
  return (
    <a
      href={href}
      className={className}
      data-testid={testId}
      title={`Open contract ${contractId}`}
      onClick={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {label || shortId(contractId)}
    </a>
  );
}

function formatAmount(value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  const text = Number.isFinite(number)
    ? number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value);
  return currency ? `${text} ${currency}` : text;
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  })} UTC`;
}

function statusTone(status) {
  if (status === 'CONFIRMED') return 'green';
  if (status === 'HANDOFF_PENDING') return 'amber';
  if (status === 'REJECTED' || status === 'CANCELLED') return 'red';
  return 'blue';
}

function canHandOff(record) {
  return (NEXT_STATUS[record?.status] ?? []).includes('HANDOFF_PENDING');
}

function lifecycleTargets(record) {
  return (NEXT_STATUS[record?.status] ?? []).filter(
    (target) => target !== 'HANDOFF_PENDING' && target !== 'HANDED_OFF'
  );
}

function fsriStatusLabel(record) {
  if (record.fsriStatus) return record.fsriStatus;
  if (record.fsriLastError) return 'FAILED';
  if (record.status === 'HANDOFF_PENDING') return 'PENDING';
  if (record.status === 'HANDED_OFF' || record.status === 'CONFIRMED') return 'ACKNOWLEDGED';
  return 'NOT SENT';
}

function fsriStatusNote(record) {
  if (record.fsriStatus) return 'Acknowledgement stored from SAP FS-RI';
  if (record.fsriLastError) return 'Last hand-off failed; retry is available';
  if (record.status === 'HANDOFF_PENDING') return 'Awaiting FS-RI acknowledgement';
  if (record.status === 'HANDED_OFF' || record.status === 'CONFIRMED') return 'FS-RI accepted the hand-off';
  return 'No hand-off sent yet';
}

function historyRows(record) {
  const rows = [
    {
      key: 'created',
      event: 'Retro case created',
      status: 'OPEN',
      reference: record.retrocessionNumber,
      recorded: record.createdAt,
      detail: 'Opened on the ASSUMED book'
    }
  ];
  const moved =
    record.status !== 'OPEN' ||
    Number(record.version) > 0 ||
    (record.createdAt && record.updatedAt && record.updatedAt !== record.createdAt);
  if (moved) {
    rows.push({
      key: 'current',
      event: 'Current lifecycle state',
      status: record.status,
      reference: `v${record.version ?? 0}`,
      recorded: record.updatedAt,
      detail: 'Latest persisted lifecycle write'
    });
  }
  if (record.fsriHandedOffAt || record.fsriHandoffId) {
    rows.push({
      key: 'handoff',
      event: 'FS-RI hand-off acknowledged',
      status: record.fsriStatus || 'ACKNOWLEDGED',
      reference: record.fsriHandoffId || '—',
      recorded: record.fsriHandedOffAt || record.updatedAt,
      detail: 'FS-RI reference stored on the retro case'
    });
  }
  if (record.fsriLastError) {
    rows.push({
      key: 'handoff-failure',
      event: 'FS-RI hand-off failure recorded',
      status: 'FAILED',
      reference: '—',
      recorded: record.updatedAt,
      detail: record.fsriLastError
    });
  }
  return rows;
}

function readJson(response) {
  return response.json().catch(() => null);
}

function problemMessage(body, fallback) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fallback;
  const summary = body.detail || body.title || body.message || body.code || fallback;
  const errors = Array.isArray(body.errors) ? body.errors : Array.isArray(body.details) ? body.details : [];
  if (errors.length === 0) return summary;
  const details = errors
    .map((error) => `${error.field || 'request'}: ${error.message || error.code || 'is invalid'}`)
    .join('; ');
  return `${summary} (${details})`;
}

async function api(path, options = {}) {
  const headers = { ...BOOK_HEADERS };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(problemMessage(body, `Request failed: ${response.status}`));
  }
  return body;
}

export default function App() {
  const [retrocessions, setRetrocessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('overview');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formContractLabel, setFormContractLabel] = useState('');
  const [showCreate, setShowCreate] = useState(() => readRoute().isNew);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(null);
  const [handoffContractNumber, setHandoffContractNumber] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [routeVersion, setRouteVersion] = useState(0);
  const [contract, setContract] = useState(null);
  const [relatedClaims, setRelatedClaims] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [activity, setActivity] = useState({ items: [], loading: false, error: '' });
  const [activityNonce, setActivityNonce] = useState(0);
  const discoveryRef = useRef(new Set());

  const selected = retrocessions.find((record) => record.id === selectedId) || null;
  const history = selected ? historyRows(selected) : [];
  const targets = selected ? lifecycleTargets(selected) : [];
  const needle = filter.trim().toLowerCase();
  const visibleRetrocessions = needle
    ? retrocessions.filter((record) => matchesQueueFilter(record, needle))
    : retrocessions;
  const contractLabel = contract?.contractNumber || '';

  async function load() {
    const rows = await api('/api/v1/retrocessions');
    const items = Array.isArray(rows) ? rows : Array.isArray(rows?.items) ? rows.items : [];
    setRetrocessions(items);
    return items;
  }

  useEffect(() => {
    load()
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onPop = () => setRouteVersion((value) => value + 1);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && retrocessions.some((record) => record.id === current)) return current;
      return retrocessions[0]?.id || null;
    });
  }, [retrocessions]);

  useEffect(() => {
    const route = readRoute();
    setShowCreate(route.isNew);
    if (route.record) {
      const match = retrocessions.find((record) => record.id === route.record);
      if (match && match.id !== selectedId) {
        setSelectedId(match.id);
        setTab('overview');
        setError('');
        setNotice('');
      } else if (!match && !loading && !creating && !discoveryRef.current.has(route.record)) {
        // A deep link can point at a record outside the loaded queue. Resolve it
        // through the canonical ASSUMED-book read and fold it into the queue.
        discoveryRef.current.add(route.record);
        api(`/api/v1/retrocessions/${encodeURIComponent(route.record)}`)
          .then((record) => {
            if (!record?.id) return;
            setRetrocessions((current) => (
              current.some((item) => item.id === record.id) ? current : [record, ...current]
            ));
          })
          .catch(() => {
            discoveryRef.current.delete(route.record);
          });
      }
    } else if (routeVersion > 0 && !route.isNew && selectedId !== retrocessions[0]?.id) {
      setSelectedId(retrocessions[0]?.id || null);
    }
  }, [retrocessions, routeVersion, selectedId, loading, creating]);

  useEffect(() => {
    const contractId = selected?.contractId;
    setContract(null);
    if (!contractId) return undefined;
    let cancelled = false;
    fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}`, { headers: { ...BOOK_HEADERS } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body && body.id) setContract(body);
      })
      .catch(() => {
        // The link still works from the contract id when the lookup is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.contractId]);

  useEffect(() => {
    const contractId = selected?.contractId;
    if (!contractId) {
      setRelatedClaims([]);
      setRelatedLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRelatedLoading(true);
    fetch(`${ASSUMED_CLAIMS_SEARCH}?q=${encodeURIComponent(contractId)}&limit=5`, {
      headers: { ...BOOK_HEADERS }
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Assumed claim lookup failed (${response.status})`);
        return response.json();
      })
      .then((body) => {
        if (!cancelled) {
          setRelatedClaims(searchItems(body));
          setRelatedLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRelatedClaims([]);
          setRelatedLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.contractId]);

  useEffect(() => {
    setHandoffContractNumber('');
  }, [selectedId]);

  /**
   * Event-derived activity for the selected retro case. The fetch starts when
   * the record is selected and owns its own loading/error state, so a slow or
   * unavailable event service never blocks the retrocession record.
   *
   * Events come from `GET /api/v1/events/aggregate/{retrocessionId}?limit=50`
   * with the tenant header; they are facts that already happened, not editable
   * state.
   */
  useEffect(() => {
    if (!selectedId) {
      setActivity({ items: [], loading: false, error: '' });
      return undefined;
    }
    let cancelled = false;
    setActivity({ items: [], loading: true, error: '' });
    api(activityEndpoint(selectedId))
      .then((payload) => {
        if (cancelled) return;
        setActivity({ items: activityItems(payload), loading: false, error: '' });
      })
      .catch((cause) => {
        if (cancelled) return;
        setActivity({ items: [], loading: false, error: cause.message });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, activityNonce]);

  useEffect(() => {
    if (!showCreate) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !creating) closeCreate();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCreate, creating]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectRecord(record) {
    if (record.id !== selectedId) {
      setSelectedId(record.id);
      setTab('overview');
      setError('');
      setNotice('');
    }
    navigate(recordHref('retrocession', record.id));
  }

  function selectSourceContract(id, item) {
    update('contractId', id);
    setFormContractLabel(contractOptionLabel(item));
    setError('');
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormContractLabel('');
    setError('');
    setNotice('');
    setShowCreate(true);
    navigate('/retrocession?new=1');
  }

  function closeCreate() {
    if (creating) return;
    setShowCreate(false);
    setError('');
    navigate(selectedId ? recordHref('retrocession', selectedId) : '/retrocession');
  }

  async function refresh() {
    setError('');
    setNotice('');
    setActivityNonce((value) => value + 1);
    setLoading(true);
    try {
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  function refreshActivity() {
    setActivityNonce((value) => value + 1);
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!form.contractId.trim()) {
      setError('Choose a source contract from the ASSUMED book before creating the retro case.');
      return;
    }
    setCreating(true);
    try {
      const created = await api('/api/v1/retrocessions', {
        method: 'POST',
        body: {
          contractId: form.contractId.trim(),
          retroContractId: form.retroContractId.trim(),
          cededPremium: Number(form.cededPremium || 0),
          cededLoss: Number(form.cededLoss || 0),
          currency: form.currency.trim().toUpperCase()
        }
      });
      setForm(EMPTY_FORM);
      setFormContractLabel('');
      setShowCreate(false);
      navigate(created?.id ? recordHref('retrocession', created.id) : '/retrocession');
      const items = await load();
      setActivityNonce((value) => value + 1);
      if (created?.id) {
        setSelectedId(created.id);
      } else if (items[0]) {
        setSelectedId(items[0].id);
      }
      setTab('overview');
      setNotice(
        created?.retrocessionNumber
          ? `Retro case ${created.retrocessionNumber} created on the ASSUMED book.`
          : 'Retro case created on the ASSUMED book.'
      );
    } catch (cause) {
      setError(cause.message);
    } finally {
      setCreating(false);
    }
  }

  async function transition(record, targetStatus, extra = {}) {
    setError('');
    setNotice('');
    setPending({ id: record.id, target: targetStatus });
    try {
      const updated = await api(`/api/v1/retrocessions/${record.id}/transition`, {
        method: 'POST',
        body: { targetStatus, ...extra }
      });
      await load();
      setActivityNonce((value) => value + 1);
      setSelectedId(record.id);
      setNotice(`${record.retrocessionNumber} is now ${updated?.status || targetStatus}.`);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setPending(null);
    }
  }

  function handOff(record) {
    const contractNumber = handoffContractNumber.trim().toUpperCase();
    return transition(record, 'HANDOFF_PENDING', contractNumber ? { fsriContractNumber: contractNumber } : {});
  }

  function submitHandoff(event) {
    event.preventDefault();
    if (!selected || !canHandOff(selected) || pending !== null) return;
    handOff(selected);
  }

  function isPending(record, target) {
    return pending !== null && pending.id === record.id && pending.target === target;
  }

  const handoffPrimary = selected && canHandOff(selected);

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Reinsurance · Assumed book</div>
          <h1>Retrocession</h1>
          <p className="subtitle" style={{ maxWidth: 900 }}>
            Assumed-book retro cases, expected ceded premium and loss, and the SAP FS-RI hand-off.
            FS-RI remains the system of record for actual retro amounts, recoverables, and statements.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge assumed" data-testid="book-header" aria-label="Book scope">
            ASSUMED book
          </span>
          <button type="button" className="eia-btn-ghost" onClick={refresh}>
            Refresh
          </button>
          <button type="button" onClick={openCreate} aria-haspopup="dialog">
            Create retrocession
          </button>
        </div>
      </header>

      <div className="eia-toolbar eia-queue-search" role="search" aria-label="Retrocession queue filter">
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter retrocessions by number, contract, or status…"
          aria-label="Filter retrocessions"
          autoComplete="off"
        />
        {filter && (
          <button type="button" className="eia-btn-secondary" onClick={() => setFilter('')}>
            Clear
          </button>
        )}
        <span className="eia-muted" data-testid="queue-filter-count">
          {needle
            ? `${visibleRetrocessions.length} of ${retrocessions.length} retrocession${retrocessions.length === 1 ? '' : 's'}`
            : `${retrocessions.length} retrocession${retrocessions.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !showCreate && <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Retrocession queue">
          <div className="eia-record-list-head">
            <strong>Retrocession queue</strong>
            <span className="eia-muted">{loading ? '…' : visibleRetrocessions.length}</span>
          </div>
          {visibleRetrocessions.map((record) => {
            const isSelected = record.id === selectedId;
            return (
              <button
                key={record.id}
                type="button"
                className={isSelected ? 'selected' : ''}
                aria-pressed={isSelected}
                aria-label={`Open record ${record.retrocessionNumber}`}
                onClick={() => selectRecord(record)}
              >
                <span className="record-primary">{record.retrocessionNumber}</span>
                <span className="record-secondary">
                  Contract{' '}
                  {contract?.id === record.contractId && contractLabel
                    ? contractLabel
                    : shortId(record.contractId)}
                </span>
                <span className="record-secondary">
                  <span className={`eia-pill ${statusTone(record.status)}`}>{record.status}</span>
                </span>
              </button>
            );
          })}
          {loading && retrocessions.length === 0 && (
            <div className="empty">Loading ASSUMED retro cases…</div>
          )}
          {!loading && retrocessions.length === 0 && (
            <div className="empty">No retro cases yet. Use Create retrocession to open the first case.</div>
          )}
          {!loading && retrocessions.length > 0 && visibleRetrocessions.length === 0 && (
            <div className="empty" data-testid="queue-filter-empty">
              No retrocessions match “{filter.trim()}”. Clear the filter to see the full queue.
            </div>
          )}
        </aside>

        <section className="eia-record-panel" aria-label="Retrocession record">
          {!selected ? (
            <div className="eia-empty">
              <p style={{ marginTop: 0 }}>
                {loading
                  ? 'Loading the ASSUMED retro queue…'
                  : 'Select a retro case from the queue, or create the first retrocession for an assumed contract.'}
              </p>
            </div>
          ) : (
            <>
              <div className="eia-record-title">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h2 className="eia-mono">{selected.retrocessionNumber}</h2>
                    <span
                      className={`eia-pill ${statusTone(selected.status)}`}
                      data-testid="retro-status"
                    >
                      {selected.status}
                    </span>
                  </div>
                  <p className="eia-record-subtitle">
                    Ceded premium {formatAmount(selected.cededPremium, selected.currency)} · Ceded loss{' '}
                    {formatAmount(selected.cededLoss, selected.currency)}
                  </p>
                  <p className="eia-record-subtitle">
                    Source contract{' '}
                    <ContractLink
                      contractId={selected.contractId}
                      label={contractLabel}
                      testId="source-contract-link"
                    />{' '}
                    · Retro contract <span className="eia-mono">{shortId(selected.retroContractId)}</span> ·
                    Version {selected.version ?? 0}
                  </p>
                </div>
                <div className="eia-actions">
                  {handoffPrimary && (
                    <button
                      type="button"
                      onClick={() => handOff(selected)}
                      disabled={pending !== null}
                    >
                      {isPending(selected, 'HANDOFF_PENDING')
                        ? 'Handing off…'
                        : selected.status === 'REJECTED'
                          ? 'Retry FS-RI hand-off'
                          : 'Hand off to FS-RI'}
                    </button>
                  )}
                  <button type="button" className="eia-btn-ghost" onClick={refresh}>
                    Refresh record
                  </button>
                </div>
              </div>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Ceded premium</h3>
                  <div className="value" data-testid="summary-ceded-premium">
                    {formatAmount(selected.cededPremium, selected.currency)}
                  </div>
                  <div className="eia-metric-label">{selected.currency || '—'} expected ceded premium</div>
                </div>
                <div className="eia-card">
                  <h3>Ceded loss</h3>
                  <div className="value" data-testid="summary-ceded-loss">
                    {formatAmount(selected.cededLoss, selected.currency)}
                  </div>
                  <div className="eia-metric-label">{selected.currency || '—'} expected ceded loss</div>
                </div>
                <div className="eia-card">
                  <h3>FS-RI status</h3>
                  <div className="value" data-testid="summary-fsri-status">
                    {fsriStatusLabel(selected)}
                  </div>
                  <div className="eia-metric-label">{fsriStatusNote(selected)}</div>
                </div>
                <div className="eia-card">
                  <h3>Hand-off reference</h3>
                  <div
                    className="value eia-mono"
                    style={{ fontSize: 14 }}
                    data-testid="summary-fsri-handoff"
                  >
                    {selected.fsriHandoffId || '—'}
                  </div>
                  <div className="eia-metric-label">
                    {selected.fsriHandedOffAt ? 'FS-RI acknowledgement' : 'No FS-RI reference yet'}
                  </div>
                </div>
              </div>

              <div className="eia-context-panel" data-testid="why-this-matters">
                <h4>Why this matters</h4>
                <p>
                  This retrocession sits behind the assumed contract{' '}
                  <ContractLink
                    contractId={selected.contractId}
                    label={contractLabel}
                    testId="context-contract-link"
                  />
                  . The contract and its assumed claims are upstream; actual retro amounts,
                  recoveries, and statements remain FS-RI-owned. This workbench holds the expected
                  ceded premium and loss plus the hand-off references, not the posted retro ledger.
                </p>
                <div className="links">
                  {selected.contractId && (
                    <a
                      href={recordHref('contract', selected.contractId)}
                      data-testid="context-contract-record-link"
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(recordHref('contract', selected.contractId));
                      }}
                    >
                      Open assumed contract
                    </a>
                  )}
                  <a href="#related-records">Assumed claims upstream</a>
                </div>
              </div>

              <nav className="eia-tabs" role="tablist" aria-label="Retrocession sections">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    id={`tab-${entry.id}`}
                    type="button"
                    role="tab"
                    className={`eia-tab${tab === entry.id ? ' active' : ''}`}
                    aria-selected={tab === entry.id}
                    aria-controls={`panel-${entry.id}`}
                    onClick={() => setTab(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>

              {tab === 'overview' && (
                <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
                  <div className="eia-grid eia-grid-2">
                    <section className="eia-card" aria-label="Retrocession details">
                      <h3>Retrocession details</h3>
                      <dl className="eia-kv" style={{ marginTop: 8 }}>
                        <dt>Retrocession number</dt>
                        <dd className="eia-mono">{selected.retrocessionNumber}</dd>
                        <dt>Status</dt>
                        <dd>
                          <span className={`eia-pill ${statusTone(selected.status)}`}>
                            {selected.status}
                          </span>
                        </dd>
                        <dt>Book</dt>
                        <dd>
                          <span className="eia-badge assumed">ASSUMED</span>
                        </dd>
                        <dt>Source contract</dt>
                        <dd>
                          <ContractLink
                            contractId={selected.contractId}
                            label={contractLabel}
                            testId="source-contract-detail-link"
                          />
                        </dd>
                        <dt>Retro contract</dt>
                        <dd className="eia-mono">{selected.retroContractId || '—'}</dd>
                        <dt>Ceded premium</dt>
                        <dd>{formatAmount(selected.cededPremium, selected.currency)}</dd>
                        <dt>Ceded loss</dt>
                        <dd>{formatAmount(selected.cededLoss, selected.currency)}</dd>
                        <dt>Currency</dt>
                        <dd>{selected.currency || '—'}</dd>
                        <dt>Record version</dt>
                        <dd>{selected.version ?? 0}</dd>
                        <dt>Created</dt>
                        <dd>{formatTimestamp(selected.createdAt)}</dd>
                        <dt>Updated</dt>
                        <dd>{formatTimestamp(selected.updatedAt)}</dd>
                      </dl>
                    </section>

                    <section className="eia-card" aria-label="Lifecycle actions">
                      <h3>Lifecycle</h3>
                      <p className="eia-muted" style={{ marginTop: 0 }}>
                        Expected retro values support validation only; FS-RI remains authoritative for
                        actual retro amounts.
                      </p>
                      <dl className="eia-kv">
                        <dt>Current status</dt>
                        <dd>
                          <span className={`eia-pill ${statusTone(selected.status)}`}>
                            {selected.status}
                          </span>
                        </dd>
                        <dt>Hand-off eligible</dt>
                        <dd>{canHandOff(selected) ? 'Yes' : 'No'}</dd>
                        <dt>Other lifecycle steps</dt>
                        <dd>{targets.length ? targets.map(actionLabel).join(' · ') : 'None'}</dd>
                      </dl>
                      {targets.length > 0 ? (
                        <div
                          className="eia-actions"
                          style={{ justifyContent: 'flex-start', marginTop: 14 }}
                        >
                          {targets.map((target) => {
                            const primary = target === 'RULE_APPLIED' || target === 'CONFIRMED';
                            return (
                              <button
                                key={target}
                                type="button"
                                className={primary ? '' : 'eia-btn-secondary'}
                                disabled={pending !== null}
                                onClick={() => transition(selected, target)}
                              >
                                {isPending(selected, target) ? 'Working…' : actionLabel(target)}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="eia-muted" style={{ marginBottom: 0 }}>
                          No further lifecycle actions.
                        </p>
                      )}
                      {handoffPrimary && (
                        <p className="eia-muted" style={{ marginBottom: 0 }}>
                          The FS-RI hand-off is the primary action in the record header; it calls FS-RI
                          before the case can become HANDED_OFF.
                        </p>
                      )}
                      {selected.status === 'HANDOFF_PENDING' && (
                        <p className="eia-muted" style={{ marginBottom: 0 }}>
                          Awaiting FS-RI acknowledgement. HANDED_OFF is recorded only from the FS-RI
                          response.
                        </p>
                      )}
                    </section>
                  </div>

                  <section
                    className="eia-card"
                    id="related-records"
                    aria-label="Upstream records"
                    data-testid="related-records"
                    style={{ marginTop: 14 }}
                  >
                    <h3>Upstream records</h3>
                    <p className="eia-muted" style={{ marginTop: 4 }}>
                      The assumed contract and its claims are upstream of this retro case. Actual retro
                      amounts and recoverables remain FS-RI-owned.
                    </p>
                    <div className="eia-related-group" data-testid="related-contract">
                      <h4 className="eia-related-title">Assumed contract</h4>
                      {selected.contractId ? (
                        <div className="eia-related-list">
                          <a
                            className="eia-related-record"
                            href={recordHref('contract', selected.contractId)}
                            data-testid="related-contract-link"
                            onClick={(event) => {
                              event.preventDefault();
                              navigate(recordHref('contract', selected.contractId));
                            }}
                          >
                            <b>{contractLabel || shortId(selected.contractId)}</b>
                            <span>{contract?.contractType || 'ASSUMED contract'}</span>
                            {contract?.status && <em>{contract.status}</em>}
                          </a>
                        </div>
                      ) : (
                        <p className="eia-muted">No source contract is linked to this retro case.</p>
                      )}
                    </div>
                    <div className="eia-related-group" data-testid="related-assumed-claims">
                      <h4 className="eia-related-title">Assumed claims</h4>
                      {relatedLoading ? (
                        <p className="eia-muted">Loading related assumed claims…</p>
                      ) : relatedClaims.length === 0 ? (
                        <p className="eia-muted">No assumed claims reference this contract.</p>
                      ) : (
                        <div className="eia-related-list">
                          {relatedClaims.map((item, index) => {
                            const href = item.href || recordHref('assumed-claims', item.id);
                            return (
                              <a
                                key={item.id || item.href || `assumed-claim-${index}`}
                                className="eia-related-record"
                                href={href}
                                onClick={(event) => {
                                  event.preventDefault();
                                  navigate(href);
                                }}
                              >
                                <b>{item.label}</b>
                                <span>{item.secondary}</span>
                                {item.status && <em>{item.status}</em>}
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </section>
                </section>
              )}

              {tab === 'handoff' && (
                <section id="panel-handoff" role="tabpanel" aria-labelledby="tab-handoff">
                  <div className="eia-grid eia-grid-2">
                    <section className="eia-card" aria-label="FS-RI hand-off state">
                      <h3>FS-RI hand-off state</h3>
                      <dl className="eia-kv" style={{ marginTop: 8 }}>
                        <dt>Hand-off reference</dt>
                        <dd className="eia-mono" data-testid="fsri-handoff-id">
                          {selected.fsriHandoffId || '—'}
                        </dd>
                        <dt>FS-RI status</dt>
                        <dd>{fsriStatusLabel(selected)}</dd>
                        <dt>Handed off at</dt>
                        <dd>{formatTimestamp(selected.fsriHandedOffAt)}</dd>
                        <dt>Last FS-RI error</dt>
                        <dd>{selected.fsriLastError || '—'}</dd>
                        <dt>Case status</dt>
                        <dd>
                          <span className={`eia-pill ${statusTone(selected.status)}`}>
                            {selected.status}
                          </span>
                        </dd>
                      </dl>
                    </section>

                    <section className="eia-card" aria-label="Send FS-RI hand-off">
                      <h3>Send hand-off</h3>
                      <p className="eia-muted" style={{ marginTop: 0 }}>
                        The hand-off posts the retro case to SAP FS-RI and stores the acknowledgement
                        reference, status, and timestamp. A failed attempt leaves the case retryable.
                      </p>
                      <form className="eia-form-grid" onSubmit={submitHandoff}>
                        <div className="eia-field span-2">
                          <label htmlFor="fsri-contract-number">FS-RI contract number (optional)</label>
                          <input
                            id="fsri-contract-number"
                            value={handoffContractNumber}
                            placeholder={selected.retrocessionNumber}
                            maxLength={32}
                            pattern="[A-Z0-9][A-Z0-9-]{3,31}"
                            onChange={(event) =>
                              setHandoffContractNumber(event.target.value.toUpperCase())
                            }
                            disabled={!canHandOff(selected) || pending !== null}
                          />
                        </div>
                        <div className="eia-field">
                          <button
                            type="submit"
                            disabled={!canHandOff(selected) || pending !== null}
                          >
                            {isPending(selected, 'HANDOFF_PENDING')
                              ? 'Handing off…'
                              : selected.status === 'REJECTED'
                                ? 'Retry hand-off'
                                : 'Send hand-off'}
                          </button>
                        </div>
                      </form>
                      <p className="eia-muted" style={{ marginBottom: 0 }}>
                        {canHandOff(selected)
                          ? `Defaults to ${selected.retrocessionNumber} when blank. The case becomes HANDED_OFF only after FS-RI acknowledges.`
                          : selected.status === 'HANDOFF_PENDING'
                            ? 'Hand-off is in flight; the case is waiting for an FS-RI acknowledgement.'
                            : selected.status === 'HANDED_OFF' || selected.status === 'CONFIRMED'
                              ? 'FS-RI has acknowledged this hand-off. Confirm or reject the case from the Overview lifecycle.'
                              : selected.status === 'OPEN'
                                ? 'Hand-off is available only from RULE_APPLIED or REJECTED. Apply the retro rule first.'
                                : 'A hand-off is not available from this status.'}
                      </p>
                    </section>
                  </div>
                </section>
              )}

              {tab === 'history' && (
                <section id="panel-history" role="tabpanel" aria-labelledby="tab-history">
                  <div className="eia-section-title">
                    <h2>Status history</h2>
                    <span className="eia-muted">
                      {history.length} recorded event{history.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Status</th>
                          <th>Reference</th>
                          <th>Recorded</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((row) => (
                          <tr key={row.key}>
                            <td>{row.event}</td>
                            <td>{row.status}</td>
                            <td className="eia-mono">{row.reference}</td>
                            <td className="eia-nowrap">{formatTimestamp(row.recorded)}</td>
                            <td>{row.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="eia-muted">
                    Derived from the retro case created/updated timestamps and stored FS-RI fields. The
                    API exposes the current record rather than a per-transition audit log.
                  </p>
                </section>
              )}

              {tab === 'activity' && (
                <ActivityPanel
                  items={activity.items}
                  loading={activity.loading}
                  error={activity.error}
                  onRefresh={refreshActivity}
                />
              )}
            </>
          )}
        </section>
      </div>

      {showCreate && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creating) closeCreate();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-retrocession-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="create-retrocession-title" style={{ margin: 0 }}>
                  Create retrocession
                </h2>
                <p className="eia-record-subtitle">
                  Open an assumed-book retro case against a source contract and retro contract. The
                  request is walled to the ASSUMED book.
                </p>
              </div>
              <button
                type="button"
                className="eia-btn-ghost"
                onClick={closeCreate}
                disabled={creating}
              >
                Close
              </button>
            </div>

            <form className="eia-form-grid" onSubmit={submit} style={{ marginTop: 16 }}>
              <div className="eia-field span-3">
                <label>Source contract</label>
                <EntityPicker
                  endpoint={CONTRACT_SEARCH}
                  book={BOOK}
                  value={form.contractId}
                  valueLabel={formContractLabel}
                  onChange={selectSourceContract}
                  placeholder="Search contracts by number or type…"
                />
                {form.contractId && (
                  <a
                    href={recordHref('contract', form.contractId)}
                    data-testid="create-contract-link"
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(recordHref('contract', form.contractId));
                    }}
                  >
                    Open contract record
                  </a>
                )}
              </div>
              <div className="eia-field span-3">
                <label htmlFor="create-retro-contract-id">Retro contract ID</label>
                <input
                  id="create-retro-contract-id"
                  value={form.retroContractId}
                  onChange={(event) => update('retroContractId', event.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                />
                <span className="eia-picker-hint">
                  FS-RI-owned retro contract reference; the assumed contract above is the upstream
                  business record.
                </span>
              </div>
              <div className="eia-field">
                <label htmlFor="create-ceded-premium">Ceded premium</label>
                <input
                  id="create-ceded-premium"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.cededPremium}
                  onChange={(event) => update('cededPremium', event.target.value)}
                  required
                />
              </div>
              <div className="eia-field">
                <label htmlFor="create-ceded-loss">Ceded loss</label>
                <input
                  id="create-ceded-loss"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.cededLoss}
                  onChange={(event) => update('cededLoss', event.target.value)}
                  required
                />
              </div>
              <div className="eia-field">
                <label htmlFor="create-currency">Currency</label>
                <input
                  id="create-currency"
                  value={form.currency}
                  maxLength={3}
                  onChange={(event) => update('currency', event.target.value.toUpperCase())}
                  required
                />
              </div>
              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeCreate}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create retrocession'}
                </button>
              </div>
            </form>
            {error && <p role="alert" style={{ margin: '8px 0 0' }}>{error}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
