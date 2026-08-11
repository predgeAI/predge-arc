# Predge — «Don't Blink» ad · frame spec

Kinetic-typography ad in the Apple "Don't Blink" style. Single self-contained
`ad.html` played in a headless browser and recorded to mp4. Everything is our
own pixels — no AI-generated footage, no screen capture.

- **Length:** ~45.7s · **39 frames** · **93 beats @ 125 BPM** (matched to the track).
  Note: after adding a beat to the TG frame (#24), frame timings from #25 on shift +~0.5s vs the table below.
- **Aspect:** 16:9, 1920×1080
- **Source:** `ad.html` (the whole ad — CSS/JS, all screens, all copy)
- **Repo:** `predgeAI/predge-arc` (push with `GH_TOKEN=$(gh auth token --user predge-ai)`)

---

## Frame-by-frame (at 125 BPM; beats × 0.48s)

Legend: `▸` = text card, `▪` = product-screen mockup, **amber** = the amber accent word.

### ACT 1 — the hook: trust problem (0.0–8.2s)
| # | t | b | frame |
|---|---|---|---|
| 1 | 0.0 | 2 | ▸ "Anyone can post" |
| 2 | 1.0 | 2 | ▸ "a ~~winning~~ screenshot." |
| 3 | 1.9 | 2 | ▸ "…after the outcome." (dim) |
| 4 | 2.9 | 2 | ▸ "Predge signs every call" |
| 5 | 3.8 | 3 | ▸ **"before it."** |
| 6 | 5.3 | 2 | ▸ "Not after." |
| 7 | 6.2 | 2 | ▸ "ed25519 — signed while the market is still open" |
| 8 | 7.2 | 2 | ▸ **"Tamper-evident by construction."** |

### ACT 2 — breadth: not one market (8.2–18.2s)
| # | t | b | frame |
|---|---|---|---|
| 9 | 8.2 | 2 | ▸ "Not just prediction markets." |
| 10 | 9.1 | 2 | ▸ [Polymarket logo] "Polymarket whales." |
| 11 | 10.1 | 3 | ▪ **feedScreen** — live whale feed, `15,753,076` count-up |
| 12 | 11.5 | 3 | ▪ **kalshiScreen** — `$2.41M` count-up institutional prints |
| 13 | 13.0 | 2 | ▸ [Kalshi logo] "Kalshi institutional flow." |
| 14 | 13.9 | 3 | ▪ **sportsScreen** — `1,284` + emblems (Super Bowl/World Cup/UFC/NBA) |
| 15 | 15.4 | 2 | ▸ "Sports outcomes." |
| 16 | 16.3 | 2 | ▸ "On-chain activity." |
| 17 | 17.3 | 2 | ▸ **"Every signal — signed."** |

### ACT 3 — the scale (18.2–20.6s)
| # | t | b | frame |
|---|---|---|---|
| 18 | 18.2 | 2 | ▸ "1,000,000+ smart-money wallets scored" |
| 19 | 19.2 | 3 | ▸ `15,700,000` count-up — "signals — every one verifiable" |

### ACT 4 — three audiences, agents first (20.6–30.2s)
| # | t | b | frame |
|---|---|---|---|
| 20 | 20.6 | 2 | ▸ **"Agents get an API."** |
| 21 | 21.6 | 3 | ▪ **termScreen** — x402: 402 → pay USDC → signed data |
| 22 | 23.0 | 2 | ▸ "Pay per call. USDC. No account. No key." |
| 23 | 24.0 | 2 | ▸ **"Traders get alerts."** |
| 24 | 25.0 | 4 | ▪ **tgScreen** — Telegram "Predge Alerts" bot, 2 bubbles: 👁 *Watching wallet* (Steel Whale #53 · 0x7a3f…e2 added to watchlist) → 🐋 *It just moved* (YES $40k, signed) |
| 25 | 26.4 | 3 | ▪ **appScreen** — terminal dashboard, 24h stats count-up + insider watch |
| 26 | 27.8 | 3 | ▪ **checkerScreen** — wallet verdict (win-rate, edge, signed) |
| 27 | 29.3 | 2 | ▸ **"Business licenses the proof."** |

### ACT 5 — verify + skin in the game (30.2–37.9s)
| # | t | b | frame |
|---|---|---|---|
| 28 | 30.2 | 2 | ▸ "Verify it yourself." |
| 29 | 31.2 | 2 | ▸ **"Offline."** |
| 30 | 32.2 | 3 | ▪ **arcscanScreen** — Paid event = the access credential |
| 31 | 33.6 | 2 | ▸ "You never take our word for it." |
| 32 | 34.6 | 2 | ▸ "We stake on our own calls." |
| 33 | 35.5 | 3 | ▪ **stakesScreen** — staked signal: wrong→refunded, right→Predge keeps (capital-safe) |
| 34 | 37.0 | 2 | ▸ **"Wrong? You're refunded."** |

### ACT 6 — multichain + close (37.9–44.2s)
| # | t | b | frame |
|---|---|---|---|
| 35 | 37.9 | 2 | ▸ "Settling on" |
| 36 | 38.9 | 4 | ▸ **chainsBand** — Base · Solana · Arc + Bitcoin-L2 · Polygon · ERC-8004 |
| 37 | 40.8 | 3 | ▸ **"The smart money, signed before the outcome."** |
| 38 | 42.2 | 2 | ▸ "And all of it —" |
| 39 | 43.2 | 2 | ▸ **logoClose** — "PREDGE." wordmark + predge.io (hard cut) |

---

## Product-screen mockups (all CSS in `ad.html`, no personal data)

| function | shows | live animation |
|---|---|---|
| `feedScreen` | predge.io live whale feed | `15,753,076` count-up, rows stagger, live dot |
| `kalshiScreen` | Kalshi institutional flow | `$2.41M` count-up |
| `sportsScreen` | signed sports outcomes | `1,284` count-up, emblem row pops in |
| `termScreen` | agent.mjs x402 loop | blinking caret |
| `tgScreen` | Telegram "Predge Alerts" bot — wallet-watch → signed alert | two bubbles slide in (2nd delayed .55s) |
| `appScreen` | terminal dashboard | 4 stats count-up, insider rows stagger |
| `checkerScreen` | wallet verdict card | pill pop, value glow |
| `arcscanScreen` | Arc Paid receipt | blinking caret |
| `stakesScreen` | staked signal (skin in the game) | value glow |
| `chainsBand` | multichain close | logo row pop |

## Logos

- **Canonical wordmark** — the **real predge.io header logotype**: **Syne ExtraBold**,
  `PREDGE` in amber `#f5a623` + `.` in `#e8e8f0`.
  - `ad-assets/predge-wordmark.svg` — **primary**, Syne outlined to `<path>` curves
    (font-independent, scalable). Used in `logoClose` (final frame) + the thumbnail.
  - `ad-assets/predge-wordmark.png` — raster export (transparent, 5084×736) for
    places that need a bitmap.
  - **Always use these files for the wordmark** — never retype it in another font.
    Regenerate the outline: instantiate `Syne[wght].ttf` at wght=800 in a clean
    arm64 fonttools venv, draw glyphs `PREDGE.` with SVGPathPen (+.01em tracking).
- **Official SVGs** (in `ad-assets/logos/`): Solana, Polygon, Bitcoin.
- **Rebuilt SVGs** (inline in `ad.html`, brand-accurate from the owner's references):
  Base (circle+bar), Arc (arch), Polymarket (bowtie), Kalshi (green mark).
- **Sport emblems** (inline): american football, soccer ball, UFC octagon,
  basketball — generic sport glyphs, **no NFL/FIFA/UFC trademarks**.
- To swap in exact official files: drop `base.svg` / `polymarket.svg` /
  `kalshi.svg` / `arc.svg` in `ad-assets/logos/` and point the mockups at them.

## Audio

- **Tiger Rhythm — Surkin**, 125 BPM, used **under the owner's written permission**.
- File `ad-audio/tiger.mp3` and the music cut `predge-ad-music.mp4` are
  **gitignored** — the public repo stays music-free (permission covers the
  owner, not open redistribution). Music starts at the **drop (4.0s)**.
- **TG notification SFX** — `ad-audio/tg-notify.mp3` (gitignored), a Telegram
  "message received" ding, mixed in at **~25.5s** (when the tgScreen bot appears,
  right after "Traders get alerts"). Mixed with `normalize=0` so the music bed
  doesn't duck; `alimiter` prevents clipping.
- **Punch ending** — the music **hard-stops (~50ms cut) at ~44.15s**, exactly as
  the final **PREDGE** logo punches in; the logo then holds ~1.5s in silence.
  (These timestamps are tied to the current recording's lead-in — if frames move,
  re-derive with the frame-montage method: `ffmpeg -ss T -i predge-ad.mp4 -vf fps=10,tile`.)

---

## Pipeline (regenerate the video)

```bash
cd predge-arc
node record-ad.mjs                       # plays ad.html headless → rec/*.webm
WEBM=$(ls rec/*.webm | head -1)
# silent cut (committed):
ffmpeg -y -i "$WEBM" -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -r 30 -movflags +faststart predge-ad.mp4
# music cut (owner only, gitignored) — Tiger from the drop + TG ding + punch ending.
# DING_MS = tgScreen onset in ms (~25500). CUT = logo onset − ~0.05s (~44.15). Re-derive both via frame montage if the cut changes.
ffmpeg -y -i "$WEBM" -ss 4.0 -i ad-audio/tiger.mp3 -i ad-audio/tg-notify.mp3 \
  -filter_complex "[1:a]afade=t=in:st=0:d=0.2,afade=t=out:st=<CUT>:d=0.05[m]; \
    [2:a]adelay=<DING_MS>|<DING_MS>,volume=0.95[ding]; \
    [m][ding]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.98[a]" \
  -map 0:v:0 -map "[a]" -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -r 30 \
  -c:a aac -b:a 192k -shortest -movflags +faststart predge-ad-music.mp4
```

`DURATION_MS` in `record-ad.mjs` must be ≥ the ad length (`~ Σbeats × 0.48s`).

## How to edit

- **Copy / order / add a frame:** the `FRAMES` array in `ad.html`. Each entry is
  `{ b: <beats>, ...T('type'|'screen', <html>) }`.
- **Tempo:** `const BPM` (retimes the whole cut; keep it = the track's BPM).
- **A cut's duration:** its `b` (beats). Screens want ≥3 for the count-up to read.
- **A screen's content:** its `*Screen()` function.
- **Entrances:** `punch` (type) / `screenIn` (screens) keyframes — kept blur-free
  and opacity-instant so fast cuts don't smear or flash black.

## Adding new-functionality frames later

1. Write a `newFeatureScreen()` mockup function (copy an existing one's structure).
2. Insert `{ b:3, ...T('screen', newFeatureScreen()) }` into the right ACT in `FRAMES`.
3. Add a lead-in text card if needed.
4. Re-run the pipeline. Check length stays ≲60s; nudge other `b` values down if tight.

## Guardrails

- Push only to `predgeAI` (never `latcomblockchain`); commit author = predge-ai noreply.
- Never commit `tiger.mp3` / `predge-ad-music.mp4` (licensed track).
- Mockups must carry **no personal data** (no real email / account).
- Sport/partner emblems: generic glyphs unless the owner supplies licensed files.
