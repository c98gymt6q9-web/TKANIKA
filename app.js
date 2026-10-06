(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const secName = (id) => TK.sections.find((s) => s.id === id)?.name || "";
  const prepById = (id) => TK.preps.find((p) => p.id === id);

  /* ---------- прогресс (только в браузере зрителя) ---------- */
  const KEY = "tkanika.v1";
  let P = { known: {}, tests: {}, prepBest: 0, seen: {}, exams: 0, mistakes: {}, last: null };
  try { Object.assign(P, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} };

  /* ---------- AI ---------- */
  let sample = null, imgOK = false, downloads = null;
  const aiReady = (async () => {
    try {
      if (!window.claude || !window.claude.use) return null;
      sample = await window.claude.use("sample");
      if (sample) { const lim = await sample.limits().catch(() => null); imgOK = !!(lim && lim.images); }
      downloads = await window.claude.use("downloads").catch(() => null);
    } catch (e) { sample = null; }
    return sample;
  })();
  aiReady.then(() => { if (!(view.tab === "coll" && view.sub)) render(); });
  function aiErr(e) {
    const m = { not_granted: "Доступ к AI для этой страницы не разрешён.", sampling_disabled: "AI недоступен для этого аккаунта.", rate_limited: "Слишком много запросов — попробуйте через минуту.", session_expired: "Сессия истекла — войдите в Claude заново.", image_rejected: "Файл не подошёл: нужен JPEG, PNG, WebP или GIF до 20 МБ.", images_unavailable: "В этом окне AI не принимает изображения.", refused: "AI не стал отвечать на этот запрос — переформулируйте его.", invalid_json: "AI ответил в неожиданном формате — нажмите ещё раз.", prompt_too_large: "Слишком длинный текст — сократите ответ.", bad_key: "Ключ API не подошёл — проверьте его в настройках AI.", network: "Нет связи с AI — проверьте интернет.", api_error: "Сервис AI вернул ошибку — попробуйте ещё раз." };
    return m[e && e.code] || "Не удалось получить ответ AI. Попробуйте ещё раз.";
  }
  const thinking = (t = "AI рассматривает препарат…") => `<div class="thinking"><span class="dot3"><i></i><i></i><i></i></span>${esc(t)}</div>`;
  const noAI = `<div class="note" style="padding:12px 14px;border-radius:10px;background:var(--warn-soft);color:var(--warn)">AI-функции работают внутри Claude или в любом браузере с вашим ключом Anthropic API. Атлас, база знаний и тесты доступны всегда.${window.TKAI ? ` <button class="btn sm" style="margin-top:8px" onclick="TKAI.open()">${'Подключить AI'}</button>` : ""}</div>`;

  /* ---------- иконки ---------- */
  const I = {
    atlas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><circle cx="14.5" cy="9" r="1.2" fill="currentColor"/><circle cx="14" cy="15" r="1.8" fill="currentColor"/></svg>',
    ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
    kb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 8h6"/></svg>',
    coll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="4"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    upload: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  };

  /* ---------- навигация ---------- */
  const TABS = [["home", "Главная", "Главная"], ["kb", "Теория", "Теория"], ["atlas", "Атлас", "Атлас"], ["coll", "Тесты", "Тесты"], ["ai", "AI и скан", "AI"]];
  let view = { tab: "home", sub: null };
  const fromHash = () => { const t = (location.hash || "").slice(1); return TABS.some((x) => x[0] === t) ? t : "home"; };
  view.tab = fromHash();
  function go(tab, sub = null) {
    view = { tab, sub };
    try { if (location.hash.slice(1) !== tab) location.hash = tab; } catch (e) {}
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", () => { const t = fromHash(); if (t !== view.tab) { view = { tab: t, sub: null }; render(); } });
  function renderNav() {
    const mk = (full) => TABS.map(([id, a, b]) => `<button data-tab="${id}" ${view.tab === id ? 'aria-current="page"' : ""}>${I[id]}<span>${full ? a : b}</span></button>`).join("");
    $("#nav").innerHTML = mk(true); $("#tabbar").innerHTML = mk(false);
    $$("[data-tab]").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  }

  /* ---------- тема ---------- */
  let theme = null; try { theme = localStorage.getItem("tkanika.theme"); } catch (e) {}
  const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  function applyTheme() { if (theme) document.documentElement.dataset.theme = theme; $("#themeBtn").innerHTML = isDark() ? I.sun : I.moon; }
  $("#themeBtn").onclick = () => { theme = isDark() ? "light" : "dark"; try { localStorage.setItem("tkanika.theme", theme); } catch (e) {} applyTheme(); };
  applyTheme();

  /* ---------- отрисовка полей с кэшем ---------- */
  const cache = new Map(), queue = []; let busy = false;
  function paint(cv, id, size, opt = {}) {
    const key = id + "@" + size + (opt.seed || "");
    const blit = (off) => { cv.width = off.width; cv.height = off.height; cv.getContext("2d").drawImage(off, 0, 0); };
    if (cache.has(key)) return blit(cache.get(key));
    queue.push(() => { const off = document.createElement("canvas"); Slides.render(id, off, { size, ...opt }); cache.set(key, off); if (cv.isConnected) blit(off); });
    pump();
  }
  function pump() { if (busy || !queue.length) return; busy = true; setTimeout(() => { try { queue.shift()(); } finally { busy = false; pump(); } }, 16); }

  /* ================= АТЛАС ================= */
  let atlasFilter = "all";
  function atlasView(app) {
    const secs = atlasFilter === "all" ? TK.sections : TK.sections.filter((s) => s.id === atlasFilter);
    app.innerHTML = `
      <div class="page-h">
        <div><div class="eyebrow">Атлас препаратов</div><h1>${TK.preps.length} препаратов общей гистологии</h1>
        <p>Реальные микрофото и схемы полей зрения с подписями структур, двумя увеличениями и режимом самопроверки. Открой препарат и найди на нём всё, что спросят на зачёте.</p></div>
      </div>
      <div class="chips" role="group" aria-label="Раздел" style="margin-bottom:18px">
        <button class="chip" data-f="all" aria-pressed="${atlasFilter === "all"}">Все</button>
        ${TK.sections.map((s) => `<button class="chip" data-f="${s.id}" aria-pressed="${atlasFilter === s.id}">${s.short}</button>`).join("")}
      </div>
      <div class="atlas-grid">
        ${secs.map((s) => `<div class="sec-h"><h2>${s.name}</h2><span class="note mono">${TK.preps.filter((p) => p.sec === s.id).length} преп.</span></div>` +
          TK.preps.filter((p) => p.sec === s.id).map((p) => `
          <button class="card slide-card" data-p="${p.id}">
            ${TK.photos[p.id] ? `<img class="field" loading="lazy" decoding="async" src="${TK.photoUrl(TK.photos[p.id][0], 330)}" alt="" data-fb="${p.id}">` : `<canvas class="field" data-id="${p.id}" aria-hidden="true"></canvas>`}
            <h3>${esc(p.title)}</h3>
            <div class="meta"><span class="pill eo">${esc(p.stain.split(" (")[0].split("+")[0].trim())}</span>${P.seen[p.id] ? '<span class="pill good">изучен</span>' : ""}</div>
          </button>`).join("")).join("")}
      </div>`;
    $$("[data-f]", app).forEach((b) => (b.onclick = () => { atlasFilter = b.dataset.f; render(); }));
    $$("[data-p]", app).forEach((b) => (b.onclick = () => go("atlas", b.dataset.p)));
    $$("canvas.field", app).forEach((cv) => paint(cv, cv.dataset.id, 220));
    $$("img[data-fb]", app).forEach((im) => (im.onerror = () => { const cv = h(`<canvas class="field" aria-hidden="true"></canvas>`); im.replaceWith(cv); paint(cv, im.dataset.fb, 220); }));
  }

  /* масштаб и перетаскивание реального снимка в окуляре */
  function photoPan(wrap, img, zoom) {
    let x = 0, y = 0, sx = 0, sy = 0, drag = false;
    const lim = () => { const w = wrap.clientWidth * (zoom - 1) / 2; x = Math.max(-w, Math.min(w, x)); y = Math.max(-w, Math.min(w, y)); };
    const apply = () => { lim(); img.style.transform = `translate(${x}px,${y}px) scale(${zoom})`; };
    apply();
    if (zoom <= 1) return;
    wrap.style.cursor = "grab"; wrap.style.touchAction = "none";
    wrap.onpointerdown = (e) => { drag = true; sx = e.clientX - x; sy = e.clientY - y; wrap.setPointerCapture(e.pointerId); wrap.style.cursor = "grabbing"; };
    wrap.onpointermove = (e) => { if (!drag) return; x = e.clientX - sx; y = e.clientY - sy; apply(); };
    wrap.onpointerup = wrap.onpointercancel = () => { drag = false; wrap.style.cursor = "grab"; };
  }

  const artFor = (p) => ({ bone: "bone-art", adipose: "special-ct" })[p.id] || ({ epi: "epi-class", blood: "blood-art", ct: "loose", skel: "cartilage", musc: "muscle-art", nerv: "nerve-art" })[p.sec];

  let det = { zoom: 1, mode: "show", revealed: {}, src: "photo", pi: 0 };
  function detailView(app, id) {
    const p = prepById(id); if (!p) return go("atlas");
    P.seen[id] = 1; P.last = { tab: "atlas", sub: id }; save();
    const photos = TK.photos[id] || [], usePhoto = det.src === "photo" && photos.length > 0, pi = Math.min(det.pi, photos.length - 1);
    app.innerHTML = `
      <button class="back" id="back">${I.back} Все препараты</button>
      <div class="detail">
        <div class="scope">
          <div class="eyepiece" id="eye">${usePhoto ? `<div class="photo-pan" id="pan"><img id="ph" src="${TK.photoUrl(photos[pi], 960)}" alt="Микрофото: ${esc(p.title)}" draggable="false"></div>` : `<canvas id="cv" role="img" aria-label="Поле зрения: ${esc(p.title)}"></canvas>`}</div>
          ${photos.length ? `<div class="scope-bar"><div class="seg" role="group" aria-label="Источник"><button data-src="photo" aria-pressed="${usePhoto}">Фото</button><button data-src="scheme" aria-pressed="${!usePhoto}">Схема</button></div>
            ${usePhoto && photos.length > 1 ? `<div class="seg" role="group" aria-label="Снимок">${photos.map((_, i) => `<button data-pi="${i}" aria-pressed="${i === pi}">Снимок ${i + 1}</button>`).join("")}</div>` : ""}</div>` : ""}
          ${usePhoto ? `<p class="note credit">Фото: <a href="${photos[pi].page}" target="_blank" rel="noopener">${esc(photos[pi].by || "Wikimedia Commons")}</a> · ${esc(photos[pi].lic)} · ${det.zoom > 1 ? "перетаскивай снимок" : "Wikimedia Commons"}</p>` : ""}
          <div class="scope-bar">
            <div class="seg" role="group" aria-label="Увеличение">
              <button data-z="1" aria-pressed="${det.zoom === 1}">Малое</button><button data-z="2.5" aria-pressed="${det.zoom === 2.5}">Большое</button>
            </div>
            <div class="seg" role="group" aria-label="Подписи">
              <button data-m="show" aria-pressed="${det.mode === "show"}">Подписи</button><button data-m="quiz" aria-pressed="${det.mode === "quiz"}">Самопроверка</button>${usePhoto ? "" : `<button data-m="none" aria-pressed="${det.mode === "none"}">Без меток</button>`}
            </div>
          </div>
        </div>
        <div class="info">
          <div class="row"><span class="pill hem">${secName(p.sec)}</span><span class="pill">${esc(p.mag)}</span></div>
          <h1>${esc(p.title)}</h1>
          <dl class="kv"><dt>Орган</dt><dd>${esc(p.organ)}</dd><dt>Окраска</dt><dd>${esc(p.stain)}</dd></dl>
          <h3>Структуры на поле <span class="note" id="lgNote"></span></h3>
          <ol class="legend" id="legend"></ol>
          <h3>Как узнать препарат</h3>
          <ul class="feat">${p.keys.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
          <h3>Не перепутать</h3>
          <div class="diff">${p.diff.map(([a, b]) => `<div><b>${esc(a)}:</b> ${esc(b)}</div>`).join("")}</div>
          <div class="row" style="margin-top:22px">
            <a class="btn sm" href="${p.commons}" target="_blank" rel="noopener">${I.ext} Ещё фото в Commons</a>
            <button class="btn sm" id="toArt">${I.kb} Теория</button>
          </div>
          <div class="ask" id="askBox"></div>
        </div>
      </div>`;
    $("#back").onclick = () => go("atlas");
    $("#toArt").onclick = () => { kbState.id = artFor(p); go("kb"); };
    $$("[data-z]", app).forEach((b) => (b.onclick = () => { det.zoom = +b.dataset.z; det.revealed = {}; detailView(app, id); }));
    $$("[data-m]", app).forEach((b) => (b.onclick = () => { det.mode = b.dataset.m; det.revealed = {}; detailView(app, id); }));
    $$("[data-src]", app).forEach((b) => (b.onclick = () => { det.src = b.dataset.src; det.revealed = {}; detailView(app, id); }));
    $$("[data-pi]", app).forEach((b) => (b.onclick = () => { det.pi = +b.dataset.pi; detailView(app, id); }));
    const eye = $("#eye");
    const size = Math.min(560, eye.clientWidth || 340);
    let cv = $("#cv");
    if (usePhoto) { cv = document.createElement("canvas"); photoPan($("#pan"), $("#ph"), det.zoom); $("#ph").onerror = () => { det.src = "scheme"; detailView(app, id); }; }
    const labels = Slides.render(id, cv, { size, zoom: det.zoom });
    const lg = $("#legend");
    $("#lgNote").textContent = usePhoto ? (det.mode === "quiz" ? "· найди на фото, потом открой" : "· найди их на снимке") : det.mode === "quiz" ? "· нажми на пункт, чтобы открыть" : "";
    labels.forEach((l, i) => {
      const li = h(`<li data-i="${i}"><span class="n">${i + 1}</span><span class="t ${det.mode === "quiz" && !det.revealed[i] ? "masked" : ""}">${esc(l.t)}</span></li>`);
      lg.appendChild(li);
      if (det.mode !== "none" && !usePhoto) {
        const pin = h(`<button class="pin ${det.mode === "quiz" ? "q" : ""}" style="left:${(l.px * 100).toFixed(2)}%;top:${(l.py * 100).toFixed(2)}%" aria-label="Структура ${i + 1}">${i + 1}</button>`);
        eye.appendChild(pin);
        const on = (v) => { pin.classList.toggle("on", v); li.classList.toggle("on", v); };
        pin.onmouseenter = li.onmouseenter = () => on(true);
        pin.onmouseleave = li.onmouseleave = () => on(false);
        pin.onclick = () => li.click();
      }
      li.onclick = () => { if (det.mode === "quiz") { det.revealed[i] = true; $(".t", li).classList.remove("masked"); } };
    });
    askBox($("#askBox"), "prep:" + id, `Спросить AI о препарате`, `Спроси, например: «чем этот препарат отличается от похожего?» или «как его описать на зачёте?»`,
      () => `Препарат: ${p.title}. Орган: ${p.organ}. Окраска: ${p.stain}. Признаки: ${p.keys.join("; ")}. Структуры на поле: ${labels.map((l) => l.t).join("; ")}.`);
  }

  /* ---------- чат с AI (переиспользуемый) ---------- */
  const chats = {};
  function askBox(el, key, title, hint, ctxFn) {
    const turns = (chats[key] = chats[key] || []);
    el.innerHTML = `<h3 style="font:700 14px var(--display)">${esc(title)}</h3><p class="note" style="margin:4px 0 0">${esc(hint)}</p>
      <div class="chat" id="chat-${key.replace(/\W/g, "_")}"></div>
      <form class="row" style="flex-wrap:nowrap"><input class="input" id="q-${key.replace(/\W/g, "_")}" placeholder="Ваш вопрос" autocomplete="off"><button class="btn primary" type="submit">Спросить</button></form>
      <div class="note" data-err style="margin-top:8px"></div>`;
    const chat = $(".chat", el), form = $("form", el), inp = $("input", el), err = $("[data-err]", el);
    const draw = () => { chat.innerHTML = turns.map((t) => `<div class="msg ${t.role === "user" ? "u" : "a"}">${esc(t.content)}</div>`).join(""); };
    draw();
    if (!sample) { form.classList.add("hidden"); err.innerHTML = noAI; return; }
    form.onsubmit = async (e) => {
      e.preventDefault(); const q = inp.value.trim(); if (!q) return;
      inp.value = ""; err.textContent = ""; turns.push({ role: "user", content: q }); draw();
      const bubble = h(`<div class="msg a">Думаю…</div>`); chat.appendChild(bubble);
      const btn = $("button", form); btn.disabled = true;
      const rules = `Ты — дружелюбный преподаватель гистологии медицинского вуза (российская школа, терминология как в учебнике Афанасьева). Отвечай по-русски, коротко и по делу (до 150 слов), без markdown-заголовков. Контекст темы: ${ctxFn().slice(0, 7000)}`;
      try {
        const { text } = await sample([{ role: "user", content: rules }, ...turns.slice(-8)], { cache: false, onText: ({ text }) => { bubble.textContent = text; } });
        turns.push({ role: "assistant", content: text });
      } catch (x) { turns.pop(); bubble.remove(); err.textContent = aiErr(x); if (x && x.text) {} }
      btn.disabled = false; draw();
    };
  }

  /* ================= AI-ОПРЕДЕЛИТЕЛЬ ================= */
  const AI = { mode: "scan", file: null, url: null, demo: null, stain: "", note: "", result: null, busy: false, err: "" };
  const aiSeg = () => `<div class="seg-main" role="group" aria-label="Режим AI"><button data-am="scan" aria-pressed="${AI.mode === "scan"}">${I.scan} Скан препарата</button><button data-am="helper" aria-pressed="${AI.mode === "helper"}">${I.chat} AI-помощник</button></div>`;
  const bindSeg = (app) => $$("[data-am]", app).forEach((b) => (b.onclick = () => { AI.mode = b.dataset.am; aiView(app); }));
  function aiView(app) {
    if (AI.mode === "helper") return helperView(app);
    app.innerHTML = `
      <div class="page-h"><div><div class="eyebrow">Анализ препарата по фото</div><h1>Сними препарат — узнай, что это</h1>
      <p>Снимок с окуляра на телефон подойдёт. AI назовёт препарат, покажет признаки, по которым его узнал, с чем его легко спутать, и сразу откроет теорию.</p></div></div>
      ${aiSeg()}
      <div class="ai-grid">
        <div>
          <label class="drop" id="drop" tabindex="0">
            <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
            ${AI.url ? `<img src="${AI.url}" alt="Загруженный препарат">${AI.demo ? `<span class="pill hem">поле из атласа · название скрыто от AI</span>` : `<span class="note">Нажмите, чтобы заменить фото</span>`}` :
              `<span class="ic">${I.upload}</span><b>Перетащите фото препарата</b><span class="note">или нажмите, чтобы выбрать файл · JPEG, PNG, WebP</span>`}
          </label>
          <div class="field-row"><label for="stain">Окраска, если знаешь</label>
            <select class="input" id="stain">${["", "Гематоксилин и эозин", "Импрегнация серебром", "Орсеин", "Осмиевая кислота", "Романовский — Гимза", "Метод Ниссля", "Железный гематоксилин", "Шлиф без окраски"].map((s) => `<option ${s === AI.stain ? "selected" : ""} value="${s}">${s || "Не знаю"}</option>`).join("")}</select></div>
          <div class="field-row"><label for="note">Комментарий</label><input class="input" id="note" value="${esc(AI.note)}" placeholder="Например: орган, увеличение, что смущает"></div>
          <div class="row" style="margin-top:16px"><button class="btn primary" id="go" ${!AI.file || AI.busy || !sample ? "disabled" : ""}>${I.ai} Определить препарат</button>
          ${AI.url ? `<button class="btn" id="clear">Очистить</button>` : ""}</div>
          ${!sample ? `<div style="margin-top:14px">${noAI}</div>` : !imgOK ? `<p class="note" style="margin-top:12px;color:var(--warn)">В этом окне AI не принимает изображения. Откройте страницу в браузере claude.ai.</p>` : ""}
          <div style="margin-top:26px"><div class="eyebrow" style="color:var(--muted)">Нет фото под рукой?</div>
            <p class="note" style="margin:6px 0 10px">Проверь AI на поле из атласа: мы отправим только изображение, без названия.</p>
            <div class="demo-strip" id="demos"></div></div>
        </div>
        <div class="card" id="res"></div>
      </div>`;
    bindSeg(app);
    const inp = $("#file"), drop = $("#drop");
    const take = (f) => { if (!f) return; if (AI.url && !AI.demo) URL.revokeObjectURL(AI.url); AI.file = f; AI.url = URL.createObjectURL(f); AI.demo = null; AI.result = null; AI.err = ""; aiView(app); };
    inp.onchange = () => take(inp.files[0]);
    drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files[0]); };
    $("#stain").onchange = (e) => (AI.stain = e.target.value);
    $("#note").oninput = (e) => (AI.note = e.target.value);
    if ($("#clear")) $("#clear").onclick = () => { AI.file = AI.url = AI.demo = AI.result = null; AI.err = ""; aiView(app); };
    $("#go").onclick = () => identify(app);
    const demos = $("#demos");
    shuffle(TK.preps).slice(0, 8).forEach((p) => {
      const ph = (TK.photos[p.id] || [])[0];
      const b = h(`<button aria-label="Пример препарата">${ph ? `<img src="${TK.photoUrl(ph, 120)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : "<canvas></canvas>"}</button>`); demos.appendChild(b);
      if (!ph) paint($("canvas", b), p.id, 64);
      b.onclick = async () => {
        if (ph) {
          try {
            const blob = await (await fetch(TK.photoUrl(ph, 960))).blob();
            AI.file = blob; AI.url = URL.createObjectURL(blob); AI.demo = p.id; AI.result = null; AI.err = ""; AI.stain = ""; aiView(app); return;
          } catch (e) { /* без сети — берём схему */ }
        }
        const cv = document.createElement("canvas"); const seed = (Math.random() * 1e9) | 0;
        Slides.render(p.id, cv, { size: 560, seed, zoom: Math.random() < 0.5 ? 1 : 1.8 });
        cv.toBlob((blob) => { AI.file = blob; AI.url = cv.toDataURL("image/png"); AI.demo = p.id; AI.result = null; AI.err = ""; AI.stain = ""; aiView(app); }, "image/png");
      };
    });
    drawResult();
  }
  function drawResult() {
    const el = $("#res"); if (!el) return;
    if (AI.busy) { el.innerHTML = thinking(); return; }
    if (AI.err) { el.innerHTML = `<div class="empty"><h3>Не получилось</h3><p>${esc(AI.err)}</p></div>`; return; }
    const r = AI.result;
    if (!r) {
      el.innerHTML = `<div class="empty"><svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26" fill="var(--hem-soft)"/><circle cx="28" cy="28" r="17" fill="none" stroke="var(--hem)" stroke-width="2.5"/><circle cx="23" cy="24" r="3" fill="var(--eo)"/><circle cx="32" cy="31" r="4" fill="var(--hem)"/></svg>
        <h3>Здесь появится разбор препарата</h3><p style="max-width:44ch;margin:0 auto">Название, уверенность, окраска, признаки на фото и дифференциальный ряд. Если препарат есть в атласе — откроем его с подписями.</p></div>`;
      return;
    }
    if (r.is_histology === false) { el.innerHTML = `<div class="empty"><h3>Это не похоже на гистологический препарат</h3><p>${esc(r.caution || "Загрузите фото поля зрения микроскопа.")}</p></div>`; return; }
    const conf = Math.max(0, Math.min(100, +r.confidence || 0));
    const atlas = r.atlas_id && prepById(r.atlas_id);
    let verdict = "";
    if (AI.demo) {
      const truth = prepById(AI.demo), hit = r.atlas_id === AI.demo;
      verdict = `<div class="grade" style="margin-bottom:16px;background:${hit ? "var(--good-soft)" : "var(--bad-soft)"}"><div><b>${hit ? "AI угадал." : "AI ошибся."}</b> На самом деле: ${esc(truth.title)}.</div></div>`;
    }
    el.innerHTML = `<div class="result">${verdict}
      <div class="row"><span class="pill hem">${esc(r.tissue_group || "")}</span>${r.stain ? `<span class="pill eo">${esc(r.stain)}</span>` : ""}${r.magnification ? `<span class="pill">${esc(r.magnification)}</span>` : ""}</div>
      <h2>${esc(r.prep_title || "Препарат не определён")}</h2>
      <div class="conf" aria-hidden="true"><i style="width:${conf}%"></i></div>
      <div class="note mono">Уверенность ${conf}%</div>
      ${Array.isArray(r.features) && r.features.length ? `<h3 style="font:700 13.5px var(--display);margin:22px 0 10px">Что видно на фото</h3><ul class="feat">${r.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${Array.isArray(r.alternatives) && r.alternatives.length ? `<h3 style="font:700 13.5px var(--display);margin:22px 0 10px">С чем можно спутать</h3><div class="diff">${r.alternatives.map((a) => `<div><b>${esc(a.title)}:</b> ${esc(a.why_not)}</div>`).join("")}</div>` : ""}
      ${r.tip ? `<h3 style="font:700 13.5px var(--display);margin:22px 0 10px">Как ответить на зачёте</h3><p style="margin:0">${esc(r.tip)}</p>` : ""}
      ${r.caution ? `<p class="note" style="margin-top:14px">${esc(r.caution)}</p>` : ""}
      ${atlas ? `<div class="row" style="margin-top:20px"><button class="btn primary" id="openAtlas">${I.atlas} Открыть в атласе с подписями</button><button class="btn" id="openTheory">${I.kb} Теория по этой ткани</button></div>` : ""}
      <p class="note" style="margin-top:18px">AI может ошибаться — сверяйтесь с атласом и учебником.</p></div>`;
    if (atlas) { $("#openAtlas").onclick = () => { det = { zoom: 1, mode: "show", revealed: {} }; go("atlas", atlas.id); }; $("#openTheory").onclick = () => { kbState.id = artFor(atlas); go("kb"); }; }
  }
  async function identify(app) {
    if (!sample || !AI.file) return;
    AI.busy = true; AI.err = ""; AI.result = null; $("#go").disabled = true; drawResult();
    const list = TK.preps.map((p) => `${p.id} — ${p.title} (${p.organ}; ${p.stain})`).join("\n");
    const prompt = `Ты — опытный преподаватель гистологии медицинского вуза (российская школа, учебник Афанасьева и Юриной). Студент прислал изображение гистологического препарата (фото с микроскопа или схематичное изображение поля зрения). Определи препарат.
Курс — общая гистология: эпителиальные ткани, кровь, соединительные ткани, хрящ и кость, мышечные ткани, нервная ткань.
Препараты атласа (id — название):
${list}
Подсказки студента — окраска: ${AI.stain || "не указана"}; комментарий: ${AI.note || "нет"}.
Ответь ТОЛЬКО JSON-объектом:
{"is_histology": true, "prep_title": "полное название препарата, как на зачёте", "tissue_group": "группа тканей", "atlas_id": "id из списка выше или null", "confidence": 0-100, "stain": "вероятная окраска", "magnification": "малое / большое / иммерсия", "features": ["3–5 признаков, которые реально видны на изображении"], "alternatives": [{"title": "похожий препарат", "why_not": "почему это не он"}], "tip": "как назвать препарат и что показать преподавателю, 1–2 предложения", "caution": "что мешает уверенному ответу, или пустая строка"}
Пиши по-русски. Если на изображении нет гистологического препарата — is_histology: false и объяснение в caution.`;
    try {
      AI.result = await sample.json(prompt, { images: AI.file });
    } catch (e) { AI.err = aiErr(e); }
    AI.busy = false;
    if (view.tab === "ai") { drawResult(); const g = $("#go"); if (g) g.disabled = false; }
  }

  /* ---------- AI-помощник: чат + карточки ---------- */
  const H = { sec: "epi", cards: null, flip: {}, busy: false, err: "" };
  function helperView(app) {
    app.innerHTML = `
      <div class="page-h"><div><div class="eyebrow">AI-помощник</div><h1>Спроси про любую ткань</h1>
      <p>Отвечает на вопросы по общей гистологии, собирает карточки для повторения и подсказывает, где это в атласе.</p></div></div>
      ${aiSeg()}
      <div class="ai-grid">
        <div class="card" style="padding:18px">
          <div class="field-row" style="margin-top:0"><label for="hsec">Тема</label><select class="input" id="hsec">${TK.sections.map((x) => `<option value="${x.id}" ${x.id === H.sec ? "selected" : ""}>${x.name}</option>`).join("")}</select></div>
          <div class="row" style="margin-top:14px"><button class="btn primary" id="mkCards" ${!sample || H.busy ? "disabled" : ""}>${I.ai} Составь 5 карточек</button></div>
          <div id="cards" style="margin-top:16px"></div>
          ${!sample ? `<div style="margin-top:14px">${noAI}</div>` : ""}
        </div>
        <div class="card ask" style="margin:0;background:var(--surface)" id="helpChat"></div>
      </div>`;
    bindSeg(app);
    $("#hsec").onchange = (e) => { H.sec = e.target.value; H.cards = null; H.flip = {}; helperView(app); };
    const drawCards = () => {
      const el = $("#cards"); if (!el) return;
      if (H.busy) { el.innerHTML = thinking("Составляю карточки…"); return; }
      if (H.err) { el.innerHTML = `<p class="note" style="color:var(--bad)">${esc(H.err)}</p>`; return; }
      if (!H.cards) { el.innerHTML = `<p class="note">Карточка: вопрос на лицевой стороне, ответ — по нажатию. Удобно гонять перед коллоквиумом.</p>`; return; }
      el.innerHTML = `<div style="display:grid;gap:10px">${H.cards.map((c, i) => `<button class="fcard ${H.flip[i] ? "back" : ""}" data-fc="${i}"><span>${esc(H.flip[i] ? c.a : c.q)}</span></button>`).join("")}</div><p class="note" style="margin-top:8px">Нажми на карточку, чтобы перевернуть.</p>`;
      $$("[data-fc]", el).forEach((b) => (b.onclick = () => { H.flip[b.dataset.fc] = !H.flip[b.dataset.fc]; drawCards(); }));
    };
    drawCards();
    $("#mkCards").onclick = async () => {
      H.busy = true; H.err = ""; H.cards = null; H.flip = {}; $("#mkCards").disabled = true; drawCards();
      const B = TK.blocks[H.sec], art = TK.articles.find((a) => a.id === TK.mainArticle[H.sec]);
      const prompt = `Составь 5 карточек для повторения по теме «${secName(H.sec)}» (общая гистология, российский медвуз). Вопросы разные: определение, классификация, строение, отличия препаратов, функции. Ответ на карточке — 1–2 предложения.
Материал: ${B.def} ${B.feat} ${B.cls} ${B.fn} ${strip(art.body).slice(0, 5000)}
Ответь ТОЛЬКО JSON-массивом: [{"q": "вопрос", "a": "ответ"}]`;
      try { const r = await sample.json(prompt, { cache: false }); H.cards = (Array.isArray(r) ? r : []).filter((c) => c && c.q && c.a).slice(0, 5); if (!H.cards.length) H.err = "AI не прислал карточки — попробуйте ещё раз."; }
      catch (e) { H.err = aiErr(e); }
      H.busy = false; if (view.tab === "ai" && AI.mode === "helper") { drawCards(); const b = $("#mkCards"); if (b) b.disabled = false; }
    };
    askBox($("#helpChat"), "helper", "Вопрос по гистологии", "Например: «Чем призматический эпителий отличается от кубического?»", () =>
      TK.sections.map((x) => `${x.name}: ${TK.blocks[x.id].def} ${TK.blocks[x.id].cls}`).join(" ") + " Препараты атласа: " + TK.preps.map((p) => p.title).join("; ") + ". Если вопрос касается препарата из атласа, предложи открыть его во вкладке «Атлас».");
  }

  /* ================= ГЛАВНАЯ ================= */
  const heroSeed = (Math.random() * 1e9) | 0, heroPrep = TK.preps[Math.floor(Math.random() * TK.preps.length)];
  function homeView(app) {
    const hour = new Date().getHours(), hi = hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
    const L = P.last; let cont = null;
    if (L && L.tab === "atlas" && prepById(L.sub)) { const p = prepById(L.sub); cont = { t: p.title, s: "Атлас · " + secName(p.sec), prep: p.id, go: () => go("atlas", p.id) }; }
    else if (L && L.tab === "kb") { const a = TK.articles.find((x) => x.id === L.art); if (a) cont = { t: a.title, s: "Теория · " + (a.sec ? secName(a.sec) : "Введение"), go: () => { kbState.id = a.id; go("kb"); } }; }
    const topicPct = (sec) => {
      const c = TK.colloquia.find((x) => x.sec === sec), ps = TK.preps.filter((p) => p.sec === sec);
      const parts = [knownCount(c) / c.oral.length, (P.tests[c.id] || 0) / 100, ps.filter((p) => P.seen[p.id]).length / ps.length];
      return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
    };
    app.innerHTML = `
      <section class="hero">
        <div><div class="eyebrow">${hi}</div><h1>Тканика<span style="color:var(--hem)">.</span><br>Архитектура живого</h1>
          <p>Гистология — это язык, на котором говорит тело. Атлас препаратов, теория по блокам, тесты с разбором ошибок и AI, который узнаёт препарат по фото.</p>
          ${cont ? `<button class="card cont" id="cont">${cont.prep ? `<canvas id="contCv"></canvas>` : `<span class="ic" style="width:64px;height:64px;border-radius:50%;background:var(--hem-soft);color:var(--hem);display:grid;place-items:center;flex-shrink:0">${I.kb}</span>`}<span><span class="eyebrow">Продолжить обучение</span><b style="display:block;margin-top:6px">${esc(cont.t)}</b><span class="note">${esc(cont.s)}</span></span></button>` :
            `<div class="row" style="margin-top:20px"><button class="btn primary" id="start">${I.kb} Начать с теории</button><button class="btn" id="toAtlas">${I.atlas} Открыть атлас</button></div>`}
        </div>
        <div class="eyepiece" aria-hidden="true"><canvas id="heroCv"></canvas></div>
      </section>
      <div class="quick">
        <button class="qa" id="qScan"><b>Скан препарата</b><span>Фото с микроскопа → название, признаки, теория</span></button>
        <button class="qa" id="qPrep"><b>Зачёт по препаратам</b><span>10 полей без подписей · рекорд ${P.prepBest || 0}/10</span></button>
        <button class="qa alt" id="qExam"><b>AI-экзаменатор</b><span>Тяни билет, отвечай — получи оценку</span></button>
        <button class="qa alt" id="qMist"><b>Работа над ошибками</b><span>${mistakeCount()} ${plural(mistakeCount(), "вопрос", "вопроса", "вопросов")} к повторению</span></button>
      </div>
      <div class="sec-h" style="margin-bottom:12px"><h2>Прогресс по темам</h2><span class="note">вопросы · тесты · препараты</span></div>
      <div class="topics">${TK.sections.map((x) => { const v = topicPct(x.id); return `<button class="card topic" data-sec="${x.id}"><b>${x.name}</b><span class="mono note">${v}%</span><div class="bar"><i style="width:${v}%"></i></div></button>`; }).join("")}</div>`;
    paint($("#heroCv"), heroPrep.id, 300, { seed: heroSeed });
    if (cont) { $("#cont").onclick = cont.go; if (cont.prep) paint($("#contCv"), cont.prep, 64); }
    else { $("#start").onclick = () => { kbState.id = "intro"; go("kb"); }; $("#toAtlas").onclick = () => go("atlas"); }
    $("#qScan").onclick = () => { AI.mode = "scan"; go("ai"); };
    $("#qPrep").onclick = () => go("coll", { mode: "prep", i: 0, score: 0, items: makePrepQuiz() });
    $("#qExam").onclick = () => go("coll", { mode: "exam", cid: null });
    $("#qMist").onclick = () => go("coll", { mode: "test", cid: null, i: 0, score: 0 });
    $$("[data-sec]", app).forEach((b) => (b.onclick = () => { kbState.id = TK.mainArticle[b.dataset.sec]; go("kb"); }));
  }

  /* ================= БАЗА ЗНАНИЙ ================= */
  const kbState = { id: "intro", q: "" }, consp = {};
  const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  function kbView(app) {
    const a = TK.articles.find((x) => x.id === kbState.id) || TK.articles[0];
    app.innerHTML = `
      <div class="page-h"><div><div class="eyebrow">База знаний</div><h1>Теория к коллоквиумам</h1><p>Конспекты по разделам общей гистологии: классификации, строение, функции и ловушки, на которых чаще всего ошибаются.</p></div></div>
      <div class="kb">
        <aside class="card toc"><div class="search">${I.search}<input class="input" id="kbq" placeholder="Поиск: остеон, десмосома…" value="${esc(kbState.q)}"></div><div id="tocList"></div></aside>
        <article class="card article" id="art"></article>
      </div>`;
    const drawToc = () => {
      const q = kbState.q.toLowerCase();
      const match = (x) => !q || (x.title + " " + x.lead + " " + strip(x.body)).toLowerCase().includes(q);
      const groups = [{ id: null, name: "Введение" }, ...TK.sections];
      $("#tocList").innerHTML = groups.map((g) => { const items = TK.articles.filter((x) => x.sec === g.id && match(x)); if (!items.length) return "";
        return `<div class="grp">${g.name}</div>` + items.map((x) => `<button data-a="${x.id}" aria-current="${x.id === a.id}">${esc(x.title)}</button>`).join(""); }).join("") || `<p class="note" style="padding:10px">Ничего не найдено.</p>`;
      $$("[data-a]", app).forEach((b) => (b.onclick = () => { kbState.id = b.dataset.a; kbView(app); if (innerWidth < 940) $("#art").scrollIntoView({ behavior: "smooth" }); }));
    };
    drawToc();
    $("#kbq").oninput = (e) => { kbState.q = e.target.value; drawToc(); };
    const preps = TK.preps.filter((p) => (a.sec && p.sec === a.sec));
    P.last = { tab: "kb", art: a.id }; save();
    const B = a.sec && TK.mainArticle[a.sec] === a.id ? TK.blocks[a.sec] : null;
    $("#art").innerHTML = `<div class="eyebrow">${a.sec ? secName(a.sec) : "Введение"}</div><h1>${esc(a.title)}</h1><p class="lead">${esc(a.lead)}</p>
      ${B ? `<div class="blocks">${[["Определение", B.def], ["Особенности", B.feat], ["Классификация", B.cls], ["Функции", B.fn]].map(([t, x]) => `<div class="blk"><b>${t}</b>${esc(x)}</div>`).join("")}</div>` : ""}
      <div class="row" style="margin:14px 0 6px"><button class="btn sm primary" id="consp">${I.ai} AI-конспект</button><span class="note">сжатая шпаргалка к коллоквиуму${downloads ? ", можно скачать" : ""}</span></div>
      <div id="conspOut"></div>
      <div class="prose">${a.body}</div>
      ${preps.length ? `<h3 style="font:700 14px var(--display);margin:30px 0 4px">Препараты по теме</h3><div class="links-row">${preps.map((p) => `<button class="chip" data-p="${p.id}">${esc(p.title)}</button>`).join("")}</div>` : ""}
      <div class="ask" id="askKB"></div>`;
    $$("#art [data-p]").forEach((b) => (b.onclick = () => go("atlas", b.dataset.p)));
    const out = $("#conspOut"), cb = $("#consp");
    const showConsp = () => {
      const t = consp[a.id]; if (!t) return;
      out.innerHTML = `<div class="card" style="padding:18px;margin:10px 0 20px;background:var(--surface2);border:0"><div class="eyebrow" style="margin-bottom:10px">AI-конспект</div><div class="md" style="white-space:pre-wrap;line-height:1.6">${esc(t)}</div>
        ${downloads ? `<div class="row" style="margin-top:12px"><button class="btn sm" id="dlc">${I.dl} Скачать конспект</button><span class="note" id="dln"></span></div>` : ""}</div>`;
      if ($("#dlc")) $("#dlc").onclick = async () => {
        try { await downloads.save({ filename: `Тканика — ${a.title}.md`, data: `# ${a.title}\n\n${t}\n` }); $("#dln").textContent = "Готово"; }
        catch (e) { $("#dln").textContent = "Файл не сохранён"; }
      };
    };
    showConsp();
    if (!sample) { cb.disabled = true; cb.title = "AI доступен при открытии в Claude"; }
    cb.onclick = async () => {
      cb.disabled = true; out.innerHTML = thinking("Собираю конспект…");
      const prompt = `Составь краткий конспект-шпаргалку для подготовки к коллоквиуму по гистологии на тему «${a.title}». Опирайся на материал ниже, терминология российских учебников. Формат: простой текст, 8–12 строк, каждая строка начинается с «• », без заголовков и markdown-разметки, в конце строка «Запомни: …» с одним мнемоническим приёмом.\n\nМатериал: ${(a.lead + " " + strip(a.body)).slice(0, 7000)}`;
      try { const { text } = await sample(prompt, { onText: ({ text }) => { consp[a.id] = text; showConsp(); } }); consp[a.id] = text; showConsp(); }
      catch (e) { out.innerHTML = `<p class="note" style="color:var(--bad)">${esc(aiErr(e))}</p>`; }
      cb.disabled = false;
    };
    askBox($("#askKB"), "kb:" + a.id, "Не понятно? Спроси AI", "Например: «объясни саркомер на пальцах» или «как запомнить слои эпидермиса».", () => a.title + ". " + a.lead + " " + strip(a.body));
  }

  /* ================= КОЛЛОКВИУМЫ ================= */
  const mistakeCount = () => Object.values(P.mistakes || {}).filter(Boolean).length;
  const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
  const knownCount = (c) => c.oral.filter((_, i) => P.known[c.id + "#" + i]).length;
  function collView(app) {
    const s = view.sub;
    if (s && s.mode === "flash") return flashView(app, s);
    if (s && s.mode === "test") return testView(app, s);
    if (s && s.mode === "exam") return examView(app, s);
    if (s && s.mode === "prep") return prepQuizView(app, s);
    const totalQ = TK.colloquia.reduce((n, c) => n + c.oral.length, 0), known = TK.colloquia.reduce((n, c) => n + knownCount(c), 0);
    const tests = TK.colloquia.map((c) => P.tests[c.id]).filter((v) => v != null);
    app.innerHTML = `
      <div class="page-h"><div><div class="eyebrow">Коллоквиумы</div><h1>Тесты и коллоквиумы</h1><p>Устные вопросы с эталонными ответами, тесты, зачёт по препаратам и AI-экзаменатор, который оценит твой ответ по пятибалльной шкале.</p></div></div>
      <div class="stats">
        <div class="card stat"><b>${known}/${totalQ}</b><span>вопросов знаю</span></div>
        <div class="card stat"><b>${tests.length ? Math.round(tests.reduce((a, b) => a + b, 0) / tests.length) + "%" : "—"}</b><span>средний лучший тест</span></div>
        <div class="card stat"><b>${Object.keys(P.seen).length}/${TK.preps.length}</b><span>препаратов изучено</span></div>
        <div class="card stat"><b>${P.prepBest || 0}/10</b><span>рекорд зачёта по препаратам</span></div>
      </div>
      <div class="coll-grid">
        <div class="card coll special"><span class="eyebrow">Все разделы</span><h3>Зачёт по препаратам</h3><p class="note" style="margin:0">10 полей зрения без подписей. Узнай препарат из четырёх вариантов.</p><div class="row"><button class="btn primary" id="prepQ">Начать зачёт</button></div></div>
        <div class="card coll special"><span class="eyebrow">AI</span><h3>AI-экзаменатор</h3><p class="note" style="margin:0">Случайный вопрос из любого коллоквиума. Отвечаешь своими словами — AI ставит оценку и говорит, чего не хватило.</p><div class="row"><button class="btn primary" id="examAll">Тянуть билет</button></div></div>
        <div class="card coll special"><span class="eyebrow">Прогресс</span><h3>Работа над ошибками</h3><p class="note" style="margin:0">${mistakeCount()} ${plural(mistakeCount(), "вопрос", "вопроса", "вопросов")} из тестов, где ты ошибся. Верный ответ убирает вопрос из списка.</p><div class="row"><button class="btn primary" id="mist" ${mistakeCount() ? "" : "disabled"}>Повторить ошибки</button></div></div>
        ${TK.colloquia.map((c) => `
          <div class="card coll"><span class="eyebrow" style="color:var(--muted)">${c.oral.length} вопросов · ${c.test.length} тестов</span><h3>${c.title}</h3>
            <div class="bar" title="Знаю ${knownCount(c)} из ${c.oral.length}"><i style="width:${(knownCount(c) / c.oral.length) * 100}%"></i></div>
            <div class="note">Знаю ${knownCount(c)} из ${c.oral.length}${P.tests[c.id] != null ? ` · тест ${P.tests[c.id]}%` : ""}</div>
            <div class="row"><button class="btn sm" data-c="${c.id}" data-m="flash">Вопросы</button><button class="btn sm" data-c="${c.id}" data-m="test">Тест</button><button class="btn sm" data-c="${c.id}" data-m="exam">AI-экзамен</button></div>
          </div>`).join("")}
      </div>`;
    $("#prepQ").onclick = () => go("coll", { mode: "prep", i: 0, score: 0, items: makePrepQuiz() });
    $("#examAll").onclick = () => go("coll", { mode: "exam", cid: null });
    $("#mist").onclick = () => go("coll", { mode: "test", cid: null, i: 0, score: 0 });
    $$("[data-c]", app).forEach((b) => (b.onclick = () => go("coll", { mode: b.dataset.m, cid: b.dataset.c, i: 0, score: 0, show: false })));
  }
  const backToColl = () => `<button class="back" data-back>${I.back} Все коллоквиумы</button>`;
  const bindBack = (app) => $$("[data-back]", app).forEach((b) => (b.onclick = () => go("coll")));

  function flashView(app, s) {
    const c = TK.colloquia.find((x) => x.id === s.cid), [q, a] = c.oral[s.i];
    app.innerHTML = `<div class="flash">${backToColl()}
      <div class="progress-line"><span>${c.title}</span><span>${s.i + 1} / ${c.oral.length}</span></div>
      <div class="card qcard"><span class="eyebrow">Вопрос ${s.i + 1}</span><p class="q">${esc(q)}</p>
        ${s.show ? `<div class="a">${esc(a)}</div>` : `<p class="note">Сначала ответь вслух или про себя, потом открой эталон.</p>`}
        <div class="row" style="margin-top:auto">${s.show ? `<button class="btn primary" data-k="1">Знаю</button><button class="btn" data-k="0">Повторить</button>` : `<button class="btn primary" id="show">Показать ответ</button>`}
        <button class="btn" id="ex">${I.ai} Ответить AI-экзаменатору</button></div>
      </div></div>`;
    bindBack(app);
    if ($("#show")) $("#show").onclick = () => { s.show = true; flashView(app, s); };
    $$("[data-k]", app).forEach((b) => (b.onclick = () => { P.known[c.id + "#" + s.i] = b.dataset.k === "1"; save(); if (s.i + 1 < c.oral.length) { s.i++; s.show = false; flashView(app, s); } else go("coll"); }));
    $("#ex").onclick = () => go("coll", { mode: "exam", cid: c.id, fixed: s.i });
  }

  function testView(app, s) {
    const c = s.cid ? TK.colloquia.find((x) => x.id === s.cid) : null;
    const title = c ? c.title : "Работа над ошибками";
    if (!s.items) s.items = c ? shuffle(c.test.map((_, i) => [c.id, i])) : shuffle(Object.keys(P.mistakes).filter((k) => P.mistakes[k]).map((k) => { const [cid, i] = k.split("#"); return [cid, +i]; }));
    if (!s.items.length) { app.innerHTML = `<div class="flash">${backToColl()}<div class="card qcard" style="align-items:center;text-align:center"><div class="score">0</div><p class="muted">Ошибок для повторения нет. Пройди тесты по коллоквиумам — неверные ответы попадут сюда.</p></div></div>`; bindBack(app); return; }
    if (s.i >= s.items.length) {
      const pct = Math.round((s.score / s.items.length) * 100);
      if (c) { P.tests[c.id] = Math.max(P.tests[c.id] ?? 0, pct); save(); }
      app.innerHTML = `<div class="flash">${backToColl()}<div class="card qcard" style="align-items:center;text-align:center"><span class="eyebrow">${esc(title)}</span><div class="score">${s.score}/${s.items.length}</div><p class="muted">${pct >= 85 ? "Отлично — можно идти на коллоквиум." : pct >= 60 ? "Неплохо. Ошибки сохранены — вернись к ним в «Работе над ошибками»." : "Стоит перечитать теорию и пройти ещё раз."}</p><div class="row"><button class="btn primary" id="again">Ещё раз</button>${c ? `<button class="btn" id="kb">Теория</button>` : ""}</div></div></div>`;
      bindBack(app); $("#again").onclick = () => go("coll", { mode: "test", cid: s.cid, i: 0, score: 0 });
      if ($("#kb")) $("#kb").onclick = () => { kbState.id = TK.mainArticle[c.sec] || "intro"; go("kb"); };
      return;
    }
    const [cid, qi] = s.items[s.i], cc = TK.colloquia.find((x) => x.id === cid), [q, opts, ans, why] = cc.test[qi], key = cid + "#" + qi;
    app.innerHTML = `<div class="flash">${backToColl()}
      <div class="progress-line"><span>${esc(title)}</span><span>${s.i + 1} / ${s.items.length} · верно ${s.score}</span></div>
      <div class="card qcard"><p class="q">${esc(q)}</p><div class="opts">${opts.map((o, i) => `<button class="opt" data-o="${i}"><span class="k">${"АБВГ"[i]}</span><span>${esc(o)}</span></button>`).join("")}</div><div id="fb"></div></div></div>`;
    bindBack(app);
    $$("[data-o]", app).forEach((b) => (b.onclick = () => {
      const pick = +b.dataset.o; $$("[data-o]", app).forEach((x) => { x.disabled = true; if (+x.dataset.o === ans) x.classList.add("ok"); });
      const right = pick === ans;
      if (right) { s.score++; delete P.mistakes[key]; } else { b.classList.add("no"); P.mistakes[key] = 1; }
      save();
      $("#fb").innerHTML = `<p class="note" style="margin:4px 0 12px">${esc(why)}</p><div id="expl"></div><div class="row"><button class="btn primary" id="nx">${s.i + 1 < s.items.length ? "Дальше" : "Результат"}</button>${!right && sample ? `<button class="btn" id="why">${I.ai} Объясни ошибку</button>` : ""}</div>`;
      $("#nx").onclick = () => { s.i++; testView(app, s); }; $("#nx").focus();
      if ($("#why")) $("#why").onclick = async () => {
        const w = $("#why"); w.disabled = true; const ex = $("#expl"); ex.innerHTML = thinking("Разбираю ошибку…");
        const prompt = `Ты — преподаватель гистологии. Студент ответил на тестовый вопрос неправильно. Вопрос: «${q}». Варианты: ${opts.map((o, i) => "АБВГ"[i] + ") " + o).join("; ")}. Студент выбрал: «${opts[pick]}». Правильно: «${opts[ans]}». Объясни по-русски, обращаясь на «ты», в 3–4 предложениях: почему выбранный вариант неверен, почему верен правильный, и дай короткий приём, как запомнить. Без markdown.`;
        try { await sample(prompt, { onText: ({ text }) => { ex.innerHTML = `<div class="a" style="margin-bottom:12px">${esc(text)}</div>`; } }); }
        catch (e) { ex.innerHTML = `<p class="note" style="color:var(--bad)">${esc(aiErr(e))}</p>`; w.disabled = false; }
      };
    }));
  }

  function makePrepQuiz() {
    return shuffle(TK.preps).slice(0, 10).map((p) => {
      const same = shuffle(TK.preps.filter((x) => x.id !== p.id && x.sec === p.sec)), other = shuffle(TK.preps.filter((x) => x.id !== p.id && x.sec !== p.sec));
      const opts = shuffle([p, ...same.slice(0, 2), ...other].slice(0, 4));
      const ph = TK.photos[p.id] || [];
      return { id: p.id, opts: opts.map((o) => o.id), seed: (Math.random() * 1e9) | 0, zoom: Math.random() < 0.6 ? 1 : 1.8, photo: ph.length && Math.random() < 0.65 ? (Math.random() * ph.length) | 0 : -1 };
    });
  }
  function prepQuizView(app, s) {
    if (s.i >= s.items.length) {
      P.prepBest = Math.max(P.prepBest || 0, s.score); save();
      app.innerHTML = `<div class="flash">${backToColl()}<div class="card qcard" style="align-items:center;text-align:center"><span class="eyebrow">Зачёт по препаратам</span><div class="score">${s.score}/10</div><p class="muted">${s.score >= 9 ? "Зачёт." : s.score >= 7 ? "Почти — пересмотри препараты с ошибками в атласе." : "Пройди атлас в режиме самопроверки и попробуй снова."}</p><div class="row"><button class="btn primary" id="again">Новый зачёт</button><button class="btn" id="atl">В атлас</button></div></div></div>`;
      bindBack(app); $("#again").onclick = () => go("coll", { mode: "prep", i: 0, score: 0, items: makePrepQuiz() }); $("#atl").onclick = () => go("atlas");
      return;
    }
    const it = s.items[s.i], truth = prepById(it.id);
    app.innerHTML = `<div class="flash">${backToColl()}
      <div class="progress-line"><span>Зачёт по препаратам</span><span>${s.i + 1} / 10 · верно ${s.score}</span></div>
      <div class="card qcard"><div class="quiz-field eyepiece" style="max-width:340px">${it.photo >= 0 ? `<div class="photo-pan"><img id="qph" src="${TK.photoUrl(TK.photos[it.id][it.photo], 500)}" alt="Препарат для определения"></div>` : `<canvas id="qcv" role="img" aria-label="Препарат для определения"></canvas>`}</div>
      <p class="note" style="text-align:center;margin:-6px 0 0">${it.photo >= 0 ? "Реальный снимок" : "Схема поля зрения"}</p>
      <p class="q" style="text-align:center">Какой это препарат?</p>
      <div class="opts">${it.opts.map((id, i) => `<button class="opt" data-o="${id}"><span class="k">${"АБВГ"[i]}</span><span>${esc(prepById(id).title)}</span></button>`).join("")}</div><div id="fb"></div></div></div>`;
    bindBack(app);
    if ($("#qcv")) Slides.render(it.id, $("#qcv"), { size: Math.min(340, $("#qcv").parentElement.clientWidth || 300), seed: it.seed, zoom: it.zoom });
    else $("#qph").onerror = () => { it.photo = -1; prepQuizView(app, s); };
    $$("[data-o]", app).forEach((b) => (b.onclick = () => {
      $$("[data-o]", app).forEach((x) => { x.disabled = true; if (x.dataset.o === it.id) x.classList.add("ok"); });
      if (b.dataset.o === it.id) s.score++; else b.classList.add("no");
      $("#fb").innerHTML = `<p class="note" style="margin:4px 0 12px"><b>${esc(truth.title)}.</b> ${esc(truth.keys.slice(0, 2).join(". "))}.</p><button class="btn primary" id="nx">${s.i + 1 < 10 ? "Следующий препарат" : "Результат"}</button>`;
      $("#nx").onclick = () => { s.i++; prepQuizView(app, s); }; $("#nx").focus();
    }));
  }

  function examView(app, s) {
    if (!s.q) {
      const pool = [];
      TK.colloquia.forEach((c) => { if (!s.cid || c.id === s.cid) c.oral.forEach((qa, i) => pool.push({ c, i, qa })); });
      s.q = s.fixed != null ? pool.find((x) => x.i === s.fixed) : pool[Math.floor(Math.random() * pool.length)];
      s.answer = ""; s.grade = null; s.err = "";
    }
    const { c, qa } = s.q;
    app.innerHTML = `<div class="flash">${backToColl()}
      <div class="progress-line"><span>AI-экзаменатор · ${c.title}</span><span>${P.exams || 0} ответов сдано</span></div>
      <div class="card qcard"><span class="eyebrow">Билет</span><p class="q">${esc(qa[0])}</p>
        ${!sample ? noAI : `
        <textarea class="input" id="ans" placeholder="Отвечай как на коллоквиуме: определение, классификация, строение, функции">${esc(s.answer)}</textarea>
        <div class="row"><button class="btn primary" id="check" ${s.busy ? "disabled" : ""}>${I.ai} Сдать ответ</button><button class="btn" id="nextQ">Другой билет</button></div>`}
        <div id="gr"></div>
      </div></div>`;
    bindBack(app);
    const gr = $("#gr");
    const drawGrade = () => {
      if (s.busy) { gr.innerHTML = thinking("Экзаменатор читает ответ…"); return; }
      if (s.err) { gr.innerHTML = `<p class="note" style="color:var(--bad)">${esc(s.err)}</p>`; return; }
      const g = s.grade; if (!g) return;
      const sc = Math.max(2, Math.min(5, Math.round(+g.score || 2))), col = sc >= 5 ? "good" : sc >= 4 ? "hem" : sc >= 3 ? "warn" : "bad";
      const list = (t, a) => Array.isArray(a) && a.length ? `<h3 style="font:700 13px var(--display);margin:16px 0 8px">${t}</h3><ul class="feat">${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
      gr.innerHTML = `<div class="grade" style="background:var(--${col}-soft)"><div class="g" style="color:var(--${col})">${sc}</div><div>${esc(g.verdict || "")}</div></div>
        ${list("Что было хорошо", g.good)}${list("Чего не хватило", g.missing)}${list("Ошибки", g.errors)}
        <details style="margin-top:14px"><summary style="cursor:pointer;font-weight:600">Эталонный ответ</summary><div class="a" style="margin-top:10px">${esc(qa[1])}</div></details>`;
    };
    drawGrade();
    if (!sample) return;
    $("#ans").oninput = (e) => (s.answer = e.target.value);
    $("#nextQ").onclick = () => go("coll", { mode: "exam", cid: s.cid });
    $("#check").onclick = async () => {
      if (!s.answer.trim()) { s.err = "Сначала напишите ответ."; drawGrade(); s.err = ""; return; }
      s.busy = true; s.grade = null; $("#check").disabled = true; drawGrade();
      const prompt = `Ты — строгий, но доброжелательный экзаменатор по гистологии в российском медицинском вузе. Оцени устный ответ студента на вопрос коллоквиума по пятибалльной шкале (2 — неудовлетворительно, 3, 4, 5 — отлично).
Вопрос: ${qa[0]}
Опорные пункты эталонного ответа: ${qa[1]}
Ответ студента: """${s.answer.slice(0, 4000)}"""
Оценивай по сути, а не по совпадению слов; фактические ошибки снижают оценку сильнее, чем неполнота. Не выдумывай того, чего нет в ответе.
Ответь ТОЛЬКО JSON: {"score": 2-5, "verdict": "одно-два предложения с общей оценкой, обращаясь к студенту на «ты»", "good": ["что сказано верно"], "missing": ["каких важных пунктов не хватило"], "errors": ["фактические ошибки, если есть"]}`;
      try { s.grade = await sample.json(prompt, { cache: false }); P.exams = (P.exams || 0) + 1; save(); }
      catch (e) { s.err = aiErr(e); }
      s.busy = false;
      if (view.sub === s) { drawGrade(); const b = $("#check"); if (b) b.disabled = false; if (s.err) s.err = ""; }
    };
  }

  /* ---------- главный рендер ---------- */
  function render() {
    renderNav();
    const app = $("#app");
    if (view.tab === "atlas") view.sub ? detailView(app, view.sub) : atlasView(app);
    else if (view.tab === "home") homeView(app);
    else if (view.tab === "ai") aiView(app);
    else if (view.tab === "kb") kbView(app);
    else collView(app);
  }
  let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { if (view.tab === "atlas" && view.sub) render(); }, 250); });
  render();
})();
