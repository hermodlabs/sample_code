import React, { Fragment, useId, useRef, useState } from 'react';
import useGiftReview from './useGiftReview.js';
import { formatMinutes, formatMoney } from './gifting.js';

function Field({ label, value, onChange, type = 'text', ...props }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value ?? ''}
        onChange={event => onChange(event.target.value)}
        {...props}
      />
    </div>
  );
}

function Select({ label, value, onChange, children }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={event => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}

function Issues({ issues }) {
  if (!issues.length) return null;
  return (
    <div className="notice error" role="alert">
      <strong>Review needs attention</strong>
      <ul>
        {issues.map((issue, index) => (
          <li key={index}>{typeof issue === 'string' ? issue : issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

function BatchBasis({ caseData, config }) {
  const values = caseData.parameters;
  return (
    <section className="batch-basis" aria-label="Current gift-kit commitment">
      <div>
        <span className="eyebrow">Current batch</span>
        <h2>{values.batchId}</h2>
        <p>{values.quantity} gift kits · Insert revision {values.insertRevision}</p>
        <p className="muted">Recorded review time: {formatMinutes(values.nowMinute)}</p>
      </div>
      <dl>
        <div><dt>Package budget</dt><dd>{formatMoney(values.budgetMinor, config)}</dd></div>
        <div><dt>Handoff deadline</dt><dd>{formatMinutes(values.handoffDeadlineMinute)}</dd></div>
        <div><dt>Destination / checkout revisions</dt><dd>{values.destinationRevision} / {values.checkoutRevision}</dd></div>
        <div><dt>Device / account</dt><dd>{values.deviceScope} / {values.accountScope}</dd></div>
      </dl>
    </section>
  );
}

function QuoteForm({ draft, config, editQuote }) {
  const [selectedId, setSelectedId] = useState(config.confirmationPackage);
  const quote = draft.quotes.find(row => row.id === selectedId) ?? draft.quotes[0];
  const edit = field => value => editQuote(quote.id, field, value);
  return (
    <section className="panel" aria-labelledby="quotes-heading">
      <h2 id="quotes-heading">1. Package quote</h2>
      <p>Each quote covers a complete correction package. Update the actual offer, keeping its quoted quantity and duration.</p>
      <Select label="Package quote" value={quote.id} onChange={setSelectedId}>
        {draft.quotes.map(row => <option key={row.id} value={row.id}>{config.labels.packages[row.id] ?? row.id}</option>)}
      </Select>
      <div className="form-grid">
        <Field label="Total package amount" type="number" value={quote.totalCost} onChange={edit('totalCost')} min="0" step="0.01" />
        <Select label="Quote currency" value={quote.currency} onChange={edit('currency')}>
          <option value="USD">USD — US dollar</option>
          <option value="EUR">EUR — Euro</option>
        </Select>
        <Field label="Quoted quantity (kits)" type="number" value={quote.quantity} onChange={edit('quantity')} min="1" step="1" />
        <Field label="Correction duration (minutes)" type="number" value={quote.repairMinutes} onChange={edit('repairMinutes')} min="0" step="1" />
      </div>
      <p className="footnote">Amounts are complete USD package expenses. Rehearsal and handoff remain required after the correction work.</p>
    </section>
  );
}

function ConfirmationForm({ draft, editConfirmation }) {
  const record = draft.confirmation;
  const edit = field => value => editConfirmation(field, value);
  return (
    <section className="panel" aria-labelledby="confirmation-heading">
      <h2 id="confirmation-heading">2. Vendor confirmation</h2>
      <p>Record what the written confirmation actually covers. Changing the current batch does not update an older record.</p>
      <div className="form-grid">
        <Select label="Confirmation status" value={record.status} onChange={edit('status')}>
          <option value="none">No recorded confirmation</option>
          <option value="positive">Positive confirmation</option>
          <option value="negative">Negative confirmation</option>
        </Select>
        <Field label="Confirmation reference" value={record.id} onChange={edit('id')} />
        <Field label="Confirmation source" value={record.source} onChange={edit('source')} />
        <Field label="Recorded by" value={record.recordedBy} onChange={edit('recordedBy')} />
      </div>
      <p className="footnote">For {record.packageId}. A positive confirmation does not prove correction work has finished.</p>
      <details open>
        <summary>Batch and revisions covered</summary>
        <div className="form-grid">
          <Field label="Confirmation batch" value={record.batchId} onChange={edit('batchId')} />
          <Field label="Confirmation insert revision" value={record.insertRevision} onChange={edit('insertRevision')} />
          <Field label="Confirmation destination revision" value={record.destinationRevision} onChange={edit('destinationRevision')} />
          <Field label="Confirmation checkout revision" value={record.checkoutRevision} onChange={edit('checkoutRevision')} />
          <Field label="Confirmation device scope" value={record.deviceScope} onChange={edit('deviceScope')} />
          <Field label="Confirmation account scope" value={record.accountScope} onChange={edit('accountScope')} />
        </div>
      </details>
      <details>
        <summary>Recorded time and validity</summary>
        <p>Times are elapsed minutes from this batch’s preparation clock, rather than wall-clock timestamps.</p>
        <div className="form-grid">
          <Field label="Recorded at (minute)" type="number" value={record.recordedAt} onChange={edit('recordedAt')} step="1" />
          <Field label="Valid from (minute)" type="number" value={record.validFrom} onChange={edit('validFrom')} step="1" />
          <Field label="Valid through (minute)" type="number" value={record.validThrough} onChange={edit('validThrough')} step="1" />
        </div>
      </details>
    </section>
  );
}

function Recommendation({ summary, earlier = false }) {
  if (summary.status === 'blocked') {
    return <p><strong>No listed package passes.</strong> Review the failed conditions below before proposing a handoff plan.</p>;
  }
  return (
    <div className="recommendation-list">
      {summary.preferred.map(plan => (
        <div key={plan.id}>
          <strong>{plan.label}</strong>
          <span>{plan.expenseDisplay} · Finish {formatMinutes(plan.finishMinute)}</span>
        </div>
      ))}
      {!earlier && <p>The app prefers the earliest finish, then lower complete cost, among packages that pass its requirements.</p>}
    </div>
  );
}

function PlanTable({ summary }) {
  return (
    <table className="comparison">
      <caption>Complete package comparison</caption>
      <thead><tr><th scope="col">Correction package</th><th scope="col">Complete cost</th><th scope="col">Finish</th></tr></thead>
      <tbody>
        {summary.plans.map(plan => {
          // A condition may fail in several possibilities. Present its reason
          // once here; the full SDK run retains each individual check.
          const blockers = [...new Map(plan.blockers.map(check => [check.id, check])).values()];
          return (
            <Fragment key={plan.id}>
              <tr className={plan.preferred ? 'preferred-row' : ''}>
                <th scope="row">
                  <span className="plan-name">{plan.label}</span>
                  <span className="plan-start">Start {formatMinutes(plan.startMinute)}</span>
                  <span className={`badge ${plan.feasible ? 'pass' : 'blocked'}`}>
                    {plan.preferred ? 'Preferred' : plan.feasible ? 'Passes' : 'Blocked'}
                  </span>
                </th>
                <td>{plan.expenseDisplay}</td><td>{formatMinutes(plan.finishMinute)}</td>
              </tr>
              {blockers.length > 0 && (
                <tr className="blocker-row">
                  <td colSpan="3">
                    <strong>Conditions needing attention</strong>
                    <ul>{blockers.map(check => <li key={check.id}>{check.label}</li>)}</ul>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function Results({ desk }) {
  const { current, before, status } = desk;
  const labels = {
    loading: 'Loading case',
    ready: 'Ready to review',
    dirty: 'Needs reassessment',
    running: 'Reviewing packages',
    complete: 'Review complete',
    invalid: 'Inputs need attention',
    unavailable: 'Assessment unavailable',
  };
  return (
    <section className="panel results" aria-labelledby="results-heading">
      <div className="results-heading">
        <h2 id="results-heading">Package recommendation</h2>
        <span className="state" role="status" aria-live="polite">{labels[status]}</span>
      </div>
      <div className="review-actions">
        <button type="button" className="primary" onClick={desk.evaluate} disabled={status === 'loading' || status === 'running'}>Review packages</button>
        {status === 'running' && <button type="button" onClick={desk.cancel}>Cancel review</button>}
        <button type="button" onClick={desk.downloadRun} disabled={!current}>Download SDK run</button>
      </div>
      <Issues issues={desk.issues} />
      {current ? (
        <>
          <div className={`notice ${current.status === 'blocked' ? 'warning' : 'recommendation'}`}>
            <Recommendation summary={current} />
          </div>
          <p className="footnote">
            Checks cover all {current.scenarioCount} supplied fault possibilities.
            These are possibilities to plan for; they are not a diagnosis.
          </p>
          <PlanTable summary={current} />
        </>
      ) : (
        <div className="empty-state">
          <strong>{status === 'dirty' ? 'The records have changed.' : 'Review the current batch records.'}</strong>
          <p>Choose Review packages to assess the current quotes, confirmation, resources and permissions together.</p>
        </div>
      )}
      {before && (
        <section className="previous" aria-label="Previous calculation">
          <h3>Previous calculation</h3>
          <Recommendation summary={before} earlier />
          <p className="footnote">
            Retained for comparison. {current
              ? 'The current result above uses the updated records.'
              : 'This earlier result does not assess the current edits.'}
          </p>
        </section>
      )}
      <p className="boundary">
        A passing package is a proposal for review. Recorded permissions are not
        authenticated approval. The screen does not order replacements, perform
        repairs, rehearse a checkout or complete the handoff.
      </p>
    </section>
  );
}

export default function App() {
  const desk = useGiftReview();
  const fileInput = useRef(null);
  const [fileError, setFileError] = useState('');

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setFileError('');
      if (file.size > 50000000) throw new Error('The case file must be smaller than 50 MB.');
      desk.importCaseText(await file.text());
    } catch (error) {
      setFileError(error.message);
    }
  }

  return (
    <>
      <header className="site-header">
        <div><strong>Decision Lab</strong><span>Team app · React SDK example</span></div>
        <span className="demo-tag">Fictional teaching records</span>
      </header>
      <main>
        <div className="page-heading">
          <div><p className="eyebrow">Event operations</p><h1>Gift-kit Handoff Desk</h1><p>Which complete correction package can we put forward before the kits leave?</p></div>
          <div className="file-actions">
            <button type="button" onClick={() => fileInput.current.click()} disabled={!desk.config}>Import case</button>
            <button type="button" onClick={desk.downloadCase} disabled={!desk.caseData || desk.status === 'loading'}>Download case inputs</button>
            <input ref={fileInput} aria-label="Import case" type="file" accept=".json,application/json" onChange={importFile} hidden />
          </div>
        </div>
        <Issues issues={fileError ? [{ message: fileError }] : []} />
        <section className="samples" aria-label="Worked cases">
          <h2>Start with a prepared case</h2>
          <div className="sample-cards">
            {desk.cases.map(entry => (
              <button
                key={entry.id}
                type="button"
                className="sample-card"
                aria-label={entry.label}
                aria-pressed={desk.selectedCaseId === entry.id}
                onClick={() => desk.selectCase(entry.id)}
              >
                <strong>{entry.label}</strong><span>{entry.description}</span>
              </button>
            ))}
          </div>
        </section>
        {desk.caseData && desk.draft ? (
          <>
            <BatchBasis caseData={desk.caseData} config={desk.config} />
            <div className="desk-layout">
              <div className="input-column">
                <QuoteForm draft={desk.draft} config={desk.config} editQuote={desk.editQuote} />
                <ConfirmationForm draft={desk.draft} editConfirmation={desk.editConfirmation} />
              </div>
              <Results desk={desk} />
            </div>
          </>
        ) : (
          <section className="panel">
            <p role="status">{desk.status === 'loading' ? 'Loading the pinned app and batch records…' : 'The batch could not be loaded.'}</p>
            <Issues issues={desk.issues} />
          </section>
        )}
        <footer>
          React collects and displays records. The pinned app and SDK evaluate the rules.
          <span>No automatic save; download inputs to retain edits.</span>
        </footer>
      </main>
    </>
  );
}
