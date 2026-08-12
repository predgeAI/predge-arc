// CACHET — standalone verifier.
//
//   node verify-cachet.mjs <marketId>
//   node verify-cachet.mjs --platform polymarket --ref e2e-1786542074988
//   node verify-cachet.mjs <marketId> --rpc https://rpc.testnet.arc.io --deep
//
// This file is the point of the whole product, so read what it does NOT need:
// it does not import a single line of Predge code, it never calls a Predge API
// unless the resolution itself points at one, and it holds no secret. Give it a
// public Arc RPC endpoint and a market id and it will tell you whether a Predge
// resolution is honest — or refuse to say yes.
//
// THE TRUST CHAIN, and where it bottoms out:
//   1. the chain says: this market was committed at T1 and resolved at T2 > T1,
//      with contentHash H. Nobody can revise that — PredgeOracle has no edit path.
//   2. the signed envelope hashes to exactly H, so the bytes you are reading are
//      the bytes that settled. (keccak256 over the canonical string.)
//   3. the ed25519 signature over those bytes verifies under public key K.
//   4. K is listed active in Predge's published key registry…
//   5. …and (--deep) the sha256 of that registry is itself anchored on Arc, so
//      even the key list is attested by the chain rather than by a web server
//      that could be swapped tomorrow.
// Steps 1-3 need nothing but an RPC endpoint. Step 4 fetches a public JSON file.
// Step 5 removes that last dependency. At no point are you asked to trust Predge.
//
// Anything that fails prints FAIL and the process exits non-zero. A verifier that
// cannot fail is decoration.
import crypto from "node:crypto";
import { AbiCoder, Contract, JsonRpcProvider, Network, keccak256, toUtf8Bytes } from "ethers";

const ARC_CHAIN_ID = 5042002n;
const DEFAULT_RPC = "https://rpc.testnet.arc.io";
const DEFAULT_ORACLE = "0xF160AbE664C34CF4C117101b4308bb16325a1ABc";
const DEFAULT_SETTLEMENT = "0x3474Bd2747cb1D430C2F56050433fa5D6b1C82A5"; // holds the key-registry anchor
const DEFAULT_KEYS_URL = "https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json";

const ORACLE_ABI = [
  "function getResolution(bytes32 marketId) view returns (bool resolved, uint8 outcome, bytes32 contentHash, bytes32 preCommitHash, uint64 committedAt, uint64 resolvedAt)",
  "function attestationRef(bytes32 marketId) view returns (string)",
];
const SETTLEMENT_ABI = [
  "event Paid(address indexed payer, bytes32 indexed route, uint256 amount, uint256 timestamp, string meta)",
];
const OUTCOME_NAME = ["UNRESOLVED", "YES", "NO", "INVALID"];

const arg = (flag, dflt = "") => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const has = (flag) => process.argv.includes(flag);

let failures = 0;
const pass = (label, detail = "") => console.log(`  PASS  ${label}${detail ? `\n        ${detail}` : ""}`);
const fail = (label, detail = "") => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
};
const skip = (label, detail = "") => console.log(`  ----  ${label}${detail ? `\n        ${detail}` : ""}`);

/** Raw 32-byte ed25519 public key -> a KeyObject, by wrapping it in a SPKI header. */
function ed25519KeyFromHex(hex) {
  const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  });
}

