(function () {
  "use strict";

  // グラフの描画（画面処理）。Chart.js（lib/chart.umd.js）を使う。
  // 非表示の要素には描けないので、呼び出し側（app.js）がグラフタブを表示したときに render する。

  var charts = [];
  var CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function cssVar(name, fallback) {
    var v = "";
    try {
      v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    } catch (e) { /* 無視 */ }
    return v || fallback;
  }

  // 目盛り：「月/日」。同じ日の2試合以上は、その日の中での順番を丸数字で付ける。
  function axisLabels(series) {
    var perDay = {};
    series.forEach(function (p) { perDay[p.game.date] = (perDay[p.game.date] || 0) + 1; });
    var seen = {};
    return series.map(function (p) {
      var d = p.game.date;
      var parts = d.split("-");
      var base = parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10);
      if (perDay[d] > 1) {
        seen[d] = (seen[d] || 0) + 1;
        base += CIRCLED[seen[d] - 1] || "(" + seen[d] + ")";
      }
      return base;
    });
  }

  function gameTitle(g) {
    return g.date + " " + g.competition + (g.gameLabel ? "（" + g.gameLabel + "）" : "") + " vs " + g.opponent;
  }

  function paLine(g) {
    if (!g.plateAppearances || g.plateAppearances.length === 0) return "打席なし";
    return g.plateAppearances.map(Stats.formatPA).join(" / ");
  }

  function commonOptions(series, valueText, yScale) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: true },
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            title: function (items) {
              var p = series[items[0].dataIndex];
              return [gameTitle(p.game), paLine(p.game)];
            },
            label: function (item) {
              return item.dataset.label + "：" + valueText(item.parsed.y);
            }
          }
        }
      },
      scales: { y: yScale }
    };
  }

  function rateTick(v) { return Stats.formatRate(v); }

  // 見出しの横の「最高・現在」。pick は累積値の取り出し方。最高が同じ値のときは最初の試合。
  function peakNote(series, labels, pick) {
    var best = null;
    var last = null;
    series.forEach(function (p, i) {
      var v = pick(p);
      if (v === null || v === undefined) return;
      if (best === null || v > best.v) best = { v: v, label: labels[i] };
      last = v;
    });
    if (best === null) return "−";
    return "最高 " + Stats.formatRate(best.v) + "（" + best.label + "）・現在 " + Stats.formatRate(last);
  }

  function addChart(root, title, note, config, cls) {
    var card = el("section", "chart-card" + (cls ? " " + cls : ""));
    var head = el("div", "chart-head");
    head.appendChild(el("h3", "chart-title", title));
    if (note) head.appendChild(el("span", "chart-note", note));
    card.appendChild(head);
    var box = el("div", "chart-box");
    var canvas = el("canvas");
    box.appendChild(canvas);
    card.appendChild(box);
    root.appendChild(card);
    charts.push(new window.Chart(canvas, config));
  }

  function destroy() {
    charts.forEach(function (c) { c.destroy(); });
    charts = [];
  }

  function render(root, games) {
    destroy();
    root.textContent = "";
    var grid = el("div", "chart-grid");
    root.appendChild(grid);

    var series = Stats.cumulativeSeries(games);
    var labels = axisLabels(series);
    var red = cssVar("--team", "#C8102E");
    var grayLine = cssVar("--gray-series", "#71717A");
    var grayBar = cssVar("--gray-bar", "#A1A1AA");

    function line(label, color, pick, width, fill) {
      return {
        label: label,
        data: series.map(pick),
        borderColor: color,
        backgroundColor: fill || color,
        borderWidth: width,
        pointRadius: 3,
        pointHoverRadius: 6,
        tension: 0,
        fill: !!fill,
        spanGaps: false
      };
    }

    // 累積打率＝赤の太線、累積出塁率＝灰色
    addChart(grid, "累積打率・出塁率", peakNote(series, labels, function (p) { return p.cumulative.avg; }), {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          line("累積打率", red, function (p) { return p.cumulative.avg; }, 4),
          line("累積出塁率", grayLine, function (p) { return p.cumulative.obp; }, 2)
        ]
      },
      options: commonOptions(series, rateTick, { min: 0, max: 1, ticks: { callback: rateTick } })
    });

    // 累積OPS＝赤の線と薄い塗り
    addChart(grid, "累積OPS", peakNote(series, labels, function (p) { return p.cumulative.ops; }), {
      type: "line",
      data: {
        labels: labels,
        datasets: [line("累積OPS", red, function (p) { return p.cumulative.ops; }, 3, "rgba(200, 16, 46, 0.10)")]
      },
      options: commonOptions(series, rateTick, { beginAtZero: true, ticks: { callback: rateTick } })
    });

    // 安打＝赤の棒、打点＝灰色の棒
    function intText(v) { return String(v); }
    function bar(label, color, pick) {
      return { label: label, data: series.map(pick), backgroundColor: color, borderColor: color, borderWidth: 1 };
    }
    addChart(grid, "試合ごとの安打・打点", "", {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          bar("安打", red, function (p) { return p.gameSummary.hits; }),
          bar("打点", grayBar, function (p) { return p.gameSummary.rbi; })
        ]
      },
      options: commonOptions(series, intText, { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } })
    }, "chart-full");
  }
  window.Charts = {
    render: render,
    destroy: destroy,
    axisLabels: axisLabels
  };
})();
