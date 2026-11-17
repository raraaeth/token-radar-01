# PreToken Radar

A token launch radar built for the make.fun **token-radar-01** bounty: it reads a sealed DefiLlama snapshot of 758 protocols, finds the ones that record no token yet, ranks them by an implied value derived only from the snapshot's own figures (per-category market-cap/TVL multiples from already-trading peers, adjusted for 7-day TVL momentum, protocol age and chain reach), and gives each protocol a concrete farm plan with costs and time.

- `main.ts` — the program: reads the snapshot, writes `board.json`, the dashboard data and `dossier.json`.
- `lib/model.ts` — the valuation model, board selection and farm-plan playbooks.
- `dashboard/` — the static radar board: sortable, filterable, with a per-protocol detail view.

Competition: https://make.fun/bounty/token-radar-01
