# Gift-kit Handoff Desk

A small React app for an event operations team preparing 120 QR gift kits.
It uses the public Decision Lab SDK to compare complete correction packages
before the handoff deadline. The form is specific to the team's task; the
requirements and preference rules come from a pinned app configuration.

This is the second step after [Gift-kit Preflight](../../cli-app/gift-kit-preflight/README.md).
The CLI reviews several batches from exports. This screen lets the coordinator
open one batch, enter a replacement quote or vendor confirmation, and review
the updated recommendation. Both use the same app and native case inputs.

## Run

Use Node.js 22.19 or later; Node.js 24 is recommended. This directory is an
independent npm project using React and Vite, without SDK source aliases or
imports from the Decision Lab interface.

In the Decision Lab checkout:

```sh
npm run dev:gifting:react
npm run build:gifting:react
npm run test:gifting:react
npm run test:gifting:react:browser
```

To copy this directory into another repository, install matching SDK and CLI
archives. They are currently `0.1.0` release candidates, rather than a promise
that these versions are available from the public registry:

```sh
cd react-app/gift-kit-handoff-desk
npm install --no-save --package-lock=false \
  /absolute/path/to/decision-lab-sdk-0.1.0.tgz \
  /absolute/path/to/decision-lab-cli-0.1.0.tgz
npm run dev
```

`npm run release:pack` in the Decision Lab checkout creates archives in
`artifacts/npm/`. The CLI is a development dependency used for parity tests.
Keep SDK optional dependencies enabled, because its browser entry includes
workbook modules that Vite must resolve. After compatible versions are
published, ordinary `npm install` can resolve the dependencies.

Run `npm run build` and `npm run preview` here for a production build. Serve the
build over HTTP; a browser worker cannot run from `file://`.

## What the example reviews

A batch can contain an unreadable printed code, the wrong destination, a
checkout fault, or several faults together. The team has five authored
packages: rehearse unchanged kits, replace inserts, repair destination and
checkout, perform both corrections in-house, or obtain an external replacement
and repair package. The model retains all eight declared fault combinations.
Choosing a package is not a diagnosis of which fault actually occurred.

Every complete package includes correction work, a fresh rehearsal and handoff.
The review checks the current quantity, budget, deadline, resources and scoped
permissions. External work additionally needs a recorded confirmation covering
the same batch, revisions, device, account and work interval. Among eligible
packages, the app prefers the earliest finish, then the lower complete cost.

The teaching records are fictional:

| Prepared case | Result after **Review packages** |
| --- | --- |
| Confirmed external booking · GIFT-120 | External replacement and repair is preferred: $400, finish at minute 20. |
| Revised insert, older booking · GIFT-121 | Permission covers insert revision 4, but the external confirmation covers revision 3. In-house replacement and repair is preferred: $300, finish at minute 35. |
| Revised insert, older permissions · GIFT-122 | The confirmation covers revision 4, but permissions cover revision 3. No listed package passes. |

A passing result describes a proposed complete plan. It does not establish
that corrections, rehearsal or handoff have already happened. Changing a
confirmation must not remove possible faults or update the scope of existing
permissions.

## Follow the SDK integration

Start with [`src/useGiftReview.js`](src/useGiftReview.js). The **Review packages**
handler contains the entire evaluation path:

```js
const inputs = buildCase(caseData, draft, config);
const snapshot = lab.cases.create({ app, inputs });
const validation = lab.cases.validate({ app, case: snapshot });
// Display validation.issues and return if validation.valid is false.
const result = await lab.run({
  app,
  case: snapshot,
  execution: { signal: controller.signal, timeoutMs: 15000 },
  reportOptions: { scope: 'all', locale: 'en-US' },
});
```

The hook creates `lab` with `createDecisionLab({ executor })` and the public
`createBrowserExecutor()`. An effect loads the app and initial case, verifies
the configured app binding, and owns worker cleanup. React StrictMode exercises
that setup/cleanup lifecycle in development. An abort controller plus a request
counter prevents a superseded evaluation from replacing newer form state.

Cases load without running automatically. Editing immediately marks the
recommendation as needing reassessment and retains the previous calculation
for comparison. Only a complete assessment supplies a current recommendation.
A complete assessment with no eligible package is a valid business result;
an incomplete evaluation is unavailable, rather than an approval or a finding
that every package failed.

The source has four small responsibilities:

| File | Responsibility |
| --- | --- |
| [`src/App.jsx`](src/App.jsx) | Team-specific forms, comparison table and previous/current findings. |
| [`src/useGiftReview.js`](src/useGiftReview.js) | React state, public SDK calls, case switching and cancellation. |
| [`src/gifting.js`](src/gifting.js) | Exact form conversions and selection of public SDK findings. |
| [`public/data/config.json`](public/data/config.json) | Pinned app identity, prepared case locations and business labels. |

The helper reads native findings through the SDK's public
`commitment.resolveCommitmentAssessment()` function. It does not reproduce the
model's constraints or implement a second preference rule in JavaScript.

## CLI to React handoff

1. Run the companion preflight demo and open its batch report.
2. For GIFT-121, use **Download case for the React desk** to locate the native
   `campaigns/GIFT-121/case.json` artifact.
3. In this app, select **Import case** and choose that file.
4. Select **Review packages**. The SDK should prefer in-house work, because
   the external confirmation still covers insert revision 3.
5. If the team actually receives a replacement confirmation, record its real
   reference, source, recorder, current revision and validity interval. For the
   fictional demonstration, change the confirmation insert revision to `insert-4` and
   review again. External work should become preferred.
6. Download **Case inputs** to retain the edited records or feed the canonical
   inputs to the CLI. Download **SDK run** for the full native report artifact.

The CLI and UI do not transfer an accepted approval. They share the same
recorded inputs and calculation contract. Import also accepts a native
`decision-lab-case/1` artifact bound to the pinned app. Archived run restoration
and custom review bundles are intentionally outside this tutorial.

## Data boundaries

The complete imported case includes people, permissions, resources, calendars
and bookings. A new quote alone does not provide those prerequisites. The form
updates only package quotes and one external confirmation; it preserves the
remaining records exactly. It rejects cases containing several current
confirmations instead of silently choosing one.

Amounts are complete package costs in USD, converted exactly to integer cents.
There is no foreign exchange conversion. Quoted quantity is an exact package
quantity, not a capacity that automatically covers any smaller batch. All times
are whole elapsed minutes on the case's preparation clock; they are not a live
wall clock. Retain and deliberately update the recorded review time when
preparing a real case.

There is no automatic local storage save. Download inputs before leaving if
you need to retain edits. The screen does not authenticate a permission, obtain
approval, book vendor capacity or complete any work. Separate batch results
also do not establish that several batches can share the same resources at
the same time.

To extend the example, replace the prepared case source and adapt the forms or
labels. A new business requirement belongs in a reviewed app release, followed
by a deliberate update of the pin. A React filter applied after evaluation
would create a competing rule system.