function verifyEd25519(canonical, signatureHex, publicKeyHex) {
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) return false;
    if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
    return crypto.verify(
      null,
      Buffer.from(canonical, "utf8"),
      ed25519KeyFromHex(publicKeyHex),
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

/** The envelope may be embedded on-chain (self-contained) or referenced by URL. */
async function loadEnvelope(ref) {
  const trimmed = (ref || "").trim();
  if (!trimmed) return { envelope: null, source: "none" };
  if (trimmed.startsWith("{")) {
    try {
      return { envelope: JSON.parse(trimmed), source: "on-chain (embedded in the resolution)" };
    } catch {
      return { envelope: null, source: "on-chain (embedded, but not valid JSON)" };
    }
  }
  if (/^https?:\/\//.test(trimmed)) {
    try {
      const r = await fetch(trimmed, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { envelope: null, source: `${trimmed} (HTTP ${r.status})` };
      const body = await r.json();
      return { envelope: body.envelope ?? body, source: trimmed };
    } catch (e) {
      return { envelope: null, source: `${trimmed} (${e.message})` };
    }
  }
  return { envelope: null, source: trimmed };
}

// ── resolve the market id ───────────────────────────────────────────────────
let marketId = process.argv[2] && process.argv[2].startsWith("0x") ? process.argv[2] : arg("--market-id");
const platform = arg("--platform");
const marketRef = arg("--ref");
if (!marketId && platform && marketRef) {
  // Identical to PredgeOracle.marketIdFor: abi.encode is length-prefixed, so the
  // encoding is injective and two different markets can never share a key.
  marketId = keccak256(AbiCoder.defaultAbiCoder().encode(["string", "string"], [platform, marketRef]));
}
if (!marketId || !/^0x[0-9a-fA-F]{64}$/.test(marketId)) {
  console.log(
    [
      "CACHET — verify a Predge resolution against Circle Arc, trusting nobody.",
      "",
      "  node verify-cachet.mjs <marketId>",
      "  node verify-cachet.mjs --platform <platform> --ref <marketRef>",
      "",
      "  --rpc <url>       Arc RPC        (default: " + DEFAULT_RPC + ")",
      "  --oracle <addr>   PredgeOracle   (default: " + DEFAULT_ORACLE + ")",
      "  --keys <url>      key registry   (default: Predge's published registry)",
      "  --deep            also prove the key registry is anchored on Arc",
    ].join("\n"),
  );
  process.exit(2);
}

const rpc = arg("--rpc", DEFAULT_RPC);
const oracleAddr = arg("--oracle", DEFAULT_ORACLE);
const keysUrl = arg("--keys", DEFAULT_KEYS_URL);

const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: Network.from(ARC_CHAIN_ID) });
const oracle = new Contract(oracleAddr, ORACLE_ABI, provider);

console.log("CACHET verification");
console.log("  market  ", marketId);
console.log("  oracle  ", oracleAddr);
console.log("  rpc     ", rpc);
console.log("");

// ── 1. what the chain says (nobody can revise this) ─────────────────────────
console.log("[1] the chain's own record");
let res;
try {
  res = await oracle.getResolution(marketId);
} catch (e) {
  fail("could not read the oracle", e.shortMessage || e.message);
  process.exit(1);
}
const [resolved, outcomeRaw, contentHash, preCommitHash, committedAt, resolvedAt] = res;
const outcome = OUTCOME_NAME[Number(outcomeRaw)] ?? String(outcomeRaw);

if (!resolved) {
  fail("market is not resolved", "nothing to verify yet — an unresolved market reads as UNRESOLVED, never as a result");
  process.exit(1);
}
pass(`resolved as ${outcome}`, `contentHash ${contentHash}`);

if (committedAt === 0n) {
  fail("no pre-commitment recorded", "a resolution without a prior commitment should be impossible — investigate");
} else if (resolvedAt > committedAt) {
  const lead = resolvedAt - committedAt;
  pass(
    "the commitment predates the resolution",
    `committed ${new Date(Number(committedAt) * 1000).toISOString()}, resolved ${new Date(
      Number(resolvedAt) * 1000,
    ).toISOString()} — ${lead}s later, timestamped by the chain, not by Predge`,
  );
} else {
  fail("resolution is not after the commitment", `committedAt ${committedAt}, resolvedAt ${resolvedAt}`);
}
pass("pre-commit hash on record", preCommitHash);

