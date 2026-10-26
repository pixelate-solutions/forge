import { runVisualQA } from "./index.js";
import { existsSync } from "node:fs";
import path from "node:path";

const baseUrl = process.env.FORGE_VISUAL_QA_BASE_URL ?? "http://localhost:3099";
const routes = (process.env.FORGE_VISUAL_QA_ROUTES ?? "/").split(",").map((route) => route.trim());
const runId = process.env.FORGE_VISUAL_QA_RUN_ID ?? `manual-${Date.now()}`;
const outputDir = process.env.FORGE_ARTIFACTS_DIR
  ? path.resolve(process.env.FORGE_ARTIFACTS_DIR)
  : path.join(findWorkspaceRoot(process.cwd()), "artifacts");

const result = await runVisualQA({ baseUrl, routes, runId, outputDir });
console.log(JSON.stringify({ passed: result.passed, reportPath: result.reportPath }, null, 2));
process.exit(result.passed ? 0 : 1);

function findWorkspaceRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}
