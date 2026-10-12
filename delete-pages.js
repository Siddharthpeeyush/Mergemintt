/* MergeMint — Delete Pages tool logic. Requires pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var file = null;        // File
  var fileBytes = null;   // ArrayBuffer
  var pageCount = 0;
  var resultBlob = null;
  var resultName = "mergemint-pages-deleted.pdf";

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var deleteBtn = Mint.el("deleteBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) {
      Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a PDF file.");
      return;
    }
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.setProgress("progressWrap", 10, "Reading PDF…");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    }).then(function (doc) {
      if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
      pageCount = doc.getPageCount();
      return Mint.readAsArrayBuffer(f);
    }).then(function (bytes) {
      fileBytes = bytes;
      file = f;
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, {
        onRemove: function () { resetAll(); }
      }));
      pageInfo.style.display = "";
      pageInfo.textContent = "📄 “" + file.name + "” — " + pageCount + (pageCount === 1 ? " page, " : " pages, ") + Mint.formatBytes(file.size) + ".";
      optionsBox.style.display = "";
      deleteBtn.disabled = false;
      resetResult();
      Mint.hideProgress("progressWrap");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetResult() {
    resultBox.style.display = "none";
    resultBlob = null;
  }

  function resetAll() {
    file = null; fileBytes = null; pageCount = 0;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    deleteBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  deleteBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    deleteBtn.disabled = true;

    var toDelete;
    try {
      toDelete = Mint.parsePageRanges(Mint.el("rangeInput").value, pageCount);
    } catch (e) {
      Mint.showAlert("alertBox", "error", e.message);
      deleteBtn.disabled = false;
      return;
    }

    var delSet = {};
    toDelete.forEach(function (p) { delSet[p - 1] = true; });
    var kept = [];
    for (var i = 0; i < pageCount; i++) {
      if (!delSet[i]) kept.push(i);
    }
    if (kept.length === 0) {
      Mint.showAlert("alertBox", "error", "You can't delete every page — keep at least one.");
      deleteBtn.disabled = false;
      return;
    }

    Mint.setProgress("progressWrap", 25, "Removing " + toDelete.length + (toDelete.length === 1 ? " page…" : " pages…"));
    PDFLib.PDFDocument.load(fileBytes).then(function (src) {
      return PDFLib.PDFDocument.create().then(function (out) {
        return out.copyPages(src, kept).then(function (copied) {
          copied.forEach(function (pg) { out.addPage(pg); });
          return out.save();
        });
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      resultName = "mergemint-pages-deleted.pdf";
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + toDelete.length + "</strong>pages removed</div>" +
        "<div class='stat'><strong>" + kept.length + "</strong>pages remaining</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Deleting pages failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      deleteBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, resultName);
  });
})();
