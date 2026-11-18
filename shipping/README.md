# Shipping samples

Two standalone integrations use the same pinned consolidated-shipment app:
one reviews company exports in batches, and the other gives a coordinator a
focused interface for reviewing an individual shipment. Both evaluate complete
arrangements against the recorded requirements and preserve the supporting scope.

| Step | Project | Run from the repository root |
| --- | --- | --- |
| Review shipment exports | [Shipment exceptions](shipment-exceptions/README.md), a Node.js application using the public CLI | `npm run demo:shipment:cli` |
| Review one shipment | [Shipment Reservation Desk](shipment-reservation-desk/README.md), a React application using the public SDK | `npm run dev:shipment:react` |

The CLI importer combines order, quote and confirmation snapshots with explicitly
retained case records. It compares the assessed results with an earlier batch
and produces readable HTML/CSV reports. The React desk lets a coordinator update
quotes and scoped confirmations, reassess the same rules, and inspect blockers.
Both include the same fictional outcomes for current records, an old slot
confirmation and old permissions.

To continue from a batch result, open the CLI's HTML report and locate the
shipment's `case.json` under the output's `shipments/` directory. Use **Import
case** in the React desk, update only the records the team has actually received,
and choose **Review arrangements**. The desk's **Case inputs** download can also
be supplied to the public CLI. The transferred file contains recorded inputs;
it does not convey an approval or reserve freight.

Run `npm run test:cli-apps` for the CLI tests,
`npm run test:shipment:react` for SDK/form tests, and
`npm run test:shipment:react:browser` for production-browser checks and CLI
agreement. Each project README documents copying and running that project
independently with the public package archives.

See [all sample domains](../README.md).