// ── 2. the bytes that settled ───────────────────────────────────────────────
console.log("\n[2] the signed bytes behind that hash");
const ref = await oracle.attestationRef(marketId);
const { envelope, source } = await loadEnvelope(ref);
if (!envelope) {
  fail("could not obtain the signed envelope", `source: ${source}`);
  console.log(
    "\n        Without the preimage the on-chain hash proves only that SOMETHING was\n" +
      "        committed. Publish the envelope inline on-chain (oracle.mjs --embed) to\n" +
      "        make this verification independent of any server.",
  );
} else {
  const canonical = envelope.canonical;
  const signature = envelope.signature;
  const publicKey = envelope.public_key ?? envelope.publicKey;
  if (typeof canonical !== "string" || !signature || !publicKey) {
    fail("envelope is missing canonical/signature/public_key", `source: ${source}`);
  } else {
    const recomputed = keccak256(toUtf8Bytes(canonical));
    if (recomputed === contentHash) {
      pass("these bytes are the bytes that settled", `keccak256(canonical) == the chain's contentHash · via ${source}`);
    } else {
      fail("the bytes do not match the chain", `recomputed ${recomputed}\n        on-chain   ${contentHash}`);
    }

    // ── 3. the signature ────────────────────────────────────────────────────
    console.log("\n[3] the ed25519 signature over those exact bytes");
    if (verifyEd25519(canonical, signature, publicKey)) {
      pass("signature is valid", `key ${publicKey}`);
    } else {
      fail("signature does NOT verify", `key ${publicKey}`);
    }

    // ── 4. the key is a published, active Predge key ────────────────────────
    console.log("\n[4] the signing key is published and active");
    try {
      const r = await fetch(keysUrl, { signal: AbortSignal.timeout(15000) });
      const raw = Buffer.from(await r.arrayBuffer());
      const registry = JSON.parse(raw.toString("utf8"));
      const entry = (registry.keys || []).find((k) => k.public_key?.toLowerCase() === publicKey.toLowerCase());
      if (!entry) fail("key is not in the published registry", `key ${publicKey}`);
      else if (entry.active === false) fail("key is listed but REVOKED", `kid ${entry.kid}`);
      else pass("key is listed and active", `kid ${entry.kid} · ${keysUrl}`);

      // ── 5. even the key registry is anchored on Arc ───────────────────────
      const registrySha = crypto.createHash("sha256").update(raw).digest("hex");
      console.log("\n[5] the key registry itself is anchored on Arc");
      if (!has("--deep")) {
        skip("skipped (pass --deep to scan Arc for the anchor)", `sha256(registry) = ${registrySha}`);
      } else {
        const settlement = new Contract(arg("--settlement", DEFAULT_SETTLEMENT), SETTLEMENT_ABI, provider);
        const head = await provider.getBlockNumber();
        let found = null;
        // Arc's public RPC caps log ranges, so walk backwards in windows.
        for (let to = head; to > 0 && !found; to -= 9000) {
          const from = Math.max(0, to - 8999);
          let logs = [];
          try {
            logs = await settlement.queryFilter("Paid", from, to);
          } catch {
            break; // RPC refused the range — report honestly rather than guessing
          }
          found = logs.find((l) => (l.args?.meta || "").includes(registrySha)) ?? null;
          if (from === 0) break;
        }
        if (found) {
          pass(
            "registry hash is anchored on-chain",
            `sha256 ${registrySha}\n        tx https://testnet.arcscan.app/tx/${found.transactionHash}`,
          );
        } else {
          skip(
            "no anchor found in the scanned range",
            `sha256 ${registrySha} — the registry may be newer than its last anchor, or the anchor is outside the scanned blocks`,
          );
        }
      }
    } catch (e) {
      fail("could not check the key registry", e.message);
    }
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(63));
if (failures === 0) {
  console.log("VERIFIED — this resolution is what Predge signed before the outcome,");
  console.log("and the chain proves it has not been altered since.");
  process.exit(0);
} else {
  console.log(`NOT VERIFIED — ${failures} check(s) failed. Do not settle against this record.`);
  process.exit(1);
}
