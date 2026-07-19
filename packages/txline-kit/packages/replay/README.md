# @txline-kit/replay

A wire-compatible replay server for [TxLINE](https://txline.txodds.com) match
data. Fetch a finished fixture's real history and replay it at any speed —
your app (or any `@txline-kit/client` consumer) can't tell it apart from the
live API. Part of [txline-kit](https://github.com/addargBackup/txline-kit).

## Install
```bash
npm install -D @txline-kit/replay
```

## Why
Judges/reviewers often evaluate your app *after* the live event ends. This
package is how your demo still works: pull a real match into a local corpus
once, then replay it on demand, forever, at whatever speed you like.

## Usage
```bash
# pull a finished match (start time 6h-2wk in the past) into ./corpus
npx txline-replay fetch --fixture 18209181

# replay it wire-compatibly at 30x
npx txline-replay serve --fixture 18209181 --speed 30
```

```ts
import { createTxlineClient } from "@txline-kit/client";

// identical consumer code — only the constructor changes:
const tx = createTxlineClient({ network: "replay", baseUrl: "http://localhost:8788/api" });
```

Playback control while the server is running:
```bash
curl -X POST localhost:8788/control -d '{"action":"speed","value":60}'
curl -X POST localhost:8788/control -d '{"action":"seek","value":1783627253085}'
curl -X POST localhost:8788/control -d '{"action":"pause"}'
```

Also exposes `startReplayServer()` and `fetchFixture()` programmatically —
see the root repo's `agent/src/demo.ts` and `keeper/src/demo-replay.ts` for
real one-command demo harnesses built on it.

## Author

Built by [addargBackup](https://github.com/addargBackup) · [@addarg7](https://x.com/addarg7)

MIT licensed.
