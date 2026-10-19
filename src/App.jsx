import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'ASSUMED';

const NEXT_STATUS = {
  OPEN: ['RULE_APPLIED', 'CANCELLED'],
  RULE_APPLIED: ['HANDOFF_PENDING', 'CANCELLED'],
  HANDOFF_PENDING: ['HANDED_OFF', 'REJECTED', 'CANCELLED'],
  HANDED_OFF: ['CONFIRMED', 'REJECTED'],
  REJECTED: ['HANDOFF_PENDING', 'CANCELLED'],
  CONFIRMED: [],
  CANCELLED: []
};

const EMPTY_FORM = {
  contractId: '',
  retroContractId: '',
  cededPremium: '0.0000',
  cededLoss: '0.0000',
  currency: 'USD'
};

function label(value) {
  return String(value ?? '').replaceAll('_', ' ');
}

function amount(value, currency) {
  const number = Number(value ?? 0);
  return `${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

async function failureMessage(response) {
  try {
    const body = await response.json();
    return body.message || body.code || `Request failed: ${response.status}`;
  } catch {
    return `Request failed: ${response.status}`;
  }
}

export default function App() {
  const [retrocessions, setRetrocessions] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const headers = { 'X-EIA-Tenant': TENANT, 'X-EIA-Book': BOOK };

  async function load() {
    const response = await fetch('/api/v1/retrocessions', { headers });
    if (!response.ok) throw new Error(await failureMessage(response));
    setRetrocessions(await response.json());
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/v1/retrocessions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractId: form.contractId.trim(),
          retroContractId: form.retroContractId.trim(),
          cededPremium: Number(form.cededPremium || 0),
          cededLoss: Number(form.cededLoss || 0),
          currency: form.currency.trim().toUpperCase()
        })
      });
      if (!response.ok) throw new Error(await failureMessage(response));
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function advance(retrocession, targetStatus) {
    setError('');
    try {
      const response = await fetch(`/api/v1/retrocessions/${retrocession.id}/transition`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus })
      });
      if (!response.ok) throw new Error(await failureMessage(response));
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const cededPremium = retrocessions.reduce((sum, item) => sum + Number(item.cededPremium ?? 0), 0);
  const cededLoss = retrocessions.reduce((sum, item) => sum + Number(item.cededLoss ?? 0), 0);

  return (
    <div className="page">
      <style>{`
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; }
        .page { min-height: 100vh; background: #f4f6f8; color: #172033; font-family: Inter, system-ui, -apple-system, sans-serif; }
        .topbar { display: flex; align-items: center; gap: 16px; padding: 14px 28px; background: #3b2450; color: #fff; }
        .brand { font-weight: 800; letter-spacing: .12em; font-size: 13px; opacity: .75; }
        .vertical { font-size: 18px; font-weight: 700; }
        .book { margin-left: auto; border: 1px solid rgba(255,255,255,.45); border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
        .book-note { padding: 8px 28px; background: #eadff3; color: #3b2450; font-size: 12px; letter-spacing: .04em; }
        main { max-width: 1180px; margin: 0 auto; padding: 28px; }
        h1 { margin: 0 0 4px; font-size: 26px; }
        .lede { margin: 0 0 22px; color: #5a6678; max-width: 760px; }
        .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 24px; }
        .metric { background: #fff; border: 1px solid #dfe5ec; border-radius: 10px; padding: 16px; }
        .metric span { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6c7a8d; margin-bottom: 6px; }
        .metric strong { font-size: 22px; font-variant-numeric: tabular-nums; }
        .card { background: #fff; border: 1px solid #dfe5ec; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
        .card h2 { margin: 0 0 14px; font-size: 16px; }
        .form-grid { display: grid; grid-template-columns: 2fr 2fr 1fr 1fr 1fr auto; gap: 10px; align-items: end; }
        .field { display: flex; flex-direction: column; gap: 5px; }
        .field label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5a6678; }
        input, select { padding: 9px 10px; border: 1px solid #c8d2de; border-radius: 7px; font-size: 13px; width: 100%; background: #fff; }
        button { padding: 9px 14px; border: 1px solid #4b2d66; border-radius: 7px; background: #4b2d66; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
        button.secondary { background: #fff; color: #4b2d66; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .error { border-left: 4px solid #b00020; background: #fdecef; color: #8a0019; padding: 10px 14px; border-radius: 6px; margin-bottom: 18px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #dfe5ec; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5a6678; white-space: nowrap; }
        td { padding: 10px; border-bottom: 1px solid #edf1f5; vertical-align: middle; }
        td.number { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
        .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #eee6f5; color: #4b2d66; font-size: 11px; font-weight: 700; white-space: nowrap; }
        .actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .actions button { padding: 5px 9px; font-size: 11px; }
        .empty { padding: 24px; text-align: center; color: #6c7a8d; }
      `}</style>

      <header className="topbar" data-testid="book-header">
        <span className="brand">EIA</span>
        <span className="vertical">Retrocession</span>
        <span className="book">ASSUMED book</span>
      </header>
      <div className="book-note">
        Book scope: ASSUMED · Inward retrocessional administration · SAP FS-RI hand-off
      </div>

      <main>
        <h1>Retrocession workbench</h1>
        <p className="lede">
          Retrocessional contracts, layers, and FS-RI hand-off for the assumed book. FS-RI remains the
          system of record for actual retro amounts, recoverables, and statements.
        </p>

        {error && <div className="error" role="alert">{error}</div>}

        <section className="metrics" aria-label="Retrocession metrics">
          <div className="metric"><span>Retro cases</span><strong>{retrocessions.length}</strong></div>
          <div className="metric"><span>Ceded premium</span><strong>{amount(cededPremium, 'USD')}</strong></div>
          <div className="metric"><span>Ceded loss</span><strong>{amount(cededLoss, 'USD')}</strong></div>
        </section>

        <section className="card">
          <h2>Create retrocession</h2>
          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label htmlFor="contractId">Source contract ID</label>
              <input id="contractId" value={form.contractId} onChange={(e) => setForm({ ...form, contractId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000" required />
            </div>
            <div className="field">
              <label htmlFor="retroContractId">Retro contract ID</label>
              <input id="retroContractId" value={form.retroContractId}
                onChange={(e) => setForm({ ...form, retroContractId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000" required />
            </div>
            <div className="field">
              <label htmlFor="cededPremium">Ceded premium</label>
              <input id="cededPremium" type="number" min="0" step="0.0001" value={form.cededPremium}
                onChange={(e) => setForm({ ...form, cededPremium: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="cededLoss">Ceded loss</label>
              <input id="cededLoss" type="number" min="0" step="0.0001" value={form.cededLoss}
                onChange={(e) => setForm({ ...form, cededLoss: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <input id="currency" value={form.currency} maxLength={3}
                onChange={(e) => setForm({ ...form, currency: e.target.value })} required />
            </div>
            <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create retrocession'}</button>
          </form>
        </section>

        <section className="card">
          <h2>Retro cases</h2>
          {retrocessions.length === 0 ? (
            <div className="empty">No retro cases yet. Create one against an assumed contract and retro contract.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Source contract</th>
                  <th>Retro contract</th>
                  <th>Status</th>
                  <th>Ceded premium</th>
                  <th>Ceded loss</th>
                  <th>Next step</th>
                </tr>
              </thead>
              <tbody>
                {retrocessions.map((retrocession) => (
                  <tr key={retrocession.id}>
                    <td className="mono">{retrocession.retrocessionNumber}</td>
                    <td className="mono">{retrocession.contractId}</td>
                    <td className="mono">{retrocession.retroContractId}</td>
                    <td><span className="pill">{label(retrocession.status)}</span></td>
                    <td className="number">{amount(retrocession.cededPremium, retrocession.currency)}</td>
                    <td className="number">{amount(retrocession.cededLoss, retrocession.currency)}</td>
                    <td>
                      <div className="actions">
                        {(NEXT_STATUS[retrocession.status] ?? []).map((target) => (
                          <button key={target} type="button"
                            className={target === 'CANCELLED' ? 'secondary' : ''}
                            onClick={() => advance(retrocession, target)}>
                            {label(target)}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
