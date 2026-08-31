const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");
const fs = require("fs");
const { ANIMASU_BASE_URL, PORT, REQUEST_TIMEOUT_MS, SEARCH_BUDGET_MS, DAILY_CACHE_MS, DETAIL_CACHE_MS, STREAM_CACHE_MS, MAX_UPSTREAM_CONCURRENCY, UPSTREAM_MIN_INTERVAL_MS, SOURCE_BLOCK_COOLDOWN_MS } = require("./settings");

process.env.ANIMASU_BASE_URL = ANIMASU_BASE_URL;
const { animasu } = require("yaoi");
axios.defaults.timeout = REQUEST_TIMEOUT_MS;

const app = express();
const memory = new Map();
const pending = new Map();
const staleKeys = new Set();
const CACHE_MS = 75_000;
const upstreamQueue = [];
let upstreamActive = 0;
const upstreamLastStarted = new Map();
const upstreamCooldownUntil = new Map();
let upstreamDrainTimer = null;
const MAX_CACHE_ENTRIES = Number(process.env.MAX_CACHE_ENTRIES) > 0 ? Number(process.env.MAX_CACHE_ENTRIES) : 64;
const SLIDE_SIZE = 20;
const MAX_SEARCH_PAGES = Number(process.env.MAX_SEARCH_PAGES) > 0 ? Number(process.env.MAX_SEARCH_PAGES) : 20;
const MIN_SEARCH_LENGTH = 2;
const USER_TIME_ZONE = "Asia/Bangkok";
const DAY_KEYS = ["minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu"];
const TITLE_ALIASES_PATH = path.join(__dirname, "public", "data", "title-aliases.json");
const BUILTIN_TITLE_ALIASES = { "that time i got reincarnated as a slime": ["Tensei shitara Slime Datta Ken"] };
const ALIAS_MAX_CANDIDATES = 6;
const FALLBACK_DAILY_PATH = path.join(__dirname, "public", "data", "last-known-daily.json");

function storeCache(key, data) {
  memory.delete(key);
  memory.set(key, { data, timestamp: Date.now() });
  while (memory.size > MAX_CACHE_ENTRIES) memory.delete(memory.keys().next().value);
}

function isEmptyData(data) {
  return data === undefined || data === null || (Array.isArray(data) && data.length === 0) || (Array.isArray(data?.data) && data.data.length === 0);
}

