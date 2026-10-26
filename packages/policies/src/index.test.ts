import test from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine } from "./index.js";

test("blocks destructive root deletion", () => {
  const decision = new PolicyEngine().classifyCommand("rm -rf /");
  assert.equal(decision.level, "blocked");
});

test("allows local pnpm test", () => {
  const decision = new PolicyEngine().classifyCommand("pnpm test");
  assert.equal(decision.level, "safe_local");
});

test("gates production deploys", () => {
  const decision = new PolicyEngine().classifyCommand("vercel --prod");
  assert.equal(decision.level, "needs_approval");
  assert.equal(decision.actionType, "production_deploy");
});
