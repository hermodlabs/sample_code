# Shipment Reservation Desk

A small React application for a logistics coordinator reviewing a shipment
before putting an arrangement forward for reservation. It uses the public
`@decision-lab/sdk` browser API and a pinned shipment app. The application has
its own forms and report layout; shipment requirements and preference rules
remain in the app configuration.

The working situation is specific: an order has three complete arrangements,
and Consolidated requires a confirmation covering the current order revision,
ship point and loading interval. A coordinator receives a revised quote or
confirmation and needs to reassess the arrangement without editing YAML.

The inputs are fictional. The background is the
[consolidated-freight example](https://www.hermodlabs.com/use-cases/supply-chain/shipment-readiness/add-consolidated-freight/)
and the [8th & Walton supplier case study](https://www.8thandwalton.com/blog/case-study-walmart-launch),
which describes order and freight-term corrections. This is a developer
example, not a deployment for that supplier.

## Run

Use Node.js 22.19 or later; Node.js 24 is recommended. This directory is an
independent npm project. React, Vite and the SDK are declared as normal npm
dependencies. There are no aliases into the SDK source tree.

The current `0.1.0` packages are local release candidates. Install the SDK and
the CLI test dependency from matching archives; React and the build tools are
ordinary npm dependencies:

```sh
cd react-app/shipment-reservation-desk
npm install --no-save --package-lock=false \
  /absolute/path/to/decision-lab-sdk-0.1.0.tgz \
  /absolute/path/to/decision-lab-cli-0.1.0.tgz
npm run dev
```

In a Decision Lab source checkout, `npm run release:pack` creates candidate
archives under `artifacts/npm/`. Once a compatible SDK is published, ordinary
`npm install` resolves the declared package. The CLI package is not a runtime
dependency of this React application; it is used only by the parity test.

From the repository root, the development commands build the local SDK before
starting this application:

```sh
npm run dev:shipment:react
npm run build:shipment:react
npm run test:shipment:react
npm run test:shipment:react:browser
```

`npm run build` in this directory creates the standalone production bundle.
Use `npm run preview` to serve that bundle. Serve the generated files over HTTP;
opening `dist/index.html` through `file://` cannot load the browser worker.

## What the coordinator does

1. Select one of the three prepared shipments, or import a complete case.
2. Review the order revision, expense limit, receiving deadline and reservation
   cutoff. These are the recorded basis, not approvals issued by this screen.
3. Update an arrangement's complete quote or the consolidation confirmation.
4. Run the review and inspect the recommendation, arrangement comparison and
   unmet conditions. Compare the result with the earlier calculation.
5. Download the case or complete review record for another tool or reviewer.

Editing a field makes the current calculation stale. The earlier result stays
available as a comparison, but the screen does not present it as a current
recommendation. An invalid entry or unfinished evaluation withholds the current
recommendation instead of falling back to an earlier favorable result.

| Prepared case | Expected result under the pinned rules |
| --- | --- |
| Confirmed slot · ORD-104 | Consolidated is preferred: $5,000, Thursday 6 p.m. |
| Revised order · ORD-105 | The slot covers revision 1, while the order is revision 2. Consolidated is blocked; Direct is preferred: $4,000, Friday noon. |
| Old permissions · ORD-106 | Selection and release permissions cover the old revision. No listed arrangement passes. |

The fixed fixture clock is Tuesday, November 17, 2026. These are repeatable
worked cases, not live reservation offers. See
[the data notes](public/data/README.md) for their exact source and assumptions.

## Integration boundary

```text
complete case + coordinator's record changes
                    |
                    v
       parse forms and preserve record scope
                    |
                    v
       SDK case binding and validation
                    |
                    v
       SDK evaluation in a browser worker
       using the pinned shipment app
                    |
                    v
       complete prepared report output
                    |
                    v
       team-specific comparison and handoff
```

The form maps values into canonical inputs. It does not decide whether a grant
is sufficient, a slot is valid, a plan fits the expense limit, or an arrangement
is preferred. Those conclusions come from the SDK's evaluation and prepared
report. Business labels in `public/data/config.json` change presentation only.

The complete case already contains readiness records, roles, calendars,
resources and permissions. A quote alone is insufficient. This screen edits
only the advertised quote and confirmation fields. It never copies the current
order revision onto an old permission or silently repairs a scope mismatch.
Obtain a correctly scoped record or supply a separately reviewed complete case.

Quotes are complete USD shipment expenses, including preparation, release and
transport. Amounts map to integer cents; there is no foreign-exchange conversion
or implicit fee calculation. Model times are whole minutes from
`2026-11-17T00:00:00-06:00`; the form and report use the configured fixed UTC
offset. A different time convention requires an explicit adapter change.

The report preserves preferred ties. A valid completed calculation with no
feasible arrangement is a business result. Cancellation, truncation, missing
report contexts or incomplete enumeration are unavailable results; a partial
witness is not enough to select the best arrangement.

## Portable review records

The screen evaluates a selected worked case on load. After an edit, use
**Review arrangements** to request a new calculation. There is no automatic
local-storage save: download a case or review record before leaving the page.

The case download contains canonical inputs, suitable for the CLI's case
validation and run commands. The review download is a
`shipment-reservation-review/1` JSON object containing `createdAt`, the exact
`appPackage`, the canonical `case`, the complete SDK `run`, and `previousRun`
when a comparison exists. JSON is a machine-readable exchange artifact; the
screen renders the findings as business tables and explanations.

Import accepts a canonical case, an SDK `decision-lab-case/1` bound to this
exact app, or a saved review record. A saved review must contain the pinned app
and a valid run for the same inputs. Importing a record never installs a new
app or changes rules. An incompatible binding or mismatched calculation is an
input error, not a reason to reuse the saved recommendation.

A complete blocked review can be downloaded. An unfinished calculation does
not produce a current recommendation or a completed review download. The
earlier complete calculation remains available as a comparison.

## Files

| File | Responsibility |
| --- | --- |
| `public/data/config.json` | Exact app binding, fixture locations, units, clock and business labels. |
| `public/data/shipment-review.app.json` | Unmodified published shipment app package. |
| `public/data/cases/` | Three complete canonical inputs, also reproducible through the CLI example. |
| `src/model.mjs` | Map form values into case inputs without changing other records. |
| `src/projection.mjs` | Project the prepared SDK report into the shipment comparison. |
| `src/sdk.mjs` | Public SDK admission, execution, pinned bindings and review artifact validation. |
| `src/controller.mjs` | Form state, evaluation lifecycle, cancellation and import/export. |
| `src/main.jsx` | Browser worker, static case loader, file downloads and React mounting. |
| `src/App.jsx` | Shipment-specific React screen. |
| `src/styles.css` | Responsive layout with ordinary page scrolling. |
| `test/` | Mapping and SDK checks, plus production browser coverage. |

The browser receives the copied package as static data. Loading another app
package does not automatically produce another suitable interface: this
example's forms and report projection target the three-arrangement shipment
profile. Broader domains need their own mappings and presentation.

To add a business requirement, publish and verify a new app release and update
the package pin deliberately. Do not implement a second rule in a React
condition after the SDK has evaluated the case.

## Reusing this example

Copy this directory into a team's application repository and install the SDK.
Replace the prepared case loader with the team's supported case source, then
adapt the forms and presentation. Keep the full underlying case and preserve
the source scope of confirmations and permissions.

The companion [CLI application](../../cli-app/shipment-exceptions/README.md)
imports company exports and evaluates independent shipments in a batch. Its
canonical case artifacts provide the same input basis as these fixtures. The
React example adds interactive record editing and a compact team view; it uses
the same reasoning contract.

Calculated recommendations require human review. This application does not
authenticate permissions, obtain approvals, reserve freight or establish that
work finished. It also does not allocate shared trucks, docks, workers or cash
across shipments. Each fixture stipulates its own independent resources; use a
combined planning model when those allocations compete.
