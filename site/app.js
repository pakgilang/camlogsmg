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
  // CONFIG (from /config.js & localStorage settings)
  // =============================
  var CFG = window.__APP_CONFIG__ || window.__CONFIG__ || {};
  var GAS_API_URL = localStorage.getItem("SMG_SET_GAS_URL") || (CFG.GAS_API_URL || "").trim();
  var API_KEY = localStorage.getItem("SMG_SET_API_KEY") || (CFG.API_KEY || "").trim();
  var HISTORY_LIMIT = parseInt(localStorage.getItem("SMG_SET_HISTORY_LIMIT"), 10) || 50;
  var APP_THEME = localStorage.getItem("SMG_SET_APP_THEME") || "default";

  function applyTheme(theme) {
    var classes = document.body.className.split(" ").filter(function (c) {
      return c && c.indexOf("theme-") !== 0;
    });
    if (theme && theme !== "default") {
      classes.push("theme-" + theme);
    }
    document.body.className = classes.join(" ").trim();

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var colors = {
        "default": "#f8fafc",
        "apple": "#f5f5f7",
        "supabase": "#121212",
        "facebook": "#f0f2f5"
      };
      meta.setAttribute("content", colors[theme] || "#f8fafc");
    }
  }

  function hasApi() {
    return window.SMGUploader.hasApi();
  }

  function apiPost(action, data, cb) {
    window.SMGUploader.apiPost(action, data, cb);
  }

  function apiGet(action, params, cb) {
    window.SMGUploader.apiGet(action, params, cb);
  }

   function getActiveUser() {
     try {
       var u = localStorage.getItem("SMG_ACTIVE_USER") || "";
       u = (u || "").trim();
       return u ? u : "GUEST";
     } catch (e) {
       return "GUEST";
     }
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
    var views = ["form", "data", "search", "settings"];
    for (var i = 0; i < views.length; i++) {
      var v = $("view-" + views[i]);
      if (v) v.classList.add("hidden");
    }
    var target = $("view-" + viewId);
    if (target) target.classList.remove("hidden");

    // highlight active bottom-nav icon
    setActiveNav(viewId);

    if (viewId === "data") loadData(true);
    if (viewId === "settings") loadSettingsToUI();
  }

  // =============================
  
  // Bottom nav active highlight (4 icon)
  function setActiveNav(viewId) {
    var map = {
      "form": "nav-form-icon",
      "data": "nav-data-icon",
      "search": "nav-search-icon",
      "settings": "nav-settings-icon"
    };
    var keys = ["form", "data", "search", "settings"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var btn = $(map[k]);
      if (!btn) continue;

      var active = (k === viewId);
      if (active) {
        btn.className =
          "w-11 h-11 rounded-xl border border-indigo-600 bg-indigo-50 " +
          "flex items-center justify-center active:scale-95 transition duration-200";
      } else {
        btn.className =
          "w-11 h-11 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 " +
          "flex items-center justify-center active:scale-95 transition duration-200";
      }

      // switch icon color
      var svg = btn.querySelector("svg");
      if (svg) svg.setAttribute("class", active ? "w-5 h-5 text-indigo-600" : "w-5 h-5 text-slate-500");
    }
  }

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
      icon.className = "w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center";
      setSvgUse(icon, "#ic-check", "text-emerald-600");
    } else if (type === "warning") {
      icon.className = "w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center";
      setSvgUse(icon, "#ic-warn", "text-amber-650");
    } else if (type === "error") {
      icon.className = "w-8 h-8 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center";
      setSvgUse(icon, "#ic-warn", "text-rose-650");
    } else {
      icon.className = "w-8 h-8 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center";
      setSvgUse(icon, "#ic-info", "text-slate-600");
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

  function openDiagPanel() {
    var D = window.SMGDiag || null;
    var logs = [];
    try { logs = D && D.get ? D.get() : []; } catch (e) { logs = []; }
    var tail = logs.slice(Math.max(0, logs.length - 3));

    var summary = {
      time: (function () { try { return new Date().toISOString(); } catch (e0) { return String(Date.now()); } })(),
      online: (function () { try { return !!navigator.onLine; } catch (e1) { return false; } })(),
      processingCount: processingCount || 0,
      capturedCount: capturedFiles ? capturedFiles.length : 0,
      queueCount: poQueue ? poQueue.length : 0,
      swCache: (function () { try { return (window.__SW_CACHE__ || ""); } catch (e2) { return ""; } })()
    };

    var txt = "";
    for (var i = 0; i < tail.length; i++) {
      try { txt += JSON.stringify(tail[i]) + "\n"; } catch (e3) {}
    }
    if (!txt) txt = "(log kosong)";

    var html = '' +
      '<div class="space-y-3">' +
      '  <div class="text-[11px] text-slate-600">' +
      '    <div><b>Online</b>: ' + (summary.online ? "YA" : "TIDAK") + '</div>' +
      '    <div><b>Foto draft</b>: ' + summary.capturedCount + ' | <b>Queue</b>: ' + summary.queueCount + ' | <b>Proses</b>: ' + summary.processingCount + '</div>' +
      '  </div>' +
      '  <div class="flex gap-2">' +
      '    <button id="diag-copy" type="button" class="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold active:scale-95">Copy Log</button>' +
      '    <button id="diag-clear" type="button" class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold active:scale-95">Clear</button>' +
      '  </div>' +
      '  <pre class="text-[10px] leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-2 max-h-64 overflow-auto whitespace-pre-wrap">' + escapeHtml(txt) + '</pre>' +
      '</div>';

    ovShow({ mode: "alert", icon: "info", title: "Diagnostik", sub: "Log ringkas (3 terakhir)", bodyHtml: html, okText: "Tutup", allowClose: true });

    setTimeout(function () {
      var bCopy = $("diag-copy");
      var bClear = $("diag-clear");
      on(bCopy, "click", function () {
        if (!D || !D.copy) { showToast("warning", "Diag belum siap."); return; }
        D.copy({ summary: summary }, function (err) {
          if (err) showToast("error", "Gagal copy log.");
          else showToast("success", "Log tersalin.");
        });
      });
      on(bClear, "click", function () {
        if (D && D.clear) D.clear();
        showToast("success", "Log dibersihkan.");
        ovClose(true);
      });
    }, 0);
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
      body.innerHTML = '<div class="text-sm text-slate-350">' + escapeHtml(opts.text || "") + "</div>";
    }

    var ic = opts.icon || "info";
    if (ic === "success") {
      icon.className = "w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center";
      setSvgUse(icon, "#ic-check", "text-emerald-400");
    } else if (ic === "warning") {
      icon.className = "w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center";
      setSvgUse(icon, "#ic-warn", "text-amber-400");
    } else if (ic === "error") {
      icon.className = "w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center";
      setSvgUse(icon, "#ic-warn", "text-rose-400");
    } else {
      icon.className = "w-8 h-8 rounded-xl bg-slate-800 border border-slate-750 flex items-center justify-center";
      setSvgUse(icon, "#ic-info", "text-slate-350");
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

  var LB = window.SMGLightbox || null;
  function lbShow(items, startIndex, meta) { try { if (LB && LB.show) LB.show(items, startIndex, meta); } catch (e) {} }
  function lbClose() { try { if (LB && LB.close) LB.close(); } catch (e) {} }
  function lbPrev() { try { if (LB && LB.prev) LB.prev(); } catch (e) {} }
  function lbNext() { try { if (LB && LB.next) LB.next(); } catch (e) {} }

  // =============================
  // STATE + SETTINGS
  // =============================
  var currentCategory = "MATERIAL"; // fixed for MVP
  var capturedFiles = [];          // { id, dataUrl, sizeKb, jenis }
  var poQueue = [];                // { kategori,no_po,git_number,pic_po,keterangan,image_ids[],photo_types[],sizes[],total_kb,po_mode,upload_id,_uploaded,status_upload_ke_srm }
  var editingIndex = -1;          // index poQueue yang sedang diedit ke FORM (-1 = tidak edit)
  var previewSkeletonEl = null;

  // Search tab filter state
  var searchFilter = "all"; // all | git | foto

  var MAX_WIDTH = parseInt(localStorage.getItem("SMG_SET_MAX_WIDTH"), 10) || 1000;
  var JPEG_QUALITY_START = parseFloat(localStorage.getItem("SMG_SET_QUALITY_START")) || 0.9;
  var TARGET_KB = parseInt(localStorage.getItem("SMG_SET_TARGET_KB"), 10) || 60;
  var CAMERA_SOURCE = localStorage.getItem("SMG_SET_CAMERA_SOURCE") || "camera";
  var processingCount = 0;
  var uiLocked = false;
  var COMP = window.SMGCompress || {};
  try { if (COMP.setConfig) COMP.setConfig({ maxWidth: MAX_WIDTH, qualityStart: JPEG_QUALITY_START, targetKb: TARGET_KB, diag: window.SMGDiag || null }); } catch (e0) {}
  function smartCompress(canvas) { return (COMP.smartCompress ? COMP.smartCompress(canvas) : { dataUrl: canvas.toDataURL("image/jpeg", 0.85), sizeKb: 0 }); }
  function compressCanvasAsync(canvas, cb) { return (COMP.compressCanvasAsync ? COMP.compressCanvasAsync(canvas, cb) : cb(new Error("no_compressor"))); }
  function compressFileAsync(file, cb) { return (COMP.compressFileAsync ? COMP.compressFileAsync(file, cb) : cb(new Error("no_compressor"))); }

  // Upload opt-in
  var uploadArmed = false;
  var autoUploadBusy = false;

  // PO Mode
  var currentPOMode = "std";
  var searchPOMode = "std";
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
  var SAVE_TIMER = null;
  var RESTORING = false;
  var STORAGE = window.SMGStorage || {};
  function kvGet(key, cb) { return STORAGE.kvGet ? STORAGE.kvGet(key, cb) : cb && cb("no storage"); }
  function kvPut(key, val, cb) { return STORAGE.kvPut ? STORAGE.kvPut(key, val, cb) : cb && cb("no storage"); }
  function kvDel(key, cb) { return STORAGE.kvDel ? STORAGE.kvDel(key, cb) : cb && cb("no storage"); }
  function photoPut(id, dataUrl, cb) { return STORAGE.photoPut ? STORAGE.photoPut(id, dataUrl, cb) : cb && cb("no storage"); }
  function photoGet(id, cb) { return STORAGE.photoGet ? STORAGE.photoGet(id, cb) : cb && cb("no storage"); }
  function photoDel(id, cb) { return STORAGE.photoDel ? STORAGE.photoDel(id, cb) : cb && cb("no storage"); }
  function photoGetMany(ids, cb) { return STORAGE.photoGetMany ? STORAGE.photoGetMany(ids, cb) : cb && cb("no storage"); }
  function photoDelMany(ids, cb) { return STORAGE.photoDelMany ? STORAGE.photoDelMany(ids, cb) : cb && cb("no storage"); }

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

  function persistSnapshotNow(cb) {
    window.SMGStore.persistState(function (err) {
      if (!err && !RESTORING) showDraftSaved();
      if (cb) cb(err || null);
    });
  }

  function saveStateDebounced() {
    var formState = getFormState();
    window.SMGStore.updateFormState(formState, true);
  }

  function clearPersistedState(cb) {
    window.SMGStorage.clearAppState(cb);
  }

  function restoreSnapshot(cb) {
    RESTORING = true;
    window.SMGStore.loadState(function (err, loadedState) {
      RESTORING = false;
      if (err || !loadedState) {
        return cb && cb(false);
      }

      setPOMode(loadedState.currentPOMode || "std", false);
      applyFormState(loadedState.form || null);

      cb && cb(true);
    });
  }

  // =============================
  // UI LOCK
  // =============================
  function setUILock(lock) {
    uiLocked = lock ? true : false;

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
  // PO NORMALIZER DELEGATES
  // =============================
  function digitsOnly(val) { return window.SMGNormalizer.digitsOnly(val); }
  function stripKnownLocationPrefix(digits) { return window.SMGNormalizer.stripKnownLocationPrefix(digits); }
  function force4DigitsSuffix(d) { return window.SMGNormalizer.force4DigitsSuffix(d); }
  function normalizePOWithMode(mode, raw) { return window.SMGNormalizer.normalizePOWithMode(mode, raw); }

  function normalizeCurrentPOInput() {
    var poEl = $("inp-po");
    if (!poEl) return;
    poEl.value = normalizePOWithMode(currentPOMode, poEl.value);
  }

  function setPOMode(mode, shouldNormalizeNow) {
    window.SMGStore.setPOMode(mode);

    var keys = ["std", "SL3", "SRG", "PML", "BYS", "KM8/9"];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var id = (key === "std") ? "mode-std" : (key === "KM8/9" ? "mode-KM8" : "mode-" + key);
      var b = $(id);
      if (!b) continue;

      if (keys[i] === currentPOMode) {
        b.className =
          "flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold flex items-center " +
          "justify-center gap-2 bg-indigo-600 text-white shadow shadow-indigo-600/30";
      } else {
        b.className =
          "flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold flex items-center " +
          "justify-center gap-2 text-slate-400 hover:text-slate-200 " +
          "hover:bg-slate-850 transition duration-200";
      }
    }

    if (shouldNormalizeNow) normalizeCurrentPOInput();
  }

  function normalizeSearchInput() {
    var qEl = $("search-input");
    if (!qEl) return;
    qEl.value = normalizePOWithMode(searchPOMode, qEl.value);
  }

  function setSearchPOMode(mode, shouldNormalizeNow) {
    searchPOMode = mode || "std";

    var keys = ["std", "SL3", "SRG", "PML", "BYS", "KM8/9"];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var id = (key === "KM8/9") ? "search-mode-KM8" : "search-mode-" + key;
      var b = $(id);
      if (!b) continue;

      if (keys[i] === searchPOMode) {
        b.className =
          "flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold flex items-center " +
          "justify-center gap-2 bg-indigo-600 text-white shadow shadow-indigo-600/30";
      } else {
        b.className =
          "flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold flex items-center " +
          "justify-center gap-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition duration-200";
      }
    }

    if (shouldNormalizeNow) {
      normalizeSearchInput();
      doSearch();
    }
  }

  function displayModeLabel(m) {
    if (m === "std") return "CPJF";
    if (m === "BYS") return "BYS/KBM";
    return m;
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
    if (inp) {
      if (CAMERA_SOURCE === "gallery") {
        inp.removeAttribute("capture");
      } else {
        inp.setAttribute("capture", "environment");
      }
      inp.click();
    }
  }

  function makePhotoId() {
    return "PH_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  function processImage(file, jenis) {
    var id = makePhotoId();
    var tipe = (jenis || "MATERIAL");

    function done(err, packed) {
      if (err || !packed || !packed.dataUrl) {
        processingCount = Math.max(0, processingCount - 1);
        updatePreviewUI();
        showToast("error", "Gagal proses gambar.");
        return;
      }
      window.SMGStore.addPhoto(id, packed.dataUrl, packed.sizeKb, tipe, function () {
        processingCount = Math.max(0, processingCount - 1);
        updatePreviewUI();
      });
    }
    compressFileAsync(file, function (err2, packed2) {
      done(err2, packed2);
    });
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

  function getPhotoPairs(ids, cb) {
    ids = ids || [];
    photoGetMany(ids, function (err, arr) {
      if (err) return cb && cb(err);
      var out = [];
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var url = arr && arr[i] ? arr[i] : "";
        if (id && url) out.push({ id: id, url: url });
      }
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
    var btnCam = $("btn-camera");
    var proc = $("processing-toast");
    var procMsg = $("processing-msg");

    if (proc) {
      if (processingCount > 0) {
        proc.classList.remove("hidden");
        if (procMsg) procMsg.innerText = "Mengompres (" + processingCount + ")...";
      } else {
        proc.classList.add("hidden");
      }
    }
    if (!strip) return;

    clearEl(strip);

    if (capturedFiles.length === 0) {
      if (previewSkeletonEl) strip.appendChild(previewSkeletonEl);
      if (countEl) countEl.classList.add("hidden");
      if (totalEl) totalEl.classList.add("hidden");
      setEnabled(btnSave, false);
      // ADD PO selalu aktif: klik untuk fokus ke input PO NUMBER
      setEnabled(btnAdd, true);
      setEnabled(btnCam, processingCount === 0);
      return;
    }

    setEnabled(btnSave, processingCount === 0);
    // ADD PO selalu aktif (meski ada/tidak ada foto)
    setEnabled(btnAdd, true);
    setEnabled(btnCam, processingCount === 0 && capturedFiles.length < 10);

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
          "relative w-24 h-24 rounded-xl overflow-hidden border border-slate-800 " +
          "shadow-sm bg-slate-900 flex-shrink-0";

        var im = document.createElement("img");
        im.src = f.dataUrl || "";
        im.className = "w-full h-full object-cover cursor-pointer";
        im.setAttribute("role", "button");
        im.setAttribute("tabindex", "0");
        im.setAttribute("alt", "Pratinjau foto draft");
        im.onclick = function () { previewDraft(idx); };
        wrap.appendChild(im);

        var jb = document.createElement("div");
        jb.className =
          "absolute top-1 left-1 bg-slate-950/85 text-white text-[9px] " +
          "px-1.5 py-0.5 rounded backdrop-blur-sm font-extrabold border border-white/5";
        jb.innerText = (f.jenis || "MATERIAL");
        wrap.appendChild(jb);

        var btn = document.createElement("button");
        btn.className =
          "absolute top-1 right-1 w-5 h-5 bg-rose-600 text-white rounded-full " +
          "flex items-center justify-center text-[10px] shadow active:scale-95";
        btn.onclick = function () { removeDraftPhoto(idx); };
        btn.innerHTML =
          '<svg class="w-3.5 h-3.5 text-white">' +
          '  <use href="#ic-x"></use>' +
          "</svg>";
        wrap.appendChild(btn);

        var badge = document.createElement("div");
        badge.className =
          "absolute bottom-1 left-1 bg-slate-950/85 text-slate-300 text-[9px] " +
          "px-1.5 py-0.5 rounded backdrop-blur-sm";
        badge.innerText = (f.sizeKb || 0) + " KB";
        wrap.appendChild(badge);

        strip.appendChild(wrap);
      })(k);
    }
  }

  function recalcQueueTotalKb(p) {
    if (!p) return 0;
    var total = 0;
    var sizes = p.sizes || [];
    for (var i = 0; i < sizes.length; i++) total += (sizes[i] || 0);
    p.total_kb = total;
    return total;
  }

  function onLightboxSaved(meta, photoId, dataUrl, sizeKb) {
    if (!photoId) return;

    for (var i = 0; i < capturedFiles.length; i++) {
      if (capturedFiles[i] && capturedFiles[i].id === photoId) {
        capturedFiles[i].dataUrl = dataUrl || "";
        capturedFiles[i].sizeKb = sizeKb || 0;
      }
    }

    if (meta && meta.source === "queue" && meta.queueIndex >= 0 && poQueue[meta.queueIndex]) {
      var p = poQueue[meta.queueIndex];
      var ids = p.image_ids || [];
      var sizes = p.sizes || [];
      for (var j = 0; j < ids.length; j++) {
        if (ids[j] === photoId) {
          sizes[j] = sizeKb || 0;
          break;
        }
      }
      p.sizes = sizes;
      recalcQueueTotalKb(p);
      renderPOList();
      refreshStats();
      persistSnapshotNow();
    }

    updatePreviewUI();
    saveStateDebounced();
  }

  function removeDraftPhoto(i) {
    if (uiLocked) return;
    window.SMGStore.removePhoto(i);
  }

  function previewDraft(i) {
    var ids = [];
    var selectedId = (capturedFiles[i] && capturedFiles[i].id) ? capturedFiles[i].id : "";
    for (var k = 0; k < capturedFiles.length; k++) ids.push(capturedFiles[k].id);
    getPhotoPairs(ids, function (err, pairs) {
      if (err || !pairs.length) return;
      var items = [];
      var idList = [];
      for (var j = 0; j < pairs.length; j++) {
        items.push(pairs[j].url);
        idList.push(pairs[j].id);
      }
      var start = 0;
      for (var x = 0; x < idList.length; x++) if (idList[x] === selectedId) { start = x; break; }
      lbShow(items, start, { ids: idList, source: "draft", queueIndex: -1 });
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
      created_by: getActiveUser(),
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

  
  // =============================
  // EDIT -> KEMBALI KE FORM (bukan popup)
  // =============================
  function hydrateCapturedFilesFromDB(meta, cb) {
    meta = meta || [];
    var ids = [];
    for (var i = 0; i < meta.length; i++) {
      if (meta[i] && meta[i].id) {
        ids.push(meta[i].id);
      }
    }

    if (ids.length === 0) {
      capturedFiles = [];
      if (cb) cb();
      return;
    }

    photoGetMany(ids, function (err, arr) {
      if (err) {
        showToast("error", "Gagal memuat foto dari DB.");
      }

      capturedFiles = [];
      for (var i = 0; i < meta.length; i++) {
        var m = meta[i];
        if (!m) continue;
        var idx = ids.indexOf(m.id);
        var dataUrl = (idx >= 0 && arr && arr[idx]) ? arr[idx] : "";
        capturedFiles.push({
          id: m.id,
          dataUrl: dataUrl,
          sizeKb: m.sizeKb || 0,
          jenis: m.jenis || "MATERIAL"
        });
      }
      if (cb) cb();
    });
  }

  function sanitizeCapturedOnRestore() {
    if (!capturedFiles) {
      capturedFiles = [];
      return;
    }
    var clean = [];
    for (var i = 0; i < capturedFiles.length; i++) {
      var f = capturedFiles[i];
      if (f && f.id && f.dataUrl) {
        clean.push(f);
      }
    }
    capturedFiles = clean;
  }

  function updateEditBanner() {
    var bar = $("edit-banner");
    var label = $("edit-label");
    if (!bar) return;

    if (editingIndex >= 0 && poQueue[editingIndex]) {
      var p = poQueue[editingIndex];
      var txt = "EDIT: " + ((p && p.no_po) ? p.no_po : "PO");
      if (label) label.innerText = txt;
      bar.classList.remove("hidden");
    } else {
      bar.classList.add("hidden");
      if (label) label.innerText = "";
    }
  }

  function cancelEditMode(silent) {
    editingIndex = -1;
    updateEditBanner();
    if (!silent) showToast("info", "Mode edit dibatalkan.");
  }

  function startEditPOToForm(idx) {
    if (uiLocked) return;
    if (idx < 0 || idx >= poQueue.length) return;

    var p = poQueue[idx];
    if (!p) return;

    function proceed() {
      editingIndex = idx;
      updateEditBanner();

      // pindah ke FORM
      try { navigate("form"); } catch (e) {}

      // set mode & isi input
      setPOMode(p.po_mode || "std", false);

      var elPo = $("inp-po");
      var elGit = $("inp-git");
      var elPic = $("inp-pic");
      var elKet = $("inp-ket");
      if (elPo) elPo.value = p.no_po || "";
      if (elGit) elGit.value = p.git_number || "";
      if (elPic) elPic.value = p.pic_po || "";
      if (elKet) elKet.value = p.keterangan || "";

      // buka optional fields biar meta kelihatan saat edit
      var opt = $("optional-fields");
      if (opt) opt.classList.remove("hidden");

      // hydrate foto dari DB -> capturedFiles
      var meta = [];
      var ids = p.image_ids || [];
      var sizes = p.sizes || [];
      var types = p.photo_types || [];
      for (var i = 0; i < ids.length; i++) {
        meta.push({
          id: ids[i],
          sizeKb: sizes[i] || 0,
          jenis: types[i] || "MATERIAL"
        });
      }

      hydrateCapturedFilesFromDB(meta, function () {
        sanitizeCapturedOnRestore();
        updatePreviewUI();
        refreshStats();
        saveStateDebounced();
        showToast("info", "Mode edit aktif. Ubah data lalu klik SIMPAN untuk update.");
        focusPrimary();
      });
    }

    // Jika user sedang pegang draft lain, jangan timpa diam-diam
    if (capturedFiles && capturedFiles.length > 0) {
      uiConfirm(
        "Ganti ke Edit PO?",
        "Draft foto yang sedang aktif akan diganti dengan foto dari PO yang dipilih.",
        "Ya, Lanjut Edit",
        function (ok) { if (ok) proceed(); }
      );
      return;
    }

    proceed();
  }

function saveDraft(startNew) {
    if (uiLocked) return;

    normalizeCurrentPOInput();

    var payload = getDraftPayload();
    if (!payload.upload_id) payload.upload_id = makeUploadId();

    var err = validateDraft(payload);
    if (err) { showToast("warning", err); return; }

    function proceedSave() {
      var targetIndex = editingIndex;

      if (targetIndex >= 0 && poQueue[targetIndex]) {
        var old = poQueue[targetIndex];

        // Pertahankan upload_id bila PO tidak berubah (idempotent).
        // Jika No PO berubah, reset upload_id dan tandai ulang sebagai belum ter-upload.
        payload.upload_id = old.upload_id || payload.upload_id || makeUploadId();
        payload._uploaded = !!old._uploaded;

        if ((old.no_po || "") !== (payload.no_po || "")) {
          payload.upload_id = makeUploadId();
          payload._uploaded = false;
        }

        // Keep existing status if any
        payload.status_upload_ke_srm = old.status_upload_ke_srm || payload.status_upload_ke_srm || "Pending";
      }

      window.SMGStore.savePO(payload, targetIndex, function () {
        if (targetIndex >= 0) {
          showToast("success", "PO berhasil diupdate.");
        } else {
          showToast("success", startNew ? "PO tersimpan. Lanjut input baru." : "PO tersimpan ke daftar.");
        }

        editingIndex = -1;

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

        updateEditBanner();

        if (startNew) {
          focusPrimary();
        } else {
          try {
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
          } catch (e) {}
        }

        if (navigator.onLine && uploadArmed) scheduleAutoUpload("after_save");
      });
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
        card.className = "bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden hover:border-slate-300 transition-all duration-200";

        var inner = document.createElement("div");
        inner.className = "p-3 flex items-center gap-3";

        var thumbBox = document.createElement("div");
        thumbBox.className =
          "w-12 h-12 rounded-lg bg-slate-50 border border-slate-200/60 overflow-hidden " +
          "flex items-center justify-center flex-shrink-0";

        var imgEl = document.createElement("img");
        imgEl.className = "w-full h-full object-cover hidden";
        thumbBox.appendChild(imgEl);

        var placeholder = document.createElement("div");
        placeholder.innerHTML = '<svg class="w-5 h-5 text-slate-400"><use href="#ic-image"></use></svg>';
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
        t2.className = "text-[10px] text-slate-455";
        t2.innerText = "MATERIAL" + modeLabel + gitLabel + " • " + fotoCount + " foto • " + kb + " KB";

        textWrap.appendChild(t1);
        textWrap.appendChild(t2);

        var del = document.createElement("button");
        del.className =
          "w-9 h-9 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 " +
          "flex items-center justify-center active:scale-95 hover:bg-rose-100/60 transition duration-150";
        del.innerHTML = '<svg class="w-5 h-5"><use href="#ic-trash"></use></svg>';
        del.onclick = function () { confirmDeletePO(idx); };

        topRow.appendChild(textWrap);
        topRow.appendChild(del);

        var btnRow = document.createElement("div");
        btnRow.className = "mt-2 grid grid-cols-3 gap-2";

        var b1 = document.createElement("button");
        b1.className =
          "bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-slate-700 " +
          "text-[11px] font-bold py-2 rounded-lg active:scale-95 transition duration-150";
        b1.innerHTML =
          '<span class="inline-flex items-center gap-1">' +
          '  <svg class="w-4 h-4"><use href="#ic-eye"></use></svg>' +
          "  <span>Lihat</span>" +
          "</span>";
        b1.onclick = function () { viewPO(idx); };

        var b2 = document.createElement("button");
        b2.className =
          "bg-amber-50 hover:bg-amber-100 border border-amber-100 text-amber-700 " +
          "text-[11px] font-bold py-2 rounded-lg active:scale-95 transition duration-150";
        b2.innerHTML =
          '<span class="inline-flex items-center gap-1">' +
          '  <svg class="w-4 h-4"><use href="#ic-pen"></use></svg>' +
          "  <span>Edit</span>" +
          "</span>";
        // Edit utama: balik ke FORM + foto (bukan popup)
        b2.onclick = function () { startEditPOToForm(idx); };

        var b3 = document.createElement("button");
        b3.className =
          "bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-slate-700 " +
          "text-[11px] font-bold py-2 rounded-lg active:scale-95 transition duration-150";
        b3.innerHTML =
          '<span class="inline-flex items-center gap-1">' +
          '  <svg class="w-4 h-4"><use href="#ic-hash"></use></svg>' +
          "  <span>Meta</span>" +
          "</span>";
        // Meta cepat (popup) tetap tersedia
        b3.onclick = function () { editPO(idx); };

        btnRow.appendChild(b1);
        btnRow.appendChild(b2);
        btnRow.appendChild(b3);
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
      window.SMGStore.deletePO(idx, function () {
        showToast("info", "PO dihapus.");
      });
    });
  }

  function viewPO(idx) {
    var p = poQueue[idx];
    var ids = (p && p.image_ids) ? p.image_ids.slice(0) : [];
    if (!ids.length) return;

    getPhotoPairs(ids, function (err, pairs) {
      if (err || !pairs.length) return;
      var items = [];
      var idList = [];
      for (var j = 0; j < pairs.length; j++) {
        items.push(pairs[j].url);
        idList.push(pairs[j].id);
      }
      lbShow(items, 0, { ids: idList, source: "queue", queueIndex: idx });
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
      { v: "BYS", t: "BYS/KBM" },
      { v: "KM8/9", t: "KM8/9" }
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

      var queue = JSON.parse(JSON.stringify(poQueue));
      if (queue[idx].no_po !== po) {
        queue[idx].upload_id = makeUploadId();
        queue[idx]._uploaded = false;
      }

      queue[idx].kategori = "MATERIAL";
      queue[idx].no_po = (po || "").trim();
      queue[idx].git_number = (git || "").trim();
      queue[idx].pic_po = pic || "";
      queue[idx].keterangan = (ket || "").trim();
      queue[idx].po_mode = mode || "std";

      window.SMGStore.updatePOQueue(queue, function () {
        showToast("success", "Meta diperbarui.");
      });
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
      window.SMGStore.resetAll(function () {
        showToast("info", "Daftar PO direset.");
      });
    });
  }

  // =============================
  // UPLOAD (Netlify -> GAS API)
  // =============================
  // apiPost is now delegated via window.SMGUploader.apiPost


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
      created_by: item.created_by || getActiveUser(),
      upload_id: item.upload_id || "",
      _uploaded: !!item._uploaded
    };
  }

  function uploadAll(isAuto) {
    if (uiLocked) return;

    if (!window.SMGUploader.hasApi()) {
      uiAlert("error", "Config belum siap", "GAS_API_URL / API_KEY belum terpasang di Netlify (config.js).", function(){});
      return;
    }

    if (!isAuto) {
      window.SMGStore.setUploadArmed(true, false);
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
        window.SMGStore.setUploadArmed(false, false);
        window.SMGStore.updatePOQueue([], function () {
          showToast("info", "Daftar dibersihkan.");
        });
      }
      return;
    }

    setUILock(true);
    uiProgressOpen(
      isAuto ? "AUTO UPLOAD" : "UPLOAD PO",
      "",
      buildUploadHtml(pending.length, !!isAuto)
    );

    window.SMGUploader.uploadAll(poQueue, {
      getPhotos: function (ids, cb) {
        window.SMGStorage.photoGetMany(ids, cb);
      },
      deletePhotos: function (ids, cb) {
        window.SMGStorage.photoDelMany(ids, cb);
      },
      onSaveState: function (cb) {
        window.SMGStore.persistState(cb);
      },
      onItemStart: function (item, index, total) {
        var label = item.no_po ? item.no_po : "PO";
        updateUploadUI(index, total, label, "ID: " + item.upload_id);
      },
      onItemSuccess: function (item, index, total) {
        // Automatically updated by StateStore subscription updates
      },
      onItemError: function (item, err, index, total) {
        // Handled in uploader onError
      },
      onStepUpdate: function (msg) {
        var txt = $("u_text");
        if (txt) txt.innerHTML = escapeHtml(msg);
      },
      onComplete: function (uploadedCount) {
        finalizeUploadUI();
        window.SMGStore.setUploadArmed(false, false);
        autoUploadBusy = false;

        window.SMGStore.updatePOQueue([], function () {
          uiAlert("success", "Selesai!", "Berhasil upload " + uploadedCount + " PO.", function () {
            setUILock(false);
            var ov = $("ov");
            if (ov) ov.classList.add("ov-hidden");
            OV.open = false;
          });
        });
      },
      onError: function (err) {
        autoUploadBusy = false;
        var msg = err ? err.message : "Unknown error";
        uiAlert("error", "Gagal", "Error saat upload: " + msg, function () {
          setUILock(false);
          var ov = $("ov");
          if (ov) ov.classList.add("ov-hidden");
          OV.open = false;
          if (isAuto) scheduleAutoUpload("retry_after_error");
        });
      }
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

  function safeDateTime(x) {
    if (x == null || x === "") return "";
    try {
      var t = new Date(x);
      if (isNaN(t.getTime())) return String(x || "");
      return t.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return String(x || "");
    }
  }

  // Ambil value dari object dengan beberapa kandidat key (support UPPER_SNAKE & lower_snake)
  function pickVal(obj, keys, def) {
    if (!obj || !keys) return def;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== "") return obj[k];
    }
    return def;
  }

  function toIdList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(function (x) { return String(x || "").trim(); }).filter(Boolean);
    var s = String(v || "").trim();
    if (!s) return [];
    // support JSON array string
    if (s.charAt(0) === "[" && s.charAt(s.length - 1) === "]") {
      try {
        var j = JSON.parse(s);
        if (Array.isArray(j)) return j.map(function (x) { return String(x || "").trim(); }).filter(Boolean);
      } catch (e) {}
    }
    return s.split(",").map(function (x) { return String(x || "").trim(); }).filter(Boolean);
  }

  function chip(label, value) {
    if (value == null || value === "") return "";
    return '<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">' +
      '<span class="text-slate-400">' + escapeHtml(label) + '</span>' +
      '<span class="text-slate-700 font-mono">' + escapeHtml(String(value)) + '</span>' +
      '</span>';
  }

  // apiGet is now delegated via window.SMGUploader.apiGet

  // --- RENDERING GIT DATA (Card Style) ---
  function renderGitItem(item) {
    // Support key format: UPPER_SNAKE (API v1.2) dan legacy lower_snake (searchByPO lama)
    var vendor = pickVal(item, ["VENDOR_NAME", "vendor_name"], "Vendor Unknown");
    var company = pickVal(item, ["COMPANY_NAME", "company_name"], "");
    var po = pickVal(item, ["PO_NUMBER", "po_number"], "");
    var git = pickVal(item, ["GIT_NUMBER", "git_number"], "");

    var sj = pickVal(item, ["SJ_NUMBER", "sj_number"], "");
    var truk = pickVal(item, ["TRUK_NUMBER", "truk_number"], "");
    var koli = pickVal(item, ["KOLI_NUMBER", "koli_number"], "");
    var jumlahKoli = pickVal(item, ["JUMLAH_KOLI", "jumlah_koli"], "");
    var pic = pickVal(item, ["PIC_PO", "pic_po"], "");

    var ts = pickVal(item, ["TIMESTAMP", "timestamp"], "");
    var tMasuk = pickVal(item, ["TGL_MASUK", "tgl_masuk"], "");
    var tKeluar = pickVal(item, ["TGL_KELUAR", "tgl_keluar"], "");
    var ket = pickVal(item, ["KETERANGAN", "keterangan"], "");

    // Materials: API v1.2 mengirim MATERIAL (obj/array). Legacy mengirim material_json (string)
    var matsVal = pickVal(item, ["MATERIAL", "material", "material_json"], null);
    var mats = [];
    try {
      if (Array.isArray(matsVal)) mats = matsVal;
      else if (matsVal && typeof matsVal === "object") mats = matsVal.items ? matsVal.items : (matsVal.materials || []);
      else if (typeof matsVal === "string") mats = JSON.parse(matsVal || "[]");
    } catch (e) { mats = null; }

    // Photos: API v1.2 FOTO_MATERIAL array, FOTO_SJV string/list. Legacy foto_material/foto_sjv string.
    var ids = [];
    ids = ids.concat(toIdList(pickVal(item, ["FOTO_MATERIAL", "foto_material"], [])));
    ids = ids.concat(toIdList(pickVal(item, ["FOTO_SJV", "foto_sjv"], [])));
    ids = ids.filter(function (x) { return x && x.trim().length > 5; });

    var metaLeft = '';
    metaLeft += '<div class="text-[11px] font-bold text-slate-800">' + escapeHtml(vendor) + '</div>';
    if (company) metaLeft += '<div class="text-[10px] text-slate-500">' + escapeHtml(company) + '</div>';
    metaLeft += '<div class="mt-1 flex flex-wrap gap-1">' +
      (po ? '<span class="text-[10px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-150/40">PO: ' + escapeHtml(po) + '</span>' : '') +
      (git ? '<span class="text-[10px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-150/40">GIT: ' + escapeHtml(git) + '</span>' : '') +
      '</div>';

    var metaRight = '';
    metaRight += '<div class="text-right">' +
      '<div class="text-[10px] text-slate-400">' + escapeHtml(safeDateTime(ts) || safeDate(ts)) + '</div>' +
      (tKeluar ? '<div class="text-[10px] text-emerald-700 font-semibold">Keluar: ' + escapeHtml(safeDate(tKeluar)) + '</div>' : (tMasuk ? '<div class="text-[10px] text-slate-500">Masuk: ' + escapeHtml(safeDate(tMasuk)) + '</div>' : '')) +
      '</div>';

    // chips ringkas
    var chips = '';
    var c = [];
    if (sj) c.push(['SJ', sj]);
    if (truk) c.push(['TRUK', truk]);
    if (koli) c.push(['KOLI', koli]);
    if (jumlahKoli) c.push(['JML', jumlahKoli]);
    if (pic) c.push(['PIC', pic]);
    if (c.length) {
      chips += '<div class="mt-2 flex flex-wrap gap-1">';
      for (var ci = 0; ci < c.length; ci++) {
        chips += '<span class="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded">' +
          escapeHtml(c[ci][0]) + ': <span class="font-mono">' + escapeHtml(c[ci][1]) + '</span></span>';
      }
      chips += '</div>';
    }

    // materials (ringkas) + detail (expand)
    var matSummary = '';
    var matDetail = '';
    if (mats === null) {
      matSummary = '<div class="text-[10px] text-red-400 italic mt-2">Error parse material</div>';
    } else if (Array.isArray(mats) && mats.length) {
      matSummary = '<div class="mt-2 text-[10px] text-slate-500">Material: <b>' + mats.length + '</b> item</div>';
      matDetail = '<div class="mt-2 space-y-1">';
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i] || {};
        var name = m.material || m.MATERIAL || m.nama || "-";
        var qty = (m.qtyConfirmed != null ? m.qtyConfirmed : (m.QTY_CONFIRMED != null ? m.QTY_CONFIRMED : (m.qty || m.QTY || 0)));
        var unit = m.unit || m.UNIT || "";
        matDetail += '<div class="text-[10px] bg-slate-50 border border-slate-150 p-1.5 rounded flex justify-between">' +
          '<span class="font-semibold text-slate-800">' + escapeHtml(name) + '</span>' +
          '<span class="font-mono text-slate-600">' + escapeHtml(String(qty)) + ' ' + escapeHtml(String(unit)) + '</span>' +
          '</div>';
      }
      matDetail += '</div>';
    }

    // photos strip
    var photoHtml = '';
    if (ids.length) {
      var sliderId = 'slider-' + git + '-' + Math.random().toString(16).slice(2);
      var counterId = 'counter-' + sliderId;
      photoHtml = '<div class="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 mt-3 shadow-sm aspect-video">';
      photoHtml += '  <div id="' + sliderId + '" class="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide h-full" onscroll="try { var total = ' + ids.length + '; var s = document.getElementById(\'' + sliderId + '\'); var c = document.getElementById(\'' + counterId + '\'); var idx = Math.round(s.scrollLeft / s.clientWidth) + 1; c.innerText = idx + \' / \' + total; } catch(e) {}">';
      
      var lightboxItemsArrayStr = JSON.stringify(ids.map(function(id) { return 'https://lh3.googleusercontent.com/d/' + id + '=s0'; })).replace(/"/g, "'");
      
      for (var j = 0; j < ids.length; j++) {
        var pid = ids[j].trim();
        var imgUrl = 'https://lh3.googleusercontent.com/d/' + pid + '=w600';
        photoHtml += '    <div class="w-full h-full flex-shrink-0 snap-center flex justify-center items-center relative bg-black/5">';
        photoHtml += '      <img src="' + imgUrl + '" referrerpolicy="no-referrer" class="w-full h-full object-contain cursor-zoom-in" onclick="window.openLightboxGroup(' + lightboxItemsArrayStr + ', ' + j + ')">';
        photoHtml += '    </div>';
      }
      photoHtml += '  </div>';
      if (ids.length > 1) {
        photoHtml += '  <div id="' + counterId + '" class="absolute bottom-2 right-2 bg-slate-900/60 backdrop-blur-sm text-white px-2 py-0.5 rounded-lg text-[10px] font-bold select-none pointer-events-none">';
        photoHtml += '    1 / ' + ids.length;
        photoHtml += '  </div>';
      }
      photoHtml += '</div>';
    }

    var detailId = 'gitd_' + Math.random().toString(16).slice(2);
    var hasDetail = (!!matDetail) || (!!ket);

    return '' +
      '<div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm mb-3 hover:border-slate-350 transition-all duration-200">' +
      '  <div class="flex justify-between items-start gap-3">' +
      '    <div class="min-w-0">' +
      '      <div class="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-lg inline-block mb-1">DATA SRM</div>' +
      metaLeft +
      '    </div>' +
      '    <div class="flex-shrink-0">' + metaRight + '</div>' +
      '  </div>' +
      (chips || '') +
      (ket ? '<div class="mt-2 text-[10px] text-slate-500">Ket: <span class="text-slate-800">' + escapeHtml(ket) + '</span></div>' : '') +
      (matSummary || '') +
      (photoHtml || '') +
      (hasDetail ?
        ('<button type="button" class="mt-2 text-[11px] font-bold text-indigo-600 hover:text-indigo-750 active:scale-95 transition" data-toggle="' + detailId + '">Lihat detail</button>' +
         '<div id="' + detailId + '" class="hidden">' + (matDetail || '') + '</div>')
        : '') +
      '</div>';
  }

  // --- RENDERING FOTO BIASA ---
  function renderPhotoItem(row) {
    // row: [0]ID, [1]ID_FOTO, [2]KATEGORI, [3]PO, [4]GIT, [5]PIC, [6]KET, [7]TIME, ...
    var idFoto = row[1];
    var imgUrl = "https://lh3.googleusercontent.com/d/" + idFoto + "=w600";

    var rawCat = (row && row[2]) ? String(row[2]) : "";
    var cat = "FOTO";
    if (rawCat) {
      var parts = rawCat.split(/[,|;]+/).map(function (s) { return (s || "").trim(); }).filter(Boolean);
      if (parts.length) {
        cat = parts[0];
      }
    }

    return '' +
      '<div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden mb-2 hover:border-slate-350 transition-all duration-200">' +
      '  <div class="relative w-full aspect-video bg-slate-50 flex justify-center items-center overflow-hidden border-b border-slate-100">' +
      '    <img src="' + imgUrl + '" referrerpolicy="no-referrer" class="w-full h-full object-contain cursor-zoom-in" onclick="window.openLightbox(\'' + idFoto + '\')">' +
      '    <div class="absolute top-2 right-2 bg-slate-900/60 backdrop-blur-sm text-white px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider">' + cat + '</div>' +
      '  </div>' +
      '  <div class="p-3">' +
      '    <div class="flex justify-between items-start">' +
      '      <div class="min-w-0 flex-1">' +
      '        <div class="text-xs font-bold text-slate-800">PO: <span class="font-mono">' + (row[3] || "-") + '</span></div>' +
      '        <div class="text-[10px] text-slate-500 truncate mt-1">' + (row[6] || "Tanpa Keterangan") + '</div>' +
      '      </div>' +
      '      <div class="text-right text-[9px] text-slate-400 font-mono flex-shrink-0 ml-2">' + safeDate(row[7]) + '</div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  // Helper global untuk onclick string HTML
  window.openLightbox = function(id) {
    lbShow(["https://lh3.googleusercontent.com/d/" + id + "=s0"], 0, null);
  };

  window.openLightboxGroup = function(urls, startIndex) {
    lbShow(urls, startIndex, null);
  };

  function setSearchFilter(filter) {
    searchFilter = filter || "all";
    var g = $("sr-git");
    var f = $("sr-foto");
    if (g) g.classList.toggle("hidden", searchFilter === "foto");
    if (f) f.classList.toggle("hidden", searchFilter === "git");

    // toggle button style
    var bAll = $("search-filter-all");
    var bGit = $("search-filter-git");
    var bFoto = $("search-filter-foto");
    var pairs = [
      [bAll, searchFilter === "all"],
      [bGit, searchFilter === "git"],
      [bFoto, searchFilter === "foto"],
    ];
    for (var i = 0; i < pairs.length; i++) {
      var btn = pairs[i][0];
      var active = pairs[i][1];
      if (!btn) continue;
      btn.className = active
        ? "px-3 py-1.5 rounded-lg text-[11px] font-bold border border-indigo-200 bg-indigo-50 text-indigo-700 active:scale-95 transition"
        : "px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 text-slate-500 transition";
    }
  }

  function renderSearchSummary(q, gCount, pCount) {
    return '' +
      '<div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm mb-3">' +
      '  <div class="flex items-start justify-between gap-3">' +
      '    <div class="min-w-0">' +
      '      <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hasil Pencarian</div>' +
      '      <div class="text-sm font-bold text-slate-800 mt-0.5">PO: <span class="font-mono">' + escapeHtml(q || "") + '</span></div>' +
      '      <div class="text-[11px] text-slate-500 mt-1">' +
      '        <span class="inline-flex items-center gap-1">' +
      '          <span class="w-2 h-2 rounded-full bg-indigo-600"></span>' +
      '          <span>GIT: <b>' + (gCount || 0) + '</b></span>' +
      '        </span>' +
      '        <span class="mx-2 text-slate-200">|</span>' +
      '        <span class="inline-flex items-center gap-1">' +
      '          <span class="w-2 h-2 rounded-full bg-slate-455"></span>' +
      '          <span>Foto: <b>' + (pCount || 0) + '</b></span>' +
      '        </span>' +
      '      </div>' +
      '    </div>' +
      '    <div class="flex-shrink-0 text-right">' +
      '      <div class="text-[10px] text-slate-400">' + escapeHtml(safeDateTime(new Date())) + '</div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
  }

  function doSearch() {
    var qEl = $("search-input");
    var res = $("search-results");
    if (!qEl || !res) return;
    
    var rawQ = (qEl.value || "").trim();
    if (!rawQ) return;

    normalizeSearchInput();
    var normalizedQ = qEl.value;
    
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

      // ringkasan
      html += renderSearchSummary(normalizedQ, gits.length, photos.length);

      // 1. Render Hasil GIT
      if (gits.length > 0) {
        html += '<div id="sr-git">';
        html += '<div class="mb-2 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data SRM / GIT (' + gits.length + ')</div>';
        for (var i = 0; i < gits.length; i++) html += renderGitItem(gits[i]);
        html += '<div class="h-2"></div>';
        html += '</div>';
      }

      // 2. Render Hasil FOTO
      if (photos.length > 0) {
        html += '<div id="sr-foto">';
        html += '<div class="mb-2 px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Riwayat Foto App (' + photos.length + ')</div>';
        for (var k = 0; k < photos.length; k++) html += renderPhotoItem(photos[k]);
        html += '</div>';
      }

      res.innerHTML = html;

      // apply current filter after render
      setSearchFilter(searchFilter);
    });
  }

  // --- RENDERING FOTO SEBAGAI INSTAGRAM GRID (RIWAYAT) ---
  var historyUrls = [];
  var historyIds = [];

  window.openHistoryLightbox = function(startIndex) {
    lbShow(historyUrls, startIndex, { ids: historyIds, source: "history" });
  };

  function renderHistoryGridItem(row, idx) {
    var idFoto = row[1];
    var imgUrl = "https://lh3.googleusercontent.com/d/" + idFoto + "=w600";

    var rawCat = (row && row[2]) ? String(row[2]) : "";
    var cat = "FOTO";
    if (rawCat) {
      var parts = rawCat.split(/[,|;]+/).map(function (s) { return (s || "").trim(); }).filter(Boolean);
      if (parts.length) {
        cat = parts[0];
      }
    }

    var poText = row[3] || "-";
    var timeText = safeDate(row[7]);

    return '' +
      '<div class="relative w-full aspect-[3/4] group overflow-hidden rounded-xl bg-slate-100 border border-slate-200/40 cursor-pointer shadow-sm hover:shadow active:scale-[0.98] transition-all duration-200" ' +
      '     onclick="window.openHistoryLightbox(' + idx + ')">' +
      '  <img src="' + imgUrl + '" referrerpolicy="no-referrer" class="w-full h-full object-cover rounded-xl transition-transform duration-300 group-hover:scale-105" loading="lazy">' +
      '  <!-- Top Right Category Badge -->' +
      '  <div class="absolute top-1 right-1 bg-black/60 backdrop-blur-md text-[8px] font-bold text-white px-1 py-0.5 rounded uppercase tracking-wider">' + cat + '</div>' +
      '  <!-- Bottom Overlay (always visible but elegant) -->' +
      '  <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 pt-8 flex flex-col justify-end text-white select-none pointer-events-none">' +
      '    <div class="text-[10px] font-bold tracking-tight font-mono truncate">PO: ' + poText + '</div>' +
      '    <div class="text-[8px] text-white/70 font-mono mt-0.5">' + timeText + '</div>' +
      '  </div>' +
      '</div>';
  }

  function loadData(force) {
    var container = $("history-list");
    if (!container) return;

    container.className = ""; // Reset grid layout to prevent centering issues
    container.innerHTML =
      '<div class="p-4 text-center text-xs text-slate-400">' +
      '  <span class="inline-flex items-center gap-2">' +
      '    <svg class="w-4 h-4 text-slate-500 animate-spin"><use href="#ic-spin"></use></svg>' +
      "    <span>Memuat...</span>" +
      "  </span>" +
      "</div>";

    // Riwayat: ambil dari sheet PENDING_MATERIAL (tanpa filter) dan tampilkan data dibatasi HISTORY_LIMIT.
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

      // Apply Instagram-style grid layout
      container.className = "grid grid-cols-3 gap-2 p-2";

      var max = parseInt(localStorage.getItem("SMG_SET_HISTORY_LIMIT"), 10) || 50;
      var n = Math.min(rows.length, max);

      // Build arrays for lightbox group
      historyUrls = [];
      historyIds = [];
      for (var j = 0; j < n; j++) {
        historyUrls.push("https://lh3.googleusercontent.com/d/" + rows[j][1] + "=s0");
        historyIds.push(rows[j][1]);
      }

      var html = "";
      for (var i = 0; i < n; i++) {
        html += renderHistoryGridItem(rows[i], i);
      }
      container.innerHTML = html;
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
    // bottom nav (4 icon)
    on($("nav-form-icon"), "click", function () { focusAddPO(); });
    on($("nav-data-icon"), "click", function () { navigate("data"); });
    on($("nav-search-icon"), "click", function () { navigate("search"); });
    on($("nav-settings-icon"), "click", function () { navigate("settings"); });
// overlay buttons
    on($("ovX"), "click", function () { ovClose(false); });
    on($("ovCancel"), "click", function () { ovClose(false); });
    on($("ovOk"), "click", function () { ovClose(true); });

    // toast close
    on($("toastClose"), "click", hideToast);
    on($("diag-trigger"), "click", openDiagPanel);

    // optional toggle
    on($("btn-plus-meta"), "click", function (e) { try { e.preventDefault(); } catch (x) {} toggleOptional(); });

    // mode buttons
    on($("mode-std"), "click", function () { setPOMode("std", true); });
    on($("mode-SL3"), "click", function () { setPOMode("SL3", true); });
    on($("mode-SRG"), "click", function () { setPOMode("SRG", true); });
    on($("mode-PML"), "click", function () { setPOMode("PML", true); });
    on($("mode-BYS"), "click", function () { setPOMode("BYS", true); });
    on($("mode-KM8"), "click", function () { setPOMode("KM8/9", true); });

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
    on($("btn-cancel-edit"), "click", function () { cancelEditMode(false); });
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
    on($("search-input"), "blur", function () { normalizeSearchInput(); });

    on($("btn-search-clear"), "click", function () {
      var qEl = $("search-input");
      var res = $("search-results");
      if (qEl) qEl.value = "";
      if (res) res.innerHTML = "";
      setSearchFilter("all");
    });

    on($("search-filter-all"), "click", function () { setSearchFilter("all"); });
    on($("search-filter-git"), "click", function () { setSearchFilter("git"); });
    on($("search-filter-foto"), "click", function () { setSearchFilter("foto"); });

    // search mode buttons
    on($("search-mode-std"), "click", function () { setSearchPOMode("std", true); });
    on($("search-mode-SL3"), "click", function () { setSearchPOMode("SL3", true); });
    on($("search-mode-SRG"), "click", function () { setSearchPOMode("SRG", true); });
    on($("search-mode-PML"), "click", function () { setSearchPOMode("PML", true); });
    on($("search-mode-BYS"), "click", function () { setSearchPOMode("BYS", true); });
    on($("search-mode-KM8"), "click", function () { setSearchPOMode("KM8/9", true); });

    // event delegation: toggle detail blocks inside search results
    var sr = $("search-results");
    if (sr) {
      on(sr, "click", function (ev) {
        var t = ev && ev.target ? ev.target : null;
        if (!t) return;
        var toggleId = t.getAttribute ? t.getAttribute("data-toggle") : null;
        if (!toggleId) {
          // maybe inner element inside button
          var p = t.closest ? t.closest("[data-toggle]") : null;
          toggleId = p && p.getAttribute ? p.getAttribute("data-toggle") : null;
        }
        if (toggleId) {
          var d = document.getElementById(toggleId);
          if (d) d.classList.toggle("hidden");
          return;
        }
      });
    }

    // settings buttons
    on($("btn-save-settings"), "click", saveSettingsFromUI);
    on($("btn-reset-settings"), "click", resetSettingsToDefault);

    var themeSelect = $("set-app-theme");
    if (themeSelect) {
      on(themeSelect, "change", function () {
        applyTheme(themeSelect.value);
      });
    }
  }

  // =============================
  // DYNAMIC CONFIGURATION/SETTINGS HELPERS
  // =============================
  function loadSettingsToUI() {
    var qualityEl = $("set-comp-quality");
    var widthEl = $("set-max-width");
    var targetKbEl = $("set-target-kb");
    var armedEl = $("set-upload-armed");
    var limitEl = $("set-history-limit");
    var themeEl = $("set-app-theme");
    var cameraSourceEl = $("set-camera-source");

    if (qualityEl) qualityEl.value = JPEG_QUALITY_START;
    if (widthEl) widthEl.value = MAX_WIDTH;
    if (targetKbEl) targetKbEl.value = TARGET_KB;
    if (armedEl) armedEl.checked = !!uploadArmed;
    if (limitEl) limitEl.value = String(HISTORY_LIMIT);
    if (themeEl) themeEl.value = APP_THEME;
    if (cameraSourceEl) cameraSourceEl.value = CAMERA_SOURCE;
  }

  function saveSettingsFromUI() {
    var qualityEl = $("set-comp-quality");
    var widthEl = $("set-max-width");
    var targetKbEl = $("set-target-kb");
    var armedEl = $("set-upload-armed");
    var limitEl = $("set-history-limit");
    var themeEl = $("set-app-theme");

    if (qualityEl) {
      var q = parseFloat(qualityEl.value);
      if (!isNaN(q) && q >= 0.1 && q <= 1.0) {
        JPEG_QUALITY_START = q;
        localStorage.setItem("SMG_SET_QUALITY_START", String(q));
      }
    }
    if (widthEl) {
      var w = parseInt(widthEl.value, 10);
      if (!isNaN(w) && w >= 300 && w <= 3000) {
        MAX_WIDTH = w;
        localStorage.setItem("SMG_SET_MAX_WIDTH", String(w));
      }
    }
    if (targetKbEl) {
      var tk = parseInt(targetKbEl.value, 10);
      if (!isNaN(tk) && tk >= 10 && tk <= 1000) {
        TARGET_KB = tk;
        localStorage.setItem("SMG_SET_TARGET_KB", String(tk));
      }
    }
    if (armedEl) {
      uploadArmed = !!armedEl.checked;
      persistSnapshotNow();
    }
    if (limitEl) {
      var lim = parseInt(limitEl.value, 10);
      if (!isNaN(lim)) {
        HISTORY_LIMIT = lim;
        localStorage.setItem("SMG_SET_HISTORY_LIMIT", String(lim));
      }
    }
    if (themeEl) {
      APP_THEME = themeEl.value || "default";
      localStorage.setItem("SMG_SET_APP_THEME", APP_THEME);
      applyTheme(APP_THEME);
    }
    
    var cameraSourceEl = $("set-camera-source");
    if (cameraSourceEl) {
      CAMERA_SOURCE = cameraSourceEl.value || "camera";
      localStorage.setItem("SMG_SET_CAMERA_SOURCE", CAMERA_SOURCE);
    }

    try {
      if (COMP.setConfig) {
        COMP.setConfig({
          maxWidth: MAX_WIDTH,
          qualityStart: JPEG_QUALITY_START,
          targetKb: TARGET_KB
        });
      }
    } catch (e) {}

    showToast("success", "Pengaturan disimpan!");
  }

  function resetSettingsToDefault() {
    localStorage.removeItem("SMG_SET_GAS_URL");
    localStorage.removeItem("SMG_SET_API_KEY");
    localStorage.removeItem("SMG_SET_QUALITY_START");
    localStorage.removeItem("SMG_SET_MAX_WIDTH");
    localStorage.removeItem("SMG_SET_TARGET_KB");
    localStorage.removeItem("SMG_SET_HISTORY_LIMIT");
    localStorage.removeItem("SMG_SET_APP_THEME");
    localStorage.removeItem("SMG_SET_CAMERA_SOURCE");

    GAS_API_URL = (CFG.GAS_API_URL || "").trim();
    API_KEY = (CFG.API_KEY || "").trim();
    MAX_WIDTH = 1000;
    JPEG_QUALITY_START = 0.9;
    TARGET_KB = 60;
    HISTORY_LIMIT = 50;
    APP_THEME = "default";
    CAMERA_SOURCE = "camera";
    applyTheme("default");

    try {
      if (COMP.setConfig) {
        COMP.setConfig({
          maxWidth: MAX_WIDTH,
          qualityStart: JPEG_QUALITY_START,
          targetKb: TARGET_KB
        });
      }
    } catch (e) {}

    loadSettingsToUI();
    showToast("success", "Kembali ke pengaturan bawaan!");
  }

  // =============================
  // INIT ON LOAD
  // =============================
  window.addEventListener("load", function () {
    applyTheme(APP_THEME);
    previewSkeletonEl = $("preview-skeleton");

    // Subscribe app.js UI elements to SMGStore
    window.SMGStore.subscribe(function (state) {
      capturedFiles = state.capturedFiles;
      poQueue = state.poQueue;
      currentPOMode = state.currentPOMode;
      uploadArmed = state.uploadArmed;

      renderPOList();
      updatePreviewUI();
      refreshStats();
      updateEditBanner();
    });

    bindUi();
    try {
      if (window.SMGLightbox && window.SMGLightbox.init) {
        window.SMGLightbox.init({
          showToast: showToast,
          photoPut: photoPut,
          compressCanvasAsync: compressCanvasAsync,
          onSaved: onLightboxSaved,
          isUILocked: function () { return uiLocked; }
        });
      }
    } catch (e) {}

    // default active icon = form
    setActiveNav("form");


    // Set default mode styles
    setPOMode("std", false);
    setSearchPOMode("std", false);

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





