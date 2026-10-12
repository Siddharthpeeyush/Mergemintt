/* MergeMint — shared helpers for all tool pages.
   Exposes a global `Mint` object. Requires no libraries. */

(function () {
  "use strict";

  function el(id) { return document.getElementById(id); }

  function formatBytes(n) {
    if (!n && n !== 0) return "—";
    if (n < 1024) return n + " B";
    var kb = n / 1024;
    if (kb < 1024) return kb.toFixed(1) + " KB";
    var mb = kb / 1024;
    if (mb < 1024) return mb.toFixed(2) + " MB";
    return (mb / 1024).toFixed(2) + " GB";
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error("Could not read file: " + file.name)); };
      r.readAsArrayBuffer(file);
    });
  }

  /* Wire up a drag-and-drop zone + hidden file input.
     opts: { input, accept, multiple, onFiles(files:Array<File>) } */
  function setupDropzone(zoneId, opts) {
    var zone = el(zoneId);
    var input = opts.input;
    if (opts.accept) input.setAttribute("accept", opts.accept);
    input.multiple = !!opts.multiple;

    zone.addEventListener("click", function () { input.click(); });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", function () {
      if (input.files.length) opts.onFiles(Array.prototype.slice.call(input.files));
      input.value = "";
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("dragover"); });
    });
    zone.addEventListener("drop", function (e) {
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      if (files.length) opts.onFiles(files);
    });
  }

  function showAlert(boxId, kind, message) {
    var box = el(boxId);
    box.className = "alert visible " + kind;
    box.textContent = message;
  }

  function hideAlert(boxId) {
    var box = el(boxId);
    box.className = "alert";
    box.textContent = "";
  }

  function setProgress(wrapId, pct, label) {
    var wrap = el(wrapId);
    wrap.classList.add("visible");
    wrap.querySelector(".progress-fill").style.width = Math.max(0, Math.min(100, pct)) + "%";
    if (label !== undefined) wrap.querySelector(".progress-label").textContent = label;
  }

  function hideProgress(wrapId) {
    el(wrapId).classList.remove("visible");
  }

  /* Build a <li> file row. opts: { showThumb, onUp, onDown, onRemove } */
  function fileRow(file, index, opts) {
    var li = document.createElement("li");
    li.className = "file-item";

    if (opts.showThumb && file.thumbUrl) {
      var img = document.createElement("img");
      img.className = "thumb";
      img.src = file.thumbUrl;
      img.alt = "";
      li.appendChild(img);
    }

    var name = document.createElement("span");
    name.className = "fname";
    name.textContent = file.name;
    name.title = file.name;
    li.appendChild(name);

    var size = document.createElement("span");
    size.className = "fsize";
    size.textContent = formatBytes(file.size);
    li.appendChild(size);

    function btn(label, title, handler, cls) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "icon-btn" + (cls ? " " + cls : "");
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("click", function (e) { e.stopPropagation(); handler(index); });
      li.appendChild(b);
    }

    if (opts.onUp) btn("↑", "Move up", opts.onUp);
    if (opts.onDown) btn("↓", "Move down", opts.onDown);
    if (opts.onRemove) btn("✕", "Remove", opts.onRemove, "remove");

    return li;
  }

  function moveInArray(arr, i, dir) {
    var j = i + dir;
    if (j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }

  /* Parse "1-3, 5, 8-10" into a sorted unique array of 1-based page numbers.
     Throws an Error with a friendly message on invalid input. */
  function parsePageRanges(str, pageCount) {
    if (!str || !str.trim()) throw new Error("Please enter at least one page or range.");
    var pages = {};
    var parts = str.split(",");
    for (var k = 0; k < parts.length; k++) {
      var part = parts[k].trim();
      if (!part) continue;
      var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      var single = part.match(/^(\d+)$/);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a < 1 || b < 1) throw new Error("Page numbers must start at 1 (in “" + part + "”).");
        if (a > b) throw new Error("Invalid range “" + part + "” — start is larger than end.");
        if (b > pageCount) throw new Error("Range “" + part + "” exceeds the document's " + pageCount + " pages.");
        for (var p = a; p <= b; p++) pages[p] = true;
      } else if (single) {
        var n = parseInt(single[1], 10);
        if (n < 1) throw new Error("Page numbers must start at 1.");
        if (n > pageCount) throw new Error("Page " + n + " does not exist — the document has " + pageCount + " pages.");
        pages[n] = true;
      } else {
        throw new Error("Could not understand “" + part + "”. Use formats like 1-3, 5.");
      }
    }
    var out = Object.keys(pages).map(Number).sort(function (x, y) { return x - y; });
    if (!out.length) throw new Error("Please enter at least one valid page or range.");
    return out;
  }

  /* Dynamically load an external script once. Resolves when loaded. */
  var loadedScripts = {};
  function loadScript(src) {
    if (loadedScripts[src]) return loadedScripts[src];
    loadedScripts[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Failed to load a required library. Check your connection and retry.")); };
      document.head.appendChild(s);
    });
    return loadedScripts[src];
  }

  window.Mint = {
    el: el,
    formatBytes: formatBytes,
    downloadBlob: downloadBlob,
    readAsArrayBuffer: readAsArrayBuffer,
    setupDropzone: setupDropzone,
    showAlert: showAlert,
    hideAlert: hideAlert,
    setProgress: setProgress,
    hideProgress: hideProgress,
    fileRow: fileRow,
    moveInArray: moveInArray,
    parsePageRanges: parsePageRanges,
    loadScript: loadScript
  };
})();
