(function () {
  "use strict";

  var KEY = "SMG_DIAG_LOGS";
  var MAX = 200;

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return String(Date.now()); }
  }

  function safeJson(v) {
    try { return JSON.stringify(v); } catch (e) { return "\"[unserializable]\""; }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY) || "[]";
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function save(arr) {
    try { localStorage.setItem(KEY, safeJson(arr)); } catch (e) {}
  }

  function push(level, msg, meta) {
    var arr = load();
    arr.push({ t: nowIso(), level: String(level || "info"), msg: String(msg || ""), meta: meta || null });
    if (arr.length > MAX) arr = arr.slice(arr.length - MAX);
    save(arr);
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  function get() {
    return load();
  }

  function envSnapshot() {
    var out = {};
    try { out.ua = navigator.userAgent || ""; } catch (e) {}
    try { out.lang = navigator.language || ""; } catch (e2) {}
    try { out.online = !!navigator.onLine; } catch (e3) {}
    try { out.time = nowIso(); } catch (e4) {}
    return out;
  }

  function formatText(extra) {
    var arr = load();
    var head = {
      app: "SMG PWA",
      env: envSnapshot(),
      extra: extra || null
    };
    var lines = [safeJson(head)];
    for (var i = 0; i < arr.length; i++) lines.push(safeJson(arr[i]));
    return lines.join("\n");
  }

  function copyText(text, cb) {
    cb = cb || function () {};
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { cb(null); }).catch(function (e) { cb(e); });
        return;
      }
    } catch (e0) {}

    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      cb(null);
    } catch (e1) {
      cb(e1);
    }
  }

  function copy(extra, cb) {
    copyText(formatText(extra), cb);
  }

  function bindGlobalErrors() {
    try {
      window.addEventListener("error", function (e) {
        try {
          push("error", "window.error", {
            message: e && e.message ? e.message : "",
            filename: e && e.filename ? e.filename : "",
            lineno: e && e.lineno ? e.lineno : 0,
            colno: e && e.colno ? e.colno : 0
          });
        } catch (x) {}
      });
    } catch (e1) {}

    try {
      window.addEventListener("unhandledrejection", function (e) {
        try {
          var r = e && e.reason ? e.reason : null;
          push("error", "unhandledrejection", { reason: (r && r.message) ? r.message : String(r) });
        } catch (x2) {}
      });
    } catch (e2) {}
  }

  bindGlobalErrors();

  window.SMGDiag = {
    push: push,
    clear: clear,
    get: get,
    formatText: formatText,
    copy: copy
  };
})();
