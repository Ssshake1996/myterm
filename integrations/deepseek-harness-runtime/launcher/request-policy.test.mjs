import assert from "node:assert/strict";
import { applyChatCompletionsRequestPolicy } from "./request-policy.mjs";

const inherited = applyChatCompletionsRequestPolicy(
  {
    body: JSON.stringify({
      model: "compat-model",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 256000,
      tools: [{ type: "function", function: { name: "read", parameters: {} } }],
    }),
  },
  { models: [{ id: "compat-model", name: "Compatibility Model", contextWindow: 131072 }] },
);
const inheritedBody = JSON.parse(inherited.init.body);
assert.equal(Object.hasOwn(inheritedBody, "max_tokens"), false);
assert.equal(inheritedBody.tools.length, 1);
assert.deepEqual(inherited.policy, {
  maxTokens: "provider_default",
  configuredContextWindow: 131072,
  configuredMaxTokens: null,
  removedInheritedMaxTokens: 256000,
});

const explicit = applyChatCompletionsRequestPolicy(
  { body: JSON.stringify({ model: "compat-model", max_tokens: 16384 }) },
  { models: [{ id: "compat-model", maxTokens: 16384 }] },
);
assert.equal(JSON.parse(explicit.init.body).max_tokens, 16384);
assert.deepEqual(explicit.policy, {
  maxTokens: "explicit",
  configuredContextWindow: null,
  configuredMaxTokens: 16384,
});

const unavailable = applyChatCompletionsRequestPolicy({ body: new Uint8Array() }, {});
assert.equal(unavailable.policy.maxTokens, "unavailable");

process.stdout.write(JSON.stringify({ ok: true, scenarios: 3 }));
