/* MergeMint — Split PDF tool logic. Requires pdf-lib (PDFLib), JSZip, and app.js (Mint). */
(function () {
  "use strict";

  var file = null;        // File
  var fileBytes = null;   // ArrayBuffer
  var pageCount = 0;
  var resultBlob = null;
  var resultName = "mergemint-split.pdf";

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var splitBtn = Mint.el("splitBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var rangeBox = Mint.el("rangeBox");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      rangeBox.style.display = (document.querySelector('input[name="mode"]:checked').value === "range") ? "" : "none";
    });
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
      file = f; fileBytes = null; // keep bytes via doc? re-read below
      return Mint.readAsArrayBuffer(f);
    }).then(function (bytes) {
      fileBytes = bytes;
      return PDFLib.PDFDocument.load(bytes);
    }).then(function (doc) {
      pageCount = doc.getPageCount();
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, {
        onRemove: function () { resetAll(); }
      }));
      pageInfo.style.display = "";
      pageInfo.textContent = "📄 “" + file.name + "” has " + pageCount + (pageCount === 1 ? " page." : " pages.");
      optionsBox.style.display = "";
      splitBtn.disabled = false;
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
    splitBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  splitBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var mode = document.querySelector('input[name="mode"]:checked').value;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    splitBtn.disabled = true;

    if (mode === "range") {
      var pages;
      try {
        pages = Mint.parsePageRanges(Mint.el("rangeInput").value, pageCount);
      } catch (e) {
        Mint.showAlert("alertBox", "error", e.message);
        splitBtn.disabled = false;
        return;
      }
      Mint.setProgress("progressWrap", 30, "Extracting " + pages.length + " pages…");
      PDFLib.PDFDocument.load(fileBytes).then(function (src) {
        return PDFLib.PDFDocument.create().then(function (out) {
          return out.copyPages(src, pages.map(function (p) { return p - 1; })).then(function (copied) {
            copied.forEach(function (pg) { out.addPage(pg); });
            return out.save();
          });
        });
      }).then(function (bytes) {
        resultBlob = new Blob([bytes], { type: "application/pdf" });
        resultName = "mergemint-pages.pdf";
        finish(pages.length + " pages extracted", resultBlob.size);
      }).catch(function (err) {
        Mint.showAlert("alertBox", "error", err.message || "Splitting failed.");
      }).then(function () {
        Mint.hideProgress("progressWrap");
        splitBtn.disabled = false;
      });
    } else {
      // Burst into single pages -> ZIP
      if (typeof JSZip === "undefined") {
        Mint.showAlert("alertBox", "error", "The ZIP library failed to load. Check your connection and reload.");
        splitBtn.disabled = false;
        return;
      }
      Mint.setProgress("progressWrap", 10, "Splitting into " + pageCount + " files…");
      PDFLib.PDFDocument.load(fileBytes).then(function (src) {
        var zip = new JSZip();
        var chain = Promise.resolve();
        var indices = src.getPageIndices();
        indices.forEach(function (idx, i) {
          chain = chain.then(function () {
            Mint.setProgress("progressWrap", Math.round(((i + 1) / indices.length) * 90),
              "Page " + (i + 1) + " of " + indices.length + "…");
            return PDFLib.PDFDocument.create().then(function (out) {
              return out.copyPages(src, [idx]).then(function (cp) {
                out.addPage(cp[0]);
                return out.save();
              }).then(function (bytes) {
                zip.file("page-" + (i + 1) + ".pdf", bytes);
              });
            });
          });
        });
        return chain.then(function () {
          Mint.setProgress("progressWrap", 95, "Creating ZIP…");
          return zip.generateAsync({ type: "blob" });
        });
      }).then(function (blob) {
        resultBlob = blob;
        resultName = "mergemint-split-pages.zip";
        finish(pageCount + " single-page PDFs", blob.size);
      }).catch(function (err) {
        Mint.showAlert("alertBox", "error", err.message || "Splitting failed.");
      }).then(function () {
        Mint.hideProgress("progressWrap");
        splitBtn.disabled = false;
      });
    }
  });

  function finish(summary, size) {
    Mint.el("statRow").innerHTML =
      "<div class='stat'><strong>" + summary + "</strong>&nbsp;</div>" +
      "<div class='stat'><strong>" + Mint.formatBytes(size) + "</strong>output size</div>";
    resultBox.style.display = "block";
    resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, resultName);
  });
})();
