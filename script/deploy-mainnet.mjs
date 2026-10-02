// Deploy the Predge contract set to Circle Arc MAINNET (chainId 5042, USDC is the gas token)
// in one process: Settlement -> Oracle -> AgentValidator -> ValidatorBond -> AgentJob -> SignalVault.
// Same solc settings as the per-contract testnet scripts (0.8.26, optimizer 200). Addresses go to
// deployments/arc-mainnet/*.json so the testnet deployment files stay untouched.
//
//   node script/deploy-mainnet.mjs --estimate   # dry-run: gas + USDC cost, sends nothing
//   node script/deploy-mainnet.mjs              # deploy (PRIVATE_KEY in .env must hold USDC on Arc)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Network, Wallet, formatEther } from "ethers";
import { withRetry } from "../lib/arc.mjs";

const CHAIN_ID = 5042n;
const ENV_PATH = new URL("../.env", import.meta.url).pathname;
const env = {};
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
}
Object.assign(env, process.env);

// .env ARC_RPC points at testnet, so mainnet uses its own variable.
const RPC = env.ARC_MAINNET_RPC || "https://rpc.mainnet.arc.io";
const EXPLORER = env.ARC_MAINNET_EXPLORER || "https://explorer.arc.io";
const ESTIMATE = process.argv.includes("--estimate");

const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: Network.from(CHAIN_ID) });
const wallet = new Wallet(env.PRIVATE_KEY, provider);
const operator = env.ORACLE_PUBLISHER || wallet.address;
const keeper = env.VAULT_KEEPER || wallet.address;
const disputeWindow = BigInt(env.BOND_DISPUTE_WINDOW || "86400"); // 1 day on mainnet

// Args may be a function of what is already deployed: the bond reads the provider's
// deliverable straight off the job contract, so the job has to exist before it.
const PLAN = [
  ["PredgeSettlement", []],
  ["PredgeOracle", [operator]],
  ["PredgeAgentValidator", [operator]],
  ["AgentJob", []],
  ["PredgeValidatorBond", (built) => [operator, built.AgentJob, disputeWindow]],
  ["PredgeSignalVault", [keeper]],
];

const argsFor = (spec, built) => (typeof spec === "function" ? spec(built) : spec);

// `--only A,B` redeploys just those contracts and wires them to the siblings already on chain.
// Everything else in this stack is live and addressed by other systems (the gateway points at
// PredgeSettlement), so replacing the whole set to ship one fix would break them.
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1]?.split(",").filter(Boolean);
const PLAN_TO_RUN = ONLY ? PLAN.filter(([name]) => ONLY.includes(name)) : PLAN;
if (ONLY) {
  const unknown = ONLY.filter((n) => !PLAN.some(([name]) => name === n));
  if (unknown.length) throw new Error(`--only names nothing in the plan: ${unknown.join(", ")}`);
}

function compile(name) {
  const source = readFileSync(new URL(`../contracts/${name}.sol`, import.meta.url), "utf8");
  const input = {
    language: "Solidity",
    sources: { [`${name}.sol`]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: importCallback }));
  const fatal = (out.errors || []).filter((e) => e.severity === "error");
  if (fatal.length) throw new Error(fatal.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts[`${name}.sol`][name];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

function importCallback(path) {
  const p = new URL(`../contracts/${path.replace(/^\.\//, "")}`, import.meta.url);
  return existsSync(p) ? { contents: readFileSync(p, "utf8") } : { error: `not found: ${path}` };
}

const chainId = await withRetry("chainId", () => provider.send("eth_chainId", []));
if (BigInt(chainId) !== CHAIN_ID) throw new Error(`RPC ${RPC} is chain ${BigInt(chainId)}, expected ${CHAIN_ID}`);
const balance = await withRetry("balance", () => provider.getBalance(wallet.address));
console.log(`\n=== Predge -> Arc mainnet (chainId ${CHAIN_ID}) ===`);
console.log(`deployer ${wallet.address} | balance ${formatEther(balance)} USDC\n`);

if (ESTIMATE) {
  const fee = await withRetry("fee", () => provider.getFeeData());
  const price = fee.maxFeePerGas ?? fee.gasPrice;
  let total = 0n;
  // Nothing is deployed yet, so estimate against the deployer address as a stand-in for any
  // constructor argument that will be a sibling contract; the bytecode size is what matters.
  const placeholder = new Proxy({}, { get: () => wallet.address });
  for (const [name, spec] of PLAN_TO_RUN) {
    const args = argsFor(spec, placeholder);
    const { abi, bytecode } = compile(name);
    const tx = await new ContractFactory(abi, bytecode).getDeployTransaction(...args);
    const gas = await withRetry(`estimate ${name}`, () => provider.estimateGas({ ...tx, from: wallet.address }));
    total += gas;
    console.log(`${name.padEnd(22)} gas ${gas}`);
  }
  console.log(`\ntotal gas ${total} at ${price} wei/gas = ${formatEther(total * price)} USDC`);
  console.log(`fund at least ${formatEther(total * price * 2n)} USDC for headroom`);
  process.exit(0);
}

if (balance === 0n) {
  console.error(`Balance is 0. Send USDC on Arc mainnet to ${wallet.address} and re-run.`);
  process.exit(1);
}

const OUT = new URL("../deployments/arc-mainnet/", import.meta.url).pathname;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
// Seed the summary with what is already deployed so a partial run can bind to it.
const summary = {};
for (const [name] of PLAN) {
  const f = OUT + `${name}.json`;
  if (existsSync(f)) summary[name] = JSON.parse(readFileSync(f, "utf8")).address;
}
if (ONLY) {
  console.log("redeploying only:", ONLY.join(", "));
  for (const [name, address] of Object.entries(summary)) {
    if (!ONLY.includes(name)) console.log(`  reusing ${name.padEnd(22)} ${address}`);
  }
  console.log();
}

for (const [name, spec] of PLAN_TO_RUN) {
  const args = argsFor(spec, summary);
  const { abi, bytecode } = compile(name);
  const contract = await withRetry(`deploy ${name}`, () => new ContractFactory(abi, bytecode, wallet).deploy(...args));
  const tx = contract.deploymentTransaction();
  await withRetry(`wait ${name}`, () => contract.waitForDeployment());
  const address = await contract.getAddress();
  summary[name] = address;
  console.log(`${name.padEnd(22)} ${address}\n  ${EXPLORER}/tx/${tx.hash}`);
  writeFileSync(
    OUT + `${name}.json`,
    JSON.stringify(
      {
        address,
        deployer: wallet.address,
        chainId: Number(CHAIN_ID),
        deployTx: tx.hash,
        deployedAt: new Date().toISOString(),
        args: args.map((a) => (typeof a === "bigint" ? a.toString() : a)),
      },
      null,
      2,
    ) + "\n",
  );
}
console.log("\n=== Deployment summary ===");
for (const [name, address] of Object.entries(summary)) console.log(`${name.padEnd(22)} ${address}`);
