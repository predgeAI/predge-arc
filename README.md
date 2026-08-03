# predge-arc

Arc-native settlement leg of Predge's keyless x402 pay-per-call model.
`PredgeSettlement` (Circle Arc testnet) records per-route USDC payments and emits
a verifiable `Paid` receipt — the on-chain settlement leg (Circle grant Milestone 1).

- Chain: Circle **Arc testnet** (chainId **5042002**, native gas = USDC)
- RPC: `https://rpc.testnet.arc.io` · Explorer: `https://testnet.arcscan.app`

## Deploy
```
npm install
npm run genwallet          # prints the DEPLOY ADDRESS
# fund it at faucet.circle.com (Arc Testnet → USDC → paste the address)
npm run deploy             # compiles + deploys + one settlement tx
```
