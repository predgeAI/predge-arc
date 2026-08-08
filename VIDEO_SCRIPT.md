# Demo video script — 3:00

Format: screen recording (terminal + browser), voiceover. Two terminals side
by side: left = gateway, right = agent. Browser tabs pre-opened: Predge prod
API root, Arc explorer contract page. Practice once; the on-chain waits are
5–15 s each, which the script absorbs.

---

**[0:00–0:15] Hook — cold open on the agent terminal.**

> "This is an AI agent with its own wallet buying market intelligence — paying
> half a cent in USDC, natively, on Circle Arc. No API key, no account, no
> card. Watch the whole loop."

(Type `node agent.mjs`, don't run yet.)

**[0:15–0:40] Context — what Predge is.**

Switch to browser: prod API root JSON.

> "Predge is a live pay-per-call API selling Polymarket whale intelligence to
> agents — over twenty routes, five thousandths of a dollar to three cents,
> responses ed25519-signed. It runs on the x402 protocol today. The problem:
> settlement happens on chains where USDC is just another token — approvals,
> gas juggling, bridges. On Arc, USDC *is* the native token. So we rebuilt the
> settlement leg Arc-native."

**[0:40–1:00] The seller — gateway terminal.**

Show gateway startup lines (`npm run gateway`).

> "The seller is this gateway. It quotes prices as HTTP 402 and — key detail —
> holds **no private key**. It can only *read* the chain. Payments go straight
> into the settlement contract; only the owner can withdraw."

**[1:00–2:00] The purchase — run `node agent.mjs`.**

Narrate over the six steps as they print:

> "One — the agent asks for whale trades and gets a 402: contract address,
> route hash, amount, and a one-time request id."
> "Two — the agent's own wallet, holding a few cents of testnet USDC."
> "Three — it calls `payForRoute` on the PredgeSettlement contract. `msg.value`
> IS the USDC — that's the Arc magic, money and gas are the same asset."
> "Four — mined. The receipt is a `Paid` event carrying the request id."
> "Five — the agent retries with the tx hash; the gateway verifies the receipt
> on-chain and unlocks the data. There it is: whale trades, wallet scores."
> "Six — replay attempt with the same payment: rejected, 409. One payment, one
> unlock."

Click the printed explorer link, show the `Paid` event briefly.

> "That's the receipt on Arc — payment, access credential, and audit record in
> one event."

**[2:00–2:40] The differentiator — anchoring.**

Run `node anchor.mjs --keys` (or show the pre-run output), then
`node anchor.mjs --verify <hash>`.

> "Predge responses are signed and hash-chained — tamper-evident. But a hash
> chain alone can't stop the operator rewriting history wholesale. So we
> anchor the chain head into an Arc receipt. This run hashes our live public
> key registry — anyone can reproduce the digest with curl and shasum — and
> freezes it on-chain. `--verify` finds it again by scanning `Paid` events.
> Now even we can't rewrite our own audit trail. That's what agents buying
> intelligence actually need: not promises — receipts."

**[2:40–3:00] Close.**

Explorer tab on the contract page.

> "Everything you saw is live on Arc testnet — the contract, both purchases,
> the anchor; the links are in the repo. Production Predge sells this data
> today over x402 on Base and Solana; Arc makes the settlement native. Predge
> on Arc: agents pay in the money they already hold, and every byte they buy
> comes with a receipt."

---

Recording notes:
- Terminal font ≥16pt; window ~100 columns so tx hashes don't wrap.
- If the public RPC rate-limits mid-take, the scripts auto-retry — keep
  talking, the pauses read as real chain time.
- Pre-fund the agent (`npm run setup-agent`) BEFORE recording.
- Do not show `.env` or any private key on screen at any point.
