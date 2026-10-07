/* Тканика — локальный ИИ: работает прямо в браузере, без Claude и без ключа.
   • Скан препарата: модель DINOv2-small (transformers.js, ~23 МБ, кэшируется браузером) превращает
     снимок в вектор и сравнивает его с заранее посчитанными векторами микрофото атласа (embeddings.json).
   • Помощник, конспект, разбор ошибки: поиск по теории, вопросам коллоквиумов и препаратам (BM25).
   • Экзаменатор и карточки: сверка с эталонными ответами коллоквиумов.
   Интерфейс совпадает с window.claude.use("sample"), поэтому app.js работает с ним так же, как с Claude.
   Какую задачу решать, app.js сообщает через opt.task. */
(function () {
  "use strict";
  const TF_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";
  const MODEL = window.TK_MODEL || "Xenova/dinov2-small";
  const TK = () => window.TK;

  /* ================= изображения ================= */
  let modelP = null, indexP = null;
  const listeners = new Set();
  const progress = (p) => listeners.forEach((f) => { try { f(p); } catch (e) {} });

  function loadModel() {
    if (!modelP) {
      modelP = (async () => {
        const T = await import(TF_URL);
        T.env.allowLocalModels = false;
        const files = {};
        const cb = (e) => {
          if (e.status === "progress" && e.total) { files[e.file] = [e.loaded, e.total]; const v = Object.values(files); progress({ loaded: v.reduce((a, x) => a + x[0], 0), total: v.reduce((a, x) => a + x[1], 0) }); }
        };
        const processor = await T.AutoProcessor.from_pretrained(MODEL, { progress_callback: cb });
        const model = await T.AutoModel.from_pretrained(MODEL, { dtype: "q8", progress_callback: cb });
        progress({ done: true });
        return { T, processor, model };
      })();
      modelP.catch(() => { modelP = null; });
    }
    return modelP;
  }

  function norm(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); }

  /* цветовой профиль окраски: гистограмма тон × насыщенность, корень из долей (расстояние Хеллингера) */
  async function stainHist(img) {
    const px = (await img.resize(64, 64)).rgb().data, h = new Array(48).fill(0);
    for (let i = 0; i < px.length; i += 3) {
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      let hh = 0; if (c) hh = mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      h[Math.min(11, Math.floor(hh * 2)) * 4 + Math.min(3, Math.floor((mx ? c / mx : 0) * 4))] += 1;
    }
    const sum = h.reduce((a, x) => a + x, 0) || 1;
    return h.map((x) => Math.sqrt(x / sum));
  }

  /* признак снимка: CLS-вектор DINOv2 + цветовой профиль */
  async function embedImage(img) {
    const { processor, model } = await loadModel();
    const inputs = await processor(img);
    const out = await model(inputs);
    const t = out.last_hidden_state;
    const dim = t.dims[t.dims.length - 1];
    return { v: norm(Array.from(t.data.slice(0, dim))), h: await stainHist(img) };
  }

  /* вырезки: целиком, центр и две четверти — чтобы снимок с окуляра на другом увеличении всё равно находился */
  async function cropsOf(raw) {
    const w = raw.width, h = raw.height, cw = Math.round(w * 0.6), ch = Math.round(h * 0.6);
    const box = (x, y) => [x, y, x + cw - 1, y + ch - 1];
    return [raw, await raw.crop(box(Math.round((w - cw) / 2), Math.round((h - ch) / 2))), await raw.crop(box(0, 0)), await raw.crop(box(w - cw, h - ch))];
  }

  async function embedAll(blobOrUrl, n = 4) {
    const { T } = await loadModel();
    const raw = blobOrUrl instanceof Blob ? await T.RawImage.fromBlob(blobOrUrl) : await T.RawImage.fromURL(blobOrUrl);
    const parts = (await cropsOf(raw)).slice(0, n);
    const out = [];
    for (const p of parts) out.push(await embedImage(p));
    return out;
  }

  function loadIndex() {
    if (!indexP) {
      indexP = fetch("embeddings.json").then((r) => { if (!r.ok) throw new Error("no index"); return r.json(); }).then((j) => ({
        ...j,
        items: j.items.map(([id, b64, h64]) => {
          const bin = atob(b64), v = new Float32Array(bin.length);
          for (let i = 0; i < bin.length; i++) { const c = bin.charCodeAt(i); v[i] = c > 127 ? c - 256 : c; }
          const hb = atob(h64), h = Array.from(hb, (ch) => ch.charCodeAt(0) / 255);
          return { id, v: norm(Array.from(v)), h };
        }),
      }));
      indexP.catch(() => { indexP = null; });
    }
    return indexP;
  }

  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  /* оценки по препаратам: для каждой вырезки запроса — лучший вектор препарата, затем среднее */
  async function rank(file, stainHint) {
    const [idx, q] = await Promise.all([loadIndex(), embedAll(file, 2)]);
    const best = {};
    q.forEach((qv, qi) => {
      const per = {};
      idx.items.forEach((it) => { const s = 0.8 * dot(qv.v, it.v) + 0.2 * dot(qv.h, it.h); if (!(per[it.id] >= s)) per[it.id] = s; });
      Object.entries(per).forEach(([id, s]) => { (best[id] = best[id] || [])[qi] = s; });
    });
    const hint = (stainHint || "").toLowerCase().split(/[ ,—-]+/).filter((w) => w.length > 4);
    return Object.entries(best).map(([id, arr]) => {
      const p = TK().preps.find((x) => x.id === id);
      let s = (arr[0] * 2 + arr.slice(1).reduce((a, b) => a + b, 0)) / (arr.length + 1);
      if (p && hint.length && hint.some((w) => p.stain.toLowerCase().includes(w))) s += 0.02;
      return { id, p, s };
    }).filter((x) => x.p).sort((a, b) => b.s - a.s);
  }

  async function identify(file, opt) {
    const r = await rank(file, opt.stain);
    if (!r.length) throw Object.assign(new Error("no index"), { code: "api_error" });
    const [a, b, c] = r, T = 0.035;
    const z = r.slice(0, 8).reduce((acc, x) => acc + Math.exp((x.s - a.s) / T), 0);
    const certainty = 1 / z, likeAtlas = Math.max(0, Math.min(1, (a.s - 0.55) / 0.4));
    const conf = Math.round(Math.min(95, 100 * certainty * (0.35 + 0.65 * likeAtlas)));
    const p = a.p, grp = TK().groupName ? TK().groupName(p.sec) : "";
    if (a.s < 0.4) return { is_histology: false, caution: "Снимок совсем не похож на препараты атласа. Сфотографируйте поле зрения микроскопа крупно и резко, без бликов." };
    const alt = [b, c].filter(Boolean).map((x) => ({ title: (x.p.no ? "№" + x.p.no + " " : "") + x.p.title, why_not: (x.p.diff && x.p.diff[0] ? "сверьте: " + x.p.keys[0].toLowerCase() : x.p.keys[0]) + ` (сходство ${Math.round(x.s * 100)}%)` }));
    return {
      is_histology: true,
      prep_title: (p.no ? "№" + p.no + " · " : "") + (p.official || p.title),
      tissue_group: grp,
      atlas_id: p.id,
      confidence: conf,
      stain: p.stain,
      magnification: p.mag,
      features: p.keys,
      alternatives: alt,
      tip: `На зачёте назови: «${p.official || p.title}». Покажи преподавателю: ${p.keys[0].charAt(0).toLowerCase() + p.keys[0].slice(1)}.`,
      caution: "Локальная модель сравнивает снимок с микрофото атласа по виду и окраске, а не рассуждает, как преподаватель: верный препарат нередко оказывается среди похожих ниже. Сверьте признаки и откройте кандидатов в атласе." + (conf < 45 ? " Уверенность низкая — снимите другой участок или увеличение." : ""),
    };
  }

  /* ================= тексты ================= */
  const STOP = new Set("и в во на с со по к ко у о об от до из за для при не ни но а или же ли что как это его ее её их им ими так также только уже еще ещё быть есть был была были который которая которые которых этого этой этих эти тот та те то все всех между через под над без более менее очень может могут если когда где чем она они оно мы вы ты я".split(" "));
  const stem = (w) => w.length <= 4 ? w : w.slice(0, w.length > 7 ? 6 : 5);
  const tokens = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").match(/[a-zа-я0-9]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)).map(stem) || [];
  const strip = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const sentences = (t) => strip(t).split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/).filter((x) => x.length > 25);

  let corpus = null;
  function buildCorpus() {
    const docs = [];
    TK().articles.forEach((a) => {
      const parts = String(a.body).split(/<h3>/i);
      parts.forEach((part, i) => {
        const head = i ? strip(part.split(/<\/h3>/i)[0]) : "";
        const text = strip(i ? part.split(/<\/h3>/i)[1] : (a.lead + " " + part));
        if (text.length > 40) docs.push({ kind: "art", ref: a.id, title: a.title + (head ? " — " + head : ""), text });
      });
    });
    TK().colloquia.forEach((c) => c.oral.forEach(([q, a]) => docs.push({ kind: "oral", ref: c.id, title: q, text: a })));
    TK().preps.forEach((p) => docs.push({ kind: "prep", ref: p.id, title: (p.no ? "Препарат №" + p.no + " — " : "") + p.title, text: [p.official, p.organ, "Окраска: " + p.stain, ...p.keys, ...p.diff.map(([x, y]) => "Не путать: " + x + " — " + y)].filter(Boolean).map((x) => x.replace(/[.\s]+$/, "")).join(". ") + "." }));
    const df = {};
    docs.forEach((d) => { d.tf = {}; const tk = [...tokens(d.title), ...tokens(d.title), ...tokens(d.text)]; d.len = tk.length; tk.forEach((t) => (d.tf[t] = (d.tf[t] || 0) + 1)); Object.keys(d.tf).forEach((t) => (df[t] = (df[t] || 0) + 1)); });
    const avg = docs.reduce((a, d) => a + d.len, 0) / docs.length;
    corpus = { docs, df, avg, N: docs.length };
    return corpus;
  }
  function search(q, n = 3) {
    const C = corpus || buildCorpus(), qt = [...new Set(tokens(q))];
    return C.docs.map((d) => {
      let s = 0;
      qt.forEach((t) => { const f = d.tf[t]; if (!f) return; const idf = Math.log(1 + (C.N - C.df[t] + 0.5) / (C.df[t] + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / C.avg)); });
      return { d, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n);
  }
  const clip = (t, n) => (t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + "…" : t);

  function answer(question) {
    const hits = search(question, 3);
    if (!hits.length) return "В материалах Тканики ничего не нашлось по этому вопросу. Попробуйте сформулировать через термины: название ткани, клетки или препарата.";
    const top = hits[0], out = [];
    const where = (d) => d.kind === "oral" ? "вопрос коллоквиума" : d.kind === "prep" ? "атлас" : "теория";
    out.push(`${top.d.title}\n${clip(top.d.text, 700)}`);
    const seen = new Set([top.d.title]);
    hits.slice(1).filter((h) => h.s > top.s * 0.55 && !seen.has(h.d.title) && seen.add(h.d.title)).forEach((h) => out.push(`См. также (${where(h.d)}): ${h.d.title}`));
    out.push("Найдено в материалах приложения локальным поиском. Чтобы ИИ отвечал своими словами, подключите Claude.");
    return out.join("\n\n");
  }

  /* устный ответ против эталона: пункт засчитан, если в ответе есть больше половины его ключевых слов */
  function grade(ref, ans) {
    const at = new Set(tokens(ans));
    const pts = ref.split(/(?<=[.;])\s+|,\s+(?=[а-яё])/i).map((x) => x.trim()).filter((x) => tokens(x).length >= 2);
    const res = pts.map((x) => { const k = [...new Set(tokens(x))]; const hit = k.filter((t) => at.has(t)).length; return { x, ok: hit / k.length >= 0.5 }; });
    const cov = res.length ? res.filter((r) => r.ok).length / res.length : 0;
    const words = (ans.match(/\S+/g) || []).length;
    let score = cov >= 0.75 ? 5 : cov >= 0.5 ? 4 : cov >= 0.3 ? 3 : 2;
    if (words < 15) score = Math.min(score, 3);
    const done = res.filter((r) => r.ok).length;
    return {
      score,
      verdict: `Локальная проверка по эталону: раскрыто ${done} из ${res.length} пунктов.` + (words < 15 ? " Ответ слишком короткий для коллоквиума." : "") + " Смысл и фактические ошибки проверяет только Claude.",
      good: res.filter((r) => r.ok).map((r) => clip(r.x, 160)).slice(0, 6),
      missing: res.filter((r) => !r.ok).map((r) => clip(r.x, 160)).slice(0, 6),
      errors: [],
    };
  }

  function cards(secName) {
    const sec = TK().sections.find((s) => s.name === secName);
    const c = TK().colloquia.find((x) => sec && x.sec === sec.id) || TK().colloquia[0];
    const pick = c.oral.slice().sort(() => Math.random() - 0.5).slice(0, 5);
    return pick.map(([q, a]) => ({ q, a: clip(sentences(a).slice(0, 2).join(" ") || a, 260) }));
  }

  function conspect(material, title) {
    const s = sentences(material);
    const key = s.filter((x) => /—|это|называ|включа|состо|различа|функци|образ/i.test(x)).slice(0, 9);
    const lines = (key.length >= 5 ? key : s.slice(0, 9)).map((x) => "• " + clip(x, 200));
    return lines.join("\n") + `\nЗапомни: сначала определение, потом классификация, строение и функции — так строится ответ по теме «${title}».`;
  }

  /* ================= интерфейс как у sample ================= */
  const fail = (code) => Object.assign(new Error(code), { code });
  const lastUser = (input) => typeof input === "string" ? input : [...input].reverse().find((m) => m.role === "user")?.content || "";
  async function emit(text, opt) { if (opt && opt.onText) opt.onText({ text }); return { text }; }

  const sample = async (input, opt = {}) => {
    const t = opt.task || {};
    if (t.kind === "conspect") return emit(conspect(t.material, t.title), opt);
    if (t.kind === "why") return emit(`Правильный ответ — «${t.right}». ` + (search(t.question + " " + t.right, 1)[0] ? "Из теории: " + clip(search(t.question + " " + t.right, 1)[0].d.text, 420) : ""), opt);
    return emit(answer(t.question || lastUser(input)), opt);
  };
  sample.json = async (input, opt = {}) => {
    const t = opt.task || {};
    if (t.kind === "identify") { if (!opt.images) throw fail("image_rejected"); return identify(opt.images, t); }
    if (t.kind === "grade") return grade(t.ref, t.answer);
    if (t.kind === "cards") return cards(t.sec);
    throw fail("api_error");
  };
  sample.limits = async () => ({ images: true });
  sample.local = true;

  window.TKLocal = { sample, loadModel, loadIndex, embedAll, rank, search, onProgress: (f) => { listeners.add(f); return () => listeners.delete(f); } };
})();
