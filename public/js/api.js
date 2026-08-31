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
  genres: () => request("/api/genres"),
  cancelCatalog() { activeCatalogController?.abort(); activeCatalogController = null; },
  catalog(query, genre) {
    const normalizedQuery = String(query || "").trim();
    const normalizedGenre = String(genre || "").trim();
    const key = `${normalizedQuery.toLocaleLowerCase()}|${normalizedGenre.toLocaleLowerCase()}`;
    if (cache.has(key)) return cache.get(key);
    activeCatalogController?.abort();
    const controller = new AbortController();
    activeCatalogController = controller;
    const params = new URLSearchParams({ search: normalizedQuery, genre: normalizedGenre });
    const pending = cachedRequest(key, `/api/catalog?${params}`, { signal: controller.signal }).finally(() => {
      if (activeCatalogController === controller) activeCatalogController = null;
    });
    cache.set(key, pending);
    return pending;
  },
  detail: (slug) => request(`/api/anime/${encodeURIComponent(slug)}`),
  mirrors: (slug) => request(`/api/streams/${encodeURIComponent(slug)}`),
};
