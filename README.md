# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/raraaeth/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/raraaeth/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

PreToken Radar — a token launch radar built from a sealed DefiLlama snapshot (758 protocols). It ranks protocols that record no token by an implied value derived only from the snapshot's own figures: a per-category market-cap/TVL median multiple taken from already-trading protocols in the same snapshot, adjusted for 7-day TVL momentum, protocol age since listing, and chain reach. The board covers all 40 watchlist protocols plus early candidates (178 rows), each with a concrete farm plan (steps with amounts, cost and time estimates). The static dashboard is sortable and filterable, with a per-protocol detail view showing the model breakdown, category comparables and the farm plan.

## Run it

```sh
node main.ts --input /path/to/snapshot.json
```

Writes board.json, data.js, dashboard/, screenshots/ and dossier.json to the output directory (MAKEFUN_OUTPUT_DIR, default /output).

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
