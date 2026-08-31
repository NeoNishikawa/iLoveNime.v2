const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let storage;
test.before(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/storage.js"), "utf8");
  storage = await import(`data:text/javascript,${encodeURIComponent(source)}`);
});

const item = (overrides = {}) => ({ slug: "demo", total: 4, progress: 0, watchedEpisodes: [], status: "planned", ...overrides });

test("anime tanpa episode ditonton tetap berstatus planned", () => {
  assert.equal(storage.deriveStatus(item({ status: "watching" })), "planned");
});

test("anime dengan progres parsial otomatis menjadi watching", () => {
  assert.equal(storage.deriveStatus(item({ progress: 2, watchedEpisodes: [1, 2], status: "planned" })), "watching");
});

test("anime hanya completed jika semua episode dari awal sampai akhir ditonton", () => {
  assert.equal(storage.deriveStatus(item({ progress: 4, watchedEpisodes: [1, 2, 3, 4], status: "watching" })), "completed");
  assert.equal(storage.deriveStatus(item({ progress: 4, watchedEpisodes: [1, 2, 4], status: "watching" })), "watching");
});

test("progres lama tanpa watchedEpisodes tetap dapat dimigrasikan", () => {
  assert.equal(storage.deriveStatus(item({ progress: 4, watchedEpisodes: [], status: "watching" })), "completed");
  assert.equal(storage.deriveStatus(item({ progress: 2, watchedEpisodes: [], status: "completed" })), "watching");
});

test("status dropped tetap menjadi Block sampai pengguna menggantinya", () => {
  assert.equal(storage.deriveStatus(item({ status: "dropped", progress: 0 })), "dropped");
});
