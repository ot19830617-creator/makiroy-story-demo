(function () {
  "use strict";

  // 野球場の図（SVG）。画面処理のみ。計算は Stats の関数の結果を受け取る。
  var NS = "http://www.w3.org/2000/svg";
  var CX = 170;
  var CY = 290;

  function svgEl(name, attrs) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function pt(r, deg) {
    var a = deg * Math.PI / 180;
    return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
  }

  function f(p) {
    return p[0].toFixed(1) + " " + p[1].toFixed(1);
  }

  // 本塁を中心にした扇形（外野・内野の地面）
  function fan(r) {
    return "M " + CX + " " + CY + " L " + f(pt(r, -45)) + " A " + r + " " + r + " 0 0 1 " + f(pt(r, 45)) + " Z";
  }

  // 守備位置の丸の中心（図の座標系 340×300）。丸（半径30、枠線を含め直径64）が重ならないよう、
  // どの2つの位置も中心の距離を64以上にしてある（test.html で確認）。
  var SPOTS = {
    P: [170, 196], C: [170, 266],
    "1B": [243, 189], "3B": [97, 189], SS: [128, 128], "2B": [212, 128],
    LF: [60, 100], CF: [170, 75], RF: [280, 100]
  };
  var SHORT = { P: "投", C: "捕", "1B": "一", "2B": "二", "3B": "三", SS: "遊", LF: "左", CF: "中", RF: "右" };
  var NAME = { P: "ピッチャー", C: "キャッチャー", "1B": "ファースト", "2B": "セカンド", "3B": "サード", SS: "ショート", LF: "レフト", CF: "センター", RF: "ライト" };
  var INFIELD_CODES = ["P", "C", "1B", "2B", "3B", "SS"];
  var OUTFIELD_CODES = ["LF", "CF", "RF"];
  var ALL_CODES = INFIELD_CODES.concat(OUTFIELD_CODES);

  // 守った試合数に応じた丸の色（0.8以上＝濃い、0.3以上＝中、それ未満＝薄い、0＝白）
  function spotStyle(n, max) {
    var t = max > 0 ? n / max : 0;
    return {
      fill: n === 0 ? "#FFFFFF" : t >= 0.8 ? "#1D4ED8" : t >= 0.3 ? "#BFD3FB" : "#E3ECFD",
      color: t >= 0.8 && n > 0 ? "#FFFFFF" : n === 0 ? "#A1A1AA" : "#1E3A8A",
      stroke: n === 0 ? "#D4D4D8" : "#FFFFFF"
    };
  }

  function maxOf(map) {
    var max = 0;
    Object.keys(map).forEach(function (c) { if (map[c] > max) max = map[c]; });
    return max;
  }

  // どの2つの位置も、中心の距離が一定以上か調べるため、最小の距離を返す（テスト用）
  function minSpotDistance() {
    var min = Infinity;
    for (var i = 0; i < ALL_CODES.length; i++) {
      for (var j = i + 1; j < ALL_CODES.length; j++) {
        var a = SPOTS[ALL_CODES[i]];
        var b = SPOTS[ALL_CODES[j]];
        var d = Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
        if (d < min) min = d;
      }
    }
    return min;
  }

  // ホームの図：守った試合数。内野・投手・捕手の6つは必ず描き、外野は守った試合があるときだけ描く。
  // appear は { P: n, ... }（Stats.positionSummary の appear）。
  function positionFigure(appear, opts) {
    opts = opts || {};
    var svg = svgEl("svg", { viewBox: "-12 0 364 300", preserveAspectRatio: "xMidYMid meet", role: "img" });
    if (opts.height) svg.setAttribute("height", String(opts.height));
    if (opts.width) svg.setAttribute("width", String(opts.width));

    var codes = INFIELD_CODES.concat(OUTFIELD_CODES.filter(function (c) { return (appear[c] || 0) > 0; }));
    var max = maxOf(appear);

    svg.appendChild(svgEl("path", { d: fan(255), fill: "#E8F0E4" }));
    svg.appendChild(svgEl("path", { d: fan(125), fill: "#EFE6DA" }));

    codes.forEach(function (c) {
      var n = appear[c] || 0;
      var p = SPOTS[c];
      var st = spotStyle(n, max);
      svg.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: "30", fill: st.fill, stroke: st.stroke, "stroke-width": "3" }));
      var t1 = svgEl("text", {
        x: p[0], y: p[1] - 6, "text-anchor": "middle", fill: st.color,
        "font-family": "Noto Sans JP, Yu Gothic UI, Meiryo, sans-serif", "font-size": String(opts.nameSize || 16), "font-weight": "700"
      });
      t1.textContent = SHORT[c];
      svg.appendChild(t1);
      var t2 = svgEl("text", {
        x: p[0], y: p[1] + 20, "text-anchor": "middle", fill: st.color,
        "font-family": "Oswald, sans-serif", "font-size": String(opts.numSize || 24), "font-weight": "700"
      });
      t2.textContent = n === 0 ? "−" : String(n);
      svg.appendChild(t2);
    });
    // 読み上げ用：守った試合数の多い順（描いた位置だけ。0試合の位置も含む）
    var label = codes.slice().sort(function (a, b) { return (appear[b] || 0) - (appear[a] || 0); })
      .map(function (c) { return NAME[c] + (appear[c] || 0); });
    svg.setAttribute("aria-label", "守った試合数：" + label.join("、"));
    return svg;
  }

  // 守る画面の大きな図：9つの守備位置すべてを描き、丸の中に略称と割合（%）を出す。
  // counts は { P: n, ... }、total は全試合数（割合の分母）。
  function positionBig(counts, total, opts) {
    opts = opts || {};
    var svg = svgEl("svg", { viewBox: "-12 0 364 310", preserveAspectRatio: "xMidYMid meet", role: "img", "class": "field-big" });
    svg.appendChild(svgEl("path", { d: fan(255), fill: "#E8F0E4" }));
    svg.appendChild(svgEl("path", { d: fan(125), fill: "#EFE6DA" }));
    var max = maxOf(counts);
    var label = [];
    ALL_CODES.forEach(function (c) {
      var n = counts[c] || 0;
      var p = SPOTS[c];
      var st = spotStyle(n, max);
      var pct = total > 0 ? Math.round(n / total * 100) + "%" : "−";
      svg.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: "25", fill: st.fill, stroke: st.stroke, "stroke-width": "2" }));
      var t1 = svgEl("text", {
        x: p[0], y: p[1] - 3, "text-anchor": "middle", fill: st.color,
        "font-family": "Noto Sans JP, Yu Gothic UI, Meiryo, sans-serif", "font-size": "14", "font-weight": "700"
      });
      t1.textContent = SHORT[c];
      svg.appendChild(t1);
      var t2 = svgEl("text", {
        x: p[0], y: p[1] + 16, "text-anchor": "middle", fill: st.color,
        "font-family": "Oswald, sans-serif", "font-size": "16", "font-weight": "700"
      });
      t2.textContent = pct;
      svg.appendChild(t2);
      label.push(NAME[c] + n + "試合" + pct);
    });
    svg.setAttribute("aria-label", (opts.label || "守備位置") + "：" + label.join("、"));
    return svg;
  }

  // 打球方向のバブル図。dir は Stats.directionSummary の結果、mode は "all"（全打球）／"hit"（安打）／"out"（凡打・エラー）。
  // 円の面積は打球の数に比例（半径 = 7 + 20 × √(数 ÷ 最大の数)）。0本の方向は描かない。
  var BUBBLE_POS = {
    "左": [205, -32], "左中": [212, -16], "中": [218, 0], "右中": [212, 16], "右": [205, 32],
    "三": [90, -38], "遊": [125, -14], "二": [125, 14], "一": [90, 38], "投": [70, 0], "捕": [0, 0]
  };

  function bubbleCount(b, mode) {
    return mode === "hit" ? b.hits : mode === "out" ? b.outs + b.errors : b.total;
  }

  // 文字の幅の見積もり（図の座標）：全角＝文字の大きさ、数字・英字＝0.58倍、空白＝0.3倍
  function textWidth(text, size) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      w += c < 128 ? (text.charAt(i) === " " ? 0.3 : 0.58) * size : size;
    }
    return w;
  }

  function rectHitsCircle(box, c, pad) {
    var dx = Math.max(box.l - c.x, 0, c.x - box.r);
    var dy = Math.max(box.t - c.y, 0, c.y - box.b);
    return dx * dx + dy * dy < (c.r + pad) * (c.r + pad);
  }

  function rectsOverlap(a, b, pad) {
    return !(a.r + pad <= b.l || b.r + pad <= a.l || a.b + pad <= b.t || b.b + pad <= a.t);
  }

  // 円の外側に、文字（幅 w、高さ h）を置く位置を、候補（下・上・右・左・斜め。だんだん遠く）から順に調べて決める。
  // どの円・すでに置いた文字とも重ならず、図の枠の中に収まる最初の位置を返す。
  var LABEL_BOUNDS = { l: -12, r: 352, t: 4, b: 306 };

  function placeLabel(circle, w, h, circles, boxes) {
    var cands = [];
    for (var m = 0; m < 8; m++) {
      var rr = circle.r + 3 + m * 6;
      cands.push([0, rr + h * 0.85]);                              // 下
      cands.push([0, -(rr + 2)]);                                  // 上
      cands.push([rr + w / 2, h * 0.3]);                           // 右
      cands.push([-(rr + w / 2), h * 0.3]);                        // 左
      cands.push([(rr + w / 2) * 0.75, rr * 0.8 + h * 0.85]);      // 右下
      cands.push([-(rr + w / 2) * 0.75, rr * 0.8 + h * 0.85]);     // 左下
      cands.push([(rr + w / 2) * 0.75, -(rr * 0.8 + 2)]);          // 右上
      cands.push([-(rr + w / 2) * 0.75, -(rr * 0.8 + 2)]);         // 左上
    }
    for (var k = 0; k < cands.length; k++) {
      var x = circle.x + cands[k][0];
      var y = circle.y + cands[k][1];
      var box = { l: x - w / 2, r: x + w / 2, t: y - h * 0.85, b: y + h * 0.25 };
      if (box.l < LABEL_BOUNDS.l || box.r > LABEL_BOUNDS.r || box.t < LABEL_BOUNDS.t || box.b > LABEL_BOUNDS.b) continue;
      var bad = false;
      for (var i = 0; i < circles.length && !bad; i++) if (rectHitsCircle(box, circles[i], 1.5)) bad = true;
      for (var j = 0; j < boxes.length && !bad; j++) if (rectsOverlap(box, boxes[j], 1)) bad = true;
      if (!bad) return { x: x, y: y, box: box, ok: true };
    }
    var f0 = cands[0];
    var fx = circle.x + f0[0], fy = circle.y + f0[1];
    return { x: fx, y: fy, box: { l: fx - w / 2, r: fx + w / 2, t: fy - h * 0.85, b: fy + h * 0.25 }, ok: false };
  }

  // 打球方向の図の円（位置・半径・割合）を作る。
  function bubbleItems(dir, mode) {
    var names = Object.keys(BUBBLE_POS);
    var total = 0;
    var max = 0;
    names.forEach(function (k) {
      var n = bubbleCount(dir.byDir[k], mode);
      total += n;
      if (n > max) max = n;
    });
    var items = [];
    names.forEach(function (k) {
      var n = bubbleCount(dir.byDir[k], mode);
      if (n <= 0) return;
      var p = k === "捕" ? [CX, CY - 14] : pt(BUBBLE_POS[k][0], BUBBLE_POS[k][1]);
      var r = 7 + 20 * Math.sqrt(n / max);
      items.push({ key: k, n: n, x: p[0], y: p[1], r: r, inside: r >= 16, pct: Math.round(n / total * 100) + "%", name: k + " " + n + "本" });
    });
    return { items: items, total: total };
  }

  // 方向と本数の文字（と、小さい円の割合の文字）を、どの円にも重ならないように置く。数の多い円から順に決める。
  function layoutBubbleLabels(items) {
    var boxes = [];
    var labels = [];
    var fallback = 0;
    items.slice().sort(function (a, b) { return b.n - a.n; }).forEach(function (c) {
      if (!c.inside) {
        var pw = textWidth(c.pct, 12);
        var pp = placeLabel(c, pw, 12, items, boxes);
        boxes.push(pp.box);
        if (!pp.ok) fallback += 1;
        labels.push({ key: c.key, kind: "pct", text: c.pct, x: pp.x, y: pp.y, size: 12, box: pp.box });
      }
      var nw = textWidth(c.name, 11);
      var np = placeLabel(c, nw, 11, items, boxes);
      boxes.push(np.box);
      if (!np.ok) fallback += 1;
      labels.push({ key: c.key, kind: "name", text: c.name, x: np.x, y: np.y, size: 11, box: np.box });
    });
    return { labels: labels, fallback: fallback };
  }

  function bubbleFigure(dir, mode, opts) {
    opts = opts || {};
    var svg = svgEl("svg", { viewBox: "-12 0 364 310", preserveAspectRatio: "xMidYMid meet", role: "img", "class": "field-bubble" });
    svg.appendChild(svgEl("path", { d: fan(255), fill: "#E8F0E4" }));
    svg.appendChild(svgEl("path", { d: fan(125), fill: "#EFE6DA" }));
    svg.appendChild(svgEl("path", { d: "M " + CX + " " + CY + " L " + f(pt(255, -45)) + " M " + CX + " " + CY + " L " + f(pt(255, 45)), fill: "none", stroke: "#FFFFFF", "stroke-width": "2" }));
    svg.appendChild(svgEl("path", { d: "M " + f(pt(255, -45)) + " A 255 255 0 0 1 " + f(pt(255, 45)), fill: "none", stroke: "#B8C7B0", "stroke-width": "2" }));

    var b = bubbleItems(dir, mode);
    var fill = mode === "out" ? "#52525B" : "#C8102E";
    var label = [];
    b.items.forEach(function (c) {
      svg.appendChild(svgEl("circle", { cx: c.x.toFixed(1), cy: c.y.toFixed(1), r: c.r.toFixed(1), fill: fill, "fill-opacity": "0.85", stroke: "#FFFFFF", "stroke-width": "2" }));
      label.push(c.key + c.n + "本" + c.pct);
    });
    // 文字は、すべての円を描いたあとに重ねる。位置は、どの円にも重ならないように決める。
    b.items.forEach(function (c) {
      if (!c.inside) return;
      var tp = svgEl("text", {
        x: c.x.toFixed(1), y: (c.y + 5).toFixed(1), "text-anchor": "middle", fill: "#FFFFFF", "font-family": "Oswald, sans-serif",
        "font-size": String(c.r >= 22 ? 15 : 12), "font-weight": "700"
      });
      tp.textContent = c.pct;
      svg.appendChild(tp);
    });
    layoutBubbleLabels(b.items).labels.forEach(function (l) {
      var t = svgEl("text", {
        x: l.x.toFixed(1), y: l.y.toFixed(1), "text-anchor": "middle", "class": "bubble-label-" + l.kind,
        fill: l.kind === "pct" ? "#18181B" : "#3F3F46",
        "font-family": l.kind === "pct" ? "Oswald, sans-serif" : "Noto Sans JP, Yu Gothic UI, Meiryo, sans-serif",
        "font-size": String(l.size), "font-weight": "700"
      });
      t.textContent = l.text;
      svg.appendChild(t);
    });
    svg.setAttribute("aria-label", (opts.label || "打球方向") + "：" + (label.length ? label.join("、") : "記録なし"));
    return { svg: svg, total: b.total };
  }

  // 記録画面：方向を選ぶグラウンドの図（9区画＋ピッチャー＋キャッチャー）。もう一度押すと解除する（呼び出し側で処理）。
  // labels："full"（レフト・左中間…）／"short"（左・左中…。PCの小さな図）
  var PICK_FULL = { "左": "レフト", "左中": "左中間", "中": "センター", "右中": "右中間", "右": "ライト", "三": "サード", "遊": "ショート", "二": "セカンド", "一": "ファースト", "投": "ピッチャー", "捕": "捕" };

  function groundPicker(selected, onPick, opts) {
    opts = opts || {};
    var short = opts.labels === "short";
    var fs = opts.fontSize || (short ? 19 : 13);
    var GY = 268, R0 = 40, R1 = 118, R2 = 255;
    function p(r, deg) { var a = deg * Math.PI / 180; return [CX + r * Math.sin(a), GY - r * Math.cos(a)]; }
    function wedge(a1, a2, rin, rout) {
      return "M " + f(p(rin, a1)) + " L " + f(p(rout, a1)) + " A " + rout + " " + rout + " 0 0 1 " + f(p(rout, a2)) +
        " L " + f(p(rin, a2)) + " A " + rin + " " + rin + " 0 0 0 " + f(p(rin, a1)) + " Z";
    }
    var svg = svgEl("svg", { viewBox: "-12 0 364 285", preserveAspectRatio: "xMidYMid meet", role: "group", "aria-label": "打球の方向を選ぶ", "class": "ground-picker" });
    var defs = [
      ["左", -45, -27, R1, R2, "#DCEBD5"], ["左中", -27, -9, R1, R2, "#DCEBD5"], ["中", -9, 9, R1, R2, "#DCEBD5"],
      ["右中", 9, 27, R1, R2, "#DCEBD5"], ["右", 27, 45, R1, R2, "#DCEBD5"],
      ["三", -45, -22.5, R0, R1, "#EFE2CF"], ["遊", -22.5, 0, R0, R1, "#EFE2CF"], ["二", 0, 22.5, R0, R1, "#EFE2CF"], ["一", 22.5, 45, R0, R1, "#EFE2CF"]
    ];
    function make(el0, d) {
      el0.setAttribute("tabindex", "0");
      el0.setAttribute("role", "button");
      el0.setAttribute("aria-label", PICK_FULL[d]);
      el0.setAttribute("aria-pressed", selected === d ? "true" : "false");
      el0.style.cursor = "pointer";
      el0.addEventListener("click", function () { onPick(d); });
      el0.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onPick(d); } });
      svg.appendChild(el0);
    }
    defs.forEach(function (z) {
      make(svgEl("path", { d: wedge(z[1], z[2], z[3], z[4]), fill: selected === z[0] ? "#C8102E" : z[5], stroke: "#FFFFFF", "stroke-width": "3" }), z[0]);
    });
    var pm = p(72, 0);
    make(svgEl("circle", { cx: pm[0], cy: pm[1], r: 20, fill: selected === "投" ? "#C8102E" : "#EFE2CF", stroke: "#FFFFFF", "stroke-width": "3" }), "投");
    make(svgEl("circle", { cx: CX, cy: GY, r: 17, fill: selected === "捕" ? "#C8102E" : "#EFE2CF", stroke: "#FFFFFF", "stroke-width": "3" }), "捕");
    var lp = { "左": [195, -36], "左中": [195, -18], "中": [195, 0], "右中": [195, 18], "右": [195, 36], "三": [104, -35], "遊": [108, -16], "二": [108, 16], "一": [104, 35] };
    Object.keys(lp).forEach(function (d) {
      var q = p(lp[d][0], lp[d][1]);
      var t = svgEl("text", {
        x: q[0].toFixed(1), y: (q[1] + fs * 0.32).toFixed(1), "text-anchor": "middle", fill: selected === d ? "#FFFFFF" : "#3F3F46",
        "font-family": "Noto Sans JP, Yu Gothic UI, Meiryo, sans-serif", "font-size": String(fs), "font-weight": "700", "pointer-events": "none"
      });
      t.textContent = short ? d : PICK_FULL[d];
      svg.appendChild(t);
    });
    var tp = svgEl("text", {
      x: pm[0].toFixed(1), y: (pm[1] + (short ? fs * 0.32 : 3)).toFixed(1), "text-anchor": "middle", fill: selected === "投" ? "#FFFFFF" : "#3F3F46",
      "font-family": "Noto Sans JP, Yu Gothic UI, Meiryo, sans-serif", "font-size": String(short ? fs : 9), "font-weight": "700", "pointer-events": "none"
    });
    tp.textContent = short ? "投" : "ピッチャー";
    svg.appendChild(tp);
    var tc = svgEl("text", {
      x: CX, y: (GY + (short ? fs * 0.32 : 4)).toFixed(1), "text-anchor": "middle", fill: selected === "捕" ? "#FFFFFF" : "#3F3F46",
      "font-family": "Noto Sans JP, Yu Gothic UI, Meiryo, sans-serif", "font-size": String(short ? fs : 11), "font-weight": "700", "pointer-events": "none"
    });
    tc.textContent = "捕";
    svg.appendChild(tc);
    return svg;
  }
  // 盗塁ダイヤモンド。bd は { second, third, home, unknown }（Stats.stealBreakdown）。
  // 一塁→二塁（二盗）、二塁→三塁（三盗）、三塁→本塁（本盗）の矢印。太さは回数に比例（最小4px）、0回は灰色の点線。
  function diamond(bd, opts) {
    opts = opts || {};
    var small = !!opts.small;
    var S = small ? 120 : 240;
    var k = S / 240;
    var minW = 4;   // 矢印の太さの下限（4px）
    var svg = svgEl("svg", { viewBox: "0 0 " + S + " " + S, role: "img", "class": "diamond" + (small ? " diamond-small" : "") });
    if (opts.width) svg.setAttribute("width", String(opts.width));
    if (opts.height) svg.setAttribute("height", String(opts.height));
    var home = [S / 2, S - 28 * k], first = [S - 28 * k, S / 2], second = [S / 2, 28 * k], third = [28 * k, S / 2];
    var corners = [home, first, second, third];
    svg.appendChild(svgEl("path", {
      d: "M " + corners.map(function (p) { return p[0] + " " + p[1]; }).join(" L ") + " Z",
      fill: "#F4F4F5", stroke: "#BBF7D0", "stroke-width": String(3 * k + 1)
    }));
    corners.forEach(function (p) {
      svg.appendChild(svgEl("rect", {
        x: p[0] - 9 * k, y: p[1] - 9 * k, width: 18 * k, height: 18 * k, fill: "#FFFFFF", stroke: "#BBF7D0", "stroke-width": String(2 * k + 0.5),
        transform: "rotate(45 " + p[0] + " " + p[1] + ")"
      }));
    });

    // 矢印：[始点, 終点, 回数, ラベルの位置のずれ, ラベル]
    var arrows = [
      [first, second, bd.second, [1, -1], "二"],
      [second, third, bd.third, [-1, -1], "三"],
      [third, home, bd.home, [-1, 1], "本"]
    ];
    arrows.forEach(function (a) {
      var from = a[0], to = a[1], n = a[2];
      var dx = to[0] - from[0], dy = to[1] - from[1];
      var len = Math.sqrt(dx * dx + dy * dy);
      var ux = dx / len, uy = dy / len;
      var pad = 16 * k;
      var x1 = from[0] + ux * pad, y1 = from[1] + uy * pad;
      var x2 = to[0] - ux * pad, y2 = to[1] - uy * pad;
      if (n > 0) {
        var w = Math.max(minW, Math.min(small ? 10 : 16, n * 1.2));
        svg.appendChild(svgEl("line", { x1: x1, y1: y1, x2: x2 - ux * w * 1.2, y2: y2 - uy * w * 1.2, stroke: "#16A34A", "stroke-width": String(w), "stroke-linecap": "round" }));
        var hx = -uy, hy = ux, hw = w * 1.5;
        svg.appendChild(svgEl("polygon", {
          points: [x2, y2, x2 - ux * hw * 1.4 + hx * hw, y2 - uy * hw * 1.4 + hy * hw, x2 - ux * hw * 1.4 - hx * hw, y2 - uy * hw * 1.4 - hy * hw].join(","),
          fill: "#16A34A"
        }));
      } else {
        svg.appendChild(svgEl("line", { x1: x1, y1: y1, x2: x2, y2: y2, stroke: "#A1A1AA", "stroke-width": String(small ? 2 : 3), "stroke-dasharray": small ? "4 4" : "6 6", "stroke-linecap": "round" }));
      }
      // 数字は、ダイヤモンドの外側（辺に垂直な向き）に置く
      var fs = small ? 17 : 34;
      var off = small ? 21 : 38;
      var mx = (x1 + x2) / 2 + a[3][0] * off / Math.SQRT2, my = (y1 + y2) / 2 + a[3][1] * off / Math.SQRT2 + fs * 0.34;
      var tx = svgEl("text", {
        x: mx, y: my, "text-anchor": "middle", fill: n > 0 ? "#14532D" : "#71717A",
        "font-family": "Oswald, sans-serif", "font-weight": "700", "font-size": String(fs)
      });
      tx.textContent = small ? a[4] + n : String(n);
      svg.appendChild(tx);
    });
    svg.setAttribute("aria-label", "盗塁の内訳：二盗" + bd.second + "、三盗" + bd.third + "、本盗" + bd.home + (bd.unknown > 0 ? "、内訳不明" + bd.unknown : ""));
    return svg;
  }

  window.Field = {
    positionFigure: positionFigure,
    positionBig: positionBig,
    bubbleFigure: bubbleFigure,
    bubbleItems: bubbleItems,
    layoutBubbleLabels: layoutBubbleLabels,
    groundPicker: groundPicker,
    diamond: diamond,
    SPOTS: SPOTS,
    ALL_CODES: ALL_CODES,
    minSpotDistance: minSpotDistance,
    SHORT: SHORT,
    NAME: NAME
  };
})();
