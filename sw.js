// オフラインでも開けるようにする。画面の部品と問題データを保存しておき、通信できないときに使う。
const CACHE = "tex-v6";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "manifest.webmanifest", "icons/icon.svg",
  "icons/icon-192.png", "icons/icon-512.png", "data/sets.json", "data/questions.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // つながるときは常に最新を取り、保存し直す。つながらないときだけ保存分を使う
  // ブラウザの保存分(GitHub Pages は最大10分)を使わず、毎回サーバーに新しい版があるか確かめる(画面の移動は元の要求のまま)
  const net = e.request.mode === "navigate" ? fetch(e.request) : fetch(e.request, { cache: "no-cache" });
  e.respondWith(net.then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
