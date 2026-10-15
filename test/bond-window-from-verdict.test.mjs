// Boundary tests for the PredgeValidatorBond dispute window, run against the CURRENT source.
//
// The window must run from the verdict (`recordScore`), never from the stake
// (`stakeAndCommit`). These checks pin that to the second:
//   - a stake posted long before the verdict does not shorten the window;
//   - the bond cannot be reclaimed one second before scoredAt + disputeWindow;
//   - a lie can still be challenged late in the window, however old the stake is;
//   - an honest verdict is reclaimable at exactly scoredAt + disputeWindow.
//
//   node test/bond-window-from-verdict.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import solc from "solc";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, parseEther, keccak256, toUtf8Bytes, id } from "ethers";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const out = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: {
    "AgentJob.sol": { content: read("../contracts/AgentJob.sol") },
    "PredgeValidatorBond.sol": { content: read("../contracts/PredgeValidatorBond.sol") },
  },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
})));
const fatal = (out.errors || []).filter((e) => e.severity === "error");
assert.equal(fatal.length, 0, fatal.map((e) => e.formattedMessage).join("\n"));
const art = (file, name) => ({ abi: out.contracts[file][name].abi, bin: "0x" + out.contracts[file][name].evm.bytecode.object });

// timestampIncrement: 1 makes block time deterministic (parent + 1s, plus any evm_increaseTime),
// so a transaction can be landed on an exact second instead of whatever the wall clock says.
const chain = ganache.provider({ logging: { quiet: true }, miner: { timestampIncrement: 1 }, wallet: { totalAccounts: 4, defaultBalance: 100 } });
const provider = new BrowserProvider(chain);
const [validator, providerAcct, client, stranger] = await Promise.all([0, 1, 2, 3].map((i) => provider.getSigner(i)));
const GAS = { gasLimit: 300000 }; // fixed gas: ethers' estimateGas strips custom-error data over ganache

const WINDOW = 86400;              // the window the live bonds use (one day)
const STAKE_AGE = 30 * 86400;      // the stake is a month old by the time the verdict lands
const BOND = parseEther("0.1");
const EXPECTED = keccak256(toUtf8Bytes("the real deliverable"));
const MISMATCH = keccak256(toUtf8Bytes("not what was promised"));

// Read straight from the node: ethers may serve a cached "latest" block between polls.
const now = async () => parseInt((await chain.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp, 16);
const balance = async (addr) => BigInt(await chain.request({ method: "eth_getBalance", params: [addr, "latest"] }));
const blockTime = async (num) => parseInt((await chain.request({ method: "eth_getBlockByNumber", params: ["0x" + num.toString(16), false] })).timestamp, 16);
const warp = async (secs) => { await chain.request({ method: "evm_increaseTime", params: [secs] }); await chain.request({ method: "evm_mine", params: [] }); };
// Arrange for the NEXT transaction to be mined in a block with exactly this timestamp.
const nextTxAt = async (ts) => {
  if ((await now()) === ts - 1) return; // already there: the next block is ts
  const gap = ts - 1 - ((await now()) + 1); // an empty block lands at latest + 1 + any increase
  assert.ok(gap >= 0, `cannot move time backwards to ${ts}`);
  if (gap > 0) await chain.request({ method: "evm_increaseTime", params: [gap] });
  await chain.request({ method: "evm_mine", params: [] });
  assert.equal(await now(), ts - 1, "ganache honoured the explicit block time");
};
// Send a real transaction and require it to revert with `signature`, in a block at `ts`.
async function txRevertsAt(ts, contract, signer, name, args, signature) {
  await nextTxAt(ts);
  const want = id(signature).slice(0, 10);
  const before = parseInt(await chain.request({ method: "eth_blockNumber", params: [] }), 16);
  try {
    await (await contract.connect(signer).getFunction(name)(...args, GAS)).wait();
  } catch (e) {
    const got = (e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.receipt && "reverted"))) || JSON.stringify(e);
    assert.ok(String(got).includes(want) || got === "reverted", `expected ${signature} (${want}), got ${String(got).slice(0, 160)}`);
    const head = parseInt(await chain.request({ method: "eth_blockNumber", params: [] }), 16);
    if (head > before) assert.equal(await blockTime(before + 1), ts, "the reverted call ran at the intended second");
    return;
  }
  assert.fail(`expected ${name} to revert with ${signature} at ${ts}, but it succeeded`);
}

async function reverts(contract, signer, name, args, signature) {
  const want = id(signature).slice(0, 10);
  try {
    await contract.connect(signer).getFunction(name).staticCall(...args);
  } catch (e) {
    const got = (e && (e.data || (e.info && e.info.error && e.info.error.data))) || JSON.stringify(e);
    assert.ok(String(got).includes(want), `expected ${signature} (${want}), got ${String(got).slice(0, 120)}`);
    return;
  }
  assert.fail(`expected revert ${signature}, but the call succeeded`);
}

