/* MergeMint — Merge PDF tool logic. Requires pdf-lib (global PDFLib) and app.js (global Mint). */
(function () {
  "use strict";

  var files = [];          // Array of File objects, in merge order
  var mergedBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var mergeBtn = Mint.el("mergeBtn");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: true,
    onFiles: addFiles
  });

  function addFiles(newFiles) {
    Mint.hideAlert("alertBox");
    var added = 0;
    newFiles.forEach(function (f) {
      var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!isPdf) {
        Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a PDF file and was skipped.");
        return;
      }
      files.push(f);
      added++;
    });
    if (added) { renderList(); resetResult(); }
    mergeBtn.disabled = files.length < 2;
  }

  var dragIdx = -1;
  function renderList() {
    fileList.innerHTML = "";
    files.forEach(function (f, i) {
      var li = Mint.fileRow(f, i, {
        onUp: function (idx) { Mint.moveInArray(files, idx, -1); renderList(); },
        onDown: function (idx) { Mint.moveInArray(files, idx, 1); renderList(); },
        onRemove: function (idx) {
          files.splice(idx, 1);
          renderList(); resetResult();
          mergeBtn.disabled = files.length < 2;
        }
      });
      // drag-reorder: grab the handle (or the row) and drop onto another row
      li.draggable = true;
      li.dataset.idx = i;
      var handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⋮⋮";
      handle.title = "Drag to reorder";
      li.insertBefore(handle, li.firstChild);
      li.addEventListener("dragstart", function (e) {
        dragIdx = parseInt(li.dataset.idx, 10);
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(dragIdx)); } catch (err) {}
        setTimeout(function () { li.classList.add("dragging"); }, 0);
      });
      li.addEventListener("dragend", function () {
        li.classList.remove("dragging");
        dragIdx = -1;
      });
      li.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      li.addEventListener("drop", function (e) {
        e.preventDefault();
        var to = parseInt(li.dataset.idx, 10);
        if (dragIdx >= 0 && dragIdx !== to) {
          var moved = files.splice(dragIdx, 1)[0];
          files.splice(to, 0, moved);
          renderList();
          resetResult();
        }
      });
      fileList.appendChild(li);
    });
  }

  function resetResult() {
    resultBox.style.display = "none";
    mergedBlob = null;
    Mint.hideProgress("progressWrap");
  }

  mergeBtn.addEventListener("click", function () {
    if (files.length < 2) return;
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Please check your internet connection and reload the page.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    mergeBtn.disabled = true;

    var mergedDoc;
    var chain = PDFLib.PDFDocument.create().then(function (doc) {
      mergedDoc = doc;
    }).catch(function (e) {
      throw new Error("Could not start merging: " + (e && e.message || e));
    });

    files.forEach(function (f, i) {
      chain = chain.then(function () {
        Mint.setProgress("progressWrap", Math.round((i / files.length) * 100),
          "Merging file " + (i + 1) + " of " + files.length + "…");
        return Mint.readAsArrayBuffer(f).then(function (bytes) {
          return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
        }).then(function (src) {
          return mergedDoc.copyPages(src, src.getPageIndices()).then(function (pages) {
            pages.forEach(function (p) { mergedDoc.addPage(p); });
          });
        }).catch(function (err) {
          throw new Error("Could not read “" + f.name + "”. It may be corrupted or password-protected. (" + err.message + ")");
        });
      });
    });

    chain.then(function () {
      Mint.setProgress("progressWrap", 100, "Finalizing…");
      return mergedDoc.save();
    }).then(function (bytes) {
      mergedBlob = new Blob([bytes], { type: "application/pdf" });
      var totalIn = files.reduce(function (s, f) { return s + f.size; }, 0);
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + files.length + "</strong>files merged</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(totalIn) + "</strong>input size</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(mergedBlob.size) + "</strong>output size</div>";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Merging failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      mergeBtn.disabled = files.length < 2;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (mergedBlob) Mint.downloadBlob(mergedBlob, "mergemint-merged.pdf");
  });
})();
