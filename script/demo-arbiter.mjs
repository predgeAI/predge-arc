// Exercise the bonded arbiter on Arc mainnet: rule with a committed evidence hash, watch the
// refund land on the Refund Protocol side, then slash the ruling by showing different evidence.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Network, Wallet, parseEther, formatEther, sha256, toUtf8Bytes } from "ethers";
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
  "function rule(uint256 paymentID, bytes32 evidenceHash, uint8 direction) payable",
  "function challenge(uint256 paymentID, bytes evidence)",
  "function reclaim(uint256 paymentID)",
  "function rulingOf(uint256 paymentID) view returns (bytes32 evidenceHash, uint96 bond, uint64 ruledAt, uint8 direction, bool settled)",
  "function rulingCount() view returns (uint64)",
  "function slashCount() view returns (uint64)",
];
const MOCK_ABI = ["function refunded(uint256) view returns (bool)", "function refundCount() view returns (uint256)"];

const provider = new JsonRpcProvider(env.ARC_MAINNET_RPC || "https://rpc.mainnet.arc.io", undefined,
  { staticNetwork: Network.from(CHAIN_ID) });
const wallet = new Wallet(env.PRIVATE_KEY, provider);
const arb = new Contract(dep.address, ARBITER_ABI, wallet);
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

await send("rule(refund)", () => arb.rule(paymentID, evidenceHash, 1, { value: parseEther("0.001") }));
if (mock) console.log(`refund recorded on the protocol side: ${await mock.refunded(paymentID)}`);

const before = await provider.getBalance(wallet.address);
await send("challenge", () => arb.challenge(paymentID, toUtf8Bytes(evidence.replace("did not deliver", "delivered"))));
const after = await provider.getBalance(wallet.address);
const ruling = await arb.rulingOf(paymentID);
console.log(`ruling settled: ${ruling[4]} | bond left: ${formatEther(ruling[1])} | balance moved ${formatEther(after - before)} USDC`);
console.log(`rulings ${await arb.rulingCount()} | slashes ${await arb.slashCount()}`);

writeFileSync(new URL("../deployments/arc-mainnet/arbiter-demo.json", import.meta.url).pathname,
  JSON.stringify({ ranAt: new Date().toISOString(), arbiter: dep.address, mock: dep.mock,
    paymentID: paymentID.toString(), evidence, evidenceHash, receipts }, null, 2) + "\n");
console.log("\nwrote deployments/arc-mainnet/arbiter-demo.json");
