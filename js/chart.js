// chart.js – Price history line chart renderer (vanilla canvas, no dependencies)
"use strict";

window.PriceChart = {
  render(canvasId, history, targetPrice) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!history || history.length < 2) return;

    const prices     = history.map(e => e.price);
    const timestamps = history.map(e => new Date(e.timestamp));
    const minP       = Math.min(...prices);
    const maxP       = Math.max(...prices);
    const pad        = { top: 18, right: 16, bottom: 36, left: 60 };
    const chartW     = W - pad.left - pad.right;
    const chartH     = H - pad.top  - pad.bottom;

    // Price range with 10% padding
    const pRange = maxP - minP || maxP * 0.1 || 1;
    const pLo    = minP - pRange * 0.12;
    const pHi    = maxP + pRange * 0.12;

    const xOf = i   => pad.left + (i / (prices.length - 1)) * chartW;
    const yOf = p   => pad.top  + chartH - ((p - pLo) / (pHi - pLo)) * chartH;

    // CSS variable colors
    const cs       = getComputedStyle(document.documentElement);
    const cGrid    = cs.getPropertyValue("--border").trim()    || "#2a3045";
    const cText    = cs.getPropertyValue("--text-3").trim()    || "#636b88";
    const cLine    = cs.getPropertyValue("--accent").trim()    || "#4f7ef8";
    const cFill    = "rgba(79,126,248,0.10)";
    const cTarget  = "#f59e0b";
    const cLow     = cs.getPropertyValue("--green").trim()     || "#22c55e";
    const cHigh    = cs.getPropertyValue("--red").trim()       || "#f43f5e";
    const cDot     = "#ffffff";

    const fmt = n => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    ctx.font      = "10px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "right";

    // ── Y-axis grid + labels ──────────────────────────────────────
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const val = pLo + (pHi - pLo) * (i / yTicks);
      const y   = yOf(val);
      ctx.strokeStyle = cGrid;
      ctx.lineWidth   = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle   = cText;
      ctx.fillText(fmt(val), pad.left - 6, y + 3.5);
    }

    // ── Target price line ─────────────────────────────────────────
    if (targetPrice && targetPrice >= pLo && targetPrice <= pHi) {
      const ty = yOf(targetPrice);
      ctx.strokeStyle = cTarget;
      ctx.lineWidth   = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, ty); ctx.lineTo(pad.left + chartW, ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle   = cTarget;
      ctx.textAlign   = "left";
      ctx.fillText("Target", pad.left + 4, ty - 3);
      ctx.textAlign   = "right";
    }

    // ── Area fill ─────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(prices[0]));
    for (let i = 1; i < prices.length; i++) ctx.lineTo(xOf(i), yOf(prices[i]));
    ctx.lineTo(xOf(prices.length - 1), pad.top + chartH);
    ctx.lineTo(xOf(0), pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = cFill;
    ctx.fill();

    // ── Line ──────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(prices[0]));
    for (let i = 1; i < prices.length; i++) ctx.lineTo(xOf(i), yOf(prices[i]));
    ctx.strokeStyle = cLine;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = "round";
    ctx.stroke();

    // ── Dots + highlight min/max ──────────────────────────────────
    const minIdx = prices.indexOf(Math.min(...prices));
    const maxIdx = prices.indexOf(Math.max(...prices));

    prices.forEach((p, i) => {
      const x  = xOf(i);
      const y  = yOf(p);
      const isMin = i === minIdx;
      const isMax = i === maxIdx;
      const r     = isMin || isMax ? 5 : 3;
      const fill  = isMin ? cLow : isMax ? cHigh : cLine;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle   = fill;
      ctx.fill();
      ctx.strokeStyle = cDot;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Label min/max
      if (isMin || isMax) {
        ctx.fillStyle   = fill;
        ctx.font        = "bold 10px -apple-system, system-ui, sans-serif";
        ctx.textAlign   = "center";
        const labelY    = isMin ? y + 14 : y - 8;
        ctx.fillText(fmt(p), x, labelY);
        ctx.font        = "10px -apple-system, system-ui, sans-serif";
      }
    });

    // ── X-axis date labels ────────────────────────────────────────
    ctx.fillStyle = cText;
    ctx.textAlign = "center";
    const maxLabels = 5;
    const step      = Math.ceil(prices.length / maxLabels);
    for (let i = 0; i < prices.length; i += step) {
      const d = timestamps[i];
      const label = d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
      ctx.fillText(label, xOf(i), pad.top + chartH + 16);
    }
    // Always label last point
    const last = timestamps[timestamps.length - 1];
    ctx.fillText(
      last.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
      xOf(prices.length - 1), pad.top + chartH + 16
    );
  }
};
