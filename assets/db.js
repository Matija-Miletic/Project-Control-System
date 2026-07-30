(function (root) {
  "use strict";

  const DB_NAME = "savannah-project-control";
  const DB_VERSION = 1;
  const STORE_NAME = "projectSnapshots";
  const ACTIVE_KEY = "active-project";
  const LOCAL_KEY = "savannah-project-control.active-project.v1";

  let mode = "memory";
  let memoryState = null;
  let database = null;
  let lastError = null;

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function openIndexedDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error("IndexedDB is not available in this browser."));
        return;
      }
      let request;
      try {
        request = root.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = function () {
        const db = request.result;
        db.onversionchange = function () {
          db.close();
        };
        resolve(db);
      };
      request.onerror = function () {
        reject(request.error || new Error("The local database could not be opened."));
      };
      request.onblocked = function () {
        reject(new Error("The local database is blocked by another open copy."));
      };
    });
  }

  function idbGet(db) {
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_KEY);
      request.onsuccess = function () {
        resolve(request.result ? request.result.value : null);
      };
      request.onerror = function () {
        reject(request.error || new Error("The project could not be read."));
      };
    });
  }

  function idbPut(db, value) {
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        key: ACTIVE_KEY,
        value: clone(value),
        savedAt: new Date().toISOString()
      });
      transaction.oncomplete = function () {
        resolve();
      };
      transaction.onerror = function () {
        reject(transaction.error || new Error("The project could not be saved."));
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error("The project save was cancelled."));
      };
    });
  }

  function localStorageAvailable() {
    try {
      const probe = "__spc_storage_probe__";
      root.localStorage.setItem(probe, "1");
      root.localStorage.removeItem(probe);
      return true;
    } catch (error) {
      lastError = error;
      return false;
    }
  }

  async function initialise(defaultState) {
    memoryState = clone(defaultState);
    try {
      database = await openIndexedDb();
      const stored = await idbGet(database);
      if (stored) {
        memoryState = clone(stored);
      } else {
        await idbPut(database, memoryState);
      }
      mode = "indexeddb";
      return clone(memoryState);
    } catch (error) {
      lastError = error;
    }

    if (localStorageAvailable()) {
      try {
        const stored = root.localStorage.getItem(LOCAL_KEY);
        if (stored) memoryState = JSON.parse(stored);
        else root.localStorage.setItem(LOCAL_KEY, JSON.stringify(memoryState));
        mode = "localstorage";
        return clone(memoryState);
      } catch (error) {
        lastError = error;
      }
    }

    mode = "memory";
    return clone(memoryState);
  }

  async function save(state) {
    memoryState = clone(state);
    if (mode === "indexeddb" && database) {
      try {
        await idbPut(database, memoryState);
        return;
      } catch (error) {
        lastError = error;
        if (localStorageAvailable()) mode = "localstorage";
        else mode = "memory";
      }
    }
    if (mode === "localstorage") {
      try {
        root.localStorage.setItem(LOCAL_KEY, JSON.stringify(memoryState));
        return;
      } catch (error) {
        lastError = error;
        mode = "memory";
      }
    }
  }

  async function replace(state) {
    memoryState = clone(state);
    await save(memoryState);
    return clone(memoryState);
  }

  function status() {
    const descriptions = {
      indexeddb: "Saved locally in this browser",
      localstorage: "Saved locally with limited-capacity browser storage",
      memory: "Temporary session only"
    };
    return {
      mode,
      label: descriptions[mode],
      persistent: mode !== "memory",
      warning:
        mode === "memory"
          ? "This browser blocked local storage for the opened file. Changes work for this session only. Export the project JSON before closing the tab."
          : "Data is stored only in this browser profile. Export a project backup before clearing browser data, moving between computers, or issuing a report.",
      error: lastError ? String(lastError.message || lastError) : null
    };
  }

  root.SPCDB = {
    initialise,
    save,
    replace,
    status
  };
})(window);
