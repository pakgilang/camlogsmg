(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  var LB_STATE_KEY = "__lb";
  var lbOpenFlag = false;
  var lbItems = [];
  var lbIndex = 0;
  var lbPushed = false;
  var lbClosingViaBack = false;
  var lbMeta = { ids: null, source: "", queueIndex: -1 };

  var deps = {
    showToast: function () {},
    photoPut: function (id, dataUrl, cb) { cb && cb(null); },
    compressCanvasAsync: function (canvas, cb) { cb(new Error("no_compressor")); },
    onSaved: function () {},
    isUILocked: function () { return false; }
  };

  var lbDraw = {
    active: false,
    baseImg: null,
    drawing: false,
    saving: false,
    color: "#ef4444",
    width: 8,
    lastPt: null
  };

  function getCurrentPhotoId() {
    try {
      return (lbMeta && lbMeta.ids && lbMeta.ids[lbIndex]) ? String(lbMeta.ids[lbIndex]) : "";
    } catch (e) {
      return "";
    }
  }

  function canAnnotate() {
    var id = getCurrentPhotoId();
    var src = lbItems && lbItems[lbIndex] ? String(lbItems[lbIndex]) : "";
    return !!(id && src && src.indexOf("data:image") === 0);
  }

  function setNavDisabled(disabled) {
    var prev = $("lb-prev");
    var next = $("lb-next");
    var toggle = $("lb-draw-toggle");
    try {
      if (prev) prev.disabled = !!disabled;
      if (next) next.disabled = !!disabled;
      if (toggle) toggle.disabled = !!disabled;
    } catch (e) {}
  }

  function syncCanvasCssToImage() {
    try {
      var imgEl = $("lbImg");
      var cv = $("lbCanvas");
      if (!imgEl || !cv) return;
      var r = imgEl.getBoundingClientRect();
      if (!r || !r.width || !r.height) return;
      cv.style.width = r.width + "px";
      cv.style.height = r.height + "px";
    } catch (e) {}
  }

  function setSaving(saving) {
    lbDraw.saving = !!saving;
    var saveBtn = $("lb-draw-save");
    var cancelBtn = $("lb-draw-cancel");
    var bar = $("lbDrawBar");
    var badge = $("lbSaving");
    if (saveBtn) saveBtn.disabled = lbDraw.saving;
    if (cancelBtn) cancelBtn.disabled = lbDraw.saving;
    if (bar) bar.style.pointerEvents = lbDraw.saving ? "none" : "auto";
    if (badge) badge.classList.toggle("hidden", !lbDraw.saving);
  }

  function exitDrawMode() {
    var cv = $("lbCanvas");
    var bar = $("lbDrawBar");
    if (cv) cv.classList.add("hidden");
    if (bar) bar.classList.add("hidden");
    lbDraw.active = false;
    lbDraw.baseImg = null;
    lbDraw.drawing = false;
    lbDraw.lastPt = null;
    setSaving(false);
    setNavDisabled(false);
  }

  function enterDrawMode() {
    if (deps.isUILocked()) return;
    if (!canAnnotate()) {
      deps.showToast("warning", "Coret hanya untuk foto draft (sebelum upload).");
      return;
    }

    var src = String(lbItems[lbIndex] || "");
    var img = new Image();
    img.onload = function () {
      var cv = $("lbCanvas");
      var bar = $("lbDrawBar");
      if (!cv || !bar) return;

      lbDraw.active = true;
      lbDraw.baseImg = img;
      lbDraw.drawing = false;
      lbDraw.color = "#ef4444";
      lbDraw.width = 8;
      lbDraw.lastPt = null;
      setSaving(false);

      cv.width = img.naturalWidth || img.width || 1;
      cv.height = img.naturalHeight || img.height || 1;

      cv.classList.remove("hidden");
      bar.classList.remove("hidden");
      setNavDisabled(true);
      syncCanvasCssToImage();

      var ctx = cv.getContext("2d");
      if (ctx) {
        try { ctx.imageSmoothingEnabled = true; } catch (e) {}
        try { ctx.imageSmoothingQuality = "high"; } catch (e2) {}
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
      }
    };
    img.onerror = function () {
      deps.showToast("error", "Gagal memuat gambar untuk dicoret.");
    };
    img.src = src;
  }

  function pointFromEvent(e) {
    var cv = $("lbCanvas");
    if (!cv) return null;
    var r = cv.getBoundingClientRect();
    var x = (e.clientX - r.left) * (cv.width / Math.max(1, r.width));
    var y = (e.clientY - r.top) * (cv.height / Math.max(1, r.height));
    return [x, y];
  }

  function saveDraw() {
    if (!lbDraw.active) return;
    if (lbDraw.saving) return;
    if (deps.isUILocked()) return;
    var photoId = getCurrentPhotoId();
    var cv = $("lbCanvas");
    if (!photoId || !cv) return;

    setSaving(true);
    deps.showToast("info", "Memproses gambar...");

    deps.compressCanvasAsync(cv, function (err, packed) {
      if (err || !packed || !packed.dataUrl) {
        setSaving(false);
        deps.showToast("error", "Gagal kompres gambar.");
        return;
      }

      var dataUrl = packed.dataUrl || "";
      var sizeKb = packed.sizeKb || 0;
      lbItems[lbIndex] = dataUrl;

      exitDrawMode();
      render();

      deps.photoPut(photoId, dataUrl, function () {
        try { deps.onSaved(lbMeta, photoId, dataUrl, sizeKb); } catch (e2) {}
        deps.showToast("success", "Coretan tersimpan (" + sizeKb + " KB).");
      });
    });
  }

  function render() {
    var img = $("lbImg");
    var cnt = $("lbCount");
    if (!img) return;
    img.src = lbItems[lbIndex] || "";
    if (cnt) cnt.innerText = (lbIndex + 1) + " / " + (lbItems.length || 1);
    setTimeout(syncCanvasCssToImage, 0);

    var toggle = $("lb-draw-toggle");
    if (toggle) {
      if (canAnnotate()) toggle.classList.remove("hidden");
      else toggle.classList.add("hidden");
    }
  }

  function show(items, startIndex, meta) {
    if (!items || !items.length) return;
    exitDrawMode();
    lbItems = items;
    lbIndex = Math.max(0, Math.min(items.length - 1, startIndex || 0));
    lbMeta = meta || { ids: null, source: "", queueIndex: -1 };

    var el = $("lb");
    if (!el) return;

    lbOpenFlag = true;
    el.classList.remove("hidden");

    if (!lbPushed) {
      try {
        var st = {}; st[LB_STATE_KEY] = 1;
        history.pushState(st, "", location.href);
        lbPushed = true;
      } catch (e) {}
    }

    render();
    document.addEventListener("keydown", keydown);
  }

  function close() {
    if (lbDraw.saving) return;
    var el = $("lb");
    if (el) el.classList.add("hidden");

    exitDrawMode();
    lbOpenFlag = false;
    lbItems = [];
    lbIndex = 0;
    lbMeta = { ids: null, source: "", queueIndex: -1 };
    document.removeEventListener("keydown", keydown);

    if (lbPushed && !lbClosingViaBack) {
      lbPushed = false;
      try { history.back(); } catch (e) {}
    }
    if (lbClosingViaBack) lbPushed = false;
    lbClosingViaBack = false;
  }

  function prev() {
    if (!lbItems.length) return;
    if (lbDraw.active || lbDraw.saving) return;
    lbIndex = (lbIndex - 1 + lbItems.length) % lbItems.length;
    render();
  }

  function next() {
    if (!lbItems.length) return;
    if (lbDraw.active || lbDraw.saving) return;
    lbIndex = (lbIndex + 1) % lbItems.length;
    render();
  }

  function keydown(e) {
    var k = e && e.key ? e.key : "";
    if (k === "Escape") {
      if (lbDraw.saving) return;
      if (lbDraw.active) exitDrawMode();
      else close();
    }
    if (k === "ArrowLeft") prev();
    if (k === "ArrowRight") next();
  }

  function bindOnce() {
    on($("lb-backdrop"), "click", close);
    on($("lb-close"), "click", close);
    on($("lb-prev"), "click", prev);
    on($("lb-next"), "click", next);

    on($("lb-draw-toggle"), "click", function () { if (!deps.isUILocked() && !lbDraw.active) enterDrawMode(); });
    on($("lb-draw-cancel"), "click", function () { if (!lbDraw.saving) exitDrawMode(); });
    on($("lb-draw-save"), "click", function () { saveDraw(); });

    on($("lb-color-red"), "click", function () { lbDraw.color = "#ef4444"; });
    on($("lb-color-yellow"), "click", function () { lbDraw.color = "#f59e0b"; });
    on($("lb-color-blue"), "click", function () { lbDraw.color = "#3b82f6"; });

    var cv = $("lbCanvas");
    if (cv) {
      on(cv, "pointerdown", function (e) {
        if (!lbDraw.active || lbDraw.saving) return;
        try { e.preventDefault(); } catch (x) {}
        var pt = pointFromEvent(e);
        if (!pt) return;
        lbDraw.drawing = true;
        lbDraw.lastPt = pt;
        var ctx = cv.getContext("2d");
        if (ctx) {
          ctx.strokeStyle = lbDraw.color || "#ef4444";
          ctx.lineWidth = lbDraw.width || 8;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(pt[0], pt[1]);
        }
        try { cv.setPointerCapture(e.pointerId); } catch (y) {}
      });
      on(cv, "pointermove", function (e) {
        if (!lbDraw.active || lbDraw.saving || !lbDraw.drawing) return;
        try { e.preventDefault(); } catch (x2) {}
        var pt = pointFromEvent(e);
        if (!pt) return;
        var ctx = cv.getContext("2d");
        if (!ctx) return;
        if (!lbDraw.lastPt) {
          lbDraw.lastPt = pt;
          ctx.beginPath();
          ctx.moveTo(pt[0], pt[1]);
          return;
        }
        ctx.lineTo(pt[0], pt[1]);
        ctx.stroke();
        lbDraw.lastPt = pt;
      });
      on(cv, "pointerup", function (e) {
        if (!lbDraw.active) return;
        try { e.preventDefault(); } catch (x3) {}
        lbDraw.drawing = false;
        lbDraw.lastPt = null;
      });
      on(cv, "pointercancel", function () {
        if (!lbDraw.active) return;
        lbDraw.drawing = false;
        lbDraw.lastPt = null;
      });
    }

    window.addEventListener("popstate", function () {
      if (lbOpenFlag) {
        if (lbDraw.saving) return;
        lbClosingViaBack = true;
        close();
      }
    });

    window.addEventListener("resize", function () {
      if (!lbOpenFlag) return;
      syncCanvasCssToImage();
    });
  }

  function init(opts) {
    opts = opts || {};
    for (var k in deps) if (Object.prototype.hasOwnProperty.call(opts, k)) deps[k] = opts[k];
    bindOnce();
  }

  window.SMGLightbox = {
    init: init,
    show: show,
    close: close,
    prev: prev,
    next: next,
    isOpen: function () { return lbOpenFlag; }
  };
})();
