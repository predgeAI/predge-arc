# Predge intro v3 · spec (revision 2)

Product-launch style ad: one idea per scene, a big left-aligned headline and a live product
panel that does what the headline says. Light canvas for the product scenes, dark cinematic
opener and closer, amber accent. Cut to Surkin "Tiger Rhythm" (the original "Don't Blink" track).

- **Length:** 61.68 s · 128.5 beats @ 125 BPM · 12 scenes, ~45 on-beat events. Ends on the track's own decay (0.3 s tail fade).
- **Aspects:** 1920x1080 master, 1080x1080, 1080x1920 (`node build.mjs 169|sq|vt`).
- **Engine:** HyperFrames 0.8.143 composition (`index.html`, one paused GSAP timeline, seek-safe),
  rendered with `npx hyperframes render`; audio muxed with ffmpeg (`render-all.sh`).
- **Pixels:** all our own (HTML/CSS/SVG). No AI images or video, no screen capture, no stock photos.
  The opener background is a generated gradient mesh with an animated light leak and film grain.
- **Personas are generic** ("a lending desk", "an agent", "a vault", "a trader") and every persona
  scene carries a "Product illustration" label. The trader scene is labelled **Coming soon**:
  @predge_alerts_bot sends whale-trade and watched-wallet alerts today, not dispute or settlement alerts.
  No customer, revenue, win-rate or edge claims.

## Scenes (1 beat = 0.48 s; video t=0 = track 0.27 s)

| # | beats | time (s) | scene | music |
|---|---|---|---|---|
| 1 | 0–8 | 0.00–3.84 | Opener: wordmark, "Know when an outcome is actually final." | intro |
| 2 | 8–22 | 3.84–10.56 | Hook, Montana Grizzlies vs. Idaho Vandals O/U 151.5: "A market resolves." / "Someone disputes it." (DISPUTED stamp on beat 12) / "Resolved is not final." (settles Over on beat 17) | drop 1 |
| 3 | 22–32 | 10.56–15.36 | "Predge reads the disputes on-chain.": UMA OO, adapter, Polygon logs into Predge; out to signed record, API · x402, free signed check, on-chain guard; pull-back into the drop | break on 28–32 |
| 4 | 32–44 | 15.36–21.12 | 3,005 · 2,666 · 323 · 33.5% (853 of 2,543), stations swap in place every 3 beats; each count-up lands 2 beats after its cut | drop 2 |
| 5 | 44–56 | 21.12–26.88 | A lending desk: "Price the risk before it settles." Chip to Disputed (beat 48), LTV 60% to 0% and borrowing power $57,610 to $28,690 land on beat 51, cursor opens the record (beat 53) | |
| 6 | 56–70 | 26.88–33.60 | An agent: "Agents pay per call." / "No account. No API key." (beat 63). Keycap on 57.3, 402, pay 0.03 USDC on Arc, 200 signed; free settlement check, verify, decision | breakdown from 61 |
| 7 | 70–83 | 33.60–39.84 | A vault: "Funds wait for final." Release blocked: MarketDisputed (72.5), stepper to Final, release succeeds (79.8); "Contracts on Solana · Arc · Arbitrum One" | breakdown |
| 8 | 83–96 | 39.84–46.08 | A trader (Coming soon): "Know before it costs you." Lock-screen alert, chat, Open record, "Final: Over" | breakdown |
| 9 | 96–108 | 46.08–51.84 | "Every answer is signed." / "Verify, don't trust." (beat 102), offline verify, Valid, checked fields light up | final section |
| 10 | 108–118 | 51.84–56.64 | "One signed answer: is it final?" hub, tiles on 110, 111.5, 113, 114.5; exit upward | |
| 11 | 118–124 | 56.64–59.52 | "Know when an outcome is actually final." (dark) | |
| 12 | 124–128.5 | 59.52–61.68 | End card on the last hit: wordmark, predge.io · app.predge.io · @PredgeAI | decay, 0.3 s tail fade |

