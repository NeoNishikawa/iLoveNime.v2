const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("halaman feedback terpisah memiliki field dan batas upload yang benar", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/feedback.html"), "utf8");
  assert.match(html, /<form[^>]*id="feedbackForm"/);
  assert.match(html, /name="username"/);
  assert.match(html, /name="description"/);
  assert.match(html, /accept="image\/jpeg,image\/png"/);
  assert.match(html, /data-max-size="3145728"/);
  assert.match(html, /id="feedbackSubmit"/);
});

test("main navigation points to the separate feedback page", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  assert.match(html, /href="\/feedback\.html"[^>]*>Kritik dan saran</);
});
