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

  function saveAppState(state, cb) {
    if (!state) return cb && cb("no state");
    try {
      var poQueue = state.poQueue || [];
      var capturedFiles = state.capturedFiles || [];

      var capturedMeta = [];
      var photoPuts = [];

      for (var i = 0; i < capturedFiles.length; i++) {
        var f = capturedFiles[i];
        if (!f) continue;
        capturedMeta.push({ id: f.id || "", sizeKb: f.sizeKb || 0, jenis: f.jenis || "MATERIAL" });
        if (f.dataUrl) {
          (function (id, dataUrl) {
            photoPuts.push(function (pCb) {
              photoPut(id, dataUrl, pCb);
            });
          })(f.id, f.dataUrl);
        }
      }

      var snap = {
        v: 3,
        ts: Date.now(),
        currentCategory: "MATERIAL",
        currentPOMode: state.currentPOMode || "std",
        capturedMeta: capturedMeta,
        poQueue: poQueue,
        form: state.form || {},
        uploadArmed: !!state.uploadArmed
      };

      kvPut("snapshot", snap, function (err) {
        if (err) return cb && cb(err);
        if (photoPuts.length === 0) return cb && cb(null);

        var idx = 0;
        function nextPhoto() {
          if (idx >= photoPuts.length) return cb && cb(null);
          photoPuts[idx++](function () {
            nextPhoto();
          });
        }
        nextPhoto();
      });
    } catch (e) {
      if (cb) cb(e);
    }
  }

  function migrateLegacySnapshot(snap, done) {
    var tasks = [];
    var migratedFiles = [];
    var migratedQueue = (snap.poQueue) ? JSON.parse(JSON.stringify(snap.poQueue)) : [];
    var i;

    function makePhotoId() {
      return "PH_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    }

    if (snap.capturedFiles && snap.capturedFiles.length) {
      for (i = 0; i < snap.capturedFiles.length; i++) {
        (function (f) {
          if (!f || !f.dataUrl) return;
          tasks.push(function (mCb) {
            var id = makePhotoId();
            photoPut(id, f.dataUrl, function (pErr) {
              if (!pErr) {
                migratedFiles.push({ id: id, dataUrl: f.dataUrl, sizeKb: f.sizeKb || 0, jenis: f.jenis || "MATERIAL" });
              }
              mCb(null);
            });
          });
        })(snap.capturedFiles[i]);
      }
    }

    for (i = 0; i < migratedQueue.length; i++) {
      (function (p) {
        if (!p) return;
        if (p.image_ids && p.image_ids.length) return;
        if (!p.images || !p.images.length) return;

        tasks.push(function (mCb) {
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
              mCb(null);
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
      })(migratedQueue[i]);
    }

    var t = 0;
    function runNext() {
      if (t >= tasks.length) return done && done(migratedFiles, migratedQueue);
      tasks[t++](function () { runNext(); });
    }
    runNext();
  }

  function sanitizeQueue(queue) {
    if (!queue) return;
    for (var i = 0; i < queue.length; i++) {
      var p = queue[i];
      if (!p) continue;
      p.created_by = p.created_by || "GUEST";
      p.kategori = "MATERIAL";
      p.po_mode = p.po_mode || "std";
      p.pic_po = p.pic_po || "";
      p.git_number = p.git_number || "";
      p.keterangan = p.keterangan || "";
      p.image_ids = p.image_ids || [];
      p.sizes = p.sizes || [];
      p.photo_types = p.photo_types || [];
      p.total_kb = p.total_kb || 0;
      p.status_upload_ke_srm = p.status_upload_ke_srm || "Pending";
      p._uploaded = !!p._uploaded;
      p.upload_id = p.upload_id || ("UPL_MIG_" + Date.now() + "_" + Math.random().toString(16).slice(2));
      if (p.images) {
        try { delete p.images; } catch (e) {}
      }
    }
  }

  function loadAppState(cb) {
    kvGet("snapshot", function (err, snap) {
      if (err || !snap) return cb && cb(err || "no snapshot");

      var currentPOMode = snap.currentPOMode || "std";
      var poQueue = snap.poQueue || [];
      var uploadArmed = !!snap.uploadArmed;
      var capturedFiles = [];

      var legacyHasBase64 =
        (snap.capturedFiles && snap.capturedFiles.length) ||
        (poQueue && poQueue.length && poQueue[0] && poQueue[0].images && poQueue[0].images.length);

      if (legacyHasBase64 || (snap.v && snap.v < 3)) {
        migrateLegacySnapshot(snap, function (migratedFiles, migratedQueue) {
          var state = {
            currentPOMode: currentPOMode,
            poQueue: migratedQueue,
            form: snap.form || {},
            uploadArmed: uploadArmed,
            capturedFiles: migratedFiles
          };
          sanitizeQueue(state.poQueue);
          saveAppState(state, function () {
            cb && cb(null, state);
          });
        });
        return;
      }

      var meta = snap.capturedMeta || [];
      var i = 0;
      function nextFile() {
        if (i >= meta.length) {
          var state = {
            currentPOMode: currentPOMode,
            poQueue: poQueue,
            form: snap.form || {},
            uploadArmed: uploadArmed,
            capturedFiles: capturedFiles
          };
          sanitizeQueue(state.poQueue);
          return cb && cb(null, state);
        }
        var m = meta[i++] || {};
        var id = m.id || "";
        var sizeKb = m.sizeKb || 0;
        var jenis = m.jenis || "MATERIAL";

        photoGet(id, function (pErr, dataUrl) {
          capturedFiles.push({ id: id, dataUrl: dataUrl || "", sizeKb: sizeKb, jenis: jenis });
          nextFile();
        });
      }
      nextFile();
    });
  }

  function clearAppState(cb) {
    kvDel("snapshot", cb);
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
    photoDelMany: photoDelMany,
    saveAppState: saveAppState,
    loadAppState: loadAppState,
    clearAppState: clearAppState
  };
})();