Frame-edge rule: no text crosses the frame edge at any frame, mid-transition included. Seam and
text-cut travel is 100 px on 16:9 and 56 px on 1:1 and 9:16; arrival zooms stay at or below 1.12.
Checked frame by frame on all three aspects with a DOM bounds script (zero findings).

Seams follow one current (left, cut-the-curve, ±230 px, mirrored power4) with the grid ground
sliding on every seam as the carrier. Reserved vectors: zoom-through out of the opener, pull-back
into the drop and arrival on the drop, upward exit from the hub (conclusion), arrival on the end card.

## On-screen claims and sources

| Claim | Source |
|---|---|
| 3,005 UMA disputes on Polymarket; 2,666 markets disputed; 323 disputed twice or more and sent to a UMA vote; 853 of 2,543 settled disputed markets (33.5%) settled differently from the disputed proposal; 1 Jan to 2 Oct 2026 | `context` block of `GET api.predge.io/v1/settlement-risk/1137824`, read 9 Oct 2026 (`evidence/settlement-risk-1137824.json`); same figures as v2 |
| Montana Grizzlies vs. Idaho Vandals O/U 151.5, Polymarket market 1137824: proposal Under disputed 9 Jan 2026 04:38:50 UTC, one dispute, settled on-chain Over, uma_state settled, risk_level resolved | same record; ed25519 signature checked offline with Node crypto (valid) and `payload` re-canonicalises to `canonical` |
| Trader scene (Coming soon) | `apps/bot` in predgeAI/predge (main, 8 Oct 2026): whale-trade alerts, wallet watchlist and digests only; no dispute or settlement alerts yet |
| Signature prefix/suffix `8c5a4c46...67379209`, kid `13fa3d18a369e6c7` | same record (the signature changes on each fetch because `checked_at` changes; this is the saved one) |
| Settlement-risk check is free and signed; paid routes are x402, 0.03 USDC for `/v1/signals/consensus`, accepted on Base · Arc · Solana · Algorand | `api.predge.io` root, read 9 Oct 2026 (same price v2 used) |
| `check_settlement` reverts with `MarketDisputed`; settled + cooling period before release; Solana devnet | predgeAI/predge-solana-guard README |
| Contracts on Solana · Arc · Arbitrum One | v2 spec (guard on Solana devnet; bond/arbiter contracts on Arc and Arbitrum One) |
| @predge_alerts_bot | `api.predge.io` description |
| Lending desk rows (Rate decision, Season MVP), values, LTVs; vault amount; agent decision text; trader dispute/final alerts | product illustrations, labelled as such |

Copy rules held: no em dashes; never "flipped", "edited rules", "payout", "markets settle wrong";
no win rate, edge, PnL, customer or revenue claims; no third-party verification claims;
no ERC-8434 mention; Robinhood Chain not shown.

## Audio

Surkin "Tiger Rhythm", used with the artist's written permission to Predge; see
`../ad-assets/MUSIC-LICENSE.md`. The mp3 stays in gitignored `../ad-audio/`. Measured 125.0 BPM,
first downbeat at track 0.27 s (video t=0). Drop 1 on beat 8 (video 3.84 s), drop 2 on beat 32
(video 15.36 s, numbers scene), last hit on beat 124 (59.52 s, end card), then the track's own
decay with a 0.3 s tail fade at 61.68 s.

## Pipeline

```bash
cd ad-v3
node build.mjs            # src/ad.html -> index.html (16:9). Edit src/ad.html, never index.html.
npx hyperframes check     # lint + layout + contrast
node edgecheck.mjs $PWD/index.html 1920 1080   # every frame: no text across the frame edge
npx hyperframes snapshot --at 1.5,3.5,...   # stills for review
./render-all.sh 169 sq vt # renders/predge-intro-v3-<ar>.mp4, 2 workers, nice 10
```
