/**
 * Generate the Cachet oracle's ed25519 signing key.
 *
 *   node script/gen-oracle-key.mjs
 *
 * WHY A SEPARATE KEY. The API's ATTEST_SIGNING_KEY signs calls and settlements
 * on a server we operate; this one signs market resolutions from an operator
 * machine. Different role, different blast radius: if one is ever compromised
 * the other's history stays intact, and the registry can revoke exactly one of
 * them. Reusing the production key here would have meant copying it out of the
 * server environment — the single worst habit in key management.
 *
 * The private key is written OUTSIDE the repo (chmod 600) and appended to the
 * gitignored .env. Only the PUBLIC key is printed, and only the public key ever
 * needs to leave this machine — it goes in the published registry so anyone can
 * verify a resolution without us.
 */
import crypto from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENV = new URL("../.env", import.meta.url).pathname;
const KEY_DIR = join(homedir(), ".predge-x402");
const KEY_FILE = join(KEY_DIR, "cachet-oracle-signing.json");

if (existsSync(KEY_FILE)) {
  console.error(`Refusing to overwrite ${KEY_FILE}`);
  console.error("A second key would orphan every resolution already signed with the first.");
  process.exit(1);
}
if (existsSync(ENV) && /^ORACLE_SIGNING_KEY=/m.test(readFileSync(ENV, "utf8"))) {
  console.error(".env already defines ORACLE_SIGNING_KEY — remove it first if you really mean to rotate.");
  process.exit(1);
}

// ed25519 seed = the raw 32-byte private scalar; the same form the API accepts.
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
const seedHex = pkcs8.subarray(pkcs8.length - 32).toString("hex");
const spki = publicKey.export({ format: "der", type: "spki" });
const publicHex = spki.subarray(spki.length - 32).toString("hex");
const kid = publicHex.slice(0, 16); // same derivation the registry uses

// Prove the key round-trips before we persist anything that depends on it.
const probe = crypto.sign(null, Buffer.from("cachet-selftest", "utf8"), privateKey);
if (!crypto.verify(null, Buffer.from("cachet-selftest", "utf8"), publicKey, probe)) {
  console.error("Self-test failed — refusing to write a key that cannot sign.");
  process.exit(1);
}

mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
writeFileSync(
  KEY_FILE,
  JSON.stringify(
    {
      purpose: "Predge Cachet oracle — ed25519 resolution signing key",
      role: "cachet-oracle",
      created_at: new Date().toISOString(),
      kid,
      public_key: publicHex,
      private_key_seed: seedHex,
      note: "Move to a password manager. Never commit. Only the public key is published.",
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
chmodSync(KEY_FILE, 0o600);

appendFileSync(ENV, `\n# Cachet oracle resolution-signing key (ed25519 seed). Public key: ${publicHex}\nORACLE_SIGNING_KEY=${seedHex}\n`);

console.log("Cachet oracle key generated.\n");
console.log("  kid        ", kid);
console.log("  public key ", publicHex);
console.log("");
console.log("  private key ->", KEY_FILE, "(chmod 600, outside the repo)");
console.log("  ORACLE_SIGNING_KEY appended to .env (gitignored)");
console.log("");
console.log("Next: publish the PUBLIC key in the registry so verify-cachet.mjs can");
console.log("reach step 4 — set on the API service:");
console.log(`  ATTEST_ORACLE_PUBLIC_KEY=${publicHex}`);