function cached(key, task, ttl = CACHE_MS, staleOnError = false) {
  const previous = memory.get(key);
  if (previous && Date.now() - previous.timestamp < ttl) {
    staleKeys.delete(key);
    return Promise.resolve(previous.data);
  }
  if (pending.has(key)) return pending.get(key);
  const promise = Promise.resolve().then(task).then((data) => {
    if (!isEmptyData(data)) {
      storeCache(key, data);
      staleKeys.delete(key);
      return data;
    }
    if (staleOnError && previous) {
      staleKeys.add(key);
      return previous.data;
    }
    return data;
  }).catch((error) => {
    if (staleOnError && previous) {
      staleKeys.add(key);
      return previous.data;
    }
    throw error;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

function isStale(key) { return staleKeys.has(key); }

function readFallbackDaily() {
  try {
    const fallback = JSON.parse(fs.readFileSync(FALLBACK_DAILY_PATH, "utf8"));
    const data = Array.isArray(fallback.data) ? fallback.data : [];
    return { ...fallback, data, slides: slices(data), total: data.length, slideSize: SLIDE_SIZE, provider: "fallback", stale: true };
  } catch (_) { return null; }
}

function fallbackDetailFromDaily(slug) {
  const item = readFallbackDaily()?.data?.find((anime) => anime.slug === String(slug || ""));
  if (!item) return null;
  return {
    ...item,
    synonym: "",
    synopsis: "Detail live sedang tidak tersedia; metadata dasar ini berasal dari snapshot jadwal terakhir.",
    rating: 0,
    genres: [],
    status: item.status || "UNKNOWN",
    aired: "Unknown",
    duration: "Unknown",
    studio: "Unknown",
    season: "Unknown",
    trailer: "",
    updateAt: "",
    episodes: [],
    batches: [],
    source: "local-snapshot",
  };
}

function normalizeSearchText(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const aliasMemory = new Map();
const aliasPending = new Map();
async function fetchEnglishAliases(search) {
  const normalized = normalizeSearchText(search);
  if (normalized.length < 3) return [];
  const aliases = (BUILTIN_TITLE_ALIASES[normalized] || []).filter((item) => normalizeSearchText(item) !== normalized).slice(0, ALIAS_MAX_CANDIDATES);
  aliasMemory.set(normalized, { data: aliases, timestamp: Date.now() });
  return aliases;
}

function splitAliases(value) {
  if (Array.isArray(value)) return value.flatMap(splitAliases);
  return String(value || "").split(/[|;\n,]+/).map((item) => item.replace(/^(synonym|alternative|english title|judul inggris)\s*[:：-]\s*/i, "").trim()).filter(Boolean);
}

let titleAliasIndex;
let titleAliasBySlug;
let titleAliasByTitle;
function readTitleAliases() {
  if (titleAliasIndex) return titleAliasIndex;
  try {
    const parsed = JSON.parse(fs.readFileSync(TITLE_ALIASES_PATH, "utf8"));
    titleAliasIndex = Array.isArray(parsed.data) ? parsed.data : [];
  } catch (_) { titleAliasIndex = []; }
  titleAliasBySlug = new Map(titleAliasIndex.filter((record) => record.slug).map((record) => [record.slug, record]));
  titleAliasByTitle = new Map(titleAliasIndex.filter((record) => record.title).map((record) => [normalizeSearchText(record.title), record]));
  return titleAliasIndex;
}

function findTitleAlias(item) {
  readTitleAliases();
  const itemSlug = String(item.slug || "");
  const normalizedTitle = normalizeSearchText(item.title);
  return titleAliasBySlug.get(itemSlug) || [...titleAliasBySlug.entries()].find(([slug]) => itemSlug.startsWith(`${slug}-`))?.[1] || titleAliasByTitle.get(normalizedTitle) || [...titleAliasByTitle.entries()].find(([title]) => normalizedTitle.startsWith(`${title} `))?.[1] || titleAliasIndex.find((record) => record.aliases?.some((alias) => normalizeSearchText(alias) === normalizedTitle));
}

function titleAliasRecord(item) {
  const aliases = [...new Set([item.title, item.englishTitle, ...splitAliases(item.aliases), ...splitAliases(item.synonym)].filter(Boolean))];
  const normalizedTitle = normalizeSearchText(item.title);
  const known = findTitleAlias(item);
  const mergedAliases = [...new Set([...aliases, ...(known?.aliases || [])])];
  const suffix = known?.title && item.title && normalizeSearchText(item.title).startsWith(normalizeSearchText(known.title)) ? String(item.title).slice(String(known.title).length).trim().replace(/^[:：-]\s*/, "") : "";
  const knownEnglish = known?.englishTitle ? `${known.englishTitle}${suffix ? ` ${suffix}` : ""}` : "";
  return { ...item, englishTitle: knownEnglish || item.englishTitle || mergedAliases.find((alias) => normalizeSearchText(alias) !== normalizedTitle && /^[\p{L}\p{N} ]+$/u.test(alias)) || "", aliases: mergedAliases };
}

function matchesTitle(item, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const enriched = item.aliases && Object.prototype.hasOwnProperty.call(item, "englishTitle") ? item : titleAliasRecord(item);
  return [enriched.title, enriched.englishTitle, ...(enriched.aliases || [])].some((value) => normalizeSearchText(value).includes(normalizedQuery));
}

function uniqueBySlug(items) {
  const seen = new Set();
  return items.filter((item) => item?.slug && !seen.has(item.slug) && seen.add(item.slug));
}

function episodeNumber(value, fallback) {
  const match = String(value || "").match(/(?:episode|eps?|ep)?\s*(\d+(?:\.\d+)?)/i);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) ? number : fallback;
}

function normalizeEpisodes(episodes = []) {
  return episodes
    .map((episode, index) => ({
      number: episodeNumber(episode?.episode || episode?.title, index + 1),
      title: episode?.episode || episode?.title || `Episode ${index + 1}`,
      slug: episode?.slug || "",
      sourceUrl: episode?.sourceUrl || "",
      sourceProvider: episode?.sourceProvider || "",
      sourceIndex: index,
    }))
    .filter((episode) => episode.slug)
    .sort((left, right) => left.number - right.number || left.sourceIndex - right.sourceIndex)
    .map(({ sourceIndex, ...episode }) => episode);
}

function slices(items) {
  return Array.from({ length: Math.ceil(items.length / SLIDE_SIZE) }, (_, index) => items.slice(index * SLIDE_SIZE, (index + 1) * SLIDE_SIZE));
}

function todayKey(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: USER_TIME_ZONE }).format(date).toLowerCase();
  return DAY_KEYS.includes(weekday) ? weekday : "minggu";
}

function todayLabel(date = new Date()) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: USER_TIME_ZONE }).format(date);
}

