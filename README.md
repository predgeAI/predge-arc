# predge-arc — agents buy whale intelligence with native USDC on Circle Arc

[Predge](https://x402-api-production-266e.up.railway.app) is a live pay-per-call
API selling Polymarket whale intelligence to AI agents (x402 protocol, ed25519-signed
responses, no API keys, no accounts). This repo is its **Circle Arc leg**: an
autonomous agent with its own Arc wallet pays for a data route **in native USDC**
through the deployed `PredgeSettlement` contract, and the on-chain `Paid` receipt
**is** the access credential — the gateway verifies the receipt (or finds the
event itself) and releases the data.

Bonus: `anchor.mjs` freezes the head of Predge's tamper-evident signed-calls
hash chain into an Arc receipt, so the audit trail can't be rewritten — not even
by us.

## Live on Arc testnet (chainId 5042002)

| What | Link |
|---|---|
| `PredgeSettlement` contract | [`0x3474Bd2747cb1D430C2F56050433fa5D6b1C82A5`](https://testnet.arcscan.app/address/0x3474Bd2747cb1D430C2F56050433fa5D6b1C82A5) |
| Agent purchase — `/v1/whales/latest`, $0.005, redeemed by tx hash | [`0x153ee694…3b8c96`](https://testnet.arcscan.app/tx/0x153ee694c352baff424ddf770021196edac2f25a3649dedefad042c4263b8c96) |
| Agent purchase — `/v1/wallets/leaderboard`, $0.01, gateway found the event itself | [`0x6296c95b…a082f5`](https://testnet.arcscan.app/tx/0x6296c95b4bdb7c363d79ba0374f7e2c7ebc0f63adc81524c23b2a7ac3fa082f5) |
| Hash-chain anchor (live key registry) | [`0x99e60bfa…7745e6`](https://testnet.arcscan.app/tx/0x99e60bfa7ebd187e5893854f747552126250d9b8b75d4ba84c523a9c817745e6) |

Reproduce the anchored digest yourself:

```
curl -s https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json | shasum -a 256
# 914c69c95a77fdc8f1f5b632855ea41752eee75886b09604affe272180c8ece9 — the hash in the tx meta above
```

## How it works

```
 agent.mjs (own Arc wallet)          arc-gateway (NO private key)         Circle Arc testnet
 ──────────────────────────          ────────────────────────────         ──────────────────
 1. GET /v1/whales/latest  ────────► 402 + quote
                                     {contract, route_hash, amount_wei,
                                      request_id}
 2. payForRoute(route_hash,          ─────────────────────────────────►   PredgeSettlement
    request_id) {value: amount}                                           emits Paid(payer,
                                                                          route, amount, ts,
                                                                          meta=request_id)
 3. GET …  X-Arc-Payment: <tx> ────► verifies the Paid receipt  ◄───────  reads receipt/logs
    (or just ?request_id=…   ────►   …or scans Paid events for
     and let the gateway watch)       the request_id memo)
 4.                        ◄──────── 200 + data + receipt info
```

- **USDC is Arc's native token** — `msg.value` *is* the payment. No ERC-20
  approvals, no gas token juggling: the money and the gas are the same asset
  the agent already holds.
- **The gateway holds no key.** It only reads Arc. Funds accumulate in the
  contract; the owner withdraws via the contract's own `withdraw()`.
- **One payment, one unlock.** `request_id` is single-use; replays get `409`.

## Run it

Requires Node 20+.

```bash
npm install

# one-time wallet setup (testnet only; keys live in gitignored .env)
npm run genwallet        # operator wallet — fund at faucet.circle.com (Arc Testnet, USDC)
npm run setup-agent      # agent's own wallet, auto-topped-up from the operator

# terminal 1 — the seller
npm run gateway          # http://localhost:8402  (GET / lists the catalog)

# terminal 2 — the buyer
npm run agent                                        # $0.005 whale trades, redeem by tx hash
node agent.mjs --route /v1/wallets/leaderboard --watch  # gateway finds the payment event itself

# anchor the audit trail on Arc
node anchor.mjs --keys                # anchor sha256 of the live predge-keys.json
node anchor.mjs --hash <64-hex>       # anchor a signed-calls chain-head content hash
node anchor.mjs --verify <64-hex>     # prove a hash is anchored (scans Paid events)
```

The contract is already deployed; `npm run deploy` only exists to reproduce it
from source (`contracts/PredgeSettlement.sol`, solc 0.8.26, optimizer 200 runs).

## Endpoints (gateway)

| Route | Price | Notes |
|---|---|---|
| `GET /v1/whales/latest` | $0.005 | Latest Polymarket whale trades |
| `GET /v1/wallets/leaderboard` | $0.01 | Top wallets ranked by edge, not raw win rate |
| `GET /v1/status/:requestId` | free | Quote payment status (gateway scans Arc) |
| `GET /v1/receipts/:txHash` | free | Decode any `Paid` receipt |
| `GET /` , `GET /health` | free | Catalog / liveness |

Prices mirror the production x402 price card. **Data honesty:** production sells
live data on Base + Solana; every production data route is paid, so this demo
serves frozen samples in the exact production response shapes, labeled
`data_source: "sample"`. The quotes, payments, receipts and verification are
all real and on-chain. No production credentials are embedded anywhere.

## Files

```
contracts/PredgeSettlement.sol   settlement + receipt contract (deployed pre-hackathon)
script/deploy.js                 compile + deploy + first settlement tx
script/genwallet.js              operator wallet generator
script/setup-agent.mjs           agent wallet generator + top-up
lib/arc.mjs, lib/env.mjs         shared chain plumbing / env loader
gateway/server.mjs               arc-gateway (402 quote → on-chain verify → unlock)
gateway/catalog.mjs              what's for sale + sample payloads
agent.mjs                        autonomous buyer demo
anchor.mjs                       hash-chain anchoring + verification CLI
```

## Env

Copy `.env.example` → `.env`. Testnet keys only, never committed. `ARC_RPC`
defaults to `https://rpc.testnet.arc.io`; the public RPC rate-limits, so every
chain call retries transient `-32011` errors with backoff.
