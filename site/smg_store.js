(function () {
  "use strict";

  var state = {
    form: {
      po: "",
      git: "",
      pic: "",
      ket: "",
      optionalVisible: false,
      poMode: "std"
    },
    poQueue: [],
    currentPOMode: "std",
    uploadArmed: false,
    capturedFiles: []
  };

  var listeners = [];
  var saveTimer = null;

  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) {}
    }
  }

  function getState() {
    // Return a shallow clone of the main state values to prevent direct external mutation
    return {
      form: state.form,
      poQueue: state.poQueue,
      currentPOMode: state.currentPOMode,
      uploadArmed: state.uploadArmed,
      capturedFiles: state.capturedFiles
    };
  }

  function persistAppState(cb) {
    if (window.SMGStorage && window.SMGStorage.saveAppState) {
      window.SMGStorage.saveAppState(state, function (err) {
        if (cb) cb(err || null);
      });
    } else {
      if (cb) cb(new Error("Storage module not loaded."));
    }
  }

  function persistDebounced(cb) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      persistAppState(cb);
    }, 450);
  }

  function loadState(cb) {
    if (window.SMGStorage && window.SMGStorage.loadAppState) {
      window.SMGStorage.loadAppState(function (err, loadedState) {
        if (err || !loadedState) {
          return cb && cb(err || new Error("No state snapshot found"));
        }
        state.form = loadedState.form || state.form;
        state.poQueue = loadedState.poQueue || [];
        state.currentPOMode = loadedState.currentPOMode || "std";
        state.uploadArmed = !!loadedState.uploadArmed;
        state.capturedFiles = loadedState.capturedFiles || [];
        
        notify();
        if (cb) cb(null, state);
      });
    } else {
      if (cb) cb(new Error("Storage module not loaded."));
    }
  }

  function updateFormState(nextForm, debounceSave) {
    if (!nextForm) return;
    state.form = {
      po: typeof nextForm.po === "string" ? nextForm.po : state.form.po,
      git: typeof nextForm.git === "string" ? nextForm.git : state.form.git,
      pic: typeof nextForm.pic === "string" ? nextForm.pic : state.form.pic,
      ket: typeof nextForm.ket === "string" ? nextForm.ket : state.form.ket,
      optionalVisible: typeof nextForm.optionalVisible === "boolean" ? nextForm.optionalVisible : state.form.optionalVisible,
      poMode: typeof nextForm.poMode === "string" ? nextForm.poMode : state.form.poMode
    };
    
    notify();
    if (debounceSave !== false) {
      persistDebounced();
    } else {
      persistAppState();
    }
  }

  function setPOMode(mode, debounceSave) {
    state.currentPOMode = mode || "std";
    state.form.poMode = state.currentPOMode;
    
    notify();
    if (debounceSave !== false) {
      persistDebounced();
    } else {
      persistAppState();
    }
  }

  function setUploadArmed(armed, debounceSave) {
    state.uploadArmed = !!armed;
    
    notify();
    if (debounceSave !== false) {
      persistDebounced();
    } else {
      persistAppState();
    }
  }

  function addPhoto(photoId, dataUrl, sizeKb, type, cb) {
    if (window.SMGStorage && window.SMGStorage.photoPut) {
      window.SMGStorage.photoPut(photoId, dataUrl, function (err) {
        if (err) {
          if (cb) cb(err);
          return;
        }
        
        state.capturedFiles.push({
          id: photoId,
          dataUrl: dataUrl,
          sizeKb: sizeKb,
          jenis: type || "MATERIAL"
        });

        notify();
        persistAppState(cb);
      });
    } else {
      if (cb) cb(new Error("Storage module not loaded."));
    }
  }

  function removePhoto(index, cb) {
    if (index < 0 || index >= state.capturedFiles.length) {
      if (cb) cb(new Error("Index out of bounds"));
      return;
    }

    var f = state.capturedFiles[index];
    state.capturedFiles.splice(index, 1);

    notify();

    if (f && f.id && window.SMGStorage && window.SMGStorage.photoDel) {
      window.SMGStorage.photoDel(f.id, function () {
        persistAppState(cb);
      });
    } else {
      persistAppState(cb);
    }
  }

  function savePO(payload, editIndex, cb) {
    if (editIndex >= 0 && editIndex < state.poQueue.length) {
      state.poQueue[editIndex] = payload;
    } else {
      state.poQueue.push(payload);
    }

    // Clear active capturedFiles drafts once PO is saved to queue
    state.capturedFiles = [];
    state.form = {
      po: "",
      git: "",
      pic: "",
      ket: "",
      optionalVisible: false,
      poMode: state.currentPOMode
    };

    notify();
    persistAppState(cb);
  }

  function updatePOQueue(nextQueue, cb) {
    state.poQueue = nextQueue || [];
    notify();
    persistAppState(cb);
  }

  function deletePO(index, cb) {
    if (index < 0 || index >= state.poQueue.length) {
      if (cb) cb(new Error("Index out of bounds"));
      return;
    }

    var p = state.poQueue[index];
    state.poQueue.splice(index, 1);
    notify();

    var ids = (p && p.image_ids) ? p.image_ids.slice(0) : [];
    if (ids.length > 0 && window.SMGStorage && window.SMGStorage.photoDelMany) {
      window.SMGStorage.photoDelMany(ids, function () {
        persistAppState(cb);
      });
    } else {
      persistAppState(cb);
    }
  }

  function resetAll(cb) {
    var allIds = [];
    for (var i = 0; i < state.poQueue.length; i++) {
      if (state.poQueue[i] && state.poQueue[i].image_ids) {
        for (var j = 0; j < state.poQueue[i].image_ids.length; j++) {
          allIds.push(state.poQueue[i].image_ids[j]);
        }
      }
    }
    for (var k = 0; k < state.capturedFiles.length; k++) {
      if (state.capturedFiles[k] && state.capturedFiles[k].id) {
        allIds.push(state.capturedFiles[k].id);
      }
    }

    state.poQueue = [];
    state.capturedFiles = [];
    state.form = {
      po: "",
      git: "",
      pic: "",
      ket: "",
      optionalVisible: false,
      poMode: "std"
    };

    notify();

    if (window.SMGStorage && window.SMGStorage.photoDelMany) {
      window.SMGStorage.photoDelMany(allIds, function () {
        if (window.SMGStorage.clearAppState) {
          window.SMGStorage.clearAppState(cb);
        } else {
          if (cb) cb(null);
        }
      });
    } else {
      if (cb) cb(null);
    }
  }

  window.SMGStore = {
    subscribe: subscribe,
    getState: getState,
    loadState: loadState,
    updateFormState: updateFormState,
    setPOMode: setPOMode,
    setUploadArmed: setUploadArmed,
    addPhoto: addPhoto,
    removePhoto: removePhoto,
    savePO: savePO,
    updatePOQueue: updatePOQueue,
    deletePO: deletePO,
    resetAll: resetAll,
    persistState: persistAppState
  };
})();
