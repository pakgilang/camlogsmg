self.onmessage = async function (ev) {
  var msg = ev && ev.data ? ev.data : null;
  if (!msg || msg.type !== "compress") return;

  var id = msg.id;
  var bitmap = msg.bitmap;
  var maxWidth = msg.maxWidth || 1000;
  var targetKb = msg.targetKb || 60;
  var qualityStart = (typeof msg.qualityStart === "number") ? msg.qualityStart : 0.9;

  function toDataUrl(blob) {
    var fr = new FileReaderSync();
    return fr.readAsDataURL(blob);
  }

  async function encodeJpeg(canvas, q) {
    q = Math.max(0.05, Math.min(0.98, q));
    var blob = await canvas.convertToBlob({ type: "image/jpeg", quality: q });
    return { blob: blob, sizeKb: Math.max(0, Math.round(blob.size / 1024)), q: q };
  }

  function drawToCanvas(srcBitmap, w, h) {
    var c = new OffscreenCanvas(w, h);
    var ctx = c.getContext("2d", { alpha: false, desynchronized: true });
    if (ctx) {
      try { ctx.imageSmoothingEnabled = true; } catch (e) {}
      try { ctx.imageSmoothingQuality = "high"; } catch (e2) {}
      ctx.drawImage(srcBitmap, 0, 0, w, h);
    }
    return c;
  }

  async function bestQualityUnderTarget(canvas, qLo, qHi) {
    var hi = Math.max(qLo, Math.min(0.98, qHi));
    var lo = Math.max(0.05, Math.min(qLo, hi));

    var rHi = await encodeJpeg(canvas, hi);
    if (rHi.sizeKb <= targetKb) return rHi;

    var rLo = await encodeJpeg(canvas, lo);
    if (rLo.sizeKb > targetKb) return rLo;

    var best = rLo;
    var left = lo;
    var right = hi;
    for (var i = 0; i < 10; i++) {
      var mid = (left + right) / 2;
      var rMid = await encodeJpeg(canvas, mid);
      if (rMid.sizeKb <= targetKb) {
        best = rMid;
        left = mid;
      } else {
        right = mid;
      }
    }
    return best;
  }

  try {
    if (!bitmap || typeof OffscreenCanvas === "undefined") throw new Error("unsupported");

    var w0 = bitmap.width || 0;
    var h0 = bitmap.height || 0;
    if (!w0 || !h0) throw new Error("bad_bitmap");

    var w = w0;
    var h = h0;
    if (w > maxWidth) {
      h = Math.round(h * (maxWidth / w));
      w = maxWidth;
    }

    var minShorts = [240, 160, 120];
    var stage = 0;
    var qHi = qualityStart;
    var qLo = 0.25;
    var qLoFloor = 0.12;

    var canvas = drawToCanvas(bitmap, w, h);
    try { bitmap.close(); } catch (e0) {}

    var attempt = await bestQualityUnderTarget(canvas, qLo, qHi);
    var guard = 0;

    while (attempt.sizeKb > targetKb && guard < 22) {
      guard++;
      var short = Math.min(canvas.width, canvas.height);
      var minShort = minShorts[Math.min(stage, minShorts.length - 1)];

      if (short > minShort) {
        var scale = (guard <= 8) ? 0.92 : 0.88;
        var nextShort = Math.max(minShort, Math.round(short * scale));
        var scale2 = nextShort / short;
        var nw = Math.max(1, Math.round(canvas.width * scale2));
        var nh = Math.max(1, Math.round(canvas.height * scale2));
        canvas = drawToCanvas(canvas, nw, nh);
        attempt = await bestQualityUnderTarget(canvas, qLo, qHi);
        continue;
      }

      if (qLo > qLoFloor) {
        qLo = Math.max(qLoFloor, qLo - 0.07);
        attempt = await bestQualityUnderTarget(canvas, qLo, qHi);
        continue;
      }

      if (stage < minShorts.length - 1) {
        stage++;
        qLo = 0.25;
        qLoFloor = (stage === 1) ? 0.08 : 0.05;
        attempt = await bestQualityUnderTarget(canvas, qLo, qHi);
        continue;
      }

      break;
    }

    var dataUrl = toDataUrl(attempt.blob);
    self.postMessage({ type: "done", id: id, ok: true, dataUrl: dataUrl, sizeKb: attempt.sizeKb });
  } catch (err) {
    try { if (bitmap && bitmap.close) bitmap.close(); } catch (e1) {}
    self.postMessage({ type: "done", id: id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
