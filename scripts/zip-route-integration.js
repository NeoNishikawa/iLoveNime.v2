const http = require("node:http");
const assert = require("node:assert/strict");

const requests = [];
const PORT = 4391;
const baseUrl = `http://127.0.0.1:${PORT}`;
const day = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "Asia/Bangkok" }).format(new Date()).toLowerCase();
const card = `<div class="bixbox"><div class="releases"><h3><span>${day}</span></h3></div><div class="bs"><div class="bsx"><a href="${baseUrl}/anime/animasu-anime/"><div class="tt">Animasu Anime</div><span class="epx">Episode 1</span></a></div></div></div>`;
const detail = `<div class="infox"><h1>Animasu Anime</h1><div class="alter">Animasu Series</div><div class="spe"><span>Jenis: Series</span><span>Status: Ongoing</span><span>Episode: 1</span></div></div><div class="sinopsis"><p>Animasu detail</p></div><div id="daftarepisode"><ul><li><a href="/nonton-animasu-anime-episode-1/">Episode 1</a></li></ul></div>`;
const mirror = `<div class="player-embed"><iframe src="https://mirror.example/animasu"></iframe></div>`;

const animasu = http.createServer((request, response) => {
  const pathname = new URL(request.url, baseUrl).pathname;
  requests.push(pathname);
  let body = pathname === "/jadwal/" ? card : pathname.includes("/anime/animasu-anime/") ? detail : pathname.includes("nonton-animasu-anime-episode-1") ? mirror : card;
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
});

async function json(url) { const response = await fetch(url); return { status: response.status, body: await response.json() }; }

process.env.ANIMASU_BASE_URL = baseUrl;
process.env.REQUEST_TIMEOUT_MS = "1000";
process.env.DAILY_CACHE_MS = "1";
process.env.MAX_SEARCH_PAGES = "2";

animasu.listen(PORT, "127.0.0.1", async () => {
  const { app } = require("../server");
  const application = app.listen(0, "127.0.0.1", async () => {
    const base = `http://127.0.0.1:${application.address().port}`;
    try {
      const daily = await json(`${base}/api/daily`);
      assert.equal(daily.status, 200);
      assert.equal(daily.body.provider, "animasu");
      assert.equal(daily.body.data[0].sourceProvider, "animasu");

      const search = await json(`${base}/api/catalog?search=Animasu&genre=`);
      assert.equal(search.status, 200);
      assert.equal(search.body.provider, "animasu");
      assert.equal(search.body.data[0].slug, "animasu-anime");

      const detailResponse = await json(`${base}/api/anime/animasu-anime?provider=external&sourceUrl=http://127.0.0.1:4394/blocked`);
      assert.equal(detailResponse.status, 200);
      assert.equal(detailResponse.body.provider, "animasu");
      assert.equal(detailResponse.body.data.episodes[0].sourceProvider, "animasu");

      const streams = await json(`${base}/api/streams/nonton-animasu-anime-episode-1?provider=external&sourceUrl=http://127.0.0.1:4392/blocked`);
      assert.equal(streams.status, 200);
      assert.equal(streams.body.provider, "yaoi");
      assert.equal(streams.body.data[0].url, "https://mirror.example/animasu");

      const health = await json(`${base}/api/health`);
      assert.deepEqual(health.body.sources.map((source) => source.id), ["animasu", "yaoi"]);
      assert.equal(requests.some((path) => path.includes("blocked")), false);
      console.log(JSON.stringify({ mode: "animasu + yaoi only", daily: "ok", search: "ok", detail: "ok", streams: "ok", sourceIsolation: "ok", requestCount: requests.length }, null, 2));
    } finally {
      application.close(() => animasu.close());
    }
  });
});