let n = 0;
// Deploy a fresh job + bond, stake, age the stake, then have the provider deliver and the
// validator record `score`. Returns the bond, the request hash and the verdict time.
async function oldStakeThenVerdict(deliverable, score) {
  const jF = art("AgentJob.sol", "AgentJob"), bF = art("PredgeValidatorBond.sol", "PredgeValidatorBond");
  const job = await (await new ContractFactory(jF.abi, jF.bin, client).deploy()).waitForDeployment();
  const bond = await (await new ContractFactory(bF.abi, bF.bin, validator)
    .deploy(await validator.getAddress(), await job.getAddress(), WINDOW)).waitForDeployment();
  const requestHash = keccak256(toUtf8Bytes(`req-${++n}`));
  await (await job.connect(client).createJob(await providerAcct.getAddress(), await validator.getAddress(), requestHash, { value: parseEther("0.01") })).wait();
  await (await bond.connect(validator).stakeAndCommit(requestHash, EXPECTED, 1n, { value: BOND, ...GAS })).wait();
  const stakedAt = (await bond.stakes(requestHash)).stakedAt;

  await warp(STAKE_AGE);
  await (await job.connect(providerAcct).submit(1n, deliverable, "0x", GAS)).wait();
  const rcpt = await (await bond.connect(validator).recordScore(requestHash, score, GAS)).wait();
  const verdictTime = BigInt((await blockTime(rcpt.blockNumber)));

  const s = await bond.stakes(requestHash);
  assert.equal(s.scoredAt, verdictTime, "scoredAt is the block time of recordScore");
  assert.equal(s.stakedAt, stakedAt, "recording a verdict does not touch stakedAt");
  assert.ok(verdictTime - stakedAt >= BigInt(STAKE_AGE), "the stake really is older than the window");
  return { bond, requestHash, verdictTime: Number(verdictTime), stakedAt: Number(stakedAt) };
}

const check = async (label, fn) => { await fn(); console.log(`  ok  ${label}`); passed += 1; };
let passed = 0;

console.log("\nPredgeValidatorBond: dispute window runs from the verdict (boundaries)");

await check("a stake 30 days older than the verdict does not shorten the window", async () => {
  const { bond, requestHash, verdictTime, stakedAt } = await oldStakeThenVerdict(EXPECTED, 100);
  // Measured from the stake, the window closed long ago. Measured from the verdict, it is wide open.
  assert.ok((await now()) > stakedAt + WINDOW, "stakedAt + window is already in the past");
  await reverts(bond, validator, "reclaim", [requestHash], "WindowOpen()");
  assert.equal(await bond.disputeWindow(), BigInt(WINDOW));
  assert.ok(verdictTime > stakedAt + WINDOW);
});

await check("reclaim reverts at verdictTime + window - 1 (honest verdict, old stake)", async () => {
  const { bond, requestHash, verdictTime } = await oldStakeThenVerdict(EXPECTED, 100);
  await txRevertsAt(verdictTime + WINDOW - 1, bond, validator, "reclaim", [requestHash], "WindowOpen()");
  assert.equal(await bond.totalBonded(), BOND, "the bond is still staked");
});

await check("reclaim succeeds at exactly verdictTime + window (honest verdict, old stake)", async () => {
  const { bond, requestHash, verdictTime } = await oldStakeThenVerdict(EXPECTED, 100);
  await nextTxAt(verdictTime + WINDOW);
  const rcpt = await (await bond.connect(validator).reclaim(requestHash, GAS)).wait();
  assert.equal((await blockTime(rcpt.blockNumber)), verdictTime + WINDOW, "reclaimed on the first allowed second");
  assert.equal(await bond.totalBonded(), 0n);
  assert.equal(await bond.slashCount(), 0n);
});

await check("a lie stays challengeable until verdictTime + window, however old the stake", async () => {
  const { bond, requestHash, verdictTime, stakedAt } = await oldStakeThenVerdict(MISMATCH, 100);
  assert.equal(await bond.wouldSlash(requestHash), true);
  // Late in the window, a month after the stake: the validator still cannot pull the bond...
  await txRevertsAt(verdictTime + WINDOW - 2, bond, validator, "reclaim", [requestHash], "WindowOpen()");
  // ...and a stranger's challenge on the last second of the window takes it.
  await nextTxAt(verdictTime + WINDOW - 1);
  const before = await balance(await stranger.getAddress());
  const rcpt = await (await bond.connect(stranger).challenge(requestHash, GAS)).wait();
  const landedAt = (await blockTime(rcpt.blockNumber));
  assert.equal(landedAt, verdictTime + WINDOW - 1, "challenge landed on the last second of the window");
  assert.ok(landedAt > stakedAt + WINDOW, "and long after a stake-based window would have closed");
  const after = await balance(await stranger.getAddress());
  assert.equal(after - before + rcpt.gasUsed * rcpt.gasPrice, BOND, "the challenger received the whole bond");
  assert.equal(await bond.slashCount(), 1n);
  assert.equal(await bond.totalBonded(), 0n);
  await reverts(bond, validator, "reclaim", [requestHash], "Closed()");
});

console.log(`\n${passed} passed\n`);
await chain.disconnect();
