// The property the bond exists for: a challenge settles a verdict against what the PROVIDER
// committed on-chain, never against bytes the challenger made up. These run on a local EVM.
//
//   node test/bond-challenge.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import solc from "solc";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, parseEther, keccak256, toUtf8Bytes, id } from "ethers";

// Ganache reports a custom error as its raw 4-byte selector, so match on that rather than on a
// name that never reaches us.
async function rejectsWith(promise, signature) {
  const want = id(signature).slice(0, 10);
  try {
    await promise;
  } catch (e) {
    const got = JSON.stringify(e);
    assert.ok(got.includes(want), `expected ${signature} (${want}), got: ${got.slice(0, 300)}`);
    return;
  }
  assert.fail(`expected revert ${signature}, but the call succeeded`);
}

function compile(names) {
  const sources = Object.fromEntries(
    names.map((n) => [`${n}.sol`, { content: readFileSync(new URL(`../contracts/${n}.sol`, import.meta.url), "utf8") }]),
  );
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity", sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const fatal = (out.errors || []).filter((e) => e.severity === "error");
  assert.equal(fatal.length, 0, fatal.map((e) => e.formattedMessage).join("\n"));
  return Object.fromEntries(names.map((n) => {
    const c = out.contracts[`${n}.sol`][n];
    return [n, { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }];
  }));
}

const art = compile(["AgentJob", "PredgeValidatorBond"]);
const chain = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 4, defaultBalance: 100 } });
const provider = new BrowserProvider(chain);
const [validator, providerAcct, client, stranger] = await Promise.all(
  [0, 1, 2, 3].map((i) => provider.getSigner(i)),
);

// ethers caches balances per block and ganache instamines, so ask the chain directly.
const balanceOf = async (addr) =>
  BigInt(await chain.request({ method: "eth_getBalance", params: [addr.toLowerCase(), "latest"] }));

const deploy = async (name, signer, args) => {
  const f = new ContractFactory(art[name].abi, art[name].bytecode, signer);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  return c;
};

let passed = 0;
const check = async (label, fn) => {
  await fn();
  console.log(`  ok  ${label}`);
  passed += 1;
};

// A fresh job + bond, with the provider a genuinely different key from the validator.
async function scenario({ delivered, expected, score }) {
  const job = await deploy("AgentJob", client, []);
  const bond = await deploy("PredgeValidatorBond", validator, [
    await validator.getAddress(), await job.getAddress(), 86400,
  ]);
  const requestHash = keccak256(toUtf8Bytes(`req-${Math.random()}`));
  await (await job.connect(client).createJob(
    await providerAcct.getAddress(), await validator.getAddress(), requestHash,
    { value: parseEther("0.01") },
  )).wait();
  const jobId = 1n;
  await (await bond.connect(validator).stakeAndCommit(requestHash, expected, jobId, { value: parseEther("0.1") })).wait();
  // The provider — not the validator, not the challenger — writes the deliverable.
  await (await job.connect(providerAcct).submit(jobId, delivered, "0x")).wait();
  await (await bond.connect(validator).recordScore(requestHash, score)).wait();
  return { bond, job, requestHash, jobId };
}

const GOOD = keccak256(toUtf8Bytes("the real deliverable"));
const OTHER = keccak256(toUtf8Bytes("something else entirely"));

console.log("\nPredgeValidatorBond.challenge");

await check("challenge takes no caller-supplied evidence at all", async () => {
  const frag = art.PredgeValidatorBond.abi.find((f) => f.name === "challenge");
  assert.deepEqual(frag.inputs.map((i) => i.type), ["bytes32"],
    "challenge must accept only a requestHash — any bytes parameter is the old hole");
});

await check("honest pass verdict cannot be slashed, by anyone, with anything", async () => {
  const { bond, requestHash } = await scenario({ delivered: GOOD, expected: GOOD, score: 100 });
  assert.equal(await bond.wouldSlash(requestHash), false);
  await rejectsWith(bond.connect(stranger).challenge(requestHash), "VerdictHonest()");
});

