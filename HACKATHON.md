# Submission — Arc "Programmable Money" Hackathon (Encode Club × Circle)

**Track:** Agentic Economy
**Project:** Predge on Arc — agents buy verifiable whale intelligence with native USDC
**Chain:** Circle Arc testnet, chainId `5042002`

## Problem

AI agents are becoming paying API customers, but the API economy is built for
humans: sign-up forms, API keys, credit cards, monthly plans. An agent can't
pass KYC and shouldn't hold a card. Pay-per-call crypto payments (x402) fixed
the request loop, but settlement still happens on general-purpose chains where
USDC is "just another ERC-20" — agents juggle gas tokens, approvals and
bridges before they can spend a half-cent.

Arc changes the substrate: **USDC is the native token**. The money an agent
holds *is* the gas it spends and the value it pays with. That collapses the
entire payment stack for machine customers into one primitive: `msg.value`.

## Product

Predge already sells Polymarket whale intelligence to agents in production —
a live x402 API (https://x402-api-production-266e.up.railway.app) with
per-call USDC pricing ($0.005–$0.03), ed25519-signed responses, and a public
key registry (`/.well-known/predge-keys.json`). No accounts, no keys: the
wallet is the customer.

This hackathon build is the **Arc-native leg** of that product:

1. **`arc-gateway`** — a seller service that quotes a price as an HTTP 402
   response (`contract`, `route_hash`, `amount_wei`, `request_id`), then
   watches Circle Arc for the matching `PredgeSettlement.Paid` receipt and
   releases the data only after on-chain verification. It verifies either a
   presented tx hash **or discovers the payment event itself** by scanning for
   the `request_id` memo. The gateway holds **no private key** — it can read
   the chain, not touch funds (funds accrue in the contract; only the owner
   can `withdraw()`).
2. **`agent.mjs`** — an autonomous buyer with its own Arc wallet:
   discover → 402 → `payForRoute(route_hash, request_id)` with native USDC →
   confirm → redeem → prove replay protection (second redemption gets `409`).
3. **`anchor.mjs`** (differentiator) — Predge's paid calls are hash-chained
   and signed server-side; a hash chain proves order but a malicious operator
   could still rewrite history wholesale. This CLI freezes the chain head into
   an Arc `Paid` receipt (`node anchor.mjs --hash <sha256>`), turning a
   tamper-*evident* log into a tamper-*proof* one — externally anchored on a
   ledger we don't control. `--verify` scans Arc and proves any hash is
   anchored; `--keys` anchors the live ed25519 key registry so even key
   rotation history is auditable.

## Proof it runs (all live on Arc testnet)

| Step | Tx |
|---|---|
| Contract `PredgeSettlement` | [`0x3474Bd27…C82A5`](https://testnet.arcscan.app/address/0x3474Bd2747cb1D430C2F56050433fa5D6b1C82A5) |
| Agent buys `/v1/whales/latest` ($0.005), redeems by tx hash | [`0x153ee694…3b8c96`](https://testnet.arcscan.app/tx/0x153ee694c352baff424ddf770021196edac2f25a3649dedefad042c4263b8c96) |
| Agent buys `/v1/wallets/leaderboard` ($0.01), gateway finds the event itself | [`0x6296c95b…a082f5`](https://testnet.arcscan.app/tx/0x6296c95b4bdb7c363d79ba0374f7e2c7ebc0f63adc81524c23b2a7ac3fa082f5) |
| Hash anchor of the live key registry | [`0x99e60bfa…7745e6`](https://testnet.arcscan.app/tx/0x99e60bfa7ebd187e5893854f747552126250d9b8b75d4ba84c523a9c817745e6) |

The anchored digest is independently reproducible:
`curl -s https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json | shasum -a 256`
→ `914c69c9…c8ece9`, the exact hash inside the tx `meta`.

## What was built during the hackathon vs pre-existing

**Pre-existing (disclosed):**
- The Predge production x402 API on Base + Solana (live product, unchanged).
- `contracts/PredgeSettlement.sol` and its deployment to Arc testnet at
  `0x3474Bd27…C82A5` (deployed 27 Jul 2026, before the hackathon build), plus
  `script/deploy.js` / `script/genwallet.js`.

**Built during the hackathon (this submission):**
- `gateway/` — the arc-gateway service (402 quoting, on-chain receipt
  verification, event-scan payment discovery, replay protection, receipt
  decoder, status endpoint).
- `agent.mjs` — the autonomous buyer agent.
- `anchor.mjs` — hash-chain anchoring + on-chain verification CLI.
- `script/setup-agent.mjs`, `lib/` shared plumbing, docs, and the live demo
  transactions above.

**Data honesty:** every production data route is paid, so the demo gateway
serves frozen sample payloads in the exact production response shapes, labeled
`data_source: "sample"` — no production credentials are embedded in this repo.
The quotes, payments, receipts, verification and anchoring are fully real.

## Why this fits "Agentic Economy"

- The buyer is an agent, the seller is an API for agents, and the settlement
  rail is Arc — machine-speed, machine-priced ($0.005 without card networks).
- The receipt is programmable money doing work: one `Paid` event is
  simultaneously the payment, the access credential, and an audit record.
- The anchor turns the same primitive into data-integrity infrastructure:
  agents that pay for intelligence can verify the seller's history was never
  rewritten — a trust requirement unique to machine-to-machine markets.

## Run it

See README.md — `npm install`, `npm run gateway`, `npm run agent`. Wallets are
testnet-only, generated locally, funded via https://faucet.circle.com.
