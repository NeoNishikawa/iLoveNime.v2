const state = { genre: "", search: "", detail: null, tracking: load("iln_tracking", []) };
const $ = (selector) => document.querySelector(selector);
const api = async (path) => { const response = await fetch(path); const json = await response.json(); if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`); return json; };
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save() { localStorage.setItem("iln_tracking", JSON.stringify(state.tracking)); renderTracking(); }
function safe(value) { return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]); }

async function catalog() {
  $("#feedback").textContent = "Menghubungkan source anime melalui proxy lokal...";
  $("#catalog").innerHTML = Array.from({ length: 8 }, () => '<div class="card skeleton"></div>').join("");
  try {
    const params = new URLSearchParams({ search: state.search, genre: state.genre });
    const json = await api(`/api/catalog?${params}`);
    $("#sourceStatus").textContent = "Source tersinkronisasi";
    $("#catalogCount").textContent = `${json.data.length} titles`;
    $("#feedback").textContent = json.data.length ? "" : "Tidak ada judul pada query ini. Coba kata kunci lain.";
    $("#catalog").innerHTML = json.data.map((anime, index) => `<button class="card" data-slug="${safe(anime.slug)}"><span class="poster">${anime.image ? `<img src="${safe(anime.image)}" alt="" loading="lazy">` : "NO ART"}<b>${String(index + 1).padStart(2, "0")}</b></span><span class="card-copy"><small>${safe(anime.status || "upcoming")}</small><strong>${safe(anime.title)}</strong><em>${safe(anime.type || "Series")} · ${safe(anime.episode || "Episode pending")}</em></span></button>`).join("");
    document.querySelectorAll(".card[data-slug]").forEach((card) => card.addEventListener("click", () => detail(card.dataset.slug)));
  } catch (error) { $("#sourceStatus").textContent = "Source unavailable"; $("#feedback").textContent = error.message; $("#catalog").innerHTML = ""; }
}

async function genres() {
  try {
    const json = await api("/api/genres");
    $("#genres").insertAdjacentHTML("beforeend", json.data.slice(0, 14).map((genre) => `<button data-genre="${safe(genre.slug)}">${safe(genre.name)}</button>`).join(""));
    document.querySelectorAll("#genres button").forEach((button) => button.addEventListener("click", () => { document.querySelector("#genres .selected")?.classList.remove("selected"); button.classList.add("selected"); state.genre = button.dataset.genre; catalog(); }));
  } catch (_) { /* Catalog feedback already exposes source errors. */ }
}

async function detail(slug) {
  $("#detail").classList.remove("hidden"); $("#detailBody").innerHTML = '<div class="detail-empty">Opening title structure…</div>'; location.hash = "detail";
  try {
    const json = await api(`/api/anime/${encodeURIComponent(slug)}`); state.detail = json.data;
    const tracked = state.tracking.find((item) => item.slug === slug) || { status: "planned", progress: 0 };
    $("#detailBody").innerHTML = `<div class="detail-grid"><div class="detail-art">${json.data.image ? `<img src="${safe(json.data.image)}" alt="">` : "NO ART"}<b>${json.data.rating || "—"}<small>rating</small></b></div><article><p class="eyebrow">${safe(json.data.type)} / ${safe(json.data.status)}</p><h2>${safe(json.data.title)}</h2><p class="synopsis">${safe(json.data.synopsis || "Sinopsis belum tersedia.")}</p><p class="metadata">Studio: ${safe(json.data.studio)} · ${json.data.episodes.length} episodes</p><div class="tags">${json.data.genres.map((genre) => `<span>${safe(genre.name)}</span>`).join("")}</div></article><aside class="tracker"><p class="eyebrow">Local tracking</p><select id="trackingStatus"><option value="planned">Planned</option><option value="watching">Watching</option><option value="completed">Completed</option><option value="dropped">Dropped</option></select><div class="progress"><button id="minus">−</button><strong id="progressValue">${tracked.progress}</strong><span>/ ${json.data.episodes.length || "?"}</span><button id="plus">+</button></div><button id="saveTrack" class="primary">Save locally</button></aside><div class="episodes"><div><p class="eyebrow">Episode path</p><h3>Choose a mirror lane</h3></div><div class="episode-list">${json.data.episodes.map((episode, index) => `<button data-episode="${safe(episode.slug)}"><small>${String(index + 1).padStart(2, "0")}</small>${safe(episode.title)}</button>`).join("")}</div></div></div>`;
    $("#trackingStatus").value = tracked.status;
    let progress = tracked.progress; const total = json.data.episodes.length;
    $("#minus").onclick = () => { progress = Math.max(0, progress - 1); $("#progressValue").textContent = progress; };
    $("#plus").onclick = () => { progress = Math.min(total || progress + 1, progress + 1); $("#progressValue").textContent = progress; };
    $("#saveTrack").onclick = () => { const current = { slug, title: json.data.title, image: json.data.image, total, progress, status: $("#trackingStatus").value }; state.tracking = [...state.tracking.filter((item) => item.slug !== slug), current]; save(); };
    document.querySelectorAll(".episode-list button").forEach((button) => button.onclick = () => streams(button.dataset.episode));
  } catch (error) { $("#detailBody").innerHTML = `<div class="detail-empty">${safe(error.message)}</div>`; }
}

async function streams(episodeSlug) {
  const dialog = $("#player"); dialog.showModal(); $("#playerStatus").textContent = "Mencari mirror episode…"; $("#playerFrame").src = "";
  try { const json = await api(`/api/streams/${encodeURIComponent(episodeSlug)}`); if (!json.data.length) throw new Error("Tidak ada mirror yang tersedia untuk episode ini."); $("#playerName").textContent = json.data[0].name; $("#playerFrame").src = json.data[0].url; $("#playerStatus").textContent = "Mirror dipilih. Jika tidak termuat, tutup lalu coba episode atau sumber lain."; } catch (error) { $("#playerStatus").textContent = error.message; }
}

function renderTracking() {
  const counts = ["planned", "watching", "completed", "dropped"].map((status) => `<div><b>${state.tracking.filter((item) => item.status === status).length}</b><span>${status}</span></div>`).join("");
  $("#summary").innerHTML = counts;
  $("#saved").innerHTML = state.tracking.length ? state.tracking.map((item) => `<article><span>${item.image ? `<img src="${safe(item.image)}" alt="">` : "ILN"}</span><div><small>${safe(item.status)}</small><strong>${safe(item.title)}</strong><em>Episode ${item.progress} of ${item.total || "?"}</em></div><button data-open="${safe(item.slug)}">Open</button></article>`).join("") : '<p class="empty">Belum ada judul tersimpan pada browser ini.</p>';
  document.querySelectorAll("#saved button").forEach((button) => button.onclick = () => detail(button.dataset.open));
}

$("#searchForm").onsubmit = (event) => { event.preventDefault(); state.search = $("#searchInput").value.trim(); catalog(); };
$("#closePlayer").onclick = () => { $("#playerFrame").src = ""; $("#player").close(); };
$("#clearCollection").onclick = () => { const dialog = $("#clearDialog"); if (dialog) dialog.showModal(); };
catalog(); genres(); renderTracking();
