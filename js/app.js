(function () {
  "use strict";

  var fmt = Stats.formatRate;
  var KEY = Storage2.DEFAULT_KEY;

  // state.status: "ok" | "initialized" | "corrupt" | "unavailable"
  var state = {
    status: "ok",
    data: null,        // 検証済みのデータ（corrupt のときは null）
    raw: null,         // corrupt のときの、保存されていた文字列
    errors: [],        // corrupt のときの検証エラー
    loadedAt: null,    // 読み込んだ時点の meta.lastModifiedAt
    notice: "",        // 直近の操作の結果メッセージ
    loaded: null,      // needsMigration のときの読込結果（移行に使う）
    noticeOk: false,   // true なら成功メッセージ（緑）、false ならエラー（赤）
    filter: { squad: "", grade: "" },  // 絞り込み（表示だけに効く。保存しない）
    pitchedOnly: false,                // 「登板のみ」（試合の画面だけ。保存しない）
    openMonths: {},                    // 試合の月ごとの開閉（保存しない）
    ui: { gamesView: "cards" },        // 表示の設定（試合：カード／表）。成績データとは別のキーに保存する
    tableDesc: true,                   // 試合の成績表：新しい試合が上（保存しない）
    sprayMode: "all",                  // 打球方向：全打球／安打／凡打・エラー（保存しない）
    fieldMode: "appear",               // 守備位置：守った試合／先発の位置（保存しない）
    openTables: {}                     // スマホの「全項目を表で見る」の開閉（保存しない）
  };
  var currentTab = "dashboard";
  var FILTER_TABS = ["dashboard", "games", "charts", "run", "analysis"];
  var STATS_TABS = ["charts", "run", "analysis"];   // スマホの「成績」にまとまる3画面

  // チーム名。Phase 5 で設定画面から変えられるようにする。
  var TEAM_NAME = "槇塚台ロイヤルズ";

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // 全試合。保存・削除・復元・バックアップ・データ管理・試合入力フォームは、必ずこちらを使う。
  function games() {
    return state.data ? state.data.games : [];
  }

  // 絞り込み後の試合。ダッシュボード・試合一覧・グラフ・成績分析の表示だけに使う。
  function viewGames() {
    return Stats.filterGames(games(), state.filter);
  }

  function filterActive() {
    return state.filter.squad !== "" || state.filter.grade !== "";
  }

  // 例：「Cチーム・3年生」。「すべて」の部分は含めない。
  function filterLabel() {
    var parts = [];
    if (state.filter.squad !== "") parts.push(state.filter.squad + "チーム");
    if (state.filter.grade !== "") parts.push(state.filter.grade + "年生");
    return parts.join("・");
  }

  // 表示する試合が0件なら、メッセージを出して true を返す。
  function showEmptyIfNone(root) {
    if (viewGames().length > 0) return false;
    root.appendChild(el("p", "empty", filterActive() ? "条件に合う試合がありません。" : "試合データがありません。"));
    return true;
  }

  // 選んでいた値が選択肢から消えていたら「すべて」に戻す。
  function sanitizeFilter() {
    var opts = Stats.filterOptions(games());
    if (state.filter.squad !== "" && opts.squads.indexOf(state.filter.squad) < 0) state.filter.squad = "";
    if (state.filter.grade !== "" && opts.grades.indexOf(Number(state.filter.grade)) < 0) state.filter.grade = "";
  }

  function renderFilterBar() {
    var bar = document.getElementById("filter-bar");
    clear(bar);
    bar.hidden = !(state.data && FILTER_TABS.indexOf(currentTab) >= 0);
    if (bar.hidden) return;
    var opts = Stats.filterOptions(games());

    // チーム：チップ（すべて／入力済みのチーム）
    var group = el("div", "chip-group");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "チーム");
    [["", "すべて"]].concat(opts.squads.map(function (s) { return [s, s + "チーム"]; })).forEach(function (o) {
      var chip = el("button", "chip", o[1]);
      chip.type = "button";
      chip.setAttribute("aria-pressed", state.filter.squad === o[0] ? "true" : "false");
      chip.addEventListener("click", function () { state.filter.squad = o[0]; renderAll(); });
      group.appendChild(chip);
    });
    bar.appendChild(group);

    // 学年：選択欄（試合に2つ以上の学年があるときだけ）
    if (opts.grades.length >= 2 || state.filter.grade !== "") {
      var sel = el("select", "filter-select filter-grade");
      sel.setAttribute("aria-label", "学年");
      [["", "全学年"]].concat(opts.grades.map(function (n) { return [String(n), n + "年生"]; })).forEach(function (o) {
        var opt = el("option", "", o[1]);
        opt.value = o[0];
        sel.appendChild(opt);
      });
      sel.value = String(state.filter.grade);
      sel.addEventListener("change", function () {
        state.filter.grade = sel.value === "" ? "" : Number(sel.value);
        renderAll();
      });
      bar.appendChild(sel);
    }

    if (filterActive()) {
      bar.appendChild(el("span", "filter-status", filterLabel() + "：" + viewGames().length + "試合を表示中"));
      var reset = el("button", "filter-reset", "解除");
      reset.type = "button";
      reset.addEventListener("click", function () {
        state.filter.squad = "";
        state.filter.grade = "";
        renderAll();
      });
      bar.appendChild(reset);
    }

    // 「登板のみ」：試合の画面だけで使う（スマホはここ、PCは画面名の右）
    if (currentTab === "games") bar.appendChild(pitchedChip("chip-pitched-m"));
  }

  function pitchedChip(extra) {
    var chip = el("button", "chip chip-pitched " + extra, "登板のみ");
    chip.type = "button";
    chip.setAttribute("aria-pressed", state.pitchedOnly ? "true" : "false");
    chip.addEventListener("click", function () { state.pitchedOnly = !state.pitchedOnly; renderAll(); });
    return chip;
  }

  // 絞り込み欄の置き場所：PCはヘッダーの1段目、スマホはヘッダーの下
  var mq = window.matchMedia ? window.matchMedia("(min-width: 768px)") : null;
  function isPC() { return mq ? mq.matches : true; }

  function placeFilterBar() {
    var bar = document.getElementById("filter-bar");
    document.getElementById(isPC() ? "filter-slot-pc" : "filter-slot-mobile").appendChild(bar);
  }

  // ---- ヘッダー（チーム名・選手名・補足・画面名・バックアップの注意） ----
  var SCREEN_NAMES = { dashboard: "", games: "試合", charts: "打つ", run: "走る", analysis: "守る", form: "試合を記録", data: "データ管理" };
  var SCREEN_TITLES_MOBILE = { games: "試合", charts: "成績　打つ", run: "成績　走る", analysis: "成績　守る", form: "試合を記録", data: "データ管理" };

  function screenSub(name, n) {
    return {
      games: (state.pitchedOnly ? "登板のみ・" : "") + n + "試合・新しい順",
      charts: n + "試合の打撃",
      run: n + "試合の走塁",
      analysis: n + "試合の守備と登板",
      form: "試合を記録します",
      data: "バックアップと復元"
    }[name] || "";
  }

  function renderHeader() {
    document.body.classList.toggle("home", currentTab === "dashboard");
    var view = state.data ? viewGames() : [];
    var n = view.length;
    // 試合の画面：「登板のみ」のときは、表示している試合の数を出す
    var shown = n;
    if (currentTab === "games" && state.pitchedOnly) shown = view.filter(function (g) { return g.pitched === true; }).length;
    var player = state.data && state.data.player ? state.data.player : "悠翔";

    document.getElementById("hd-team").textContent = TEAM_NAME;
    document.getElementById("hd-avatar").textContent = player.charAt(0);
    document.getElementById("hd-player").textContent = player;
    document.getElementById("hd-sub").textContent = n > 0 ? gradeText(view) + "・" + periodText(view) + "・" + n + "試合" : "";

    // スマホ（ホーム以外）：ヘッダーに画面名と補足を出す
    document.getElementById("hd-screen").textContent = SCREEN_TITLES_MOBILE[currentTab] || "";
    document.getElementById("hd-screen-sub").textContent = screenSub(currentTab, shown);

    // PC（ホーム以外）：内容の上部に画面名
    var ph = document.getElementById("page-head");
    clear(ph);
    ph.hidden = currentTab === "dashboard";
    if (currentTab !== "dashboard") {
      ph.appendChild(el("h1", "", SCREEN_NAMES[currentTab]));
      ph.appendChild(el("span", "ph-sub", screenSub(currentTab, shown)));
      if (currentTab === "games" && state.data) {
        var spacer = el("span", "ph-spacer");
        ph.appendChild(spacer);
        ph.appendChild(pitchedChip("chip-pitched-pc"));
      }
    }

    // 成績（スマホ）：打つ／走る／守る の切り替えタブ
    var seg = document.getElementById("seg-tabs");
    seg.hidden = STATS_TABS.indexOf(currentTab) < 0;
    Array.prototype.forEach.call(seg.querySelectorAll(".seg"), function (b) {
      var on = b.getAttribute("data-tab") === currentTab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });

    // PC：バックアップ未保存の注意（ヘッダー1段目）
    var hb = document.getElementById("header-backup");
    clear(hb);
    var warn = state.data && canEdit() && backupInfo().warn;
    hb.hidden = !warn;
    hb.classList.toggle("show", !!warn);
    if (warn) {
      hb.appendChild(el("span", "t", "バックアップしていない変更があります"));
      var btn = el("button", "btn dark small", "保存");
      btn.type = "button";
      btn.addEventListener("click", doBackup);
      hb.appendChild(btn);
    }
  }

  function canEdit() {
    return state.status === "ok" || state.status === "initialized";
  }

  function clear(node) {
    node.textContent = "";
  }

  // ---- 保存 ----
  // 変更後のデータを保存し、成功したら状態を差し替えて描き直す。失敗したら状態は変えない。
  function commit(newData, opts) {
    var r = Storage2.save(KEY, newData, state.loadedAt, opts);
    if (!r.ok) {
      state.notice = r.error;
      state.noticeOk = false;
      renderAll();
      return r;
    }
    state.data = r.data;
    state.loadedAt = r.data.meta.lastModifiedAt;
    state.status = "ok";
    state.notice = "";
    state.noticeOk = false;
    renderAll();
    return r;
  }

  function saveGame(game, lastInput) {
    if (!canEdit()) return { ok: false, error: "データが保存できない状態のため、保存できません。" };
    var next = Storage2.deepCopy(state.data);
    var idx = -1;
    next.games.forEach(function (g, i) { if (g.id === game.id) idx = i; });
    if (idx >= 0) next.games[idx] = game;
    else next.games.push(game);
    next.meta.lastInput = lastInput;
    return commit(next);
  }

  function deleteGame(game) {
    var msg = game.date + " " + game.opponent + "戦を削除しますか？（元に戻すにはバックアップからの復元が必要です）";
    if (!window.confirm(msg)) return;
    var next = Storage2.deepCopy(state.data);
    next.games = next.games.filter(function (g) { return g.id !== game.id; });
    commit(next);
  }

  // ---- バックアップ ----
  function doBackup() {
    if (!canEdit()) return;
    // ファイルには、記録前の meta がそのまま入る。
    Storage2.downloadText(Storage2.backupFileName("backup"), Storage2.toJsonText(state.data));
    var next = Storage2.deepCopy(state.data);
    next.meta.lastBackupAt = Storage2.nowIso();
    commit(next, { touch: false });
  }

  function doRestore(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () {
      state.noticeOk = false;
      state.notice = "ファイルを読み込めませんでした。現在のデータは変更していません。";
      renderAll();
    };
    reader.onload = function () {
      var parsed = Storage2.parseBackup(String(reader.result));
      if (!parsed.ok) {
        state.noticeOk = false;
        state.notice = "復元を中止しました（現在のデータは変更していません）：" + parsed.errors.join(" ");
        renderAll();
        return;
      }
      var cur = state.status === "corrupt" ? "現在の保存データ（読み込めない状態）" : "現在の" + games().length + "試合";
      var msg = cur + "を、バックアップの" + parsed.data.games.length + "試合に置き換えます。" +
        (parsed.migrated ? "（古い形式のため、守備位置をメモから補完します）" : "") + "よろしいですか？";
      if (!window.confirm(msg)) return;

      // 置き換える直前に、現在のデータを自動でダウンロードする。
      // 読み込めない状態・更新前（v2）の状態では、保存されている文字列をそのまま書き出す。
      var rawState = state.status === "corrupt" || state.status === "needsMigration";
      var before = rawState ? state.raw : Storage2.toJsonText(state.data);
      if (before !== null) {
        Storage2.downloadText(Storage2.backupFileName("before-restore"), before);
      }
      var next = parsed.data;
      next.meta.lastBackupAt = null;
      var r = commit(next, { allowCorrupt: true });
      if (r.ok) {
        state.raw = null;
        state.loaded = null;
        GameForm.startNew();
        snapshotForm();
        state.notice = "バックアップから復元しました。";
        state.noticeOk = true;
        renderAll();
      }
    };
    reader.readAsText(file);
  }

  // ---- バックアップ状態 ----
  function backupInfo() {
    var meta = state.data.meta;
    var text = "最終バックアップ：" + (meta.lastBackupAt ? meta.lastBackupAt.replace("T", " ").slice(0, 16) : "なし");
    var warn = false;   // 見本版：「バックアップしていない変更があります」は出さない（元：!meta.lastBackupAt || Date.parse(meta.lastModifiedAt) > Date.parse(meta.lastBackupAt)）
    return { text: text, warn: warn };
  }

  function backupBox(extraClass) {
    var box = el("div", "backup-box" + (extraClass ? " " + extraClass : ""));
    if (!state.data) return box;
    var info = backupInfo();
    box.appendChild(el("span", "backup-text", info.text));
    if (info.warn && canEdit()) {
      box.classList.add("warn");
      box.appendChild(el("span", "backup-warn", "バックアップしていない変更があります"));
      var btn = el("button", "btn dark small", "保存");
      btn.type = "button";
      btn.addEventListener("click", doBackup);
      box.appendChild(btn);
    }
    return box;
  }

  // ---- 画面上部の表示 ----
  function renderBanner() {
    var root = document.getElementById("banner");
    clear(root);
    if (state.status === "corrupt") {
      var e = el("div", "banner bad");
      e.appendChild(el("strong", "", "保存データを読み込めません。"));
      e.appendChild(el("div", "", "データは上書きしていません。「データ管理」タブの「バックアップから復元」だけを使えます。"));
      var ul = el("ul");
      state.errors.slice(0, 10).forEach(function (m) { ul.appendChild(el("li", "", m)); });
      e.appendChild(ul);
      root.appendChild(e);
    } else if (state.status === "needsMigration") {
      root.appendChild(el("div", "banner warn",
        "データ形式の更新（守備位置の追加）が必要です。内容を確認して「バックアップを保存して更新」を押してください。"));
    } else if (state.status === "unavailable") {
      root.appendChild(el("div", "banner bad",
        "データが保存されません（このブラウザでは localStorage が使えません）。表示している内容は初期データです。追加・編集・削除はできません。"));
    }
    if (state.notice) {
      root.appendChild(el("div", state.noticeOk ? "banner ok" : "banner bad", state.notice));
    }
  }

  function unreadableNotice(root) {
    root.appendChild(el("p", "empty", "保存データを読み込めないため表示できません。「データ管理」タブから復元してください。"));
  }

  // ---- 共通の表示部品 ----
  var SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs) {
    var e = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function mdLabel(date) {
    var p = date.split("-");
    return parseInt(p[1], 10) + "/" + parseInt(p[2], 10);
  }

  function ymdLabel(date) {
    var p = date.split("-");
    return p[0] + "/" + parseInt(p[1], 10) + "/" + parseInt(p[2], 10);
  }

  // 例：7/4〜10/18（年をまたぐときは、始まりと終わりに年を付ける）
  function periodText(view) {
    var dates = view.map(function (x) { return x.date; }).sort();
    if (dates.length === 0) return "試合なし";
    var a = dates[0];
    var b = dates[dates.length - 1];
    var sameYear = a.slice(0, 4) === b.slice(0, 4);
    return sameYear ? mdLabel(a) + "〜" + mdLabel(b) : ymdLabel(a) + "〜" + ymdLabel(b);
  }

  // 絞り込みで学年を選んでいればその学年。「すべて」のときは、試合の学年が1種類ならその学年、複数なら「複数学年」。
  function gradeText(view) {
    if (state.filter.grade !== "") return state.filter.grade + "年生";
    var seen = [];
    view.forEach(function (g) { if (seen.indexOf(Number(g.grade)) < 0) seen.push(Number(g.grade)); });
    return seen.length === 1 ? seen[0] + "年生" : "複数学年";
  }

  function multiYear() {
    var years = {};
    games().forEach(function (g) { years[g.date.slice(0, 4)] = true; });
    return Object.keys(years).length > 1;
  }

  function axisLabelsFor(series) {
    if (window.Charts && window.Charts.axisLabels) return window.Charts.axisLabels(series);
    return series.map(function (p) { return mdLabel(p.game.date); });
  }

  // ---- 試合のカード ----
  function paSpan(pa) {
    return el("span", Stats.paCategory(pa), Stats.formatPA(pa));
  }

  function setExpanded(main, detail, open) {
    detail.hidden = !open;
    main.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function gameDetail(g) {
    var box = el("div", "gc-detail");
    box.hidden = true;
    var dl = el("dl");
    var items = [["メモ", g.memo], ["盗塁の内訳", g.stealDetail]];
    if (g.pitched) items.push(["投球評価", g.pitchingEval]);
    if (g.pitched && Derive.hasPitchingValues(g.pitchingStats)) {
      var pt = Derive.pitchingTexts(g.pitchingStats);
      items.push(["投手の記録", "球数 " + pt.pitches + "・投球回 " + pt.innings + "・失点 " + pt.runs + "・奪三振 " + pt.strikeouts + "・与四球 " + pt.walks + "・与死球 " + pt.hitByPitch]);
    }
    items.forEach(function (x) {
      dl.appendChild(el("dt", "", x[0]));
      dl.appendChild(el("dd", "", x[1] || "（なし）"));
    });
    box.appendChild(dl);
    if (canEdit()) {
      var btns = el("div", "detail-buttons");
      var edit = el("button", "btn small", "編集");
      edit.type = "button";
      edit.addEventListener("click", function () { GameForm.startEdit(g); });
      var del = el("button", "btn small danger", "削除");
      del.type = "button";
      del.addEventListener("click", function () { deleteGame(g); });
      btns.appendChild(edit);
      btns.appendChild(del);
      box.appendChild(btns);
    } else if (state.status === "needsMigration") {
      box.appendChild(el("p", "empty", "先にデータ形式を更新してください（編集・削除はできません）。"));
    }
    return box;
  }

  // ---- 小さな部品 ----
  function textEl(tag, className, parts) {
    // parts: 文字列と要素の配列
    var e = el(tag, className);
    parts.forEach(function (p) { e.appendChild(typeof p === "string" ? document.createTextNode(p) : p); });
    return e;
  }

  function icon(pathList, extraAttrs) {
    var svg = svgEl("svg", Object.assign({ viewBox: "0 0 24 24", "aria-hidden": "true" }, extraAttrs || {}));
    pathList.forEach(function (d) {
      var p = d.indexOf("circle:") === 0
        ? svgEl("circle", { cx: d.split(":")[1], cy: d.split(":")[2], r: d.split(":")[3] })
        : svgEl("path", { d: d });
      svg.appendChild(p);
    });
    return svg;
  }

  // 打つ・走る・守るのアイコン（バット・スパイク・グローブ）。docs/design/F_icons2.dc.html の SVG をそのまま使う（viewBox 0 0 48 48）。
  var TOOL_ICONS = {
    bat: '<g transform="rotate(-45 24 24)"><ellipse cx="6.4" cy="24" rx="2.3" ry="3.8" fill="#FFFFFF"></ellipse><path d="M8 22.3 L20 22 C26 21.7 29 19.2 34 19.2 L41.6 19.2 C43.8 19.2 45 21.3 45 24 C45 26.7 43.8 28.8 41.6 28.8 L34 28.8 C29 28.8 26 26.3 20 26 L8 25.7 Z" fill="#FFFFFF"></path><path d="M8 24 L20 24 C26 24 29 24 34 24 L45 24 C45 26.7 43.8 28.8 41.6 28.8 L34 28.8 C29 28.8 26 26.3 20 26 L8 25.7 Z" fill="#000000" opacity="0.13"></path><path d="M9.6 22.2 L11 25.8 M11.9 22.2 L13.3 25.8 M14.2 22.1 L15.6 25.9 M16.5 22.1 L17.9 25.9" stroke="#C8102E" stroke-width="0.9" stroke-linecap="round" opacity="0.75"></path><path d="M27 21.6 C30 20.6 33 20.4 41 20.5" stroke="#C8102E" stroke-width="0.7" fill="none" opacity="0.35" stroke-linecap="round"></path></g><circle cx="11.5" cy="11.5" r="7.2" fill="#FFFFFF"></circle><path d="M11.5 4.3 A7.2 7.2 0 0 1 11.5 18.7 A7.2 7.2 0 0 0 11.5 4.3 Z" fill="#000000" opacity="0.08"></path><path d="M7 5.9 C9.8 8.6 9.8 14.4 7 17.1 M16 5.9 C13.2 8.6 13.2 14.4 16 17.1" stroke="#C8102E" stroke-width="0.8" fill="none"></path><path d="M7.6 7.4 L9.2 6.9 M8.4 9.3 L10 9.1 M8.7 11.5 L10.3 11.5 M8.4 13.7 L10 13.9 M7.6 15.6 L9.2 16.1 M15.4 7.4 L13.8 6.9 M14.6 9.3 L13 9.1 M14.3 11.5 L12.7 11.5 M14.6 13.7 L13 13.9 M15.4 15.6 L13.8 16.1" stroke="#C8102E" stroke-width="0.7" stroke-linecap="round"></path>',
    run: '<path d="M6 31 C5 26 5 21 6.5 17.5 C7.2 15.8 8.8 15.2 10.4 15.8 C12.5 16.6 14.5 17.4 16.6 16.8 L18.6 15.4 C19.6 14.9 20.6 15.4 20.8 16.4 L21.2 18.4 C26 19.8 31 21.4 36.5 22.8 C41 24 44 26 44.4 29.2 L44.4 31 Z" fill="#FFFFFF"></path><path d="M6 31 C5 26 5 21 6.5 17.5 C8.5 19.5 11 23 11.5 31 Z" fill="#000000" opacity="0.12"></path><path d="M36.5 22.8 C41 24 44 26 44.4 29.2 L44.4 31 L35.5 31 C35.6 27.5 35.8 25 36.5 22.8 Z" fill="#000000" opacity="0.12"></path><path d="M7.6 17.2 C9 16.6 11.5 17.6 13.5 18.3 C15 18.8 16.5 18.6 17.6 17.8" stroke="#15803D" stroke-width="0.7" fill="none" opacity="0.55"></path><path d="M21.6 19 L24.6 21.2 M24.6 19.6 L21.8 21.8 M25.4 20.1 L28.4 22.3 M28.4 20.7 L25.6 22.9 M29.2 21.2 L32.2 23.4 M32.2 21.8 L29.4 24" stroke="#15803D" stroke-width="0.8" stroke-linecap="round"></path><circle cx="21.6" cy="19" r="0.7" fill="#15803D"></circle><circle cx="25.4" cy="20.1" r="0.7" fill="#15803D"></circle><circle cx="29.2" cy="21.2" r="0.7" fill="#15803D"></circle><circle cx="33" cy="22.3" r="0.7" fill="#15803D"></circle><path d="M12.5 31 C13 27 15 25 19 25 L35 27.2" stroke="#15803D" stroke-width="0.6" fill="none" opacity="0.45" stroke-dasharray="1.2 1"></path><path d="M4.8 31.2 L45 31.2 L45 33.4 C45 34.2 44.4 34.8 43.6 34.8 L6.2 34.8 C5.4 34.8 4.8 34.2 4.8 33.4 Z" fill="#FFFFFF"></path><path d="M5 33 L44.8 33" stroke="#000000" stroke-width="0.6" opacity="0.12"></path><path d="M6.8 34.8 L7.8 39.4 L9.8 39.4 L10.8 34.8 Z M13.4 34.8 L14.4 39.4 L16.4 39.4 L17.4 34.8 Z M26.6 34.8 L27.6 39.4 L29.6 39.4 L30.6 34.8 Z M33.2 34.8 L34.2 39.4 L36.2 39.4 L37.2 34.8 Z M39.6 34.8 L40.6 39 L42.4 39 L43.2 34.8 Z" fill="#FFFFFF"></path>',
    field: '<g transform="translate(1.5 0)"><path d="M5.8 15.2 L16.6 8.4 L17.8 22.4 L11.2 26 Z" fill="#FFFFFF" opacity="0.88"></path><path d="M7.4 16.4 L16.9 11.2 M8.6 19.2 L17.2 14.6 M9.8 22 L17.5 18 M9.6 14 L12.4 25 M13 11.6 L15.2 23.6" stroke="#1D4ED8" stroke-width="0.75" stroke-linecap="round"></path><g fill="#FFFFFF"><rect x="4.6" y="13" width="7" height="19" rx="3.5" transform="rotate(-30 8.1 31)"></rect><path d="M6.4 27 C7.6 33.5 13 37.6 20 38.8 L17.6 23 Z"></path><rect x="15.8" y="6.4" width="6.6" height="20" rx="3.3" transform="rotate(-9 19 26)"></rect><rect x="21.6" y="3.6" width="6.6" height="22" rx="3.3" transform="rotate(-2 24.9 26)"></rect><rect x="27.4" y="4.8" width="6.6" height="21" rx="3.3" transform="rotate(5 30.7 26)"></rect><rect x="33" y="8.6" width="6.2" height="18" rx="3.1" transform="rotate(12 36 26)"></rect><path d="M15.6 21 L40.6 21 C41.4 29.5 39.4 36.6 34 39.4 L21.2 39.4 C17.6 37.6 15.6 31 15.6 21 Z"></path></g><path d="M22.2 8.5 L21.6 22.5 M27.9 7.5 L27.9 22.5 M33.3 9.5 L34 22.5" stroke="#1D4ED8" stroke-width="0.9" stroke-linecap="round" opacity="0.8"></path><path d="M19.2 9.5 L18.4 20 M25 6.5 L24.9 20 M30.8 7.6 L31 20 M36.3 11.5 L37 20" stroke="#1D4ED8" stroke-width="0.5" stroke-dasharray="1 1" opacity="0.55"></path><path d="M5.6 19 C6.4 25 9.6 30 14.6 32.6" stroke="#1D4ED8" stroke-width="0.6" fill="none" stroke-dasharray="1.1 0.9" opacity="0.6"></path><path d="M20 31 C23.5 35.5 33.5 35.5 38 30 C35.5 33.2 24 33.6 20 31 Z" fill="#000000" opacity="0.12"></path><path d="M19.6 26 C23.5 28.6 32.5 28.6 37.6 25.6" stroke="#000000" stroke-width="0.6" fill="none" opacity="0.12"></path><rect x="19" y="38.2" width="18.6" height="5.4" rx="2.6" fill="#FFFFFF"></rect><path d="M19.6 38.4 L37 38.4" stroke="#1D4ED8" stroke-width="0.8" opacity="0.6"></path><circle cx="33.6" cy="40.9" r="1.3" fill="#1D4ED8"></circle></g>'
  };

  function toolIcon(kind) {
    var svg = svgEl("svg", { viewBox: "0 0 48 48", "aria-hidden": "true", "class": "tool-svg" });
    svg.innerHTML = TOOL_ICONS[kind];
    return svg;
  }

  // 打つ・走る・守るのブロックの見出し
  function blockHead(kind, title, tab) {
    var head = el("div", "blk-head");
    var ico = el("span", "ico ico-" + kind);
    ico.appendChild(toolIcon(kind));
    head.appendChild(ico);
    head.appendChild(el("h2", "", title));
    var more = el("a", "blk-more", "くわしく →");
    more.href = "#";
    more.addEventListener("click", function (ev) { ev.preventDefault(); showTab(tab); });
    head.appendChild(more);
    return head;
  }

  function monthName(m, withYear) {
    var p = m.split("-");
    return (withYear ? p[0] + "年" : "") + parseInt(p[1], 10) + "月";
  }

  // 調子のアイコン（丸＋リング＋太い矢印）。矢印の向きは真上・右上・右・右下・真下。
  var COND = {
    zekkocho: { color: "#EC4899", ring: "#FBCFE8", arrow: "#FFFFFF", rot: -90 },
    kocho: { color: "#DC2626", ring: "#FECACA", arrow: "#FFFFFF", rot: -45 },
    futsu: { color: "#FACC15", ring: "#FEF08A", arrow: "#713F12", rot: 0 },
    fucho: { color: "#38BDF8", ring: "#BAE6FD", arrow: "#0C4A6E", rot: 45 },
    zetsufucho: { color: "#7C3AED", ring: "#DDD6FE", arrow: "#FFFFFF", rot: 90 }
  };

  function conditionIcon(level, size) {
    var svg = svgEl("svg", { width: String(size), height: String(size), viewBox: "0 0 112 112", "aria-hidden": "true", "class": "cond-icon" });
    if (!level) {
      svg.appendChild(svgEl("circle", { cx: 56, cy: 56, r: 52, fill: "#A1A1AA" }));
      var t = svgEl("text", { x: 56, y: 72, "text-anchor": "middle", fill: "#FFFFFF", "font-size": "52", "font-weight": "700", "font-family": "Oswald, sans-serif" });
      t.textContent = "−";
      svg.appendChild(t);
      return svg;
    }
    var c = COND[level];
    svg.appendChild(svgEl("circle", { cx: 56, cy: 56, r: 52, fill: c.color }));
    svg.appendChild(svgEl("circle", { cx: 56, cy: 56, r: 44, fill: "none", stroke: c.ring, "stroke-width": 3 }));
    var g = svgEl("g", { transform: "rotate(" + c.rot + " 56 56)" });
    g.appendChild(svgEl("path", {
      d: "M30 56 H74 M60 40 L78 56 L60 72", fill: "none", stroke: c.arrow, "stroke-width": 12,
      "stroke-linecap": "round", "stroke-linejoin": "round"
    }));
    svg.appendChild(g);
    return svg;
  }

  // ホームの調子の札（アイコン＋調子の名前＋「最近5試合 .750・5試合連続ヒット」）
  function conditionCard(view, iconSize) {
    var cond = Stats.conditionLevel(view);
    var rec = Stats.recentForm(view, 5);
    var streak = Stats.hitStreak(view);
    var card = el("div", "cond-card cond-" + (cond.level || "none"));
    card.appendChild(conditionIcon(cond.level, iconSize));
    var txt = el("div", "cond-text");
    txt.appendChild(el("span", "cond-label", cond.label));
    var detail;
    if (!cond.level) {
      detail = "判定なし（打数が少ない）";
    } else {
      detail = "最近5試合 " + fmt(rec.avg) + (streak > 0 ? "・" + streak + "試合連続ヒット" : "");
    }
    txt.appendChild(el("span", "cond-detail", detail));
    card.appendChild(txt);
    return card;
  }

  // 安打の内訳の帯（ヒット／二塁打／三塁打／本塁打の4色）
  function hitBand(s) {
    var band = el("div", "hit-band");
    band.setAttribute("role", "img");
    band.setAttribute("aria-label", "安打" + s.hits + "本の内訳：ヒット" + s.singles + "、二塁打" + s.doubles + "、三塁打" + s.triples + "、本塁打" + s.homeRuns);
    [["b1", s.singles], ["b2", s.doubles], ["b3", s.triples], ["b4", s.homeRuns]].forEach(function (x) {
      if (x[1] <= 0) return;
      var seg = el("div", "seg-" + x[0], String(x[1]));
      seg.style.flex = String(x[1]);
      band.appendChild(seg);
    });
    return band;
  }

  function legend(items) {
    var box = el("div", "legend");
    items.forEach(function (x) {
      var it = el("span", "lg");
      var sw = el("span", "sw");
      sw.style.background = x[1];
      it.appendChild(sw);
      it.appendChild(document.createTextNode(x[0]));
      box.appendChild(it);
    });
    return box;
  }

  // ---- 成績の説明（打率・出塁率・長打率・OPS の「？」と説明の箱） ----
  var glossPop = null;
  var glossBtn = null;
  function closeGloss() {
    if (glossPop && glossPop.parentNode) glossPop.parentNode.removeChild(glossPop);
    if (glossBtn) glossBtn.setAttribute("aria-expanded", "false");
    glossPop = null;
    glossBtn = null;
  }
  function openGloss(btn, key, summaryFn) {
    closeGloss();
    var term = Glossary.TERMS[key];
    var pop = el("div", "gloss-pop");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", term.name + "の説明");
    pop.appendChild(el("h4", "gp-title", term.name));
    pop.appendChild(el("p", "gp-short", term.short));
    pop.appendChild(el("h5", "gp-h", "計算のしかた"));
    term.how.forEach(function (line) { pop.appendChild(el("p", "gp-how", line)); });
    var ex = Glossary.example(key, summaryFn ? summaryFn() : Stats.summarize(viewGames()));
    if (ex) {
      pop.appendChild(el("h5", "gp-h", "今の数字での例"));
      pop.appendChild(el("p", "gp-ex", ex));
    }
    document.body.appendChild(pop);
    var r = btn.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = window.innerHeight;
    var w = pop.offsetWidth;
    var h = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
    var top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    glossPop = pop;
    glossBtn = btn;
    btn.setAttribute("aria-expanded", "true");
  }
  // 「？」ボタン。summaryFn：例に使う集計を返す関数（省略すると、表示中の試合の集計）
  function helpBtn(key, summaryFn) {
    var term = Glossary.TERMS[key];
    var b = el("button", "gloss-q");
    b.type = "button";
    b.setAttribute("aria-label", term.name + "の説明を見る");
    b.setAttribute("aria-expanded", "false");
    b.appendChild(el("span", "gloss-q-i", "？"));
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (glossBtn === b) closeGloss(); else openGloss(b, key, summaryFn);
    });
    return b;
  }
  // 言葉（「打率」など）の横に「？」を付けた要素の中身を作る。説明のない言葉には付けない。
  function labelWithHelp(node, name, summaryFn) {
    var key = Glossary.keyOf(name);
    if (key) node.appendChild(helpBtn(key, summaryFn));
    return node;
  }
  document.addEventListener("mousedown", function (ev) {
    if (glossPop && !glossPop.contains(ev.target) && !(glossBtn && glossBtn.contains(ev.target))) closeGloss();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && glossPop) { var b0 = glossBtn; closeGloss(); if (b0) b0.focus(); }
  });

  function tile(cls, label, value, bold) {
    var t = el("div", "tile " + cls);
    t.appendChild(labelWithHelp(el("span", "tl", label), label));
    t.appendChild(el("span", "tv num" + (bold ? " nb" : ""), String(value)));
    return t;
  }

  // ホームの走るブロックの小さな盗塁ダイヤモンド（二盗・三盗・本盗の数）
  function diamondTile(view) {
    var bd = Stats.stealBreakdown(view);
    var t = el("div", "tile tile-run tile-diamond");
    t.appendChild(el("span", "tl", "盗塁の内訳"));
    t.appendChild(Field.diamond(bd, { small: true, width: 112, height: 112 }));
    return t;
  }
  // 守った試合数の多い順（「一12・投10・遊10…」）
  function positionOrder(pos) {
    return Stats.POSITIONS.filter(function (p) { return pos.appear[p.code] > 0; }).sort(function (a, b) {
      return pos.appear[b.code] - pos.appear[a.code];
    });
  }

  function pitchPill(months, withYear) {
    if (months.length === 0) return "";
    var m = months[months.length - 1];
    if (m.pitched === 0) return monthName(m.month, withYear) + "は登板なし";
    return monthName(m.month, withYear) + "は" + m.pitched + "登板" + (m.pass > 0 ? "・合格" + m.pass : "");
  }

  // ---- 試合のカード（案F：打・走・守の3つの小箱） ----
  function gameCard(g, withYear) {
    var s = Stats.summarizeGame(g);
    var art = el("article", "game-card");
    var main = el("div", "gc-main");

    var top = el("div", "gc-top");
    var date = el("span", "gc-d num", mdLabel(g.date));
    top.appendChild(date);
    if (withYear) top.appendChild(el("span", "gc-y", g.date.slice(0, 4)));
    var ids = el("div", "gc-ids");
    var order = g.battingOrder === null || g.battingOrder === undefined ? "" : g.battingOrder + "番";
    ids.appendChild(el("span", "gc-sub", [g.squad + "チーム", g.competition + (g.gameLabel ? "（" + g.gameLabel + "）" : ""), order]
      .filter(function (x) { return x !== ""; }).join("・")));
    ids.appendChild(el("span", "gc-opp", "vs " + g.opponent));
    top.appendChild(ids);
    top.appendChild(el("span", "gc-abh num", s.atBats + "-" + s.hits));
    main.appendChild(top);

    var boxes = el("div", "gc-boxes");
    var bat = el("div", "gb gb-bat");
    bat.appendChild(el("span", "gb-k", "打"));
    var pas = el("div", "gb-pas");
    if (g.plateAppearances.length === 0) pas.appendChild(el("span", "gb-none", "−"));
    g.plateAppearances.forEach(function (pa) { pas.appendChild(paSpan(pa)); });
    bat.appendChild(pas);
    boxes.appendChild(bat);

    var run = el("div", "gb gb-run");
    run.appendChild(el("span", "gb-k", "走"));
    run.appendChild(el("span", g.stolenBases > 0 ? "gb-run-on" : "gb-none", g.stolenBases > 0 ? "盗塁" + g.stolenBases : "−"));
    boxes.appendChild(run);

    var fld = el("div", "gb gb-field");
    fld.appendChild(el("span", "gb-k", "守"));
    fld.appendChild(el("span", "gb-pos", Stats.formatPositions(g.positions) || "−"));
    if (g.pitched) fld.appendChild(el("span", "gb-pitch", "登板 " + (g.pitchingEval || "評価なし")));
    boxes.appendChild(fld);
    main.appendChild(boxes);
    art.appendChild(main);

    var detail = gameDetail(g);
    main.setAttribute("role", "button");
    main.setAttribute("tabindex", "0");
    main.setAttribute("aria-expanded", "false");
    main.addEventListener("click", function () { setExpanded(main, detail, detail.hidden); });
    main.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setExpanded(main, detail, detail.hidden); }
    });
    art.appendChild(detail);
    return art;
  }

  // ホーム（スマホ）の「最近の試合」の1件
  function recentRow(g) {
    var row = el("div", "rc-row");
    var head = el("span", "rc-head");
    head.appendChild(el("span", "rc-d num", mdLabel(g.date)));
    head.appendChild(document.createTextNode("vs " + g.opponent));
    row.appendChild(head);
    var boxes = el("div", "rc-boxes");

    // 同じ表記が続くときは「四球2」のようにまとめる
    var texts = [];
    var counts = [];
    g.plateAppearances.forEach(function (pa) {
      var t = Stats.formatPA(pa);
      var i = texts.indexOf(t);
      if (i >= 0) counts[i] += 1; else { texts.push(t); counts.push(1); }
    });
    var batText = texts.map(function (t, i) { return counts[i] > 1 ? t + counts[i] : t; }).join("・") || "−";
    var b = el("span", "rc-b");
    b.appendChild(el("b", "", "打"));
    b.appendChild(document.createTextNode(" " + batText));
    boxes.appendChild(b);
    var r = el("span", "rc-r");
    r.appendChild(el("b", "", "走"));
    r.appendChild(document.createTextNode(" " + (g.stolenBases > 0 ? "盗塁" + g.stolenBases : "−")));
    boxes.appendChild(r);
    var f = el("span", "rc-f");
    f.appendChild(el("b", "", "守"));
    var posText = Stats.formatPositions(g.positions) || "−";
    if (g.pitched) posText += "・投" + (g.pitchingEval || "");
    f.appendChild(document.createTextNode(" " + posText));
    boxes.appendChild(f);
    row.appendChild(boxes);
    return row;
  }

  // ---- ホーム ----
  function homeContext(view) {
    var s = Stats.summarize(view);
    var months = Stats.monthlySummary(view);
    return {
      view: view, s: s, months: months, withYear: multiYear(),
      ob: Stats.onBaseCount(view), pit: Stats.pitchingSummary(view), pos: Stats.positionSummary(view),
      latest: months[months.length - 1]
    };
  }

  function homeMobile(c) {
    var s = c.s;
    var root = el("div", "home-m");

    var hero = el("section", "hero");
    hero.setAttribute("aria-label", "打率");
    var avg = el("div", "hero-avg");
    avg.appendChild(labelWithHelp(el("span", "lab", "打率"), "打率"));
    avg.appendChild(el("span", "val num nb", fmt(s.avg)));
    avg.appendChild(el("span", "sub", s.atBats + "打数" + s.hits + "安打"));
    hero.appendChild(avg);
    hero.appendChild(conditionCard(c.view, 52));
    root.appendChild(hero);

    root.appendChild(backupBox("only-mobile"));

    // 打つ
    var bat = el("section", "blk blk-bat");
    bat.setAttribute("aria-label", "打つ");
    bat.appendChild(blockHead("bat", "打つ", "charts"));
    var t3 = el("div", "tiles tiles3");
    t3.appendChild(tile("tile-bat", "出塁率", fmt(s.obp), true));
    t3.appendChild(tile("tile-bat", "長打率", fmt(s.slg), true));
    t3.appendChild(tile("tile-bat", "OPS", fmt(s.ops), true));
    bat.appendChild(t3);
    var bh = el("div", "band-head");
    bh.appendChild(el("b", "", "安打 " + s.hits + " の内訳"));
    bh.appendChild(el("span", "", "長打が" + (s.doubles + s.triples + s.homeRuns) + "本"));
    bat.appendChild(bh);
    bat.appendChild(hitBand(s));
    var bl = el("div", "band-labels");
    ["ヒット", "二塁打", "三塁打", "本塁打"].forEach(function (x) { bl.appendChild(el("span", "", x)); });
    bat.appendChild(bl);
    bat.appendChild(el("div", "comment comment-bat", Comments.bat(c.view)));
    root.appendChild(bat);

    // 走る
    var run = el("section", "blk blk-run");
    run.setAttribute("aria-label", "走る");
    run.appendChild(blockHead("run", "走る", "run"));
    var rr = el("div", "run-row");
    var big = el("div", "big-col");
    big.appendChild(el("span", "lab", "盗塁"));
    big.appendChild(el("span", "val num nb big-run", String(s.stolenBases)));
    big.appendChild(el("span", "sub", "1試合に約" + (s.stolenBases / s.games).toFixed(1) + "個"));
    rr.appendChild(big);
    var t4 = el("div", "tiles tiles-dia");
    t4.appendChild(diamondTile(c.view));
    t4.appendChild(tile("tile-run", "四死球", s.walks + s.hbp, false));
    t4.appendChild(tile("tile-run", "出塁回数", c.ob, false));
    t4.appendChild(tile("tile-run", "三振", s.strikeouts, false));
    rr.appendChild(t4);
    run.appendChild(rr);
    run.appendChild(el("div", "comment comment-run", Comments.run(c.view)));
    root.appendChild(run);

    // 守る
    var fld = el("section", "blk blk-field");
    fld.setAttribute("aria-label", "守る");
    fld.appendChild(blockHead("field", "守る", "analysis"));
    var fr = el("div", "field-row");
    var fig = Field.positionFigure(c.pos.appear, { width: 150, height: 130 });
    fig.setAttribute("class", "field-fig");
    fr.appendChild(fig);
    var fc = el("div", "field-col");
    var pb = el("div", "big-col");
    pb.appendChild(el("span", "lab", "登板"));
    var pv = el("span", "val num nb big-field", String(c.pit.total));
    pv.appendChild(el("span", "unit", "試合"));
    pb.appendChild(pv);
    fc.appendChild(pb);
    fc.appendChild(el("span", "pill", pitchPill(c.months, c.withYear)));
    fc.appendChild(el("span", "sub", "守った試合：" + positionOrder(c.pos).map(function (p) { return Field.SHORT[p.code] + c.pos.appear[p.code]; }).join("・")));
    fr.appendChild(fc);
    fld.appendChild(fr);
    root.appendChild(fld);

    // 最近の試合
    var rec = el("section", "blk blk-recent");
    rec.setAttribute("aria-label", "最近の試合");
    var rh = el("div", "recent-h");
    rh.appendChild(el("h2", "", "最近の試合"));
    var all = el("a", "blk-more", "すべて →");
    all.href = "#";
    all.addEventListener("click", function (ev) { ev.preventDefault(); showTab("games"); });
    rh.appendChild(all);
    rec.appendChild(rh);
    sortedGames().slice(0, 2).forEach(function (g) { rec.appendChild(recentRow(g)); });
    root.appendChild(rec);
    return root;
  }

  function homePC(c) {
    var s = c.s;
    var root = el("div", "home-pc");

    // 上段：いまの成績
    var top = el("section", "top-card");
    top.setAttribute("aria-label", "いまの成績");
    var a = el("div", "tc-avg");
    var ac = el("div", "tc-avg-col");
    var aclab = el("span", "lab", "打率・" + s.games + "試合");
    labelWithHelp(aclab, "打率");
    ac.appendChild(aclab);
    ac.appendChild(el("span", "val num nb", fmt(s.avg)));
    a.appendChild(ac);
    var asub = el("span", "sub");
    asub.appendChild(document.createTextNode(s.atBats + "打数"));
    asub.appendChild(el("br"));
    asub.appendChild(document.createTextNode(s.hits + "安打"));
    a.appendChild(asub);
    top.appendChild(a);
    top.appendChild(conditionCard(c.view, 64));
    var ratios = el("div", "tc-ratios");
    ratios.appendChild(tile("tile-plain", "出塁率", fmt(s.obp), true));
    ratios.appendChild(tile("tile-plain", "長打率", fmt(s.slg), true));
    ratios.appendChild(tile("tile-plain", "OPS", fmt(s.ops), true));
    top.appendChild(ratios);
    var counts = el("div", "tc-counts");
    [["打点", s.rbi, "c-bat"], ["盗塁", s.stolenBases, "c-run"], ["登板", c.pit.total, "c-field"], ["本塁打", s.homeRuns, "c-bat"]].forEach(function (x) {
      var d = el("div", "cnt " + x[2]);
      d.appendChild(el("span", "cv num nb", String(x[1])));
      d.appendChild(el("span", "cl", x[0]));
      counts.appendChild(d);
    });
    top.appendChild(counts);
    root.appendChild(top);

    var cols = el("div", "cols3");

    // 打つ
    var bat = el("section", "blk blk-bat");
    bat.setAttribute("aria-label", "打つ");
    bat.appendChild(blockHead("bat", "打つ", "charts"));
    var hb = el("div", "sec");
    var hh = el("div", "band-head");
    hh.appendChild(el("b", "", "安打 " + s.hits + " の内訳"));
    hh.appendChild(el("span", "", "長打" + (s.doubles + s.triples + s.homeRuns) + "・単打" + s.singles));
    hb.appendChild(hh);
    var maxHit = Math.max(1, s.singles, s.doubles, s.triples, s.homeRuns);
    [["ヒット", s.singles, "b1"], ["二塁打", s.doubles, "b2"], ["三塁打", s.triples, "b3"], ["本塁打", s.homeRuns, "b4"]].forEach(function (x) {
      var r = el("div", "hrow");
      r.appendChild(el("span", "hn", x[0]));
      var track = el("div", "track");
      var bar = el("div", "bar bar-" + x[2]);
      bar.style.width = (x[1] / maxHit * 100) + "%";
      track.appendChild(bar);
      r.appendChild(track);
      r.appendChild(el("span", "hv num", String(x[1])));
      hb.appendChild(r);
    });
    bat.appendChild(hb);

    var pb = el("div", "sec");
    var ph = el("div", "band-head");
    ph.appendChild(el("b", "", s.plateAppearances + "打席の結果"));
    pb.appendChild(ph);
    var bb = s.walks + s.hbp;
    var outs = s.plateAppearances - s.hits - bb - s.reachedOnError;
    var pband = el("div", "pa-band");
    pband.setAttribute("role", "img");
    pband.setAttribute("aria-label", s.plateAppearances + "打席のうち、ヒット" + s.hits + "、四死球" + bb + "、エラー出塁" + s.reachedOnError + "、アウト" + outs);
    [["pa-hit", s.hits], ["pa-bb", bb], ["pa-err", s.reachedOnError], ["pa-out", outs]].forEach(function (x) {
      if (x[1] <= 0) return;
      var d = el("div", x[0], String(x[1]));
      d.style.flex = String(x[1]);
      pband.appendChild(d);
    });
    pb.appendChild(pband);
    pb.appendChild(legend([["ヒット", "#C8102E"], ["四死球", "#E0677C"], ["エラー出塁", "#F3B5BF"], ["アウト", "#ECECEF"]]));
    pb.appendChild(el("div", "comment comment-bat", Comments.bat(c.view)));
    bat.appendChild(pb);

    var mb = el("div", "sec");
    mb.appendChild(el("b", "sec-h", "月ごとの打率"));
    var mg = el("div", "month-grid");
    c.months.slice(-4).forEach(function (m, i, arr) {
      var isLast = i === arr.length - 1;
      var d = el("div", "mtile" + (isLast ? " mtile-now" : ""));
      d.appendChild(el("span", "ml", monthName(m.month, c.withYear)));
      d.appendChild(el("span", "mv num" + (isLast ? " nb" : ""), fmt(m.summary.avg)));
      d.appendChild(el("span", "mh", m.summary.atBats + "-" + m.summary.hits));
      mg.appendChild(d);
    });
    mb.appendChild(mg);
    bat.appendChild(mb);

    var ob = el("div", "sec");
    ob.appendChild(el("b", "sec-h", "打順別"));
    var orders = Stats.splitBy(c.view, function (g) {
      return g.battingOrder === null || g.battingOrder === undefined ? null : Number(g.battingOrder);
    }).filter(function (x) { return x.key !== null; }).sort(function (a, b) {
      var pa = a.summary.avg;
      var pb2 = b.summary.avg;
      if (pa === pb2) return a.key - b.key;
      if (pa === null) return 1;
      if (pb2 === null) return -1;
      return pb2 - pa;
    }).slice(0, 4);
    orders.forEach(function (x) {
      var r = el("div", "orow");
      r.appendChild(el("span", "on", x.key + "番"));
      var track = el("div", "track track-s");
      var bar = el("div", "bar " + (x.summary.avg !== null && x.summary.avg >= 0.5 ? "bar-b3" : "bar-b2"));
      bar.style.width = (x.summary.avg === null ? 0 : x.summary.avg * 100) + "%";
      track.appendChild(bar);
      r.appendChild(track);
      r.appendChild(el("span", "oa num", fmt(x.summary.avg)));
      r.appendChild(el("span", "og", x.summary.games + "試合"));
      ob.appendChild(r);
    });
    bat.appendChild(ob);
    cols.appendChild(bat);

    // 走る
    var run = el("section", "blk blk-run");
    run.setAttribute("aria-label", "走る");
    run.appendChild(blockHead("run", "走る", "run"));
    var rr = el("div", "run-row");
    var big = el("div", "big-col");
    big.appendChild(el("span", "lab", "盗塁"));
    big.appendChild(el("span", "val num nb big-run", String(s.stolenBases)));
    rr.appendChild(big);
    var rsub = el("span", "sub");
    rsub.appendChild(document.createTextNode(s.games + "試合で" + s.stolenBases + "個"));
    rsub.appendChild(el("br"));
    rsub.appendChild(document.createTextNode("1試合に約" + (s.stolenBases / s.games).toFixed(1) + "個"));
    rr.appendChild(rsub);
    run.appendChild(rr);
    var t4 = el("div", "tiles tiles-dia");
    t4.appendChild(diamondTile(c.view));
    t4.appendChild(tile("tile-run", "四死球", bb, false));
    t4.appendChild(tile("tile-run", "出塁（塁に出た回数）", c.ob, false));
    t4.appendChild(tile("tile-run", "三振", s.strikeouts, false));
    run.appendChild(t4);
    var ds = el("div", "sec");
    var dh = el("div", "band-head");
    dh.appendChild(el("b", "", "出塁 " + c.ob + "回のうち 盗塁 " + s.stolenBases + "回"));
    ds.appendChild(dh);
    var dots = el("div", "dots");
    dots.setAttribute("role", "img");
    dots.setAttribute("aria-label", "出塁" + c.ob + "回のうち" + s.stolenBases + "回で盗塁");
    for (var i = 0; i < c.ob; i++) dots.appendChild(el("span", i < s.stolenBases ? "dot dot-on" : "dot"));
    ds.appendChild(dots);
    ds.appendChild(legend([["盗塁した出塁", "#16A34A"], ["盗塁なし", "#BBF7D0"]]));
    run.appendChild(ds);
    run.appendChild(el("div", "comment comment-run", Comments.run(c.view) + " " + Comments.runPc(c.view)));
    cols.appendChild(run);

    // 守る
    var fld = el("section", "blk blk-field");
    fld.setAttribute("aria-label", "守る");
    fld.appendChild(blockHead("field", "守る", "analysis"));
    var fr = el("div", "field-row");
    var pbig = el("div", "big-col");
    pbig.appendChild(el("span", "lab", "登板"));
    var pv = el("span", "val num nb big-field", String(c.pit.total));
    pv.appendChild(el("span", "unit", "試合"));
    pbig.appendChild(pv);
    fr.appendChild(pbig);
    fr.appendChild(el("span", "pill", pitchPill(c.months, c.withYear)));
    fld.appendChild(fr);
    var fig = Field.positionFigure(c.pos.appear, { height: 220, nameSize: 20, numSize: 26 });
    fig.setAttribute("class", "field-fig field-fig-pc");
    fld.appendChild(fig);
    var pr = el("div", "sec");
    var prh = el("div", "sec-h");
    prh.appendChild(el("b", "", "守った試合数 "));
    prh.appendChild(el("span", "sec-note", "1試合で複数の位置を守ることがあります"));
    pr.appendChild(prh);
    var maxAp = 0;
    Stats.POSITIONS.forEach(function (p) { if (c.pos.appear[p.code] > maxAp) maxAp = c.pos.appear[p.code]; });
    positionOrder(c.pos).slice(0, 5).forEach(function (p) {
      var n = c.pos.appear[p.code];
      var r = el("div", "prow");
      r.appendChild(el("span", "pn", p.label));
      var track = el("div", "track track-s");
      var bar = el("div", "bar " + (n / maxAp >= 0.8 ? "bar-field" : n / maxAp >= 0.3 ? "bar-field-mid" : "bar-field-low"));
      bar.style.width = (n / c.pos.games * 100) + "%";
      track.appendChild(bar);
      r.appendChild(track);
      r.appendChild(el("span", "pv2 num", String(n)));
      pr.appendChild(r);
    });
    fld.appendChild(pr);
    cols.appendChild(fld);

    root.appendChild(cols);
    return root;
  }

  function renderDashboard() {
    var root = document.getElementById("dashboard");
    clear(root);
    if (!state.data) { unreadableNotice(root); return; }
    var view = viewGames();
    if (view.length === 0) {
      root.appendChild(backupBox("only-mobile"));   // バックアップ状態は全データのまま
      showEmptyIfNone(root);
      return;
    }
    var c = homeContext(view);
    root.appendChild(homeMobile(c));
    root.appendChild(homePC(c));
  }

  // ---- 試合（月ごとのカード） ----
  function sortedGames() {
    return viewGames().slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.gameLabel || "") < (b.gameLabel || "") ? -1 : (a.gameLabel || "") > (b.gameLabel || "") ? 1 : 0;
    });
  }

  function chevron(open) {
    var svg = icon(open ? ["M6 15l6-6 6 6"] : ["M9 6l6 6-6 6"], { "class": "chev" });
    return svg;
  }

  // 試合の成績表に足す列（投手の記録）。4-4F で、球数・投球回・奪三振・与四球・与死球・失点をここに足す。
  // 各要素：{ head: "球数", cell: function (row) { return 表示する文字列; }, total: function (total) { return 合計の文字列; } }
  // 投手の記録の列（試合の成績表と登板の一覧で共通）。key は Derive.pitchingTexts の項目名。
  var PITCH_COLS = [
    { head: "球数", key: "pitches", total: function (p) { return p.pitches === null ? "−" : String(p.pitches); } },
    { head: "投球回", key: "innings", total: function (p) { return Stats.formatInnings(p.outs); } },
    { head: "失点", key: "runs", total: function (p) { return p.runs === null ? "−" : String(p.runs); } },
    { head: "奪三振", key: "strikeouts", total: function (p) { return p.strikeouts === null ? "−" : String(p.strikeouts); } },
    { head: "与四球", key: "walks", total: function (p) { return p.walks === null ? "−" : String(p.walks); } },
    { head: "与死球", key: "hitByPitch", total: function (p) { return p.hitByPitch === null ? "−" : String(p.hitByPitch); } }
  ];
  var TABLE_PITCH_COLUMNS = PITCH_COLS.map(function (c) {
    return { head: c.head, cell: function (r) { return r.pitch[c.key]; }, total: function (t) { return c.total(t.pitching); } };
  });

  function gameViewSwitch() {
    var box = el("div", "view-switch");
    box.appendChild(segButtons([["cards", "カード"], ["table", "表"]], state.ui.gamesView, function (v) {
      state.ui.gamesView = v;
      Derive.saveUi(Derive.UI_KEY, state.ui);   // 表示の設定は、成績データとは別のキーに保存する
      renderGames();
    }));
    return box;
  }

  function renderGames() {
    var root = document.getElementById("games");
    clear(root);
    if (!state.data) { unreadableNotice(root); return; }
    if (showEmptyIfNone(root)) return;

    var list = sortedGames();
    if (state.pitchedOnly) list = list.filter(function (g) { return g.pitched === true; });
    root.appendChild(gameViewSwitch());
    if (list.length === 0) {
      root.appendChild(el("p", "empty", "登板した試合がありません。"));
      return;
    }
    if (state.ui.gamesView === "table") {
      renderGameTable(root, list);
      return;
    }

    var withYear = multiYear();
    var cond = Stats.conditionLevel(viewGames());
    var keys = [];
    var groups = {};
    list.forEach(function (g) {
      var m = g.date.slice(0, 7);
      if (!groups[m]) { groups[m] = []; keys.push(m); }
      groups[m].push(g);
    });

    keys.forEach(function (m, idx) {
      var gs = groups[m];
      var open = state.openMonths[m] === undefined ? idx === 0 : state.openMonths[m];
      var s = Stats.summarize(gs);
      var pit = Stats.pitchingSummary(gs);
      var sec = el("section", "month");
      sec.setAttribute("aria-label", monthName(m, withYear));

      function toggle() { state.openMonths[m] = !open; renderGames(); }

      if (open) {
        var head = el("div", "m-head");
        head.setAttribute("role", "button");
        head.setAttribute("tabindex", "0");
        head.setAttribute("aria-expanded", "true");
        var h2 = el("h2", "");
        h2.appendChild(document.createTextNode(monthName(m, withYear) + " "));
        h2.appendChild(el("span", "m-n", gs.length + "試合"));
        head.appendChild(h2);
        var stats = el("div", "m-stats");
        stats.appendChild(textEl("span", "", [el("b", "k-bat", "打"), " " + fmt(s.avg)]));
        stats.appendChild(textEl("span", "", [el("b", "k-run", "走"), " 盗塁" + s.stolenBases]));
        stats.appendChild(textEl("span", "", [el("b", "k-field", "守"), " 登板" + pit.total]));
        if (idx === 0) {
          var cd = el("span", "m-cond cond-" + (cond.level || "none"));
          cd.appendChild(conditionIcon(cond.level, 24));
          cd.appendChild(el("span", "m-cond-l", cond.label));
          stats.appendChild(cd);
        }
        head.appendChild(stats);
        head.appendChild(chevron(true));
        head.addEventListener("click", toggle);
        head.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); } });
        sec.appendChild(head);
        var cards = el("div", "game-list");
        gs.forEach(function (g) { cards.appendChild(gameCard(g, withYear)); });
        sec.appendChild(cards);
      } else {
        var band = el("button", "m-band");
        band.type = "button";
        band.setAttribute("aria-expanded", "false");
        band.appendChild(el("span", "mb-m", monthName(m, withYear)));
        var mid = el("span", "mb-mid");
        mid.appendChild(el("span", "mb-1", gs.length + "試合・" + s.atBats + "打数" + s.hits + "安打"));
        mid.appendChild(textEl("span", "mb-2", [el("b", "k-bat", "打"), " 打点" + s.rbi + "　", el("b", "k-run", "走"), " 四死球" + (s.walks + s.hbp)]));
        band.appendChild(mid);
        band.appendChild(el("span", "mb-avg num", fmt(s.avg)));
        band.appendChild(chevron(false));
        band.addEventListener("click", toggle);
        sec.appendChild(band);
      }
      root.appendChild(sec);
    });
  }

  // ---- 試合の成績表（全試合を1試合1行。すべての成績を横に並べる） ----
  function num0(v) { return v === 0 ? { text: "0", cls: "num z" } : { text: String(v), cls: "num" }; }

  function gameTableColumns() {
    function bat(head, pick, plain) {
      return {
        group: "bat", head: head,
        cell: function (r) { var v = pick(r.s); return plain ? { text: String(v), cls: "num" } : num0(v); },
        total: function (t) { return { text: String(pick(t.s)), cls: "num nb" }; }
      };
    }
    var cols = [
      { group: "game", head: "日付", cls: "gt-c-date", sortable: true, cell: function (r) { return { text: r.dateLabel, cls: "num gt-date" }; } },
      { group: "game", head: "学年・チーム", cell: function (r) { return { text: r.gradeTeam, cls: "nowrap" }; } },
      { group: "game", head: "大会", cell: function (r) { return { text: r.competition, cls: "gt-fold gt-comp", title: r.competition }; } },
      { group: "game", head: "相手", cls: "gt-c-opp", cell: function (r) { return { text: r.opponent, cls: "gt-fold gt-opp", title: r.opponent }; } },
      { group: "game", head: "打順", cell: function (r) { return { text: r.order, cls: "nowrap" }; } },
      { group: "game", head: "守備位置", cell: function (r) { return { text: r.positions, cls: "nowrap" }; } }
    ];
    [0, 1, 2, 3].forEach(function (i) {
      cols.push({ group: "pa", head: "第" + (i + 1) + "打席", pa: i });
    });
    cols.push(bat("打席", function (s) { return s.plateAppearances; }, true));
    cols.push(bat("打数", function (s) { return s.atBats; }, true));
    cols.push(bat("安打", function (s) { return s.hits; }, true));
    cols.push(bat("二塁打", function (s) { return s.doubles; }));
    cols.push(bat("三塁打", function (s) { return s.triples; }));
    cols.push(bat("本塁打", function (s) { return s.homeRuns; }));
    cols.push(bat("打点", function (s) { return s.rbi; }));
    cols.push(bat("四球", function (s) { return s.walks; }));
    cols.push(bat("死球", function (s) { return s.hbp; }));
    cols.push(bat("三振", function (s) { return s.strikeouts; }));
    cols.push(bat("振り逃げ", function (s) { return s.droppedThirdStrikes; }));
    cols.push(bat("犠打", function (s) { return s.sacBunts; }));
    cols.push(bat("犠飛", function (s) { return s.sacFlies; }));
    cols.push(bat("エラー出塁", function (s) { return s.reachedOnError; }));
    cols.push({
      group: "run", head: "盗塁",
      cell: function (r) { return r.steal === 0 ? { text: "0", cls: "num z" } : { text: r.stealText, cls: "gt-steal" }; },
      total: function (t) { return { text: String(t.s.stolenBases), cls: "num nb" }; }
    });
    cols.push({
      group: "field", head: "登板",
      cell: function (r) { return r.pitched ? { text: "●" + (r.evalText ? " " + r.evalText : ""), cls: "nowrap gt-pitch" } : { text: "", cls: "" }; },
      total: function (t) { return { text: String(t.pitched), cls: "num nb" }; }
    });
    TABLE_PITCH_COLUMNS.forEach(function (c) {
      cols.push({
        group: "field", head: c.head,
        cell: function (r) { return { text: c.cell(r), cls: "num" }; },
        total: function (t) { return { text: c.total ? c.total(t) : "", cls: "num nb" }; }
      });
    });
    cols.push({ group: "memo", head: "メモ", cell: function (r) { return { text: r.memo, cls: "gt-ell gt-memo", title: r.memo }; } });
    return cols;
  }

  var GT_GROUPS = { game: "試合", pa: "打席", bat: "打撃", run: "走る", field: "守る・投手", memo: "メモ" };

  function renderGameTable(root, shown) {
    var cols = gameTableColumns();
    var rows = Derive.gameTableRows(shown, games(), state.tableDesc);
    var total = Derive.gameTableTotal(shown);
    var withYear = multiYear();

    var wrap = el("div", "gt-wrap");
    var table = el("table", "gt");
    var thead = el("thead");

    // 1行目：まとまりの見出し（色の線：打つ＝赤、走る＝緑、守る・投手＝青）
    var h1 = el("tr", "gt-h1");
    var i = 0;
    while (i < cols.length) {
      var g = cols[i].group;
      var span = 0;
      while (i + span < cols.length && cols[i + span].group === g) span += 1;
      var th = el("th", "gt-g gt-g-" + g, GT_GROUPS[g]);
      th.colSpan = span;
      h1.appendChild(th);
      i += span;
    }
    thead.appendChild(h1);

    // 2行目：列の見出し（日付を押すと並びが切り替わる）
    var h2 = el("tr", "gt-h2");
    cols.forEach(function (c) {
      var th = el("th", "gt-th gt-g-" + c.group + (c.cls ? " " + c.cls : ""));
      if (c.sortable) {
        var b = el("button", "gt-sort", c.head + (state.tableDesc ? " ↓" : " ↑"));
        b.type = "button";
        b.title = "押すと新しい順・古い順を切り替えます";
        b.addEventListener("click", function () { state.tableDesc = !state.tableDesc; renderGames(); });
        th.appendChild(b);
      } else {
        th.textContent = c.head;
      }
      h2.appendChild(th);
    });
    thead.appendChild(h2);
    table.appendChild(thead);

    var tbody = el("tbody");
    var lastMonth = "";
    rows.forEach(function (r) {
      if (r.month !== lastMonth) {
        lastMonth = r.month;
        var mr = el("tr", "gt-month");
        var mtd = el("td", "", monthName(r.month, withYear));
        mtd.colSpan = cols.length;
        mr.appendChild(mtd);
        tbody.appendChild(mr);
      }
      var tr = el("tr", "gt-row");
      tr.setAttribute("tabindex", "0");
      cols.forEach(function (c) {
        var td = el("td", c.cls ? c.cls : "");
        if (c.pa !== undefined) {
          var pa = r.pas[c.pa];
          if (pa) { td.appendChild(el("span", pa.category + " nowrap", pa.text)); }
        } else {
          var cell = c.cell(r);
          if (cell.cls) td.className += " " + cell.cls;
          if (cell.title) td.title = cell.title;
          td.textContent = cell.text;
        }
        tr.appendChild(td);
      });
      var detail = el("tr", "gt-detail");
      detail.hidden = true;
      var dtd = el("td", "");
      dtd.colSpan = cols.length;
      var dbox = gameDetail(r.game);
      dbox.hidden = false;
      dtd.appendChild(dbox);
      detail.appendChild(dtd);
      function toggleRow() { detail.hidden = !detail.hidden; tr.classList.toggle("open", !detail.hidden); }
      tr.addEventListener("click", toggleRow);
      tr.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleRow(); } });
      tbody.appendChild(tr);
      tbody.appendChild(detail);
    });
    table.appendChild(tbody);

    // 合計の行：表示中の試合の合計。打席の列には、打率・出塁率・長打率・OPS を出す。
    var tfoot = el("tfoot");
    var tr2 = el("tr", "gt-total");
    var j = 0;
    while (j < cols.length) {
      var c0 = cols[j];
      if (c0.group === "game") {
        // 日付の列（左に固定）に「合計」、相手の列（左に固定）は空、間は空のセル。幅の広い1つのセルにすると、横にスクロールしたとき右の数字・「？」が下に隠れる。
        tr2.appendChild(el("td", "gt-c-date gt-total-label", "合計（" + shown.length + "試合）"));
        var e1 = el("td", ""); e1.colSpan = 2; tr2.appendChild(e1);
        tr2.appendChild(el("td", "gt-c-opp"));
        var e2 = el("td", ""); e2.colSpan = 2; tr2.appendChild(e2);
        j += 6;
        continue;
      }
      if (c0.group === "pa") {
        var ptd = el("td", "gt-rates");
        [["打率", total.s.avg], ["出塁率", total.s.obp], ["長打率", total.s.slg], ["OPS", total.s.ops]].forEach(function (x) {
          var gr = textEl("span", "gt-rate", [x[0], el("b", "num nb", " " + fmt(x[1]))]);
          gr.insertBefore(helpBtn(Glossary.keyOf(x[0]), function () { return total.s; }), gr.lastChild);
          ptd.appendChild(gr);
        });
        ptd.colSpan = 4;
        tr2.appendChild(ptd);
        j += 4;
        continue;
      }
      if (c0.group === "memo") { tr2.appendChild(el("td", "")); j += 1; continue; }
      var t = c0.total(total);
      tr2.appendChild(el("td", t.cls, t.text));
      j += 1;
    }
    tfoot.appendChild(tr2);
    table.appendChild(tfoot);
    wrap.appendChild(table);
    root.appendChild(wrap);
  }

  // 「＋記録」「＋試合を記録」：入力中・編集中の内容があるときは、破棄してよいか確認する。
  function recordAction() {
    if (!canEdit()) { showTab("form"); return; }
    if (formDirty() && !window.confirm("入力中の内容を破棄して新しい試合を入力しますか？")) return;
    GameForm.startNew();
    snapshotForm();
    showTab("form");
  }

  // 試合入力フォームの内容が、開いた直後の状態から変わっているか（画面の入力部品の値で判断する）。
  var formSnap = "";
  function formSerialize() { return GameForm.stateKey(); }
  function snapshotForm() { formSnap = formSerialize(); }
  function formDirty() { return formSerialize() !== formSnap; }

  // ---- 共通：表・カード ----
  var ANALYSIS_COLS = [
    ["試合", function (s) { return s.games; }],
    ["打席", function (s) { return s.plateAppearances; }],
    ["打数", function (s) { return s.atBats; }],
    ["安打（合計）", function (s) { return s.hits; }],
    ["ヒット", function (s) { return s.singles; }],
    ["二塁打", function (s) { return s.doubles; }],
    ["三塁打", function (s) { return s.triples; }],
    ["本塁打", function (s) { return s.homeRuns; }],
    ["打点", function (s) { return s.rbi; }],
    ["盗塁", function (s) { return s.stolenBases; }],
    ["四球", function (s) { return s.walks; }],
    ["死球", function (s) { return s.hbp; }],
    ["三振", function (s) { return s.strikeouts; }],
    ["振り逃げ", function (s) { return s.droppedThirdStrikes; }],
    ["犠打", function (s) { return s.sacBunts; }],
    ["犠飛", function (s) { return s.sacFlies; }],
    ["エラー出塁", function (s) { return s.reachedOnError; }],
    ["登板", function (s, gs) {
      return gs.filter(function (g) { return g.pitched === true; }).length;
    }]
  ];
  var ANALYSIS_RATES = [
    ["打率", function (s) { return fmt(s.avg); }, "r-avg"],
    ["出塁率", function (s) { return fmt(s.obp); }, ""],
    ["長打率", function (s) { return fmt(s.slg); }, ""],
    ["OPS", function (s) { return fmt(s.ops); }, ""]
  ];

  // rows: [{ label, games, summary }]。最後に、絞り込んだ全試合の合計行を付ける。見出し行と1列目は固定。
  function analysisTable(firstHead, rows, allGames) {
    var wrap = el("div", "table-wrap");
    var table = el("table", "analysis");
    var thead = el("thead");
    var hr = el("tr");
    hr.appendChild(el("th", "", firstHead));
    ANALYSIS_COLS.forEach(function (c) { hr.appendChild(el("th", "num", c[0])); });
    ANALYSIS_RATES.forEach(function (c) { hr.appendChild(labelWithHelp(el("th", "num rate", c[0]), c[0])); });
    thead.appendChild(hr);
    table.appendChild(thead);

    function addRow(parent, cls, label, gs, s) {
      var tr = el("tr", cls);
      tr.appendChild(el("td", "", label));
      ANALYSIS_COLS.forEach(function (c) { tr.appendChild(el("td", "num", String(c[1](s, gs)))); });
      ANALYSIS_RATES.forEach(function (c) { tr.appendChild(el("td", "num nb rate " + c[2], c[1](s))); });
      parent.appendChild(tr);
    }

    var tbody = el("tbody");
    rows.forEach(function (r) { addRow(tbody, "", r.label, r.games, r.summary); });
    table.appendChild(tbody);
    var tfoot = el("tfoot");
    addRow(tfoot, "total", "合計", allGames, Stats.summarize(allGames));
    table.appendChild(tfoot);
    wrap.appendChild(table);
    return wrap;
  }

  // スマホ：各行をカードにする（名前、試合数・打点、打率（大きく・赤）、打率の横棒、出塁率、OPS）
  function rowCards(rows) {
    var box = el("div", "an-cards");
    rows.forEach(function (r) {
      var s = r.summary;
      var c = el("div", "an-card");
      var top = el("div", "an-top");
      var nm = el("div", "an-name");
      nm.appendChild(el("b", "", r.label));
      nm.appendChild(el("span", "", s.games + "試合・打点" + s.rbi));
      top.appendChild(nm);
      top.appendChild(el("span", "an-avg num nb", fmt(s.avg)));
      c.appendChild(top);
      var track = el("div", "track track-s");
      var bar = el("div", "bar bar-b3");
      bar.style.width = (s.avg === null ? 0 : s.avg * 100) + "%";
      track.appendChild(bar);
      c.appendChild(track);
      var sub = el("div", "an-sub");
      sub.appendChild(textEl("span", "", ["出塁率 ", el("b", "num", fmt(s.obp))]));
      sub.appendChild(textEl("span", "", ["OPS ", el("b", "num", fmt(s.ops))]));
      c.appendChild(sub);
      box.appendChild(c);
    });
    return box;
  }

  // 見出し＋（スマホはカード＋「全項目を表で見る」、PCは表）
  function analysisSection(title, firstHead, rows, allGames, note, key) {
    var sec = el("section", "an-sec");
    sec.appendChild(el("h3", "analysis-title", title));
    if (note) sec.appendChild(el("p", "analysis-note", note));
    sec.appendChild(rowCards(rows));
    var open = !!state.openTables[key];
    var btn = el("button", "btn small an-toggle", open ? "表を閉じる" : "全項目を表で見る");
    btn.type = "button";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.addEventListener("click", function () {
      state.openTables[key] = !open;
      var box2 = sec.querySelector(".an-tablebox");
      box2.classList.toggle("open", !open);
      open = !open;
      btn.textContent = open ? "表を閉じる" : "全項目を表で見る";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    sec.appendChild(btn);
    var box = el("div", "an-tablebox" + (open ? " open" : ""));
    box.appendChild(analysisTable(firstHead, rows, allGames));
    sec.appendChild(box);
    return sec;
  }

  function orderRows(view) {
    return Stats.splitBy(view, function (g) {
      return g.battingOrder === null || g.battingOrder === undefined ? null : Number(g.battingOrder);
    }).sort(function (a, b) {
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return a.key - b.key;
    }).map(function (x) {
      return { label: x.key === null ? "不明" : x.key + "番", games: x.games, summary: x.summary };
    });
  }

  function opponentRows(view) {
    return Stats.splitBy(view, function (g) { return String(g.opponent).trim(); }).sort(function (a, b) {
      if (a.summary.games !== b.summary.games) return b.summary.games - a.summary.games;
      var pa = a.summary.avg;
      var pb = b.summary.avg;
      if (pa !== pb) {
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pb - pa;
      }
      return String(a.key).localeCompare(String(b.key), "ja");
    }).map(function (x) {
      return { label: x.key, games: x.games, summary: x.summary };
    });
  }

  // 守備位置別：先発（positions[0]）の守備位置で分ける。並びは POSITIONS の順、空は最後に「不明」。
  function positionRows(view) {
    var posIndex = function (code) {
      for (var i = 0; i < Stats.POSITIONS.length; i++) if (Stats.POSITIONS[i].code === code) return i;
      return Stats.POSITIONS.length;
    };
    return Stats.splitBy(view, function (g) {
      return (g.positions && g.positions[0]) || null;
    }).sort(function (a, b) {
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return posIndex(a.key) - posIndex(b.key);
    }).map(function (x) {
      var label = "不明";
      if (x.key !== null) {
        label = x.key;
        Stats.POSITIONS.forEach(function (p) { if (p.code === x.key) label = p.label; });
      }
      return { label: label, games: x.games, summary: x.summary };
    });
  }

  function segButtons(options, current, onPick) {
    var box = el("div", "seg-group");
    box.setAttribute("role", "group");
    options.forEach(function (o) {
      var b = el("button", "seg-btn", o[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", current === o[0] ? "true" : "false");
      b.addEventListener("click", function () { onPick(o[0]); });
      box.appendChild(b);
    });
    return box;
  }

  // ---- 打つ（グラフ・打順別・相手別・打球方向） ----
  function sprayCount(b, mode) {
    return mode === "hit" ? b.hits : mode === "out" ? b.outs + b.errors : b.total;
  }

  function spraySection(view) {
    var sec = el("section", "an-sec spray-sec");
    var dir = Stats.directionSummary(view);
    var head = el("div", "sec-title-row");
    head.appendChild(el("h3", "analysis-title", "打球方向"));
    head.appendChild(el("span", "sec-title-note", "方向を記録した打球 " + dir.total + "本"));
    sec.appendChild(head);
    if (dir.total === 0) {
      sec.appendChild(el("p", "empty", "打球方向の記録がありません。"));
      return sec;
    }
    sec.appendChild(segButtons([["all", "全打球"], ["hit", "安打"], ["out", "凡打・エラー"]], state.sprayMode, function (m) {
      state.sprayMode = m;
      renderCharts();
    }));
    var fig = Field.bubbleFigure(dir, state.sprayMode, { label: "打球方向（" + { all: "全打球", hit: "安打", out: "凡打・エラー" }[state.sprayMode] + "）" });
    var body = el("div", "spray-body");
    var left = el("div", "spray-fig");
    left.appendChild(fig.svg);
    left.appendChild(el("div", "fig-note", "円の大きさ＝打球の数"));
    body.appendChild(left);

    var right = el("div", "spray-info");
    var total = fig.total;
    // 左右の割合（左方向＝赤、中央＝灰、右方向＝黒）
    var groups = [["左方向", ["左", "左中", "三", "遊"], "#C8102E"], ["中央", ["中", "投", "捕"], "#52525B"], ["右方向", ["右", "右中", "二", "一"], "#18181B"]];
    right.appendChild(el("b", "sub-h", "左右の割合"));
    var band = el("div", "lcr-band");
    groups.forEach(function (g) {
      var n = g[1].reduce(function (a, k) { return a + sprayCount(dir.byDir[k], state.sprayMode); }, 0);
      if (total === 0) return;
      var seg = el("div", "", g[0] + " " + Math.round(n / total * 100) + "%");
      seg.style.flex = String(Math.max(n, 0.0001));
      seg.style.background = g[2];
      band.appendChild(seg);
    });
    right.appendChild(band);

    // 方向別の表（多い順。0本の方向は出さない）
    // 同じ数のときは、図の並び（外野の左→右、内野、投・捕）の順にする
    var rows = ["左", "左中", "中", "右中", "右", "三", "遊", "二", "一", "投", "捕"].filter(function (k) { return sprayCount(dir.byDir[k], state.sprayMode) > 0; })
      .sort(function (a, b) { return sprayCount(dir.byDir[b], state.sprayMode) - sprayCount(dir.byDir[a], state.sprayMode); });
    var wrap = el("div", "table-wrap spray-table");
    var table = el("table", "plain");
    var hr = el("tr");
    ["方向", "打球", "割合", "うち安打", "安打の率"].forEach(function (h, i) { hr.appendChild(el("th", i ? "num" : "", h)); });
    var thead = el("thead");
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    rows.forEach(function (k) {
      var b = dir.byDir[k];
      var n = sprayCount(b, state.sprayMode);
      var tr = el("tr");
      tr.appendChild(el("th", "", k));
      tr.appendChild(el("td", "num", String(n)));
      tr.appendChild(el("td", "num nb pct", Math.round(n / total * 100) + "%"));
      tr.appendChild(el("td", "num", String(b.hits)));
      tr.appendChild(el("td", "num", fmt(b.total ? b.hits / b.total : null)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    right.appendChild(wrap);
    right.appendChild(el("p", "analysis-note", "※割合は、方向を記録した打球に対する割合です。四球・死球・方向未入力の打席は含みません。安打の率＝その方向の打球のうち安打になった割合。"));
    body.appendChild(right);
    sec.appendChild(body);
    return sec;
  }

  function renderCharts() {
    var root = document.getElementById("charts");
    if (window.Charts) window.Charts.destroy();
    clear(root);
    if (!state.data) { unreadableNotice(root); return; }
    if (showEmptyIfNone(root)) return;
    var view = viewGames();
    var s = Stats.summarize(view);

    // 上：打率・出塁率・長打率・OPS
    var top = el("section", "bat-top");
    [["打率", fmt(s.avg), true], ["出塁率", fmt(s.obp), false], ["長打率", fmt(s.slg), false], ["OPS", fmt(s.ops), false]].forEach(function (x) {
      var t = el("div", "bat-stat" + (x[2] ? " bat-stat-main" : ""));
      t.appendChild(labelWithHelp(el("span", "bl", x[0]), x[0]));
      t.appendChild(el("span", "bv num nb", x[1]));
      top.appendChild(t);
    });
    root.appendChild(top);
    root.appendChild(el("div", "comment comment-bat bat-comment", Comments.bat(view)));

    // グラフ3つ
    var chartsWrap = el("div", "bat-charts");
    root.appendChild(chartsWrap);
    if (!window.Chart || !window.Charts) {
      chartsWrap.appendChild(el("p", "banner bad", "グラフ部品（lib/chart.umd.js）を読み込めませんでした。"));
    } else {
      // PCでは14pxより小さい文字を使わない（グラフの目盛り・凡例の大きさ）。既定値で指定する。
      if (window.Chart.defaults && window.Chart.defaults.font) {
        window.Chart.defaults.font.size = isPC() ? 14 : 12;
        window.Chart.defaults.color = "#3F3F46";
      }
      window.Charts.render(chartsWrap, view);
    }

    root.appendChild(analysisSection("打順別", "打順", orderRows(view), view, "", "order"));
    root.appendChild(analysisSection("対戦相手別", "相手", opponentRows(view), view, "", "opp"));
    root.appendChild(spraySection(view));
  }

  // ---- 守る（守備位置の図・守備位置別・登板の一覧） ----
  // 登板の一覧に足す列。4-4F で、投手の記録（球数・投球回・奪三振・与四球・与死球・失点）をここに足す。
  // 各要素：{ head: "球数", cell: function (game) { return 表示する文字列; } }
  var PITCH_EXTRA_COLUMNS = PITCH_COLS.map(function (c) {
    return { head: c.head, cell: function (g) { return Derive.pitchingTexts(g.pitchingStats)[c.key]; } };
  });

  function guardTop(view) {
    var pit = Stats.pitchingSummary(view);
    var top = el("section", "guard-top");
    [["登板", pit.total, "gs-main"], ["合格", pit.pass, ""], ["不合格", pit.fail, ""], ["評価なし", pit.none, ""]].forEach(function (x) {
      var t = el("div", "guard-stat " + x[2]);
      t.appendChild(el("span", "gl", x[0]));
      t.appendChild(el("span", "gv num nb", String(x[1])));
      top.appendChild(t);
    });
    var ps = Stats.pitchingStatsSummary(view);
    if (ps.pitchesGames + ps.outsGames + ps.runsGames + ps.strikeoutsGames + ps.walksGames + ps.hitByPitchGames > 0) {
      var pb = el("div", "guard-ps");
      pb.appendChild(el("span", "gm-h", "投手の記録（記録のある試合の合計）"));
      [["球数", ps.pitches === null ? "−" : String(ps.pitches)], ["1試合の平均球数", ps.avgPitches === null ? "−" : String(Math.round(ps.avgPitches))],
        ["投球回", Stats.formatInnings(ps.outs)], ["失点", ps.runs === null ? "−" : String(ps.runs)], ["奪三振", ps.strikeouts === null ? "−" : String(ps.strikeouts)],
        ["与四球", ps.walks === null ? "−" : String(ps.walks)], ["与死球", ps.hitByPitch === null ? "−" : String(ps.hitByPitch)]].forEach(function (x) {
        pb.appendChild(textEl("span", "gm", [x[0] + " ", el("b", "num", x[1])]));
      });
      top.appendChild(pb);
    }
    var months = Object.keys(pit.byMonth).sort();
    if (months.length) {
      var mb = el("div", "guard-months");
      mb.appendChild(el("span", "gm-h", "月ごとの登板数"));
      var withYear = multiYear();
      months.forEach(function (m) {
        mb.appendChild(textEl("span", "gm", [monthName(m, withYear) + " ", el("b", "num", String(pit.byMonth[m]))]));
      });
      top.appendChild(mb);
    }
    return top;
  }

  function fieldSection(view) {
    var sec = el("section", "an-sec field-sec");
    var pos = Stats.positionSummary(view);
    var head = el("div", "sec-title-row");
    head.appendChild(el("h3", "analysis-title", "守備位置"));
    head.appendChild(el("span", "sec-title-note", "全" + pos.games + "試合"));
    sec.appendChild(head);
    sec.appendChild(segButtons([["appear", "守った試合"], ["start", "先発の位置"]], state.fieldMode, function (m) {
      state.fieldMode = m;
      renderAnalysis();
    }));
    var src = state.fieldMode === "start" ? pos.start : pos.appear;
    var body = el("div", "field-body");
    var figBox = el("div", "field-bigbox");
    figBox.appendChild(Field.positionBig(src, pos.games, { label: state.fieldMode === "start" ? "先発の位置" : "守った試合" }));
    body.appendChild(figBox);
    var info = el("div", "field-info");
    info.appendChild(el("h4", "field-list-h", state.fieldMode === "start" ? "先発した位置（多い順）" : "守った試合（多い順）"));
    var list = el("div", "pos-list");
    Stats.POSITIONS.filter(function (p) { return src[p.code] > 0; }).sort(function (a, b) { return src[b.code] - src[a.code]; })
      .forEach(function (p) {
        var item = el("span", "pl");
        item.appendChild(document.createTextNode(p.label + " "));
        item.appendChild(el("b", "", src[p.code] + "試合"));
        item.appendChild(el("span", "pct", Math.round(src[p.code] / pos.games * 100) + "%"));
        var trk = el("span", "pl-track");
        var br = el("span", "pl-bar");
        br.style.width = Math.max(2, Math.round(src[p.code] / pos.games * 100)) + "%";
        trk.appendChild(br);
        item.appendChild(trk);
        list.appendChild(item);
      });
    info.appendChild(list);
    info.appendChild(el("p", "analysis-note", state.fieldMode === "start"
      ? "※試合開始時に守った位置の割合（全" + pos.games + "試合で合計100%）。"
      : "※その位置を1度でも守った試合の割合。1試合で複数の位置を守ることがあるため、合計は100%を超えます。"));
    body.appendChild(info);
    sec.appendChild(body);
    return sec;
  }

  function pitchListSection(view) {
    var sec = el("section", "an-sec pitch-sec");
    sec.appendChild(el("h3", "analysis-title", "登板の一覧"));
    var list = view.filter(function (g) { return g.pitched === true; }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.gameLabel || "") < (b.gameLabel || "") ? 1 : -1;
    });
    if (list.length === 0) {
      sec.appendChild(el("p", "empty", "登板した試合がありません。"));
      return sec;
    }
    var labels = Derive.dateLabels(games());
    var wrap = el("div", "table-wrap");
    var table = el("table", "plain pitch-table");
    var hr = el("tr");
    ["日付", "相手", "評価"].concat(PITCH_EXTRA_COLUMNS.map(function (c) { return c.head; })).concat(["メモ"]).forEach(function (h, i) {
      hr.appendChild(el("th", "", h));
    });
    var thead = el("thead");
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    list.forEach(function (g) {
      var tr = el("tr");
      tr.appendChild(el("td", "nowrap", labels[g.id] || mdLabel(g.date)));
      tr.appendChild(el("td", "", g.opponent));
      var ev = el("td", "");
      ev.appendChild(el("span", "eval-chip eval-" + (g.pitchingEval === "合格" ? "ok" : g.pitchingEval === "不合格" ? "ng" : "none"), g.pitchingEval || "評価なし"));
      tr.appendChild(ev);
      PITCH_EXTRA_COLUMNS.forEach(function (c) { tr.appendChild(el("td", "num", c.cell(g))); });
      tr.appendChild(el("td", "memo-cell", g.memo || ""));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    sec.appendChild(wrap);
    return sec;
  }

  function renderAnalysis() {
    var root = document.getElementById("analysis");
    clear(root);
    if (!state.data) { unreadableNotice(root); return; }
    if (showEmptyIfNone(root)) return;
    var view = viewGames();
    root.appendChild(guardTop(view));
    root.appendChild(fieldSection(view));
    root.appendChild(analysisSection("守備位置別", "先発", positionRows(view), view, "※打撃成績は、その試合で最初に守った位置で集計", "pos"));
    root.appendChild(pitchListSection(view));
  }

  // ---- 走る ----
  function renderRun() {
    var root = document.getElementById("run");
    clear(root);
    if (!state.data) { unreadableNotice(root); return; }
    if (showEmptyIfNone(root)) return;
    var view = viewGames();
    var s = Stats.summarize(view);
    var bd = Stats.stealBreakdown(view);
    var ob = Stats.onBaseCount(view);
    var months = Stats.monthlySummary(view);
    var withYear = multiYear();

    var wrap = el("div", "run-page");

    // 上部の数字：盗塁（大きく）、1試合あたり、丸の並び
    var top = el("section", "run-top");
    var num = el("div", "run-num");
    var bc = el("div", "big-col");
    bc.appendChild(el("span", "lab", "盗塁"));
    bc.appendChild(el("span", "val num nb big-run", String(s.stolenBases)));
    num.appendChild(bc);
    var rsub = el("span", "sub");
    rsub.appendChild(document.createTextNode(s.games + "試合で" + s.stolenBases + "個"));
    rsub.appendChild(el("br"));
    rsub.appendChild(document.createTextNode("1試合に約" + (s.stolenBases / s.games).toFixed(1) + "個"));
    num.appendChild(rsub);
    top.appendChild(num);
    var ds = el("div", "run-dots");
    ds.appendChild(el("b", "sub-h", "出塁 " + ob + "回のうち 盗塁 " + s.stolenBases + "回"));
    var dots = el("div", "dots");
    dots.setAttribute("role", "img");
    dots.setAttribute("aria-label", "出塁" + ob + "回のうち" + s.stolenBases + "回で盗塁");
    for (var i = 0; i < ob; i++) dots.appendChild(el("span", i < s.stolenBases ? "dot dot-on" : "dot"));
    ds.appendChild(dots);
    ds.appendChild(legend([["盗塁した出塁", "#16A34A"], ["盗塁なし", "#BBF7D0"]]));
    top.appendChild(ds);
    var cm = el("div", "comment comment-run");
    cm.appendChild(el("p", "", Comments.run(view)));
    cm.appendChild(el("p", "comment-pc-only", Comments.runPc(view)));
    top.appendChild(cm);
    wrap.appendChild(top);

    // A. 盗塁ダイヤモンド
    var dsec = el("section", "run-card run-diamond");
    dsec.appendChild(el("h3", "run-h", "盗塁ダイヤモンド"));
    dsec.appendChild(Field.diamond(bd, {}));
    if (bd.unknown > 0) dsec.appendChild(el("p", "run-unknown", "内訳不明 " + bd.unknown));
    var dl = el("div", "legend dia-legend");
    [["二盗", bd.second], ["三盗", bd.third], ["本盗", bd.home]].forEach(function (x) {
      dl.appendChild(textEl("span", "lg", [x[0] + " ", el("b", "num nb", String(x[1]))]));
    });
    dsec.appendChild(dl);
    wrap.appendChild(dsec);

    // B. 走塁バッジ（達成したものだけ）
    var bsec = el("section", "run-card run-badges");
    bsec.appendChild(el("h3", "run-h", "走塁バッジ"));
    var badges = Derive.stealBadges(view);
    if (badges.length === 0) {
      bsec.appendChild(el("p", "empty", "まだバッジはありません。"));
    } else {
      var bl = el("div", "badge-list");
      badges.forEach(function (b) {
        var item = el("div", "badge");
        var ic = el("span", "badge-ico");
        ic.appendChild(toolIcon("run"));
        item.appendChild(ic);
        var tx = el("div", "badge-text");
        tx.appendChild(el("b", "", b.name));
        tx.appendChild(el("span", "", b.note));
        item.appendChild(tx);
        bl.appendChild(item);
      });
      bsec.appendChild(bl);
    }
    wrap.appendChild(bsec);

    // C. 盗塁の流れ（月ごとの棒＋盗塁のあった試合の一覧）
    var fsec = el("section", "run-card run-flow");
    fsec.appendChild(el("h3", "run-h", "月ごとの盗塁"));
    var maxM = 0;
    months.forEach(function (m) { if (m.stolenBases > maxM) maxM = m.stolenBases; });
    var bars = el("div", "month-bars");
    months.forEach(function (m) {
      var col = el("div", "mbar");
      col.appendChild(el("span", "mbv num nb", String(m.stolenBases)));
      var tr = el("div", "mbar-track");
      var bar = el("div", "mbar-fill");
      bar.style.height = (maxM > 0 ? m.stolenBases / maxM * 100 : 0) + "%";
      tr.appendChild(bar);
      col.appendChild(tr);
      col.appendChild(el("span", "mbl", monthName(m.month, withYear)));
      bars.appendChild(col);
    });
    fsec.appendChild(bars);
    wrap.appendChild(fsec);

    var lsec = el("section", "run-card run-list");
    lsec.appendChild(el("h3", "run-h", "盗塁のあった試合"));
    if (bd.games.length === 0) {
      lsec.appendChild(el("p", "empty", "まだ盗塁はありません。"));
    } else {
      var labels = Derive.dateLabels(games());
      var tw = el("div", "table-wrap");
      var table = el("table", "plain");
      var hr = el("tr");
      ["日付", "相手", "盗塁", "内訳"].forEach(function (h, i) { hr.appendChild(el("th", i === 2 ? "num" : "", h)); });
      var thead = el("thead");
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el("tbody");
      bd.games.slice().reverse().forEach(function (e) {
        var tr = el("tr");
        tr.appendChild(el("td", "nowrap", labels[e.game.id] || mdLabel(e.game.date)));
        tr.appendChild(el("td", "", e.game.opponent));
        tr.appendChild(el("td", "num nb run-n", String(e.count)));
        tr.appendChild(el("td", "", e.game.stealDetail || Derive.stealText(e)));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tw.appendChild(table);
      lsec.appendChild(tw);
    }
    wrap.appendChild(lsec);

    root.appendChild(wrap);
  }

  // ---- 試合入力 ----
  function renderFormGate() {
    var gate = document.getElementById("form-gate");
    var body = document.getElementById("form");
    clear(gate);
    var ok = canEdit();
    body.hidden = !ok;
    if (!ok) {
      gate.appendChild(el("p", "empty", state.status === "corrupt"
        ? "保存データを読み込めないため、入力できません。「データ管理」タブから復元してください。"
        : state.status === "needsMigration"
          ? "先にデータ形式を更新してください。「データ管理」タブの「バックアップを保存して更新」を押してください。"
          : "データが保存されない状態のため、入力できません。"));
    } else {
      GameForm.refreshLists();
    }
  }

  // ---- データ管理 ----
  function renderData() {
    var root = document.getElementById("data");
    clear(root);
    root.appendChild(el("h2", "", "データ管理"));
    if (state.status === "needsMigration") root.appendChild(migrationSection());
    var grid = el("div", "data-grid");

    var c1 = el("section", "data-card");
    c1.appendChild(el("h3", "", "今のデータ"));
    if (state.data) {
      c1.appendChild(backupBox());
      var dl = el("dl", "data-dl");
      dl.appendChild(el("dt", "", "試合数"));
      dl.appendChild(el("dd", "num", String(games().length)));
      dl.appendChild(el("dt", "", "最終更新"));
      dl.appendChild(el("dd", "", state.data.meta.lastModifiedAt.replace("T", " ").slice(0, 16)));
      c1.appendChild(dl);
    } else {
      c1.appendChild(el("p", "empty", "読み込めるデータがありません。"));
    }
    grid.appendChild(c1);

    var c2 = el("section", "data-card");
    c2.appendChild(el("h3", "", "バックアップを保存"));
    c2.appendChild(el("p", "", "現在のデータをJSONファイルとしてダウンロードします。"));
    var btn = el("button", "btn primary", "バックアップを保存");
    btn.type = "button";
    btn.disabled = !canEdit();
    btn.addEventListener("click", doBackup);
    c2.appendChild(btn);
    grid.appendChild(c2);

    var c3 = el("section", "data-card");
    c3.appendChild(el("h3", "", "バックアップから復元"));
    c3.appendChild(el("p", "", "ファイル（.json）を選ぶと、内容を確認したうえで、現在のデータ全体を置き換えます。置き換える直前に、現在のデータが自動でダウンロードされます。"));
    var input = el("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.disabled = state.status === "unavailable";
    input.addEventListener("change", function () {
      var f = input.files && input.files[0];
      input.value = "";
      doRestore(f);
    });
    c3.appendChild(input);
    grid.appendChild(c3);

    var c4 = el("section", "data-card data-note");
    c4.appendChild(el("h3", "", "データの保存場所について"));
    c4.appendChild(el("p", "", "記録は、このパソコン（このブラウザ）の中だけに保存されます。ブラウザの閲覧データを消すと、記録も消えます。"));
    c4.appendChild(el("p", "", "大事な記録は、ときどき「バックアップを保存」でファイルに残しておいてください。"));
    grid.appendChild(c4);
    root.appendChild(grid);
  }
  // ---- データ形式の更新（v2 → v3） ----
  function migrationSection() {
    var sec = el("div", "section migrate");
    sec.appendChild(el("h3", "", "データ形式の更新（守備位置の追加）"));
    sec.appendChild(el("p", "", "各試合に「守備位置」を追加します。メモ欄から読み取った結果を、更新前に確認してください。" +
      "メモなど、守備位置以外の内容は変わりません。更新の直前に、現在のデータが before-v3 のファイルとして自動でダウンロードされます。"));

    var wrap = el("div", "table-wrap");
    var table = el("table");
    var hr = el("tr");
    ["日付", "相手", "メモ", "補完される守備位置"].forEach(function (h) { hr.appendChild(el("th", "", h)); });
    var thead = el("thead");
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el("tbody");
    games().slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }).forEach(function (g) {
      var tr = el("tr");
      tr.appendChild(el("td", "", g.date));
      tr.appendChild(el("td", "", g.opponent));
      tr.appendChild(el("td", "memo-cell", g.memo || ""));
      var td = el("td");
      if (g.positions.length === 0) {
        td.appendChild(el("span", "yellow", "（なし）"));
      } else {
        td.appendChild(el("span", "", Stats.formatPositions(g.positions)));
        if ((g.positions.indexOf("P") >= 0) !== (g.pitched === true)) {
          td.appendChild(el("span", "yellow mismatch", "登板と不一致"));
        }
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    sec.appendChild(wrap);

    var btn = el("button", "btn primary", "バックアップを保存して更新");
    btn.type = "button";
    btn.addEventListener("click", doMigrate);
    var p = el("p");
    p.appendChild(btn);
    sec.appendChild(p);
    return sec;
  }

  function doMigrate() {
    if (state.status !== "needsMigration" || !state.loaded) return;
    // 1. 保存されている v2 の文字列を、そのままバックアップファイルとしてダウンロードする。
    Storage2.downloadText(Storage2.backupFileName("before-v3"), state.loaded.raw);
    // 2〜6. 変更の確認・控えの保存・移行・検証・保存・読み直し（失敗したら v2 のまま）。
    var r = Storage2.applyMigration(KEY, state.loaded);
    if (!r.ok) {
      state.notice = "更新に失敗しました。" + r.error;
      state.noticeOk = false;
      renderAll();
      return;
    }
    state.data = r.data;
    state.loadedAt = r.data.meta.lastModifiedAt;
    state.status = "ok";
    state.raw = null;
    state.loaded = null;
    GameForm.startNew();
    snapshotForm();
    state.notice = "更新しました。守備位置が違う試合は、試合一覧の「編集」で直せます。";
    state.noticeOk = true;
    renderAll();
  }


  function renderAll() {
    closeGloss();
    if (state.data) sanitizeFilter();
    renderFilterBar();
    renderHeader();
    renderBanner();
    renderDashboard();
    renderGames();
    renderRun();
    renderAnalysis();
    renderFormGate();
    renderData();
    if (!document.getElementById("panel-charts").hidden) renderCharts();
    placeFilterBar();
  }

  // ---- タブ切替 ----
  function showTab(name) {
    closeGloss();
    currentTab = name;
    renderFilterBar();
    renderHeader();
    var inStats = STATS_TABS.indexOf(name) >= 0;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      var on = b.getAttribute("data-tab") === name || (b.getAttribute("data-group") === "stats" && inStats);
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".panel"), function (p) {
      p.hidden = p.id !== "panel-" + name;
    });
    document.body.classList.toggle("form-open", name === "form");
    if (name === "charts") renderCharts();
    placeFilterBar();
    try { window.scrollTo(0, 0); } catch (e) { /* 無視 */ }
  }

  function initTabs() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab, .seg"), function (btn) {
      btn.addEventListener("click", function () { showTab(btn.getAttribute("data-tab")); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-action=record]"), function (btn) {
      btn.addEventListener("click", recordAction);
    });
  }

  // 画面の幅が境目（768px）をまたいだとき：置き場所・文字の大きさ・「登板のみ」の場所を直す
  function onLayoutChange() {
    renderFilterBar();
    renderHeader();
    placeFilterBar();
    if (!document.getElementById("panel-charts").hidden) renderCharts();
  }

  // ---- 起動 ----
  function start() {
    var r = Storage2.startup(KEY, window.SEED_DATA);
    state.status = r.status;
    state.data = r.data;
    state.raw = r.raw;
    state.loaded = r.status === "needsMigration" ? r : null;
    state.errors = r.errors || [];
    state.loadedAt = r.data ? r.data.meta.lastModifiedAt : null;
    state.ui = Derive.loadUi(Derive.UI_KEY);

    GameForm.init(document.getElementById("form"), {
      getGames: games,
      getLastInput: function () { return state.data ? state.data.meta.lastInput : {}; },
      saveGame: saveGame,
      // 保存・キャンセル・編集開始のあとの移動では、入力中かどうかの判定の基準を取り直す。
      goto: function (name) { snapshotForm(); showTab(name); }
    });
    snapshotForm();
    initTabs();
    if (mq) {
      if (mq.addEventListener) mq.addEventListener("change", onLayoutChange);
      else if (mq.addListener) mq.addListener(onLayoutChange);
    }
    renderAll();
    showTab(state.status === "corrupt" ? "data" : "dashboard");
  }

  start();
})();
