/* Тканика — процедурные «микроскопные поля» препаратов общей гистологии.
   Каждый рендерер рисует в единичном поле 1000×1000 и возвращает подписи структур. */
(function () {
  const TAU = Math.PI * 2;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hexRGB = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- базовые примитивы ---------- */
  function bg(S, col) { const c = S.ctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = col; c.fillRect(0, 0, S.W, S.W); c.restore(); }

  function blobPath(ctx, x, y, rx, ry, rot, jit, r) {
    const p1 = r() * TAU, p2 = r() * TAU, n = 26;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const k = 1 + jit * (0.55 * Math.sin(3 * a + p1) + 0.35 * Math.sin(5 * a + p2));
      const px = Math.cos(a) * rx * k, py = Math.sin(a) * ry * k;
      const X = x + px * Math.cos(rot) - py * Math.sin(rot), Y = y + px * Math.sin(rot) + py * Math.cos(rot);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.closePath();
  }

  function nucleus(S, x, y, rx, ry, rot, col, o = {}) {
    const { ctx, r } = S;
    blobPath(ctx, x, y, rx, ry, rot, o.jit ?? 0.08, r);
    ctx.fillStyle = col; ctx.fill();
    if (o.speck !== false) {
      const n = Math.max(3, (rx * ry) / 12);
      ctx.fillStyle = o.speckCol || "rgba(25,10,50,0.45)";
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = Math.sqrt(r()) * 0.75;
        const px = Math.cos(a) * rx * d, py = Math.sin(a) * ry * d;
        ctx.beginPath();
        ctx.arc(x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot), Math.min(rx, ry) * 0.16 + r() * 0.8, 0, TAU);
        ctx.fill();
      }
    }
    if (o.nucleolus) { ctx.fillStyle = o.nucleolus; ctx.beginPath(); ctx.arc(x + rx * 0.15, y - ry * 0.1, Math.min(rx, ry) * 0.28, 0, TAU); ctx.fill(); }
  }

  function walk(S, x, y, ang, len, step, wav) {
    const pts = [[x, y]]; let a = ang;
    for (let s = 0; s < len; s += step) { a += (S.r() - 0.5) * wav; x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push([x, y]); }
    return pts;
  }
  function strokePts(ctx, pts, lw, col) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
    const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]);
    ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
  }
  function taper(ctx, pts, w0, w1, col) {
    const n = pts.length - 1;
    ctx.strokeStyle = col; ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      ctx.lineWidth = w0 + (w1 - w0) * (i / n);
      ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i + 1][0], pts[i + 1][1]); ctx.stroke();
    }
  }

  function jitterGrid(S, sp, jit, hex, x0 = -120, x1 = 1120, y0 = -120, y1 = 1120) {
    const pts = []; let row = 0;
    const dy = hex ? sp * 0.866 : sp;
    for (let y = y0; y < y1; y += dy, row++) {
      for (let x = x0 + (hex && row % 2 ? sp / 2 : 0); x < x1; x += sp) {
        pts.push({ x: x + (S.r() - 0.5) * sp * jit, y: y + (S.r() - 0.5) * sp * jit });
      }
    }
    return pts;
  }
  function poisson(S, n, tries, minFn, x0 = -60, x1 = 1060, y0 = -60, y1 = 1060) {
    const out = [];
    for (let t = 0; t < tries && out.length < n; t++) {
      const c = minFn({ x: x0 + S.r() * (x1 - x0), y: y0 + S.r() * (y1 - y0) });
      if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) > (o.rad || 0) + (c.rad || 0) + (c.gap || 0))) out.push(c);
    }
    return out;
  }
  function nearest(arr, x, y) { let b = null, bd = 1e9; for (const p of arr) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; b = p; } } return b; }

  /* Вороной на сетке для клеточных мозаик */
  function makeVor(seeds, cs) {
    const X0 = -300, N = Math.ceil(1600 / cs), grid = Array.from({ length: N * N }, () => []);
    seeds.forEach((s, i) => {
      const gx = Math.floor((s.x - X0) / cs), gy = Math.floor((s.y - X0) / cs);
      if (gx >= 0 && gy >= 0 && gx < N && gy < N) grid[gy * N + gx].push(i);
    });
    const res = [0, 0, 0];
    return function (x, y) {
      const gx = Math.floor((x - X0) / cs), gy = Math.floor((y - X0) / cs);
      let d1 = 1e9, d2 = 1e9, i1 = -1;
      for (let j = gy - 2; j <= gy + 2; j++) {
        if (j < 0 || j >= N) continue;
        for (let i = gx - 2; i <= gx + 2; i++) {
          if (i < 0 || i >= N) continue;
          const cell = grid[j * N + i];
          for (let q = 0; q < cell.length; q++) {
            const s = seeds[cell[q]], dx = s.x - x, dy = s.y - y, d = dx * dx + dy * dy;
            if (d < d1) { d2 = d1; d1 = d; i1 = cell[q]; } else if (d < d2) d2 = d;
          }
        }
      }
      res[0] = i1; res[1] = Math.sqrt(d1); res[2] = Math.sqrt(d2);
      return res;
    };
  }

  /* попиксельная заливка в экранных координатах; fn(ux,uy) → [r,g,b,a] | null */
  function raster(S, fn) {
    const { ctx, W, k, ox } = S;
    const img = ctx.getImageData(0, 0, W, W), d = img.data;
    const st = W > 700 ? 2 : 1, R2 = (W / 2 + 2) * (W / 2 + 2), h = W / 2;
    for (let py = 0; py < W; py += st) {
      const uy = (py + st / 2 - ox) / k;
      for (let px = 0; px < W; px += st) {
        if ((px - h) * (px - h) + (py - h) * (py - h) > R2) continue;
        const c = fn((px + st / 2 - ox) / k, uy);
        if (!c) continue;
        const a = c[3] ?? 1;
        for (let yy = py; yy < Math.min(W, py + st); yy++) for (let xx = px; xx < Math.min(W, px + st); xx++) {
          const o = (yy * W + xx) * 4;
          d[o] = d[o] + (c[0] - d[o]) * a; d[o + 1] = d[o + 1] + (c[1] - d[o + 1]) * a; d[o + 2] = d[o + 2] + (c[2] - d[o + 2]) * a; d[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function grain(S, n, col) {
    const { ctx, r } = S; ctx.fillStyle = col;
    for (let i = 0; i < n; i++) { ctx.globalAlpha = 0.1 + r() * 0.25; ctx.fillRect(r() * 1000, r() * 1000, 1.4 + r() * 2.2, 1.4 + r() * 2.2); }
    ctx.globalAlpha = 1;
  }
  function fillPoly(ctx, pts, col) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); }

  /* ---------- многослойные эпителии (общий генератор) ---------- */
  function stratified(S, o) {
    const { ctx, r } = S;
    const ys = o.ys, yb = o.yb, g = o.g, K = o.K;
    const Fs = []; const NN = 200; let acc = 0; Fs.push(0);
    for (let i = 1; i <= NN; i++) { acc += g((i - 0.5) / NN) / NN; Fs.push(acc); }
    const F = (d) => { const f = clamp(d, 0, 1) * NN, i = Math.floor(f); return i >= NN ? Fs[NN] : Fs[i] + (Fs[i + 1] - Fs[i]) * (f - i); };
    const Finv = (v) => { let lo = 0, hi = 1; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; F(m) < v ? (lo = m) : (hi = m); } return (lo + hi) / 2; };
    const total = F(1) * K;
    const seeds = []; let row = 0;
    for (let Y = o.rowSp / 2; Y < total; Y += o.rowSp, row++) {
      const d = Finv(Y / K), sx = o.sx(d);
      for (let x = -80 + (row % 2) * sx / 2; x < 1080; x += sx) {
        const jx = x + (r() - 0.5) * sx * 0.35, jY = Y + (r() - 0.5) * o.rowSp * 0.3;
        seeds.push({ x: jx, Y: jY, y: jY, d: Finv(jY / K), t: r() });
      }
    }
    const vq = makeVor(seeds, Math.max(60, o.rowSp * 2.2));
    const cyTop = hexRGB(o.cyTop), cyBase = hexRGB(o.cyBase), below = hexRGB(o.below), above = hexRGB(o.above), brd = hexRGB(o.border);
    raster(S, (x, y) => {
      const s0 = ys(x), b0 = yb(x);
      if (y > b0) { const n = 6 * Math.sin(x / 7 + y / 13) + 5 * Math.sin(y / 5.3); return [below[0] + n, below[1] + n, below[2] + n, 1]; }
      if (y < s0) return o.aboveFn ? o.aboveFn(x, y, s0) : [above[0], above[1], above[2], 1];
      const d = (y - s0) / (b0 - s0), Y = F(d) * K;
      const q = vq(x + 2 * Math.sin(y / 9), Y), e = q[2] - q[1];
      const s = seeds[q[0]], tt = clamp(s.d, 0, 1);
      const c = [cyTop[0] + (cyBase[0] - cyTop[0]) * tt, cyTop[1] + (cyBase[1] - cyTop[1]) * tt, cyTop[2] + (cyBase[2] - cyTop[2]) * tt];
      const v = (s.t - 0.5) * 16;
      if (e < o.bw) { const a = 0.75 * (1 - e / o.bw); return [c[0] + (brd[0] - c[0]) * a, c[1] + (brd[1] - c[1]) * a, c[2] + (brd[2] - c[2]) * a, 1]; }
      return [c[0] + v, c[1] + v, c[2] + v, 1];
    });
    // базальная мембрана
    const bm = []; for (let x = -20; x <= 1020; x += 8) bm.push([x, yb(x)]);
    strokePts(ctx, bm, 3.2, o.bmCol || "rgba(150,50,100,0.55)");
    // ядра
    const placed = [];
    seeds.forEach((s) => {
      const x = s.x, d = s.d, y = ys(x) + d * (yb(x) - ys(x));
      s.ry_ = y;
      if (y < ys(x) + 3 || y > yb(x) - 3) return;
      if (o.skipNuc && o.skipNuc(d, s)) return;
      const gd = g(d), rx = o.nr * (1 + 0.6 * (1 - d)) * (gd > 2 ? 1.2 : 1), ry = o.nr * clamp(1.4 / gd, 0.32, 1.7);
      nucleus(S, x, y, Math.min(rx, o.nr * 1.5), ry, (r() - 0.5) * 0.25, o.nucCol, { jit: 0.1 });
      if (o.extra) o.extra(s, x, y, d);
      placed.push({ x, y, d });
    });
    return { seeds, placed, F, Finv };
  }

  /* ============ РЕНДЕРЕРЫ ============ */
  const R = {};

  R.mesothelium = (S) => {
    const { ctx, r } = S;
    bg(S, "#E6D3A3");
    const seeds = jitterGrid(S, 92, 0.42, true); seeds.forEach((s) => (s.t = r()));
    const vq = makeVor(seeds, 110);
    raster(S, (x, y) => {
      const wx = x + 5 * Math.sin(y / 21) + 2.5 * Math.sin(x / 9.7), wy = y + 5 * Math.sin(x / 17) + 2.5 * Math.cos(y / 11.3);
      const q = vq(wx, wy), e = q[2] - q[1];
      if (e < 5) return [52, 34, 20, 0.95 - e / 7];
      const t = seeds[q[0]].t; return [224 + t * 16, 204 + t * 14, 148 + t * 22, 1];
    });
    seeds.forEach((s) => { if (r() < 0.6) nucleus(S, s.x + (r() - 0.5) * 12, s.y + (r() - 0.5) * 12, 17, 12, r() * TAU, "rgba(125,92,52,0.38)", { speck: false }); });
    grain(S, 2500, "#5a4020");
    const a = nearest(seeds, 420, 450), b = seeds.filter((s) => s !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
    const c = nearest(seeds, 600, 620);
    return [
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: "Извилистая граница клеток (импрегнация серебром)" },
      { x: c.x, y: c.y, t: "Ядро мезотелиоцита (светлое, не прокрашено)" },
      { x: a.x - 20, y: a.y + 18, t: "Мезотелиоцит — плоская полигональная клетка" },
    ];
  };

  R.kidney = (S) => {
    const { ctx, r } = S;
    bg(S, "#F1C7D6");
    grain(S, 1200, "#b06a8a");
    const tubs = poisson(S, 26, 900, (c) => ({ ...c, rad: 80 + r() * 36, gap: 14 }));
    const first = nearest(tubs, 470, 470);
    // капилляры с эритроцитами в межуточной ткани
    for (let i = 0; i < 70; i++) {
      const x = r() * 1000, y = r() * 1000;
      if (tubs.some((t) => Math.hypot(t.x - x, t.y - y) < t.rad + 8)) continue;
      ctx.fillStyle = "rgba(214,70,95,0.85)"; for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(x + j * 7, y + (r() - 0.5) * 5, 3.6, 0, TAU); ctx.fill(); }
      nucleus(S, x - 12, y + 6, 7, 3, r(), "#51307f", { speck: false });
    }
    tubs.forEach((t) => {
      blobPath(ctx, t.x, t.y, t.rad, t.rad * (0.85 + r() * 0.15), r() * TAU, 0.04, r);
      ctx.fillStyle = "#E595B4"; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = "#B8517F"; ctx.stroke();
      const lr = t.rad * 0.42;
      blobPath(ctx, t.x, t.y, lr, lr * 0.9, r() * TAU, 0.15, r); ctx.fillStyle = "#FBEFF4"; ctx.fill();
      const n = Math.round((TAU * t.rad * 0.72) / 27);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU, a2 = a + Math.PI / n;
        ctx.beginPath(); ctx.moveTo(t.x + Math.cos(a2) * lr, t.y + Math.sin(a2) * lr); ctx.lineTo(t.x + Math.cos(a2) * t.rad * 0.97, t.y + Math.sin(a2) * t.rad * 0.97);
        ctx.lineWidth = 1.1; ctx.strokeStyle = "rgba(160,60,110,0.35)"; ctx.stroke();
        nucleus(S, t.x + Math.cos(a) * t.rad * 0.72, t.y + Math.sin(a) * t.rad * 0.72, 7.5, 7, 0, "#43277A");
      }
      t.lr = lr;
    });
    let best = { x: 500, y: 500 }, bd = -1;
    for (let i = 0; i < 400; i++) {
      const x = 250 + r() * 500, y = 250 + r() * 500;
      const m = Math.min(...tubs.map((t) => Math.hypot(t.x - x, t.y - y) - t.rad));
      if (m > bd) { bd = m; best = { x, y }; }
    }
    return [
      { x: first.x, y: first.y, t: "Просвет канальца" },
      { x: first.x + first.rad * 0.72, y: first.y, t: "Округлое ядро в центре кубической клетки" },
      { x: first.x, y: first.y - first.rad * 0.6, t: "Кубический эпителиоцит (высота ≈ ширине)" },
      { x: first.x - first.rad * 0.7, y: first.y + first.rad * 0.7, t: "Базальная мембрана" },
      { x: best.x, y: best.y, t: "Межуточная рыхлая соединительная ткань с капиллярами" },
    ];
  };

  R.intestine = (S) => {
    const { ctx, r } = S;
    bg(S, "#F8EEF3");
    for (let i = 0; i < 14; i++) strokePts(ctx, walk(S, r() * 1000, r() * 1000, r() * TAU, 120, 12, 0.6), 2, "rgba(170,150,200,0.25)");
    const villi = [{ cx: 170, top: 190 }, { cx: 500, top: 110 }, { cx: 830, top: 230 }];
    const labels = [];
    villi.forEach((v, vi) => {
      const w = 250, pts = [];
      const L = [];
      for (let y = 1120; y > v.top + w / 2; y -= 6) L.push([v.cx - w / 2 + 9 * Math.sin(y / 45 + vi), y]);
      for (let a = Math.PI; a <= TAU; a += 0.035) L.push([v.cx + Math.cos(a) * w / 2, v.top + w / 2 + Math.sin(a) * w / 2]);
      for (let y = v.top + w / 2; y < 1120; y += 6) L.push([v.cx + w / 2 + 9 * Math.sin(y / 45 + vi + 2), y]);
      let accd = 0;
      for (let i = 1; i < L.length - 1; i++) {
        accd += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]);
        const tx = L[i + 1][0] - L[i - 1][0], ty = L[i + 1][1] - L[i - 1][1], tl = Math.hypot(tx, ty);
        if (accd >= 13) { accd = 0; pts.push({ x: L[i][0], y: L[i][1], nx: ty / tl, ny: -tx / tl }); }
      }
      const H = 64;
      fillPoly(ctx, pts.map((p) => [p.x, p.y]).concat([[v.cx + w / 2, 1200], [v.cx - w / 2, 1200]]), "#E48FB0");
      const inner = pts.map((p) => [p.x - p.nx * H, p.y - p.ny * H]);
      fillPoly(ctx, inner.concat([[v.cx + w / 2 - H, 1200], [v.cx - w / 2 + H, 1200]]), "#EFB9CD");
      // собственная пластинка: ядра, млечный капилляр
      blobPath(ctx, v.cx, v.top + 330, 16, 170, 0, 0.05, r); ctx.fillStyle = "rgba(252,244,248,0.9)"; ctx.fill();
      for (let i = 0; i < 70; i++) {
        const x = v.cx + (r() - 0.5) * (w - 2 * H - 20), y = v.top + H + 40 + r() * 900;
        if (Math.abs(x - v.cx) < 22 && y < v.top + 500) continue;
        nucleus(S, x, y, 5 + r() * 3, 4 + r() * 2, r() * TAU, "#5a3a92");
      }
      for (let i = 0; i < 6; i++) strokePts(ctx, walk(S, v.cx + (r() - 0.5) * 60, v.top + 200 + r() * 700, Math.PI / 2 + (r() - 0.5), 90, 10, 0.5), 1.6, "rgba(200,110,150,0.5)");
      let gob = 3 + Math.floor(r() * 3), gobPt = null, colPt = null;
      pts.forEach((p, i) => {
        ctx.beginPath(); ctx.moveTo(p.x + p.nx * 2, p.y + p.ny * 2); ctx.lineTo(p.x - p.nx * H, p.y - p.ny * H);
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(150,60,100,0.35)"; ctx.stroke();
      });
      pts.forEach((p, i) => {
        const ang = Math.atan2(p.ny, p.nx);
        if (--gob === 0) {
          gob = 5 + Math.floor(r() * 4);
          blobPath(ctx, p.x - p.nx * 24, p.y - p.ny * 24, 20, 10, ang, 0.08, r); ctx.fillStyle = "#F5EBF4"; ctx.fill();
          ctx.strokeStyle = "rgba(150,110,170,0.5)"; ctx.lineWidth = 1; ctx.stroke();
          nucleus(S, p.x - p.nx * 52, p.y - p.ny * 52, 7, 4, ang + Math.PI / 2, "#3b2170");
          if (!gobPt && p.y < 700 && p.y > 250) gobPt = p;
        } else {
          nucleus(S, p.x - p.nx * 43, p.y - p.ny * 43, 13, 4.6, ang, "#4A2B80");
          if (!colPt && p.y > 420 && p.y < 650 && i % 2) colPt = p;
        }
      });
      strokePts(ctx, pts.map((p) => [p.x, p.y]), 4.2, "#B34A7A");
      strokePts(ctx, inner, 1.8, "rgba(170,70,120,0.55)");
      if (vi === 1) {
        const tp = pts[Math.floor(pts.length / 2)];
        labels.push({ x: tp.x, y: tp.y, t: "Щёточная (всасывающая) каёмка — микроворсинки" });
        if (colPt) labels.push({ x: colPt.x - colPt.nx * 43, y: colPt.y - colPt.ny * 43, t: "Столбчатый энтероцит, овальное ядро в базальной части" });
        if (gobPt) labels.push({ x: gobPt.x - gobPt.nx * 24, y: gobPt.y - gobPt.ny * 24, t: "Бокаловидная клетка (слизь не окрашена)" });
        labels.push({ x: v.cx + 50, y: v.top + 520, t: "Собственная пластинка слизистой (рыхлая соед. ткань)" });
        labels.push({ x: v.cx, y: v.top + 300, t: "Центральный лимфатический (млечный) капилляр" });
        const bp = inner[Math.floor(inner.length * 0.8)]; labels.push({ x: bp[0], y: bp[1], t: "Базальная мембрана" });
      }
    });
    labels.push({ x: 335, y: 330, t: "Просвет кишки" });
    return labels;
  };

  R.trachea = (S) => {
    const { ctx, r } = S;
    bg(S, "#F7EEF2");
    const y0 = (x) => 330 + 10 * Math.sin(x / 90), y1 = (x) => 545 + 7 * Math.sin(x / 70);
    for (let i = 0; i < 8; i++) strokePts(ctx, walk(S, r() * 1000, 100 + r() * 150, r() * TAU, 150, 12, 0.5), 3, "rgba(160,150,200,0.3)");
    // собственная пластинка
    const lp = []; for (let x = -20; x <= 1020; x += 10) lp.push([x, y1(x)]);
    fillPoly(ctx, lp.concat([[1020, 1020], [-20, 1020]]), "#EFC0D2");
    for (let i = 0; i < 30; i++) strokePts(ctx, walk(S, r() * 1000, 580 + r() * 420, r() * TAU, 200, 12, 0.5), 3 + r() * 3, "rgba(225,140,175,0.5)");
    const glands = [];
    for (let i = 0; i < 7; i++) {
      const gx = 80 + i * 140 + (r() - 0.5) * 40, gy = 800 + (r() - 0.5) * 160;
      blobPath(ctx, gx, gy, 45, 38, r(), 0.1, r); ctx.fillStyle = i % 2 ? "#D9C6E6" : "#E7A3C0"; ctx.fill();
      ctx.strokeStyle = "rgba(140,70,120,0.4)"; ctx.stroke();
      for (let j = 0; j < 9; j++) { const a = (j / 9) * TAU; nucleus(S, gx + Math.cos(a) * 35, gy + Math.sin(a) * 30, 5, 4, 0, "#4b2c85"); }
      glands.push({ x: gx, y: gy });
    }
    for (let i = 0; i < 90; i++) nucleus(S, r() * 1000, 590 + r() * 410, 5, 3.5, r() * TAU, "#553589");
    // эпителий
    const top = [], bot = []; for (let x = -20; x <= 1020; x += 10) { top.push([x, y0(x)]); bot.push([x, y1(x)]); }
    fillPoly(ctx, top.concat(bot.reverse()), "#E596B5");
    let gobPt, basPt, cilPt, intPt;
    for (let x = -10; x < 1015; x += 15) {
      const t = y0(x), b = y1(x), h = b - t;
      ctx.beginPath(); ctx.moveTo(x + 7, t); ctx.lineTo(x + 7 + (r() - 0.5) * 6, b); ctx.lineWidth = 0.9; ctx.strokeStyle = "rgba(150,60,100,0.3)"; ctx.stroke();
      const u = r();
      if (u < 0.13) {
        blobPath(ctx, x, t + 45, 11, 40, 0, 0.05, r); ctx.fillStyle = "#F4EAF3"; ctx.fill(); ctx.strokeStyle = "rgba(150,110,170,0.5)"; ctx.stroke();
        nucleus(S, x, t + 100, 5, 7, 0, "#3b2170");
        if (!gobPt && x > 300 && x < 700) gobPt = { x, y: t + 45 };
      } else {
        for (let c = -2; c <= 2; c++) strokePts(ctx, [[x + c * 2.4, t], [x + c * 2.6 + 1, t - 15]], 0.9, "rgba(170,80,130,0.8)");
        if (!cilPt && x > 420 && x < 600) cilPt = { x, y: t - 8 };
        const lvl = 0.42 + r() * 0.2;
        nucleus(S, x, t + h * lvl, 5.5, 12, (r() - 0.5) * 0.2, "#48297F");
      }
      if (r() < 0.55) { nucleus(S, x + 7, b - 13, 7, 6, 0, "#3E2273"); if (!basPt && x > 450 && x < 700) basPt = { x: x + 7, y: b - 13 }; }
      if (r() < 0.35) { nucleus(S, x + 5, t + h * (0.7 + r() * 0.1), 6, 9, 0, "#442680"); if (!intPt && x > 250 && x < 450) intPt = { x: x + 5, y: t + h * 0.74 }; }
    }
    const bm = []; for (let x = -20; x <= 1020; x += 8) bm.push([x, y1(x) + 3]);
    strokePts(ctx, bm, 5, "rgba(245,205,222,0.95)"); strokePts(ctx, bm.map((p) => [p[0], p[1] + 3]), 1.2, "rgba(160,70,120,0.5)");
    return [
      cilPt && { x: cilPt.x, y: cilPt.y, t: "Реснички мерцательных клеток" },
      gobPt && { ...gobPt, t: "Бокаловидная клетка" },
      { x: 520, y: y0(520) + 90, t: "Ядра на разных уровнях — ложная многорядность" },
      basPt && { ...basPt, t: "Базальная (камбиальная) клетка" },
      intPt && { ...intPt, t: "Вставочная клетка" },
      { x: 360, y: y1(360) + 4, t: "Утолщённая базальная мембрана" },
      { ...glands[3], t: "Белково-слизистая железа в подслизистой основе" },
    ].filter(Boolean);
  };

  function squamousCommon(keratin) {
    return (S) => {
      const { ctx, r } = S;
      const ysurf = keratin ? 330 : 210;
      const ph = S.r() * 6;
      const yb = (x) => 700 + 55 * Math.sin(x / 70 + ph) + 12 * Math.sin(x / 23);
      const res = stratified(S, {
        ys: () => ysurf, yb, K: keratin ? 250 : 270,
        g: (d) => 0.55 + 3.6 * Math.pow(1 - d, 2.2), rowSp: 26,
        sx: (d) => 26 + 58 * Math.pow(1 - d, 2.4), bw: 2.6, nr: 7.5,
        cyTop: keratin ? "#E6A0BE" : "#F0B5CA", cyBase: "#C592C6", below: "#EDBACD", above: "#F7EEF3", border: "#9E4F84", nucCol: "#46297D",
        aboveFn: keratin ? (x, y, s0) => {
          if (y > s0 - 18) return [248, 222, 232, 1];                          // блестящий слой
          if (y < 70 + 8 * Math.sin(x / 50)) return [247, 238, 243, 1];
          const w = Math.sin(y / 5.5 + Math.sin(x / 40) * 1.6); return [232 + w * 10, 150 + w * 14, 184 + w * 10, 1];
        } : null,
        extra: keratin ? (s, x, y, d) => {
          if (d < 0.14) { ctx.fillStyle = "rgba(60,20,90,0.8)"; for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc(x + (r() - 0.5) * 50, y + (r() - 0.5) * 7, 1.3 + r(), 0, TAU); ctx.fill(); } }
        } : null,
      });
      // сосочки дермы/собственной пластинки
      for (let i = 0; i < 60; i++) { const x = r() * 1000, y = yb(x) + 20 + r() * 300; nucleus(S, x, y, 7, 3, r() * TAU, "#553589"); }
      for (let i = 0; i < 18; i++) strokePts(ctx, walk(S, r() * 1000, 760 + r() * 260, r() * TAU, 200, 14, 0.6), 4, "rgba(220,130,170,0.45)");
      const midX = 520, yB = yb(midX);
      const L = [
        { x: midX, y: yB - 12, t: "Базальный слой — призматические клетки на базальной мембране" },
        { x: 420, y: ysurf + (yb(420) - ysurf) * 0.55, t: "Шиповатый слой — полигональные клетки" },
        { x: 300, y: yb(300) + 60, t: keratin ? "Сосочковый слой дермы" : "Собственная пластинка слизистой / строма" },
      ];
      if (keratin) {
        L.push({ x: 650, y: ysurf + 16, t: "Зернистый слой — гранулы кератогиалина" });
        L.push({ x: 540, y: ysurf - 9, t: "Блестящий слой (элеидин)" });
        L.push({ x: 380, y: 190, t: "Роговой слой — роговые чешуйки без ядер" });
      } else {
        L.push({ x: 600, y: ysurf + 10, t: "Поверхностный слой: плоские клетки СОХРАНЯЮТ ядра" });
        L.push({ x: 300, y: 110, t: "Просвет (поверхность эпителия)" });
      }
      return L;
    };
  }
  R.squamousNK = squamousCommon(false);
  R.squamousK = squamousCommon(true);

  R.transitional = (S) => {
    const { ctx, r } = S;
    const yb = (x) => 720 + 14 * Math.sin(x / 90);
    const ys = (x) => 300 - 16 * Math.abs(Math.sin((Math.PI * x) / 92));
    const res = stratified(S, {
      ys, yb, K: 300, g: () => 1, rowSp: 60,
      sx: (d) => 46 + 58 * Math.pow(1 - d, 4), bw: 2.4, nr: 9,
      cyTop: "#E9A7C4", cyBase: "#D59BC6", below: "#EDBACD", above: "#F7EEF3", border: "#9E4F84", nucCol: "#48297F",
      extra: (s, x, y, d) => { if (d < 0.14 && r() < 0.4) nucleus(S, x + 18, y + 3, 8, 8, 0, "#48297F"); },
    });
    for (let i = 0; i < 70; i++) { const x = r() * 1000, y = yb(x) + 20 + r() * 260; nucleus(S, x, y, 7, 3, r() * TAU, "#553589"); }
    for (let i = 0; i < 16; i++) strokePts(ctx, walk(S, r() * 1000, 760 + r() * 240, r() * TAU, 200, 14, 0.6), 4, "rgba(220,130,170,0.45)");
    // выбор поверхностной клетки для подписи
    const sup = res.placed.filter((p) => p.d < 0.12).sort((a, b) => Math.abs(a.x - 480) - Math.abs(b.x - 480))[0] || { x: 480, y: 330 };
    return [
      { x: sup.x, y: sup.y, t: "Покровная (зонтичная) клетка — крупная, бывает двуядерной" },
      { x: 560, y: 520, t: "Промежуточный слой — грушевидные клетки" },
      { x: 400, y: yb(400) - 16, t: "Базальный слой — мелкие клетки" },
      { x: 700, y: 262, t: "Куполообразная поверхность (стенка не растянута)" },
      { x: 300, y: yb(300) + 80, t: "Собственная пластинка слизистой" },
    ];
  };

  R.looseCT = (S) => {
    const { ctx, r } = S;
    bg(S, "#F2DCE6"); grain(S, 2000, "#b9859f");
    for (let i = 0; i < 44; i++) strokePts(ctx, walk(S, r() * 1100 - 50, r() * 1100 - 50, r() * TAU, 300 + r() * 450, 16, 0.35), 6 + r() * 9, "rgba(224,138,174,0.5)");
    for (let i = 0; i < 34; i++) {
      const p = walk(S, r() * 1000, r() * 1000, r() * TAU, 250 + r() * 400, 20, 0.15);
      strokePts(ctx, p, 1.6, "rgba(78,36,100,0.85)");
      if (r() < 0.6) { const q = p[Math.floor(p.length / 2)]; strokePts(ctx, walk(S, q[0], q[1], r() * TAU, 120, 20, 0.2), 1.3, "rgba(78,36,100,0.8)"); }
    }
    const L = [];
    const fb = poisson(S, 26, 500, (c) => ({ ...c, rad: 45, gap: 10 }), 30, 970, 30, 970);
    fb.forEach((f, i) => {
      const a = r() * Math.PI;
      for (const sgn of [-1, 1]) taper(ctx, walk(S, f.x + Math.cos(a) * 30 * sgn, f.y + Math.sin(a) * 30 * sgn, a + (sgn < 0 ? Math.PI : 0), 50 + r() * 50, 8, 0.4), 5, 0.5, "rgba(170,110,180,0.55)");
      blobPath(ctx, f.x, f.y, 34, 11, a, 0.12, r); ctx.fillStyle = "rgba(180,120,190,0.55)"; ctx.fill();
      nucleus(S, f.x, f.y, 15, 6.5, a, "#5A3A99", { nucleolus: "#2d1760" });
      f.kind = "fb";
    });
    const mac = poisson(S, 8, 400, (c) => ({ ...c, rad: 30, gap: 12 }), 80, 920, 80, 920).filter((m) => fb.every((f) => Math.hypot(f.x - m.x, f.y - m.y) > 60));
    mac.forEach((m) => {
      blobPath(ctx, m.x, m.y, 24, 20, r() * TAU, 0.3, r); ctx.fillStyle = "rgba(160,95,160,0.7)"; ctx.fill();
      for (let i = 0; i < 6; i++) { ctx.fillStyle = "rgba(90,40,70,0.6)"; ctx.beginPath(); ctx.arc(m.x + (r() - 0.5) * 26, m.y + (r() - 0.5) * 22, 2 + r() * 2, 0, TAU); ctx.fill(); }
      nucleus(S, m.x + 5, m.y - 3, 8, 7, 0, "#2f1766");
    });
    const mast = poisson(S, 5, 300, (c) => ({ ...c, rad: 25, gap: 10 }), 100, 900, 100, 900).filter((m) => fb.concat(mac).every((f) => Math.hypot(f.x - m.x, f.y - m.y) > 60));
    mast.forEach((m) => {
      blobPath(ctx, m.x, m.y, 22, 16, r() * TAU, 0.1, r); ctx.fillStyle = "rgba(170,120,200,0.5)"; ctx.fill();
      ctx.fillStyle = "#3a1a6e"; for (let i = 0; i < 60; i++) { const a = r() * TAU, d = Math.sqrt(r()); ctx.beginPath(); ctx.arc(m.x + Math.cos(a) * 20 * d, m.y + Math.sin(a) * 14 * d, 1.8, 0, TAU); ctx.fill(); }
    });
    const f0 = nearest(fb, 500, 500);
    L.push({ x: f0.x, y: f0.y, t: "Фибробласт — отростчатая клетка, светлое овальное ядро" });
    if (mac[0]) L.push({ x: mac[0].x, y: mac[0].y, t: "Макрофаг (гистиоцит) — неровный контур, тёмное ядро" });
    if (mast[0]) L.push({ x: mast[0].x, y: mast[0].y, t: "Тучная клетка — метахроматические гранулы" });
    L.push({ x: 250, y: 300, t: "Коллагеновые волокна — широкие, извитые, оксифильные" });
    L.push({ x: 720, y: 760, t: "Эластические волокна — тонкие, ветвятся, тёмные" });
    L.push({ x: 800, y: 250, t: "Основное аморфное вещество" });
    return L;
  };

  R.tendon = (S) => {
    const { ctx, r } = S;
    bg(S, "#ECA2BF");
    let y = -20; const septa = [];
    while (y < 1030) {
      const h = 150 + r() * 90; septa.push(y);
      for (let fy = y + 6; fy < y + h - 4; fy += 5) {
        const pts = []; const ph = r() * TAU, amp = 2.2 + r() * 1.5;
        for (let x = -20; x <= 1020; x += 12) pts.push([x, fy + amp * Math.sin(x / 26 + ph)]);
        strokePts(ctx, pts, 3.2, r() < 0.5 ? "rgba(226,130,168,0.8)" : "rgba(244,186,208,0.8)");
      }
      for (let ry = y + 14; ry < y + h - 10; ry += 18 + r() * 10) for (let x = r() * 60; x < 1040; x += 55 + r() * 40) nucleus(S, x, ry, 16 + r() * 6, 2.8, (r() - 0.5) * 0.05, "#3E236F", { speck: false, jit: 0.05 });
      y += h;
    }
    septa.forEach((sy) => { const pts = []; for (let x = -20; x <= 1020; x += 12) pts.push([x, sy + 4 * Math.sin(x / 80)]); strokePts(ctx, pts, 7, "rgba(250,232,240,0.95)"); for (let x = r() * 100; x < 1000; x += 120 + r() * 80) nucleus(S, x, sy + 4 * Math.sin(x / 80), 9, 3, 0, "#553589"); });
    const s2 = septa.find((v) => v > 400) || 500;
    return [
      { x: 520, y: (s2 + (septa.find((v) => v > s2) || s2 + 200)) / 2 - 20, t: "Пучок коллагеновых волокон I порядка" },
      { x: 300, y: s2 + 4 * Math.sin(300 / 80), t: "Эндотеноний — прослойки рыхлой соед. ткани" },
      { x: 700, y: s2 - 40, t: "Тендиноциты — вытянутые ядра рядами между волокнами" },
      { x: 250, y: s2 - 90, t: "Параллельные коллагеновые волокна (плотная оформленная ткань)" },
    ];
  };

  R.hyaline = (S) => {
    const { ctx, r } = S;
    const pc = (x) => 165 + 10 * Math.sin(x / 120);
    bg(S, "#CDB8DE"); grain(S, 3000, "#8f70b0");
    const top = []; for (let x = -20; x <= 1020; x += 10) top.push([x, pc(x)]);
    fillPoly(ctx, top.concat([[1020, -20], [-20, -20]]), "#EBB3C9");
    for (let fy = -10; fy < 170; fy += 7) { const pts = []; for (let x = -20; x <= 1020; x += 14) pts.push([x, fy + 3 * Math.sin(x / 40 + fy)]); strokePts(ctx, pts, 2.5, "rgba(214,120,160,0.6)"); }
    for (let i = 0; i < 40; i++) nucleus(S, r() * 1000, 20 + r() * 130, 15, 3, 0, "#43277A", { speck: false });
    const young = [];
    for (let x = 30; x < 1000; x += 55 + r() * 30) { const y = pc(x) + 35 + r() * 60; young.push({ x, y });
      blobPath(ctx, x, y, 20, 7, 0, 0.1, r); ctx.fillStyle = "#EFE6F4"; ctx.fill(); nucleus(S, x, y, 9, 4, 0, "#3E2273"); }
    const groups = poisson(S, 30, 700, (c) => ({ ...c, rad: 48, gap: 30 }), -20, 1020, 330, 1030);
    groups.forEach((g) => {
      const gr = ctx.createRadialGradient(g.x, g.y, 5, g.x, g.y, 62);
      gr.addColorStop(0, "rgba(120,80,170,0.55)"); gr.addColorStop(1, "rgba(120,80,170,0)");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(g.x, g.y, 62, 0, TAU); ctx.fill();
      const n = 2 + Math.floor(r() * 3), a0 = r() * TAU;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * TAU, x = g.x + Math.cos(a) * (n > 2 ? 17 : 13), y = g.y + Math.sin(a) * (n > 2 ? 17 : 13);
        blobPath(ctx, x, y, 14, 11, a, 0.08, r); ctx.fillStyle = "#F4EEF8"; ctx.fill();
        blobPath(ctx, x, y, 10, 8, a, 0.2, r); ctx.fillStyle = "rgba(190,160,215,0.9)"; ctx.fill();
        nucleus(S, x, y, 4.5, 4, 0, "#301866");
      }
    });
    const g0 = nearest(groups, 500, 560);
    let far = { x: 500, y: 700 }, fd = -1;
    for (let i = 0; i < 300; i++) { const x = 200 + r() * 600, y = 420 + r() * 450; const m = Math.min(...groups.map((g) => Math.hypot(g.x - x, g.y - y))); if (m > fd) { fd = m; far = { x, y }; } }
    return [
      { x: 500, y: 80, t: "Надхрящница (волокнистый и хондрогенный слои)" },
      { x: young[5]?.x ?? 400, y: young[5]?.y ?? 230, t: "Молодые хондроциты — уплощённые, поодиночке" },
      { x: g0.x, y: g0.y, t: "Изогенная группа хондроцитов" },
      { x: g0.x + 44, y: g0.y + 30, t: "Территориальный матрикс — базофильный ободок" },
      { x: far.x, y: far.y, t: "Интертерриториальный матрикс" },
    ];
  };

  R.elastic = (S) => {
    const { ctx, r } = S;
    bg(S, "#EFDAD0"); grain(S, 2000, "#a0685a");
    const pc = (x) => 150 + 8 * Math.sin(x / 100);
    const top = []; for (let x = -20; x <= 1020; x += 10) top.push([x, pc(x)]);
    fillPoly(ctx, top.concat([[1020, -20], [-20, -20]]), "#E9C5C0");
    for (let i = 0; i < 30; i++) nucleus(S, r() * 1000, 20 + r() * 120, 14, 3, 0, "#5a3a5a", { speck: false });
    const cells = poisson(S, 80, 900, (c) => ({ ...c, rad: 26, gap: 22 }), -20, 1020, 200, 1030);
    for (let i = 0; i < 900; i++) {
      const x = r() * 1040 - 20, y = 170 + r() * 860;
      strokePts(ctx, walk(S, x, y, r() * TAU, 30 + r() * 70, 6, 0.9), 1.1 + r() * 0.9, `rgba(${95 + r() * 30},30,40,${0.55 + r() * 0.35})`);
    }
    cells.forEach((c) => {
      const pair = r() < 0.35, n = pair ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const x = c.x + (pair ? (i ? 11 : -11) : 0), y = c.y;
        blobPath(ctx, x, y, 13, 11, 0, 0.1, r); ctx.fillStyle = "#F7EEEA"; ctx.fill();
        blobPath(ctx, x, y, 9, 8, 0, 0.2, r); ctx.fillStyle = "rgba(210,170,170,0.9)"; ctx.fill();
        nucleus(S, x, y, 4.5, 4, 0, "#4a2440");
      }
    });
    const c0 = nearest(cells, 480, 520);
    return [
      { x: 500, y: 70, t: "Надхрящница" },
      { x: c0.x, y: c0.y, t: "Хондроцит в лакуне (группы по 2–4 клетки мелкие)" },
      { x: 700, y: 700, t: "Сеть эластических волокон (орсеин — коричнево-красные)" },
      { x: c0.x + 30, y: c0.y + 45, t: "Межклеточное вещество, пронизанное волокнами" },
    ];
  };

  R.bone = (S) => {
    const { ctx, r } = S;
    bg(S, "#D6CBB2"); grain(S, 3000, "#6b5a40");
    for (let i = 0; i < 16; i++) {
      const cx = r() * 1400 - 200, cy = r() * 1400 - 200, R0 = 250 + r() * 300, a0 = r() * TAU;
      for (let k = 0; k < 8; k++) { ctx.beginPath(); ctx.arc(cx, cy, R0 + k * 9, a0, a0 + 0.8 + r()); ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(110,90,60,0.35)"; ctx.stroke(); }
    }
    const ost = poisson(S, 14, 1200, (c) => ({ ...c, rad: 105 + r() * 50, gap: 6 }), -60, 1060, -60, 1060);
    ost.forEach((o) => {
      ctx.beginPath(); ctx.arc(o.x, o.y, o.rad, 0, TAU); ctx.fillStyle = "#E2D8C2"; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(80,60,35,0.75)"; ctx.stroke();
      for (let rr = 30; rr < o.rad - 4; rr += 9 + r() * 3) { ctx.beginPath(); ctx.arc(o.x, o.y, rr, 0, TAU); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(120,100,70,0.35)"; ctx.stroke(); }
      for (let rr = 38; rr < o.rad - 8; rr += 20) {
        const n = Math.floor((TAU * rr) / 42), a0 = r() * TAU;
        for (let i = 0; i < n; i++) {
          const a = a0 + (i / n) * TAU + (r() - 0.5) * 0.1, x = o.x + Math.cos(a) * rr, y = o.y + Math.sin(a) * rr;
          ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
          ctx.beginPath(); ctx.ellipse(0, 0, 7, 2.6, 0, 0, TAU); ctx.fillStyle = "#2d2319"; ctx.fill();
          ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(45,35,25,0.8)";
          for (let j = 0; j < 7; j++) { const b = r() * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(b) * (6 + r() * 7), Math.sin(b) * (7 + r() * 9)); ctx.stroke(); }
          ctx.restore();
        }
      }
      o.cr = 16 + r() * 9;
      blobPath(ctx, o.x, o.y, o.cr, o.cr * 0.9, r(), 0.12, r); ctx.fillStyle = "#3a2e22"; ctx.fill();
    });
    const o0 = nearest(ost, 480, 480), o1 = ost.filter((o) => o !== o0).sort((a, b) => Math.hypot(a.x - o0.x, a.y - o0.y) - Math.hypot(b.x - o0.x, b.y - o0.y))[0];
    if (o1) { ctx.lineWidth = 8; ctx.strokeStyle = "rgba(60,46,34,0.75)"; ctx.beginPath(); ctx.moveTo(o0.x, o0.y); ctx.lineTo(o1.x, o1.y); ctx.stroke(); }
    let far = { x: 500, y: 500 }, fd = -1;
    for (let i = 0; i < 400; i++) { const x = 150 + r() * 700, y = 150 + r() * 700; const m = Math.min(...ost.map((o) => Math.hypot(o.x - x, o.y - y) - o.rad)); if (m > fd) { fd = m; far = { x, y }; } }
    return [
      { x: o0.x, y: o0.y, t: "Центральный (гаверсов) канал" },
      { x: o0.x + o0.rad * 0.55, y: o0.y, t: "Концентрические костные пластинки остеона" },
      { x: o0.x, y: o0.y - 38, t: "Лакуна остеоцита с костными канальцами" },
      { x: o0.x - o0.rad * 0.71, y: o0.y + o0.rad * 0.71, t: "Спайная (цементирующая) линия" },
      o1 && { x: (o0.x + o1.x) / 2, y: (o0.y + o1.y) / 2, t: "Прободающий (фолькманов) канал" },
      { x: far.x, y: far.y, t: "Вставочные пластинки" },
    ].filter(Boolean);
  };

  R.blood = (S) => {
    const { ctx, r } = S;
    bg(S, "#F4EDEF");
    const W = { neu: [500, 470, 34], eos: [270, 300, 36], lym: [720, 320, 26], mon: [320, 720, 42], bas: [730, 700, 30] };
    const plt = [[560, 760], [180, 520], [860, 480]];
    const rbc = poisson(S, 400, 3000, (c) => ({ ...c, rad: 16 + r() * 2, gap: -3 }), -20, 1020, -20, 1020)
      .filter((c) => Object.values(W).every((w) => Math.hypot(w[0] - c.x, w[1] - c.y) > w[2] + 20) && plt.every((p) => Math.hypot(p[0] - c.x, p[1] - c.y) > 30));
    rbc.forEach((c) => {
      const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, c.rad);
      g.addColorStop(0, "#F3D2D7"); g.addColorStop(0.45, "#EFB8C1"); g.addColorStop(1, "#DC8494");
      ctx.beginPath(); ctx.arc(c.x, c.y, c.rad, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 0.8; ctx.strokeStyle = "rgba(170,70,90,0.35)"; ctx.stroke();
    });
    const cyto = (w, col, jit = 0.05) => { blobPath(ctx, w[0], w[1], w[2], w[2] * 0.95, r(), jit, r); ctx.fillStyle = col; ctx.fill(); };
    const gran = (w, n, col, sz) => { ctx.fillStyle = col; for (let i = 0; i < n; i++) { const a = r() * TAU, d = Math.sqrt(r()) * w[2] * 0.88; ctx.beginPath(); ctx.arc(w[0] + Math.cos(a) * d, w[1] + Math.sin(a) * d, sz * (0.7 + r() * 0.5), 0, TAU); ctx.fill(); } };
    // нейтрофил
    cyto(W.neu, "#EBD9E6"); gran(W.neu, 140, "rgba(200,140,180,0.6)", 1.2);
    [[-14, -8], [-2, 8], [12, -4], [20, 12]].forEach((p, i, arr) => {
      if (i) { ctx.lineWidth = 3; ctx.strokeStyle = "#4B2C8C"; ctx.beginPath(); ctx.moveTo(W.neu[0] + arr[i - 1][0], W.neu[1] + arr[i - 1][1]); ctx.lineTo(W.neu[0] + p[0], W.neu[1] + p[1]); ctx.stroke(); }
      nucleus(S, W.neu[0] + p[0], W.neu[1] + p[1], 10, 8, r(), "#4B2C8C");
    });
    // эозинофил
    cyto(W.eos, "#F0D8D0"); gran(W.eos, 170, "#E0643C", 2.4);
    nucleus(S, W.eos[0] - 12, W.eos[1] - 4, 12, 9, 0.4, "#46298a"); nucleus(S, W.eos[0] + 13, W.eos[1] - 2, 12, 9, -0.4, "#46298a");
    // лимфоцит
    cyto(W.lym, "#A9C0E6"); nucleus(S, W.lym[0] - 2, W.lym[1], 21, 20, 0, "#3A2272", { jit: 0.05 });
    // моноцит
    cyto(W.mon, "#BDBCD9", 0.12); gran(W.mon, 40, "rgba(150,130,190,0.4)", 1.2);
    ctx.save(); ctx.translate(W.mon[0], W.mon[1]);
    ctx.beginPath(); ctx.arc(0, 0, 25, 0.5, TAU - 0.5); ctx.arc(22, 0, 9, Math.PI + 1.2, Math.PI - 1.2, true); ctx.closePath(); ctx.fillStyle = "#6A4FA0"; ctx.fill(); ctx.restore();
    // базофил
    cyto(W.bas, "#D9C9E4"); nucleus(S, W.bas[0], W.bas[1], 15, 12, 0, "#6a4aa3"); gran(W.bas, 55, "#2E1A5C", 3);
    plt.forEach((p) => { for (let i = 0; i < 5; i++) { blobPath(ctx, p[0] + (r() - 0.5) * 18, p[1] + (r() - 0.5) * 18, 3.6, 3, r(), 0.3, r); ctx.fillStyle = "#8C5BB0"; ctx.fill(); } });
    const e0 = nearest(rbc, 520, 250);
    return [
      { x: W.neu[0], y: W.neu[1], t: "Сегментоядерный нейтрофил (3–5 сегментов)" },
      { x: W.eos[0], y: W.eos[1], t: "Эозинофил — двудольчатое ядро, оранжевые гранулы" },
      { x: W.lym[0], y: W.lym[1], t: "Лимфоцит — крупное круглое ядро, узкий ободок цитоплазмы" },
      { x: W.mon[0], y: W.mon[1], t: "Моноцит — бобовидное ядро, дымчатая цитоплазма" },
      { x: W.bas[0], y: W.bas[1], t: "Базофил — крупные тёмные гранулы закрывают ядро" },
      { x: plt[0][0], y: plt[0][1], t: "Тромбоциты (кровяные пластинки)" },
      { x: e0.x, y: e0.y, t: "Эритроцит — двояковогнутый диск без ядра" },
    ];
  };

  R.adipose = (S) => {
    const { ctx, r } = S;
    bg(S, "#FBF6F8");
    const seeds = jitterGrid(S, 118, 0.38, true); const vq = makeVor(seeds, 130);
    raster(S, (x, y) => { const q = vq(x + 3 * Math.sin(y / 30), y + 3 * Math.sin(x / 27)), e = q[2] - q[1]; if (e < 3.2) return [214, 128, 164, 1 - e / 5]; return null; });
    const L = []; let nucPt = null;
    seeds.forEach((s, i) => {
      if (r() > 0.28) return;
      const a = r() * TAU; let d = 10;
      while (d < 140) { const q = vq(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d); if (q[0] !== i) break; d += 3; }
      d -= 6; const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
      nucleus(S, x, y, 14, 4.2, a + Math.PI / 2, "#46297D", { jit: 0.05 });
      if (!nucPt && Math.hypot(x - 520, y - 480) < 200) nucPt = { x, y };
    });
    for (let i = 0; i < 16; i++) { const s = seeds[Math.floor(r() * seeds.length)]; ctx.fillStyle = "#D6475F"; ctx.beginPath(); ctx.arc(s.x + 58, s.y + 34, 4, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(s.x + 63, s.y + 28, 4, 0, TAU); ctx.fill(); }
    const c = nearest(seeds, 480, 520);
    return [
      { x: c.x, y: c.y, t: "Адипоцит — жир растворён при проводке, остаётся «пустота»" },
      nucPt && { ...nucPt, t: "Ядро оттеснено к периферии — «перстневидная» клетка" },
      { x: c.x + 58, y: c.y + 34, t: "Капилляр в прослойке между адипоцитами" },
      { x: c.x - 55, y: c.y - 5, t: "Тонкий ободок цитоплазмы и плазмолемма" },
    ].filter(Boolean);
  };

  function bands(S, o) {
    const { ctx, r } = S; const fibers = [];
    let y = -30;
    while (y < 1040) { const h = o.h0 + r() * o.hj, sl = (r() - 0.5) * 0.04; fibers.push({ y, h, sl }); y += h + o.gap + r() * o.gap; }
    return fibers;
  }

  R.skeletal = (S) => {
    const { ctx, r } = S;
    bg(S, "#F6E6EE");
    const fibers = bands(S, { h0: 72, hj: 30, gap: 7 });
    fibers.forEach((f, fi) => {
      const poly = [[-30, f.y], [1030, f.y + 1060 * f.sl], [1030, f.y + f.h + 1060 * f.sl], [-30, f.y + f.h]];
      fillPoly(ctx, poly, fi % 2 ? "#DB7BA0" : "#E187AA");
      ctx.save(); ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.clip();
      ctx.strokeStyle = "rgba(120,30,80,0.42)"; ctx.lineWidth = 2.2;
      const off = r() * 5;
      for (let x = -30 + off; x < 1030; x += 5.6) { ctx.beginPath(); ctx.moveTo(x, f.y - 5); ctx.lineTo(x + 1.2, f.y + f.h + 60); ctx.stroke(); }
      ctx.restore();
      for (const edge of [0, 1]) for (let x = r() * 80; x < 1040; x += 70 + r() * 90) {
        const yy = f.y + 1060 * f.sl * (x / 1060) + (edge ? f.h - 5 : 5);
        nucleus(S, x, yy, 15, 3.8, Math.atan(f.sl), "#3F2272", { jit: 0.05 });
      }
      f.cy = f.y + f.h / 2;
    });
    fibers.forEach((f) => { for (let x = r() * 200; x < 1000; x += 250 + r() * 200) nucleus(S, x, f.y - 4, 10, 2.4, 0, "#5a3a92", { speck: false }); });
    const f0 = fibers.reduce((a, b) => (Math.abs(b.cy - 500) < Math.abs(a.cy - 500) ? b : a));
    return [
      { x: 520, y: f0.cy, t: "Мышечное волокно — симпласт, поперечная исчерченность" },
      { x: 300, y: f0.y + 5 + 300 * f0.sl, t: "Ядра на периферии, под сарколеммой" },
      { x: 700, y: f0.y - 4, t: "Эндомизий между волокнами" },
      { x: 460, y: f0.cy + 20, t: "Тёмные A-диски и светлые I-диски" },
    ];
  };

  R.smooth = (S) => {
    const { ctx, r } = S;
    bg(S, "#E7A2BD");
    const cells = [];
    for (let i = 0; i < 380; i++) cells.push({ x: r() * 1200 - 100, y: r() * 1100 - 50, L: 170 + r() * 110, w: 15 + r() * 7, a: (r() - 0.5) * 0.14 + 0.08, t: r() });
    cells.forEach((c) => {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
      ctx.beginPath(); ctx.moveTo(-c.L / 2, 0); ctx.quadraticCurveTo(0, -c.w, c.L / 2, 0); ctx.quadraticCurveTo(0, c.w, -c.L / 2, 0);
      ctx.fillStyle = `rgb(${222 + c.t * 20},${130 + c.t * 25},${165 + c.t * 20})`; ctx.fill();
      ctx.lineWidth = 0.8; ctx.strokeStyle = "rgba(170,70,110,0.35)"; ctx.stroke(); ctx.restore();
    });
    const shown = cells.filter((c) => c.x > -50 && c.x < 1050 && c.y > -20 && c.y < 1020);
    shown.forEach((c) => { if (c.t < 0.75) nucleus(S, c.x, c.y, 21, 3.4, c.a, "#40247A", { jit: 0.03 }); });
    const c0 = nearest(shown.filter((c) => c.t < 0.75), 500, 500);
    return [
      { x: c0.x, y: c0.y, t: "Палочковидное ядро в центре миоцита" },
      { x: c0.x + Math.cos(c0.a) * c0.L * 0.32, y: c0.y + Math.sin(c0.a) * c0.L * 0.32, t: "Гладкий миоцит — веретеновидная клетка" },
      { x: 250, y: 780, t: "Клетки лежат со смещением: концы вклиниваются между соседями" },
      { x: 760, y: 250, t: "Исчерченности нет" },
    ];
  };

  R.cardiac = (S) => {
    const { ctx, r } = S;
    bg(S, "#F6E6EE");
    const fibers = bands(S, { h0: 64, hj: 26, gap: 14 });
    fibers.forEach((f, fi) => {
      const poly = [[-30, f.y], [1030, f.y + 1060 * f.sl], [1030, f.y + f.h + 1060 * f.sl], [-30, f.y + f.h]];
      fillPoly(ctx, poly, "#DE86A8");
      const nx = fibers[fi + 1];
      if (nx) for (let x = 60 + r() * 200; x < 1000; x += 280 + r() * 200) {
        const y1 = f.y + f.h + f.sl * x - 4, y2 = nx.y + nx.sl * (x + 60) + 4;
        fillPoly(ctx, [[x, y1], [x + 45, y1], [x + 95, y2], [x + 50, y2]], "#DE86A8");
      }
    });
    fibers.forEach((f) => {
      ctx.save(); ctx.beginPath(); ctx.rect(-30, f.y, 1080, f.h + 40); ctx.clip();
      ctx.strokeStyle = "rgba(130,40,90,0.2)"; ctx.lineWidth = 1.8;
      for (let x = r() * 5; x < 1030; x += 6) { ctx.beginPath(); ctx.moveTo(x, f.y); ctx.lineTo(x, f.y + f.h + 40); ctx.stroke(); }
      ctx.restore();
      let x = r() * 60; f.discs = []; f.nucs = [];
      while (x < 1040) {
        const cl = 120 + r() * 60;
        const cx = x + cl / 2, cy = f.y + f.h / 2 + f.sl * cx;
        ctx.beginPath(); ctx.ellipse(cx, cy, 30, 7, Math.atan(f.sl), 0, TAU); ctx.fillStyle = "rgba(246,220,232,0.9)"; ctx.fill();
        nucleus(S, cx, cy, 12, 6.5, Math.atan(f.sl), "#46297D");
        if (r() < 0.15) nucleus(S, cx + 26, cy, 11, 6, Math.atan(f.sl), "#46297D");
        f.nucs.push({ x: cx, y: cy });
        x += cl;
        const pts = []; let yy = f.y + f.sl * x, xx = x;
        pts.push([xx, yy]);
        while (yy < f.y + f.h + f.sl * x) { yy += 9; pts.push([xx, yy]); xx += (r() < 0.5 ? 6 : -6); pts.push([xx, yy]); }
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.lineWidth = 2.6; ctx.strokeStyle = "#5A1E52"; ctx.stroke();
        f.discs.push({ x, y: f.y + f.h / 2 + f.sl * x });
      }
    });
    const f0 = fibers.reduce((a, b) => (Math.abs(b.y + b.h / 2 - 500) < Math.abs(a.y + a.h / 2 - 500) ? b : a));
    const d0 = nearest(f0.discs, 560, 500), n0 = nearest(f0.nucs, 380, 500);
    return [
      { ...d0, t: "Вставочный диск — ступенчатая граница кардиомиоцитов" },
      { ...n0, t: "Ядро в центре клетки, светлая перинуклеарная зона" },
      { x: 520, y: f0.y + f0.h + 30, t: "Анастомозы — функциональный синцитий" },
      { x: n0.x + 60, y: n0.y + 18, t: "Поперечная исчерченность (слабее, чем в скелетной)" },
    ];
  };

  R.neurons = (S) => {
    const { ctx, r } = S;
    bg(S, "#ECDDEB"); grain(S, 3000, "#9a7ab8");
    for (let i = 0; i < 25; i++) strokePts(ctx, walk(S, r() * 1000, r() * 1000, r() * TAU, 400, 14, 0.25), 1.5, "rgba(140,110,180,0.35)");
    for (let i = 0; i < 520; i++) nucleus(S, r() * 1000, r() * 1000, 4 + r() * 2.5, 3.5 + r() * 2, r() * TAU, "rgba(80,50,140,0.85)", { speck: false });
    const N = [[480, 470, 58], [210, 230, 44], [790, 300, 46], [260, 760, 42], [760, 770, 48]];
    const L = [];
    N.forEach((n, ni) => {
      const [x, y, s] = n, np = 5 + Math.floor(r() * 2), a0 = r() * TAU;
      const axI = Math.floor(r() * np); let axPt = null, denPt = null;
      for (let i = 0; i < np; i++) {
        const a = a0 + (i / np) * TAU + (r() - 0.5) * 0.4;
        const sx = x + Math.cos(a) * s * 0.7, sy = y + Math.sin(a) * s * 0.7;
        if (i === axI) {
          fillPoly(ctx, [[x + Math.cos(a - 0.35) * s * 0.7, y + Math.sin(a - 0.35) * s * 0.7], [x + Math.cos(a) * s * 1.35, y + Math.sin(a) * s * 1.35], [x + Math.cos(a + 0.35) * s * 0.7, y + Math.sin(a + 0.35) * s * 0.7]], "rgba(200,180,225,0.95)");
          const p = walk(S, x + Math.cos(a) * s * 1.3, y + Math.sin(a) * s * 1.3, a, 320, 12, 0.12);
          strokePts(ctx, p, 2.2, "rgba(150,120,190,0.8)");
          axPt = { x: x + Math.cos(a) * s * 1.05, y: y + Math.sin(a) * s * 1.05 };
        } else {
          const p = walk(S, sx, sy, a, 120 + r() * 180, 10, 0.3);
          taper(ctx, p, s * 0.42, 1.2, "#7B5AA8");
          if (!denPt) denPt = { x: p[4][0], y: p[4][1] };
          const b = p[Math.floor(p.length * 0.45)];
          taper(ctx, walk(S, b[0], b[1], a + (r() < 0.5 ? 0.7 : -0.7), 90 + r() * 80, 10, 0.4), s * 0.16, 0.8, "#7B5AA8");
        }
      }
      blobPath(ctx, x, y, s, s * 0.85, r(), 0.18, r); ctx.fillStyle = "#7B5AA8"; ctx.fill();
      ctx.fillStyle = "rgba(55,25,110,0.8)";
      for (let i = 0; i < s * 5; i++) { const a = r() * TAU, d = Math.sqrt(r()) * s * 0.9; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.85, 2 + r() * 2.2, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, s * 0.36, 0, TAU); ctx.fillStyle = "#E7DCF1"; ctx.fill();
      ctx.beginPath(); ctx.arc(x + 3, y - 2, s * 0.1, 0, TAU); ctx.fillStyle = "#2c1461"; ctx.fill();
      if (ni === 0) {
        L.push({ x: x + 3, y: y - 2, t: "Ядрышко в светлом крупном ядре" });
        L.push({ x: x - s * 0.55, y: y + s * 0.3, t: "Хроматофильная субстанция (тельца Ниссля)" });
        if (axPt) L.push({ ...axPt, t: "Аксонный холмик — без базофильного вещества" });
        if (denPt) L.push({ ...denPt, t: "Дендрит — содержит тельца Ниссля" });
      }
    });
    L.push({ x: 620, y: 600, t: "Ядра глиоцитов" });
    L.push({ x: 210, y: 230, t: "Мультиполярный нейрон (мотонейрон переднего рога)" });
    return L;
  };

  R.nerve = (S) => {
    const { ctx, r } = S;
    bg(S, "#E4D7B6"); grain(S, 2500, "#7d6a40");
    for (let i = 0; i < 25; i++) strokePts(ctx, walk(S, r() * 1000, r() * 1000, r() * TAU, 300, 14, 0.4), 4, "rgba(200,180,140,0.5)");
    const F = [[430, 420, 250], [790, 690, 165], [230, 800, 140]];
    F.forEach(([x, y, rad]) => {
      blobPath(ctx, x, y, rad, rad * 0.92, r(), 0.06, r); ctx.fillStyle = "#EFE7D2"; ctx.fill();
      for (let k = 0; k < 3; k++) { blobPath(ctx, x, y, rad + k * 4, rad * 0.92 + k * 4, 0, 0.06, rng(7)); ctx.lineWidth = 2.2; ctx.strokeStyle = "rgba(120,90,50,0.7)"; ctx.stroke(); }
      const fibs = poisson(S, 400, 2400, (c) => ({ ...c, rad: 4 + r() * 6, gap: 5 }), x - rad, x + rad, y - rad, y + rad).filter((c) => Math.hypot((c.x - x) / rad, (c.y - y) / (rad * 0.92)) < 0.9);
      fibs.forEach((c) => { ctx.beginPath(); ctx.arc(c.x, c.y, c.rad, 0, TAU); ctx.lineWidth = 1.6 + c.rad * 0.35; ctx.strokeStyle = "#1c1612"; ctx.stroke(); ctx.fillStyle = "#EDE4C8"; ctx.fill(); });
      F[F.indexOf(F.find((f) => f[0] === x))].fibs = fibs;
    });
    ctx.beginPath(); ctx.arc(720, 180, 42, 0, TAU); ctx.lineWidth = 9; ctx.strokeStyle = "rgba(160,120,80,0.8)"; ctx.stroke();
    ctx.fillStyle = "#b8604a"; for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc(720 + (r() - 0.5) * 50, 180 + (r() - 0.5) * 50, 5, 0, TAU); ctx.fill(); }
    const f0 = nearest(F[0].fibs, 460, 440);
    return [
      { x: f0.x, y: f0.y - f0.rad, t: "Миелиновая оболочка — чёрное кольцо (осмий)" },
      { x: f0.x, y: f0.y, t: "Осевой цилиндр (аксон) — светлый центр" },
      { x: 430 + 250, y: 420, t: "Периневрий вокруг пучка" },
      { x: 600, y: 890, t: "Эпиневрий — соединительная ткань между пучками" },
      { x: 720, y: 180, t: "Кровеносный сосуд в эпиневрии" },
      { x: 360, y: 500, t: "Эндоневрий между волокнами" },
    ];
  };

  /* ---------- публичный API ---------- */
  function render(id, canvas, opt = {}) {
    const cssSize = opt.size || canvas.clientWidth || 300;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(cssSize * dpr);
    canvas.width = W; canvas.height = W;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const z = opt.zoom || 1, k = (W * z) / 1000, ox = W / 2 - 500 * k;
    const S = { ctx, W, k, ox, z, r: rng(opt.seed || hashStr(id)) };
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, W);
    ctx.setTransform(k, 0, 0, k, ox, ox);
    const fn = R[id]; if (!fn) return [];
    let labels = fn(S) || [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(W / 2, W / 2, W * 0.32, W / 2, W / 2, W * 0.5);
    g.addColorStop(0, "rgba(30,10,40,0)"); g.addColorStop(1, "rgba(30,10,40,0.28)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
    return labels.map((l) => ({ ...l, px: (l.x * k + ox) / W, py: (l.y * k + ox) / W })).filter((l) => Math.hypot(l.px - 0.5, l.py - 0.5) < 0.46);
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  window.Slides = { render, ids: Object.keys(R) };
})();
