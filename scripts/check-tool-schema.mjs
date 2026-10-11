import assert from "node:assert/strict";
import { parameters } from "../tools/list-notifications.js";

function walkSchema(value, path = "parameters") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSchema(item, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") return;

  assert.equal(Object.hasOwn(value, "const"), false, `${path} must not contain const`);
  assert.equal(Object.hasOwn(value, "deprecated"), false, `${path} must not contain deprecated`);

  if (Array.isArray(value.enum)) {
    assert.equal(value.enum.includes(""), false, `${path}.enum must not contain an empty value`);
    assert.ok(value.enum.length > 0, `${path}.enum must not be empty`);
  }

  for (const [key, child] of Object.entries(value)) {
    walkSchema(child, `${path}.${key}`);
  }
}

walkSchema(parameters);
assert.equal(parameters.properties.type.enum.includes(""), false);
assert.equal(parameters.required?.includes("type") ?? false, false);
console.log("tool schema check passed");
