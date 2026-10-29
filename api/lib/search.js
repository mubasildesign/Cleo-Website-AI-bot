const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our so that the their them then there these they this to us was we what when where which who why will with would you your yours about any all also just more most some than too very get got want need tell know please hi hello hey".split(" ")
);

function stem(word) {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem);
}

function prepare(kb) {
  if (kb._index) return kb._index;
  const docs = kb.chunks.map((chunk) => {
    const page = kb.pages[chunk.p] || {};
    const tokens = tokenize(chunk.t);
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    return { chunk, page, tf, length: tokens.length || 1, title: new Set(tokenize(`${page.title} ${page.url}`)) };
  });
  const df = new Map();
  for (const doc of docs) for (const token of doc.tf.keys()) df.set(token, (df.get(token) || 0) + 1);
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1);
  kb._index = { docs, df, avg };
  return kb._index;
}

export function search(kb, query, limit = 6) {
  if (!kb?.chunks?.length) return [];
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const { docs, df, avg } = prepare(kb);
  const total = docs.length;
  const scored = [];
  for (const doc of docs) {
    let score = 0;
    for (const term of terms) {
      const idf = Math.log(1 + (total - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
      const tf = doc.tf.get(term) || 0;
      if (tf) score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (doc.length / avg))));
      if (doc.title.has(term)) score += idf * 0.6;
    }
    if (score > 0) scored.push({ score, doc });
  }
  scored.sort((a, b) => b.score - a.score);
  const perPage = new Map();
  const out = [];
  for (const { score, doc } of scored) {
    const count = perPage.get(doc.chunk.p) || 0;
    if (count >= 2) continue;
    perPage.set(doc.chunk.p, count + 1);
    out.push({ score, text: doc.chunk.t, url: doc.page.url || "", title: doc.page.title || "" });
    if (out.length >= limit) break;
  }
  return out;
}

export function notesKnowledge(text) {
  const blocks = String(text || "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  return {
    pages: [{ url: "", title: "Owner notes" }],
    chunks: blocks.map((block) => ({ p: 0, t: block.slice(0, 2000) }))
  };
}
