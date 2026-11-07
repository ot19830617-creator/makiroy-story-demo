(function () {
  "use strict";

  // 画面に出す内容を作る純粋な関数（DOM に依存しない）。数字は Stats の既存の関数で数える。
  var CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

  function sortedAsc(games) {
    return games.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var la = a.gameLabel || "";
      var lb = b.gameLabel || "";
      return la < lb ? -1 : la > lb ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  function mdLabel(date) {
    var p = date.split("-");
    return parseInt(p[1], 10) + "/" + parseInt(p[2], 10);
  }

  // 日付の表記。同じ日の2試合目以降だけ「10/18②」。順番は全試合（絞り込み前）で数える。
  function dateLabels(allGames) {
    var seen = {};
    var map = {};
    sortedAsc(allGames).forEach(function (g) {
      var n = seen[g.date] || 0;
      map[g.id] = mdLabel(g.date) + (n >= 1 ? (CIRCLED[n] || "(" + (n + 1) + ")") : "");
      seen[g.date] = n + 1;
    });
    return map;
  }

  // 盗塁の内訳の表し方。例：「2（二盗・三盗）」「2（二盗×2）」「1（内訳不明）」。盗塁0は「0」。
  function stealText(entry) {
    if (!entry || !entry.count) return "0";
    var parts = [];
    if (entry.second > 0) parts.push("二盗" + (entry.second > 1 ? "×" + entry.second : ""));
    if (entry.third > 0) parts.push("三盗" + (entry.third > 1 ? "×" + entry.third : ""));
    if (entry.home > 0) parts.push("本盗" + (entry.home > 1 ? "×" + entry.home : ""));
    if (entry.unknown > 0) parts.push("内訳不明" + (entry.unknown > 1 ? "×" + entry.unknown : ""));
    return entry.count + (parts.length ? "（" + parts.join("・") + "）" : "");
  }

  // ---- 盗塁の内訳の書き込み・読み取り（記録画面のダイヤモンド） ----
  // 例：「2盗×2、3盗、本盗」（1回のときは「×1」を省く）
  function stealDetailText(second, third, home) {
    var parts = [];
    if (second > 0) parts.push("2盗" + (second > 1 ? "×" + second : ""));
    if (third > 0) parts.push("3盗" + (third > 1 ? "×" + third : ""));
    if (home > 0) parts.push("本盗" + (home > 1 ? "×" + home : ""));
    return parts.join("、");
  }

  // 試合から、ダイヤモンドの入力に戻す。読み取れる（読み取れない言葉がなく、合計が stolenBases と一致）なら "diamond"、
  // そうでなければ "legacy"（今の「数＋メモ」の入力欄。元のメモを壊さないため）。
  function stealInputFromGame(game) {
    var sb = game.stolenBases || 0;
    var detail = game.stealDetail === undefined || game.stealDetail === null ? "" : String(game.stealDetail);
    var p = Stats.parseStealDetail(detail);
    var read = p.second + p.third + p.home;
    if (p.rest.length === 0 && read === sb) {
      return { mode: "diamond", second: p.second, third: p.third, home: p.home, original: detail };
    }
    return { mode: "legacy", second: 0, third: 0, home: 0, original: detail };
  }

  // ---- 投手の記録 ----
  // 「〇回」と「0／1／2（1/3・2/3）」→ アウトの数。「〇回」が空欄なら記録なし（null）。
  function outsFromInnings(whole, frac) {
    if (whole === "" || whole === null || whole === undefined) return null;
    return parseInt(whole, 10) * 3 + (parseInt(frac, 10) || 0);
  }

  function inningsFromOuts(outs) {
    if (typeof outs !== "number" || !isFinite(outs) || Math.floor(outs) !== outs || outs < 0 || outs > 30) return null;
    return { whole: Math.floor(outs / 3), frac: outs % 3 };
  }

  var PITCH_KEYS = ["pitches", "outs", "runs", "strikeouts", "walks", "hitByPitch"];

  // 入力（文字列）→ 保存する pitchingStats。登板していない・すべて空欄なら null（保存しない）。
  function pitchingStatsFromInput(input, pitched) {
    if (!pitched || !input) return null;
    var out = {};
    var any = false;
    PITCH_KEYS.forEach(function (k) {
      var v = input[k];
      if (v === "" || v === null || v === undefined || String(v).trim() === "") { out[k] = null; return; }
      out[k] = parseInt(v, 10);
      any = true;
    });
    return any ? out : null;
  }

  function hasPitchingValues(ps) {
    if (!ps || typeof ps !== "object") return false;
    return PITCH_KEYS.some(function (k) { return ps[k] !== null && ps[k] !== undefined; });
  }

  // 画面に出す文字（記録なし・範囲外・数字でない値は「−」）
  function pitchingTexts(ps) {
    var ok = function (k) {
      var lim = { pitches: 200, outs: 30, runs: 50, strikeouts: 30, walks: 30, hitByPitch: 30 }[k];
      var v = ps ? ps[k] : null;
      return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= lim;
    };
    function n(k) { return ok(k) ? String(ps[k]) : "−"; }
    return {
      pitches: n("pitches"),
      innings: ok("outs") ? Stats.formatInnings(ps.outs) : "−",
      runs: n("runs"), strikeouts: n("strikeouts"), walks: n("walks"), hitByPitch: n("hitByPitch")
    };
  }
  // 試合の成績表の行。view：表示する試合、all：全試合（日付の表記用）、desc：新しい試合が上
  function gameTableRows(view, all, desc) {
    var labels = dateLabels(all);
    var steals = {};
    Stats.stealBreakdown(view).games.forEach(function (e) { steals[e.game.id] = e; });
    var rows = sortedAsc(view).map(function (g) {
      var s = Stats.summarizeGame(g);
      var order = g.battingOrder === null || g.battingOrder === undefined ? "" : g.battingOrder + "番";
      return {
        game: g,
        month: g.date.slice(0, 7),
        dateLabel: labels[g.id] || mdLabel(g.date),
        gradeTeam: g.grade + "年 " + g.squad,
        competition: g.competition + (g.gameLabel ? "（" + g.gameLabel + "）" : ""),
        opponent: g.opponent,
        order: order || "−",
        positions: Stats.formatPositions(g.positions) || "−",
        pas: (g.plateAppearances || []).map(function (pa) {
          return { text: Stats.formatPA(pa), category: Stats.paCategory(pa) };
        }),
        s: s,
        steal: g.stolenBases || 0,
        stealText: stealText(steals[g.id] || { count: g.stolenBases || 0, second: 0, third: 0, home: 0, unknown: g.stolenBases || 0 }),
        pitched: g.pitched === true,
        pitch: pitchingTexts(g.pitched === true ? g.pitchingStats : null),
        evalText: g.pitched === true ? (g.pitchingEval || "") : "",
        memo: g.memo || ""
      };
    });
    if (desc) rows.reverse();
    return rows;
  }

  // 表の合計の行（表示中の試合の summarize と、登板の数）
  function gameTableTotal(view) {
    return { s: Stats.summarize(view), pitched: Stats.pitchingSummary(view).total, pitching: Stats.pitchingStatsSummary(view) };
  }

  // 走塁バッジ（達成したものだけ）。
  function stealBadges(games) {
    var bd = Stats.stealBreakdown(games);
    var badges = [];
    if (bd.home >= 1) badges.push({ id: "home", name: "ホームスチール", note: "×" + bd.home });
    if (bd.third >= 1) badges.push({ id: "third", name: "三盗", note: "×" + bd.third });
    if (bd.multiStealGames >= 1) badges.push({ id: "multi", name: "1試合2盗塁", note: "×" + bd.multiStealGames + "試合" });
    if (bd.total >= 10) {
      badges.push({ id: "ten", name: "盗塁" + (Math.floor(bd.total / 10) * 10) + "個", note: "合計" + bd.total + "個" });
    }
    var best = 0;
    var cur = 0;
    sortedAsc(games).forEach(function (g) {
      if ((g.stolenBases || 0) >= 1) { cur += 1; if (cur > best) best = cur; } else { cur = 0; }
    });
    if (best >= 3) badges.push({ id: "streak", name: "3試合連続盗塁", note: "最長" + best + "試合" });
    return badges;
  }

  // ---- 表示の設定（成績データとは別のキー。バックアップには入らない） ----
  var UI_DEFAULT = { gamesView: "cards" };

  function loadUi(key) {
    var r = { gamesView: UI_DEFAULT.gamesView };
    try {
      var raw = window.localStorage.getItem(key);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && (o.gamesView === "cards" || o.gamesView === "table")) r.gamesView = o.gamesView;
      }
    } catch (e) { /* 使えない・壊れているときは既定値 */ }
    return r;
  }

  function saveUi(key, ui) {
    try {
      window.localStorage.setItem(key, JSON.stringify({ gamesView: ui.gamesView }));
      return true;
    } catch (e) {
      return false;
    }
  }

  window.Derive = {
    UI_KEY: "makiroy-demo-ui",   // 見本版専用の保存の名前
    dateLabels: dateLabels,
    stealText: stealText,
    stealDetailText: stealDetailText,
    stealInputFromGame: stealInputFromGame,
    outsFromInnings: outsFromInnings,
    inningsFromOuts: inningsFromOuts,
    pitchingStatsFromInput: pitchingStatsFromInput,
    hasPitchingValues: hasPitchingValues,
    pitchingTexts: pitchingTexts,
    gameTableRows: gameTableRows,
    gameTableTotal: gameTableTotal,
    stealBadges: stealBadges,
    loadUi: loadUi,
    saveUi: saveUi
  };
})();
