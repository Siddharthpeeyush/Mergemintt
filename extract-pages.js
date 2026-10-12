/* MergeMint — Extract Pages tool logic. Requires pdf-lib (PDFLib), JSZip (lazy), and app.js (Mint). */
(function () {
  "use strict";

  var JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  var file = null;        // File
  var fileBytes = null;   // ArrayBuffer
  var pageCount = 0;
  var outputs = [];       // [{ name, blob, pages }]

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var extractBtn = Mint.el("extractBtn");
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
      extractBtn.disabled = false;
      resetResult();
      Mint.hideProgress("progressWrap");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetResult() {
    resultBox.style.display = "none";
    Mint.el("dlList").innerHTML = "";
    Mint.el("zipBtn").style.display = "none";
    outputs = [];
  }

  function resetAll() {
    file = null; fileBytes = null; pageCount = 0;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    extractBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  extractBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    extractBtn.disabled = true;

    var raw = Mint.el("rangesInput").value;
    var chunks = raw.split(";").map(function (c) { return c.trim(); }).filter(function (c) { return c.length > 0; });
    if (chunks.length === 0) {
      Mint.showAlert("alertBox", "error", "Please enter at least one range (e.g. 1-3; 5; 8-10).");
      extractBtn.disabled = false;
      return;
    }

    var chunkPages = [];
    for (var c = 0; c < chunks.length; c++) {
      try {
        chunkPages.push(Mint.parsePageRanges(chunks[c], pageCount));
      } catch (e) {
        Mint.showAlert("alertBox", "error", "Range " + (c + 1) + " (“" + chunks[c] + "”): " + e.message);
        extractBtn.disabled = false;
        return;
      }
    }

    Mint.setProgress("progressWrap", 10, "Extracting " + chunks.length + (chunks.length === 1 ? " range…" : " ranges…"));
    PDFLib.PDFDocument.load(fileBytes).then(function (src) {
      var chain = Promise.resolve();
      var results = [];
      chunkPages.forEach(function (pages, i) {
        chain = chain.then(function () {
          Mint.setProgress("progressWrap", Math.round(10 + ((i + 1) / chunkPages.length) * 80),
            "Extracting range " + (i + 1) + " of " + chunkPages.length + "…");
          return PDFLib.PDFDocument.create().then(function (out) {
            return out.copyPages(src, pages.map(function (p) { return p - 1; })).then(function (copied) {
              copied.forEach(function (pg) { out.addPage(pg); });
              return out.save();
            }).then(function (bytes) {
              results.push({
                name: "mergemint-extract-" + (i + 1) + ".pdf",
                blob: new Blob([bytes], { type: "application/pdf" }),
                pages: pages.length
              });
            });
          });
        });
      });
      return chain.then(function () { return results; });
    }).then(function (results) {
      outputs = results;
      var totalPages = results.reduce(function (a, r) { return a + r.pages; }, 0);
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + results.length + "</strong>ranges extracted</div>" +
        "<div class='stat'><strong>" + totalPages + "</strong>total pages</div>";
      var dlList = Mint.el("dlList");
      dlList.innerHTML = "";
      results.forEach(function (item) {
        var li = document.createElement("li");
        li.className = "file-item";
        var name = document.createElement("span");
        name.className = "fname";
        name.textContent = item.name + " (" + item.pages + (item.pages === 1 ? " page)" : " pages)");
        name.title = item.name;
        li.appendChild(name);
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn";
        b.textContent = "⬇ Download";
        b.addEventListener("click", function () { Mint.downloadBlob(item.blob, item.name); });
        li.appendChild(b);
        dlList.appendChild(li);
      });
      Mint.el("zipBtn").style.display = results.length > 1 ? "" : "none";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Extraction failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      extractBtn.disabled = false;
    });
  });

  Mint.el("zipBtn").addEventListener("click", function () {
    if (!outputs.length) return;
    Mint.setProgress("progressWrap", 50, "Preparing ZIP…");
    Mint.loadScript(JSZIP_CDN).then(function () {
      var zip = new JSZip();
      outputs.forEach(function (item) { zip.file(item.name, item.blob); });
      return zip.generateAsync({ type: "blob" });
    }).then(function (blob) {
      Mint.hideProgress("progressWrap");
      Mint.downloadBlob(blob, "mergemint-extracted.zip");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not create the ZIP file.");
    });
  });
})();
