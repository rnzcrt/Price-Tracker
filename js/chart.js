"use strict";

window.PriceChart = {
  // Collapses a run of consecutive identical prices down to just its first
  // and last point — a flat stretch looks the same either way, but hourly
  // checks with no price change were plotting one dot per check. Keeps
  // every distinct price and the start/end time of each run.
  _collapseFlatRuns(history) {
    if (!history || history.length < 3) return history;
    const out = [history[0]];
    for (let i = 1; i < history.length - 1; i++) {
      const prev = history[i - 1].price;
      const cur  = history[i].price;
      const next = history[i + 1].price;
      if (cur !== prev || cur !== next) out.push(history[i]);
    }
    out.push(history[history.length - 1]);
    return out;
  },

  render(canvasId, rawHistory, targetPrice) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    if (!rawHistory || rawHistory.length < 2) { ctx.clearRect(0, 0, W, H); return; }

    const history = this._collapseFlatRuns(rawHistory);

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

    const xOf = i => pad.left + (prices.length === 1 ? chartW / 2 : (i / (prices.length - 1)) * chartW);
    const yOf = p => pad.top  + chartH - ((p - pLo) / (pHi - pLo)) * chartH;

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
    const cTipBg   = cs.getPropertyValue("--bg-2").trim()      || "#1a1f33";

    const fmt = n => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const fmtDate = d => d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });

    const minIdx = prices.indexOf(Math.min(...prices));
    const maxIdx = prices.indexOf(Math.max(...prices));

    // Draws one full frame. hoverIdx is null at rest, or the index under
    // the cursor — redrawn on every mousemove rather than layering a
    // separate tooltip on top.
    const draw = (hoverIdx) => {
      ctx.clearRect(0, 0, W, H);
      ctx.font      = "10px -apple-system, system-ui, sans-serif";
      ctx.textAlign = "right";

      // Y-axis grid + labels
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

      // Target price line
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

      // Area fill
      ctx.beginPath();
      ctx.moveTo(xOf(0), yOf(prices[0]));
      for (let i = 1; i < prices.length; i++) ctx.lineTo(xOf(i), yOf(prices[i]));
      ctx.lineTo(xOf(prices.length - 1), pad.top + chartH);
      ctx.lineTo(xOf(0), pad.top + chartH);
      ctx.closePath();
      ctx.fillStyle = cFill;
      ctx.fill();

      // Line
      ctx.beginPath();
      ctx.moveTo(xOf(0), yOf(prices[0]));
      for (let i = 1; i < prices.length; i++) ctx.lineTo(xOf(i), yOf(prices[i]));
      ctx.strokeStyle = cLine;
      ctx.lineWidth   = 2;
      ctx.lineJoin    = "round";
      ctx.stroke();

      // Dots + highlight min/max
      prices.forEach((p, i) => {
        const x  = xOf(i);
        const y  = yOf(p);
        const isMin = i === minIdx;
        const isMax = i === maxIdx;
        const isHover = i === hoverIdx;
        const r     = isHover ? 6 : (isMin || isMax ? 5 : 3);
        const fill  = isMin ? cLow : isMax ? cHigh : cLine;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle   = fill;
        ctx.fill();
        ctx.strokeStyle = cDot;
        ctx.lineWidth   = isHover ? 2 : 1.5;
        ctx.stroke();

        // skip the min/max label on the hovered point, tooltip covers it
        if ((isMin || isMax) && !isHover) {
          ctx.fillStyle   = fill;
          ctx.font        = "bold 10px -apple-system, system-ui, sans-serif";
          ctx.textAlign   = "center";
          const labelY    = isMin ? y + 14 : y - 8;
          ctx.fillText(fmt(p), x, labelY);
          ctx.font        = "10px -apple-system, system-ui, sans-serif";
        }
      });

      // X-axis date labels, skipping anything that would overlap or
      // repeat the label drawn right before it
      ctx.fillStyle = cText;
      ctx.textAlign = "center";
      ctx.font      = "10px -apple-system, system-ui, sans-serif";
      let lastLabelRight = -Infinity;
      let lastLabelText  = null;
      const tryLabel = (i) => {
        const x = xOf(i);
        const label = fmtDate(timestamps[i]);
        const w = ctx.measureText(label).width;
        if (x - w / 2 < lastLabelRight + 8) return; // would overlap or crowd the previous label
        if (label === lastLabelText) return;         // same calendar day as the previous label
        ctx.fillText(label, x, pad.top + chartH + 16);
        lastLabelRight = x + w / 2;
        lastLabelText  = label;
      };
      const maxLabels = 5;
      const step = Math.max(1, Math.ceil((prices.length - 1) / (maxLabels - 1)));
      for (let i = 0; i < prices.length - 1; i += step) tryLabel(i);
      tryLabel(prices.length - 1); // always attempt the most recent point, but it can still be skipped above

      // Hover tooltip: price + date, in a small box above the point
      if (hoverIdx != null) {
        const x = xOf(hoverIdx);
        const y = yOf(prices[hoverIdx]);
        const label1 = fmt(prices[hoverIdx]);
        const label2 = fmtDate(timestamps[hoverIdx]);
        ctx.font = "bold 11px -apple-system, system-ui, sans-serif";
        const w1 = ctx.measureText(label1).width;
        ctx.font = "10px -apple-system, system-ui, sans-serif";
        const w2 = ctx.measureText(label2).width;
        const boxW = Math.max(w1, w2) + 16;
        const boxH = 34;
        let boxX = x - boxW / 2;
        boxX = Math.max(2, Math.min(W - boxW - 2, boxX)); // keep the box on-canvas
        let boxY = y - boxH - 12;
        if (boxY < 2) boxY = y + 12; // flip below the point if it would run off the top

        ctx.fillStyle = cTipBg;
        ctx.strokeStyle = cGrid;
        ctx.lineWidth = 1;
        const r = 5;
        ctx.beginPath();
        ctx.moveTo(boxX + r, boxY);
        ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
        ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
        ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
        ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px -apple-system, system-ui, sans-serif";
        ctx.fillText(label1, boxX + boxW / 2, boxY + 14);
        ctx.fillStyle = cText;
        ctx.font = "10px -apple-system, system-ui, sans-serif";
        ctx.fillText(label2, boxX + boxW / 2, boxY + 27);
      }
    };

    draw(null);

    // Remove any previously-bound listener first — this canvas is reused
    // for a different product each time the history panel opens, so
    // without this, listeners would stack up across repeated opens.
    if (canvas._pwHoverMove)  canvas.removeEventListener("mousemove", canvas._pwHoverMove);
    if (canvas._pwHoverLeave) canvas.removeEventListener("mouseleave", canvas._pwHoverLeave);

    const onMove = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = W / rect.width;
      const mouseX = (evt.clientX - rect.left) * scaleX;
      let nearest = 0, nearestDist = Infinity;
      for (let i = 0; i < prices.length; i++) {
        const d = Math.abs(xOf(i) - mouseX);
        if (d < nearestDist) { nearestDist = d; nearest = i; }
      }
      draw(nearest);
      canvas.style.cursor = "pointer";
    };
    const onLeave = () => { draw(null); canvas.style.cursor = "default"; };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas._pwHoverMove  = onMove;
    canvas._pwHoverLeave = onLeave;
  }
};
