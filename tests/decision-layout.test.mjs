import assert from "node:assert/strict";
import test from "node:test";
import {
  checkProjectLayout,
  cssLayoutViolations,
  jsxLayoutViolations,
  geometryViolations,
} from "../scripts/check-decision-layout.mjs";

test("the reported Chinese early-wrap defect is caught even in shared, nested and overriding CSS", () => {
  assert.equal(
    cssLayoutViolations(".decision-outcome .decision-outcome__summary { max-width: 70ch; }").length,
    1,
  );
  assert.equal(
    cssLayoutViolations(
      "@media(min-width: 900px) { .decision-outcome { p { max-inline-size: 40rem; } } }",
    ).length,
    1,
  );
  assert.equal(
    cssLayoutViolations(
      ".decision-outcome p { max-width: 70ch; } .decision-outcome p { max-width: none; }",
    ).length,
    1,
  );
  assert.equal(cssLayoutViolations(".ask-claim-row p { max-width: 600px; }").length, 1);
  assert.equal(cssLayoutViolations(".decision-outcome__summary { width: 50%; }").length, 1);
});

test("page boundaries, ordinary mobile wrapping and unrelated article typography remain valid", () => {
  assert.equal(
    cssLayoutViolations(
      ".decision-page__container { max-width: 70rem; } .decision-outcome p { max-width: none; } .decision-choice button { max-width: 100%; } .article p { max-width: 70ch; }",
    ).length,
    0,
  );
  assert.equal(
    jsxLayoutViolations('<div className="mx-auto max-w-5xl"><p>自然换行</p></div>').length,
    0,
  );
});

test("prose utilities and inline styles cannot silently restore the same cap", () => {
  assert.ok(jsxLayoutViolations('<p className="max-w-prose">中文结论</p>').length);
  assert.ok(jsxLayoutViolations('<div className="md:max-w-[75ch]">候选事实</div>').length);
  assert.ok(jsxLayoutViolations('<div className="max-w-xl"><p>被父级截窄</p></div>').length);
  assert.ok(jsxLayoutViolations('<p style={{ maxWidth: "42rem" }}>下一步</p>').length);
});

test("rendered geometry rejects the actual reported dimensions and overflow without rejecting full-width columns", () => {
  assert.equal(
    geometryViolations({
      rows: [
        { name: "summary", width: 566, availableWidth: 1067 },
        { name: "next", width: 528, availableWidth: 1067 },
      ],
      clientWidth: 1280,
      scrollWidth: 1280,
    }).length,
    2,
  );
  assert.equal(
    geometryViolations({
      rows: [{ name: "mobile", width: 328, availableWidth: 328 }],
      clientWidth: 360,
      scrollWidth: 360,
    }).length,
    0,
  );
  assert.ok(geometryViolations({ rows: [], clientWidth: 360, scrollWidth: 400 }).length);
  assert.ok(
    geometryViolations({
      rows: [{ name: "summary", width: 1067, availableWidth: 1067 }],
      clientWidth: 1369,
      scrollWidth: 1369,
      requestedWidth: 375,
    }).length,
  );
});

test("all current assistant styles and components pass the regression gate", () => {
  assert.deepEqual(checkProjectLayout(), []);
});
