/* Тканика — AI вне Claude.
   Внутри Claude страница получает window.claude от среды, и этот файл ничего не делает.
   В обычном браузере (Safari, Chrome) он подставляет такой же интерфейс поверх Anthropic API
   с ключом, который пользователь вводит сам. Ключ хранится только в localStorage этого браузера. */
(function () {
  "use strict";
  if (window.claude && window.claude.use) return;

  const KEY = "tkanika.apikey";
  const MODEL = "claude-opus-5-5";
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm";
  const getKey = () => { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } };
  const setKey = (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} };

  let client = null;
  async function getClient() {
    if (!client) {
      const m = await import(SDK_URL);
      const Anthropic = m.default || m.Anthropic;
      client = new Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true });
    }
    return client;
  }

  const fail = (code) => Object.assign(new Error(code), { code });
  function mapErr(e) {
    if (e && e.code && !e.status) return e;
    const st = e && e.status;
    if (st === 401 || st === 403) return fail("bad_key");
    if (st === 429 || st === 529) return fail("rate_limited");
    if (st === 413) return fail("prompt_too_large");
    if (st === 400 && /image/i.test(String(e.message))) return fail("image_rejected");
    return fail(st ? "api_error" : "network");
  }

  async function imageBlock(file) {
    const type = file.type || "image/png";
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type) || file.size > 20e6) throw fail("image_rejected");
    const u = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return { type: "image", source: { type: "base64", media_type: type, data: btoa(bin) } };
  }

  // Принимает строку или массив {role, content}; соседние реплики одной роли склеиваются.
  async function toMessages(input, images) {
    const list = typeof input === "string" ? [{ role: "user", content: input }] : input;
    const out = [];
    for (const m of list) {
      const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
      const prev = out[out.length - 1];
      if (prev && prev.role === m.role) prev.content += "\n\n" + text;
      else out.push({ role: m.role, content: text });
    }
    if (images) {
      const blocks = await Promise.all((Array.isArray(images) ? images : [images]).map(imageBlock));
      const last = out[out.length - 1];
      last.content = [...blocks, { type: "text", text: last.content }];
    }
    return out;
  }

  async function run(input, opt = {}, asJson = false) {
    const api = await getClient();
    const params = {
      model: MODEL,
      max_tokens: 16000,
      messages: await toMessages(input, opt.images),
      output_config: { effort: opt.images ? "medium" : "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    if (asJson) params.system = "Верни ответ строго одним JSON-значением: без markdown, без ``` и без пояснений до или после.";
    try {
      const stream = api.beta.messages.stream(params);
      let text = "";
      if (opt.onText) stream.on("text", (d) => { text += d; opt.onText({ text }); });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw fail("refused");
      return { text: msg.content.filter((b) => b.type === "text").map((b) => b.text).join("") };
    } catch (e) { throw mapErr(e); }
  }

  const sample = (input, opt) => run(input, opt);
  sample.json = async (input, opt) => {
    const { text } = await run(input, opt, true);
    const t = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    const start = t.search(/[\[{]/), end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { throw fail("invalid_json"); }
  };
  sample.limits = async () => ({ images: true });

  const downloads = {
    async save({ filename, data, mimeType }) {
      const url = URL.createObjectURL(new Blob([data], { type: mimeType || "text/markdown;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
  };

  window.claude = {
    browserShim: true,
    use: async (name) => (name === "sample" ? (getKey() ? sample : (window.TKLocal && window.TKLocal.sample) || null) : name === "downloads" ? downloads : null),
  };

  /* ---------- окно подключения ключа ---------- */
  function open() {
    const has = !!getKey();
    const d = document.createElement("dialog");
    d.className = "keydlg";
    d.innerHTML = `
      <form method="dialog">
        <h3>AI в браузере</h3>
        <p class="note">Скан препарата, AI-помощник и разбор ошибок работают внутри Claude сами. В Safari и других браузерах подключите свой ключ Anthropic API — он хранится только на этом устройстве и уходит напрямую в api.anthropic.com.</p>
        <label class="note" for="tkKey">Ключ API</label>
        <input class="input" id="tkKey" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? "Ключ сохранён — введите новый, чтобы заменить" : "sk-ant-…"}">
        <p class="note">Ключ создаётся в <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Запросы оплачиваются с вашего аккаунта.</p>
        <div class="row" style="justify-content:flex-end">
          ${has ? '<button class="btn" value="off" type="submit">Отключить</button>' : ""}
          <button class="btn" value="cancel" type="submit">Отмена</button>
          <button class="btn primary" value="save" type="submit">Сохранить</button>
        </div>
      </form>`;
    document.body.appendChild(d);
    d.addEventListener("close", () => {
      const v = d.querySelector("#tkKey").value.trim();
      if (d.returnValue === "save" && v) { setKey(v); location.reload(); }
      else if (d.returnValue === "off") { setKey(""); location.reload(); }
      d.remove();
    });
    d.showModal();
  }
  window.TKAI = { open, connected: () => !!getKey(), inClaude: false };

  const css = document.createElement("style");
  css.textContent = `.keydlg{border:1px solid var(--line);border-radius:var(--r);background:var(--surface);color:var(--ink);padding:22px;max-width:min(440px,calc(100vw - 32px));box-shadow:var(--shadow)}
.keydlg::backdrop{background:rgba(30,10,30,.45);backdrop-filter:blur(3px)}
.keydlg h3{font:700 18px var(--display);margin:0 0 8px;color:var(--eo)}
.keydlg .input{width:100%;margin:4px 0 6px}
.keydlg .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}`;
  document.head.appendChild(css);
})();