async function dailyAnime() {
  const day = todayKey();
  const { result } = await sourceRequest("/jadwal/", { headers: SOURCE_HEADERS, timeout: REQUEST_TIMEOUT_MS, validateStatus: (status) => status >= 200 && status < 300 });
  const scheduled = uniqueBySlug(parseDailyCards(result.data, day));
  if (!scheduled.length) throw new Error("Animasu tidak mengembalikan jadwal untuk hari ini.");
  return scheduled.map((anime) => titleAliasRecord({ ...anime, type: anime.type || "Series", episode: anime.episode || "Rilis hari ini", status: "NEW TODAY", daily: true, sourceProvider: "animasu" }));
}

async function dailyFromProvider() {
  return dailyAnime();
}

async function dailyWithSources() {
  let lastError;
  for (const source of SOURCE_CONFIGS) {
    try { return { data: await dailyFromProvider(source.id), provider: source.id }; } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Tidak ada source anime yang dapat diakses.");
}

async function genresWithSources() {
  let lastError;
  for (const source of SOURCE_CONFIGS) {
    try {
      const { result } = await sourceRequestFor(source.id, "/", { headers: SOURCE_HEADERS, timeout: REQUEST_TIMEOUT_MS, validateStatus: (status) => status >= 200 && status < 300 });
      const data = parseGenreLinks(result.data, source.baseUrl);
      if (data.length) return { data, provider: source.id };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Tidak ada source anime yang mengembalikan genre.");
}

function absoluteUrl(value, baseUrl = ANIMASU_BASE_URL) {
  if (!value) return "";
  try { return new URL(value, baseUrl).toString(); } catch { return value.startsWith("//") ? `https:${value}` : value; }
}

const SOURCE_HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", Accept: "text/html,application/xhtml+xml" };
const SOURCE_CONFIGS = [{ id: "animasu", baseUrl: ANIMASU_BASE_URL, kind: "animasu" }];
const SOURCE_BASE_URLS = SOURCE_CONFIGS.map((source) => source.baseUrl);
function isBlockedSourceHtml(html) {
  const text = String(html || "").toLowerCase();
  return text.includes("cf-chl-") || text.includes("just a moment") || (text.includes("cloudflare") && (text.includes("checking your browser") || text.includes("verify you are human")));
}
function getSourceConfig(provider = "animasu") {
  return SOURCE_CONFIGS.find((source) => source.id === provider) || SOURCE_CONFIGS[0];
}
async function sourceRequestFor(provider, pathname, options = {}) {
  const source = getSourceConfig(provider);
  try {
    const result = await upstreamGet(new URL(pathname, source.baseUrl).toString(), options);
    if (result.status < 200 || result.status >= 300) {
      const error = new Error(`${source.id} HTTP ${result.status}`);
      error.sourceBlocked = result.status === 403 || result.status === 429;
      throw error;
    }
    if (isBlockedSourceHtml(result.data)) {
      const error = new Error(`${source.id} mengembalikan halaman block/Cloudflare`);
      error.sourceBlocked = true;
      throw error;
    }
    markSourceSuccess(source.baseUrl, source.id);
    return { result, source };
  } catch (error) {
    const status = error?.response?.status;
    if (status === 403 || status === 429 || /block|cloudflare/i.test(error?.message || "")) error.sourceBlocked = true;
    error.sourceId = source.id;
    markSourceFailure(error);
    throw error;
  }
}
async function sourceRequest(pathname, options = {}) {
  const { result, source } = await sourceRequestFor("animasu", pathname, options);
  return { result, baseUrl: source.baseUrl };
}
function originFor(url) {
  try { return new URL(url).origin; } catch { return "unknown"; }
}
function scheduleUpstreamDrain(delayMs) {
  if (upstreamDrainTimer) return;
  upstreamDrainTimer = setTimeout(() => { upstreamDrainTimer = null; drainUpstreamQueue(); }, Math.max(0, delayMs));
}
function drainUpstreamQueue() {
  while (upstreamActive < MAX_UPSTREAM_CONCURRENCY && upstreamQueue.length) {
    const request = upstreamQueue[0];
    if (request.options.signal?.aborted) { upstreamQueue.shift().reject(new Error("Upstream request dibatalkan oleh client.")); continue; }
    const origin = request.origin;
    const now = Date.now();
    const cooldown = upstreamCooldownUntil.get(origin) || 0;
    if (cooldown > now) { scheduleUpstreamDrain(cooldown - now); return; }
    const nextAllowed = (upstreamLastStarted.get(origin) || 0) + UPSTREAM_MIN_INTERVAL_MS;
    if (nextAllowed > now) { scheduleUpstreamDrain(nextAllowed - now); return; }
    upstreamQueue.shift();
    upstreamLastStarted.set(origin, now);
    upstreamActive += 1;
    axios.get(request.url, request.options).then((result) => {
      if (result.status === 403 || result.status === 429) upstreamCooldownUntil.set(origin, Date.now() + SOURCE_BLOCK_COOLDOWN_MS);
      request.resolve(result);
    }, (error) => {
      if (error?.response?.status === 403 || error?.response?.status === 429) upstreamCooldownUntil.set(origin, Date.now() + SOURCE_BLOCK_COOLDOWN_MS);
      request.reject(error);
    }).finally(() => { upstreamActive -= 1; drainUpstreamQueue(); });
  }
}
function upstreamGet(url, options = {}) {
  return new Promise((resolve, reject) => { upstreamQueue.push({ url, origin: originFor(url), options, resolve, reject }); drainUpstreamQueue(); });
}
function withTimeout(task, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout setelah ${timeoutMs}ms`)), timeoutMs); });
  return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timer));
}
function runtimeStats() { return { cacheEntries: memory.size, pendingKeys: pending.size, upstreamActive, upstreamQueued: upstreamQueue.length, maxUpstreamConcurrency: MAX_UPSTREAM_CONCURRENCY, minIntervalMs: UPSTREAM_MIN_INTERVAL_MS, cooldownMs: SOURCE_BLOCK_COOLDOWN_MS }; }
const sourceState = { status: "unknown", sourceId: null, baseUrl: null, lastSuccessAt: null, lastError: null };
function markSourceSuccess(baseUrl, sourceId = "animasu") { sourceState.status = "up"; sourceState.sourceId = sourceId; sourceState.baseUrl = baseUrl; sourceState.lastSuccessAt = new Date().toISOString(); sourceState.lastError = null; }
function markSourceFailure(error) { sourceState.status = "down"; sourceState.sourceId = error?.sourceId || sourceState.sourceId; sourceState.lastError = error?.message || String(error); }
const catalogHits = new Map();
function catalogRateLimit(request, response, next) {
  const now = Date.now();
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const recent = (catalogHits.get(key) || []).filter((timestamp) => now - timestamp < 60_000);
  if (recent.length >= 30) return response.status(429).json({ data: [], slides: [], total: 0, error: "Terlalu banyak pencarian dalam satu menit. Tunggu sebentar lalu coba lagi." });
  recent.push(now);
  catalogHits.set(key, recent);
  if (catalogHits.size > 200) for (const [storedKey, timestamps] of catalogHits) if (!timestamps.some((timestamp) => now - timestamp < 60_000)) catalogHits.delete(storedKey);
  next();
}
const NON_ANIME_PATHS = new Set(["page", "pencarian", "jadwal", "genre", "genres", "studio", "karakter"]);

function extractSlug(value) {
  if (!value) return "";
  try {
    const pathname = new URL(value, ANIMASU_BASE_URL).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const candidate = segments.at(-1) || "";
    const slug = decodeURIComponent(candidate).trim();
    return !slug || /^\d+$/.test(slug) || NON_ANIME_PATHS.has(slug.toLowerCase()) ? "" : slug;
  } catch {
    const slug = String(value).split("?")[0].split("#")[0].split("/").filter(Boolean).at(-1)?.trim() || "";
    return /^\d+$/.test(slug) || NON_ANIME_PATHS.has(slug.toLowerCase()) ? "" : slug;
  }
}

function parseAnimeCard($, element) {
  const card = $(element);
  const link = card.find("a[href]").first().attr("href") || "";
  const title = card.find(".tt, .title, .entry-title").first().text().trim();
  const image = card.find("img").first().attr("data-src") || card.find("img").first().attr("src") || "";
  let status = card.find(".sb").first().text().trim();
  if (status === "🔥🔥🔥") status = "ONGOING";
  else if (status === "Selesai ✓") status = "COMPLETE";
  else status = "UPCOMING";
  return { title, slug: extractSlug(link), image, type: card.find(".typez").first().text().trim(), episode: card.find(".epx").first().text().trim(), status };
}

function parseAnimeCardsWithDiagnostics(html) {
  const $ = cheerio.load(html || "");
  const cards = $(".bs, .listupd .bs, .list-anime .bs").map((_, element) => parseAnimeCard($, element)).get();
  return { rawCount: cards.length, data: cards.filter((anime) => anime.title && anime.slug), missingSlug: cards.filter((anime) => anime.title && !anime.slug).map((anime) => anime.title) };
}

function parseAnimeCards(html) {
  return parseAnimeCardsWithDiagnostics(html).data;
}

function parseGenreLinks(html, baseUrl) {
  const $ = cheerio.load(html || "");
  const result = [];
  $("a[href*='/genre/'], a[href*='/category/']").each((_, element) => {
    const anchor = $(element);
    const name = anchor.text().replace(/\s+/g, " ").trim();
    const href = anchor.attr("href") || "";
    const slug = href.split("/").filter(Boolean).at(-1) || "";
    if (name && slug && !result.some((item) => item.slug === slug)) result.push({ name, slug, sourceUrl: absoluteUrl(href, baseUrl) });
  });
  return result;
}



function parseDailyCards(html, day) {
  const $ = cheerio.load(html || "");
  const normalizedDay = String(day || "").toLowerCase();
  const result = [];
  $(".bixbox").each((_, element) => {
    const box = $(element);
    const label = box.find(".releases h3 span, .releases h3, h3").first().text().trim().toLowerCase().replace("update acak", "random").replace("'", "");
    if (label === normalizedDay) box.find(".bs").each((__, card) => result.push(parseAnimeCard($, card)));
  });
  return result.filter((anime) => anime.title && anime.slug);
}

function hasNextPage(html) {
  const $ = cheerio.load(html || "");
  return $(".hpage .r, .pagination .next, a.next, a[rel=next]").length > 0;
}

function parseAlphabetCardsWithDiagnostics(html) {
  const $ = cheerio.load(html || "");
  const cards = $(".bx").map((_, element) => {
    const card = $(element);
    const anchor = card.find(".inx h2 a[href], h2 a[href], a[href]").first();
    const title = anchor.text().trim() || card.find(".tt, .title").first().text().trim();
    const image = card.find(".imgx img").first().attr("data-src") || card.find(".imgx img").first().attr("src") || "";
    return { title, slug: extractSlug(anchor.attr("href") || ""), image, type: card.find(".inx span").eq(3).text().trim(), episode: card.find(".inx span").eq(4).text().trim().replace(", ", ""), status: card.find("[class*=status], .sb").first().text().trim() };
  }).get();
  return { rawCount: cards.length, data: cards.filter((anime) => anime.title && anime.slug), missingSlug: cards.filter((anime) => anime.title && !anime.slug).map((anime) => anime.title) };
}

async function fetchAlphabetPage({ letter, page = 1 }) {
  const attempts = SOURCE_BASE_URLS.map((baseUrl) => ({ baseUrl, promise: upstreamGet(new URL(`/daftar-anime/page/${page}/`, baseUrl).toString(), { params: { show: String(letter || "").toUpperCase() }, headers: SOURCE_HEADERS, timeout: REQUEST_TIMEOUT_MS, validateStatus: (status) => status >= 200 && status < 400 }) }));
  const results = await Promise.allSettled(attempts.map((attempt) => attempt.promise));
  let lastError;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === "rejected") { lastError = result.reason; continue; }
    const diagnostics = parseAlphabetCardsWithDiagnostics(result.value.data);
    if (diagnostics.rawCount) { markSourceSuccess(attempts[index].baseUrl); return { ...diagnostics, hasNext: hasNextPage(result.value.data), source: attempts[index].baseUrl }; }
  }
  const failure = lastError || new Error("Semua domain Animasu tidak mengembalikan daftar anime.");
  markSourceFailure(failure);
  throw failure;
}

function parseAnimeDetail(html, slug, baseUrl = ANIMASU_BASE_URL) {
  const $ = cheerio.load(html || "");
  const info = $(".infox");
  const title = info.find("h1[itemprop='headline'], h1, .title").first().text().trim();
  const synonym = info.find(".alter, .synonym, [class*=alternative]").first().text().trim();
  const image = $(".bigcontent .thumb img, .thumb img, img[itemprop=image]").first().attr("src") || $(".bigcontent .thumb img, .thumb img").first().attr("data-src") || "";
  const readInfo = (label) => info.find(".spe span").filter((_, element) => $(element).text().toLowerCase().startsWith(`${label}:`)).first().text().split(":").slice(1).join(":").trim();
  const genres = [];
  info.find(".spe span").first().find("a[href]").each((_, element) => genres.push({ name: $(element).text().trim(), slug: extractSlug($(element).attr("href")) }));
  const episodes = [];
  const episodeNodes = $("#daftarepisode li").length ? $("#daftarepisode li") : $("#daftarepisode a[href]");
  episodeNodes.each((_, element) => {
    const anchor = $(element).is("a") ? $(element) : $(element).find(".lchx a[href], a[href]").first();
    const episodeSlug = extractSlug(anchor.attr("href"));
    const episodeTitle = anchor.text().trim();
    if (episodeSlug && episodeTitle) episodes.push({ episode: episodeTitle, slug: episodeSlug, sourceUrl: absoluteUrl(anchor.attr("href"), baseUrl), sourceProvider: "animasu" });
  });
  return { slug, title, synonym, synopsis: $(".sinopsis p, .synopsis p").first().text().trim(), image: absoluteUrl(image, baseUrl), rating: Number(( $(".rating strong").first().text().match(/[0-9.]+/) || [0])[0]) || 0, genres, status: readInfo("status"), aired: readInfo("rilis"), type: readInfo("jenis") || "Unknown", episode: readInfo("episode") || "Unknown", duration: readInfo("durasi") || "Unknown", studio: readInfo("studio") || "Unknown", season: readInfo("musim") || "Unknown", trailer: $(".trailer iframe").attr("src") || "", updateAt: info.find("time[itemprop=dateModified]").attr("datetime") || "", episodes, batches: [] };
}

async function fetchAnimeDetail(slug) {
  const { result, source } = await sourceRequestFor("animasu", `/anime/${encodeURIComponent(slug)}/`, { headers: SOURCE_HEADERS, timeout: REQUEST_TIMEOUT_MS, validateStatus: (status) => status >= 200 && status < 300 });
  const detail = parseAnimeDetail(result.data, slug, source.baseUrl);
  if (!detail.title) throw new Error("Animasu detail tidak berisi judul anime.");
  detail.image = absoluteUrl(detail.image, source.baseUrl);
  detail.sourceProvider = "animasu";
  detail.sourceUrl = new URL(`/anime/${encodeURIComponent(slug)}/`, source.baseUrl).toString();
  return detail;
}

async function fetchCatalogPage({ search = "", genre = "", page = 1, signal }) {
  const paths = search ? [`/page/${page}/`, "/pencarian/"] : ["/pencarian/"];
  let lastError;
  let reachable = false;
  for (const pathname of paths) {
    try {
      const { result, baseUrl } = await sourceRequest(pathname, { params: { s: search, halaman: page, urutan: "update", "genre[]": genre ? [genre] : [] }, headers: SOURCE_HEADERS, timeout: REQUEST_TIMEOUT_MS, signal, validateStatus: (status) => status >= 200 && status < 300 });
      reachable = true;
      const diagnostics = parseAnimeCardsWithDiagnostics(result.data);
      if (diagnostics.data.length) return { data: diagnostics.data, hasNext: hasNextPage(result.data), diagnostics, source: baseUrl };
      lastError = new Error("Source katalog mengembalikan halaman kosong.");
    } catch (error) {
      lastError = error;
      if (error.sourceBlocked) break;
    }
  }
  if (reachable) return { data: [], hasNext: false, diagnostics: { rawCount: 0, data: [], missingSlug: [] }, source: ANIMASU_BASE_URL };
  markSourceFailure(lastError);
  throw lastError || new Error("Animasu tidak dapat diakses.");
}

function decodeMirror(value) {
  if (!value) return "";
  let raw = String(value).trim();
  try { raw = decodeURIComponent(raw); } catch (_) { /* value was not URI encoded */ }
  if (/^(https?:)?\/\//i.test(raw)) return absoluteUrl(raw);
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const $ = cheerio.load(decoded);
    return absoluteUrl($("iframe").attr("src") || $("source").attr("src") || $("video").attr("src") || "");
  } catch { return ""; }
}

function parseMirrorOptions(html) {
  const $ = cheerio.load(html || "");
  const streams = [];
  $(".mirror option, .mirrors option, select option[data-url], [data-mirror-url], .mirror a[href], .mirrors a[href], iframe[src], video source[src], video[src]").each((_, element) => {
    const option = $(element);
    const candidates = [option.attr("data-url"), option.attr("data-mirror-url"), option.attr("href"), option.attr("value"), option.attr("src")].filter(Boolean);
    const url = candidates.map(decodeMirror).find(Boolean) || "";
    if (url) streams.push({ name: option.text().trim() || `Mirror ${streams.length + 1}`, url, source: "Animasu" });
  });
  const seen = new Set();
  return streams.filter((stream) => !seen.has(stream.url) && seen.add(stream.url));
}

async function readMirrorOptions(episodeSlug, provider = "animasu", sourceUrl = "") {
  const source = getSourceConfig(provider);
  const pathName = sourceUrl ? new URL(sourceUrl).pathname : `/${encodeURIComponent(episodeSlug)}/`;
  try {
    const { result } = await sourceRequestFor(provider, pathName, { headers: SOURCE_HEADERS, timeout: REQUEST_TIMEOUT_MS, validateStatus: (status) => status >= 200 && status < 300 });
    return { reachable: true, streams: parseMirrorOptions(result.data).map((stream) => ({ ...stream, source: source.id })) };
  } catch (error) {
    return { reachable: false, streams: [], error };
  }
}

async function yaoMirrors(episodeSlug, provider = "animasu", sourceUrl = "") {
  const direct = await readMirrorOptions(episodeSlug, provider, sourceUrl);
  // Only Animasu can use the YAOI library fallback; other providers have their own HTML.
  const libraryStreams = provider === "animasu" && !direct.streams.length ? await animasu.getStreams(episodeSlug, { noCache: true }).catch(() => []) : [];
  const collected = [...direct.streams, ...(libraryStreams || []).map((stream) => ({ name: stream.name || "Mirror", url: absoluteUrl(stream.url), source: "YAOI API" }))];
  const seen = new Set();
  return collected.filter((stream) => stream.url && !seen.has(stream.url) && seen.add(stream.url));
}

app.use(express.json());
app.use("/vendor/animejs", express.static(path.join(__dirname, "node_modules", "animejs", "dist", "bundles")));
app.use("/vendor/three", express.static(path.join(__dirname, "node_modules", "three", "build")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_, response) => response.json({ ok: true, provider: "animasu + yaoi", source: ANIMASU_BASE_URL, sources: [{ id: "animasu", baseUrl: ANIMASU_BASE_URL }, { id: "yaoi", baseUrl: "npm:yaoi" }], sourceStatus: sourceState.status, sourceId: sourceState.sourceId, sourceBaseUrl: sourceState.baseUrl, sourceLastSuccessAt: sourceState.lastSuccessAt, sourceLastError: sourceState.lastError, ...runtimeStats() }));

async function collectCatalog(search, genre, signal) {
  const found = [];
  let partial = false;
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
    if (signal?.aborted) throw new Error("Pencarian dibatalkan oleh client.");
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      if (!found.length) throw new Error(`Search timeout setelah ${SEARCH_BUDGET_MS}ms`);
      partial = true;
      break;
    }
    try {
      const result = await withTimeout(() => fetchCatalogPage({ search, genre, page, signal }), remaining, "Search");
      const pageData = (result.data || []).filter((item) => !search || matchesTitle(item, search));
      found.push(...pageData);
      if (!result.hasNext || !pageData.length) break;
    } catch (error) {
      if (!found.length) throw error;
      partial = true;
      break;
    }
  }
  return { data: uniqueBySlug(found).map(titleAliasRecord), partial, provider: "animasu" };
}

async function searchCatalog(search, genre, signal) {
  const errors = [];
  for (const source of SOURCE_CONFIGS) {
    try {
      const direct = await collectCatalog(search, genre, signal, source.id);
      if (direct.data.length || !search) return { data: direct.data, aliasUsed: "", partial: direct.partial, provider: source.id };
    } catch (error) { errors.push(error); }
  }
  const aliases = await fetchEnglishAliases(search);
  for (const alias of aliases) {
    if (signal?.aborted) throw new Error("Pencarian dibatalkan oleh client.");
    for (const source of SOURCE_CONFIGS) {
      try {
        const result = await collectCatalog(alias, genre, signal, source.id);
        if (result.data.length) return { data: result.data, aliasUsed: alias, partial: result.partial, provider: source.id };
      } catch (error) { errors.push(error); }
    }
  }
  if (errors.length && !SOURCE_CONFIGS.some((source) => source.id === "animasu")) throw errors.at(-1);
  return { data: [], aliasUsed: "", partial: false, provider: "none" };
}

app.get("/api/catalog", catalogRateLimit, async (request, response) => {
  const search = String(request.query.search || "").trim().slice(0, 100);
  const genre = String(request.query.genre || "").trim().slice(0, 80);
  const key = `catalog:${normalizeSearchText(search)}:${normalizeSearchText(genre)}`;
  if (search && normalizeSearchText(search).length < MIN_SEARCH_LENGTH) return response.json({ data: [], slides: [], total: 0, slideSize: SLIDE_SIZE, provider: "local", stale: false, notice: `Masukkan minimal ${MIN_SEARCH_LENGTH} karakter untuk mencari.` });
  const abortController = new AbortController();
  request.on("close", () => { if (!response.writableEnded) abortController.abort(); });
  try {
    const result = await cached(key, () => searchCatalog(search, genre, abortController.signal));
    const data = result.data || [];
    if (data.length) return response.json({ data, slides: slices(data), total: data.length, slideSize: SLIDE_SIZE, provider: result.provider || "yaoi", aliasUsed: result.aliasUsed || "", partial: Boolean(result.partial), stale: false });
    response.json({ data: [], slides: [], total: 0, slideSize: SLIDE_SIZE, provider: result.provider || "none", aliasUsed: "", stale: false, notice: "Source merespons tetapi tidak menemukan judul yang cocok." });
  } catch (error) {
    if (abortController.signal.aborted) return;
    response.status(503).json({ data: [], slides: [], total: 0, error: `Source live tidak tersedia: ${error.message}` });
  }
});

app.get("/api/daily", async (_, response) => {
  try {
    const key = `daily:${todayKey()}`;
    const result = await cached(key, dailyWithSources, DAILY_CACHE_MS, true);
    const data = result?.data || [];
    if (data.length) return response.json({ data, slides: slices(data), total: data.length, slideSize: SLIDE_SIZE, day: todayKey(), label: todayLabel(), provider: result.provider || "yaoi", stale: isStale(key) });
    throw new Error("Animasu tidak mengembalikan judul jadwal.");
  } catch (error) {
    const fallback = readFallbackDaily();
    if (fallback?.data?.length) return response.json({ ...fallback, day: todayKey(), label: `Source offline · data terakhir ${fallback.label || "tersedia"}`, warning: `Jadwal live sedang tidak merespons; menampilkan snapshot lokal terakhir. (${error.message})` });
    response.status(503).json({ data: [], slides: [], total: 0, day: todayKey(), label: todayLabel(), error: `Jadwal live tidak tersedia: ${error.message}` });
  }
});

app.get("/api/genres", async (_, response) => {
  try {
    const key = "genres";
    const result = await cached(key, genresWithSources, CACHE_MS, true);
    if (!result?.data?.length) throw new Error("Source live tidak mengembalikan genre.");
    response.json({ data: result.data, provider: result.provider || "yaoi", stale: isStale(key) });
  } catch (error) { response.status(503).json({ data: [], error: `Genre live tidak tersedia: ${error.message}` }); }
});

app.get("/api/anime/:slug", async (request, response) => {
  const provider = "animasu";
  try {
    const key = `detail:${provider}:${request.params.slug}`;
    const detail = await cached(key, () => fetchAnimeDetail(request.params.slug, provider), DETAIL_CACHE_MS, true);
    if (!detail?.title) throw new Error("detail tidak memiliki data yang valid");
    response.json({ data: titleAliasRecord({ ...detail, episodes: normalizeEpisodes(detail.episodes || []) }), provider: detail.sourceProvider || provider, stale: isStale(key) });
  } catch (error) {
    const fallback = fallbackDetailFromDaily(request.params.slug);
    if (fallback) return response.json({ data: fallback, provider: "local-snapshot", stale: true, warning: `Detail live tidak tersedia (${error.message}); metadata dasar dari snapshot lokal ditampilkan.` });
    response.status(502).json({ data: null, error: `Source anime tidak dapat membaca detail ini: ${error.message}` });
  }
});

app.get("/api/streams/:episodeSlug", async (request, response) => {
  const provider = "yaoi";
  try {
    const key = `streams:${provider}:${request.params.episodeSlug}`;
    const data = await cached(key, () => yaoMirrors(request.params.episodeSlug, "animasu"), STREAM_CACHE_MS, true);
    if (!data?.length) throw new Error("mirror tidak memiliki data yang valid");
    response.json({ data, total: data.length, provider, stale: isStale(key) });
  } catch (error) { response.status(502).json({ data: [], total: 0, error: `${provider} tidak dapat membaca mirror: ${error.message}` }); }
});

app.get("*", (_, response) => response.sendFile(path.join(__dirname, "public", "index.html")));
if (require.main === module) {
  const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`ILoveNime personal: http://localhost:${PORT}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} sedang dipakai proses lain. Hentikan proses lama atau jalankan dengan PORT=3100 npm start.`
      );
    } else {
      console.error(`Server gagal dijalankan: ${error.message}`);
    }

    process.exitCode = 1;
  });
}

module.exports = { app, slices, uniqueBySlug, normalizeEpisodes, todayKey, todayLabel, decodeMirror, normalizeSearchText, splitAliases, titleAliasRecord, matchesTitle, cached, isStale, readFallbackDaily, fallbackDetailFromDaily, runtimeStats, extractSlug, isBlockedSourceHtml, parseAnimeCards, parseAnimeCardsWithDiagnostics, parseGenreLinks, parseDailyCards, parseAlphabetCardsWithDiagnostics, parseAnimeDetail, parseMirrorOptions, hasNextPage, fetchCatalogPage, fetchAlphabetPage, fetchAnimeDetail };
