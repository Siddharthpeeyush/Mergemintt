/* MergeMint — Crop PDF tool logic. Trims margins by shrinking each page's CropBox.
   100% client-side. Requires pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var cropBtn = Mint.el("cropBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  [["presetNone", 0, 0, 0, 0], ["presetSmall", 18, 18, 18, 18], ["presetLarge", 36, 36, 36, 36]].forEach(function (p) {
    Mint.el(p[0]).addEventListener("click", function () {
      Mint.el("topInput").value = p[1];
      Mint.el("bottomInput").value = p[2];
      Mint.el("leftInput").value = p[3];
      Mint.el("rightInput").value = p[4];
    });
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a PDF file."); return; }
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
      file = f;
      return Mint.readAsArrayBuffer(f);
    }).then(function (bytes) {
      fileBytes = bytes;
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      pageInfo.style.display = "";
      pageInfo.textContent = "📄 “" + file.name + "” — " + pageCount + (pageCount === 1 ? " page, " : " pages, ") + Mint.formatBytes(file.size) + ".";
      optionsBox.style.display = "";
      cropBtn.disabled = false;
      resetResult();
      Mint.hideProgress("progressWrap");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetResult() { resultBox.style.display = "none"; resultBlob = null; }

  function resetAll() {
    file = null; fileBytes = null; pageCount = 0;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    cropBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  cropBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var top = Math.max(0, parseFloat(Mint.el("topInput").value) || 0);
    var bottom = Math.max(0, parseFloat(Mint.el("bottomInput").value) || 0);
    var left = Math.max(0, parseFloat(Mint.el("leftInput").value) || 0);
    var right = Math.max(0, parseFloat(Mint.el("rightInput").value) || 0);
    if (!top && !bottom && !left && !right) {
      Mint.showAlert("alertBox", "error", "Enter at least one margin to trim.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    cropBtn.disabled = true;
    Mint.setProgress("progressWrap", 20, "Cropping pages…");

    PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true }).then(function (doc) {
      var n = doc.getPageCount();
      for (var i = 0; i < n; i++) {
        var page = doc.getPage(i);
        var box = page.getMediaBox();
        var nx = box.x + left;
        var ny = box.y + bottom;
        var nw = box.width - left - right;
        var nh = box.height - top - bottom;
        if (nw < 36 || nh < 36) throw new Error("Margins are larger than the page itself on page " + (i + 1) + ".");
        page.setCropBox(nx, ny, nw, nh);
        if (i % 10 === 0) Mint.setProgress("progressWrap", 20 + Math.round((i / n) * 70), "Cropping page " + (i + 1) + " of " + n + "…");
      }
      return doc.save();
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + pageCount + "</strong>pages cropped</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Cropping failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      cropBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-cropped.pdf");
  });
})();
