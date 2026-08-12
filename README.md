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
| **`PredgeOracle`** — outcome resolution | [`0xF160AbE664C34CF4C117101b4308bb16325a1ABc`](https://testnet.arcscan.app/address/0xF160AbE664C34CF4C117101b4308bb16325a1ABc) |
| Pre-commit — signed call recorded while the market was still open | [`0x6c602e9f…d52d83db`](https://testnet.arcscan.app/tx/0x6c602e9fb2e5f4ad272779bb44f620b5966dff111decde7053230cffd52d83db) |
| Resolution — outcome welded to that commitment | [`0xfc5494b1…95363fe5da`](https://testnet.arcscan.app/tx/0xfc5494b132552936ba49c6bccc289ee9199ad8233460116cf427cc95363fe5da) |

## The resolution layer — **Cachet** (`PredgeOracle`)

> *Pli cacheté* — the sealed envelope. From the 1600s, scientists claimed a discovery
> they could not yet publish by lodging it in a form nobody could read but everybody
> could later verify: Galileo announced Saturn's rings as an anagram, Hooke did the
> same for his law of elasticity, and the Académie des Sciences kept sealed envelopes
> whose seal and date proved afterwards who knew first — while making it impossible to
> quietly revise the claim. A commitment scheme, three centuries before the term existed.

Arc gives prediction markets USDC gas, onchain FX, compliance and deterministic
finality. What it has no deployed answer for is *what actually happened* — Circle's own
reference implementation resolves through a mock whose admin pushes the result. Cachet is
that missing layer, and its guarantee is structural rather than a promise:

1. **Commit first.** `commitMarket` records `keccak256` of the ed25519-signed call
   **while the market is still open**; the chain timestamps it.
2. **Then resolve.** `postResolution` **reverts** unless that market was committed
   first — so an outcome can never be chosen with hindsight.
3. **Never rewrite.** A resolution is written exactly once. There is no edit path,
   no upgrade, no admin override — not even the publisher can change it.

That is the property token-vote oracles lack, where a vote can rewrite "truth"
after the money is known. Any Arc contract settles against it through free views
(`getResolution` / `isResolved` / `outcomeOf` / `commitLeadTime`) — monetisation
stays on the x402 data API, because an oracle you must pay to read is not an oracle.

Watch the chain enforce both refusals live:

```
npm run oracle:demo
# [1/5] resolving an uncommitted market   -> reverted: NotCommitted
# [5/5] rewriting a settled resolution    -> reverted: AlreadyResolved
```

## Verify a resolution without trusting us

```
node verify-cachet.mjs <marketId>          # or: --platform polymarket --ref <marketRef>
```

`verify-cachet.mjs` is a single standalone file. It imports **no Predge code**, holds no
secret, and needs nothing but a public Arc RPC endpoint. Read it before you trust it —
that is the point. It checks, in order:

1. **the chain's own record** — resolved outcome, and that the commitment timestamp
   precedes the resolution. Nobody can revise this; the contract has no edit path.
2. **the bytes behind the hash** — `keccak256(canonical)` must equal the contentHash the
   chain recorded, proving the bytes you are reading are the bytes that settled.
3. **the ed25519 signature** over exactly those bytes.
4. **the signing key** is listed *active* in Predge's published registry.
5. `--deep`: **the registry itself is anchored on Arc**, so even the key list is attested
   by the chain rather than by a web server that could be swapped tomorrow.

A fully verified resolution — every step, live, nothing skipped:

```
node verify-cachet.mjs 0x7bd8746e2832545a34ca4685d7a8972c7c862961a78366f812a166de8fc3ad0b --deep

[1] PASS  resolved as YES; committed 4s before the outcome was recorded
[2] PASS  keccak256(canonical) == the chain's contentHash · via on-chain (embedded)
[3] PASS  ed25519 signature valid · key a122cc09…d997e4
[4] PASS  key listed and active · kid a122cc095c0f7fe5
[5] PASS  registry hash anchored on-chain · sha256 3229c5f0…feb96f
VERIFIED
```

Follow what that does **not** rest on. The signed bytes came from the chain, not from us.
The key is published — and the published list is itself hash-anchored on Arc, so swapping
it out later would not go unnoticed. The only thing left to trust is arithmetic.

Any failure prints `FAIL` and exits non-zero. A verifier that cannot fail is decoration —
so here are two real failures it produces today:

- A resolution whose `attestationRef` is a **URL** fails at step 2 when that URL is gone:
  a hash whose preimage lives on someone's web server proves only that *something* was
  committed. Publish with `oracle.mjs resolve … --embed` and the entire signed envelope is
  written **on-chain**, so verification survives predge.io disappearing entirely.
- A resolution signed with an **ephemeral demo key** passes steps 1–3 and then fails at
  step 4, because a signature under an unpublished key proves only that *someone* signed.
  Set `ORACLE_SIGNING_KEY` to the key listed in the registry for a resolution that verifies
  end to end.

## The whole story in one command

```
npm run e2e
```

Runs the complete loop on Arc testnet and prints an explorer link for every step: the chain refuses
a hindsight resolution, Predge pre-commits its signed call, a real market deploys **bound to that
commitment**, two wallets stake native USDC on opposite sides, the outcome settles, the chain
refuses to rewrite it, the market settles **itself** from the oracle (no admin, no arguments), and
the winner claims real USDC while the loser is owed nothing.

A recorded run — [`ExampleMarket 0x0A63f412…0212CD`](https://testnet.arcscan.app/address/0x0A63f412B9Af24a92B04ad596F32D4568A0212CD):

| Step | Tx |
|---|---|
| Pre-commit (signed call, before the outcome) | [`0x844a01bb…d68dce45`](https://testnet.arcscan.app/tx/0x844a01bbe3ce10f8923f5af1f5a244aff956a9ed6857cba80b501a72d68dce45) |
| Stake 0.02 USDC on YES | [`0xee590559…8213e0fc`](https://testnet.arcscan.app/tx/0xee590559c237115f71410a5df0453297bd7a59203d9a8a422e4dc5fb8213e0fc) |
| Stake 0.01 USDC on NO | [`0xf228b0e2…b02ea8554`](https://testnet.arcscan.app/tx/0xf228b0e2d3313d3fdb5bee8d5553440b7621c3363701fdec8364dd8b02ea8554) |
| Resolution — 17s after the commitment, welded to it | [`0x9f1ffcdc…5e6561f7`](https://testnet.arcscan.app/tx/0x9f1ffcdce02fb8befc3b6e1106fc7bb902421e621bab386788c03ac45e6561f7) |
| Market settles itself from the oracle → PAYOUT_YES | [`0xaebeb45f…22f46be3`](https://testnet.arcscan.app/tx/0xaebeb45f2fff344c3d8ac8d4582354dd034eb210883fba075f335e0322f46be3) |
| Winner claims 0.03 USDC (own stake + the losing pool) | [`0x89dfe559…4f2dbe813b`](https://testnet.arcscan.app/tx/0x89dfe5590e81c8b3b808f219f5a5f63233e361b7c541fafdc0773e4f2dbe813b) |

Four refusals in that run came from deployed code, not from a README: `NotCommitted`,
`AlreadyResolved`, `BettingClosed` (no risk-free bet once the outcome is known) and
`NothingToClaim`.

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

## Signal-Vault — an agent manages an on-chain USDC posture (DeFi track)

Same repo, second leg. `PredgeSignalVault` (contracts/PredgeSignalVault.sol) is a
minimal native-USDC vault on Arc whose **posture** — `SHORT / FLAT / LONG` a
synthetic exposure — is steered only by Predge's **ed25519-signed** smart-money
whale consensus. It depends on no external DeFi protocol (Arc testnet is thin):
deposits are plain `msg.value`, depositors can always withdraw, the owner can
pause, and posture changes only through
`rebalance(bytes32 signalHash, int8 direction, string attestationRef)` — callable
only by the keeper. Every rebalance emits the signal hash + attestation reference,
so the vault's whole decision history is auditable on-chain.

```
 vault-keeper.mjs (agent + keeper)            PredgeSignalVault (Arc)
 ────────────────────────────────            ──────────────────────
 1. sense   signed whale consensus  ──┐
    (live x402  OR  self-signed sample) │
 2. verify  ed25519 off-chain:         │   trust boundary: the keeper verifies
    JCS-canonical + DER-prefix key,    │   the signature OFF-chain and commits
    PIN to /.well-known/predge-keys    │   signalHash = keccak256(canonical) +
 3. decide  net_flow / smart_wallets / │   attestationRef ON-chain, so anyone
    direction  ->  SHORT|FLAT|LONG     │   can re-verify the keeper's inputs for
 4. act    rebalance(hash,dir,ref) ────┴──►  free via Predge's registry + /verify
```

**Trust boundary (disclosed):** verifying ed25519 in Solidity is expensive, so
the keeper verifies the Predge attestation off-chain (`node:crypto`, DER prefix
`302a300506032b6570032100` + raw 32-byte key, signature over the JCS-canonical
bytes, then key-pinned to the live registry) and records the signal hash +
reference on-chain. The vault **trusts the keeper**; the keeper's inputs are
**independently verifiable** by anyone via Predge's free registry and `/verify`.
It never rebalances on a signal that fails verification.

Live on Arc testnet ([full lifecycle + tx table in HACKATHON.md](HACKATHON.md#defi-track--signal-vault)):
vault [`0x8B9589B8…E74495`](https://testnet.arcscan.app/address/0x8B9589B8F5857dDe080Ac68e8B370c3bA5E74495),
deposit, then two verify-gated rebalances (**FLAT→LONG**, **LONG→SHORT**) and a
correct no-op **HOLD**.

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

# --- Signal-Vault (DeFi track) ---
npm run test:vault                    # unit-test the verifier + decision rule
npm run deploy-vault                  # deploy PredgeSignalVault to Arc (writes vault/deployment.json)
node vault-keeper.mjs deposit 0.01    # deposit native USDC into the vault
node vault-keeper.mjs run --sample riskon   # signed signal -> verify -> decide -> rebalance (LONG)
node vault-keeper.mjs run --sample riskoff  # a flip -> rebalance (SHORT)
node vault-keeper.mjs state           # read the vault's on-chain posture + last signal
npm run vault:smoke                   # zero-spend connectivity check of every surface
# real signed feed instead of the sample (needs a funded Base buyer wallet):
#   npm install @x402/fetch @x402/evm viem
#   BUYER_PRIVATE_KEY=0x… node vault-keeper.mjs run --live
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

contracts/PredgeSignalVault.sol  DeFi-track vault: signal-driven USDC posture on Arc
script/deploy-vault.mjs          compile + deploy PredgeSignalVault (solc 0.8.26)
vault-keeper.mjs                  the agent: sense -> verify(ed25519) -> decide -> rebalance
vault/signal.mjs                 signed consensus (live x402 or self-signed sample)
vault/attest.mjs                 offline ed25519 verify + JCS canonical + registry key-pin
vault/decide.mjs                 transparent posture rule (SHORT/FLAT/LONG)
vault/vault.mjs                  Arc plumbing (ABI, deposit, rebalance, read state)
vault/samples.mjs                frozen sample consensus payloads (prod shape)
vault/config.mjs, vault/test.mjs config + unit tests (verifier + decision rule)
```

## Env

Copy `.env.example` → `.env`. Testnet keys only, never committed. `ARC_RPC`
defaults to `https://rpc.testnet.arc.io`; the public RPC rate-limits, so every
chain call retries transient `-32011` errors with backoff.
