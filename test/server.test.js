const test = require("node:test");
const assert = require("node:assert/strict");
const { slices, uniqueBySlug, normalizeEpisodes, todayKey, decodeMirror, parseMirrorOptions, parseAnimeDetail } = require("../server");

test("catalog results are split into slides of no more than twenty titles", () => {
  const data = Array.from({ length: 43 }, (_, index) => ({ slug: `anime-${index}` }));
  const result = slices(data);
  assert.equal(result.length, 3);
  assert.equal(result[0].length, 20);
  assert.equal(result[1].length, 20);
  assert.equal(result[2].length, 3);
});

test("duplicate YAOI result slugs are removed while order is preserved", () => {
  const result = uniqueBySlug([{ slug: "one" }, { slug: "two" }, { slug: "one" }, { slug: "three" }]);
  assert.deepEqual(result.map((item) => item.slug), ["one", "two", "three"]);
});

test("episodes are sorted by their source number instead of source order", () => {
  const result = normalizeEpisodes([
    { episode: "Episode 25", slug: "anime-episode-25" },
    { episode: "Episode 12", slug: "anime-episode-12" },
    { episode: "Episode 1", slug: "anime-episode-1" },
  ]);
  assert.deepEqual(result.map((episode) => [episode.number, episode.title]), [
    [1, "Episode 1"],
    [12, "Episode 12"],
    [25, "Episode 25"],
  ]);
});

test("23 August 2026 resolves to the Sunday schedule in the user timezone", () => {
  assert.equal(todayKey(new Date("2026-08-23T00:00:00Z")), "minggu");
});

test("base64 mirror markup produces an iframe URL", () => {
  const encoded = Buffer.from('<iframe src="https://mirror.example/watch"></iframe>').toString("base64");
  assert.equal(decodeMirror(encoded), "https://mirror.example/watch");
});

test("mirror parser keeps direct data-url options", () => {
  const html = `<select class="mirror"><option value="https://mirror.example/one">Mirror 1</option><option data-url="https://mirror.example/two">Mirror 2</option></select>`;
  assert.deepEqual(parseMirrorOptions(html).map((item) => item.url), ["https://mirror.example/one", "https://mirror.example/two"]);
});

test("detail parser returns a title and episode slug", () => {
  const html = `<div class="infox"><h1>Tensei shitara Slime Datta Ken</h1><div class="alter">That Time I Got Reincarnated as a Slime</div></div><div id="daftarepisode"><ul><li><a href="/nonton-tensei-shitara-slime-datta-ken-episode-1/">Episode 1</a></li></ul></div>`;
  const detail = parseAnimeDetail(html, "tensei-shitara-slime-datta-ken");
  assert.equal(detail.title, "Tensei shitara Slime Datta Ken");
  assert.equal(detail.episodes[0].slug, "nonton-tensei-shitara-slime-datta-ken-episode-1");
});


test("blocked source HTML is detected before it becomes an empty catalog", () => {
  const { isBlockedSourceHtml } = require("../server");
  assert.equal(isBlockedSourceHtml("<title>Just a moment...</title><div>Checking your browser</div>"), true);
  assert.equal(isBlockedSourceHtml("<main><div class=bs><div class=tt>Anime</div></div></main>"), false);
});

test("daily fallback snapshot is available when live schedule is unavailable", () => {
  const { readFallbackDaily } = require("../server");
  const fallback = readFallbackDaily();
  assert.ok(fallback?.data?.length > 0);
  assert.equal(fallback.provider, "fallback");
  assert.equal(fallback.stale, true);
});

test("ZIP cache coalesces concurrent calls and preserves stale data", async () => {
  const { cached, isStale } = require("../server");
  let calls = 0;
  const value = await Promise.all([
    cached("zip:coalesce", async () => { calls += 1; return ["ok"]; }, 1000),
    cached("zip:coalesce", async () => { calls += 1; return ["ok"]; }, 1000),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(value[0], ["ok"]);
  await cached("zip:stale", async () => ["old"], 0, true);
  const stale = await cached("zip:stale", async () => { throw new Error("403"); }, 0, true);
  assert.deepEqual(stale, ["old"]);
  assert.equal(isStale("zip:stale"), true);
});


test("snapshot detail exists for a known daily title during source block", () => {
  const { fallbackDetailFromDaily } = require("../server");
  const detail = fallbackDetailFromDaily("black-torch");
  assert.equal(detail.source, "local-snapshot");
  assert.equal(detail.title, "Black Torch");
  assert.deepEqual(detail.episodes, []);
});
