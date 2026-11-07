(function () {
  "use strict";

  // 成績の説明（打率・出塁率・長打率・OPS）。画面に依存しないデータと、例の文を作る関数。
  // 文は、デザイン仕様書v2.7（19.2）の表の文をそのまま使っている。言葉を足すときは TERMS に項目を足す。
  // 例は Stats.summarize の値だけで作る（新しい計算式は作らない）。

  function f(v) { return Stats.formatRate(v); }

  var TERMS = {
    avg: {
      name: "打率",
      short: "ヒットを打つ割合。高いほどよく打っている。",
      how: ["安打 ÷ 打数", "（打数＝打席から、四球・死球・犠打・犠飛・打撃妨害を除いた回数。振り逃げとエラー出塁は打数に入る）"],
      example: function (s) {
        if (!s || !(s.atBats > 0)) return null;
        return s.hits + "安打 ÷ " + s.atBats + "打数 ＝ " + f(s.avg);
      }
    },
    obp: {
      name: "出塁率",
      short: "塁に出る割合。ヒットに加えて、四球・死球でも上がる。エラーで出た塁は入らない。",
      how: ["（安打＋四球＋死球）÷（打数＋四球＋死球＋犠飛）"],
      example: function (s) {
        if (!s) return null;
        var num = s.hits + s.walks + s.hbp;
        var den = s.atBats + s.walks + s.hbp + s.sacFlies;
        if (!(den > 0)) return null;
        return "（" + s.hits + "＋" + s.walks + "＋" + s.hbp + "）÷（" + s.atBats + "＋" + s.walks + "＋" + s.hbp + "＋" + s.sacFlies + "）＝ " +
          num + " ÷ " + den + " ＝ " + f(s.obp);
      }
    },
    slg: {
      name: "長打率",
      short: "1打数あたりに進んだ塁の数。二塁打・三塁打・本塁打が多いほど上がる。1を超えることもある。",
      how: ["塁打 ÷ 打数", "（塁打＝ヒット×1＋二塁打×2＋三塁打×3＋本塁打×4）"],
      example: function (s) {
        if (!s || !(s.atBats > 0)) return null;
        return s.totalBases + "塁打 ÷ " + s.atBats + "打数 ＝ " + f(s.slg);
      }
    },
    ops: {
      name: "OPS",
      short: "出塁率と長打率を足した数。「塁に出る力」と「長打の力」をまとめて見る数字。",
      how: ["出塁率 ＋ 長打率"],
      example: function (s) {
        if (!s || s.obp === null || s.slg === null) return null;
        return f(s.obp) + " ＋ " + f(s.slg) + " ＝ " + f(s.ops);
      }
    }
  };

  var KEYS = ["avg", "obp", "slg", "ops"];

  // 画面の言葉（「打率」など）→ 項目のキー。説明がない言葉は null。
  function keyOf(name) {
    for (var i = 0; i < KEYS.length; i++) if (TERMS[KEYS[i]].name === name) return KEYS[i];
    return null;
  }

  // 例の文（分母が0なら null）
  function example(key, summary) {
    var t = TERMS[key];
    return t ? t.example(summary) : null;
  }

  window.Glossary = { TERMS: TERMS, KEYS: KEYS, keyOf: keyOf, example: example };
})();
