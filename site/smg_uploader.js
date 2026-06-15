(function () {
  "use strict";

  function getGasConfig() {
    var CFG = window.__APP_CONFIG__ || window.__CONFIG__ || {};
    var url = localStorage.getItem("SMG_SET_GAS_URL") || (CFG.GAS_API_URL || "").trim();
    var key = localStorage.getItem("SMG_SET_API_KEY") || (CFG.API_KEY || "").trim();
    return { url: url, key: key };
  }

  function hasApi() {
    var cfg = getGasConfig();
    return !!(cfg.url && cfg.key);
  }

  function apiPost(action, data, cb) {
    var cfg = getGasConfig();
    if (!cfg.url || !cfg.key) {
      return cb && cb(new Error("Missing config.js GAS_API_URL / API_KEY"));
    }

    var body = new URLSearchParams();
    body.set("action", action);
    body.set("key", cfg.key);
    body.set("data", JSON.stringify(data || {}));

    fetch(cfg.url, {
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

  function apiGet(action, params, cb) {
    var cfg = getGasConfig();
    if (!cfg.url || !cfg.key) {
      return cb && cb(new Error("Missing config.js GAS_API_URL / API_KEY"));
    }

    params = params || {};
    params.action = action;
    params.key = cfg.key;

    var qs = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])));
    }

    var url = cfg.url + (cfg.url.indexOf("?") >= 0 ? "&" : "?") + qs.join("&");

    fetch(url, { method: "GET", mode: "cors", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb && cb(null, j); })
      .catch(function (e) { cb && cb(e); });
  }

  function cloneForUpload(item, images) {
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
      created_by: item.created_by || "GUEST",
      upload_id: item.upload_id || "",
      _uploaded: !!item._uploaded
    };
  }

  function uploadAll(queue, options) {
    options = options || {};
    var getPhotos = options.getPhotos || function (ids, cb) { cb(null, []); };
    var deletePhotos = options.deletePhotos || function (ids, cb) { cb(null); };
    var onSaveState = options.onSaveState || function (cb) { cb(null); };
    var onItemStart = options.onItemStart || function () {};
    var onItemSuccess = options.onItemSuccess || function () {};
    var onItemError = options.onItemError || function () {};
    var onComplete = options.onComplete || function () {};
    var onError = options.onError || function () {};
    var onStepUpdate = options.onStepUpdate || function () {};

    if (!hasApi()) {
      return onError(new Error("Config belum siap. GAS_API_URL / API_KEY belum terpasang."));
    }

    var pending = [];
    for (var i = 0; i < queue.length; i++) {
      if (queue[i] && !queue[i]._uploaded) pending.push(i);
    }

    if (pending.length === 0) {
      return onComplete(0);
    }

    function uploadNext(pos) {
      if (pos >= pending.length) {
        // Complete the uploader loop, delete remaining locally cached photos for all queue items that were successfully uploaded
        var allIds = [];
        for (var j = 0; j < queue.length; j++) {
          if (queue[j] && queue[j]._uploaded && queue[j].image_ids) {
            for (var k = 0; k < queue[j].image_ids.length; k++) {
              allIds.push(queue[j].image_ids[k]);
            }
          }
        }
        onStepUpdate("Finalisasi...");
        deletePhotos(allIds, function () {
          onComplete(pending.length);
        });
        return;
      }

      var idx = pending[pos];
      var item = queue[idx];
      if (!item) {
        return uploadNext(pos + 1);
      }

      var label = item.no_po ? item.no_po : "PO";
      onItemStart(item, pos, pending.length);

      var ids = item.image_ids ? item.image_ids.slice(0) : [];
      getPhotos(ids, function (err, images) {
        if (err) {
          onItemError(item, new Error("Gagal membaca foto lokal: " + String(err)), pos, pending.length);
          return onError(err);
        }

        var realImages = [];
        for (var k = 0; k < images.length; k++) {
          if (images[k]) realImages.push(images[k]);
        }

        var sendItem = cloneForUpload(item, realImages);

        apiPost("simpanData", sendItem, function (err2, res) {
          if (err2) {
            onItemError(item, err2, pos, pending.length);
            onSaveState(function () {
              onError(err2);
            });
            return;
          }

          var ok = (res && res.status === "success") || (res && res.already === true) || (res && res.ok === true && res.status === "success");
          if (ok) {
            item._uploaded = true;
            onItemSuccess(item, pos, pending.length);
            
            // Delete uploaded item photos right away to save IndexedDB space
            deletePhotos(ids, function () {
              onSaveState(function () {
                uploadNext(pos + 1);
              });
            });
          } else {
            var msg = (res && res.message) ? res.message : "Unknown error";
            var uploadErr = new Error(msg);
            onItemError(item, uploadErr, pos, pending.length);
            onSaveState(function () {
              onError(uploadErr);
            });
          }
        });
      });
    }

    uploadNext(0);
  }

  window.SMGUploader = {
    hasApi: hasApi,
    getGasConfig: getGasConfig,
    apiPost: apiPost,
    apiGet: apiGet,
    uploadAll: uploadAll
  };
})();
