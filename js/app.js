// 旅行業務取扱管理者試験 学習・模擬試験サイト(1人用・ログイン不要・データは端末の localStorage)
"use strict";

const GENRES = { domestic: "国内", overseas: "海外", law: "法令" };
const GENRE_KEYS = Object.keys(GENRES);
const GENRE_COLOR = { domestic: "#3987e5", overseas: "#d95926", law: "#199e70" };
const GENRE_SHAPE = { domestic: "circle", overseas: "square", law: "triangle" };
const MODES = { exam: "模擬試験", practice: "練習", weak: "弱点復習" };
const STORE_KEY = "travelExam.v1";

// ---------- 保存データ ----------
const defaultState = () => ({
  attempts: [],          // 受験の記録
  qstats: {},            // 問題ごとの成績 {id: {seen, wrong, last: true/false, lastChosen}}
  genreLevel: { domestic: 3, overseas: 3, law: 3 }, // ジャンル別の今のレベル(成績で上下)
  custom: [],            // 取り込んだ問題
  settings: { count: 10, genre: "mix", level: 3, examDate: "" },
});
let S = load();
function load() {
  try { return Object.assign(defaultState(), JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); }
  catch (e) { return defaultState(); }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

let BUILTIN = [];      // data/ の問題
let session = null;    // 解いている途中の回

// ---------- 小道具 ----------
const $ = sel => document.querySelector(sel);
const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (c, t) => t ? Math.round(c / t * 100) : 0;
const chip = g => `<span class="chip ${g}">${GENRES[g] || g}</span>`;
const genreLabel = g => g === "mix" ? "ミックス" : GENRES[g];
const pad = n => String(n).padStart(2, "0");
const fmtDate = iso => { const d = new Date(iso); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2200); }
let QCACHE = null; // 問題の一覧と索引(問題が増減したら resetQ() で作り直す)
function resetQ() { QCACHE = null; }
function qindex() {
  if (!QCACHE) {
    const m = new Map();
    for (const q of BUILTIN) m.set(q.id, q);
    for (const q of S.custom) { const v = normalizeQ(q); if (v.ok) m.set(v.q.id, v.q); } // 同じIDは取り込んだ方を優先
    QCACHE = { map: m, list: [...m.values()] };
  }
  return QCACHE;
}
const allQuestions = () => qindex().list;
const qById = id => qindex().map.get(id);
// 正解・解答はどちらも番号の配列で扱う(1つ選ぶ問題も [2] のように)
const toArr = x => x == null ? null : Array.isArray(x) ? x : [x];
const sameSet = (a, b) => !!a && a.length === b.length && a.every(x => b.includes(x));
const isPast = q => q.origin === "past";
// 過去問は元の記号(総合 a〜d、地域限定 ア〜エ)、サンプルは 1〜4
const labelOf = (q, ci, k) => isPast(q) ? (q.exam === "地域限定" ? "アイウエオ" : "abcde")[ci] : String(k + 1);
// 過去問は記号だけ(選択肢が長いため。本文は選択肢の一覧で見る)
const ansText = (q, arr) => arr == null || !arr.length ? "未解答" : isPast(q) ? arr.map(i => labelOf(q, i)).join("・") : arr.map(i => q.choices[i]).join(" / ");
const ORIGINS = { all: "すべて", past: "過去問", sample: "オリジナル" };
const originOk = (q, o) => !o || o === "all" || (o === "past" ? isPast(q) : !isPast(q));
// 写真・図が要る問題は問題用紙の該当部分の画像を、資料編が要る問題は資料編PDFへの案内を出す
const figHtml = q => (q.image ? `<figure class="qfig"><img src="${h(q.image)}" alt="問題の図・写真(問題用紙より)" loading="lazy"><figcaption>問題用紙の該当部分(図・写真を含む)</figcaption></figure>` : "")
  + (/^https:\/\//.test(q.docUrl || "") ? `<div class="multi-note">📎 この問題は<b>資料編</b>(運賃表・時刻表など)を見て解きます: <a href="${h(q.docUrl)}" target="_blank" rel="noopener">資料編PDFを開く</a></div>` : "");
function srcHtml(q) {
  const links = [["問題PDF", q.sourceUrl], ["正解PDF", q.answerUrl], ["掲載ページ", q.pageUrl]].filter(x => /^https:\/\//.test(x[1] || ""));
  return `<div class="src">出典: ${h(q.source)}${links.length ? "<br>" + links.map(([t, u]) => `<a href="${h(u)}" target="_blank" rel="noopener">${t}</a>`).join(" ・ ") : ""}${isPast(q) ? `<br>レベルは推定(形式・計算の有無・文章量から自動で決めた目安)` : ""}</div>`;
}

// ---------- 見て覚える(解説の下に地図・写真・図表・動画の案内。data/visual/。tools/build_visuals.py で作る) ----------
// 問題文と選択肢に出てくる地名・観光地・空港を辞書と照らし、自作の位置図(Natural Earth)・Wikimedia Commons の写真(作者・ライセンス付き)・
// YouTube の検索リンクを出す。法令・約款・コードなどは自作の図表を出す。データは解説を開いたときに初めて読む
let VIS = null, visLoading = null;
const KANA = /[ァ-ヺー]/, reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function loadVis() {
  return visLoading ||= Promise.all(["visuals", "geo"].map(f => fetch(`data/visual/${f}.json`).then(r => r.json()))).then(([v, g]) => {
    const box = d => { const n = d.match(/-?[\d.]+/g), b = [1e9, 1e9, -1e9, -1e9]; // 形の外枠(見える範囲の形だけ描くため)
      for (let i = 0; i < n.length; i += 2) { const x = +n[i], y = +n[i + 1]; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
      return b; };
    const shapes = o => Object.entries(o).filter(([, x]) => x.d).map(([k, x]) => ({ k, d: x.d, b: box(x.d) }));
    // カタカナの地名は前後がカタカナでないときだけ当てる(パース⇔パースペクティブ など)
    for (const p of v.places) p.re = new RegExp(p.a.map(k => (KANA.test(k[0]) ? "(?<![ァ-ヺー])" : "") + reEsc(k) + (KANA.test(k.at(-1)) ? "(?![ァ-ヺー])" : "")).join("|"), "g");
    VIS = { places: v.places, figs: v.figs, world: shapes(g.world), jp: shapes(g.jp) };
  }).catch(() => { visLoading = null; });
}
// 当てはまる地名(正解の選択肢 > ほかの選択肢 > 問題文の順)と図表
function visMatch(q) {
  const segs = [[q.question, 1], ...q.choices.map((c, i) => [c, q.ans.includes(i) ? 3 : 2])], hits = [];
  segs.forEach(([t, w], si) => {
    for (const p of VIS.places) {
      let s = t; for (const ng of p.ng || []) s = s.split(ng).join("　".repeat(ng.length));
      for (const m of s.matchAll(p.re)) hits.push({ p, si, w, s: m.index, e: m.index + m[0].length });
    }
  });
  // 長い名前の一部として当たったもの(ケルン ⊂ ケルン大聖堂)は除く
  const live = hits.filter(x => !hits.some(y => y !== x && y.si === x.si && y.s <= x.s && y.e >= x.e && y.e - y.s > x.e - x.s));
  const best = new Map();
  for (const x of live) { const o = best.get(x.p); if (!o || x.w > o.w || (x.w === o.w && x.si * 1e4 + x.s < o.si * 1e4 + o.s)) best.set(x.p, x); }
  const places = [...best.values()].sort((a, b) => b.w - a.w || a.si - b.si || a.s - b.s).map(x => x.p);
  const all = segs.map(x => x[0]).join("\n");
  const figs = VIS.figs.filter(f => (f.keys || []).some(k => all.includes(k)) || (f.members || []).filter(k => new RegExp(`(?<![A-Za-z])${reEsc(k)}(?![A-Za-z])`).test(all)).length >= 2);
  return { places, figs };
}
// 位置図: x=経度×10, y=−緯度×10(geo.json と同じ)。緯度に合わせて横を縮め、形がつぶれないようにする
function mapSvg(p, wide) {
  const jp = /^JP-/.test(p.r || ""), span = (jp ? 70 : 260) * (wide ? 3.2 : 1);
  const W = span, H = W * Math.cos(p.lat * Math.PI / 180) * 0.625, cx = p.lon * 10, cy = -p.lat * 10, x0 = cx - W / 2, y0 = cy - H / 2;
  const vis = s => s.b[2] >= x0 && s.b[0] <= x0 + W && s.b[3] >= y0 && s.b[1] <= y0 + H;
  const path = (list, cls) => list.filter(vis).map(s => `<path d="${s.d}" class="${s.k === p.r ? "hl" : cls}" vector-effect="non-scaling-stroke"/>`).join("");
  return `<svg viewBox="${x0} ${y0} ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${h(p.n)}の位置(${h(p.rn || "")})">
    <rect x="${x0}" y="${y0}" width="${W}" height="${H}" class="sea"/>${path(VIS.world, "land")}${jp ? path(VIS.jp, "pref") : ""}
    <ellipse cx="${cx}" cy="${cy}" rx="${W * .04}" ry="${H * .064}" class="dot" vector-effect="non-scaling-stroke"/></svg>`; // 点は地図の幅の約4%
}
const ytLink = s => `<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(s)}" target="_blank" rel="noopener">▶ YouTubeで探す</a>`;
function placeCard(p, i) {
  // 地図と写真は横に並べる(スマホで1件が長くならないように)
  return `<div class="vcard"><div class="vtitle">📍 <b>${h(p.n)}</b> <span class="sub">${h(p.rn || "")}・${h(p.k)}</span></div>
    <div class="vpair">${p.lat != null ? `<button class="vmap" data-i="${VIS.places.indexOf(p)}" aria-label="地図の広さを切り替える">${mapSvg(p, false)}<span class="vzoom">広く</span></button>` : ""}
    ${p.img ? `<a class="vphoto" href="${h(p.img.u)}" target="_blank" rel="noopener"><img src="${h(p.img.u)}" alt="${h(p.n)}の写真" loading="lazy"></a>` : ""}</div>
    ${p.img ? `<div class="vcap">写真: ${h(p.img.by || "作者不明")} / ${h(p.img.lic)}(<a href="${h(p.img.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>)</div>` : ""}
    <div class="vlinks"><a href="https://ja.wikipedia.org/wiki/${encodeURIComponent(p.w)}" target="_blank" rel="noopener">Wikipediaで読む</a>${p.yt ? "" : ytLink(`${p.n} ${p.k === "空港" ? "空港" : p.k === "祭" ? "" : "観光"}`.trim())}</div>
    ${p.yt ? `<a class="vyt" href="https://www.youtube.com/watch?v=${h(p.yt.id)}" target="_blank" rel="noopener"><span class="vplay">▶</span><span><b>${p.yt.own ? "参考動画(個人の旅行チャンネル)" : "おすすめ動画"}</b> ${h(p.yt.t)}<br><span class="sub">${h(p.yt.ch)}</span></span></a>` : ""}</div>`;
}
function visBody(q) {
  const { places, figs } = visMatch(q);
  if (!places.length && !figs.length) return "";
  const MAX = 4;
  return `<div class="vhead">👀 見て覚える</div>
    ${figs.map(f => `<div class="vcard"><div class="vtitle">📊 <b>${h(f.t)}</b></div><div class="vfigbox">${f.h}</div>
      <div class="vlinks">${ytLink(f.yt)}</div><div class="src">${h(f.src)}</div></div>`).join("")}
    ${places.slice(0, MAX).map(placeCard).join("")}
    ${places.length > MAX ? `<details class="vmore"><summary>ほかの地名も見る(${places.slice(MAX).map(p => h(p.n)).join("・")})</summary>${places.slice(MAX).map(placeCard).join("")}</details>` : ""}
    <div class="src">地図: Natural Earth(パブリックドメイン)をもとに自作 / 写真: Wikimedia Commons(作者・ライセンスは各写真の下) / 図表: 自作 / 動画: 自治体・観光局・世界遺産検定などの公式動画、無いものは旅行会社・個人の旅行チャンネルの動画(内容は各チャンネルのもの)</div>`;
}
const visHtml = q => `<div class="vis" data-q="${h(q.id)}"></div>`;
// 見えている(閉じた details の中でない)「見て覚える」欄だけを埋める
async function fillVis(root = document) {
  const els = [...root.querySelectorAll(".vis:not([data-done])")].filter(el => !el.parentElement.closest("details:not([open])"));
  if (!els.length) return;
  if (!VIS) await loadVis();
  if (!VIS) return;
  for (const el of els) { const q = qById(el.dataset.q); el.dataset.done = "1"; if (q) el.innerHTML = visBody(q); if (!el.innerHTML) el.hidden = true; }
}
document.addEventListener("toggle", e => { if (e.target.open) fillVis(e.target); }, true);
document.addEventListener("click", e => {
  const b = e.target.closest(".vmap"); if (!b || !VIS) return;
  const wide = b.classList.toggle("wide"), p = VIS.places[+b.dataset.i];
  b.innerHTML = mapSvg(p, wide) + `<span class="vzoom">${wide ? "近く" : "広く"}</span>`;
});

// ---------- 問題の読み込み ----------
async function loadBuiltin() {
  try {
    const sets = await (await fetch("data/sets.json", { cache: "no-cache" })).json();
    const out = [];
    for (const f of sets.files.concat(sets.optional || [])) {
      try { // optional のファイルは無くてもよい(公開用では過去問を置かないことがある)
        const r = await fetch("data/" + f, { cache: "no-cache" }); if (!r.ok) continue;
        const d = await r.json();
        for (const q of (d.questions || d)) { const v = normalizeQ(q); if (v.ok) out.push(v.q); }
      } catch (e) { console.warn("問題ファイルを読めませんでした", f, e); }
    }
    BUILTIN = out; resetQ();
    LOCKED = [];
    for (const f of sets.locked || []) {
      try { const r = await fetch("data/" + f, { cache: "no-cache" }); if (r.ok) LOCKED.push(await r.json()); }
      catch (e) { console.warn("鍵付きの問題ファイルを読めませんでした", f, e); }
    }
    const pass = localStorage.getItem(PASS_KEY);
    if (LOCKED.length && pass) await unlockData(pass).catch(() => localStorage.removeItem(PASS_KEY));
  } catch (e) {
    BUILTIN = [];
    console.warn("問題データを読めませんでした", e);
  }
}

// 鍵付きの問題(合言葉で暗号化した過去問。tools/lock-data.mjs で作る)を開く。開けたら合言葉をこの端末に覚える
const PASS_KEY = "travelExam.pass";
let LOCKED = [], UNLOCKED = false;
async function unlockData(pass) {
  const C = crypto.subtle, un = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const add = [];
  for (const L of LOCKED) {
    const base = await C.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    const key = await C.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: un(L.salt), iterations: L.iter }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const d = JSON.parse(new TextDecoder().decode(await C.decrypt({ name: "AES-GCM", iv: un(L.iv) }, key, un(L.ct)))); // 合言葉が違うとここで失敗する
    for (const q of (d.questions || d)) { const v = normalizeQ(q); if (v.ok) add.push(v.q); }
  }
  BUILTIN = BUILTIN.concat(add); resetQ(); UNLOCKED = true;
  localStorage.setItem(PASS_KEY, pass);
  return add.length;
}

// 取り込み用: 1問の形をそろえる(ジャンルは 国内/海外/法令 でも domestic/overseas/law でも可)
function normalizeQ(q) {
  const gmap = { "国内": "domestic", "海外": "overseas", "法令": "law", "約款": "law", domestic: "domestic", overseas: "overseas", law: "law" };
  const genre = gmap[String(q.genre || "").trim()];
  const choices = (q.choices || []).map(s => String(s).trim()).filter(Boolean);
  const level = Math.min(10, Math.max(1, parseInt(q.level, 10) || 5));
  const ans = [...new Set(toArr(q.answer ?? []).map(n => parseInt(n, 10)))].sort((a, b) => a - b);
  if (!genre) return { ok: false, why: "ジャンルが不明" };
  if (!q.question) return { ok: false, why: "問題文がない" };
  if (choices.length < 2) return { ok: false, why: "選択肢が2つ未満" };
  if (!ans.length || ans.some(a => !(a >= 0 && a < choices.length))) return { ok: false, why: "正解の番号が範囲外" };
  const str = k => q[k] ? String(q[k]) : "";
  return { ok: true, q: { id: String(q.id || ("C" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))), genre, level,
    topic: String(q.topic || ""), question: String(q.question), choices, answer: ans.length === 1 ? ans[0] : ans, ans,
    multi: !!q.multi || ans.length > 1, explanation: String(q.explanation || ""), source: String(q.source || "出典未記入"),
    sourceUrl: str("sourceUrl"), answerUrl: str("answerUrl"), pageUrl: str("pageUrl"), docUrl: str("docUrl"),
    image: /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$|^[\w\/.-]+\.(png|jpe?g)$/.test(str("image")) ? str("image") : "", year: parseInt(q.year, 10) || null,
    exam: str("exam"), origin: str("origin") || "sample" } };
}

// CSV: id,genre,level,topic,question,choice1..choice4,answer(1始まり。複数は 1;3),explanation,source(,sourceUrl,year,exam,origin)
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(s => s.trim());
  return rows.filter(r => r.some(x => x.trim())).map(r => {
    const o = {}; head.forEach((k, i) => o[k] = (r[i] || "").trim());
    const choices = head.filter(k => /^choice\d+$/.test(k)).map(k => o[k]).filter(Boolean);
    const answer = String(o.answer || "").split(/[;；・/ ]+/).filter(Boolean).map(n => (parseInt(n, 10) || 0) - 1);
    return { id: o.id, genre: o.genre, level: o.level, topic: o.topic, question: o.question, choices, answer, explanation: o.explanation, source: o.source,
      sourceUrl: o.sourceUrl, year: o.year, exam: o.exam, origin: o.origin || "import" };
  });
}

// ---------- 出題 ----------
function stat(id) { return S.qstats[id] || { seen: 0, wrong: 0 }; }
function genreAccuracy() {
  const r = {}; for (const g of GENRE_KEYS) r[g] = { c: 0, t: 0 };
  for (const a of S.attempts) for (const g of GENRE_KEYS) if (a.perGenre[g]) { r[g].c += a.perGenre[g].c; r[g].t += a.perGenre[g].t; }
  return r;
}
// レベルに近い問題から選ぶ(足りなければ範囲を広げる)
function pickByLevel(pool, level, n) {
  const out = [];
  for (let r = 0; r <= 9 && out.length < n; r++) {
    const ring = shuffle(pool.filter(q => Math.abs(q.level - level) === r && !out.includes(q)));
    out.push(...ring.slice(0, n - out.length));
  }
  return out;
}
function pickQuestions(mode, genre, level, n, origin) {
  const all = allQuestions().filter(q => originOk(q, origin));
  if (mode === "weak") return pickWeak(all, genre, n);
  if (genre !== "mix") return shuffle(pickByLevel(all.filter(q => q.genre === genre), level, n));
  // ミックス: 3ジャンルをなるべく均等に
  const per = {}; GENRE_KEYS.forEach((g, i) => per[g] = Math.floor(n / 3) + (i < n % 3 ? 1 : 0));
  let out = [];
  for (const g of GENRE_KEYS) out.push(...pickByLevel(all.filter(q => q.genre === g), level, per[g]));
  if (out.length < n) out.push(...pickByLevel(all.filter(q => !out.includes(q)), level, n - out.length));
  return shuffle(out);
}
// 弱点復習: 正答率の低いジャンルほど多く、前回間違えた問題・未出題を優先。レベルはジャンルの今のレベル付近
function pickWeak(all, genre, n) {
  const acc = genreAccuracy();
  const gw = {}; for (const g of GENRE_KEYS) gw[g] = acc[g].t ? (1 - acc[g].c / acc[g].t) + 0.15 : 0.6;
  const pool = all.filter(q => genre === "mix" || q.genre === genre).map(q => {
    const s = stat(q.id);
    const qw = s.last === false ? 5 : s.wrong > 0 ? 2.5 : s.seen ? 0.7 : 1.5;
    const lw = 1 / (1 + Math.abs(q.level - S.genreLevel[q.genre]));
    return { q, w: gw[q.genre] * qw * lw };
  });
  const out = [];
  while (out.length < n && pool.length) {
    const sum = pool.reduce((s, x) => s + x.w, 0); let r = Math.random() * sum, i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0].q);
  }
  return out;
}

// ---------- 画面の切り替え ----------
const routes = {};
function go(path) { location.hash = "#" + path; }
function render() {
  const [path, qs] = location.hash.slice(1).split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  const name = parts[0] || "home";
  const params = new URLSearchParams(qs || "");
  const fn = routes[name] || routes.home;
  document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.r === name));
  const inQuiz = name === "quiz" || name === "setup"; // 下に操作ボタンがある画面はタブを隠す
  $("#tabs").hidden = inQuiz;
  $("#back").hidden = name === "home";
  window.scrollTo(0, 0);
  fn(parts.slice(1), params);
}
function page(title, html) { $("#title").textContent = title; $("#app").innerHTML = html; fillVis(); }
$("#back").onclick = () => { if (location.hash.startsWith("#/quiz") && session && !confirmLeave()) return; history.length > 1 ? history.back() : go("/"); };
function confirmLeave() { return window.confirm("途中の解答は保存されません。やめますか?"); }

// ---------- ホーム(一覧ページ) ----------
routes.home = () => {
  const last = S.attempts[S.attempts.length - 1];
  const nQ = allQuestions().length;
  let days = "";
  if (S.settings.examDate) {
    const d = Math.ceil((new Date(S.settings.examDate + "T00:00") - new Date()) / 864e5);
    days = d >= 0 ? `<div class="card"><b>試験まであと ${d} 日</b> <span class="sub">(${h(S.settings.examDate)})</span></div>` : "";
  }
  const lock = LOCKED.length && !UNLOCKED ? `<div class="card"><b>🔒 本人用の過去問(合言葉で開く)</b>
      <div class="sub">総合・国内試験の過去問は合言葉で鍵をかけています。一度入れると、この端末では次から自動で開きます。</div>
      <div class="row" style="margin-top:8px"><input type="password" id="pass" placeholder="合言葉" autocomplete="current-password" style="flex:1"><button id="unlock" class="btn-primary">開く</button></div><div id="unlockMsg" class="sub"></div></div>` : "";
  page("旅管 学習・模擬試験", `
    ${days}${lock}
    <div class="grid">
      <a class="tile main" href="#/setup?mode=exam"><span class="ic">📝</span>模擬試験を受ける<span class="sub">全部答えてから採点・解説</span></a>
      <a class="tile" href="#/setup?mode=practice"><span class="ic">✏️</span>練習<span class="sub">1問ずつ答え合わせ</span></a>
      <a class="tile" href="#/setup?mode=weak"><span class="ic">🎯</span>弱点復習<span class="sub">苦手と間違いを中心に</span></a>
      <a class="tile" href="#/study"><span class="ic">📖</span>勉強(解説を読む)<span class="sub">問題と解説の一覧</span></a>
      <a class="tile" href="#/history"><span class="ic">📅</span>受験履歴<span class="sub">一覧とカレンダー</span></a>
      <a class="tile" href="#/analysis"><span class="ic">🔍</span>間違い・弱点<span class="sub">ジャンル別の正答率</span></a>
      <a class="tile" href="#/charts"><span class="ic">📈</span>成長グラフ<span class="sub">レベルと正答率の推移</span></a>
      <a class="tile" href="#/data"><span class="ic">➕</span>問題の追加・設定<span class="sub">JSON/CSV取り込み・バックアップ</span></a>
      <a class="tile" href="#/about"><span class="ic">ℹ️</span>出典・試験の構成<span class="sub">使い方</span></a>
    </div>
    <h2>今のレベル(ジャンル別)</h2>
    <div class="card">
      ${GENRE_KEYS.map(g => `<div class="row" style="align-items:center;margin:4px 0"><div style="flex:0 0 70px">${chip(g)}</div>
        <div style="flex:1" class="bar"><i style="width:${S.genreLevel[g] * 10}%;background:${GENRE_COLOR[g]}"></i></div>
        <div style="flex:0 0 64px;text-align:right"><b>Lv ${S.genreLevel[g]}</b></div></div>`).join("")}
      <div class="sub">レベル1=やさしい → レベル10=むずかしい。1回に3問以上出たジャンルは、正答率80%以上で+1、50%未満で−1。</div>
    </div>
    <div class="card sub">${last ? `前回: ${fmtDate(last.date)} ${MODES[last.mode]}(${genreLabel(last.genre)}) <b>${pct(last.correct, last.total)}点</b>` : "まだ受験記録はありません。まずは模擬試験か練習から。"}<br>収録問題数: ${nQ} 問(うち過去問 ${allQuestions().filter(isPast).length} 問・取り込み ${S.custom.length} 問)<br>過去問の出典は各問題の下と「<a href="#/about">出典・試験の構成</a>」に表示。過去問の著作権は各実施団体にあり、学習目的以外の複製・再配布はできません。</div>`);
  const ub = $("#unlock");
  if (ub) ub.onclick = async () => {
    $("#unlockMsg").textContent = "確認中…";
    try { const n = await unlockData($("#pass").value); toast(`${n} 問を開きました`); routes.home(); }
    catch (e) { $("#unlockMsg").textContent = "合言葉が違います"; }
  };
};

// ---------- 出題設定 ----------
routes.setup = (_, p) => {
  const mode = MODES[p.get("mode")] ? p.get("mode") : "exam";
  const st = S.settings;
  let genre = st.genre, level = st.level, count = st.count, origin = st.origin || "all";
  const nPast = allQuestions().filter(isPast).length;
  const draw = () => {
    page(MODES[mode] + "の設定", `
      ${mode === "weak" ? `<div class="card sub">弱点復習は、正答率の低いジャンル・前回間違えた問題・まだ解いていない問題を多めに出します。レベルは各ジャンルの「今のレベル」付近から選びます。</div>` : ""}
      <h2>ジャンル</h2>
      <div class="seg" id="genre">${["domestic", "overseas", "law", "mix"].map(g => `<button data-g="${g}" aria-pressed="${g === genre}">${g === "law" ? "法令(業法・約款)" : genreLabel(g)}</button>`).join("")}</div>
      ${mode !== "weak" ? `
      <h2>難易度レベル</h2>
      <div class="card">
        <div class="lvl-big">レベル <span id="lv">${level}</span></div>
        <input type="range" id="level" min="1" max="10" step="1" value="${level}" aria-label="レベル">
        <div class="lvl-scale"><span>1 = やさしい</span><span>10 = むずかしい</span></div>
        <div class="row" style="margin-top:8px">${GENRE_KEYS.map(g => `<button class="useLv" data-g="${g}" style="min-height:40px;padding:6px">${GENRES[g]}の今のLv ${S.genreLevel[g]}</button>`).join("")}</div>
      </div>` : ""}
      ${nPast ? `<h2>出題元</h2>
      <div class="seg" id="origin" style="grid-template-columns:repeat(3,1fr)">${Object.entries(ORIGINS).map(([k, v]) => `<button data-o="${k}" aria-pressed="${k === origin}">${v}</button>`).join("")}</div>
      <p class="sub">過去問 ${nPast} 問(公式の問題・正解)。オリジナルはこのサイトで作ったサンプル問題。</p>` : ""}
      <h2>問題数</h2>
      <div class="seg n4" id="count">${[5, 10, 20, 30].map(n => `<button data-n="${n}" aria-pressed="${n === count}">${n}問</button>`).join("")}</div>
      <p class="sub">本番は科目ごとに60%以上で合格(目安)。模擬試験は最後にまとめて採点します。</p>
      <div style="height:70px"></div>
      <div class="dock"><button class="btn-primary" id="start">はじめる</button></div>`);
    $("#genre").onclick = e => { const b = e.target.closest("button"); if (b) { genre = b.dataset.g; draw(); } };
    $("#count").onclick = e => { const b = e.target.closest("button"); if (b) { count = +b.dataset.n; draw(); } };
    const og = $("#origin"); if (og) og.onclick = e => { const b = e.target.closest("button"); if (b) { origin = b.dataset.o; draw(); } };
    const lv = $("#level");
    if (lv) lv.oninput = () => { level = +lv.value; $("#lv").textContent = level; };
    document.querySelectorAll(".useLv").forEach(b => b.onclick = () => { level = S.genreLevel[b.dataset.g]; genre = b.dataset.g; draw(); });
    $("#start").onclick = () => {
      S.settings = Object.assign(S.settings, { genre, level, count, origin }); save();
      const qs = pickQuestions(mode, genre, level, count, nPast ? origin : "all");
      if (!qs.length) { toast("出せる問題がありません。問題を追加してください。"); return; }
      session = { mode, genre, level: mode === "weak" ? null : level, started: Date.now(), idx: 0,
        // 過去問は選択肢の順番を変えない(本文が a.〜d. を指すことがあるため)
        items: qs.map(q => ({ id: q.id, order: isPast(q) ? q.choices.map((_, i) => i) : shuffle(q.choices.map((_, i) => i)), chosen: null, checked: false })) };
      go("/quiz");
    };
  };
  draw();
};

// ---------- 解答 ----------
routes.quiz = () => {
  if (!session) return go("/");
  const s = session, it = s.items[s.idx], q = qById(it.id);
  const instant = s.mode !== "exam";
  const answered = s.items.filter(x => x.chosen !== null).length;
  const showResult = instant && it.checked;
  const ch = toArr(it.chosen) || [];
  const ok = sameSet(ch, q.ans);
  const choiceHtml = it.order.map((ci, k) => {
    let cls = "";
    if (showResult) cls = q.ans.includes(ci) ? "right" : (ch.includes(ci) ? "wrong" : "");
    else if (ch.includes(ci)) cls = "sel";
    return `<button class="choice ${cls}" data-ci="${ci}" ${showResult ? "disabled style='opacity:1'" : ""}><span class="no${q.multi ? " sq" : ""}">${labelOf(q, ci, k)}</span><span>${h(q.choices[ci])}</span></button>`;
  }).join("");
  page(`${MODES[s.mode]} ${s.idx + 1} / ${s.items.length}`, `
    <div class="progress"><i style="width:${(s.mode === "exam" ? answered : s.items.filter(x => x.checked).length) / s.items.length * 100}%"></i></div>
    <div class="card">
      <div class="qhead">${chip(q.genre)}<span class="chip">Lv ${q.level}</span>${q.topic ? `<span class="chip">${h(q.topic)}</span>` : ""}</div>
      <div class="qtext">${h(q.question)}</div>${figHtml(q)}
      ${q.multi ? `<div class="multi-note">☑ 当てはまるものを<b>すべて</b>選ぶ問題(全部合って正解)</div>` : ""}
      <div class="choices" id="choices">${choiceHtml}</div>
      ${showResult ? `<div class="expl"><b class="${ok ? "ok" : "bad"}">${ok ? "◯ 正解" : "✕ 不正解"}</b> 正解: ${h(ansText(q, q.ans))}${ok ? "" : `<br>あなたの答え: ${h(ansText(q, ch))}`}<br>${h(q.explanation)}${visHtml(q)}</div>` : ""}
      ${srcHtml(q)}
    </div>
    ${s.mode === "exam" ? `<div class="sub">解答済み ${answered} / ${s.items.length}。前後に移動して見直せます。</div>` : ""}
    <div style="height:70px"></div>
    <div class="dock">
      <button id="prev" ${s.idx === 0 ? "disabled" : ""}>‹ 前へ</button>
      ${quizMainButton(s, it)}
    </div>`);
  $("#choices").onclick = e => {
    const b = e.target.closest(".choice"); if (!b || showResult) return;
    const ci = +b.dataset.ci;
    if (q.multi) { // すべて選ぶ問題: 押すたびに付け外し。練習では「答え合わせ」で確定
      const cur = toArr(it.chosen) || [];
      const nx = cur.includes(ci) ? cur.filter(x => x !== ci) : cur.concat(ci).sort((a, b) => a - b);
      it.chosen = nx.length ? nx : null;
    } else {
      it.chosen = [ci];
      if (instant) it.checked = true;
    }
    routes.quiz();
  };
  const ck = $("#check"); if (ck) ck.onclick = () => { it.checked = true; routes.quiz(); };
  $("#prev").onclick = () => { s.idx--; routes.quiz(); };
  const nx = $("#next"); if (nx) nx.onclick = () => { s.idx++; routes.quiz(); };
  const fin = $("#finish"); if (fin) fin.onclick = () => {
    const rest = s.items.filter(x => x.chosen === null).length;
    if (rest && !window.confirm(`未解答が ${rest} 問あります。採点しますか?(未解答は不正解)`)) return;
    finish();
  };
};
const QM = it => qById(it.id).multi;
function quizMainButton(s, it) {
  const lastQ = s.idx === s.items.length - 1;
  if (s.mode === "exam") return lastQ ? `<button class="btn-primary" id="finish">採点する</button>` : `<button class="btn-primary" id="next">次へ ›</button>`;
  if (!it.checked) return QM(it) ? `<button class="btn-primary" id="check" ${it.chosen ? "" : "disabled"}>答え合わせ</button>` : `<button disabled>選択肢を選ぶ</button>`;
  return lastQ ? `<button class="btn-primary" id="finish">結果を見る</button>` : `<button class="btn-primary" id="next">次へ ›</button>`;
}

// 採点して記録
function finish() {
  const s = session;
  const perGenre = {}; let correct = 0;
  const answers = s.items.map(it => {
    const q = qById(it.id), ok = sameSet(toArr(it.chosen), q.ans);
    if (ok) correct++;
    (perGenre[q.genre] ||= { c: 0, t: 0 }); perGenre[q.genre].t++; if (ok) perGenre[q.genre].c++;
    const st = S.qstats[q.id] || { seen: 0, wrong: 0 };
    st.seen++; if (!ok) st.wrong++; st.last = ok; st.lastChosen = it.chosen; st.lastDate = new Date().toISOString();
    S.qstats[q.id] = st;
    return { id: q.id, chosen: it.chosen, ok, level: q.level, genre: q.genre };
  });
  // ジャンル別レベルの上下
  const levelChange = {};
  for (const g in perGenre) {
    const { c, t } = perGenre[g]; if (t < 3) continue;
    const r = c / t, before = S.genreLevel[g];
    if (r >= 0.8) S.genreLevel[g] = Math.min(10, before + 1);
    else if (r < 0.5) S.genreLevel[g] = Math.max(1, before - 1);
    if (S.genreLevel[g] !== before) levelChange[g] = [before, S.genreLevel[g]];
  }
  const a = { id: Date.now().toString(36), date: new Date().toISOString(), mode: s.mode, genre: s.genre, level: s.level,
    total: s.items.length, correct, seconds: Math.round((Date.now() - s.started) / 1000), perGenre, answers,
    levelAfter: { ...S.genreLevel }, levelChange };
  S.attempts.push(a); save(); session = null;
  location.replace("#/result/" + a.id);
}

// ---------- 結果 ----------
routes.result = ([id]) => {
  const a = S.attempts.find(x => x.id === id); if (!a) return go("/history");
  const sc = pct(a.correct, a.total);
  page("結果", `
    <div class="card" style="text-align:center">
      <div class="sub">${fmtDate(a.date)} / ${MODES[a.mode]} / ${genreLabel(a.genre)}${a.level ? ` / レベル${a.level}` : ""}</div>
      <div class="score-big">${sc}<span style="font-size:.4em">点</span></div>
      <div>${a.correct} / ${a.total} 問正解 <span class="${sc >= 60 ? "ok" : "bad"}">${sc >= 60 ? "合格ライン(60%)以上" : "合格ライン(60%)未満"}</span></div>
      <div class="sub">所要 ${Math.floor(a.seconds / 60)}分${a.seconds % 60}秒</div>
    </div>
    <h2>ジャンル別</h2>
    <div class="card">${GENRE_KEYS.filter(g => a.perGenre[g]).map(g => [g, a.perGenre[g]]).map(([g, v]) => `<div class="row" style="align-items:center;margin:4px 0">
      <div style="flex:0 0 70px">${chip(g)}</div><div class="bar" style="flex:1"><i style="width:${pct(v.c, v.t)}%;background:${GENRE_COLOR[g]}"></i></div>
      <div style="flex:0 0 120px;text-align:right">${v.c}/${v.t} (${pct(v.c, v.t)}%)</div></div>`).join("")}
      ${Object.keys(a.levelChange || {}).length ? `<div style="margin-top:6px">${Object.entries(a.levelChange).map(([g, [b, n]]) => `${GENRES[g]}: Lv${b} → <b class="${n > b ? "ok" : "bad"}">Lv${n}</b>`).join(" / ")}</div>` : `<div class="sub">レベルの変化なし</div>`}
    </div>
    <h2>解答と解説</h2>
    ${answerList(a.answers)}
    <div class="row"><a class="btn btn-primary" href="#/setup?mode=${a.mode}">もう一度</a><a class="btn" href="#/setup?mode=weak">弱点復習へ</a></div>`);
};
function answerList(answers) {
  return answers.map((x, i) => {
    const q = qById(x.id); if (!q) return "";
    return `<div class="card"><div class="qhead"><b class="${x.ok ? "ok" : "bad"}">${x.ok ? "◯" : "✕"} 問${i + 1}</b>${chip(q.genre)}<span class="chip">Lv ${q.level}</span>${q.multi ? `<span class="chip">すべて選ぶ</span>` : ""}</div>
      <div class="pre">${h(q.question)}</div>${figHtml(q)}
      <div class="sub" style="margin-top:4px">あなたの答え: <span class="${x.ok ? "ok" : "bad"}">${h(ansText(q, toArr(x.chosen)))}</span><br>正解: <span class="ok">${h(ansText(q, q.ans))}</span></div>
      <details><summary>選択肢と解説</summary>${choiceList(q)}${h(q.explanation)}${visHtml(q)}${srcHtml(q)}</details></div>`;
  }).join("");
}
function choiceList(q) {
  return `<ul class="clist">${q.choices.map((c, i) => `<li class="${q.ans.includes(i) ? "ok" : ""}"><b>${labelOf(q, i, i)}.</b> ${h(c)}${q.ans.includes(i) ? " ← 正解" : ""}</li>`).join("")}</ul>`;
}

// ---------- 勉強(問題と解説の一覧) ----------
routes.study = (_, p) => {
  let g = p.get("g") || "all", lv = p.get("lv") || "all", only = p.get("only") || "", kw = p.get("kw") || "";
  let og = p.get("o") || "all", yr = p.get("y") || "all", limit = 30;
  const years = [...new Set(allQuestions().filter(isPast).map(q => q.exam + "|" + q.year))].sort().reverse();
  const draw = () => {
    let list = allQuestions().filter(q => originOk(q, og));
    if (yr !== "all") list = list.filter(q => q.exam + "|" + q.year === yr);
    if (g !== "all") list = list.filter(q => q.genre === g);
    if (lv !== "all") list = list.filter(q => q.level === +lv);
    if (only === "wrong") list = list.filter(q => stat(q.id).wrong > 0);
    if (only === "unseen") list = list.filter(q => !stat(q.id).seen);
    if (kw) list = list.filter(q => (q.question + q.explanation + q.topic + q.choices.join()).includes(kw));
    list.sort((a, b) => a.genre.localeCompare(b.genre) || a.level - b.level || a.id.localeCompare(b.id));
    const total = list.length; list = list.slice(0, limit);
    page("勉強(問題と解説)", `
      <div class="card">
        <div class="row"><select id="g"><option value="all">全ジャンル</option>${GENRE_KEYS.map(k => `<option value="${k}" ${g === k ? "selected" : ""}>${GENRES[k]}</option>`).join("")}</select>
        <select id="lv"><option value="all">全レベル</option>${[...Array(10)].map((_, i) => `<option value="${i + 1}" ${+lv === i + 1 ? "selected" : ""}>レベル${i + 1}</option>`).join("")}</select></div>
        <div class="row" style="margin-top:8px"><select id="o">${Object.entries(ORIGINS).map(([k, v]) => `<option value="${k}" ${og === k ? "selected" : ""}>出題元: ${v}</option>`).join("")}</select>
        <select id="y"><option value="all">全年度</option>${years.map(k => { const [ex, y] = k.split("|"); return `<option value="${h(k)}" ${yr === k ? "selected" : ""}>${y}年 ${h(ex)}</option>`; }).join("")}</select></div>
        <div class="row" style="margin-top:8px"><select id="only"><option value="">すべての問題</option><option value="wrong" ${only === "wrong" ? "selected" : ""}>間違えたことがある問題</option><option value="unseen" ${only === "unseen" ? "selected" : ""}>まだ解いていない問題</option></select></div>
        <input type="search" id="kw" placeholder="言葉で探す(例: 取消料)" value="${h(kw)}" style="margin-top:8px">
      </div>
      <div class="sub">${total} 問。タップで正解と解説が開きます。</div>
      ${list.map(q => { const s = stat(q.id); return `<div class="card"><div class="qhead">${chip(q.genre)}<span class="chip">Lv ${q.level}</span>${q.topic ? `<span class="chip">${h(q.topic)}</span>` : ""}
        ${s.seen ? `<span class="sub">${s.seen}回中 ${s.wrong}回ミス</span>` : `<span class="sub">未出題</span>`}</div>
        <div class="pre">${h(q.question)}</div>${figHtml(q)}
        <details><summary>選択肢・正解・解説を見る</summary>${choiceList(q)}
        <div class="expl">${h(q.explanation)}</div>${visHtml(q)}${srcHtml(q)}</details></div>`; }).join("")}
      ${total > limit ? `<button id="more" class="btn-block">もっと見る(残り ${total - limit} 問)</button>` : ""}`);
    const upd = () => { g = $("#g").value; lv = $("#lv").value; only = $("#only").value; kw = $("#kw").value.trim(); og = $("#o").value; yr = $("#y").value; limit = 30;
      history.replaceState(null, "", `#/study?g=${g}&lv=${lv}&only=${only}&o=${og}&y=${encodeURIComponent(yr)}&kw=${encodeURIComponent(kw)}`); draw(); };
    ["#g", "#lv", "#only", "#o", "#y"].forEach(s => $(s).onchange = upd);
    const mo = $("#more"); if (mo) mo.onclick = () => { const y0 = window.scrollY; limit += 30; draw(); window.scrollTo(0, y0); };
    $("#kw").onchange = upd;
  };
  draw();
};

// ---------- 受験履歴(一覧+カレンダー) ----------
let calMonth = null, calSel = null;
routes.history = () => {
  const now = new Date();
  if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const byDay = {};
  for (const a of S.attempts) (byDay[dayKey(new Date(a.date))] ||= []).push(a);
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  let cells = "日月火水木金土".split("").map(d => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < first; i++) cells += `<div class="d empty"></div>`;
  for (let d = 1; d <= days; d++) {
    const k = dayKey(new Date(y, m, d)), list = byDay[k];
    const best = list ? Math.max(...list.map(a => pct(a.correct, a.total))) : null;
    cells += `<div class="d ${list ? "has" : ""} ${k === dayKey(now) ? "today" : ""} ${k === calSel ? "sel" : ""}" data-k="${list ? k : ""}">${d}${list ? `<span class="s">${list.length}回<br>${best}点</span>` : ""}</div>`;
  }
  const shown = calSel ? (byDay[calSel] || []) : S.attempts.slice().reverse();
  page("受験履歴", `
    <div class="card">
      <div class="row" style="align-items:center"><button id="pm" style="flex:0 0 52px">‹</button><b style="text-align:center">${y}年${m + 1}月</b><button id="nm" style="flex:0 0 52px">›</button></div>
      <div class="cal" id="cal" style="margin-top:8px">${cells}</div>
      <div class="sub" style="margin-top:6px">枠のある日=受験した日(回数と最高点)。日付をタップでその日の記録だけ表示。</div>
    </div>
    <h2>${calSel ? `${calSel} の記録 <button id="clr" style="min-height:32px;padding:2px 10px;font-size:.8em">すべて表示</button>` : `すべての記録(${S.attempts.length}回)`}</h2>
    ${shown.length ? `<div class="card" style="padding:4px 10px"><table><tr><th>日時</th><th>内容</th><th>点</th></tr>
      ${shown.map(a => `<tr data-id="${a.id}" style="cursor:pointer"><td>${fmtDate(a.date)}</td><td>${MODES[a.mode]}<br><span class="sub">${genreLabel(a.genre)}${a.level ? ` Lv${a.level}` : ""} ${a.total}問</span></td>
        <td><b class="${pct(a.correct, a.total) >= 60 ? "ok" : "bad"}">${pct(a.correct, a.total)}</b></td></tr>`).join("")}</table></div>` : `<div class="card sub">記録がありません。</div>`}`);
  $("#pm").onclick = () => { calMonth = new Date(y, m - 1, 1); routes.history(); };
  $("#nm").onclick = () => { calMonth = new Date(y, m + 1, 1); routes.history(); };
  $("#cal").onclick = e => { const d = e.target.closest(".d"); if (d && d.dataset.k) { calSel = d.dataset.k === calSel ? null : d.dataset.k; routes.history(); } };
  const c = $("#clr"); if (c) c.onclick = () => { calSel = null; routes.history(); };
  document.querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => go("/result/" + tr.dataset.id));
};

// ---------- 間違い・弱点 ----------
routes.analysis = () => {
  const acc = genreAccuracy();
  const ranked = GENRE_KEYS.filter(g => acc[g].t).sort((a, b) => acc[a].c / acc[a].t - acc[b].c / acc[b].t);
  // 分野(topic)別
  const topic = {};
  for (const a of S.attempts) for (const x of a.answers) {
    const q = qById(x.id); if (!q) continue;
    const k = GENRES[q.genre] + "|" + (q.topic || "その他");
    (topic[k] ||= { c: 0, t: 0, g: q.genre, name: q.topic || "その他" }); topic[k].t++; if (x.ok) topic[k].c++;
  }
  const weakTopics = Object.values(topic).filter(t => t.t >= 2).sort((a, b) => a.c / a.t - b.c / b.t).slice(0, 6);
  const wrong = allQuestions().filter(q => stat(q.id).wrong > 0).sort((a, b) => (stat(b.id).last === false) - (stat(a.id).last === false) || stat(b.id).wrong - stat(a.id).wrong);
  page("間違い・弱点", `
    <h2>ジャンル別の正答率(これまでの合計)</h2>
    <div class="card">${GENRE_KEYS.map(g => `<div class="row" style="align-items:center;margin:6px 0">
      <div style="flex:0 0 70px">${chip(g)}</div><div class="bar" style="flex:1"><i style="width:${pct(acc[g].c, acc[g].t)}%;background:${GENRE_COLOR[g]}"></i></div>
      <div style="flex:0 0 112px;text-align:right">${acc[g].t ? `${pct(acc[g].c, acc[g].t)}% <span class="sub">(${acc[g].c}/${acc[g].t})</span>` : `<span class="sub">未受験</span>`}</div></div>`).join("")}
      ${ranked.length ? `<div style="margin-top:6px">いちばんの弱点: <b class="bad">${GENRES[ranked[0]]}</b>(${pct(acc[ranked[0]].c, acc[ranked[0]].t)}%)</div>` : ""}
    </div>
    <a class="btn btn-primary btn-block" href="#/setup?mode=weak">🎯 弱点復習モードで解く</a>
    <h2>苦手な分野</h2>
    <div class="card">${weakTopics.length ? `<table><tr><th>分野</th><th>正答率</th></tr>${weakTopics.map(t => `<tr><td>${chip(t.g)} ${h(t.name)}</td><td><b class="${pct(t.c, t.t) >= 60 ? "ok" : "bad"}">${pct(t.c, t.t)}%</b> <span class="sub">${t.c}/${t.t}</span></td></tr>`).join("")}</table>` : `<span class="sub">同じ分野を2問以上解くと表示されます。</span>`}</div>
    <h2>間違えた問題(${wrong.length}問)</h2>
    ${wrong.map(q => { const s = stat(q.id); return `<div class="card"><div class="qhead">${chip(q.genre)}<span class="chip">Lv ${q.level}</span>
      ${s.last === false ? `<span class="bad">前回も✕</span>` : `<span class="ok">前回は◯</span>`}<span class="sub">${s.seen}回中${s.wrong}回ミス</span></div>
      <div class="pre">${h(q.question)}</div>${figHtml(q)}
      <div class="sub" style="margin-top:4px">${s.last === false ? `前回の答え: <span class="bad">${h(ansText(q, toArr(s.lastChosen)))}</span><br>` : ""}正解: <span class="ok">${h(ansText(q, q.ans))}</span></div>
      <details><summary>選択肢と解説</summary>${choiceList(q)}${h(q.explanation)}${visHtml(q)}${srcHtml(q)}</details></div>`; }).join("") || `<div class="card sub">まだ間違えた問題はありません。</div>`}`);
};

// ---------- 成長グラフ ----------
routes.charts = () => {
  const pts = { acc: {}, lv: {} };
  GENRE_KEYS.forEach(g => { pts.acc[g] = []; pts.lv[g] = []; });
  S.attempts.forEach((a, i) => {
    for (const g of GENRE_KEYS) {
      if (a.perGenre[g]) pts.acc[g].push({ x: i, y: pct(a.perGenre[g].c, a.perGenre[g].t), date: a.date, note: `${a.perGenre[g].c}/${a.perGenre[g].t}問` });
      if (a.levelAfter) pts.lv[g].push({ x: i, y: a.levelAfter[g], date: a.date, note: "" });
    }
  });
  const n = S.attempts.length;
  page("成長グラフ", n < 1 ? `<div class="card sub">受験すると、ここにジャンル別のレベルと正答率の推移が出ます。</div>` : `
    <div class="legend">${GENRE_KEYS.map(g => `<span>${chip(g)}</span>`).join("")}<span class="sub">横軸=受験の回(古い→新しい)</span></div>
    <h2>ジャンル別のレベル(受験後)</h2>
    <div class="card chart" id="c-lv"></div>
    <h2>ジャンル別の正答率(%)</h2>
    <div class="card chart" id="c-acc"></div>
    <details class="card"><summary>表で見る</summary><table><tr><th>回</th><th>日時</th>${GENRE_KEYS.map(g => `<th>${GENRES[g]}</th>`).join("")}</tr>
      ${S.attempts.map((a, i) => `<tr><td>${i + 1}</td><td>${fmtDate(a.date)}</td>${GENRE_KEYS.map(g => `<td>${a.perGenre[g] ? pct(a.perGenre[g].c, a.perGenre[g].t) + "%" : "−"}<br><span class="sub">Lv${a.levelAfter ? a.levelAfter[g] : "−"}</span></td>`).join("")}</tr>`).join("")}</table></details>`);
  if (n) { lineChart($("#c-lv"), pts.lv, { min: 1, max: 10, ticks: [1, 4, 7, 10], unit: "", n, label: "Lv" });
    lineChart($("#c-acc"), pts.acc, { min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100], unit: "%", n, line60: true }); }
};
function marker(shape, x, y, color) {
  const ring = `stroke="#353d4e" stroke-width="2"`;
  if (shape === "square") return `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" rx="1.5" fill="${color}" ${ring}/>`;
  if (shape === "triangle") return `<path d="M${x} ${y - 6}L${x + 5.5} ${y + 4}H${x - 5.5}Z" fill="${color}" ${ring}/>`;
  return `<circle cx="${x}" cy="${y}" r="4.5" fill="${color}" ${ring}/>`;
}
// 折れ線グラフ(SVG手作り)。線2px・形の違う点・線の端に名前・なぞると数値
function lineChart(el, series, o) {
  const W = 340, H = 200, L = 34, R = 44, T = 12, B = 26;
  const xs = i => L + (o.n <= 1 ? (W - L - R) / 2 : i / (o.n - 1) * (W - L - R));
  const ys = v => T + (1 - (v - o.min) / (o.max - o.min)) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="推移グラフ">`;
  for (const t of o.ticks) s += `<line x1="${L}" x2="${W - R}" y1="${ys(t)}" y2="${ys(t)}" stroke="#4a5468" stroke-width="1" ${t === o.min ? "" : 'stroke-dasharray="2 4"'}/><text x="${L - 6}" y="${ys(t) + 4}" fill="#a9b2c3" font-size="10" text-anchor="end">${t}${o.unit}</text>`;
  if (o.line60) s += `<line x1="${L}" x2="${W - R}" y1="${ys(60)}" y2="${ys(60)}" stroke="#ffb454" stroke-width="1"/><text x="${L + 4}" y="${ys(60) - 4}" fill="#ffb454" font-size="9">合格ライン60%</text>`;
  const step = Math.max(1, Math.ceil(o.n / 6));
  for (let i = 0; i < o.n; i += step) s += `<text x="${xs(i)}" y="${H - 8}" fill="#a9b2c3" font-size="10" text-anchor="middle">${i + 1}回</text>`;
  const ends = [];
  for (const g of GENRE_KEYS) {
    const p = series[g]; if (!p.length) continue;
    if (p.length > 1) s += `<polyline points="${p.map(d => `${xs(d.x)},${ys(d.y)}`).join(" ")}" fill="none" stroke="${GENRE_COLOR[g]}" stroke-width="2" stroke-linejoin="round"/>`;
    for (const d of p) s += marker(GENRE_SHAPE[g], xs(d.x), ys(d.y), GENRE_COLOR[g]);
    const last = p[p.length - 1]; ends.push({ g, y: ys(last.y), x: xs(last.x) });
  }
  // 端の名前(重なりをずらす)
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  for (const e of ends) s += `<text x="${W - R + 6}" y="${e.y + 4}" fill="#e8ebf2" font-size="10">${GENRES[e.g]}</text>`;
  s += `<line id="xh" y1="${T}" y2="${H - B}" stroke="#a9b2c3" stroke-width="1" visibility="hidden"/>`;
  s += `<rect x="${L - 10}" y="0" width="${W - L - R + 20}" height="${H}" fill="transparent" id="hit"/></svg><div class="tip"></div>`;
  el.innerHTML = s;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), xh = el.querySelector("#xh");
  const move = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
    const i = o.n <= 1 ? 0 : Math.max(0, Math.min(o.n - 1, Math.round((px - L) / (W - L - R) * (o.n - 1))));
    const rows = GENRE_KEYS.map(g => [g, series[g].find(d => d.x === i)]).filter(x => x[1]);
    if (!rows.length) { tip.style.display = "none"; xh.setAttribute("visibility", "hidden"); return; }
    xh.setAttribute("x1", xs(i)); xh.setAttribute("x2", xs(i)); xh.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${i + 1}回目</b> ${fmtDate(rows[0][1].date)}<br>` + rows.map(([g, d]) => `${GENRES[g]}: <b>${o.label || ""}${d.y}${o.unit}</b> ${d.note}`).join("<br>");
    tip.style.display = "block";
    const left = xs(i) / W * r.width;
    tip.style.left = Math.min(r.width - tip.offsetWidth, Math.max(0, left - tip.offsetWidth / 2)) + "px";
    tip.style.top = "-6px";
  };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { tip.style.display = "none"; xh.setAttribute("visibility", "hidden"); });
}

