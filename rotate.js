/* MergeMint — Rotate PDF tool logic. Requires pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var file = null;        // File
  var fileBytes = null;   // ArrayBuffer
  var pageCount = 0;
  var resultBlob = null;
  var resultName = "mergemint-rotated.pdf";

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var rotateBtn = Mint.el("rotateBtn");
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

  document.querySelectorAll('input[name="scope"]').forEach(function (r) {
    r.addEventListener("change", function () {
      rangeBox.style.display = (document.querySelector('input[name="scope"]:checked').value === "pages") ? "" : "none";
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
      rotateBtn.disabled = false;
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
    rotateBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  function targetIndices() {
    var scope = document.querySelector('input[name="scope"]:checked').value;
    if (scope === "all") {
      var all = [];
      for (var i = 0; i < pageCount; i++) all.push(i);
      return all;
    }
    return Mint.parsePageRanges(Mint.el("rangeInput").value, pageCount).map(function (p) { return p - 1; });
  }

  rotateBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    var angle = parseInt(document.querySelector('input[name="angle"]:checked').value, 10);
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    rotateBtn.disabled = true;

    var indices;
    try {
      indices = targetIndices();
    } catch (e) {
      Mint.showAlert("alertBox", "error", e.message);
      rotateBtn.disabled = false;
      return;
    }

    Mint.setProgress("progressWrap", 25, "Rotating " + indices.length + (indices.length === 1 ? " page…" : " pages…"));
    PDFLib.PDFDocument.load(fileBytes).then(function (doc) {
      indices.forEach(function (idx) {
        var page = doc.getPage(idx);
        page.setRotation(PDFLib.degrees(page.getRotation().angle + angle));
      });
      return doc.save();
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      resultName = "mergemint-rotated.pdf";
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + indices.length + "</strong>pages rotated</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Rotating failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      rotateBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, resultName);
  });
})();
