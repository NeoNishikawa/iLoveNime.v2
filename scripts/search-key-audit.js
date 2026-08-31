const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { matchesTitle, normalizeSearchText, uniqueBySlug } = require("../server");

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "data", "last-known-daily.json"), "utf8"));
const titles = uniqueBySlug(snapshot.data || []);
const variants = new Map();
function add(item, variant) {
  const key = String(variant || "");
  if (key.trim().length >= 2) variants.set(`${item.slug}:${normalizeSearchText(key)}`, { slug: item.slug, key });
}
for (const item of titles) {
  const title = String(item.title || "");
  const words = title.split(/\s+/).filter(Boolean);
  const punctuationFree = title.replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
  [title, title.toLowerCase(), title.toUpperCase(), `  ${title}  `, punctuationFree, title.replace(/[\s-]+/g, "-"), words[0], words.at(-1), words.slice(0, 2).join(" ")].forEach((variant) => add(item, variant));
  for (const word of words.filter((word) => /\p{L}|\p{N}/u.test(word))) add(item, word);
  if (/\p{N}/u.test(title)) add(item, title.replace(/\d+/g, (number) => String(Number(number))));
}
const checks = [...variants.values()];
let failures = 0;
for (const { slug, key } of checks) {
  const item = titles.find((candidate) => candidate.slug === slug);
  if (!matchesTitle(item, key)) failures += 1;
}
assert.equal(failures, 0);
const negative = "zzzz-anime-key-that-does-not-exist-987654321";
assert.equal(titles.some((item) => matchesTitle(item, negative)), false);
console.log(JSON.stringify({ titles: titles.length, testedKeys: checks.length, positiveFailures: failures, negativeChecks: 1, normalizedUnicode: normalizeSearchText("Magi-Lumière Season 2") }, null, 2));
