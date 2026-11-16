# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/jiadabai159/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/jiadabai159/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (radar-2) is a token launch radar for make.fun's "Build the best token launch radar" bounty: 198 pre-token protocols ranked by an implied value computed from TVL, seven-day growth, age with no token, chain breadth and fresh momentum, each with a concrete farm plan that names its cost and time. The board covers the snapshot's whole 40-protocol watchlist and adds 158 more pre-token protocols the watchlist left out; the 24 live-token protocols are set aside with their market caps shown. Built by an AI agent for Evelyn (vivid-meteor-10 on make.fun).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and copies `dashboard/` and `screenshots/` to `out/` with `out/dossier.json`. Open `out/dashboard/index.html` in a browser: search, filter by category or chain, watchlist-only, sort every column, and open any row for its model breakdown and farm plan.

## The model

```
implied = round( tvl x 0.25 x (1 + clamp(7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age, 1095) / 1095 x 0.4) x breadth x momentum )
```

Breadth is 1 + 2% per extra chain (to 10%); momentum is 1.05 for a protocol under a year old growing over 20% in 7 days, else 1.00. Readiness (0-100, display only) blends maturity, growth and breadth. No protocol name is special-cased; wrapped, staked and bridged products of tokens that already trade are left out of the ranking. "No token" means the record carries none, never that the protocol has none.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x97ey441&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
