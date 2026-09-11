import assert from "node:assert/strict";
import { validateEnvironment, normalizeGroupName, summarizeError } from "../lib/index.js";

assert.equal(normalizeGroupName("生产/华东"), "生产-华东");
assert.equal(normalizeGroupName("  "), "default");
assert.equal(validateEnvironment({ id: "prod-1", name: "生产", host: "10.0.0.1", username: "root" }).ok, true);
assert.equal(validateEnvironment({ id: "bad id", name: "x", host: "10.0.0.1", username: "root" }).ok, false);
assert.match(summarizeError(new Error("ECONNREFUSED")), /ECONNREFUSED/);
console.log("dsh-remote-ops smoke: ok");
