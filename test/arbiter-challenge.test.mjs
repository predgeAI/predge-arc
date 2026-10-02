// The arbiter's bond is only meaningful if a ruling can be checked against something the
// arbiter did not write. These run on a local EVM.
//
//   node test/arbiter-challenge.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import solc from "solc";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, parseEther, sha256, toUtf8Bytes, id } from "ethers";

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

const art = compile(["MockRefundProtocol", "PredgeRefundArbiter"]);
const chain = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 5, defaultBalance: 100 } });
const provider = new BrowserProvider(chain);
const [deployer, operator, payer, merchant, stranger] = await Promise.all(
  [0, 1, 2, 3, 4].map((i) => provider.getSigner(i)),
);

const balanceOf = async (addr) =>
  BigInt(await chain.request({ method: "eth_getBalance", params: [addr.toLowerCase(), "latest"] }));

const deploy = async (name, signer, args) => {
  const f = new ContractFactory(art[name].abi, art[name].bytecode, signer);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  return c;
};

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

let passed = 0;
const check = async (label, fn) => { await fn(); console.log(`  ok  ${label}`); passed += 1; };

const REFUND = 1, RELEASE = 2;
const BOND = parseEther("0.05");

async function fresh() {
  // The mock only accepts calls from the arbiter, so hand the seat over once it exists.
  const mock = await deploy("MockRefundProtocol", deployer, [await deployer.getAddress()]);
  const arbiter = await deploy("PredgeRefundArbiter", deployer, [
    await mock.getAddress(), await operator.getAddress(), 86400, BOND,
  ]);
  await (await mock.connect(deployer).setArbiter(await arbiter.getAddress())).wait();
  return { mock, arbiter };
}

const EVIDENCE = sha256(toUtf8Bytes("chargeback pack: tracking 1Z999, delivered 12 Sep"));
const OTHER = sha256(toUtf8Bytes("a different story told later"));

console.log("\nPredgeRefundArbiter.challenge");

await check("challenge takes no caller-supplied evidence at all", async () => {
  const frag = art.PredgeRefundArbiter.abi.find((f) => f.name === "challenge");
  assert.deepEqual(frag.inputs.map((i) => i.type), ["uint256"],
    "challenge must accept only a paymentID — any bytes parameter is the old hole");
});

await check("a ruling that cites what the payer actually filed cannot be slashed", async () => {
  const { arbiter } = await fresh();
  await (await arbiter.connect(payer).fileEvidence(7, EVIDENCE)).wait();
  await (await arbiter.connect(operator).rule(7, await payer.getAddress(), EVIDENCE, REFUND, { value: BOND })).wait();
  assert.equal(await arbiter.wouldSlash(7), false);
  await rejectsWith(arbiter.connect(stranger).challenge(7), "RulingHonest(uint256)");
});

await check("a ruling citing evidence nobody filed is slashable by anyone", async () => {
  const { arbiter } = await fresh();
  await (await arbiter.connect(operator).rule(7, await payer.getAddress(), EVIDENCE, REFUND, { value: BOND })).wait();
  assert.equal(await arbiter.wouldSlash(7), true);
  const who = await stranger.getAddress();
  const before = await balanceOf(who);
  const rc = await (await arbiter.connect(stranger).challenge(7)).wait();
  assert.equal((await balanceOf(who)) - before + rc.gasUsed * rc.gasPrice, BOND, "challenger takes the bond");
  assert.equal(await arbiter.slashCount(), 1n);
});

await check("a ruling that misquotes the filed evidence is slashable", async () => {
  const { arbiter } = await fresh();
  await (await arbiter.connect(merchant).fileEvidence(9, EVIDENCE)).wait();
  await (await arbiter.connect(operator).rule(9, await merchant.getAddress(), OTHER, RELEASE, { value: BOND })).wait();
  assert.equal(await arbiter.wouldSlash(9), true);
  await (await arbiter.connect(stranger).challenge(9)).wait();
  assert.equal(await arbiter.slashCount(), 1n);
});

await check("the old attack is dead: junk bytes no longer buy anyone the bond", async () => {
  const { arbiter } = await fresh();
  await (await arbiter.connect(payer).fileEvidence(11, EVIDENCE)).wait();
  await (await arbiter.connect(operator).rule(11, await payer.getAddress(), EVIDENCE, REFUND, { value: BOND })).wait();
  // What the Arbitrum bot did: call the challenge with meaningless bytes and walk away paid.
  // There is no longer a parameter to put them in, and the no-arg call reverts as honest.
  assert.equal(art.PredgeRefundArbiter.abi.find((f) => f.name === "challenge").inputs.length, 1);
  await rejectsWith(arbiter.connect(stranger).challenge(11), "RulingHonest(uint256)");
  assert.equal(await arbiter.slashCount(), 0n);
});

await check("the arbiter cannot file the evidence it will later cite", async () => {
  const { arbiter } = await fresh();
  await rejectsWith(arbiter.connect(operator).fileEvidence(13, EVIDENCE), "ArbiterCannotFile()");
  await rejectsWith(arbiter.connect(deployer).fileEvidence(13, EVIDENCE), "ArbiterCannotFile()");
});

await check("a party cannot revise its story after filing", async () => {
  const { arbiter } = await fresh();
  await (await arbiter.connect(payer).fileEvidence(15, EVIDENCE)).wait();
  await rejectsWith(arbiter.connect(payer).fileEvidence(15, OTHER), "EvidenceAlreadyFiled(uint256,address)");
});

await check("a refund still reaches Refund Protocol while the ruling stays challengeable", async () => {
  const { mock, arbiter } = await fresh();
  await (await arbiter.connect(payer).fileEvidence(21, EVIDENCE)).wait();
  await (await arbiter.connect(operator).rule(21, await payer.getAddress(), EVIDENCE, REFUND, { value: BOND })).wait();
  assert.equal(await mock.refundCount(), 1n);
  assert.equal(await mock.refunded(21), true);
  assert.equal(await balanceOf(await arbiter.getAddress()), BOND, "the bond stays staked until the window closes");
});

console.log(`\n${passed} passed\n`);
await chain.disconnect();
