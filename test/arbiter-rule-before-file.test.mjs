// PoC + fix proof for the rule/file race in PredgeRefundArbiter.
//
// `challenge` slashes a ruling when the cited party's on-chain filing does not equal the hash the
// ruling cited. The deployed `rule` does NOT require the filing to exist first — its own NatSpec
// invites the operator to "move fast and refund before anyone verifies it." But in that fast path
// the filing is not yet on-chain, so `filedEvidence[pid][party] == 0 != citedHash`, and ANY
// watcher can `challenge` in the same block and take the bond — even though the operator cited the
// exact hash the party is about to file. So an HONEST ruling on the advertised path loses its bond.
//
// The fix makes `rule` require that `evidenceFrom` has already filed exactly `evidenceHash`. This
// file compiles the deployed source (git HEAD) and the patched working tree and shows the honest
// fast-path ruling is slashable on the former and impossible-to-grief on the latter.
//
//   node test/arbiter-rule-before-file.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import solc from "solc";
import ganache from "ganache";
import { BrowserProvider, ContractFactory, parseEther, sha256, toUtf8Bytes, id } from "ethers";

function compileSources(sources) {
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity", sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const fatal = (out.errors || []).filter((e) => e.severity === "error");
  assert.equal(fatal.length, 0, fatal.map((e) => e.formattedMessage).join("\n"));
  return out.contracts;
}

const mockSrc = readFileSync(new URL("../contracts/MockRefundProtocol.sol", import.meta.url), "utf8");
const deployedArbiterSrc = execSync("git show 41c2c6e:contracts/PredgeRefundArbiter.sol", {
  cwd: new URL("..", import.meta.url).pathname, encoding: "utf8",
});
const patchedArbiterSrc = readFileSync(new URL("../contracts/PredgeRefundArbiter.sol", import.meta.url), "utf8");

const built = {
  deployed: compileSources({ "MockRefundProtocol.sol": { content: mockSrc }, "PredgeRefundArbiter.sol": { content: deployedArbiterSrc } }),
  patched: compileSources({ "MockRefundProtocol.sol": { content: mockSrc }, "PredgeRefundArbiter.sol": { content: patchedArbiterSrc } }),
};

const chain = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 5, defaultBalance: 100 } });
const provider = new BrowserProvider(chain);
const [deployer, operator, payer, , stranger] = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
const GAS = { gasLimit: 400000 };
const balanceOf = async (a) => BigInt(await chain.request({ method: "eth_getBalance", params: [a.toLowerCase(), "latest"] }));

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

const REFUND = 1;
const BOND = parseEther("0.05");
const EVIDENCE = sha256(toUtf8Bytes("chargeback pack: tracking 1Z999, delivered 12 Sep"));

async function freshArbiter(build) {
  const mF = new ContractFactory(build["MockRefundProtocol.sol"].MockRefundProtocol.abi, "0x" + build["MockRefundProtocol.sol"].MockRefundProtocol.evm.bytecode.object, deployer);
  const mock = await (await mF.deploy(await deployer.getAddress())).waitForDeployment();
  const aF = new ContractFactory(build["PredgeRefundArbiter.sol"].PredgeRefundArbiter.abi, "0x" + build["PredgeRefundArbiter.sol"].PredgeRefundArbiter.evm.bytecode.object, deployer);
  const arbiter = await (await aF.deploy(await mock.getAddress(), await operator.getAddress(), 86400, BOND)).waitForDeployment();
  await (await mock.connect(deployer).setArbiter(await arbiter.getAddress())).wait();
  return { mock, arbiter };
}

let passed = 0;
const check = async (label, fn) => { await fn(); console.log(`  ok  ${label}`); passed += 1; };

console.log("\nPredgeRefundArbiter rule/file race");

await check("DEPLOYED build: an honest fast-path ruling is slashed by a watcher before the filing lands", async () => {
  const { arbiter } = await freshArbiter(built.deployed);
  // The operator rules first (the advertised fast path), citing the exact hash the payer will file.
  await (await arbiter.connect(operator).rule(7, await payer.getAddress(), EVIDENCE, REFUND, { value: BOND, ...GAS })).wait();
  assert.equal(await arbiter.wouldSlash(7), true, "slashable purely because the filing is not on-chain yet");
  const who = await stranger.getAddress();
  const before = await balanceOf(who);
  const rc = await (await arbiter.connect(stranger).challenge(7, GAS)).wait();
  assert.equal((await balanceOf(who)) - before + rc.gasUsed * rc.gasPrice, BOND, "a watcher took the honest operator's bond");
  assert.equal(await arbiter.slashCount(), 1n);
  // The payer files the very hash that was cited — one block too late to save the bond.
  await (await arbiter.connect(payer).fileEvidence(7, EVIDENCE, GAS)).wait();
});

await check("PATCHED build: the fast-path ruling cannot be made until the filing is on-chain", async () => {
  const { arbiter } = await freshArbiter(built.patched);
  await reverts(arbiter, operator, "rule", [7, await payer.getAddress(), EVIDENCE, REFUND, { value: BOND }], "NoEvidenceFiled(uint256,address)");
  assert.equal(await arbiter.rulingCount(), 0n, "no unbacked ruling exists to be griefed");
});

await check("PATCHED build: file-then-rule is honest and unslashable by anyone", async () => {
  const { mock, arbiter } = await freshArbiter(built.patched);
  await (await arbiter.connect(payer).fileEvidence(7, EVIDENCE, GAS)).wait();           // filing lands first
  await (await arbiter.connect(operator).rule(7, await payer.getAddress(), EVIDENCE, REFUND, { value: BOND, ...GAS })).wait();
  assert.equal(await mock.refunded(7), true, "the refund still goes through");
  assert.equal(await arbiter.wouldSlash(7), false);
  await reverts(arbiter, stranger, "challenge", [7], "RulingHonest(uint256)");          // no watcher can slash it
  assert.equal(await arbiter.slashCount(), 0n);
});

console.log(`\n${passed} passed\n`);
await chain.disconnect();