await check("honest fail verdict cannot be slashed either", async () => {
  const { bond, requestHash } = await scenario({ delivered: OTHER, expected: GOOD, score: 0 });
  assert.equal(await bond.wouldSlash(requestHash), false);
  await rejectsWith(bond.connect(stranger).challenge(requestHash), "VerdictHonest()");
});

await check("a verdict that passed work the provider did not deliver IS slashable", async () => {
  const { bond, requestHash } = await scenario({ delivered: OTHER, expected: GOOD, score: 100 });
  assert.equal(await bond.wouldSlash(requestHash), true);
  const challenger = await stranger.getAddress();
  const before = await balanceOf(challenger);
  const rc = await (await bond.connect(stranger).challenge(requestHash)).wait();
  const spent = rc.gasUsed * rc.gasPrice;
  assert.equal((await balanceOf(challenger)) - before + spent, parseEther("0.1"),
    "the whole bond went to the challenger");
  assert.equal(await bond.slashCount(), 1n);
  assert.equal(await balanceOf(await bond.getAddress()), 0n, "nothing left in the bond contract");
});

await check("a verdict that failed work the provider DID deliver is slashable too", async () => {
  const { bond, requestHash } = await scenario({ delivered: GOOD, expected: GOOD, score: 0 });
  assert.equal(await bond.wouldSlash(requestHash), true);
  await (await bond.connect(stranger).challenge(requestHash)).wait();
  assert.equal(await bond.slashCount(), 1n);
});

await check("a bond cannot be staked against a job this validator does not evaluate", async () => {
  const job = await deploy("AgentJob", client, []);
  const bond = await deploy("PredgeValidatorBond", validator, [
    await validator.getAddress(), await job.getAddress(), 86400,
  ]);
  const requestHash = keccak256(toUtf8Bytes("unrelated"));
  await (await job.connect(client).createJob(
    await providerAcct.getAddress(), await stranger.getAddress(), requestHash,
    { value: parseEther("0.01") },
  )).wait();
  await rejectsWith(
    bond.connect(validator).stakeAndCommit(requestHash, GOOD, 1n, { value: parseEther("0.1") }),
    "JobNotBound()",
  );
});

await check("a validator cannot bond a job where it is also the provider", async () => {
  const job = await deploy("AgentJob", client, []);
  const bond = await deploy("PredgeValidatorBond", validator, [
    await validator.getAddress(), await job.getAddress(), 86400,
  ]);
  const requestHash = keccak256(toUtf8Bytes("self-dealing"));
  await (await job.connect(client).createJob(
    await validator.getAddress(), await validator.getAddress(), requestHash,
    { value: parseEther("0.01") },
  )).wait();
  await rejectsWith(
    bond.connect(validator).stakeAndCommit(requestHash, GOOD, 1n, { value: parseEther("0.1") }),
    "ProviderIsValidator()",
  );
});

await check("nothing is challengeable before the provider submits", async () => {
  const job = await deploy("AgentJob", client, []);
  const bond = await deploy("PredgeValidatorBond", validator, [
    await validator.getAddress(), await job.getAddress(), 86400,
  ]);
  const requestHash = keccak256(toUtf8Bytes("not yet"));
  await (await job.connect(client).createJob(
    await providerAcct.getAddress(), await validator.getAddress(), requestHash,
    { value: parseEther("0.01") },
  )).wait();
  await (await bond.connect(validator).stakeAndCommit(requestHash, GOOD, 1n, { value: parseEther("0.1") })).wait();
  await (await bond.connect(validator).recordScore(requestHash, 100)).wait();
  assert.equal(await bond.wouldSlash(requestHash), false);
  await rejectsWith(bond.connect(stranger).challenge(requestHash), "NotSubmitted()");
});

console.log(`\n${passed} passed\n`);
await chain.disconnect();
