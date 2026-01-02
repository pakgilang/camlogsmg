/* app.js — CAMLOG/SMG PWA (Netlify static) + GAS API
   - Mengandalkan /config.js (dibuat saat build Netlify oleh build-config.js)
   - Single file, tanpa framework, ringan
   - Fitur:
     ✓ Draft foto (max 10) + compress
     ✓ Queue PO + autosave IndexedDB (metadata + photos store)
     ✓ Upload batch ke GAS (simpanData) idempotent via upload_id
     ✓ Auto retry saat online (opt-in = uploadArmed)
     ✓ Riwayat (getData) & Search PO (searchByPO)
     ✓ Lightbox + overlay modal + toast
*/

(function () {
  "use strict";

  // =============================
  // CONFIG (from /config.js)
  // =============================
  var CFG = window.__APP_CONFIG__ || window.__CONFIG__ || {};
  var GAS_API_URL = (CFG.GAS_API_URL || "").trim();
  var API_KEY = (CFG.API_KEY || "").trim();

  // Safety: if config missing, still show UI but blocks upload
  function hasApi() {
    return !!(GAS_API_URL && API_KEY);
  }

  // =============================
  // DOM HELPERS
  // =============================
  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function clearEl(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  // =============================
  // UI: MENU / NAV
  // =============================
  function openMenu() { var m = $("main-menu"); if (m) m.classList.remove("hidden"); }
  function closeMenu() { var m = $("main-menu"); if (m) m.classList.add("hidden"); }
  function toggleMenu() {
    if (uiLocked) return;
    var m = $("main-menu");
    if (!m) return;
    if (m.classList.contains("hidden")) openMenu(); else closeMenu();
  }

  function navigate(viewId) {
    if (uiLocked) return;
    closeMenu();
    var views = ["form", "data", "search"];
    for (var i = 0; i < views.length; i++) {
      var v = $("view-" + views[i]);
      if (v) v.classList.add("hidden");
    }
    var target = $("view-" + viewId);
    if (target) target.classList.remove("hidden");

    if (viewId === "data") loadData(true);
  }

  // =============================
  // UI: TOAST
  // =============================
  var toastTimer = null;
  function setSvgUse(container, href, cls) {
    if (!container) return;
    container.innerHTML = "";
    var w = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    w.setAttribute("class", "w-5 h-5 " + (cls || "text-slate-700"));
    var u = document.createElementNS("http://www.w3.org/2000/svg", "use");
    u.setAttribute("href", href);
    try { u.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href); } catch (e) {}
    w.appendChild(u);
    container.appendChild(w);
  }

  function showToast(type, text) {
    var el = $("toast");
    var icon = $("toastIcon");
    var t = $("toastText");
    if (!el || !icon || !t) return;

    t.innerText = text || "";

    if (type === "success") {
      icon.className = "w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center";
      setSvgUse(icon, "#ic-check", "text-emerald-700");
    } else if (type === "warning") {
      icon.className = "w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center";
      setSvgUse(icon, "#ic-warn", "text-amber-700");
    } else if (type === "error") {
      icon.className = "w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center";
      setSvgUse(icon, "#ic-warn", "text-red-700");
    } else {
      icon.className = "w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center";
      setSvgUse(icon, "#ic-info", "text-slate-700");
    }

    el.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 1600);
  }

  function hideToast() {
    var el = $("toast");
    if (el) el.classList.add("hidden");
  }

  // =============================
  // UI: OVERLAY (alert/confirm/form/progress)
  // =============================
  var OV = { open: false, resolver: null, mode: "alert", allowClose: true };

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(s) {
    return escapeHtml(String(s || "").replace(/\r?\n/g, " "));
  }

  function ovShow(opts) {
    opts = opts || {};
    var ov = $("ov");
    var bd = $("ovBackdrop");
    var title = $("ovTitle");
    var sub = $("ovSub");
    var body = $("ovBody");
    var icon = $("ovIcon");
    var btnX = $("ovX");
    var btnOk = $("ovOk");
    var btnCancel = $("ovCancel");
    var footer = $("ovFooter");

    if (!ov || !body) return;

    OV.open = true;
    OV.mode = opts.mode || "alert";
    OV.allowClose = (opts.allowClose !== false);

    if (title) title.innerText = opts.title || "Info";

    if (sub) {
      if (opts.sub) {
        sub.classList.remove("hidden");
        sub.innerText = opts.sub;
      } else {
        sub.classList.add("hidden");
        sub.innerText = "";
      }
    }

    if (typeof opts.bodyHtml === "string") {
      body.innerHTML = opts.bodyHtml;
    } else {
      body.innerHTML = '<div class="text-sm text-slate-700">' + escapeHtml(opts.text || "") + "</div>";
    }

    var ic = opts.icon || "info";
    if (ic === "success") {
      icon.className = "w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center";
      setSvgUse(icon, "#ic-check", "text-emerald-700");
    } else if (ic === "warning") {
      icon.className = "w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center";
      setSvgUse(icon, "#ic-warn", "text-amber-700");
    } else if (ic === "error") {
      icon.className = "w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center";
      setSvgUse(icon, "#ic-warn", "text-red-700");
    } else {
      icon.className = "w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center";
      setSvgUse(icon, "#ic-info", "text-slate-700");
    }

    var isConfirm = (OV.mode === "confirm" || OV.mode === "form");
    var isProgress = (OV.mode === "progress");

    if (btnX) btnX.style.display = OV.allowClose ? "flex" : "none";
    if (bd) bd.style.pointerEvents = OV.allowClose ? "auto" : "none";
    if (footer) footer.style.display = isProgress ? "none" : "flex";

    if (btnCancel) {
      btnCancel.style.display = isConfirm ? "inline-flex" : "none";
      btnCancel.innerText = opts.cancelText || "Batal";
    }
    if (btnOk) btnOk.innerText = opts.okText || (isConfirm ? "Ya" : "OK");

    if (bd) {
      bd.onclick = function () { if (OV.allowClose) ovClose(false); };
    }

    ov.classList.remove("ov-hidden");
  }

  function ovClose(ok) {
    var ov = $("ov");
    if (!ov) return;
    if (!OV.open) return;
    if (!OV.allowClose && ok !== true) return;

    OV.open = false;
    ov.classList.add("ov-hidden");

    var res = OV.resolver;
    OV.resolver = null;
    if (typeof res === "function") res(!!ok);
  }

  function uiAlert(icon, title, text, cb) {
    OV.resolver = function () { if (cb) cb(); };
    ovShow({ mode: "alert", icon: icon || "info", title: title || "Info", text: text || "", okText: "OK", allowClose: true });
  }

  function uiConfirm(title, text, okText, cb) {
    OV.resolver = function (ok) { if (cb) cb(!!ok); };
    ovShow({ mode: "confirm", icon: "warning", title: title || "Konfirmasi", text: text || "", okText: okText || "Ya", cancelText: "Batal", allowClose: true });
  }

  function uiProgressOpen(title, sub, html) {
    OV.resolver = null;
    ovShow({ mode: "progress", icon: "info", title: title || "Proses", sub: sub || "", bodyHtml: html || "", allowClose: false });
  }

  // =============================
  // LIGHTBOX
  // =============================
  var LB_STATE_KEY = "__lb";
  var lbOpenFlag = false;
  var lbItems = [];
  var lbIndex = 0;
  var lbPushed = false;
  var lbClosingViaBack = false;

  function lbRender() {
    var img = $("lbImg");
    var cnt = $("lbCount");
    if (!img) return;
    img.src = lbItems[lbIndex] || "";
    if (cnt) cnt.innerText = (lbIndex + 1) + " / " + (lbItems.length || 1);
  }

  function lbShow(items, startIndex) {
    if (!items || !items.length) return;
    lbItems = items;
    lbIndex = Math.max(0, Math.min(items.length - 1, startIndex || 0));

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

    lbRender();
    document.addEventListener("keydown", lbKeydown);
  }

  function lbClose() {
    var el = $("lb");
    if (el) el.classList.add("hidden");

    lbOpenFlag = false;
    lbItems = [];
    lbIndex = 0;
    document.removeEventListener("keydown", lbKeydown);

    if (lbPushed && !lbClosingViaBack) {
      lbPushed = false;
      try { history.back(); } catch (e) {}
    }
    if (lbClosingViaBack) lbPushed = false;
    lbClosingViaBack = false;
  }

  function lbPrev() {
    if (!lbItems.length) return;
    lbIndex = (lbIndex - 1 + lbItems.length) % lbItems.length;
    lbRender();
  }

  function lbNext() {
    if (!lbItems.length) return;
    lbIndex = (lbIndex + 1) % lbItems.length;
    lbRender();
  }

  function lbKeydown(e) {
    var k = e && e.key ? e.key : "";
    if (k === "Escape") lbClose();
    if (k === "ArrowLeft") lbPrev();
    if (k === "ArrowRight") lbNext();
  }

  window.addEventListener("popstate", function () {
    if (lbOpenFlag) {
      lbClosingViaBack = true;
      lbClose();
    }
  });

  // =============================
  // STATE + SETTINGS
  // =============================
  var currentCategory = "MATERIAL"; // fixed for MVP
  var capturedFiles = [];          // { id, dataUrl, sizeKb, jenis }
  var poQueue = [];                // { kategori,no_po,git_number,pic_po,keterangan,image_ids[],photo_types[],sizes[],total_kb,po_mode,upload_id,_uploaded,status_upload_ke_srm }
  var previewSkeletonEl = null;

  var MAX_WIDTH = 1200;
  var JPEG_QUALITY_START = 0.82;
  var TARGET_KB = 150;
  var processingCount = 0;
  var uiLocked = false;

  // Upload opt-in
  var uploadArmed = false;
  var autoUploadBusy = false;

  // PO Mode
  var currentPOMode = "std";
  var MODE_PREFIXES = {
    "SL3": "188704",
    "SRG": "324700",
    "PML": "323700",
    "BYS": "302700"
  };

  // draft saved indicator
  var draftSavedTimer = null;
  function showDraftSaved() {
    var el = $("draft-saved");
    if (!el) return;
    el.classList.remove("hidden");
    if (draftSavedTimer) clearTimeout(draftSavedTimer);
    draftSavedTimer = setTimeout(function () { el.classList.add("hidden"); }, 2500);
  }

  // AUTO UPLOAD
  var AUTO_UPLOAD_ENABLED = true;
  var AUTO_UPLOAD_DEBOUNCE_MS = 2500;
  var autoUploadTimer = null;

  function makeUploadId() {
    return "UPL_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  function makeLegacyUploadId(p) {
    var key = [
      (p && p.kategori) ? p.kategori : "",
      (p && p.no_po) ? p.no_po : "",
      (p && p.total_kb) ? p.total_kb : 0,
      (p && p.image_ids && p.image_ids[0]) ? String(p.image_ids[0]) : ""
    ].join("|");
    var h = 0;
    for (var i = 0; i < key.length; i++) {
      h = ((h << 5) - h) + key.charCodeAt(i);
      h |= 0;
    }
    return "LEGACY_" + Math.abs(h);
  }

  function ensureUploadIdsInQueue() {
    for (var i = 0; i < poQueue.length; i++) {
      if (!poQueue[i]) continue;
      if (!poQueue[i].upload_id) poQueue[i].upload_id = makeLegacyUploadId(poQueue[i]);
    }
  }

  function hasPendingUploads() {
    for (var i = 0; i < poQueue.length; i++) {
      if (poQueue[i] && !poQueue[i]._uploaded) return true;
    }
    return false;
  }

  function scheduleAutoUpload(reason) {
    if (!AUTO_UPLOAD_ENABLED) return;
    if (autoUploadTimer) clearTimeout(autoUploadTimer);
    autoUploadTimer = setTimeout(function () {
      tryAutoUpload(reason || "auto");
    }, AUTO_UPLOAD_DEBOUNCE_MS);
  }

  function tryAutoUpload(reason) {
    if (!AUTO_UPLOAD_ENABLED) return;
    if (!uploadArmed) return;
    if (uiLocked) return;
    if (!navigator.onLine) return;
    if (capturedFiles && capturedFiles.length > 0) return;
    if (!poQueue || poQueue.length === 0) return;
    if (!hasPendingUploads()) return;

    if (!hasApi()) {
      showToast("warning", "Config API belum ada (GAS_API_URL / API_KEY).");
      return;
    }

    ensureUploadIdsInQueue();
    persistSnapshotNow();

    showToast("info", "Online ✓ Auto upload berjalan...");
    uploadAll(true);
  }

  // =============================
  // IndexedDB Persistence (kv + photos)
  // =============================
  var DB_NAME = "CAMLOG_PWA";
  var DB_VERSION = 2;
  var DB_STORE = "kv";
  var DB_PHOTOS = "photos";

  var SAVE_TIMER = null;
  var RESTORING = false;
  var PHOTO_CACHE = {}; // { photoId: dataUrl }

  function openDB(cb) {
    try {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        if (!db.objectStoreNames.contains(DB_PHOTOS)) db.createObjectStore(DB_PHOTOS);
      };
      req.onsuccess = function () { cb(null, req.result); };
      req.onerror = function () { cb(req.error || "DB open error"); };
    } catch (e) { cb(e); }
  }

  function kvGet(key, cb) {
    openDB(function (err, db) {
      if (err) return cb(err);
      try {
        var tx = db.transaction([DB_STORE], "readonly");
        var st = tx.objectStore(DB_STORE);
        var rq = st.get(key);
        rq.onsuccess = function () { try { db.close(); } catch (e) {} cb(null, rq.result); };
        rq.onerror = function () { try { db.close(); } catch (e) {} cb(rq.error || "get error"); };
      } catch (e2) { try { db.close(); } catch (e) {} cb(e2); }
    });
  }

  function kvPut(key, val, cb) {
    openDB(function (err, db) {
      if (err) return cb && cb(err);
      try {
        var tx = db.transaction([DB_STORE], "readwrite");
        tx.objectStore(DB_STORE).put(val, key);
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (cb) cb(null); };
        tx.onerror = function () { var er = tx.error; try { db.close(); } catch (e) {} if (cb) cb(er || "put error"); };
      } catch (e2) { try { db.close(); } catch (e) {} if (cb) cb(e2); }
    });
  }

  function kvDel(key, cb) {
    openDB(function (err, db) {
      if (err) return cb && cb(err);
      try {
        var tx = db.transaction([DB_STORE], "readwrite");
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (cb) cb(null); };
        tx.onerror = function () { var er = tx.error; try { db.close(); } catch (e) {} if (cb) cb(er || "del error"); };
      } catch (e2) { try { db.close(); } catch (e) {} if (cb) cb(e2); }
    });
  }

  function photoPut(id, dataUrl, cb) {
    if (!id) return cb && cb("no id");
    PHOTO_CACHE[id] = dataUrl || "";
    openDB(function (err, db) {
      if (err) return cb && cb(err);
      try {
        var tx = db.transaction([DB_PHOTOS], "readwrite");
        tx.objectStore(DB_PHOTOS).put(dataUrl || "", id);
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (cb) cb(null); };
        tx.onerror = function () { var er = tx.error; try { db.close(); } catch (e) {} if (cb) cb(er || "photo put error"); };
      } catch (e2) { try { db.close(); } catch (e) {} if (cb) cb(e2); }
    });
  }

  function photoGet(id, cb) {
    if (!id) return cb && cb(null, "");
    if (PHOTO_CACHE[id]) return cb && cb(null, PHOTO_CACHE[id]);

    openDB(function (err, db) {
      if (err) return cb && cb(err);
      try {
        var tx = db.transaction([DB_PHOTOS], "readonly");
        var st = tx.objectStore(DB_PHOTOS);
        var rq = st.get(id);
        rq.onsuccess = function () {
          var val = rq.result || "";
          if (val) PHOTO_CACHE[id] = val;
          try { db.close(); } catch (e) {}
          cb(null, val);
        };
        rq.onerror = function () { try { db.close(); } catch (e) {} cb(rq.error || "photo get error"); };
      } catch (e2) { try { db.close(); } catch (e) {} cb(e2); }
    });
  }

  function photoDel(id, cb) {
    if (!id) return cb && cb(null);
    try { delete PHOTO_CACHE[id]; } catch (e) {}
    openDB(function (err, db) {
      if (err) return cb && cb(err);
      try {
        var tx = db.transaction([DB_PHOTOS], "readwrite");
        tx.objectStore(DB_PHOTOS).delete(id);
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (cb) cb(null); };
        tx.onerror = function () { var er = tx.error; try { db.close(); } catch (e) {} if (cb) cb(er || "photo del error"); };
      } catch (e2) { try { db.close(); } catch (e) {} if (cb) cb(e2); }
    });
  }

  function photoGetMany(ids, cb) {
    ids = ids || [];
    var out = [];
    var i = 0;
    function next() {
      if (i >= ids.length) return cb && cb(null, out);
      var id = ids[i++];
      photoGet(id, function (err, val) {
        if (err) return cb && cb(err);
        out.push(val || "");
        next();
      });
    }
    next();
  }

  function photoDelMany(ids, cb) {
    ids = ids || [];
    var i = 0;
    function next() {
      if (i >= ids.length) return cb && cb(null);
      var id = ids[i++];
      photoDel(id, function () { next(); });
    }
    next();
  }

  // =============================
  // SNAPSHOT (metadata only)
  // =============================
  function getFormState() {
    var po = $("inp-po");
    var git = $("inp-git");
    var pic = $("inp-pic");
    var ket = $("inp-ket");
    var opt = $("optional-fields");
    return {
      po: po ? (po.value || "") : "",
      git: git ? (git.value || "") : "",
      pic: pic ? (pic.value || "") : "",
      ket: ket ? (ket.value || "") : "",
      optionalVisible: opt ? !opt.classList.contains("hidden") : false,
      poMode: currentPOMode
    };
  }

  function applyFormState(st) {
    if (!st) return;
    var po = $("inp-po");
    var git = $("inp-git");
    var pic = $("inp-pic");
    var ket = $("inp-ket");
    var opt = $("optional-fields");

    if (po) po.value = st.po || "";
    if (git) git.value = st.git || "";
    if (pic) pic.value = st.pic || "";
    if (ket) ket.value = st.ket || "";

    if (opt) {
      if (st.optionalVisible) opt.classList.remove("hidden");
      else opt.classList.add("hidden");
    }

    if (st.poMode) setPOMode(st.poMode, false);
  }

  function buildCapturedMeta() {
    var arr = [];
    for (var i = 0; i < capturedFiles.length; i++) {
      var f = capturedFiles[i] || {};
      arr.push({ id: f.id || "", sizeKb: f.sizeKb || 0, jenis: f.jenis || "MATERIAL" });
    }
    return arr;
  }

  function sanitizeQueueOnRestore() {
    for (var i = 0; i < poQueue.length; i++) {
      var p = poQueue[i] || {};
      p.kategori = "MATERIAL";
      p.po_mode = p.po_mode || "std";
      p.no_po = normalizePOWithMode(p.po_mode, p.no_po || "");
      p.pic_po = p.pic_po || "";
      p.git_number = p.git_number || "";
      p.keterangan = p.keterangan || "";

      p.image_ids = p.image_ids || [];
      p.sizes = p.sizes || [];
      p.photo_types = p.photo_types || [];
      p.total_kb = p.total_kb || 0;

      if (p.photo_types.length !== p.image_ids.length) {
        var fixed = [];
        for (var j = 0; j < p.image_ids.length; j++) fixed.push("MATERIAL");
        p.photo_types = fixed;
      }

      p.status_upload_ke_srm = p.status_upload_ke_srm || "Pending";
      p._uploaded = !!p._uploaded;
      p.upload_id = p.upload_id || makeLegacyUploadId(p);

      if (p.images) try { delete p.images; } catch (e) {}

      poQueue[i] = p;
    }
  }

  function sanitizeCapturedOnRestore() {
    for (var i = 0; i < capturedFiles.length; i++) {
      if (!capturedFiles[i]) capturedFiles[i] = {};
      if (!capturedFiles[i].jenis) capturedFiles[i].jenis = "MATERIAL";
      if (!capturedFiles[i].id) capturedFiles[i].id = "";
      if (!capturedFiles[i].dataUrl) capturedFiles[i].dataUrl = "";
      if (!capturedFiles[i].sizeKb) capturedFiles[i].sizeKb = 0;
    }
  }

  function persistSnapshotNow(cb) {
    try {
      var snap = {
        v: 3,
        ts: Date.now(),
        currentCategory: "MATERIAL",
        currentPOMode: currentPOMode,
        capturedMeta: buildCapturedMeta(),
        poQueue: poQueue || [],
        form: getFormState(),
        uploadArmed: !!uploadArmed
      };

      kvPut("snapshot", snap, function (err) {
        if (!err && !RESTORING) showDraftSaved();
        if (cb) cb(err || null);
      });
    } catch (e) { if (cb) cb(e); }
  }

  function saveStateDebounced() {
    if (RESTORING) return;
    if (SAVE_TIMER) clearTimeout(SAVE_TIMER);
    SAVE_TIMER = setTimeout(function () { persistSnapshotNow(); }, 450);
  }

  function clearPersistedState() {
    kvDel("snapshot");
  }

  // Legacy migration (if old snapshot still stored base64)
  function migrateLegacySnapshot(snap, done) {
    var tasks = [];
    var i;

    function makePhotoId() {
      return "PH_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    }

    if (snap && snap.capturedFiles && snap.capturedFiles.length) {
      for (i = 0; i < snap.capturedFiles.length; i++) {
        (function (f) {
          if (!f || !f.dataUrl) return;
          tasks.push(function (cb) {
            var id = makePhotoId();
            photoPut(id, f.dataUrl, function (err) {
              if (!err) {
                capturedFiles.push({ id: id, dataUrl: f.dataUrl, sizeKb: f.sizeKb || 0, jenis: f.jenis || "MATERIAL" });
              }
              cb(null);
            });
          });
        })(snap.capturedFiles[i]);
      }
    }

    var legacyQueue = (snap && snap.poQueue) ? snap.poQueue : [];
    for (i = 0; i < legacyQueue.length; i++) {
      (function (p) {
        if (!p) return;
        if (p.image_ids && p.image_ids.length) return;
        if (!p.images || !p.images.length) return;

        tasks.push(function (cb) {
          var ids = [];
          var sizes = p.sizes || [];
          var types = p.photo_types || [];
          var idx = 0;

          function next() {
            if (idx >= p.images.length) {
              p.image_ids = ids;
              p.sizes = (sizes && sizes.length === ids.length) ? sizes : (function () {
                var s = []; for (var k = 0; k < ids.length; k++) s.push(0); return s;
              })();
              p.photo_types = (types && types.length === ids.length) ? types : (function () {
                var t = []; for (var k2 = 0; k2 < ids.length; k2++) t.push("MATERIAL"); return t;
              })();
              try { delete p.images; } catch (e) {}
              cb(null);
              return;
            }

            var dataUrl = p.images[idx];
            var id = makePhotoId();
            idx++;

            photoPut(id, dataUrl, function () {
              ids.push(id);
              next();
            });
          }

          next();
        });
      })(legacyQueue[i]);
    }

    var t = 0;
    function runNext() {
      if (t >= tasks.length) return done && done();
      tasks[t++](function () { runNext(); });
    }
    runNext();
  }

  function hydrateCapturedFilesFromDB(meta, cb) {
    meta = meta || [];
    capturedFiles = [];
    var i = 0;

    function next() {
      if (i >= meta.length) return cb && cb();
      var m = meta[i++] || {};
      var id = m.id || "";
      var sizeKb = m.sizeKb || 0;
      var jenis = m.jenis || "MATERIAL";

      photoGet(id, function (err, dataUrl) {
        capturedFiles.push({ id: id, dataUrl: dataUrl || "", sizeKb: sizeKb, jenis: jenis });
        next();
      });
    }
    next();
  }

  function restoreSnapshot(cb) {
    kvGet("snapshot", function (err, snap) {
      if (err || !snap) return cb && cb(false);

      RESTORING = true;

      try {
        currentPOMode = snap.currentPOMode || "std";
        poQueue = snap.poQueue || [];
        uploadArmed = !!snap.uploadArmed;
      } catch (e) {
        RESTORING = false;
        return cb && cb(false);
      }

      setPOMode(currentPOMode, false);
      applyFormState(snap.form || null);

      var legacyHasBase64 =
        (!!snap.capturedFiles && snap.capturedFiles.length) ||
        (poQueue && poQueue.length && poQueue[0] && poQueue[0].images && poQueue[0].images.length);

      if (legacyHasBase64 || (snap.v && snap.v < 3)) {
        migrateLegacySnapshot(snap, function () {
          sanitizeQueueOnRestore();
          sanitizeCapturedOnRestore();
          renderPOList();
          updatePreviewUI();
          refreshStats();
          persistSnapshotNow(function () {
            RESTORING = false;
            cb && cb(true);
          });
        });
        return;
      }

      var meta = snap.capturedMeta || [];
      sanitizeQueueOnRestore();

      hydrateCapturedFilesFromDB(meta, function () {
        sanitizeCapturedOnRestore();
        renderPOList();
        updatePreviewUI();
        refreshStats();
        RESTORING = false;
        cb && cb(true);
      });
    });
  }

  // =============================
  // UI LOCK
  // =============================
  function setUILock(lock) {
    uiLocked = lock ? true : false;
    closeMenu();

    var root = $("app-root");
    if (!root) return;
    var els = root.querySelectorAll("button, input, select, textarea");
    for (var i = 0; i < els.length; i++) els[i].disabled = uiLocked;

    if (!uiLocked) {
      updatePreviewUI();
      refreshStats();
    }
  }

  function setEnabled(el, enabled) {
    if (!el) return;
    enabled = enabled && !uiLocked;
    if (enabled) {
      el.classList.remove("btn-disabled");
      el.disabled = false;
    } else {
      el.classList.add("btn-disabled");
      el.disabled = true;
    }
  }

  // =============================
  // PO NORMALIZER
  // =============================
  function pad2(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) n = 0;
    n = (n % 100 + 100) % 100;
    return (n < 10) ? ("0" + n) : String(n);
  }

  function digitsOnly(val) { return String(val || "").replace(/\D/g, ""); }

  function stripKnownLocationPrefix(digits) {
    if (!digits) return "";
    var prefKeys = ["SL3", "SRG", "PML", "BYS"];
    for (var i = 0; i < prefKeys.length; i++) {
      var p = MODE_PREFIXES[prefKeys[i]];
      if (p && digits.indexOf(p) === 0) return digits.substring(p.length);
    }
    return digits;
  }

  function force4DigitsSuffix(d) {
    d = String(d || "");
    if (!d) return "";
    if (d.length > 4) d = d.slice(-4);
    while (d.length < 4) d = "0" + d;
    return d;
  }

  function normalizePOWithMode(mode, raw) {
    var m = mode || "std";
    var digits = digitsOnly(raw);
    if (!digits) return "";

    digits = stripKnownLocationPrefix(digits);
    if (!digits) return "";

    if (m === "std") {
      var y = new Date().getFullYear() % 100;
      var yr = pad2(y);
      var prev1 = pad2(y - 1);
      var prev2 = pad2(y - 2);

      if (digits.length === 6) {
        var head2 = digits.substring(0, 2);
        if (head2 === yr || head2 === prev1 || head2 === prev2) {
          return "2030" + head2 + "00" + digits.substring(2);
        }
        return digits;
      } else if (digits.length === 4) {
        return "2030" + yr + "00" + digits;
      }
      return digits;
    }

    var prefix = MODE_PREFIXES[m] || "";
    if (!prefix) return digits;

    digits = force4DigitsSuffix(digits);
    return prefix + digits;
  }

  function normalizeCurrentPOInput() {
    var poEl = $("inp-po");
    if (!poEl) return;
    poEl.value = normalizePOWithMode(currentPOMode, poEl.value);
  }

  function setPOMode(mode, shouldNormalizeNow) {
    currentPOMode = mode || "std";

    var keys = ["std", "SL3", "SRG", "PML", "BYS"];
    for (var i = 0; i < keys.length; i++) {
      var id = (keys[i] === "std") ? "mode-std" : ("mode-" + keys[i]);
      var b = $(id);
      if (!b) continue;

      if (keys[i] === currentPOMode) {
        b.className =
          "flex-1 py-2 rounded-lg text-[11px] font-bold flex items-center " +
          "justify-center gap-2 bg-white text-blue-700 shadow-sm ring-1 " +
          "ring-blue-100";
      } else {
        b.className =
          "flex-1 py-2 rounded-lg text-[11px] font-semibold flex items-center " +
          "justify-center gap-2 text-slate-600 hover:text-slate-800 " +
          "hover:bg-white/60";
      }
    }

    if (shouldNormalizeNow) normalizeCurrentPOInput();
    saveStateDebounced();
  }

  function displayModeLabel(m) {
    if (m === "std") return "CPJF";
    if (m === "BYS") return "BYS/KBM";
    return m;
  }

  // =============================
  // SMART COMPRESSION
  // =============================
  function calcKB(dataUrl) { return Math.round((dataUrl.length * 0.75) / 1024); }

  function smartCompress(canvas) {
    var q = JPEG_QUALITY_START;
    var minQ = 0.45;
    var step = 0.07;

    var dataUrl = canvas.toDataURL("image/jpeg", q);
    var sizeKb = calcKB(dataUrl);

    var guard = 0;
    while (sizeKb > TARGET_KB && q > minQ && guard < 12) {
      guard++;
      q = q - step;
      if (q < minQ) q = minQ;
      dataUrl = canvas.toDataURL("image/jpeg", q);
      sizeKb = calcKB(dataUrl);
      if (q === minQ) break;
    }

    var down = 0;
    while (sizeKb > TARGET_KB && down < 2) {
      down++;
      var scale = (down === 1) ? 0.90 : 0.85;
      var w = Math.max(320, Math.round(canvas.width * scale));
      var h = Math.max(240, Math.round(canvas.height * scale));

      var c2 = document.createElement("canvas");
      c2.width = w; c2.height = h;
      c2.getContext("2d").drawImage(canvas, 0, 0, w, h);

      canvas = c2;
      q = 0.75;

      dataUrl = canvas.toDataURL("image/jpeg", q);
      sizeKb = calcKB(dataUrl);

      guard = 0;
      while (sizeKb > TARGET_KB && q > minQ && guard < 12) {
        guard++;
        q = q - step;
        if (q < minQ) q = minQ;
        dataUrl = canvas.toDataURL("image/jpeg", q);
        sizeKb = calcKB(dataUrl);
        if (q === minQ) break;
      }
    }

    return { dataUrl: dataUrl, sizeKb: sizeKb };
  }

  // =============================
  // TYPE MODAL
  // =============================
  var pendingCaptureType = "MATERIAL";

  function openTypeModal() {
    var m = $("type-modal");
    if (m) m.classList.remove("hidden");
  }

  function closeTypeModal() {
    var m = $("type-modal");
    if (m) m.classList.add("hidden");
  }

  function pickTypeAndOpen(t) {
    pendingCaptureType = t || "MATERIAL";
    closeTypeModal();
    setTimeout(function () { openCameraInput(); }, 80);
  }

  // =============================
  // CAMERA
  // =============================
  function triggerCamera() {
    if (uiLocked) return;
    if (capturedFiles.length >= 10) {
      showToast("warning", "Maksimal 10 foto untuk 1 PO.");
      return;
    }
    openTypeModal();
  }

  function openCameraInput() {
    if (uiLocked) return;
    var inp = $("camera-input");
    if (inp) inp.click();
  }

  function makePhotoId() {
    return "PH_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  function processImage(file, jenis) {
    var reader = new FileReader();
    reader.onload = function (event) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        var w = img.width, h = img.height;
        if (w > MAX_WIDTH) {
          h = Math.round(h * (MAX_WIDTH / w));
          w = MAX_WIDTH;
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);

        var packed = smartCompress(canvas);
        var id = makePhotoId();

        photoPut(id, packed.dataUrl, function () {
          capturedFiles.push({ id: id, dataUrl: packed.dataUrl, sizeKb: packed.sizeKb, jenis: (jenis || "MATERIAL") });
          processingCount = Math.max(0, processingCount - 1);
          updatePreviewUI();
          saveStateDebounced();
        });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  function handleFileSelect(e) {
    if (uiLocked) return;
    var files = e && e.target ? e.target.files : null;
    if (!files || !files.length) return;

    var remaining = 10 - capturedFiles.length;
    if (remaining <= 0) {
      showToast("warning", "Maksimal 10 foto untuk 1 PO.");
      try { e.target.value = ""; } catch (err) {}
      return;
    }

    var picked = [];
    for (var i = 0; i < files.length && picked.length < remaining; i++) picked.push(files[i]);

    processingCount += picked.length;
    var t = $("processing-toast");
    if (t) t.classList.remove("hidden");

    var jenis = pendingCaptureType || "MATERIAL";
    for (var j = 0; j < picked.length; j++) processImage(picked[j], jenis);

    try { e.target.value = ""; } catch (err2) {}
  }

  function getPhotoUrls(ids, cb) {
    ids = ids || [];
    photoGetMany(ids, function (err, arr) {
      if (err) return cb && cb(err);
      var out = [];
      for (var i = 0; i < arr.length; i++) if (arr[i]) out.push(arr[i]);
      cb && cb(null, out);
    });
  }

  // =============================
  // PREVIEW STRIP
  // =============================
  function updatePreviewUI() {
    var strip = $("preview-strip");
    var countEl = $("photo-count");
    var totalEl = $("photo-total-kb");
    var btnSave = $("btn-save");
    var btnAdd = $("btn-addpo");
    var proc = $("processing-toast");

    if (processingCount === 0 && proc) proc.classList.add("hidden");
    if (!strip) return;

    clearEl(strip);

    if (capturedFiles.length === 0) {
      if (previewSkeletonEl) strip.appendChild(previewSkeletonEl);
      if (countEl) countEl.classList.add("hidden");
      if (totalEl) totalEl.classList.add("hidden");
      setEnabled(btnSave, false);
      // ADD PO selalu aktif: klik untuk fokus ke input PO NUMBER
      setEnabled(btnAdd, true);
      return;
    }

    setEnabled(btnSave, true);
    // ADD PO selalu aktif (meski ada/tidak ada foto)
    setEnabled(btnAdd, true);

    var totalKb = 0;
    for (var i = 0; i < capturedFiles.length; i++) totalKb += (capturedFiles[i].sizeKb || 0);

    if (countEl) {
      countEl.classList.remove("hidden");
      countEl.innerText = capturedFiles.length + " foto";
    }
    if (totalEl) {
      totalEl.classList.remove("hidden");
      totalEl.innerText = totalKb + " KB";
    }

    for (var k = 0; k < capturedFiles.length; k++) {
      (function (idx) {
        var f = capturedFiles[idx];

        var wrap = document.createElement("div");
        wrap.className =
          "relative w-24 h-24 rounded-xl overflow-hidden border border-slate-200 " +
          "shadow-sm bg-slate-100 flex-shrink-0";

        var im = document.createElement("img");
        im.src = f.dataUrl || "";
        im.className = "w-full h-full object-cover cursor-pointer";
        im.onclick = function () { previewDraft(idx); };
        wrap.appendChild(im);

        var jb = document.createElement("div");
        jb.className =
          "absolute top-1 left-1 bg-black/65 text-white text-[9px] " +
          "px-1.5 py-0.5 rounded backdrop-blur-sm font-extrabold";
        jb.innerText = (f.jenis || "MATERIAL");
        wrap.appendChild(jb);

        var btn = document.createElement("button");
        btn.className =
          "absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full " +
          "flex items-center justify-center text-[10px] shadow active:scale-95";
        btn.onclick = function () { removeDraftPhoto(idx); };
        btn.innerHTML =
          '<svg class="w-3.5 h-3.5 text-white">' +
          '  <use href="#ic-x"></use>' +
          "</svg>";
        wrap.appendChild(btn);

        var badge = document.createElement("div");
        badge.className =
          "absolute bottom-1 left-1 bg-black/60 text-white text-[9px] " +
          "px-1.5 py-0.5 rounded backdrop-blur-sm";
        badge.innerText = (f.sizeKb || 0) + " KB";
        wrap.appendChild(badge);

        strip.appendChild(wrap);
      })(k);
    }
  }

  function removeDraftPhoto(i) {
    if (uiLocked) return;
    var f = capturedFiles[i];
    capturedFiles.splice(i, 1);
    if (f && f.id) photoDel(f.id);
    updatePreviewUI();
    saveStateDebounced();
  }

  function previewDraft(i) {
    var ids = [];
    for (var k = 0; k < capturedFiles.length; k++) ids.push(capturedFiles[k].id);
    getPhotoUrls(ids, function (err, items) {
      if (err || !items.length) return;
      lbShow(items, i);
    });
  }

  // =============================
  // SAVE DRAFT
  // =============================
  function getDraftPayload() {
    var elPo = $("inp-po");
    var elGit = $("inp-git");
    var elPic = $("inp-pic");
    var elKet = $("inp-ket");

    var imageIds = [];
    var sizes = [];
    var photoTypes = [];
    var total = 0;

    for (var i = 0; i < capturedFiles.length; i++) {
      imageIds.push(capturedFiles[i].id);
      sizes.push(capturedFiles[i].sizeKb || 0);
      photoTypes.push(capturedFiles[i].jenis || "MATERIAL");
      total += (capturedFiles[i].sizeKb || 0);
    }

    var poVal = elPo ? (elPo.value || "") : "";
    poVal = normalizePOWithMode(currentPOMode, poVal);

    return {
      kategori: "MATERIAL",
      no_po: (poVal || "").trim(),
      git_number: elGit ? ((elGit.value || "").trim()) : "",
      pic_po: elPic ? (elPic.value || "") : "",
      keterangan: elKet ? ((elKet.value || "").trim()) : "",
      image_ids: imageIds,
      sizes: sizes,
      photo_types: photoTypes,
      total_kb: total,
      po_mode: currentPOMode,
      status_upload_ke_srm: "Pending",
      upload_id: "",
      _uploaded: false
    };
  }

  function validateDraft(p) {
    if (!p.image_ids || p.image_ids.length === 0) return "Ambil minimal 1 foto dulu.";
    if (p.image_ids.length > 10) return "Maksimal 10 foto untuk 1 PO.";
    return "";
  }

  function focusPrimary() {
    var el = $("inp-po");
    if (el) setTimeout(function () { try { el.focus(); } catch (e) {} }, 120);
  }

  // ADD PO: selalu siap untuk mulai input (tanpa menyimpan)
  function focusAddPO() {
    if (uiLocked) return;
    // Pastikan user berada di tab FORM, lalu fokus ke input PO
    try { navigate("form"); } catch (e) {}
    var el = $("inp-po");
    if (el) {
      setTimeout(function () {
        try {
          el.focus();
          // select agar bisa langsung ketik ulang jika sudah ada isi
          if (el.select) el.select();
        } catch (e2) {}
      }, 120);
    }
  }

  function saveDraft(startNew) {
    if (uiLocked) return;

    normalizeCurrentPOInput();

    var payload = getDraftPayload();
    if (!payload.upload_id) payload.upload_id = makeUploadId();

    var err = validateDraft(payload);
    if (err) { showToast("warning", err); return; }

    function proceedSave() {
      poQueue.push(payload);
      renderPOList();
      refreshStats();

      capturedFiles = [];
      updatePreviewUI();

      var elPo = $("inp-po");
      var elGit = $("inp-git");
      var elPic = $("inp-pic");
      var elKet = $("inp-ket");
      if (elPo) elPo.value = "";
      if (elGit) elGit.value = "";
      if (elPic) elPic.value = "";
      if (elKet) elKet.value = "";

      var opt = $("optional-fields");
      if (opt) opt.classList.add("hidden");

      persistSnapshotNow();
      showToast("success", startNew ? "PO tersimpan. Lanjut input baru." : "PO tersimpan ke daftar.");
      // SIMPAN: cukup simpan ke daftar (tidak perlu auto-focus kembali ke PO).
      // ADD PO (startNew=true): fokus ke input PO agar siap input berikutnya.
      if (startNew) {
        focusPrimary();
      } else {
        try {
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        } catch (e) {}
      }

      if (navigator.onLine && uploadArmed) scheduleAutoUpload("after_save");
    }

    if (!payload.no_po) {
      uiConfirm(
        "Tanpa No PO?",
        "No PO kosong. Lanjut simpan tanpa No PO?",
        "Ya Tanpa PO Number",
        function (ok) {
          if (!ok) {
            var poEl = $("inp-po");
            if (poEl) setTimeout(function () { try { poEl.focus(); } catch (e) {} }, 80);
            return;
          }
          proceedSave();
        }
      );
      return;
    }

    proceedSave();
  }

  // =============================
  // LIST PO
  // =============================
  function renderPOList() {
    var list = $("po-list");
    var empty = $("po-empty");
    if (!list || !empty) return;

    if (poQueue.length === 0) {
      clearEl(list);
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");
    clearEl(list);

    for (var i = 0; i < poQueue.length; i++) {
      (function (idx) {
        var p = poQueue[idx];
        var title = p.no_po ? p.no_po : "PO";
        var fotoCount = p.image_ids ? p.image_ids.length : 0;
        var kb = p.total_kb || 0;
        var modeLabel = (p.no_po) ? (" • " + displayModeLabel(p.po_mode || "std")) : "";
        var gitLabel = (p.git_number) ? (" • GIT: " + p.git_number) : "";

        var card = document.createElement("div");
        card.className = "bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden";

        var inner = document.createElement("div");
        inner.className = "p-3 flex items-center gap-3";

        var thumbBox = document.createElement("div");
        thumbBox.className =
          "w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden " +
          "flex items-center justify-center flex-shrink-0";

        var imgEl = document.createElement("img");
        imgEl.className = "w-full h-full object-cover hidden";
        thumbBox.appendChild(imgEl);

        var placeholder = document.createElement("div");
        placeholder.innerHTML = '<svg class="w-5 h-5 text-slate-300"><use href="#ic-image"></use></svg>';
        thumbBox.appendChild(placeholder);

        if (p.image_ids && p.image_ids[0]) {
          (function (firstId, img, ph) {
            photoGet(firstId, function (err, dataUrl) {
              if (!err && dataUrl) {
                img.src = dataUrl;
                img.classList.remove("hidden");
                try { ph.remove(); } catch (e) {}
              }
            });
          })(p.image_ids[0], imgEl, placeholder);
        }

        var mid = document.createElement("div");
        mid.className = "flex-1 min-w-0";

        var topRow = document.createElement("div");
        topRow.className = "flex items-center justify-between gap-2";

        var textWrap = document.createElement("div");
        textWrap.className = "min-w-0";

        var t1 = document.createElement("div");
        t1.className = "text-sm font-bold text-slate-800 truncate";
        t1.innerText = title;

        var t2 = document.createElement("div");
        t2.className = "text-[10px] text-slate-500";
        t2.innerText = "MATERIAL" + modeLabel + gitLabel + " • " + fotoCount + " foto • " + kb + " KB";

        textWrap.appendChild(t1);
        textWrap.appendChild(t2);

        var del = document.createElement("button");
        del.className =
          "w-9 h-9 rounded-lg bg-red-50 border border-red-100 text-red-600 " +
          "flex items-center justify-center active:scale-95";
        del.innerHTML = '<svg class="w-5 h-5"><use href="#ic-trash"></use></svg>';
        del.onclick = function () { confirmDeletePO(idx); };

        topRow.appendChild(textWrap);
        topRow.appendChild(del);

        var btnRow = document.createElement("div");
        btnRow.className = "mt-2 grid grid-cols-2 gap-2";

        var b1 = document.createElement("button");
        b1.className =
          "bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 " +
          "text-[11px] font-bold py-2 rounded-lg active:scale-95";
        b1.innerHTML =
          '<span class="inline-flex items-center gap-1">' +
          '  <svg class="w-4 h-4"><use href="#ic-eye"></use></svg>' +
          "  <span>Lihat</span>" +
          "</span>";
        b1.onclick = function () { viewPO(idx); };

        var b2 = document.createElement("button");
        b2.className =
          "bg-amber-50 hover:bg-amber-100 border border-amber-100 text-amber-700 " +
          "text-[11px] font-bold py-2 rounded-lg active:scale-95";
        b2.innerHTML =
          '<span class="inline-flex items-center gap-1">' +
          '  <svg class="w-4 h-4"><use href="#ic-pen"></use></svg>' +
          "  <span>Edit</span>" +
          "</span>";
        b2.onclick = function () { editPO(idx); };

        btnRow.appendChild(b1);
        btnRow.appendChild(b2);

        mid.appendChild(topRow);
        mid.appendChild(btnRow);

        inner.appendChild(thumbBox);
        inner.appendChild(mid);

        card.appendChild(inner);
        list.appendChild(card);
      })(i);
    }
  }

  function confirmDeletePO(idx) {
    var p = poQueue[idx];
    var label = (p && p.no_po) ? p.no_po : "PO";

    uiConfirm("Hapus PO ini?", "PO: " + label + " akan dihapus dari daftar.", "Ya, Hapus", function (ok) {
      if (!ok) return;

      var ids = (p && p.image_ids) ? p.image_ids.slice(0) : [];
      photoDelMany(ids, function () {
        poQueue.splice(idx, 1);
        renderPOList();
        refreshStats();
        persistSnapshotNow();
        showToast("info", "PO dihapus.");
      });
    });
  }

  function viewPO(idx) {
    var p = poQueue[idx];
    var ids = (p && p.image_ids) ? p.image_ids.slice(0) : [];
    if (!ids.length) return;

    getPhotoUrls(ids, function (err, items) {
      if (err || !items.length) return;
      lbShow(items, 0);
    });
  }

  // =============================
  // EDIT POPUP
  // =============================
  function buildPicOptions(selected) {
    var pics = [
      "", "ANTONIUS.TK", "ARIF.ATMAJA", "BERNIKE.AS", "CAECILIA.MI",
      "DODY", "GILANG", "IMAN.WS", "JOANNA.NYDIA", "RATNA.AV", "RIMBA.G",
      "SANJUMA.T"
    ];

    var html = "";
    for (var i = 0; i < pics.length; i++) {
      var v = pics[i];
      var sel = (v === selected) ? " selected" : "";
      var label = v ? v : "(Kosong)";
      html += '<option value="' + escapeAttr(v) + '"' + sel + ">" + escapeHtml(label) + "</option>";
    }
    return html;
  }

  function buildModeOptions(selected) {
    var modes = [
      { v: "std", t: "CPJF (Standar)" },
      { v: "SL3", t: "SL3" },
      { v: "SRG", t: "SRG" },
      { v: "PML", t: "PML" },
      { v: "BYS", t: "BYS/KBM" }
    ];
    var html = "";
    for (var i = 0; i < modes.length; i++) {
      var sel = (modes[i].v === selected) ? " selected" : "";
      html += '<option value="' + escapeAttr(modes[i].v) + '"' + sel + ">" + escapeHtml(modes[i].t) + "</option>";
    }
    return html;
  }

  function editPO(idx) {
    if (uiLocked) return;
    var p = poQueue[idx];
    if (!p) return;

    var html =
      '<div class="text-left">' +
      '  <div class="text-[11px] font-bold text-slate-500 mb-1">MODE NORMALISASI</div>' +
      '  <select id="ed-mode" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm">' +
      buildModeOptions(p.po_mode || "std") + "</select>" +
      '  <div class="mt-1 text-[11px] text-slate-400">* Berlaku untuk No. PO.</div>' +

      '  <div class="mt-3">' +
      '    <div class="text-[11px] font-bold text-slate-500 mb-1">PO Number</div>' +
      '    <input id="ed-po" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-mono" ' +
      '      placeholder="..." value="' + escapeAttr(p.no_po || "") + '">' +
      '    <div id="ed-err" class="mt-2 text-[11px] text-red-600 hidden"></div>' +
      "  </div>" +

      '  <div class="mt-3">' +
      '    <div class="text-[11px] font-bold text-slate-500 mb-1">GIT NUMBER</div>' +
      '    <input id="ed-git" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-mono" ' +
      '      placeholder="..." value="' + escapeAttr(p.git_number || "") + '">' +
      "  </div>" +

      '  <div class="mt-3">' +
      '    <div class="text-[11px] font-bold text-slate-500 mb-1">PIC_PO</div>' +
      '    <select id="ed-pic" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm">' +
      buildPicOptions(p.pic_po || "") + "</select>" +
      "  </div>" +

      '  <div class="mt-3">' +
      '    <div class="text-[11px] font-bold text-slate-500 mb-1">KETERANGAN</div>' +
      '    <input id="ed-ket" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm" ' +
      '      placeholder="..." value="' + escapeAttr(p.keterangan || "") + '">' +
      "  </div>" +
      "</div>";

    OV.resolver = function (ok) {
      if (!ok) return;

      var popup = $("ovBody");
      if (!popup) return;

      var poEl = popup.querySelector("#ed-po");
      var gitEl = popup.querySelector("#ed-git");
      var picEl = popup.querySelector("#ed-pic");
      var ketEl = popup.querySelector("#ed-ket");
      var modeEl = popup.querySelector("#ed-mode");
      var errEl = popup.querySelector("#ed-err");

      var mode = modeEl ? modeEl.value : "std";
      var po = poEl ? poEl.value : "";
      var git = gitEl ? gitEl.value : "";
      var pic = picEl ? picEl.value : "";
      var ket = ketEl ? ketEl.value : "";

      po = normalizePOWithMode(mode, po);

      if (!po) {
        if (errEl) {
          errEl.classList.remove("hidden");
          errEl.innerText = "No. PO wajib diisi.";
        }
        // keep overlay open
        OV.open = true;
        $("ov").classList.remove("ov-hidden");
        return;
      }

      if (poQueue[idx].no_po !== po) {
        poQueue[idx].upload_id = makeUploadId();
        poQueue[idx]._uploaded = false;
      }

      poQueue[idx].kategori = "MATERIAL";
      poQueue[idx].no_po = (po || "").trim();
      poQueue[idx].git_number = (git || "").trim();
      poQueue[idx].pic_po = pic || "";
      poQueue[idx].keterangan = (ket || "").trim();
      poQueue[idx].po_mode = mode || "std";

      renderPOList();
      refreshStats();
      persistSnapshotNow();
      showToast("success", "Meta diperbarui.");
    };

    ovShow({
      mode: "form",
      icon: "info",
      title: "Edit Meta PO",
      bodyHtml: html,
      okText: "Simpan",
      cancelText: "Batal",
      allowClose: true
    });

    setTimeout(function () {
      var popup = $("ovBody");
      if (!popup) return;

      var poEl = popup.querySelector("#ed-po");
      var modeEl = popup.querySelector("#ed-mode");

      function normalizeEditPO() {
        var m = modeEl ? modeEl.value : "std";
        poEl.value = normalizePOWithMode(m, poEl.value);
      }

      if (modeEl) modeEl.onchange = normalizeEditPO;
      if (poEl) poEl.onblur = normalizeEditPO;
    }, 0);
  }

  // =============================
  // RESET ALL
  // =============================
  function confirmResetAll() {
    uiConfirm("Reset semua?", "Semua daftar PO yang belum diupload akan hilang.", "Ya, Reset", function (ok) {
      if (!ok) return;

      var all = [];
      for (var i = 0; i < poQueue.length; i++) {
        if (poQueue[i] && poQueue[i].image_ids) {
          for (var j = 0; j < poQueue[i].image_ids.length; j++) all.push(poQueue[i].image_ids[j]);
        }
      }
      for (var k = 0; k < capturedFiles.length; k++) if (capturedFiles[k] && capturedFiles[k].id) all.push(capturedFiles[k].id);

      photoDelMany(all, function () {
        poQueue = [];
        capturedFiles = [];
        clearPersistedState();
        renderPOList();
        updatePreviewUI();
        refreshStats();
        showToast("info", "Daftar PO direset.");
      });
    });
  }

  // =============================
  // UPLOAD (Netlify -> GAS API)
  // =============================
   function apiPost(action, data, cb) {
     if (!hasApi()) return cb && cb(new Error("Missing config.js GAS_API_URL / API_KEY"));
   
     var body = new URLSearchParams();
     body.set("action", action);
     body.set("key", API_KEY);
     body.set("data", JSON.stringify(data || {}));
   
     fetch(GAS_API_URL, {
       method: "POST",
       headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
       body: body.toString(),
       mode: "cors",
       cache: "no-store"
     })
       .then(function (r) { return r.json(); })
       .then(function (j) { cb && cb(null, j); })
       .catch(function (e) { cb && cb(e); });
   }


  function refreshStats() {
    var poCount = poQueue.length;
    var fotoCount = 0;
    for (var i = 0; i < poQueue.length; i++) {
      fotoCount += (poQueue[i].image_ids ? poQueue[i].image_ids.length : 0);
    }

    var sp = $("stat-po");
    var sf = $("stat-foto");
    if (sp) sp.innerText = poCount + " PO";
    if (sf) sf.innerText = fotoCount + " foto";

    var btnUpload = $("btn-upload");
    setEnabled(btnUpload, poCount > 0);
  }

  function buildUploadHtml(total, isAuto) {
    var label = isAuto ? "AUTO UPLOAD" : "UPLOAD PO";
    var hint = isAuto
      ? '<div class="mt-3 text-[11px] text-slate-400">' +
        "* Ini retry otomatis saat online. Jika sudah pernah terkirim, sistem akan skip." +
        "</div>"
      : "";

    return "" +
      '<div class="text-left">' +
      '  <div class="flex items-center gap-2">' +
      '    <div class="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center">' +
      '      <svg class="w-6 h-6 text-indigo-600 animate-spin"><use href="#ic-spin"></use></svg>' +
      "    </div>" +
      '    <div class="flex-1">' +
      '      <div class="font-extrabold text-slate-900">' + label + " berjalan</div>" +
      '      <div class="text-[11px] text-slate-400">Harap tunggu sampai selesai..</div>' +
      "    </div>" +
      "  </div>" +
      '  <div id="u_text" class="mt-3 text-sm text-slate-700">Memulai...</div>' +
      '  <div class="mt-3 w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">' +
      '    <div id="u_bar" class="h-2.5 w-0 bg-indigo-600 rounded-full"></div>' +
      "  </div>" +
      '  <div id="u_pct" class="mt-2 text-[11px] text-slate-400">0%</div>' +
      hint +
      "</div>";
  }

  function updateUploadUI(i, total, label, extra) {
    var txt = $("u_text");
    var bar = $("u_bar");
    var pctEl = $("u_pct");

    var pct = Math.floor((i / total) * 100);
    var shown = (i + 1);

    var x = extra
      ? '<div class="mt-1 text-[11px] text-slate-400">' + escapeHtml(extra) + "</div>"
      : "";

    if (txt) txt.innerHTML =
      "Mengupload <b>" + escapeHtml(label) + "</b> (" + shown + "/" + total + ")..." + x;

    if (bar) bar.style.width = pct + "%";
    if (pctEl) pctEl.innerText = pct + "%";
  }

  function finalizeUploadUI() {
    var txt = $("u_text");
    var bar = $("u_bar");
    var pctEl = $("u_pct");
    if (txt) txt.innerHTML = "Finalisasi...";
    if (bar) bar.style.width = "100%";
    if (pctEl) pctEl.innerText = "100%";
  }

  function cloneForUpload(item, images) {
    // GAS simpanData expect: images base64 array
    return {
      kategori: item.kategori,
      no_po: item.no_po,
      git_number: item.git_number,
      pic_po: item.pic_po,
      keterangan: item.keterangan,
      images: images || [],
      sizes: item.sizes || [],
      photo_types: item.photo_types || [],
      total_kb: item.total_kb || 0,
      po_mode: item.po_mode || "std",
      status_upload_ke_srm: item.status_upload_ke_srm || "Pending",
      upload_id: item.upload_id || "",
      _uploaded: !!item._uploaded
    };
  }

  function uploadAll(isAuto) {
    if (uiLocked) return;

    if (!hasApi()) {
      uiAlert("error", "Config belum siap", "GAS_API_URL / API_KEY belum terpasang di Netlify (config.js).", function(){});
      return;
    }

    if (!isAuto) {
      uploadArmed = true; // opt-in
      persistSnapshotNow();
    }
    if (isAuto && !uploadArmed) return;

    if (capturedFiles.length > 0) {
      if (!isAuto) showToast("warning", "Draft belum disimpan. Klik SIMPAN / ADD PO dulu.");
      return;
    }

    if (poQueue.length === 0) {
      if (!isAuto) showToast("warning", "Belum ada PO untuk diupload.");
      return;
    }

    if (!navigator.onLine) {
      if (!isAuto) showToast("warning", "Koneksi offline. Nanti akan auto upload saat online.");
      return;
    }

    ensureUploadIdsInQueue();

    var pending = [];
    for (var i = 0; i < poQueue.length; i++) {
      if (!poQueue[i]._uploaded) pending.push(i);
    }

    if (pending.length === 0) {
      if (!isAuto) {
        poQueue = [];
        clearPersistedState();
        renderPOList();
        refreshStats();
        showToast("info", "Daftar dibersihkan.");
      }
      return;
    }

    setUILock(true);
    uiProgressOpen(
      isAuto ? "AUTO UPLOAD" : "UPLOAD PO",
      "",
      buildUploadHtml(pending.length, !!isAuto)
    );

    uploadNextPending(0, pending, !!isAuto);
  }

  function uploadNextPending(pos, pendingIdxs, isAuto) {
    if (pos >= pendingIdxs.length) {
      finalizeUploadUI();

      var all = [];
      for (var i = 0; i < poQueue.length; i++) {
        if (poQueue[i] && poQueue[i].image_ids) {
          for (var j = 0; j < poQueue[i].image_ids.length; j++) all.push(poQueue[i].image_ids[j]);
        }
      }

      photoDelMany(all, function () {
        poQueue = [];
        capturedFiles = [];
        clearPersistedState();
        renderPOList();
        updatePreviewUI();
        refreshStats();

        uiAlert("success", "Selesai!", "Berhasil upload " + pendingIdxs.length + " PO.", function () {
          setUILock(false);
          var ov = $("ov");
          if (ov) ov.classList.add("ov-hidden");
          OV.open = false;
        });
      });

      return;
    }

    var idx = pendingIdxs[pos];
    var item = poQueue[idx];
    if (!item) {
      uploadNextPending(pos + 1, pendingIdxs, isAuto);
      return;
    }

    if (!item.upload_id) item.upload_id = makeLegacyUploadId(item);

    var label = (item.no_po ? item.no_po : "PO");
    updateUploadUI(pos, pendingIdxs.length, label, "ID: " + item.upload_id);

    var ids = item.image_ids ? item.image_ids.slice(0) : [];
    photoGetMany(ids, function (err, images) {
      if (err) {
        uiAlert("error", "Gagal", "Gagal membaca foto lokal untuk " + label + ": " + String(err), function () {
          setUILock(false);
          var ov = $("ov");
          if (ov) ov.classList.add("ov-hidden");
          OV.open = false;
          if (isAuto) scheduleAutoUpload("retry_read_photos");
        });
        return;
      }

      var realImages = [];
      for (var k = 0; k < images.length; k++) if (images[k]) realImages.push(images[k]);

      var sendItem = cloneForUpload(item, realImages);

      apiPost("simpanData", sendItem, function (e2, res) {
        if (e2) {
          persistSnapshotNow(function () {
            uiAlert("error", "Gagal", "Error pada " + label + ": " + String(e2), function () {
              setUILock(false);
              var ov = $("ov");
              if (ov) ov.classList.add("ov-hidden");
              OV.open = false;
              if (isAuto) scheduleAutoUpload("retry_failure");
            });
          });
          return;
        }

        var ok = (res && res.status === "success") || (res && res.already === true) || (res && res.ok === true && res.status === "success");
        if (ok) {
          try { poQueue[idx]._uploaded = true; } catch (e) {}

          photoDelMany(ids, function () {
            persistSnapshotNow(function () {
              uploadNextPending(pos + 1, pendingIdxs, isAuto);
            });
          });
        } else {
          persistSnapshotNow(function () {
            var msg = (res && res.message) ? res.message : "Unknown error";
            uiAlert("error", "Gagal", "Error pada " + label + ": " + msg, function () {
              setUILock(false);
              var ov = $("ov");
              if (ov) ov.classList.add("ov-hidden");
              OV.open = false;
              if (isAuto) scheduleAutoUpload("retry_after_error");
            });
          });
        }
      });
    });
  }

// =============================
  // HISTORY & SEARCH (GAS)
  // =============================
  function safeTime(x) {
    try {
      var t = new Date(x);
      return isNaN(t.getTime()) ? String(x || "") : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return String(x || ""); }
  }
  
  function safeDate(x) {
    try {
      var t = new Date(x);
      return isNaN(t.getTime()) ? String(x || "") : t.toLocaleDateString("id-ID", { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return String(x || ""); }
  }

  function apiGet(action, params, cb) {
    if (!hasApi()) return cb && cb(new Error("Missing config.js GAS_API_URL / API_KEY"));

    params = params || {};
    params.action = action;
    params.key = API_KEY;

    var qs = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])));
    }

    var url = GAS_API_URL + (GAS_API_URL.indexOf("?") >= 0 ? "&" : "?") + qs.join("&");

    fetch(url, { method: "GET", mode: "cors", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb && cb(null, j); })
      .catch(function (e) { cb && cb(e); });
  }

  // --- RENDERING GIT DATA (Card Style) ---
  function renderGitItem(item) {
    // Parse Material JSON
    var matListHtml = "";
    try {
      var mats = JSON.parse(item.material_json || "[]");
      if (Array.isArray(mats) && mats.length > 0) {
        matListHtml = '<div class="mt-2 space-y-1">';
        for (var i = 0; i < mats.length; i++) {
          var m = mats[i];
          matListHtml += 
            '<div class="text-[10px] bg-slate-50 border border-slate-100 p-1.5 rounded flex justify-between">' +
            '  <span class="font-semibold text-slate-700">' + escapeHtml(m.material || "-") + '</span>' +
            '  <span class="font-mono text-slate-500">' + (m.qtyConfirmed || 0) + ' ' + (m.unit || "") + '</span>' +
            '</div>';
        }
        matListHtml += '</div>';
      }
    } catch (e) {
      matListHtml = '<div class="text-[10px] text-red-400 italic mt-1">Error parse material</div>';
    }

    // Parse Photos (Gabung foto_material + foto_sjv)
    var photoHtml = "";
    var ids = [];
    if (item.foto_material) ids = ids.concat(item.foto_material.split(","));
    if (item.foto_sjv) ids = ids.concat(item.foto_sjv.split(","));
    
    // Filter empty
    ids = ids.filter(function(x){ return x && x.trim().length > 5 });

    if (ids.length > 0) {
      photoHtml = '<div class="mt-2 flex gap-1 overflow-x-auto pb-1">';
      for (var j=0; j<ids.length; j++) {
        var pid = ids[j].trim();
        var thumb = "https://lh3.googleusercontent.com/d/" + pid + "=s100";
        // Onclick trigger lightbox
        // Note: Kita butuh closure atau cara pass ID
        photoHtml += 
          '<img src="' + thumb + '" class="w-10 h-10 rounded object-cover border border-slate-200 flex-shrink-0 bg-slate-100" ' +
          'onclick="window.openLightbox(\'' + pid + '\')">';
      }
      photoHtml += '</div>';
    }

    return '' +
      '<div class="bg-white p-3 rounded-xl border border-blue-100 shadow-sm mb-3">' +
      '  <div class="flex justify-between items-start">' +
      '    <div>' +
      '      <div class="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded inline-block mb-1">DATA SRM</div>' +
      '      <div class="text-xs font-bold text-slate-800">' + escapeHtml(item.vendor_name || "Vendor Unknown") + '</div>' +
      '      <div class="text-[10px] text-slate-500 font-mono mt-0.5">PO: ' + escapeHtml(item.po_number) + '</div>' +
      '    </div>' +
      '    <div class="text-right">' +
      '      <div class="text-[10px] text-slate-400">' + safeDate(item.timestamp) + '</div>' +
      '      <div class="text-[9px] font-mono text-slate-400">' + escapeHtml(item.git_number || "") + '</div>' +
      '    </div>' +
      '  </div>' +
       matListHtml +
       photoHtml +
      '</div>';
  }

  // --- RENDERING FOTO BIASA ---
  function renderPhotoItem(row) {
    // row: [0]ID, [1]ID_FOTO, [2]KATEGORI, [3]PO, [4]GIT, [5]PIC, [6]KET, [7]TIME, ...
    var idFoto = row[1];
    var thumb = "https://lh3.googleusercontent.com/d/" + idFoto + "=s100";

    // Fix: beberapa data menyimpan kategori ganda (mis. "MATERIAL,MATERIAL").
    // Tampilkan hanya 1 kategori untuk 1 gambar.
    var rawCat = (row && row[2]) ? String(row[2]) : "";
    var cat = "FOTO";
    if (rawCat) {
      var parts = rawCat.split(/[,|;]+/).map(function (s) { return (s || "").trim(); }).filter(Boolean);
      if (parts.length) {
        // ambil kategori pertama yang tidak kosong
        cat = parts[0];
      }
    }

    return '' +
      '<div class="bg-white p-2 rounded-lg border border-slate-200 shadow-sm flex gap-3 items-center mb-2">' +
      '  <img src="' + thumb + '" class="w-12 h-12 rounded object-cover cursor-pointer bg-slate-100" ' +
      '       onclick="window.openLightbox(\'' + idFoto + '\')">' +
      '  <div class="flex-1 min-w-0">' +
      '    <div class="flex justify-between">' +
      '       <div class="text-xs font-bold text-slate-700 truncate">PO: ' + (row[3] || "-") + '</div>' +
      '       <div class="text-[9px] bg-slate-100 px-1 rounded text-slate-500 h-fit">' + cat + '</div>' +
      '    </div>' +
      '    <div class="text-[10px] text-slate-500 truncate">' + (row[6] || "Tanpa Keterangan") + '</div>' +
      '    <div class="text-[9px] text-slate-400 font-mono mt-0.5">' + safeDate(row[7]) + '</div>' +
      '  </div>' +
      '</div>';
  }

  // Helper global untuk onclick string HTML
  window.openLightbox = function(id) {
    lbShow(["https://lh3.googleusercontent.com/d/" + id + "=s0"], 0);
  };

  function doSearch() {
    var qEl = $("search-input");
    var res = $("search-results");
    if (!qEl || !res) return;
    
    var rawQ = (qEl.value || "").trim();
    if (!rawQ) return;

    // --- NORMALISASI INPUT (Fitur Baru) ---
    // Menggunakan currentPOMode yang tersimpan di state aplikasi
    var normalizedQ = normalizePOWithMode(currentPOMode || "std", rawQ);
    
    // Update input UI biar user sadar auto-formatnya
    qEl.value = normalizedQ;
    
    res.innerHTML = 
      '<div class="text-center text-xs text-slate-400 mt-8">' + 
      '  <svg class="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500"><use href="#ic-spin"></use></svg>' +
      '  Mencari <b>' + escapeHtml(normalizedQ) + '</b> di FOTO & GIT...' +
      '</div>';

    apiGet("searchByPO", { q: normalizedQ }, function (err, json) {
      res.innerHTML = "";
      
      if (err) {
        res.innerHTML = '<div class="text-center text-xs text-red-400 mt-4">Gagal terhubung server.</div>';
        return;
      }

      var data = (json && json.data) ? json.data : {};
      var gits = data.git || [];
      var photos = data.photos || [];

      // Fallback legacy (jika API masih return array flat lama)
      if (Array.isArray(json.data) || Array.isArray(json)) {
        photos = Array.isArray(json.data) ? json.data : json;
        gits = []; 
      }

      if (gits.length === 0 && photos.length === 0) {
        res.innerHTML = 
          '<div class="text-center mt-10">' +
          '  <div class="text-4xl mb-2">🤷‍♂️</div>' +
          '  <div class="text-sm font-bold text-slate-600">Tidak ditemukan</div>' +
          '  <div class="text-xs text-slate-400">PO ' + escapeHtml(normalizedQ) + ' tidak ada di data FOTO maupun GIT.</div>' +
          '</div>';
        return;
      }

      var html = "";

      // 1. Render Hasil GIT
      if (gits.length > 0) {
        html += '<div class="mb-2 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data SRM / GIT (' + gits.length + ')</div>';
        for (var i = 0; i < gits.length; i++) {
          html += renderGitItem(gits[i]);
        }
        html += '<div class="h-4"></div>'; // spacer
      }

      // 2. Render Hasil FOTO
      if (photos.length > 0) {
        html += '<div class="mb-2 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Riwayat Foto App (' + photos.length + ')</div>';
        for (var k = 0; k < photos.length; k++) {
          html += renderPhotoItem(photos[k]);
        }
      }

      res.innerHTML = html;
    });
  }

  function loadData(force) {
     // ... kode loadData yang lama tetap sama (tidak perlu diubah untuk request ini) ...
     // ... biarkan seperti di file asli ...
    var container = $("history-list");
    if (!container) return;

    container.innerHTML =
      '<div class="p-4 text-center text-xs text-slate-400">' +
      '  <span class="inline-flex items-center gap-2">' +
      '    <svg class="w-4 h-4 text-slate-500 animate-spin"><use href="#ic-spin"></use></svg>' +
      "    <span>Memuat...</span>" +
      "  </span>" +
      "</div>";

    // Riwayat: ambil dari sheet PENDING_MATERIAL (tanpa filter) dan tampilkan 50 data.
    apiGet("getPendingFotoMaterial", {}, function (err, data) {
      container.innerHTML = "";
      if (err) {
        container.innerHTML = '<div class="p-4 text-center text-xs text-red-400">Gagal memuat.</div>';
        return;
      }
      var rows = (data && data.data && data.ok) ? data.data : data;
      if (!rows || !rows.length) {
        container.innerHTML = '<div class="p-4 text-center text-xs text-slate-300">Kosong.</div>';
        return;
      }
      var max = 50;
      var n = Math.min(rows.length, max);
      for (var i = 0; i < n; i++) {
        container.innerHTML += renderPhotoItem(rows[i]);
      }
    });
  }

  // =============================
  // OPTIONAL TOGGLE
  // =============================
  function toggleOptional() {
    if (uiLocked) return;
    var el = $("optional-fields");
    if (el) el.classList.toggle("hidden");
    saveStateDebounced();
  }

  // =============================
  // BUILD EVENTS + INIT
  // =============================
  function setupAutosaveListeners() {
    var po = $("inp-po");
    var git = $("inp-git");
    var pic = $("inp-pic");
    var ket = $("inp-ket");

    if (po) {
      on(po, "input", saveStateDebounced);
      on(po, "blur", function () { normalizeCurrentPOInput(); saveStateDebounced(); });
      on(po, "keydown", function (e) {
        var k = e && e.key ? e.key : "";
        if (k === "Enter") {
          try { e.preventDefault(); } catch (ex) {}
          normalizeCurrentPOInput();
          saveStateDebounced();
        }
      });
    }

    if (git) on(git, "input", saveStateDebounced);
    if (pic) on(pic, "change", saveStateDebounced);
    if (ket) on(ket, "input", saveStateDebounced);

    window.addEventListener("pagehide", function () { persistSnapshotNow(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") persistSnapshotNow();
    });
  }

  function maybeAutoUploadOnOnline() {
    try {
      if (!uploadArmed) return;
      if (uiLocked) return;
      if (autoUploadBusy) return;
      if (!navigator.onLine) return;

      var pending = 0;
      for (var i = 0; i < poQueue.length; i++) {
        if (!poQueue[i]._uploaded) pending++;
      }

      if (pending === 0) {
        uploadArmed = false;
        persistSnapshotNow();
        return;
      }

      autoUploadBusy = true;
      showToast("info", "Online lagi. Melanjutkan upload...");
      uploadAll(true);
    } catch (e) {}
  }

  function bindUi() {
    // menu
    on($("btn-menu"), "click", function (e) { try { e.preventDefault(); } catch (x) {} toggleMenu(); });
    on($("main-menu"), "click", function () { closeMenu(); });
    on($("nav-form"), "click", function (e) { e.stopPropagation(); navigate("form"); });
    on($("nav-data"), "click", function (e) { e.stopPropagation(); navigate("data"); });
    on($("nav-search"), "click", function (e) { e.stopPropagation(); navigate("search"); });

    // overlay buttons
    on($("ovX"), "click", function () { ovClose(false); });
    on($("ovCancel"), "click", function () { ovClose(false); });
    on($("ovOk"), "click", function () { ovClose(true); });

    // toast close
    on($("toastClose"), "click", hideToast);

    // lightbox controls
    on($("lb-backdrop"), "click", lbClose);
    on($("lb-close"), "click", lbClose);
    on($("lb-prev"), "click", lbPrev);
    on($("lb-next"), "click", lbNext);

    // optional toggle
    on($("btn-plus-meta"), "click", function (e) { try { e.preventDefault(); } catch (x) {} toggleOptional(); });

    // mode buttons
    on($("mode-std"), "click", function () { setPOMode("std", true); });
    on($("mode-SL3"), "click", function () { setPOMode("SL3", true); });
    on($("mode-SRG"), "click", function () { setPOMode("SRG", true); });
    on($("mode-PML"), "click", function () { setPOMode("PML", true); });
    on($("mode-BYS"), "click", function () { setPOMode("BYS", true); });

    // camera
    on($("btn-camera"), "click", function () { triggerCamera(); });
    on($("camera-input"), "change", handleFileSelect);

    // type modal
    on($("type-modal-backdrop"), "click", closeTypeModal);
    on($("btn-type-close"), "click", closeTypeModal);
    on($("btn-type-cancel"), "click", closeTypeModal);
    on($("btn-type-sj"), "click", function () { pickTypeAndOpen("SJ"); });
    on($("btn-type-koli"), "click", function () { pickTypeAndOpen("KOLI"); });
    on($("btn-type-material"), "click", function () { pickTypeAndOpen("MATERIAL"); });

    // actions
    on($("btn-save"), "click", function () { saveDraft(false); });
    on($("btn-addpo"), "click", function () { focusAddPO(); });
    on($("btn-upload"), "click", function () { uploadAll(false); });

    // reset
    on($("btn-reset-all"), "click", confirmResetAll);

    // history
    on($("btn-refresh"), "click", function () { loadData(true); });

    // search
    on($("btn-search"), "click", doSearch);
    on($("search-input"), "keydown", function (e) {
      var k = e && e.key ? e.key : "";
      if (k === "Enter") { try { e.preventDefault(); } catch (x) {} doSearch(); }
    });
  }

  // =============================
  // INIT ON LOAD
  // =============================
  window.addEventListener("load", function () {
    previewSkeletonEl = $("preview-skeleton");

    bindUi();

    // Set default mode styles
    setPOMode("std", false);

    restoreSnapshot(function (restored) {
      if (!restored) {
        setPOMode("std", false);
        renderPOList();
        updatePreviewUI();
        refreshStats();
      }
      setupAutosaveListeners();

      window.addEventListener("online", function () {
        autoUploadBusy = false;
        maybeAutoUploadOnOnline();
      });

      setTimeout(function () {
        autoUploadBusy = false;
        maybeAutoUploadOnOnline();
      }, 400);
    });

    // quick hint if config missing
    if (!hasApi()) {
      showToast("warning", "Config API belum ada. Pastikan Netlify env: GAS_API_URL + API_KEY.");
    }
  });

})();





