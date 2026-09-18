// Deploy the bonded refund arbiter (and, unless ARBITER_TARGET is set, a mock Refund Protocol to
// point it at) to Arc mainnet, then wire the mock's arbiter seat to the arbiter contract.
//
//   node script/deploy-arbiter.mjs                     # mock + arbiter, 1-day challenge window
//   CHALLENGE_WINDOW=120 node script/deploy-arbiter.mjs # short window, for a live demo run
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Network, Wallet, formatEther, parseEther } from "ethers";
import { withRetry } from "../lib/arc.mjs";

const CHAIN_ID = 5042n;
const env = {};
const ENV_PATH = new URL("../.env", import.meta.url).pathname;
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
}
Object.assign(env, process.env);

const RPC = env.ARC_MAINNET_RPC || "https://rpc.mainnet.arc.io";
const EXPLORER = env.ARC_MAINNET_EXPLORER || "https://explorer.arc.io";
const CHALLENGE_WINDOW = BigInt(env.CHALLENGE_WINDOW || "86400");
// USDC is the native unit on Arc. The floor has to clear the cost of sending a challenge by a
// wide margin: a challenge measured at ~0.001 USDC of gas here, and a bond that does not pay
// for itself is one nobody bothers to send, which leaves the ruling unchecked.
const MIN_BOND = parseEther(env.MIN_BOND || "0.05");

function compile(name) {
  const source = readFileSync(new URL(`../contracts/${name}.sol`, import.meta.url), "utf8");
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { [`${name}.sol`]: { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  })));
  const fatal = (out.errors || []).filter((e) => e.severity === "error");
  if (fatal.length) throw new Error(fatal.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts[`${name}.sol`][name];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: Network.from(CHAIN_ID) });
const wallet = new Wallet(env.PRIVATE_KEY, provider);
console.log(`\n=== Predge refund arbiter -> Arc mainnet (${CHAIN_ID}) ===`);
console.log(`deployer ${wallet.address} | balance ${formatEther(await provider.getBalance(wallet.address))} USDC`);
console.log(`challenge window ${CHALLENGE_WINDOW}s | min bond ${formatEther(MIN_BOND)} USDC\n`);

async function deploy(name, args) {
  const { abi, bytecode } = compile(name);
  const contract = await withRetry(`deploy ${name}`, () => new ContractFactory(abi, bytecode, wallet).deploy(...args));
  const tx = contract.deploymentTransaction();
  await withRetry(`wait ${name}`, () => contract.waitForDeployment());
  const address = await contract.getAddress();
  console.log(`${name.padEnd(22)} ${address}\n  ${EXPLORER}/tx/${tx.hash}`);
  return { address, abi, tx: tx.hash, contract };
}

let target = env.ARBITER_TARGET;
let mock = null;
if (!target) {
  mock = await deploy("MockRefundProtocol", [wallet.address]);   // deployer holds the seat until the arbiter exists
  target = mock.address;
}
const arbiter = await deploy("PredgeRefundArbiter", [target, wallet.address, CHALLENGE_WINDOW, MIN_BOND]);

if (mock) {
  const hand = await withRetry("setArbiter", () => mock.contract.setArbiter(arbiter.address));
  const r = await withRetry("wait setArbiter", () => hand.wait());
  console.log(`mock arbiter seat -> ${arbiter.address} (status ${r.status})\n  ${EXPLORER}/tx/${hand.hash}`);
}

const OUT = new URL("../deployments/arc-mainnet/", import.meta.url).pathname;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + "PredgeRefundArbiter.json", JSON.stringify({
  address: arbiter.address, refundProtocol: target, mock: mock ? mock.address : null,
  operator: wallet.address, challengeWindow: Number(CHALLENGE_WINDOW), minBond: MIN_BOND.toString(),
  chainId: Number(CHAIN_ID), deployTx: arbiter.tx, deployedAt: new Date().toISOString(),
}, null, 2) + "\n");
console.log(`\nwrote deployments/arc-mainnet/PredgeRefundArbiter.json`);
