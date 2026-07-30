const test = require("node:test");
const assert = require("node:assert/strict");

global.window = global;
require("../assets/default-data.js");
require("../assets/engine.js");
const { run } = require("./engine.test.js");

for (const result of run()) {
  test(result.name, () => {
    assert.equal(result.ok, true, result.error || result.name);
  });
}
