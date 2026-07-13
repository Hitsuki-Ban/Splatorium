import assert from "node:assert/strict";
import test from "node:test";

import {
  assertInventoryBytesMatch,
  describeInventoryDrift,
  normalizeNoticeText,
  run,
} from "./license-inventory.mjs";

test("write mode requires an explicit audit date and source version", () => {
  assert.throws(
    () => run(["--write"]),
    /--write requires --audit-date in YYYY-MM-DD format/,
  );
  assert.throws(
    () => run(["--write", "--audit-date", "2026-07-14"]),
    /--write requires --audit-version as a semantic version/,
  );
});

test("synthetic added dependency produces an actionable drift diagnostic", () => {
  const baseline = {
    packages: [
      {
        name: "existing-package",
        version: "1.0.0",
        scopes: ["browser"],
      },
    ],
    curatedCss: [],
    copiedSources: [],
  };
  const withAddedDependency = structuredClone(baseline);
  withAddedDependency.packages.push({
    name: "synthetic-added-dependency",
    version: "9.9.9",
    scopes: ["browser"],
  });

  assert.equal(
    describeInventoryDrift(JSON.stringify(baseline), JSON.stringify(withAddedDependency)),
    "+ synthetic-added-dependency@9.9.9 [browser]",
  );
  assert.throws(
    () => assertInventoryBytesMatch(JSON.stringify(baseline), JSON.stringify(withAddedDependency)),
    /License inventory drift detected[\s\S]*\+ synthetic-added-dependency@9\.9\.9 \[browser\]/,
  );
});

test("notice rendering normalizes package line endings without changing audit bytes", () => {
  assert.equal(normalizeNoticeText("first  \r\nsecond\rthird\n"), "first\nsecond\nthird\n");
});
