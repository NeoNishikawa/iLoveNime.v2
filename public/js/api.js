const cache = new Map();
let activeCatalogController = null;

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); } catch (_) { throw new Error(`Server mengembalikan respons tidak valid (HTTP ${response.status})`); }
  if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

function cachedRequest(key, path, options = {}) {
  if (!cache.has(key)) {
    const pending = request(path, options).catch((error) => {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return cache.get(key);
}

export const api = {
  health: () => request("/api/health"),
  daily: () => request("/api/daily"),
  trending: () => request("/api/trending"),
  donghua: (query = "") => request(`/api/donghua?search=${encodeURIComponent(String(query || "").trim())}`),
  genres: () => request("/api/genres"),
  cancelCatalog() { activeCatalogController?.abort(); activeCatalogController = null; },
  catalog(query, genres = [], genreMode = "or") {
    const normalizedQuery = String(query || "").trim();
    const normalizedGenres = (Array.isArray(genres) ? genres : [genres]).map((genre) => String(genre || "").trim().toLowerCase()).filter(Boolean).sort();
    const normalizedMode = genreMode === "and" ? "and" : "or";
    const key = `${normalizedQuery.toLocaleLowerCase()}|${normalizedGenres.join(",")}|${normalizedMode}`;
    if (cache.has(key)) return cache.get(key);
    activeCatalogController?.abort();
    const controller = new AbortController();
    activeCatalogController = controller;
    const params = new URLSearchParams({ search: normalizedQuery, genres: normalizedGenres.join(","), genreMode: normalizedMode });
    const pending = cachedRequest(key, `/api/catalog?${params}`, { signal: controller.signal }).finally(() => {
      if (activeCatalogController === controller) activeCatalogController = null;
    });
    cache.set(key, pending);
    return pending;
  },
  detail: (slug) => request(`/api/anime/${encodeURIComponent(slug)}`),
  mirrors: (slug) => request(`/api/streams/${encodeURIComponent(slug)}`),
};
