(function () {
  "use strict";

  // ひと言の文（デザイン仕様書 v2.3 の15章）。画面に依存しない純粋な関数。
  // 文の数字は、すべて Stats の集計関数の値から作る。評価の言葉は入れない（事実だけ）。
  // 引数 games は、表示中の試合（絞り込み後）。試合が0件のときは「まだ試合がありません」。

  var NO_GAMES = "まだ試合がありません";

  // 15.1 打つ
  function bat(games) {
    if (games.length === 0) return NO_GAMES;
    var s = Stats.summarize(games);
    var denom = s.atBats + s.walks + s.hbp + s.sacFlies;
    if (denom === 0) return "まだ打席がありません。";
    return "10打席のうち" + Math.round(s.obp * 10) + "回は出塁（ヒット・四死球）。打点は" + s.rbi + "。";
  }

  // 15.2 走る（スマホ・PC共通の1文目）
  function run(games) {
    if (games.length === 0) return NO_GAMES;
    var s = Stats.summarize(games);
    var ob = Stats.onBaseCount(games);
    var sb = s.stolenBases;
    if (sb === 0) return "まだ盗塁はありません。";
    var ratio = Math.round(ob / sb);
    if (ratio <= 1) return "出塁" + ob + "回のうち" + sb + "回盗塁。塁に出るとほぼ毎回走っています。";
    return "出塁" + ob + "回のうち" + sb + "回盗塁。塁に出ると" + ratio + "回に1回は走っています。";
  }

  // 15.3 走る（PC の説明の文）。三振の数で切り替える。三振は strikeout だけ（振り逃げは含めない）。
  function runPc(games) {
    if (games.length === 0) return NO_GAMES;
    var s = Stats.summarize(games);
    var ob = Stats.onBaseCount(games);
    var k = s.strikeouts;
    var bb = s.walks + s.hbp;
    var roe = s.reachedOnError;

    if (ob === 0) {
      return "まだ塁に出た回数はありません。" + (k >= 1 ? "三振は" + k + "回です。" : "");
    }
    var parts = [];
    if (bb !== 0) parts.push("四死球" + bb);
    if (roe !== 0) parts.push("エラー出塁" + roe);
    var core = (parts.length ? parts.join("と") + "も合わせて、" : "") + "塁に出た回数は" + ob + "回です。";
    if (k === 0) return "三振は0。" + core;
    return core + "三振は" + k + "回（" + Math.round(s.plateAppearances / k) + "打席に1回）です。";
  }

  window.Comments = { bat: bat, run: run, runPc: runPc, NO_GAMES: NO_GAMES };
})();