// ---------- 問題の追加・設定 ----------
routes.data = () => {
  page("問題の追加・設定", `
    <h2>問題を取り込む(JSON / CSV)</h2>
    <div class="card">
      <input type="file" id="file" accept=".json,.csv,application/json,text/csv">
      <p class="sub">同じIDの問題は上書きされます。形式は下の「ひな形」を参照。出典(source)は必ず書いてください。</p>
      <div class="row"><a class="btn" href="templates/questions-template.csv" download>CSVひな形</a><a class="btn" href="templates/questions-template.json" download>JSONひな形</a></div>
      <div id="imp"></div>
    </div>
    <div class="card sub">取り込み済み: ${S.custom.length} 問 ${S.custom.length ? `<button id="delc" style="min-height:36px;padding:4px 10px">取り込んだ問題を消す</button>` : ""}</div>
    <h2>試験日</h2>
    <div class="card"><input type="date" id="exam" value="${h(S.settings.examDate)}"><div class="sub">入れるとホームに「あと何日」が出ます。</div></div>
    <h2>バックアップ</h2>
    <div class="card">
      <p class="sub">記録はこの端末のブラウザの中だけにあります。機種変更・ブラウザのデータ消去の前に書き出してください。</p>
      <div class="row"><button id="exp">記録を書き出す</button><label class="btn">読み戻す<input type="file" id="restore" accept=".json" hidden></label></div>
      <button id="reset" class="btn-block" style="margin-top:14px;border-color:#ff8a80;color:#ff8a80">記録をすべて消す</button>
    </div>`);
  $("#file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    let raw;
    try { raw = f.name.toLowerCase().endsWith(".csv") ? parseCSV(text) : (j => j.questions || j)(JSON.parse(text)); }
    catch (err) { $("#imp").innerHTML = `<p class="bad">読めませんでした: ${h(err.message)}</p>`; return; }
    const ok = [], ng = [];
    raw.forEach((q, i) => { const v = normalizeQ(q); v.ok ? ok.push(v.q) : ng.push(`${i + 1}件目: ${v.why}`); });
    const map = new Map(S.custom.map(q => [q.id, q])); ok.forEach(q => map.set(q.id, q));
    S.custom = [...map.values()]; resetQ();
    try { save(); } catch (err) { $("#imp").innerHTML = `<p class="bad">端末の保存容量が足りません: ${h(err.message)}</p>`; return; }
    $("#imp").innerHTML = `<p class="ok">${ok.length} 問を取り込みました。</p>${ng.length ? `<p class="bad">取り込めなかったもの ${ng.length} 件</p><div class="sub">${ng.slice(0, 20).map(h).join("<br>")}</div>` : ""}`;
  };
  const dc = $("#delc"); if (dc) dc.onclick = () => { if (window.confirm("取り込んだ問題を消しますか?(受験記録は残ります)")) { S.custom = []; resetQ(); save(); routes.data(); } };
  $("#exam").onchange = e => { S.settings.examDate = e.target.value; save(); toast("保存しました"); };
  $("#exp").onclick = () => {
    const b = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `旅管学習の記録_${dayKey(new Date())}.json`; a.click();
  };
  $("#restore").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.attempts)) throw new Error("記録のファイルではありません");
      if (!window.confirm("今の記録をこのファイルの中身で置き換えます。よいですか?")) return;
      S = Object.assign(defaultState(), d); resetQ(); save(); toast("読み戻しました"); routes.data(); }
    catch (err) { toast("読めませんでした: " + err.message); }
  };
  $("#reset").onclick = () => { if (window.confirm("受験記録・成績をすべて消します。元に戻せません。よいですか?")) { const c = S.custom; S = defaultState(); S.custom = c; save(); toast("消しました"); } };
};

