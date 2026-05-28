(function () {
  "use strict";

  var cfg = {
    maxWidth: 1000,
    qualityStart: 0.9,
    targetKb: 60
  };

  var diag = null;

  var worker = null;
  var jobSeq = 0;
  var jobs = {};

  function setConfig(nextCfg) {
    nextCfg = nextCfg || {};
    if (typeof nextCfg.maxWidth === "number") cfg.maxWidth = nextCfg.maxWidth;
    if (typeof nextCfg.qualityStart === "number") cfg.qualityStart = nextCfg.qualityStart;
    if (typeof nextCfg.targetKb === "number") cfg.targetKb = nextCfg.targetKb;
    if (nextCfg.diag) diag = nextCfg.diag;
  }

  function calcKB(dataUrl) {
    try {
      var s = String(dataUrl || "");
      var comma = s.indexOf(",");
      var b64 = (comma >= 0) ? s.substring(comma + 1) : s;
      var len = b64.length;
      if (!len) return 0;
      var pad = 0;
      if (b64.charAt(len - 1) === "=") pad++;
      if (b64.charAt(len - 2) === "=") pad++;
      var bytes = Math.floor((len * 3) / 4) - pad;
      return Math.max(0, Math.round(bytes / 1024));
    } catch (e) {
      return 0;
    }
  }

  function smartCompress(canvas) {
    var targetKb = cfg.targetKb || 60;
    var qHi = cfg.qualityStart || 0.9;
    var qLo = 0.25;
    var qLoFloor = 0.05;
    var minShorts = [240, 160, 120];
    var stage = 0;
    var minShort = minShorts[0];

    function encodeJpeg(c, q) {
      var dataUrl = c.toDataURL("image/jpeg", q);
      return { dataUrl: dataUrl, sizeKb: calcKB(dataUrl), q: q };
    }

    function resizeCanvas(src, w, h) {
      var c2 = document.createElement("canvas");
      c2.width = w;
      c2.height = h;
      var ctx = c2.getContext("2d");
      try { ctx.imageSmoothingEnabled = true; } catch (e) {}
      try { ctx.imageSmoothingQuality = "high"; } catch (e2) {}
      ctx.drawImage(src, 0, 0, w, h);
      return c2;
    }

    function bestQualityUnderTarget(c) {
      var hi = Math.max(qLo, Math.min(0.98, qHi));
      var lo = Math.max(0.05, Math.min(qLo, hi));

      var rHi = encodeJpeg(c, hi);
      if (rHi.sizeKb <= targetKb) return rHi;

      var rLo = encodeJpeg(c, lo);
      if (rLo.sizeKb > targetKb) return rLo;

      var best = rLo;
      var left = lo;
      var right = hi;
      for (var i = 0; i < 10; i++) {
        var mid = (left + right) / 2;
        var rMid = encodeJpeg(c, mid);
        if (rMid.sizeKb <= targetKb) {
          best = rMid;
          left = mid;
        } else {
          right = mid;
        }
      }
      return best;
    }

    var current = canvas;
    var attempt = bestQualityUnderTarget(current);
    var guard = 0;

    while (attempt.sizeKb > targetKb && guard < 22) {
      guard++;
      var w0 = current.width || 0;
      var h0 = current.height || 0;
      var short = Math.min(w0, h0);
      if (!short) break;

      if (short > minShort) {
        var scale = (guard <= 8) ? 0.92 : 0.88;
        var nextShort = Math.max(minShort, Math.round(short * scale));
        var scale2 = nextShort / short;
        var w = Math.max(1, Math.round(w0 * scale2));
        var h = Math.max(1, Math.round(h0 * scale2));
        current = resizeCanvas(current, w, h);
        attempt = bestQualityUnderTarget(current);
        continue;
      }

      if (qLo > qLoFloor) {
        qLo = Math.max(qLoFloor, qLo - 0.07);
        attempt = bestQualityUnderTarget(current);
        continue;
      }

      if (stage < minShorts.length - 1) {
        stage++;
        minShort = minShorts[stage];
        qLo = 0.25;
        qLoFloor = (stage === 1) ? 0.08 : 0.05;
        attempt = bestQualityUnderTarget(current);
        continue;
      }

      break;
    }

    return { dataUrl: attempt.dataUrl, sizeKb: attempt.sizeKb };
  }

  function ensureWorker() {
    if (worker === null) {
      try {
        worker = new Worker("/compress_worker.js");
        worker.onmessage = function (ev) {
          var msg = ev && ev.data ? ev.data : null;
          if (!msg || msg.type !== "done") return;
          var cb = jobs[msg.id];
          delete jobs[msg.id];
          if (typeof cb !== "function") return;
          if (msg.ok) cb(null, msg.payload);
          else cb(new Error(msg.error || "compress_failed"));
        };
        worker.onerror = function () {
          try { worker.terminate(); } catch (e) {}
          worker = false;
        };
      } catch (e2) {
        worker = false;
      }
    }
    return worker || null;
  }

  function compressBitmapAsync(bitmap, cb) {
    var w = ensureWorker();
    if (!w || !bitmap) return cb(new Error("no_worker"));
    var id = ++jobSeq;
    jobs[id] = cb;
    try {
      w.postMessage(
        { type: "compress", id: id, bitmap: bitmap, maxWidth: cfg.maxWidth, targetKb: cfg.targetKb, qualityStart: cfg.qualityStart },
        [bitmap]
      );
    } catch (err) {
      delete jobs[id];
      cb(err);
    }
  }

  function compressCanvasAsync(canvas, cb) {
    var start = Date.now();
    var usedWorker = false;
    if (ensureWorker() && window.createImageBitmap) {
      try {
        usedWorker = true;
        createImageBitmap(canvas).then(function (bitmap) {
          compressBitmapAsync(bitmap, function (err, packed) {
            if (err) {
              usedWorker = false;
              try { packed = smartCompress(canvas); } catch (e2) { return cb(e2); }
              packed.ms = Date.now() - start;
              packed.method = "main";
              if (diag && diag.push) diag.push("info", "compress.done", packed);
              return cb(null, packed);
            }
            packed = packed || {};
            packed.ms = Date.now() - start;
            packed.method = "worker";
            if (diag && diag.push) diag.push("info", "compress.done", packed);
            cb(null, packed);
          });
        }).catch(function () {
          usedWorker = false;
          try {
            var packed2 = smartCompress(canvas);
            packed2.ms = Date.now() - start;
            packed2.method = "main";
            if (diag && diag.push) diag.push("info", "compress.done", packed2);
            cb(null, packed2);
          } catch (e3) { cb(e3); }
        });
        return;
      } catch (e0) {
        usedWorker = false;
      }
    }

    try {
      var packed3 = smartCompress(canvas);
      packed3.ms = Date.now() - start;
      packed3.method = usedWorker ? "worker" : "main";
      if (diag && diag.push) diag.push("info", "compress.done", packed3);
      cb(null, packed3);
    } catch (e4) { cb(e4); }
  }

  function compressFileAsync(file, cb) {
    var start = Date.now();
    if (ensureWorker() && window.createImageBitmap) {
      try {
        createImageBitmap(file).then(function (bitmap) {
          compressBitmapAsync(bitmap, function (err, packed) {
            if (!err && packed) {
              packed.ms = Date.now() - start;
              packed.method = "worker";
              if (diag && diag.push) diag.push("info", "compress.file.done", packed);
              return cb(null, packed);
            }
            fallback();
          });
        }).catch(function () { fallback(); });
        return;
      } catch (e0) {}
    }

    fallback();

    function fallback() {
      var reader = new FileReader();
      reader.onload = function (event) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement("canvas");
          var w = img.width, h = img.height;
          if (w > cfg.maxWidth) {
            h = Math.round(h * (cfg.maxWidth / w));
            w = cfg.maxWidth;
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          compressCanvasAsync(canvas, function (err2, packed2) {
            if (err2) return cb(err2);
            packed2.method = "main";
            packed2.ms = Date.now() - start;
            if (diag && diag.push) diag.push("info", "compress.file.done", packed2);
            cb(null, packed2);
          });
        };
        img.onerror = function () { cb(new Error("img_error")); };
        img.src = event.target.result;
      };
      reader.onerror = function () { cb(new Error("read_error")); };
      reader.readAsDataURL(file);
    }
  }

  window.SMGCompress = {
    setConfig: setConfig,
    smartCompress: smartCompress,
    compressCanvasAsync: compressCanvasAsync,
    compressFileAsync: compressFileAsync
  };
})();
