const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let view;
test.before(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/view.js"), "utf8");
  view = await import(`data:text/javascript,${encodeURIComponent(source)}`);
});

test("Local Data dirender sebagai kartu poster dengan progres dan aksi Open", () => {
  const html = view.renderCollection([{ slug: "one", title: "One Anime", image: "poster.jpg", status: "watching", progress: 3, total: 12 }]);
  assert.match(html, /class="saved-card"/);
  assert.match(html, /class="saved-card__art"/);
  assert.match(html, /Episode 3 \/ 12/);
  assert.match(html, /25%/);
  assert.match(html, /data-open="one"/);
  assert.match(html, /class="saved-card__action"/);
});

test("filter Local Data menampilkan label status yang ramah pengguna", () => {
  const html = view.renderCollectionFilters([
    { status: "completed" },
    { status: "watching" },
    { status: "planned" },
    { status: "dropped" },
  ], "completed");
  assert.match(html, /Sudah ditonton/);
  assert.match(html, /Belum selesai/);
  assert.match(html, /Rencana/);
  assert.match(html, /Block/);
  assert.match(html, /aria-pressed="true"/);
});