// ---------- 出典・試験の構成 ----------
// 収録している過去問の年度の幅(例: 平成19〜令和8年度)
function yearsOf(exam) {
  const ys = allQuestions().filter(q => q.exam === exam && q.year).map(q => q.year);
  if (!ys.length) return "";
  const wa = y => y >= 2019 ? `令和${y === 2019 ? "元" : y - 2018}` : `平成${y - 1988}`;
  return `${wa(Math.min(...ys))}〜${wa(Math.max(...ys))}年度`;
}
routes.about = () => page("出典・試験の構成", `
  <h2>試験の構成</h2>
  <div class="card">
    <b>総合旅行業務取扱管理者試験</b>(実施: 一般社団法人 日本旅行業協会 JATA)<br>
    ①旅行業法及びこれに基づく命令 ②旅行業約款・運送約款・宿泊約款 ③国内旅行実務 ④海外旅行実務<br><br>
    <b>国内旅行業務取扱管理者試験</b>(実施: 一般社団法人 全国旅行業協会 ANTA)<br>
    ①旅行業法及びこれに基づく命令 ②旅行業約款・運送約款・宿泊約款 ③国内旅行実務<br><br>
    <span class="sub">このサイトのジャンル: 「法令」=①②、「国内」=③、「海外」=④。合格の目安は科目ごとに60%以上。試験日・要項は毎年の実施要領で確認してください。</span>
  </div>
  <h2>出典</h2>
  <div class="card">
    <p>過去の試験問題の出典: 総合試験は日本旅行業協会(JATA)、国内試験は全国旅行業協会(ANTA)。試験制度は観光庁の案内による。</p>
    <p><b>収録している過去問</b>(各問題の下に年度・科目・問番号と取得元PDFを表示)</p>
    <ul>
      <li>総合旅行業務取扱管理者試験 ${yearsOf("総合")}(出典: 一般社団法人日本旅行業協会「<a href="https://www.jata-net.or.jp/seminar/page-41637/exam_xaminationquestion/" target="_blank" rel="noopener">過去5年間の試験問題・正解</a>」。それ以前の年度は同協会サイトの過去の掲載分を Web Archive の写しから取得)。著作権はJATAに帰属します。</li>
      <li>国内旅行業務取扱管理者試験 ${yearsOf("国内")}(出典: 一般社団法人全国旅行業協会 ANTA「試験問題・正解及び配点」。ANTAのサイトが整備中のため、同協会サイトの過去の掲載分を Web Archive の写しから取得)。著作権はANTAに帰属します。</li>
      <li class="sub">JATA・ANTAの過去問は、本人の学習のためだけに使います。公開しているサイトでは合言葉で暗号化して置き、合言葉を入れた端末の中でだけ開きます。複製・再配布はしないでください。${LOCKED.length && !UNLOCKED ? "<b>(この端末ではまだ開いていません。ホームで合言葉を入れてください)</b>" : ""}${!LOCKED.length && !allQuestions().some(q => q.exam === "総合") ? "<b>(この版には入っていません)</b>" : ""}</li>
      <li>地域限定旅行業務取扱管理者試験 令和5〜8年度の法令・約款(出典: 観光庁ウェブサイト「<a href="https://www.mlit.go.jp/kankocho/seisaku_seido/ryokogyoho/chiikigenteikanrisha.html" target="_blank" rel="noopener">地域限定旅行業務取扱管理者試験</a>」)。公共データ利用規約(第1.0版)に従い利用。このサイトで、PDFの問題文を1問ずつに分け、表記を整え、難易度レベルを推定して付ける編集・加工を行っています。</li>
    </ul>
    <p class="sub">過去問の解説は公表されていないため、正解のみ表示します。資料編(運賃表・時刻表など)を使う問題には資料編PDFへの案内を、写真・図を使う問題には問題用紙の該当部分の画像を付けています。文字を正しく取り出せなかった問題・正解表と対応づけられなかった問題は収録していません。問題は出題当時の法令・制度に基づきます。レベルは公式の難易度ではなく、形式(すべて選ぶ・組合せ)・計算の有無・文章量などから自動で決めた目安です。</p>
    <ul>
      <li><a href="https://www.mlit.go.jp/kankocho/shiken_kanrisha.html" target="_blank" rel="noopener">観光庁: 旅行業務取扱管理者試験</a></li>
      <li><a href="https://www.jata-net.or.jp/" target="_blank" rel="noopener">日本旅行業協会(JATA)</a></li>
      <li><a href="https://www.anta.or.jp/" target="_blank" rel="noopener">全国旅行業協会(ANTA)</a></li>
    </ul>
    <p><b>見て覚える(解説の下の地図・写真・図表・動画)</b></p>
    <ul class="sub">
      <li>地図: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>(パブリックドメイン)の国・都道府県の形をもとに、このサイトで作った位置図。点の位置は Wikipedia / Wikidata の座標。</li>
      <li>写真: Wikimedia Commons の自由ライセンス(CC BY・CC BY-SA・パブリックドメインなど)の写真を、Wikimedia のサーバーから表示。作者とライセンスを各写真の下に表示しています。</li>
      <li>図表(旅行業の種別・取消料・旅程保証・特別補償・時差・コード表・日本三名園など): このサイトで作ったもの。法令・約款は作成時点の要点なので、改正に注意してください。</li>
      <li>動画: よく出る地名には、自治体・観光協会・政府観光局・世界遺産検定(公式)などの動画へのリンクを「おすすめ動画」として付けています(題名・チャンネルを確かめて選んだもの。埋め込みはしていません)。公式の動画が見つからない地名には、旅行会社や個人の旅行チャンネルの動画を「参考動画」として付けています(内容の正確さは公式ほど確かではありません)。それ以外は YouTube の検索結果へのリンク。</li>
    </ul>
    <p class="sub">収録しているサンプル問題は、過去問の本文を複製したものではなく、出題分野を参考に作ったオリジナル問題です。法令・約款・運賃制度・入国制度は改正されることがあるため、最新の法令・公式資料で確かめてください。各問題の下に出典を表示しています。過去問を取り込むときは、各協会の利用条件を確認し、出典(年度・科目・問番号)を source 欄に書いてください。</p>
  </div>
  <h2>使い方</h2>
  <div class="card">
    <ul>
      <li>ホーム画面に追加: iPhoneはSafariの共有ボタン→「ホーム画面に追加」。Androidはメニュー→「ホーム画面に追加」。</li>
      <li>記録はこの端末だけに保存されます(ログイン不要)。「問題の追加・設定」で書き出し・読み戻しができます。</li>
      <li>レベルは1=やさしい、10=むずかしい。受けるたびにジャンル別のレベルが上下します。</li>
    </ul>
  </div>`);

// ---------- 起動 ----------
window.addEventListener("hashchange", () => {
  if (session && !location.hash.startsWith("#/quiz") && !location.hash.startsWith("#/result")) session = null;
  render();
});
(async () => {
  await loadBuiltin();
  if (!location.hash) location.replace("#/");
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
