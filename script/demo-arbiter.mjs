// Exercise the bonded arbiter on Arc mainnet, both ways round:
//
//   Act 1 — the payer files its evidence under its own key, the arbiter rules citing exactly
//           that record, the refund lands on the Refund Protocol side, and the challenge then
//           REVERTS. An honest ruling cannot be slashed, by anyone, for any price.
//   Act 2 — the arbiter rules citing evidence nobody ever filed. The challenge succeeds and
//           the bond leaves for the challenger.
//
// Nothing here is supplied to `challenge` by the caller: it compares the arbiter's citation
// against the party's own on-chain filing, so neither act can be faked from the outside.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Network, Wallet, parseEther, formatEther, sha256, keccak256, toUtf8Bytes } from "ethers";
import { withRetry } from "../lib/arc.mjs";

const CHAIN_ID = 5042n;
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url).pathname, "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
Object.assign(env, process.env);
const EXPLORER = "https://explorer.arc.io";
const dep = JSON.parse(readFileSync(new URL("../deployments/arc-mainnet/PredgeRefundArbiter.json", import.meta.url).pathname, "utf8"));

const ARBITER_ABI = [
  "function fileEvidence(uint256 paymentID, bytes32 evidenceHash)",
  "function rule(uint256 paymentID, address evidenceFrom, bytes32 evidenceHash, uint8 direction) payable",
  "function challenge(uint256 paymentID)",
  "function wouldSlash(uint256 paymentID) view returns (bool)",
  "function reclaim(uint256 paymentID)",
  "function rulingOf(uint256 paymentID) view returns (bytes32 evidenceHash, address evidenceFrom, uint96 bond, uint64 ruledAt, uint8 direction, bool settled)",
  "function rulingCount() view returns (uint64)",
  "function slashCount() view returns (uint64)",
];
const MOCK_ABI = ["function refunded(uint256) view returns (bool)", "function refundCount() view returns (uint256)"];

const provider = new JsonRpcProvider(env.ARC_MAINNET_RPC || "https://rpc.mainnet.arc.io", undefined,
  { staticNetwork: Network.from(CHAIN_ID) });
const wallet = new Wallet(env.PRIVATE_KEY, provider);
// A disputing party is never the arbiter, so the payer needs its own key and its own gas.
const payerWallet = new Wallet(keccak256(toUtf8Bytes(`${env.PRIVATE_KEY}:predge-demo-payer`)), provider);
const arb = new Contract(dep.address, ARBITER_ABI, wallet);
const arbAsPayer = new Contract(dep.address, ARBITER_ABI, payerWallet);
const mock = dep.mock ? new Contract(dep.mock, MOCK_ABI, provider) : null;

const paymentID = BigInt(env.PAYMENT_ID || Date.now());
const evidence = JSON.stringify({
  kind: "refund-verdict-v1",
  paymentID: paymentID.toString(),
  ruling: "refund",
  reason: "merchant did not deliver; acceptance test committed before the work failed",
  checkedAt: new Date().toISOString(),
});
const evidenceHash = sha256(toUtf8Bytes(evidence));
const receipts = [];

async function send(label, fn) {
  const tx = await withRetry(label, fn);
  const r = await withRetry(`${label} wait`, () => tx.wait());
  console.log(`${label.padEnd(18)} ${r.status === 1 ? "ok " : "FAIL"} ${EXPLORER}/tx/${tx.hash}`);
  receipts.push({ step: label, tx: tx.hash, status: r.status });
  return r;
}

console.log(`\n=== bonded arbiter demo on Arc mainnet ===`);
console.log(`arbiter ${dep.address}\npayment ${paymentID}\nevidence sha256 ${evidenceHash}\n`);

const GAS_FLOOR = parseEther("0.02");
if ((await provider.getBalance(payerWallet.address)) < GAS_FLOOR) {
  await send("fundPayer", () => wallet.sendTransaction({ to: payerWallet.address, value: GAS_FLOOR }));
}

console.log("--- act 1: honest ruling, unslashable ---");
await send("fileEvidence", () => arbAsPayer.fileEvidence(paymentID, evidenceHash));
await send("rule(refund)", () => arb.rule(paymentID, payerWallet.address, evidenceHash, 1, { value: parseEther("0.001") }));
if (mock) console.log(`refund recorded on the protocol side: ${await mock.refunded(paymentID)}`);
console.log(`wouldSlash: ${await arb.wouldSlash(paymentID)}  (false = the citation matches the filing)`);
try {
  await arb.challenge.staticCall(paymentID);
  console.log("!! challenge would SUCCEED against an honest ruling — stop and investigate");
  process.exitCode = 1;
} catch (e) {
  const selector = (e.data || e.info?.error?.data?.result || "").slice(0, 10);
  console.log(`challenge reverts as expected (${selector || "RulingHonest"}); the bond stays staked`);
  receipts.push({ step: "challenge(honest)", result: "reverted", selector });
}

console.log("\n--- act 2: a ruling citing evidence nobody filed ---");
const fabricated = paymentID + 1n;
await send("rule(fabricated)", () => arb.rule(fabricated, payerWallet.address, evidenceHash, 1, { value: parseEther("0.001") }));
console.log(`wouldSlash: ${await arb.wouldSlash(fabricated)}  (true = cited a filing that does not exist)`);
const before = await provider.getBalance(payerWallet.address);
await send("challenge(slash)", () => arbAsPayer.challenge(fabricated));
const after = await provider.getBalance(payerWallet.address);
const ruling = await arb.rulingOf(fabricated);
console.log(`ruling settled: ${ruling[5]} | bond left: ${formatEther(ruling[2])} | challenger gained ${formatEther(after - before)} USDC`);
console.log(`rulings ${await arb.rulingCount()} | slashes ${await arb.slashCount()}`);

writeFileSync(new URL("../deployments/arc-mainnet/arbiter-demo.json", import.meta.url).pathname,
  JSON.stringify({ ranAt: new Date().toISOString(), arbiter: dep.address, mock: dep.mock,
    payer: payerWallet.address, paymentID: paymentID.toString(), fabricatedPaymentID: fabricated.toString(),
    evidence, evidenceHash, receipts }, null, 2) + "\n");
console.log("\nwrote deployments/arc-mainnet/arbiter-demo.json");
