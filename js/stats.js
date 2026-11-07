(function () {
  "use strict";

  // 仕様書5章の表。counts は件数を数える項目名。
  function def(label, atBat, hit, bases, onBase, obpDenom, counts) {
    return { label: label, atBat: atBat, hit: hit, bases: bases, onBase: onBase, obpDenom: obpDenom, counts: counts || [] };
  }

  var RESULT_DEFS = {
    single: def("ヒット", true, true, 1, true, true),
    double: def("二塁打", true, true, 2, true, true),
    triple: def("三塁打", true, true, 3, true, true),
    homerun: def("本塁打", true, true, 4, true, true),
    walk: def("四球", false, false, 0, true, true, ["walk"]),
    hbp: def("死球", false, false, 0, true, true, ["hbp"]),
    groundout: def("ゴロ", true, false, 0, false, true),
    flyout: def("フライ", true, false, 0, false, true),
    lineout: def("ライナー", true, false, 0, false, true),
    strikeout: def("三振", true, false, 0, false, true, ["strikeout"]),
    dropped_third_strike: def("振り逃げ", true, false, 0, false, true, ["droppedThirdStrike"]),
    reached_on_error: def("エラー", true, false, 0, false, true, ["reachedOnError"]),
    fielders_choice: def("野選", true, false, 0, false, true),
    double_play: def("併殺打", true, false, 0, false, true),
    sac_bunt: def("犠打", false, false, 0, false, false, ["sacBunt"]),
    sac_fly: def("犠飛", false, false, 0, false, true, ["sacFly"]),
    interference: def("打撃妨害", false, false, 0, false, false)
  };

  var DIRECTIONS = ["投", "捕", "一", "二", "三", "遊", "左", "左中", "中", "右中", "右"];

  var COUNT_KEYS = {
    walk: "walks",
    hbp: "hbp",
    strikeout: "strikeouts",
    droppedThirdStrike: "droppedThirdStrikes",
    sacBunt: "sacBunts",
    sacFly: "sacFlies",
    reachedOnError: "reachedOnError"
  };

  function ratio(num, den) {
    return den > 0 ? num / den : null;
  }

  function summarize(games) {
    var s = {
      games: 0, plateAppearances: 0, atBats: 0, hits: 0,
      singles: 0, doubles: 0, triples: 0, homeRuns: 0, totalBases: 0,
      walks: 0, hbp: 0, strikeouts: 0, droppedThirdStrikes: 0, sacBunts: 0, sacFlies: 0, reachedOnError: 0,
      rbi: 0, stolenBases: 0
    };
    var onBaseNum = 0;
    var obpDen = 0;

    games.forEach(function (game) {
      s.games += 1;
      s.stolenBases += game.stolenBases || 0;

      (game.plateAppearances || []).forEach(function (pa) {
        var d = RESULT_DEFS[pa.result];
        if (!d) {
          console.error("未知の打席結果コードのため集計しません:", pa.result, "(game: " + game.id + ")");
          return;
        }
        s.plateAppearances += 1;
        s.rbi += pa.rbi || 0;
        if (d.atBat) s.atBats += 1;
        if (d.hit) s.hits += 1;
        s.totalBases += d.bases;
        if (pa.result === "single") s.singles += 1;
        if (pa.result === "double") s.doubles += 1;
        if (pa.result === "triple") s.triples += 1;
        if (pa.result === "homerun") s.homeRuns += 1;
        if (d.onBase) onBaseNum += 1;
        if (d.obpDenom) obpDen += 1;
        d.counts.forEach(function (c) { s[COUNT_KEYS[c]] += 1; });
      });
    });

    s.avg = ratio(s.hits, s.atBats);
    s.obp = ratio(onBaseNum, obpDen);
    s.slg = ratio(s.totalBases, s.atBats);
    s.ops = (s.obp === null || s.slg === null) ? null : s.obp + s.slg;
    return s;
  }

  function summarizeGame(game) {
    return summarize([game]);
  }

  // 古い順（date 昇順、同日は gameLabel 昇順）の累積系列。引数の配列は並べ替えない。
  function cumulativeSeries(games) {
    var sorted = games.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var la = a.gameLabel || "";
      var lb = b.gameLabel || "";
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
    return sorted.map(function (game, i) {
      return {
        index: i + 1,
        game: game,
        gameSummary: summarizeGame(game),
        cumulative: summarize(sorted.slice(0, i + 1))
      };
    });
  }

  // ---- 案F：今の調子・月ごと・出塁・登板・守備位置 ----

  // 古い順（date 昇順、同日は gameLabel 昇順）のコピー。引数は並べ替えない。
  function sortedAsc(games) {
    return games.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var la = a.gameLabel || "";
      var lb = b.gameLabel || "";
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
  }

  // 古い順に並べた最後の n 試合の summarize。
  function recentForm(games, n) {
    var s = sortedAsc(games);
    return summarize(s.slice(Math.max(0, s.length - n)));
  }

  // 最新の試合からさかのぼり、安打1以上の試合が何試合続いているか。
  // 打数0の試合（四死球だけなど）は数えずに飛ばす（記録は止めない）。
  function hitStreak(games) {
    var s = sortedAsc(games);
    var count = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      var sm = summarizeGame(s[i]);
      if (sm.atBats === 0) continue;
      if (sm.hits >= 1) count += 1;
      else break;
    }
    return count;
  }

  // 塁に出た回数＝ヒット系＋四球＋死球＋エラー出塁＋野選＋打撃妨害（振り逃げは含めない）。
  var ON_BASE_RESULTS = ["single", "double", "triple", "homerun", "walk", "hbp", "reached_on_error", "fielders_choice", "interference"];
  function onBaseCount(games) {
    var n = 0;
    games.forEach(function (g) {
      (g.plateAppearances || []).forEach(function (pa) {
        if (ON_BASE_RESULTS.indexOf(pa.result) >= 0) n += 1;
      });
    });
    return n;
  }

  // 登板数・合格・不合格・評価なし・月ごとの登板数。
  function pitchingSummary(games) {
    var r = { total: 0, pass: 0, fail: 0, none: 0, byMonth: {} };
    games.forEach(function (g) {
      if (g.pitched !== true) return;
      r.total += 1;
      if (g.pitchingEval === "合格") r.pass += 1;
      else if (g.pitchingEval === "不合格") r.fail += 1;
      else r.none += 1;
      var m = g.date.slice(0, 7);
      r.byMonth[m] = (r.byMonth[m] || 0) + 1;
    });
    return r;
  }

  // 「YYYY-MM」ごとの summarize と、試合数・盗塁・登板・合格・不合格・出塁。古い月から。
  function monthlySummary(games) {
    var keys = [];
    var groups = {};
    sortedAsc(games).forEach(function (g) {
      var m = g.date.slice(0, 7);
      if (!groups[m]) { groups[m] = []; keys.push(m); }
      groups[m].push(g);
    });
    return keys.map(function (m) {
      var gs = groups[m];
      var p = pitchingSummary(gs);
      var s = summarize(gs);
      return {
        month: m, games: gs.length, summary: s, stolenBases: s.stolenBases,
        pitched: p.total, pass: p.pass, fail: p.fail, onBase: onBaseCount(gs)
      };
    });
  }

  // 守備位置：守った試合数（1試合で同じ位置を2回守っても1）と、先発（positions[0]）の試合数。
  function positionSummary(games) {
    var r = { games: games.length, appear: {}, start: {} };
    POSITIONS.forEach(function (p) { r.appear[p.code] = 0; r.start[p.code] = 0; });
    games.forEach(function (g) {
      var seen = {};
      (g.positions || []).forEach(function (c) { if (r.appear[c] !== undefined) seen[c] = true; });
      Object.keys(seen).forEach(function (c) { r.appear[c] += 1; });
      var first = (g.positions || [])[0];
      if (first !== undefined && r.start[first] !== undefined) r.start[first] += 1;
    });
    return r;
  }

  // 投手の記録（16章）。登板した試合だけを数える。各合計は、その項目を記録した試合だけで足す。
  // 記録が1つもなければ合計は null。範囲外・数字でない値は「記録なし」として扱う。
  var PITCH_LIMITS = { pitches: 200, outs: 30, runs: 50, strikeouts: 30, walks: 30, hitByPitch: 30 };

  function validPitchValue(key, v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= PITCH_LIMITS[key];
  }

  function pitchingStatsSummary(games) {
    var r = { games: 0, pitches: null, pitchesGames: 0, avgPitches: null, outs: null, outsGames: 0, runs: null, runsGames: 0,
      strikeouts: null, strikeoutsGames: 0, walks: null, walksGames: 0, hitByPitch: null, hitByPitchGames: 0 };
    games.forEach(function (g) {
      if (g.pitched !== true) return;
      r.games += 1;
      var ps = g.pitchingStats;
      if (!ps || typeof ps !== "object") return;
      Object.keys(PITCH_LIMITS).forEach(function (k) {
        if (!validPitchValue(k, ps[k])) return;
        r[k] = (r[k] === null ? 0 : r[k]) + ps[k];
        r[k + "Games"] += 1;
      });
    });
    if (r.pitchesGames > 0) r.avgPitches = r.pitches / r.pitchesGames;
    return r;
  }

  // 投球回（アウトの数）→「2回1/3」「4回」「0回2/3」。記録なしは「−」。
  function formatInnings(outs) {
    if (typeof outs !== "number" || !isFinite(outs) || outs < 0 || Math.floor(outs) !== outs) return "−";
    var whole = Math.floor(outs / 3);
    var rest = outs % 3;
    return whole + "回" + (rest ? rest + "/3" : "");
  }
  // 打球の方向別の集計。方向（direction）が空でない打席だけを対象にする。
  // total：全打球、hits：安打、errors：エラー出塁、outs：それ以外。
  var GROUP_LEFT = ["左", "左中", "三", "遊"];
  var GROUP_CENTER = ["中", "投", "捕"];
  var GROUP_RIGHT = ["右", "右中", "二", "一"];

  function directionSummary(games) {
    var r = { total: 0, byDir: {}, groups: { left: 0, center: 0, right: 0 } };
    DIRECTIONS.forEach(function (d) { r.byDir[d] = { total: 0, hits: 0, outs: 0, errors: 0 }; });
    games.forEach(function (g) {
      (g.plateAppearances || []).forEach(function (pa) {
        if (!pa.direction || !r.byDir[pa.direction]) return;
        var d = RESULT_DEFS[pa.result];
        if (!d) return;
        var b = r.byDir[pa.direction];
        b.total += 1;
        r.total += 1;
        if (d.hit) b.hits += 1;
        else if (pa.result === "reached_on_error") b.errors += 1;
        else b.outs += 1;
        if (GROUP_LEFT.indexOf(pa.direction) >= 0) r.groups.left += 1;
        else if (GROUP_CENTER.indexOf(pa.direction) >= 0) r.groups.center += 1;
        else if (GROUP_RIGHT.indexOf(pa.direction) >= 0) r.groups.right += 1;
      });
    });
    return r;
  }

  // 盗塁の内訳。各試合の stealDetail（メモ）を読み、二盗・三盗・本盗を数える。
  // 「、」「,」「，」で区切った各部分：「2盗」→二盗、「3盗」→三盗、「本盗」「ホームスチール」→本盗。
  // 後ろに「×数字」（全角・半角）があれば、その数だけ数える。
  // 読み取った合計が stolenBases と合わない試合は、足りない分を「内訳不明」として数える（データは書き換えない）。
  function toHalfWidthInt(s) {
    return parseInt(String(s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); }), 10);
  }

  function parseStealDetail(detail) {
    var r = { second: 0, third: 0, home: 0, rest: [] };
    String(detail === undefined || detail === null ? "" : detail).split(/[、,，]/).forEach(function (part) {
      var p = part.trim();
      if (p === "") return;
      var n = 1;
      var m = /[×xX]\s*([0-9０-９]+)\s*$/.exec(p);
      if (m) {
        n = toHalfWidthInt(m[1]);
        p = p.slice(0, m.index).trim();
      }
      if (/^[2２]盗/.test(p)) r.second += n;
      else if (/^[3３]盗/.test(p)) r.third += n;
      else if (/本盗|ホームスチール/.test(p)) r.home += n;
      else r.rest.push(part.trim());   // 読み取れなかった部分
    });
    return r;
  }

  function stealBreakdown(games) {
    var out = {
      second: 0, third: 0, home: 0, unknown: 0, total: 0, gamesWithSteal: 0, multiStealGames: 0,
      byMonth: {}, games: []
    };
    sortedAsc(games).forEach(function (g) {
      var sb = g.stolenBases || 0;
      var m = g.date.slice(0, 7);
      out.total += sb;
      out.byMonth[m] = (out.byMonth[m] || 0) + sb;
      if (sb < 1) return;
      var p = parseStealDetail(g.stealDetail);
      var read = p.second + p.third + p.home;
      var unknown = Math.max(0, sb - read);
      out.second += p.second;
      out.third += p.third;
      out.home += p.home;
      out.unknown += unknown;
      out.gamesWithSteal += 1;
      if (sb >= 2) out.multiStealGames += 1;
      out.games.push({
        game: g, count: sb, second: p.second, third: p.third, home: p.home,
        unknown: unknown, mismatch: read > sb
      });
    });
    return out;
  }

  // 調子の5段階。差（最近5試合の打率−通算の打率）を小数第3位に四捨五入して比べ、
  // 連続ヒットが5以上なら1段階上げる（絶好調が上限）。
  var CONDITION_LEVELS = [
    { level: "zekkocho", label: "絶好調" },
    { level: "kocho", label: "好調" },
    { level: "futsu", label: "普通" },
    { level: "fucho", label: "不調" },
    { level: "zetsufucho", label: "絶不調" }
  ];

  function conditionFromValues(diff, streak, recentAtBats, allAtBats) {
    if (allAtBats === 0 || recentAtBats < 3 || diff === null || diff === undefined) {
      return { level: null, label: "判定なし", diff: null, streakBonus: false };
    }
    var d = Math.round(diff * 1000);   // 1000分の1の整数
    var idx = d >= 100 ? 0 : d >= 50 ? 1 : d >= -49 ? 2 : d >= -149 ? 3 : 4;
    var bonus = false;
    if (streak >= 5 && idx > 0) { idx -= 1; bonus = true; }
    return { level: CONDITION_LEVELS[idx].level, label: CONDITION_LEVELS[idx].label, diff: d / 1000, streakBonus: bonus };
  }

  function conditionLevel(games) {
    var all = summarize(games);
    var rec = recentForm(games, 5);
    var diff = (all.avg === null || rec.avg === null) ? null : rec.avg - all.avg;
    return conditionFromValues(diff, hitStreak(games), rec.atBats, all.atBats);
  }

  // 絞り込み。filter は { squad: "" | "C" | "D", grade: "" | 数値 }。空文字は「すべて」。
  // 元の配列は変更せず、新しい配列を返す（試合オブジェクトは同じ参照）。
  function filterGames(games, filter) {
    var squad = filter && filter.squad ? filter.squad : "";
    var grade = filter && filter.grade !== "" && filter.grade !== null && filter.grade !== undefined
      ? Number(filter.grade) : null;
    return games.filter(function (g) {
      if (squad !== "" && g.squad !== squad) return false;
      if (grade !== null && Number(g.grade) !== grade) return false;
      return true;
    });
  }

  // 選択欄の選択肢。重複をなくし、昇順に並べる。
  function filterOptions(games) {
    var squads = [];
    var grades = [];
    games.forEach(function (g) {
      if (squads.indexOf(g.squad) < 0) squads.push(g.squad);
      var n = Number(g.grade);
      if (grades.indexOf(n) < 0) grades.push(n);
    });
    squads.sort();
    grades.sort(function (a, b) { return a - b; });
    return { squads: squads, grades: grades };
  }

  // keyFn(game) の値ごとに試合をまとめ、グループごとに summarize する。順番は不定。
  function splitBy(games, keyFn) {
    var keys = [];
    var groups = [];
    games.forEach(function (g) {
      var k = keyFn(g);
      var i = keys.indexOf(k);
      if (i < 0) {
        keys.push(k);
        groups.push([]);
        i = keys.length - 1;
      }
      groups[i].push(g);
    });
    return keys.map(function (k, i) {
      return { key: k, games: groups[i], summary: summarize(groups[i]) };
    });
  }

  // 守備位置コード。並び順はこの配列の順。
  var POSITIONS = [
    { code: "P", label: "ピッチャー", short: "投" },
    { code: "C", label: "キャッチャー", short: "捕" },
    { code: "1B", label: "ファースト", short: "一" },
    { code: "2B", label: "セカンド", short: "二" },
    { code: "3B", label: "サード", short: "三" },
    { code: "SS", label: "ショート", short: "遊" },
    { code: "LF", label: "レフト", short: "左" },
    { code: "CF", label: "センター", short: "中" },
    { code: "RF", label: "ライト", short: "右" },
    { code: "DH", label: "DH", short: "指" }
  ];

  // 略称を「→」でつなぐ。例：["1B","P","SS"] → "一→投→遊"。空配列は空文字。
  function formatPositions(positions) {
    return (positions || []).map(function (code) {
      for (var i = 0; i < POSITIONS.length; i++) {
        if (POSITIONS[i].code === code) return POSITIONS[i].short;
      }
      return String(code);
    }).join("→");
  }

  function formatRate(value) {
    if (value === null || value === undefined || isNaN(value)) return "−";
    var s = value.toFixed(3);
    // 1未満のときは先頭の0を省く（0.611 → .611）。1以上はそのまま。
    return s.indexOf("0.") === 0 ? s.slice(1) : s;
  }

  function formatPA(pa) {
    var d = RESULT_DEFS[pa.result];
    var text = (pa.direction || "") + (d ? d.label : String(pa.result));
    if (pa.rbi >= 1) text += "(" + pa.rbi + ")";
    return text;
  }

  // 表示の色分け用。"hit" / "error" / ""
  function paCategory(pa) {
    var d = RESULT_DEFS[pa.result];
    if (!d) return "";
    if (d.hit) return "hit";
    if (pa.result === "reached_on_error") return "error";
    return "";
  }

  window.Stats = {
    RESULT_DEFS: RESULT_DEFS,
    DIRECTIONS: DIRECTIONS,
    summarize: summarize,
    summarizeGame: summarizeGame,
    cumulativeSeries: cumulativeSeries,
    recentForm: recentForm,
    hitStreak: hitStreak,
    onBaseCount: onBaseCount,
    pitchingSummary: pitchingSummary,
    monthlySummary: monthlySummary,
    positionSummary: positionSummary,
    directionSummary: directionSummary,
    pitchingStatsSummary: pitchingStatsSummary,
    formatInnings: formatInnings,
    stealBreakdown: stealBreakdown,
    parseStealDetail: parseStealDetail,
    conditionLevel: conditionLevel,
    conditionFromValues: conditionFromValues,
    filterGames: filterGames,
    filterOptions: filterOptions,
    splitBy: splitBy,
    POSITIONS: POSITIONS,
    formatPositions: formatPositions,
    formatRate: formatRate,
    formatPA: formatPA,
    paCategory: paCategory
  };
})();
