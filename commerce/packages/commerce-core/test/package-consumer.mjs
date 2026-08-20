import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const coreDirectory = process.cwd();
const contractsDirectory = join(coreDirectory, "../commerce-contracts");
const consumerDirectory = mkdtempSync(join(tmpdir(), "emdash-commerce-consumer-"));
const scopeDirectory = join(consumerDirectory, "node_modules", "@emdash-commerce");
mkdirSync(scopeDirectory, { recursive: true });
symlinkSync(coreDirectory, join(scopeDirectory, "core"));
symlinkSync(contractsDirectory, join(scopeDirectory, "contracts"));

const consumerScript = [
  'import { calculateTotals } from "@emdash-commerce/core";',
  'const totals = calculateTotals({',
  '  currency: "MYR",',
  '  lines: [{ unitAmountMinor: 1000, quantity: 2 }],',
  '  discountMinor: 200,',
  '  taxMinor: 180,',
  '  shippingMinor: 500,',
  '});',
  'if (totals.totalMinor !== 2480 || totals.currency !== "MYR") {',
  '  throw new Error("Unexpected consumer totals: " + totals.totalMinor + " " + totals.currency);',
  '}',
  'console.log("consumer total=" + totals.totalMinor + " " + totals.currency);',
].join("\n");

try {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", consumerScript],
    { cwd: consumerDirectory, encoding: "utf8" },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  process.stdout.write(result.stdout);
} finally {
  rmSync(consumerDirectory, { recursive: true, force: true });
}
