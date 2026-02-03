(function () {
  "use strict";

  var DB_NAME = "CAMLOG_PWA";
  var DB_VERSION = 2;
  var DB_STORE = "kv";
  var DB_PHOTOS = "photos";

  var PHOTO_CACHE = {};

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

  window.SMGStorage = {
    openDB: openDB,
    kvGet: kvGet,
    kvPut: kvPut,
    kvDel: kvDel,
    photoPut: photoPut,
    photoGet: photoGet,
    photoDel: photoDel,
    photoGetMany: photoGetMany,
    photoDelMany: photoDelMany
  };
})();
