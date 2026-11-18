# Gifting samples

These projects form a two-step walkthrough for an event operations team:
screen independent gift-kit campaigns, then review a campaign needing attention.
Both pin the same app configuration and use the same native case inputs.

| Step | Project | Run from the repository root |
| --- | --- | --- |
| Screen campaign batches | [Gift-kit Preflight](gift-kit-preflight/README.md), a Node.js application using the public CLI | `npm run demo:gifting:cli` |
| Review a flagged campaign | [Gift-kit Handoff Desk](gift-kit-handoff-desk/README.md), a React application using the public SDK | `npm run dev:gifting:react` |

Run preflight, open its HTML report and download a flagged campaign's `case.json`.
In the React desk, choose **Import case**, open that file and select **Review
packages**. The coordinator can update a quote, timing or vendor confirmation
and reassess the complete correction, rehearsal and handoff plan. Both clients
preserve existing permission scopes; importing a case does not accept an approval.

One-hour and one-day scenario sets come from
[one maintained input source](../../examples/gifting/clients/README.md).
Each standalone project includes generated copies, so it can run outside this
checkout. Run `npm run check:gifting:clients` to check those copies, and
`npm run test:gifting:clients` to exercise the actual CLI-exported file in the
production React app and compare native outputs.

Use `npm run test:cli-apps` for the CLI samples,
`npm run test:gifting:react` for SDK/form tests, or
`npm run test:gifting:react:browser` for the desk's production-browser checks.
Each project README documents independent installation and the exact input,
timing and interpretation boundaries.

See [all sample domains](../README.md).
