module.exports = {
  // Ganti hanya nilai ini setiap kali domain sumber berpindah.
  ANIMASU_BASE_URL: process.env.ANIMASU_BASE_URL || "https://animasu.love",
  // Gunakan PORT=3100 npm start bila port default sedang dipakai proses lain.
  PORT: Number.isInteger(Number(process.env.PORT)) && Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3099,
  REQUEST_TIMEOUT_MS: Number(process.env.REQUEST_TIMEOUT_MS) > 0 ? Number(process.env.REQUEST_TIMEOUT_MS) : 8000,
  SEARCH_BUDGET_MS: Number(process.env.SEARCH_BUDGET_MS) > 0 ? Number(process.env.SEARCH_BUDGET_MS) : 15000,
  // Changed: keep the day-keyed /api/daily result cached for up to 24 hours, avoiding repeated daily scraping.
  DAILY_CACHE_MS: Number(process.env.DAILY_CACHE_MS) > 0 ? Number(process.env.DAILY_CACHE_MS) : 86400000,
  DETAIL_CACHE_MS: Number(process.env.DETAIL_CACHE_MS) > 0 ? Number(process.env.DETAIL_CACHE_MS) : 1800000,
  STREAM_CACHE_MS: Number(process.env.STREAM_CACHE_MS) > 0 ? Number(process.env.STREAM_CACHE_MS) : 600000,
  // Rate limiting untuk mengurangi beban source; bukan untuk melewati proteksi anti-bot.
  MAX_UPSTREAM_CONCURRENCY: Number(process.env.MAX_UPSTREAM_CONCURRENCY) > 0 ? Number(process.env.MAX_UPSTREAM_CONCURRENCY) : 1,
  UPSTREAM_MIN_INTERVAL_MS: Number(process.env.UPSTREAM_MIN_INTERVAL_MS) > 0 ? Number(process.env.UPSTREAM_MIN_INTERVAL_MS) : 1500,
  SOURCE_BLOCK_COOLDOWN_MS: Number(process.env.SOURCE_BLOCK_COOLDOWN_MS) > 0 ? Number(process.env.SOURCE_BLOCK_COOLDOWN_MS) : 60000,
};
