(function () {
  "use strict";

  // 画面に依存しない入力検証。戻り値は { 項目名: エラーメッセージ }。空オブジェクトならOK。
  // input の形：
  //   date, grade, squad, competition, opponent, gameLabel, battingOrder, stolenBases,
  //   stealDetail, pitched, pitchingEval, memo,
  //   positions: [文字列 × 4]（空文字 = 未入力。省略したら空として扱う）,
  //   plateAppearances: [{ result, direction, rbi } × 4]（result が空 = 打席なし）
  // 数値は文字列のままでもよい。

  function blank(v) {
    return v === undefined || v === null || String(v).trim() === "";
  }

  function isInt(v, min, max) {
    if (typeof v === "number") {
      return Math.floor(v) === v && v >= min && v <= max;
    }
    var s = String(v).trim();
    if (!/^\d+$/.test(s)) return false;
    var n = parseInt(s, 10);
    return n >= min && n <= max;
  }

  function isRealDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return false;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
  }

  function validateGameInput(input) {
    var errors = {};
    var defs = window.Stats.RESULT_DEFS;
    var dirs = window.Stats.DIRECTIONS;

    if (blank(input.date)) errors.date = "日付を入力してください。";
    else if (!isRealDate(input.date)) errors.date = "日付は YYYY-MM-DD の形式で入力してください。";

    if (blank(input.grade)) errors.grade = "学年を入力してください。";
    else if (!isInt(input.grade, 1, 6)) errors.grade = "学年は1〜6の整数で入力してください。";

    if (blank(input.squad)) errors.squad = "チーム区分を選んでください。";
    else if (["A", "B", "C", "D"].indexOf(input.squad) < 0) errors.squad = "チーム区分は A〜D から選んでください。";

    if (blank(input.competition)) errors.competition = "大会を入力してください。";
    if (blank(input.opponent)) errors.opponent = "相手を入力してください。";

    if (!blank(input.battingOrder) && !isInt(input.battingOrder, 1, 9)) {
      errors.battingOrder = "打順は1〜9で選んでください。";
    }

    if (blank(input.stolenBases)) errors.stolenBases = "盗塁数を入力してください。";
    else if (!isInt(input.stolenBases, 0, 10)) errors.stolenBases = "盗塁数は0〜10の整数で入力してください。";

    // 守備位置：1つ目から詰めて入力。隣り合う同じ位置は不可。ピッチャーの有無と登板を一致させる。
    var positions = input.positions || [];
    var codes = window.Stats.POSITIONS.map(function (p) { return p.code; });
    var filled = [];
    var posError = "";
    var seenBlank = false;
    for (var k = 0; k < 4; k++) {
      var c = positions[k];
      if (blank(c)) { seenBlank = true; continue; }
      if (seenBlank) { posError = "守備位置は1つ目から詰めて入力してください。"; break; }
      if (codes.indexOf(c) < 0) { posError = "守備位置が正しくありません。"; break; }
      if (filled.length > 0 && filled[filled.length - 1] === c) { posError = "隣り合う守備位置が同じです。"; break; }
      filled.push(c);
    }
    if (posError) {
      errors.positions = posError;
    } else if (filled.length > 0 && (filled.indexOf("P") >= 0) !== !!input.pitched) {
      errors.positions = filled.indexOf("P") >= 0
        ? "守備位置にピッチャーがあるので、登板にチェックが必要です。"
        : "守備位置にピッチャーがないので、登板にはできません。";
    }

    if (!input.pitched && !blank(input.pitchingEval)) {
      errors.pitchingEval = "登板していない試合に投球評価は付けられません。";
    } else if (!blank(input.pitchingEval) && input.pitchingEval !== "合格" && input.pitchingEval !== "不合格") {
      errors.pitchingEval = "投球評価は 合格 か 不合格 を選んでください。";
    }

    // 投手の記録（16章）：空欄は「記録なし」でOK。範囲外・小数・文字はエラー。登板していない試合に値があればエラー。
    if (input.pitchingStats && typeof input.pitchingStats === "object") {
      var PS = [
        ["pitches", "球数", 200], ["outs", "投球回（アウト数）", 30], ["runs", "失点", 50],
        ["strikeouts", "奪三振", 30], ["walks", "与四球", 30], ["hitByPitch", "与死球", 30]
      ];
      var anyValue = false;
      PS.forEach(function (d) {
        var v = input.pitchingStats[d[0]];
        if (blank(v)) return;
        anyValue = true;
        if (!isInt(v, 0, d[2])) errors["ps_" + d[0]] = d[1] + "は0〜" + d[2] + "の整数で入力してください。";
      });
      if (anyValue && !input.pitched) errors.pitchingStats = "登板していない試合に、投手の記録は入力できません。";
    }

    var pas = input.plateAppearances || [];
    var seenEmpty = false;
    for (var i = 0; i < 4; i++) {
      var pa = pas[i] || {};
      var key = "pa" + (i + 1);
      var label = "打席" + (i + 1);
      var rbiBlank = blank(pa.rbi);

      if (blank(pa.result)) {
        seenEmpty = true;
        // 結果が空の打席に、方向・打点（0以外）が入っていないこと
        if (!blank(pa.direction) || (!rbiBlank && String(pa.rbi).trim() !== "0")) {
          errors[key] = label + "：結果が空のときは、方向・打点を入力できません。";
        }
        continue;
      }

      if (seenEmpty) {
        errors[key] = label + "：打席は1から順に詰めて入力してください。";
        continue;
      }
      if (!defs[pa.result]) {
        errors[key] = label + "：結果が正しくありません。";
        continue;
      }
      if (!blank(pa.direction) && dirs.indexOf(pa.direction) < 0) {
        errors[key] = label + "：方向が正しくありません。";
        continue;
      }
      if (!rbiBlank && !isInt(pa.rbi, 0, 4)) {
        errors[key] = label + "：打点は0〜4の整数で入力してください。";
      }
    }

    return errors;
  }

  window.Validate = {
    validateGameInput: validateGameInput
  };
})();
