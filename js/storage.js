(function () {
  "use strict";

  // 保存・読込・検証・移行・バックアップ。読み込んだだけでは何も実行しない。
  // すべての関数は localStorage のキー名を引数で受け取る（test.html は本番キーを使わない）。

  var DEFAULT_KEY = "makiroy-demo-data";   // 見本版専用の保存の名前（配布版・本物のデータと重ならないようにする）
  var BEFORE_V3_SUFFIX = "-before-v3";   // 移行前の v2 の文字列の控え（例：haruto-baseball-data-before-v3）

  function getStore() {
    try {
      return window.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // 例：2026-10-29T21:00:00+09:00
  function nowIso(d) {
    d = d || new Date();
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    off = Math.abs(off);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" +
      pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
      sign + pad(Math.floor(off / 60)) + ":" + pad(off % 60);
  }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ---- 検証 ----
  // 戻り値：日本語のエラーメッセージの配列。空ならOK。

  // v2・v3 共通の確認。
  function validateCommon(obj, errors) {
    if (!Array.isArray(obj.games)) {
      errors.push("games が配列ではありません。");
      return;
    }
    var defs = window.Stats.RESULT_DEFS;
    var ids = {};
    obj.games.forEach(function (g, i) {
      var name = (i + 1) + "試合目";
      if (g === null || typeof g !== "object") {
        errors.push(name + "：試合のデータが正しくありません。");
        return;
      }
      if (typeof g.id !== "string" || g.id === "") {
        errors.push(name + "：id がありません。");
      } else if (ids[g.id]) {
        errors.push(name + "：id「" + g.id + "」が重複しています。");
      } else {
        ids[g.id] = true;
      }
      if (typeof g.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(g.date)) {
        errors.push(name + "：date が YYYY-MM-DD の形式ではありません。");
      }
      if (typeof g.competition !== "string" || g.competition === "") {
        errors.push(name + "：大会（competition）がありません。");
      }
      if (typeof g.opponent !== "string" || g.opponent === "") {
        errors.push(name + "：相手（opponent）がありません。");
      }
      if (!Array.isArray(g.plateAppearances)) {
        errors.push(name + "：plateAppearances が配列ではありません。");
        return;
      }
      if (g.plateAppearances.length > 4) {
        errors.push(name + "：打席が5件以上あります。");
      }
      g.plateAppearances.forEach(function (pa, j) {
        if (pa === null || typeof pa !== "object" || !Object.prototype.hasOwnProperty.call(defs, pa.result)) {
          errors.push(name + " 打席" + (j + 1) + "：結果コード「" + (pa && pa.result) + "」が未知です。");
        }
      });
    });
  }

  function isObject(obj) {
    return obj !== null && typeof obj === "object" && !Array.isArray(obj);
  }

  // v2（schemaVersion 2）の規則。positions は求めない。
  function validateDataV2(obj) {
    if (!isObject(obj)) return ["データがオブジェクトではありません。"];
    var errors = [];
    if (obj.schemaVersion !== 2) {
      errors.push("schemaVersion が 2 ではありません（値：" + String(obj.schemaVersion) + "）。");
    }
    validateCommon(obj, errors);
    return errors;
  }

  // v3（schemaVersion 3）の規則。通常の読込・復元・保存はこちらを使う。
  function validateData(obj) {
    if (!isObject(obj)) return ["データがオブジェクトではありません。"];
    var errors = [];
    if (obj.schemaVersion !== 3) {
      errors.push("schemaVersion が 3 ではありません（値：" + String(obj.schemaVersion) + "）。");
    }
    validateCommon(obj, errors);
    if (!Array.isArray(obj.games)) return errors;

    var codes = window.Stats.POSITIONS.map(function (p) { return p.code; });
    obj.games.forEach(function (g, i) {
      if (g === null || typeof g !== "object") return;
      var name = (i + 1) + "試合目";
      if (["A", "B", "C", "D"].indexOf(g.squad) < 0) {
        errors.push(name + "：squad が A〜D ではありません。");
      }
      if (!Array.isArray(g.positions)) {
        errors.push(name + "：positions が配列ではありません。");
        return;
      }
      if (g.positions.length > 4) {
        errors.push(name + "：守備位置が5件以上あります。");
      }
      g.positions.forEach(function (c, j) {
        if (codes.indexOf(c) < 0) {
          errors.push(name + " 守備位置" + (j + 1) + "：コード「" + c + "」が未知です。");
        } else if (j > 0 && g.positions[j - 1] === c) {
          errors.push(name + "：守備位置に隣り合う同じコード「" + c + "」があります。");
        }
      });
    });
    return errors;
  }

  // meta の足りない項目を補う（バックアップに meta が無い場合など）。
  function ensureMeta(data) {
    var m = data.meta && typeof data.meta === "object" ? data.meta : {};
    data.meta = {
      lastModifiedAt: typeof m.lastModifiedAt === "string" ? m.lastModifiedAt : nowIso(),
      lastBackupAt: typeof m.lastBackupAt === "string" ? m.lastBackupAt : null,
      lastInput: m.lastInput && typeof m.lastInput === "object" ? m.lastInput : {}
    };
    return data;
  }

  // ---- 移行（v2 → v3） ----
  var MEMO_NAMES = [
    ["ピッチャー", "P"], ["キャッチャー", "C"], ["ファースト", "1B"], ["セカンド", "2B"], ["サード", "3B"],
    ["ショート", "SS"], ["レフト", "LF"], ["センター", "CF"], ["ライト", "RF"]
  ];

  // メモ欄から守備位置を読み取る。
  // 「⇒」「→」で区切り、各部分の先頭の空白と「数字＋番」を除いた残りが、守備位置名で始まるときだけ加える。
  // 隣り合う同じコードは1つにまとめる。最大4つ。
  function positionsFromMemo(memo) {
    var result = [];
    String(memo === undefined || memo === null ? "" : memo).split(/[⇒→]/).forEach(function (part) {
      if (result.length >= 4) return;
      var s = part.replace(/^[\s　]+/, "").replace(/^[0-9０-９]+番/, "").replace(/^[\s　]+/, "");
      for (var i = 0; i < MEMO_NAMES.length; i++) {
        if (s.indexOf(MEMO_NAMES[i][0]) === 0) {
          if (result[result.length - 1] !== MEMO_NAMES[i][1]) result.push(MEMO_NAMES[i][1]);
          break;
        }
      }
    });
    return result;
  }

  // 引数を変更せず、深いコピーを返す。行うのは、positions の追加と schemaVersion の更新だけ。
  function migrateV2toV3(data) {
    var copy = deepCopy(data);
    (copy.games || []).forEach(function (g) {
      if (!Array.isArray(g.positions)) g.positions = positionsFromMemo(g.memo);
    });
    copy.schemaVersion = 3;
    return copy;
  }

  // ---- 読込（書き込まない） ----
  // status: "ok" | "needsMigration"（v2） | "empty"（キーなし） | "corrupt"（解析・検証に失敗） | "unavailable"
  // needsMigration のとき：data は表示用にメモリ上で移行したコピー、v2Data は保存されている v2、raw は保存されている文字列。
  function read(key) {
    var store = getStore();
    if (!store) return { status: "unavailable", data: null, errors: [], raw: null };
    var raw;
    try {
      raw = store.getItem(key);
    } catch (e) {
      return { status: "unavailable", data: null, errors: [], raw: null };
    }
    if (raw === null) return { status: "empty", data: null, errors: [], raw: null };

    var obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return { status: "corrupt", data: null, errors: ["保存データをJSONとして解析できません。"], raw: raw };
    }
    var errors = validateData(obj);
    if (errors.length === 0) return { status: "ok", data: ensureMeta(obj), errors: [], raw: raw };

    if (isObject(obj) && obj.schemaVersion === 2) {
      var errors2 = validateDataV2(obj);
      if (errors2.length === 0) {
        var shown = ensureMeta(migrateV2toV3(obj));
        if (validateData(shown).length === 0) {
          return { status: "needsMigration", data: shown, v2Data: obj, errors: [], raw: raw };
        }
        return { status: "corrupt", data: null, errors: validateData(shown), raw: raw };
      }
      return { status: "corrupt", data: null, errors: errors2, raw: raw };
    }
    return { status: "corrupt", data: null, errors: errors, raw: raw };
  }

  function rawWrite(key, data) {
    var store = getStore();
    if (!store) return { ok: false, error: "localStorage が使えません。" };
    var text = JSON.stringify(data);
    try {
      store.setItem(key, text);
      if (store.getItem(key) !== text) {
        return { ok: false, error: "保存後の読み直しで内容が一致しませんでした。" };
      }
    } catch (e) {
      return { ok: false, error: "保存に失敗しました（" + (e && e.name ? e.name : "不明なエラー") + "）。" };
    }
    return { ok: true };
  }

  // v2 の初期データは v3 に移行してから使う。
  function prepareSeed(seed) {
    var data = seed.schemaVersion === 2 ? migrateV2toV3(seed) : deepCopy(seed);
    ensureMeta(data);
    data.meta.lastBackupAt = null;
    data.meta.lastInput = {};
    return data;
  }

  // 初回起動：キーが存在しないときだけ、初期データを v3 にして meta を付けて保存する。
  function init(key, seed) {
    var cur = read(key);
    if (cur.status !== "empty") {
      return { ok: false, error: "保存データがすでに存在するため、初期データは書き込みません。" };
    }
    var data = prepareSeed(seed);
    var errors = validateData(data);
    if (errors.length > 0) return { ok: false, error: "初期データの検証に失敗しました：" + errors[0] };
    var r = rawWrite(key, data);
    return r.ok ? { ok: true, data: data } : r;
  }

  // 起動時の処理。status: "ok" | "initialized" | "needsMigration" | "corrupt" | "unavailable"
  function startup(key, seed) {
    var cur = read(key);
    if (cur.status === "ok" || cur.status === "needsMigration" || cur.status === "corrupt") return cur;
    if (cur.status === "unavailable") {
      return { status: "unavailable", data: prepareSeed(seed), errors: [], raw: null };
    }
    var r = init(key, seed);
    if (r.ok) return { status: "initialized", data: r.data, errors: [], raw: null };
    // 書き込みに失敗：初期データは表示するが、保存できない扱いにする。
    return { status: "unavailable", data: prepareSeed(seed), errors: [r.error], raw: null };
  }

  // ---- 保存 ----
  // loadedAt：この画面が読み込んだ時点の lastModifiedAt。保存済みの値と違えば、別のタブで
  //           更新されたとみなして保存しない。
  // opts.touch（既定 true）：lastModifiedAt を現在時刻にする。バックアップ記録のときは false。
  // opts.allowCorrupt：保存済みデータが壊れている・v2 のままでも置き換える（復元専用）。
  function save(key, data, loadedAt, opts) {
    opts = opts || {};
    var cur = read(key);
    if (cur.status === "unavailable") return { ok: false, error: "localStorage が使えません。" };
    if (cur.status === "corrupt" && !opts.allowCorrupt) {
      return { ok: false, error: "保存データが壊れているため、上書きしません。" };
    }
    if (cur.status === "needsMigration" && !opts.allowCorrupt) {
      return { ok: false, error: "データ形式の更新が必要なため、保存できません。先にデータ形式を更新してください。" };
    }
    if (cur.status === "ok" && cur.data.meta.lastModifiedAt !== loadedAt) {
      return { ok: false, conflict: true, error: "別のタブで更新されています。再読み込みしてください。" };
    }
    var next = deepCopy(data);
    ensureMeta(next);
    if (opts.touch !== false) next.meta.lastModifiedAt = nowIso();
    var errors = validateData(next);
    if (errors.length > 0) {
      return { ok: false, error: "保存するデータの検証に失敗したため、保存しませんでした：" + errors[0] };
    }
    var r = rawWrite(key, next);
    if (!r.ok) return r;
    return { ok: true, data: next };
  }

  // ---- 移行の実行 ----
  // loaded：read の結果（status が needsMigration のもの）。
  // 画面側は、この関数を呼ぶ前に、loaded.raw を before-v3 のファイルとしてダウンロードしておく。
  // 手順：保存データが変わっていないか確認 → 控えを別のキーに保存 → 移行 → v3 として検証 →
  //       保存して読み直し。失敗したら v2 の文字列を書き戻す。
  function applyMigration(key, loaded) {
    var store = getStore();
    if (!store) return { ok: false, error: "localStorage が使えません。" };
    var raw = loaded && loaded.raw;
    if (typeof raw !== "string") return { ok: false, error: "移行するデータがありません。" };

    var nowRaw;
    try {
      nowRaw = store.getItem(key);
    } catch (e) {
      return { ok: false, error: "保存データを読み込めませんでした。" };
    }
    if (nowRaw !== raw) {
      return { ok: false, conflict: true, error: "別のタブで更新されています。再読み込みしてください。" };
    }

    var v2;
    try {
      v2 = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: "保存データをJSONとして解析できません。" };
    }
    var errors2 = validateDataV2(v2);
    if (errors2.length > 0) return { ok: false, error: "保存データが v2 として正しくありません：" + errors2[0] };

    // 控え（最後の保険）
    var backupKey = key + BEFORE_V3_SUFFIX;
    try {
      store.setItem(backupKey, raw);
      if (store.getItem(backupKey) !== raw) throw new Error("mismatch");
    } catch (e) {
      return { ok: false, error: "移行前データの控えを保存できなかったため、更新を中止しました。保存データは更新前のままです。" };
    }

    var migrated = ensureMeta(migrateV2toV3(v2));
    migrated.meta.lastModifiedAt = nowIso();
    var errors = validateData(migrated);
    if (errors.length > 0) {
      return { ok: false, error: "更新後のデータの検証に失敗したため、保存しませんでした：" + errors[0] };
    }

    function rollback(message) {
      var back = false;
      try {
        store.setItem(key, raw);
        back = store.getItem(key) === raw;
      } catch (e) { back = false; }
      return {
        ok: false,
        error: message + (back ? "保存データは更新前のままです。"
          : "元のデータに戻せませんでした。ダウンロードした before-v3 のファイルから復元してください。")
      };
    }

    var w = rawWrite(key, migrated);
    if (!w.ok) return rollback("更新に失敗しました：" + w.error);
    var check = read(key);
    if (check.status !== "ok" || check.data.games.length !== v2.games.length) {
      return rollback("更新後の確認に失敗しました。");
    }
    return { ok: true, data: check.data };
  }

  // ---- バックアップ ----
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
  }

  function backupFileName(prefix, d) {
    return "haruto-baseball-" + prefix + "-" + stamp(d) + ".json";
  }

  function toJsonText(data) {
    return JSON.stringify(data, null, 2);
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // バックアップファイルの内容を解析・検証する。現在のデータには一切触れない。
  // v2 のファイルは、メモリ上で v3 に移行してから検証する（migrated: true）。
  function parseBackup(text) {
    var obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return { ok: false, errors: ["ファイルをJSONとして解析できません。"] };
    }
    var errors = validateData(obj);
    if (errors.length === 0) return { ok: true, data: ensureMeta(obj), migrated: false };

    if (isObject(obj) && obj.schemaVersion === 2) {
      var errors2 = validateDataV2(obj);
      if (errors2.length > 0) return { ok: false, errors: errors2 };
      var m = ensureMeta(migrateV2toV3(obj));
      var errors3 = validateData(m);
      if (errors3.length > 0) return { ok: false, errors: errors3 };
      return { ok: true, data: m, migrated: true };
    }
    return { ok: false, errors: errors };
  }

  window.Storage2 = {
    DEFAULT_KEY: DEFAULT_KEY,
    BEFORE_V3_SUFFIX: BEFORE_V3_SUFFIX,
    nowIso: nowIso,
    deepCopy: deepCopy,
    validateData: validateData,
    validateDataV2: validateDataV2,
    ensureMeta: ensureMeta,
    positionsFromMemo: positionsFromMemo,
    migrateV2toV3: migrateV2toV3,
    read: read,
    init: init,
    startup: startup,
    save: save,
    applyMigration: applyMigration,
    backupFileName: backupFileName,
    toJsonText: toJsonText,
    downloadText: downloadText,
    parseBackup: parseBackup
  };
})();
