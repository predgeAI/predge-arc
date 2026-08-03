# Submission — Arc "Programmable Money" Hackathon (Encode Club × Circle)

**Tracks:** Agentic Economy + DeFi (one repo, one story, two legs)
**Project:** Predge on Arc — agents buy verifiable whale intelligence with native
USDC, and an agent-run vault manages an on-chain USDC posture from that signal
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

## DeFi Track — Signal-Vault

The Agentic Economy leg proves an agent can *buy* verifiable intelligence with
native USDC. The DeFi leg proves the same intelligence can *manage money* on
Arc: **an autonomous agent runs an on-chain USDC vault whose posture is steered
only by Predge's ed25519-signed smart-money whale consensus.**

**What it is.** `PredgeSignalVault` (contracts/PredgeSignalVault.sol) is a
minimal, self-contained native-USDC vault on Arc — no external DeFi protocol
(Arc testnet is new and thin, so the vault depends on nothing but Arc itself).
Anyone deposits native USDC (`msg.value` — no ERC-20 approvals) and can always
withdraw their own funds. The vault holds a **posture** — `SHORT (-1)` /
`FLAT (0)` / `LONG (+1)` a synthetic exposure — changed *only* through
`rebalance(bytes32 signalHash, int8 direction, string attestationRef)`, callable
only by the authorized **keeper** set at deploy. Each rebalance emits a
`Rebalanced` event carrying the signal hash + attestation reference, so the
vault's entire decision history is auditable on-chain.

**Why it's honest DeFi.** It is on-chain USDC position management driven by a
*verifiable external signal*. The edge comes from the signal (Predge's
outcome-verified smart-money consensus); the trust comes from the attestation
(ed25519, key registry, key pinning). The vault never moves on an unverified
signal — the keeper aborts if the signature or key-pin fails.

**The keeper trust boundary (disclosed).** Verifying ed25519 in Solidity is
expensive, so the keeper (`vault-keeper.mjs`) verifies the Predge attestation
**off-chain** with `node:crypto` — the exact recipe published at
`data.predge.io/attest-verification.md`: rebuild the SPKI key from the DER prefix
`302a300506032b6570032100` + the raw 32-byte ed25519 point, verify the 64-byte
signature over the JCS-canonical bytes, confirm the payload re-canonicalises to
those bytes, and **pin** the key to an active key in the live registry
(`/.well-known/predge-keys.json`). The vault then stores `signalHash =
keccak256(canonical)` and `attestationRef` on-chain. So the vault **trusts the
keeper**, but the keeper's inputs are **independently re-verifiable by anyone**
for free (Predge's registry + `/verify`), and the exact signed bytes are
committed on-chain via `signalHash`. This is the same "anchor an off-chain proof
onto Arc" idea as `anchor.mjs`, applied to money movement.

**Decision rule (transparent, unit-tested — vault/decide.mjs).** Pick the top
market in the consensus; `net = net_flow_usd`, `wallets = smart_wallets`. `LONG`
if `direction==yes` and `net ≥ +FLOW_MIN_USD`; `SHORT` if `direction==no` and
`net ≤ −FLOW_MIN_USD`; else `FLAT`; and only if `wallets ≥ MIN_SMART_WALLETS`. A
rebalance tx fires only when the target posture differs from the on-chain posture
(it trades flips, not every poll).

### Live vs simulated

**Live on Arc testnet — the whole vault lifecycle ran on-chain:**

| Step | Tx / address |
|---|---|
| `PredgeSignalVault` deployed (keeper set at deploy) | [`0x8B9589B8…E74495`](https://testnet.arcscan.app/address/0x8B9589B8F5857dDe080Ac68e8B370c3bA5E74495) |
| Deposit 0.01 native USDC | [`0xd00fad94…f70b6`](https://testnet.arcscan.app/tx/0xd00fad94305e13338ed9fe7cb1c21f8bb9996c09fd0ff3815846a08ad0af70b6) |
| Rebalance #1 — signal → verify → **FLAT → LONG** | [`0x5d378476…644ed3`](https://testnet.arcscan.app/tx/0x5d3784763c25452ec8eb4acb09ec7b16f1dba180989fad05f6e7f7190c644ed3) |
| Rebalance #2 — signal flips → **LONG → SHORT** | [`0xef0b8620…8b2681`](https://testnet.arcscan.app/tx/0xef0b862002de4f94e9fba60168096d18d24d6f493a971173eed1cd728d8b2681) |
| Deploy tx | [`0xbe9feb55…622310`](https://testnet.arcscan.app/tx/0xbe9feb551b1f8985b53d63122a009616e89ce742eb8a73f260b3745a07622310) |

A third poll on the same signal correctly **HELD** (no tx) — the agent doesn't
churn gas when smart money hasn't changed its mind.

**Simulated / clearly-labeled:** the *signal* used for the live rebalances above
is a **self-signed sample** in the exact production consensus shape. The live
paid feed (`GET /v1/signals/consensus`, $0.03) settles in USDC on **Base
mainnet**, which needs a funded Base buyer wallet this testnet repo intentionally
does not carry — so the keeper self-signs a sample with an **ephemeral ed25519
key** (loudly logged: "NOT the live Predge key") purely so the *verification path
runs end-to-end*. The Arc side — deploy, deposit, verify-gated rebalance, the
on-chain decision history — is **fully real**. To drive it from the real signed
feed, set `BUYER_PRIVATE_KEY` and run with `--live` (see README); the keeper then
pins the signature to Predge's production key `13fa3d18…016352d9`.

## Run it

See README.md — `npm install`, `npm run gateway`, `npm run agent` (Agentic
Economy), and `npm run deploy-vault` → `npm run vault:run` (DeFi). Wallets are
testnet-only, generated locally, funded via https://faucet.circle.com.
