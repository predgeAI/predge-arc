# Сценарий записи демо-видео Arc (RU-инструкция, EN-озвучка)

> Цель: 3-минутное demo/pitch видео для Arc «Programmable Money» (Encode × Circle).
> Судьи международные → **озвучка и титры на английском**. Инструкции ниже — на русском.
> Проверено вживую 09.08: полный цикл покупки прошёл (tx в блоке 56113764), gateway health OK, оба кошелька funded.

## ПОДГОТОВКА (до записи, 5 минут)

1. **Дофандить agent-кошелёк** (сейчас ~0.011 USDC, впритык): faucet.circle.com (Arc Testnet) на адрес `0x19C12E3f391dfC6Ee031ec68C7D8a9e3AdF3e410` — чтобы точно хватило на несколько дублей. Operator (`0xEc7A34…6223`) = 19.9 USDC, его хватает.
2. Два окна терминала рядом, шрифт ≥16pt, ширина ~100 колонок (чтобы tx-хэши не переносились).
3. Вкладки браузера заранее: (а) arcscan `testnet.arcscan.app`, (б) `https://x402-api-production-266e.up.railway.app/` (prod Predge).
4. В терминале 1 заранее: `cd ~/Documents/Playground/predge-arc && npm run gateway` — дождаться строки `listening on http://localhost:8402` и `key held NONE`. **Стартуй gateway ДО записи** — его загрузка не часть истории.
5. НЕ показывать `.env` и приватные ключи на экране.

---

## ЗАПИСЬ — 3 минуты

### [0:00–0:20] Холодный вход. Сразу запускаем покупку.
**Действие:** терминал 2 — набери `node agent.mjs` и **нажми Enter сразу, до слов.** Пусть 402→оплата→данные печатаются, пока говоришь.
**Озвучка (EN):**
> "This is an AI agent with its own wallet, buying market intelligence for half a cent — paid natively in USDC on Circle Arc. No API key, no account, no card. The whole loop takes about twelve seconds. Here's what just happened."

### [0:20–0:55] Разбор покупки — курсором по строкам вывода.
**Действие:** прокрути вывод agent, показывай шаги [1/6]…[6/6].
**Озвучка (EN):**
> "Step one — it asked for whale trades and got an HTTP 402 quote: contract, route hash, amount, one-time request id. Step three — it called payForRoute, and here's the Arc part: `msg.value` **is** the USDC. Money and gas are the same asset — no approvals, no bridges. Then the gateway verified the on-chain Paid receipt and released the data. And step six — replaying the same payment gets a 409. One payment, one unlock."
**Действие:** клик по строке `https://testnet.arcscan.app/tx/0x42b4…` (или свежий хэш) → показать Paid event на arcscan ~3 сек.

### [0:55–1:20] Не-кастодиальность + что такое Predge.
**Действие:** переключись на терминал 1 (gateway), покажи строку `key held NONE`. Потом вкладка prod Predge JSON.
**Озвучка (EN):**
> "The seller holds **no private key** — it can only read the chain; funds live in the contract, only the owner withdraws. And this isn't a hackathon mock: Predge is a live pay-per-call API selling Polymarket whale intelligence — over twenty routes, every response ed25519-signed. Arc is where settlement finally becomes native."

### [1:20–2:00] Дифференциатор — anchoring, доказываем вживую.
**Действие:** терминал 2 — `node anchor.mjs --keys` (заякорить хэш реестра ключей), потом набери на камеру:
```
curl -s https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json | shasum -a 256
```
**Озвучка (EN):**
> "Our signed responses are tamper-evident, but a hash chain can't stop the operator rewriting history wholesale. So we freeze the chain head into an Arc receipt. This digest — computed right now from our live key registry — is the exact hash sitting in the Arc transaction. Anyone can reproduce it. Now not even we can rewrite our own audit trail."

### [2:00–2:40] Второй трек — DeFi Signal-Vault.
**Действие:** терминал 2:
```
node vault-keeper.mjs run --sample riskoff
node vault-keeper.mjs state
```
Покажи, как keeper проверяет ed25519-подпись off-chain и ребалансит on-chain (LONG→SHORT). `state` покажет posture на цепочке.
**Озвучка (EN):**
> "Same repo, the DeFi track: an agent-run USDC vault on Arc whose posture is steered only by Predge's signed whale consensus. The keeper verifies the signature off-chain, commits the signal hash on-chain — so the vault's entire decision history is auditable. Every rebalance is one signed signal, one on-chain move."

### [2:40–3:00] Финал — на arcscan.
**Действие:** вкладка arcscan с контрактом `0x3474Bd27…`.
**Озвучка (EN):**
> "Everything is live on Arc testnet — the contract, both purchases, the anchor, the vault. Predge on Arc: agents pay in the money they already hold, and every byte they buy comes with a receipt."

---

## Команды-шпаргалка (терминал 2)
```bash
node agent.mjs                                  # [0:00] покупка whale ($0.005)
# (клик по arcscan-ссылке из вывода)
node anchor.mjs --keys                          # [1:20] заякорить реестр ключей
curl -s https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json | shasum -a 256   # живое воспроизведение хэша
node vault-keeper.mjs run --sample riskoff      # [2:00] DeFi ребаланс LONG→SHORT
node vault-keeper.mjs state                     # posture на цепочке
```

## Если дубль сорвётся
- RPC иногда rate-limit'ит — скрипты retry'ят сами, пауза читается как «реальное время цепочки», продолжай говорить.
- `409` при повторном `agent.mjs` с тем же request_id — это НЕ ошибка, это и есть replay-protection (можно даже показать намеренно).
- Кончился баланс agent — дофандить faucet, подождать блок.

## После записи
- Залить на YouTube **unlisted** (как делали для Prava), ссылку — в форму Encode + в HACKATHON.md.
- Длина ≤ 3 минуты (требование).
