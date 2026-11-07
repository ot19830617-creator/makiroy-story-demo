(function () {
  "use strict";

  // 記録画面（試合の入力）。画面の状態（S）から、これまでと同じ形の入力を作り（collect）、
  // Validate.validateGameInput で検証して、検証に通ったものだけを api.saveGame で保存する。
  // api（app.js から渡す）：
  //   getGames()                 現在の試合の配列
  //   getLastInput()             meta.lastInput（{grade, squad} または {}）
  //   saveGame(game, lastInput)  保存して { ok, error } を返す
  //   goto(tabName)              タブを切り替える

  var api = null;
  var root = null;
  var S = null;
  var mq = window.matchMedia ? window.matchMedia("(min-width: 768px)") : null;

  var NO_DIRECTION = ["walk", "hbp", "strikeout", "dropped_third_strike", "interference"];
  var HIT_CODES = ["single", "double", "triple", "homerun"];
  var OUT_CODES = ["groundout", "flyout", "lineout", "reached_on_error", "double_play", "fielders_choice", "sac_bunt", "sac_fly"];
  var NOBALL_CODES = ["walk", "hbp", "strikeout", "dropped_third_strike", "interference"];

  function isPC() { return mq ? mq.matches : true; }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function latestGame(games) {
    var best = null;
    games.forEach(function (g) { if (!best || g.date > best.date) best = g; });
    return best;
  }

  function blankPa() { return { result: "", direction: "", rbi: "0" }; }

  function blankPs() { return { pitches: "", outsWhole: "", outsFrac: "0", runs: "", strikeouts: "", walks: "", hitByPitch: "" }; }

  function newState() {
    var games = api.getGames();
    var last = api.getLastInput() || {};
    var latest = latestGame(games);
    return {
      editingId: null, existing: null,
      date: today(),
      grade: String(last.grade || (latest ? latest.grade : "") || ""),
      squad: last.squad || (latest ? latest.squad : "") || "",
      competition: "", gameLabel: "", opponent: "", battingOrder: "",
      pa: [blankPa(), blankPa(), blankPa(), blankPa()], cur: 0,
      stealMode: "diamond", steal: { second: 0, third: 0, home: 0 }, stealOrig: null, legacyCount: "0", legacyDetail: "",
      pitched: false, pitchingEval: "", positions: ["", "", "", ""], ps: blankPs(),
      memo: "",
      infoOpen: !isPC(), posOpen: false, errors: {}
    };
  }

  // 入力の状態の文字列（「入力中かどうか」の判定に使う。画面だけの状態は含めない）
  function stateKey() {
    if (!S) return "";
    return JSON.stringify({
      editingId: S.editingId, date: S.date, grade: S.grade, squad: S.squad, competition: S.competition, gameLabel: S.gameLabel,
      opponent: S.opponent, battingOrder: S.battingOrder, pa: S.pa, stealMode: S.stealMode, steal: S.steal,
      legacyCount: S.legacyCount, legacyDetail: S.legacyDetail, pitched: S.pitched, pitchingEval: S.pitchingEval,
      positions: S.positions, ps: S.ps, memo: S.memo
    });
  }

  // 画面の状態 → validateGameInput に渡す入力（今までと同じ形＋pitchingStats）
  function collect() {
    var stolen;
    var detail;
    if (S.stealMode === "diamond") {
      var st = S.steal;
      stolen = String(st.second + st.third + st.home);
      var o = S.stealOrig;
      // ダイヤモンドの数が、開いたときと同じなら、元のメモの文字をそのまま残す
      detail = o && o.second === st.second && o.third === st.third && o.home === st.home ? o.text : Derive.stealDetailText(st.second, st.third, st.home);
    } else {
      stolen = S.legacyCount;
      detail = S.legacyDetail;
    }
    var outs = S.pitched ? Derive.outsFromInnings(S.ps.outsWhole, S.ps.outsFrac) : null;
    var psIn = { pitches: "", outs: "", runs: "", strikeouts: "", walks: "", hitByPitch: "" };
    if (S.pitched) {
      psIn = {
        pitches: S.ps.pitches, outs: outs === null ? "" : String(outs), runs: S.ps.runs,
        strikeouts: S.ps.strikeouts, walks: S.ps.walks, hitByPitch: S.ps.hitByPitch
      };
    }
    return {
      date: S.date, grade: S.grade, squad: S.squad, competition: S.competition, gameLabel: S.gameLabel,
      opponent: S.opponent, battingOrder: S.battingOrder,
      plateAppearances: S.pa.map(function (p) { return { result: p.result, direction: p.direction, rbi: p.rbi }; }),
      stolenBases: stolen, stealDetail: detail,
      pitched: S.pitched, pitchingEval: S.pitched ? S.pitchingEval : "",
      positions: S.positions.slice(), memo: S.memo,
      pitchingStats: psIn
    };
  }

  // id は g{日付}-{番号}。番号は、その日付で未使用の最小の番号。
  function newId(date, games) {
    var used = {};
    games.forEach(function (g) { used[g.id] = true; });
    var n = 1;
    while (used["g" + date + "-" + n]) n++;
    return "g" + date + "-" + n;
  }

  // 検証済みの入力から試合オブジェクトを作る。
  // existing があれば編集：id を変えず、result が変わっていない打席は infieldHit・original を残す。
  // 盗塁のメモ・メモは、入力された文字をそのまま保存する。投手の記録は、登板していない・すべて空欄なら保存しない。
  function buildGame(input, existing, games) {
    var plateAppearances = [];
    input.plateAppearances.forEach(function (p, i) {
      if (!p.result) return;
      var old = existing && existing.plateAppearances[i];
      var same = old && old.result === p.result;
      plateAppearances.push({
        result: p.result,
        direction: p.direction || "",
        infieldHit: same ? old.infieldHit === true : false,
        rbi: String(p.rbi).trim() === "" ? 0 : parseInt(p.rbi, 10),
        original: same ? (old.original || "") : ""
      });
    });
    var fields = {
      id: existing ? existing.id : newId(input.date, games),
      date: input.date,
      grade: parseInt(input.grade, 10),
      squad: input.squad,
      competition: input.competition.trim(),
      gameLabel: input.gameLabel.trim(),
      opponent: input.opponent.trim(),
      battingOrder: input.battingOrder === "" ? null : parseInt(input.battingOrder, 10),
      positions: (input.positions || []).filter(function (c) { return c !== ""; }),
      plateAppearances: plateAppearances,
      stolenBases: parseInt(input.stolenBases, 10),
      stealDetail: input.stealDetail,
      pitched: input.pitched === true,
      pitchingEval: input.pitched ? input.pitchingEval : "",
      memo: input.memo
    };
    var game = Object.assign({}, existing || {}, fields);
    var ps = Derive.pitchingStatsFromInput(input.pitchingStats, input.pitched === true);
    if (ps) game.pitchingStats = ps;
    else delete game.pitchingStats;
    return game;
  }

  // ---- 画面の部品 ----
  function err(key) {
    return S.errors[key] ? el("div", "field-error", S.errors[key]) : null;
  }

  function section(cls, title) {
    var sec = el("section", "rec-card " + cls);
    if (title) sec.appendChild(el("h3", "rec-h", title));
    return sec;
  }

  function btnGroup(options, current, onPick, cls) {
    var box = el("div", "rb-group " + (cls || ""));
    options.forEach(function (o) {
      var b = el("button", "rb", o[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", current === o[0] ? "true" : "false");
      b.addEventListener("click", function () { onPick(o[0]); });
      box.appendChild(b);
    });
    return box;
  }

  function textField(label, value, onInput, opts) {
    opts = opts || {};
    var wrap = el("label", "rf");
    wrap.appendChild(el("span", "rf-l", label + (opts.required ? " *" : "")));
    var inp = el("input");
    inp.type = opts.type || "text";
    inp.value = value;
    if (opts.list) inp.setAttribute("list", opts.list);
    if (opts.min !== undefined) inp.min = opts.min;
    if (opts.max !== undefined) inp.max = opts.max;
    if (opts.inputmode) inp.setAttribute("inputmode", opts.inputmode);
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    inp.addEventListener("input", function () { onInput(inp.value); });
    wrap.appendChild(inp);
    return wrap;
  }

  function paSummary(p) {
    if (!p.result) return "未入力";
    return Stats.formatPA({ result: p.result, direction: p.direction, rbi: parseInt(p.rbi, 10) || 0 });
  }

  function paColor(p) {
    if (HIT_CODES.indexOf(p.result) >= 0) return "pv-hit";
    if (p.result === "reached_on_error") return "pv-err";
    if (p.result === "walk" || p.result === "hbp") return "pv-bb";
    return "";
  }

  function pickDir(i, d) {
    var p = S.pa[i];
    p.direction = p.direction === d ? "" : d;
    if (NO_DIRECTION.indexOf(p.result) >= 0) p.result = "";
    render();
  }

  function pickResult(i, code) {
    var p = S.pa[i];
    if (p.result === code) {
      p.result = "";
      p.rbi = "0";
    } else {
      p.result = code;
      if (NO_DIRECTION.indexOf(code) >= 0) p.direction = "";
    }
    render();
  }

  function resultButton(i, code, kind) {
    var p = S.pa[i];
    var b = el("button", "rb rb-" + kind);
    b.type = "button";
    b.setAttribute("aria-pressed", p.result === code ? "true" : "false");
    b.appendChild(el("span", "rb-t", Stats.RESULT_DEFS[code].label));
    b.addEventListener("click", function () { pickResult(i, code); });
    return b;
  }

  function paColumn(i) {
    var p = S.pa[i];
    var dirOff = NO_DIRECTION.indexOf(p.result) >= 0;
    var col = el("section", "pa-col" + (i === S.cur ? " cur" : ""));
    col.appendChild(el("h3", "pa-title", (i + 1) + "打席目"));

    var c1 = el("div", "rec-card pa-card");
    var h1 = el("div", "pa-h");
    h1.appendChild(el("h4", "", "① どこに飛んだ？"));
    h1.appendChild(el("span", "pa-hint", "グラウンドをタップ"));
    c1.appendChild(h1);
    var pc = isPC();
    var picker = Field.groundPicker(dirOff ? "" : p.direction, function (d) { pickDir(i, d); }, { labels: "short", fontSize: pc ? 22 : 16 });
    var pw = el("div", "ground-wrap");
    pw.appendChild(picker);
    c1.appendChild(pw);
    c1.appendChild(el("div", "pa-sub", "バットに当たらなかった・飛ばなかった"));
    var nb = el("div", "rb-grid rb-grid-nb");
    NOBALL_CODES.forEach(function (code) { nb.appendChild(resultButton(i, code, code === "walk" || code === "hbp" ? "walk" : "out")); });
    c1.appendChild(nb);
    col.appendChild(c1);

    var c2 = el("div", "rec-card pa-card");
    c2.appendChild(el("h4", "pa-h2", "② 結果は？"));
    var hg = el("div", "rb-grid rb-grid-hit");
    HIT_CODES.forEach(function (code) { hg.appendChild(resultButton(i, code, "hit")); });
    c2.appendChild(hg);
    var og = el("div", "rb-grid rb-grid-out");
    OUT_CODES.forEach(function (code) { og.appendChild(resultButton(i, code, code === "reached_on_error" ? "err" : "out")); });
    c2.appendChild(og);
    col.appendChild(c2);

    var c3 = el("div", "rec-card pa-card pa-rbi");
    c3.appendChild(el("h4", "pa-h2", "③ 打点"));
    var rg = el("div", "rb-group rb-rbi");
    [0, 1, 2, 3, 4].forEach(function (n) {
      var b = el("button", "rb rb-round num", String(n));
      b.type = "button";
      b.setAttribute("aria-pressed", String(parseInt(p.rbi, 10) || 0) === String(n) ? "true" : "false");
      b.addEventListener("click", function () { p.rbi = String(n); render(); });
      rg.appendChild(b);
    });
    c3.appendChild(rg);
    col.appendChild(c3);
    var e = err("pa" + (i + 1));
    if (e) col.appendChild(e);

    var band = el("div", "pa-band-rec");
    var bt = el("div", "pbr-t");
    bt.appendChild(el("span", "pbr-k", (i + 1) + "打席目の記録"));
    bt.appendChild(el("span", "pbr-v " + paColor(p), paSummary(p)));
    band.appendChild(bt);
    if (i < 3) {
      var nx = el("button", "pbr-next", "次の打席へ →");
      nx.type = "button";
      nx.addEventListener("click", function () { S.cur = i + 1; render(); });
      band.appendChild(nx);
    }
    col.appendChild(band);
    return col;
  }

  function paBlock() {
    var box = el("div", "rec-pa");
    var tabs = el("div", "pa-tabs");
    tabs.setAttribute("role", "tablist");
    for (var i = 0; i < 4; i++) {
      (function (n) {
        var p = S.pa[n];
        var t = el("button", "pa-tab" + (n === S.cur ? " on" : "") + (p.result ? " filled" : ""));
        t.type = "button";
        t.setAttribute("role", "tab");
        t.setAttribute("aria-selected", n === S.cur ? "true" : "false");
        t.appendChild(el("span", "pt-n", (n + 1) + "打席目"));
        t.appendChild(el("span", "pt-v", p.result ? paSummary(p) : "−"));
        t.addEventListener("click", function () { S.cur = n; render(); });
        tabs.appendChild(t);
      })(i);
    }
    box.appendChild(tabs);
    var cols = el("div", "pa-cols");
    for (var j = 0; j < 4; j++) cols.appendChild(paColumn(j));
    box.appendChild(cols);
    return box;
  }

  // ---- 試合情報 ----
  function infoSummary() {
    var sq = S.squad ? S.squad + "チーム" : "チーム未選択";
    var order = S.battingOrder ? S.battingOrder + "番" : "";
    var line = [sq, S.competition || "大会未入力", order].filter(function (x) { return x !== ""; }).join("・");
    var dateText = S.date === today() ? "今日" : (S.date ? parseInt(S.date.slice(5, 7), 10) + "/" + parseInt(S.date.slice(8, 10), 10) : "日付");
    return { dateText: dateText, line: line, opp: "vs " + (S.opponent || "[相手チーム]") };
  }

  function infoCard() {
    var sec = section("rec-info");
    var sum = infoSummary();
    var head = el("div", "ri-head");
    head.appendChild(el("div", "ri-date", sum.dateText));
    var mid = el("div", "ri-mid");
    mid.appendChild(el("span", "ri-line", sum.line));
    mid.appendChild(el("span", "ri-opp", sum.opp));
    head.appendChild(mid);
    var chg = el("button", "btn small ri-change", S.infoOpen ? "閉じる" : "変更");
    chg.type = "button";
    chg.addEventListener("click", function () { S.infoOpen = !S.infoOpen; render(); });
    head.appendChild(chg);
    sec.appendChild(head);

    var f = el("div", "rec-fields" + (S.infoOpen ? " open" : ""));
    var row1 = el("div", "rf-row");
    row1.appendChild(textField("日付", S.date, function (v) { S.date = v; }, { type: "date", required: true }));
    row1.appendChild(textField("学年（1〜6）", S.grade, function (v) { S.grade = v; }, { type: "number", min: 1, max: 6, inputmode: "numeric", required: true }));
    f.appendChild(row1);
    [err("date"), err("grade")].forEach(function (e) { if (e) f.appendChild(e); });

    var sqBlock = el("div", "rf-block");
    sqBlock.appendChild(el("div", "rf-l", "チーム区分 *"));
    sqBlock.appendChild(btnGroup([["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]], S.squad, function (v) { S.squad = S.squad === v ? "" : v; render(); }, "rb-squad"));
    if (err("squad")) sqBlock.appendChild(err("squad"));
    f.appendChild(sqBlock);

    f.appendChild(textField("大会", S.competition, function (v) { S.competition = v; }, { list: "dl-competition", required: true }));
    if (err("competition")) f.appendChild(err("competition"));
    f.appendChild(textField("試合ラベル（例：1試合目）", S.gameLabel, function (v) { S.gameLabel = v; }));
    f.appendChild(textField("相手", S.opponent, function (v) { S.opponent = v; }, { list: "dl-opponent", required: true }));
    if (err("opponent")) f.appendChild(err("opponent"));

    var odBlock = el("div", "rf-block rf-order");
    odBlock.appendChild(el("div", "rf-l", "打順"));
    var orders = [];
    for (var n = 1; n <= 9; n++) orders.push([String(n), String(n)]);
    odBlock.appendChild(btnGroup(orders, S.battingOrder, function (v) { S.battingOrder = S.battingOrder === v ? "" : v; render(); }, "rb-order"));
    if (err("battingOrder")) odBlock.appendChild(err("battingOrder"));
    f.appendChild(odBlock);
    sec.appendChild(f);
    return sec;
  }

  // ---- 盗塁（ダイヤモンドの塁をタップ） ----
  var STEAL_MAX = 10;

  function stealTotal() { return S.steal.second + S.steal.third + S.steal.home; }

  function stealChange(key, delta) {
    var v = S.steal[key] + delta;
    if (v < 0) return;
    if (delta > 0 && stealTotal() >= STEAL_MAX) return;
    S.steal[key] = v;
    render();
  }

  // 塁のボタン：タップで＋1、長押し（0.5秒以上）で−1
  function baseButton(key, label, pos) {
    var b = el("button", "base-hit base-" + key);
    b.type = "button";
    b.style.left = pos[0] + "%";
    b.style.top = pos[1] + "%";
    b.setAttribute("aria-label", label + "を数える（タップで＋1、長押しで−1）");
    var timer = null;
    var fired = false;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } }
    b.addEventListener("pointerdown", function () {
      fired = false;
      clear();
      timer = setTimeout(function () { fired = true; timer = null; stealChange(key, -1); }, 500);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { b.addEventListener(ev, clear); });
    b.addEventListener("click", function () {
      if (fired) { fired = false; return; }
      stealChange(key, 1);
    });
    return b;
  }

  function stealCard() {
    var sec = section("rec-steal", "盗塁");
    if (S.stealMode === "diamond") {
      var wrap = el("div", "steal-pick");
      var dwrap = el("div", "steal-dia");
      dwrap.appendChild(Field.diamond({ second: S.steal.second, third: S.steal.third, home: S.steal.home, unknown: 0 }, {}));
      dwrap.appendChild(baseButton("second", "二盗（二塁）", [50, 11.7]));
      dwrap.appendChild(baseButton("third", "三盗（三塁）", [11.7, 50]));
      dwrap.appendChild(baseButton("home", "本盗（本塁）", [50, 88.3]));
      wrap.appendChild(dwrap);
      var ctl = el("div", "steal-ctl");
      [["second", "二盗"], ["third", "三盗"], ["home", "本盗"]].forEach(function (x) {
        var row = el("div", "sc-row");
        row.appendChild(el("span", "sc-l", x[1]));
        var minus = el("button", "rb rb-round", "−");
        minus.type = "button";
        minus.setAttribute("aria-label", x[1] + "を減らす");
        minus.disabled = S.steal[x[0]] === 0;
        minus.addEventListener("click", function () { stealChange(x[0], -1); });
        row.appendChild(minus);
        row.appendChild(el("span", "sc-n num nb", String(S.steal[x[0]])));
        var plus = el("button", "rb rb-round rb-dark", "＋");
        plus.type = "button";
        plus.setAttribute("aria-label", x[1] + "を増やす");
        plus.disabled = stealTotal() >= STEAL_MAX;
        plus.addEventListener("click", function () { stealChange(x[0], 1); });
        row.appendChild(plus);
        ctl.appendChild(row);
      });
      ctl.appendChild(el("div", "sc-total", "盗塁 " + stealTotal() + "（上限 " + STEAL_MAX + "）"));
      wrap.appendChild(ctl);
      sec.appendChild(wrap);
    } else {
      sec.appendChild(el("p", "rec-note", "この試合の盗塁のメモは、ダイヤモンドでは読み取れないため、数とメモのまま入力します（メモは書き換えません）。"));
      sec.appendChild(textField("盗塁の数（0〜10）", S.legacyCount, function (v) { S.legacyCount = v; }, { type: "number", min: 0, max: 10, inputmode: "numeric", required: true }));
      sec.appendChild(textField("盗塁の内訳（メモ）", S.legacyDetail, function (v) { S.legacyDetail = v; }));
    }
    if (err("stolenBases")) sec.appendChild(err("stolenBases"));
    return sec;
  }

  // ---- 守備位置・登板・投手の記録 ----
  // 登板をオンにしたとき、失点・奪三振・与四球・与死球は「0」を最初から入れる（球数・投球回は空欄のまま）。すでに入力がある項目は変えない。
  function setPitched(on) {
    if (on && !S.pitched) {
      ["runs", "strikeouts", "walks", "hitByPitch"].forEach(function (k) { if (S.ps[k] === "") S.ps[k] = "0"; });
    }
    S.pitched = on;
  }

  function syncPositions() {
    var filled = S.positions.filter(function (v) { return v !== ""; });
    if (filled.length > 0) setPitched(filled.indexOf("P") >= 0);
  }

  function positionNames() {
    return S.positions.filter(function (v) { return v !== ""; }).map(function (c) {
      var n = c;
      Stats.POSITIONS.forEach(function (p) { if (p.code === c) n = p.label; });
      return n;
    });
  }

  function positionCard() {
    var sec = section("rec-pos");
    var head = el("div", "rp-head");
    head.appendChild(el("h3", "rec-h", "守備位置"));
    var names = positionNames();
    head.appendChild(el("span", "rp-sum", names.length ? names.join(" → ") : "未入力"));
    var chg = el("button", "btn small ri-change", S.posOpen ? "閉じる" : "変更");
    chg.type = "button";
    chg.addEventListener("click", function () { S.posOpen = !S.posOpen; render(); });
    head.appendChild(chg);
    sec.appendChild(head);
    var row = el("div", "rp-row" + (S.posOpen ? " open" : ""));
    for (var i = 0; i < 4; i++) {
      (function (n) {
        if (n > 0) row.appendChild(el("span", "rp-arrow", "→"));
        var sel = el("select", "rp-sel");
        sel.setAttribute("aria-label", (n + 1) + "つ目の守備位置");
        var o0 = el("option", "", "（なし）");
        o0.value = "";
        sel.appendChild(o0);
        Stats.POSITIONS.forEach(function (p) {
          var o = el("option", "", p.label);
          o.value = p.code;
          sel.appendChild(o);
        });
        sel.value = S.positions[n];
        sel.addEventListener("change", function () {
          S.positions[n] = sel.value;
          syncPositions();
          render();
        });
        row.appendChild(sel);
      })(i);
    }
    sec.appendChild(row);
    if (err("positions")) sec.appendChild(err("positions"));
    return sec;
  }

  function stepper(label, key) {
    var wrap = el("div", "ps-step");
    wrap.appendChild(el("span", "rf-l", label));
    var row = el("div", "ps-row");
    var limits = { runs: 50, strikeouts: 30, walks: 30, hitByPitch: 30 };
    var minus = el("button", "rb rb-round", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", label + "を減らす");
    var inp = el("input", "ps-in");
    inp.type = "number";
    inp.min = 0;
    inp.max = limits[key];
    inp.setAttribute("inputmode", "numeric");
    inp.value = S.ps[key];
    inp.addEventListener("input", function () { S.ps[key] = inp.value; });
    var plus = el("button", "rb rb-round rb-dark", "＋");
    plus.type = "button";
    plus.setAttribute("aria-label", label + "を増やす");
    minus.addEventListener("click", function () {
      var v = S.ps[key] === "" ? 0 : Math.max(0, (parseInt(S.ps[key], 10) || 0) - 1);
      S.ps[key] = String(v);
      render();
    });
    plus.addEventListener("click", function () {
      var v = S.ps[key] === "" ? 1 : Math.min(limits[key], (parseInt(S.ps[key], 10) || 0) + 1);
      S.ps[key] = String(v);
      render();
    });
    row.appendChild(minus);
    row.appendChild(inp);
    row.appendChild(plus);
    wrap.appendChild(row);
    if (err("ps_" + key)) wrap.appendChild(err("ps_" + key));
    return wrap;
  }

  function pitchCard() {
    var sec = section("rec-pitch", "登板");
    var linked = S.positions.some(function (v) { return v !== ""; });
    var sw = el("button", "sw-toggle");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", S.pitched ? "true" : "false");
    sw.disabled = linked;
    sw.appendChild(el("span", "sw-knob"));
    var swrow = el("div", "sw-row");
    swrow.appendChild(sw);
    swrow.appendChild(el("span", "sw-label", S.pitched ? "登板した" : "登板していない"));
    if (linked) swrow.appendChild(el("span", "rec-note", "守備位置に合わせて自動で決まります"));
    sw.addEventListener("click", function () { setPitched(!S.pitched); render(); });
    sec.appendChild(swrow);

    if (S.pitched) {
      sec.appendChild(el("div", "rf-l", "投球評価"));
      sec.appendChild(btnGroup([["合格", "合格"], ["不合格", "不合格"], ["", "評価なし"]], S.pitchingEval, function (v) { S.pitchingEval = v; render(); }, "rb-eval"));
      if (err("pitchingEval")) sec.appendChild(err("pitchingEval"));

      sec.appendChild(el("h4", "rec-h2", "投手の記録（1試合の合計。空欄＝記録なし）"));
      var grid = el("div", "ps-grid");
      grid.appendChild(textField("球数（0〜200）", S.ps.pitches, function (v) { S.ps.pitches = v; }, { type: "number", min: 0, max: 200, inputmode: "numeric" }));
      var inn = el("div", "ps-inn");
      inn.appendChild(el("span", "rf-l", "投球回"));
      var ir = el("div", "ps-row");
      var whole = el("select", "ps-sel");
      whole.setAttribute("aria-label", "投球回（回）");
      var w0 = el("option", "", "−");
      w0.value = "";
      whole.appendChild(w0);
      for (var n = 0; n <= 10; n++) { var o = el("option", "", n + "回"); o.value = String(n); whole.appendChild(o); }
      whole.value = S.ps.outsWhole;
      var frac = el("select", "ps-sel");
      frac.setAttribute("aria-label", "投球回（1/3単位）");
      [["0", "0"], ["1", "1/3"], ["2", "2/3"]].forEach(function (x) {
        var o = el("option", "", x[1]);
        o.value = x[0];
        if (S.ps.outsWhole === "10" && x[0] !== "0") o.disabled = true;
        frac.appendChild(o);
      });
      frac.value = S.ps.outsFrac;
      whole.addEventListener("change", function () {
        S.ps.outsWhole = whole.value;
        if (whole.value === "10") S.ps.outsFrac = "0";
        render();
      });
      frac.addEventListener("change", function () { S.ps.outsFrac = frac.value; });
      ir.appendChild(whole);
      ir.appendChild(frac);
      inn.appendChild(ir);
      if (err("ps_outs")) inn.appendChild(err("ps_outs"));
      grid.appendChild(inn);
      grid.appendChild(stepper("失点", "runs"));
      grid.appendChild(stepper("奪三振", "strikeouts"));
      grid.appendChild(stepper("与四球", "walks"));
      grid.appendChild(stepper("与死球", "hitByPitch"));
      if (err("ps_pitches")) grid.appendChild(err("ps_pitches"));
      sec.appendChild(grid);
    }
    if (err("pitchingStats")) sec.appendChild(err("pitchingStats"));
    return sec;
  }

  function memoCard() {
    var sec = section("rec-memo", "メモ");
    var ta = el("textarea", "rec-ta");
    ta.rows = 3;
    ta.value = S.memo;
    ta.setAttribute("aria-label", "メモ");
    ta.addEventListener("input", function () { S.memo = ta.value; });
    sec.appendChild(ta);
    return sec;
  }

  // ---- 全体 ----
  function datalists() {
    var box = el("div", "rec-dl");
    function make(id, key) {
      var dl = el("datalist");
      dl.id = id;
      var seen = {};
      var list = [];
      api.getGames().forEach(function (g) { var v = g[key]; if (v && !seen[v]) { seen[v] = true; list.push(v); } });
      list.sort();
      list.forEach(function (v) { var o = el("option"); o.value = v; dl.appendChild(o); });
      box.appendChild(dl);
    }
    make("dl-competition", "competition");
    make("dl-opponent", "opponent");
    return box;
  }

  function refreshLists() {
    if (!root) return;
    var old = root.querySelector(".rec-dl");
    if (old) old.parentNode.replaceChild(datalists(), old);
  }

  function render() {
    if (!root || !S) return;
    var scrollY = window.pageYOffset;
    root.textContent = "";
    var wrap = el("div", "rec");
    if (S.editingId) wrap.appendChild(el("h2", "rec-title", "試合を編集（" + S.existing.date + " " + S.existing.opponent + "）"));
    var keys = Object.keys(S.errors);
    if (keys.length > 0) {
      var box = el("div", "rec-errors");
      box.setAttribute("role", "alert");
      box.appendChild(el("b", "", "入力内容を確認してください。"));
      var ul = el("ul");
      keys.forEach(function (k) { ul.appendChild(el("li", "", S.errors[k])); });
      box.appendChild(ul);
      wrap.appendChild(box);
    }
    var grid = el("div", "rec-grid");
    var info = infoCard();
    info.classList.add("ga-info");
    var pa = paBlock();
    pa.classList.add("ga-pa");
    var steal = stealCard();
    steal.classList.add("ga-steal");
    var pos = positionCard();
    pos.classList.add("ga-pos");
    var pitch = pitchCard();
    pitch.classList.add("ga-pitch");
    var memo = memoCard();
    memo.classList.add("ga-memo");
    [info, pa, steal, pos, pitch, memo].forEach(function (x) { grid.appendChild(x); });
    wrap.appendChild(grid);

    var bar = el("div", "rec-bar");
    var inner = el("div", "rec-bar-in");
    var cancel = el("button", "btn rec-cancel", "キャンセル");
    cancel.type = "button";
    cancel.addEventListener("click", function () { startNew(); api.goto("games"); });
    var save = el("button", "btn primary rec-save", "試合を保存する");
    save.type = "button";
    save.addEventListener("click", submit);
    inner.appendChild(cancel);
    inner.appendChild(save);
    bar.appendChild(inner);
    wrap.appendChild(bar);
    wrap.appendChild(datalists());
    root.appendChild(wrap);
    try { window.scrollTo(0, scrollY); } catch (e) { /* 無視 */ }
  }

  function submit() {
    var input = collect();
    var errors = Validate.validateGameInput(input);
    S.errors = errors;
    if (Object.keys(errors).length > 0) {
      if (["date", "grade", "squad", "competition", "opponent", "battingOrder"].some(function (k) { return errors[k]; })) S.infoOpen = true;
      render();
      try { window.scrollTo(0, 0); } catch (e) { /* 無視 */ }
      return;
    }

    var games = api.getGames();
    var existing = S.existing;
    if (S.editingId !== null) {
      var found = null;
      games.forEach(function (g) { if (g.id === S.editingId) found = g; });
      if (!found) {
        S.errors = { general: "編集対象の試合が見つかりません（削除された可能性があります）。" };
        render();
        return;
      }
      existing = found;
    }
    // 登板を外すと、すでにある投手の記録が消えるので、確認する。
    if (existing && !input.pitched && Derive.hasPitchingValues(existing.pitchingStats)) {
      if (!window.confirm("登板を外すと、投手の記録（球数など）が消えます。よろしいですか？")) return;
    }
    var game = buildGame(input, existing, games);

    var dup = games.some(function (g) {
      return g.id !== game.id && g.date === game.date && g.opponent === game.opponent &&
        (g.gameLabel || "") === game.gameLabel;
    });
    if (dup && !window.confirm("同じ試合が登録済みです。保存しますか？")) return;

    var r = api.saveGame(game, { grade: game.grade, squad: game.squad });
    if (!r.ok) {
      S.errors = { general: r.error };
      render();
      return;
    }
    startNew();
    api.goto("games");
  }

  function startNew() {
    S = newState();
    render();
  }

  function numStr(v, max) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= max ? String(v) : "";
  }

  function startEdit(game) {
    S = newState();
    S.editingId = game.id;
    S.existing = game;
    S.infoOpen = false;
    S.date = game.date;
    S.grade = String(game.grade);
    S.squad = game.squad;
    S.competition = game.competition;
    S.gameLabel = game.gameLabel || "";
    S.opponent = game.opponent;
    S.battingOrder = game.battingOrder === null || game.battingOrder === undefined ? "" : String(game.battingOrder);
    S.pa = [0, 1, 2, 3].map(function (i) {
      var pa = game.plateAppearances[i];
      return pa ? { result: pa.result, direction: pa.direction || "", rbi: String(pa.rbi || 0) } : blankPa();
    });
    var si = Derive.stealInputFromGame(game);
    S.stealMode = si.mode;
    if (si.mode === "diamond") {
      S.steal = { second: si.second, third: si.third, home: si.home };
      S.stealOrig = { second: si.second, third: si.third, home: si.home, text: si.original };
    } else {
      S.legacyCount = String(game.stolenBases || 0);
      S.legacyDetail = si.original;
    }
    S.pitched = game.pitched === true;
    S.pitchingEval = game.pitchingEval || "";
    S.positions = [0, 1, 2, 3].map(function (i) { return (game.positions && game.positions[i]) || ""; });
    var ps = game.pitchingStats;
    if (S.pitched && ps && typeof ps === "object") {
      var inn = Derive.inningsFromOuts(ps.outs);
      S.ps = {
        pitches: numStr(ps.pitches, 200), outsWhole: inn ? String(inn.whole) : "", outsFrac: inn ? String(inn.frac) : "0",
        runs: numStr(ps.runs, 50), strikeouts: numStr(ps.strikeouts, 30), walks: numStr(ps.walks, 30), hitByPitch: numStr(ps.hitByPitch, 30)
      };
    }
    S.memo = game.memo || "";
    render();
    api.goto("form");
  }

  window.GameForm = {
    init: function (rootEl, apiObj) {
      root = rootEl;
      api = apiObj;
      if (mq) {
        var again = function () { render(); };
        if (mq.addEventListener) mq.addEventListener("change", again);
        else if (mq.addListener) mq.addListener(again);
      }
      startNew();
    },
    startNew: startNew,
    startEdit: startEdit,
    refreshLists: refreshLists,
    buildGame: buildGame,
    newId: newId,
    stateKey: stateKey,
    collect: collect
  };
})();
