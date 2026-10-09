# Predge intro v3 · spec (revision 4: black, readable, on the beat)

Kinetic product ad on one black ground (near-black with the opener's soft amber glow and grain) for the
whole film; amber only for key words and numbers; product UI sits on the black. Cut to Surkin
"Tiger Rhythm" (the original "Don't Blink" track) on the 125 BPM grid.

- **Length:** 61.68 s · 128.5 beats · **54 shots, average 1.14 s**. Default shot 2 beats (0.96 s); a full bar
  for lines over about 4 words; UI punch-ins hold 2 beats each and are cut into 2 to 4 beat runs.
- **Readability:** a headline stays on screen whole; long ones build in on beats (never replaced word by
  word), max about 6 words per frame, big type. Every text element is at full opacity for at least
  2 beats (0.96 s) and builds leave the last part on screen for at least 2 beats.
- **Motion:** hard cuts on the beat; inside a shot a snap on the cut and a slow push-in (3%). Half-beat
  snaps only for the logo hits; whips only at section boundaries; 2-frame flashes only on the two drops.
- **Aspects:** 1920x1080 master, 1080x1080, 1080x1920 (`node build.mjs 169|sq|vt`). UI punch-ins are framed
  per aspect inside a crop window; 1:1 and 9:16 use tighter targets (chip and LTV, borrowing power,
  Release and Released) so text stays large on a phone.
- **Engine:** HyperFrames 0.8.143 composition (`index.html`, one paused GSAP timeline, seek-safe),
  rendered with `npx hyperframes render`; audio muxed with ffmpeg (`render-all.sh`).
- **Pixels:** all our own (HTML/CSS/SVG). No AI images or video, no screen capture, no stock photos.
- **Personas are generic** ("a lending desk", "an agent", "a vault", "a trader"); persona UI shots carry
  "Product illustration". The trader section is labelled **Coming soon**: @predge_alerts_bot sends
  whale-trade and watched-wallet alerts today, not dispute or settlement alerts.
  No customer, revenue, win-rate or edge claims.

## Shot list (beats; 1 beat = 0.48 s; video t=0 = track 0.27 s)

Source of truth: the `S` array in `src/ad.html`.

| beats | section | shots |
|---|---|---|
| 0–8 | intro: wordmark; "Settlement risk for prediction markets." | 2 |
| 8–32 | drop 1 (flash): "A market resolves." · market card · DISPUTED · "Someone disputes it." · Disputed row · "Resolved is not final." · Settled on-chain: Over · "Predge reads the dispute on-chain." · pipeline (2) | 10 |
| 32–44 | drop 2 (flash): 3,005 UMA disputes on Polymarket · 2,666 markets disputed · 323 disputed twice or more · 323 sent to a UMA vote · 33.5% of settled disputed markets · settled differently from the disputed proposal (853 of 2,543 · 1 Jan to 2 Oct 2026) | 6 |
| 44–56 | a lending desk: persona · "Price the risk before it settles." · desk + risk toast · Disputed chip + LTV 60% to 0% · borrowing power $28,690 | 5 |
| 56–70 | an agent: persona · "Agents pay per call." · return key · 402, 0.03 USDC, pay on Arc · "No account. No API key." · 200 signed, free settlement check, resolved · verify valid, decision | 7 |
| 70–82 | a vault: persona · "Funds wait for final." · Release · Blocked: MarketDisputed · Settled, Cooling, Final · Released 12,500 USDC | 6 |
| 82–96 | a trader (coming soon): persona + Coming soon · "Know before it costs you." · lock-screen alert · Disputed message · signed record + Final: Over · "Coming soon to @predge_alerts_bot" | 6 |
| 96–108 | proof: "Every answer is signed." · record · Under/Over and signature · "Verify, don't trust." · offline verify · Valid | 6 |
| 108–118 | "One signed answer: is it final?" · hub (tiles on half-beats) · Contracts on Solana · Arc · Arbitrum One | 3 |
| 118–128.5 | close: "Know when an outcome / is actually final." · wordmark (last hit) · wordmark + predge.io · app.predge.io · @PredgeAI | 3 |

## Checks

- `edgecheck.mjs`: every frame of all three aspects, no visible text crosses the frame edge (text inside a
  crop window is skipped; the window is always inside the frame). Clean on all three.
- `sync-check.py video.mp4 1.5 src/ad.html`: measures the beat grid from the render's own audio (onset
  peaks, least squares: 125.08 BPM, residual 6 ms) and finds every designed cut in the video by frame
  differencing. Revision 4, 16:9: 52/53 cuts found, median offset to the beat grid 10.8 ms, p90 24 ms,
  max 38 ms, 51/52 within one frame. 1:1: 10.1 ms median, 52/53 within a frame; 9:16: 11.6 ms, 49/52.

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
python3 sync-check.py renders/predge-intro-v3-169.mp4 1.5 src/ad.html   # cut-to-beat offsets from the render
npx hyperframes snapshot --at 1.5,3.5,...   # stills for review
./render-all.sh 169 sq vt # renders/predge-intro-v3-<ar>.mp4, 2 workers, nice 10
```
