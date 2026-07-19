# @txline-kit/constants

Stat-key algebra, game phases, event enums, and odds math for the
[TxLINE](https://txline.txodds.com) sports data API. Part of
[txline-kit](https://github.com/addargBackup/txline-kit) — see the root
README for the full SDK (client, replay server, and why it exists).

## Install
```bash
npm install @txline-kit/constants
```

## What's in it
```ts
import { STAT, PERIOD, statKey, parseStatKey, PHASE, isLive, isFinalised, pctToProbability } from "@txline-kit/constants";

statKey(STAT.T1_CORNERS, PERIOD.H2);   // 3007 — "2nd-half home corners"
parseStatKey(3007);                     // { base: 7, period: 3000 }

isLive(PHASE.H2);                       // true
isFinalised(scoreUpdate);               // true only on the game_finalised record

pctToProbability("52.632");             // 0.52632 — de-margined implied probability
```

Every helper here reflects the *live wire format*, not just the OpenAPI spec —
notably `isLive`/`isFinalised` read `StatusId`, not `GameState` (which stays
`"scheduled"` for an entire live match on the real feed).

## Author

Built by [addargBackup](https://github.com/addargBackup) · [@addarg7](https://x.com/addarg7)

MIT licensed.
