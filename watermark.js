/* MergeMint — Watermark PDF tool logic. Requires pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var file = null;        // File
  var fileBytes = null;   // ArrayBuffer
  var pageCount = 0;
  var resultBlob = null;
  var resultName = "mergemint-watermarked.pdf";

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var watermarkBtn = Mint.el("watermarkBtn");
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

  Mint.el("opacityRange").addEventListener("input", function () {
    Mint.el("opLabel").textContent = this.value;
  });
  Mint.el("sizeRange").addEventListener("input", function () {
    Mint.el("wmSizeLabel").textContent = this.value;
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
      watermarkBtn.disabled = false;
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
    watermarkBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  watermarkBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    watermarkBtn.disabled = true;

    var text = Mint.el("wmText").value.trim();
    if (!text) {
      Mint.showAlert("alertBox", "error", "Please enter some watermark text.");
      watermarkBtn.disabled = false;
      return;
    }

    var scope = document.querySelector('input[name="scope"]:checked').value;
    var indices;
    if (scope === "all") {
      indices = [];
      for (var i = 0; i < pageCount; i++) indices.push(i);
    } else {
      try {
        indices = Mint.parsePageRanges(Mint.el("rangeInput").value, pageCount).map(function (p) { return p - 1; });
      } catch (e) {
        Mint.showAlert("alertBox", "error", e.message);
        watermarkBtn.disabled = false;
        return;
      }
    }

    var size = parseInt(Mint.el("sizeRange").value, 10);
    var opacity = parseInt(Mint.el("opacityRange").value, 10) / 100;

    Mint.setProgress("progressWrap", 20, "Adding watermark…");
    PDFLib.PDFDocument.load(fileBytes).then(function (doc) {
      return doc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (font) {
        indices.forEach(function (idx) {
          var page = doc.getPage(idx);
          var tw = font.widthOfTextAtSize(text, size);
          page.drawText(text, {
            x: (page.getWidth() - tw) / 2,
            y: page.getHeight() / 2,
            size: size,
            font: font,
            rotate: PDFLib.degrees(-45),
            opacity: opacity,
            color: PDFLib.rgb(0.55, 0.58, 0.62)
          });
        });
        return doc.save();
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      resultName = "mergemint-watermarked.pdf";
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + indices.length + "</strong>pages watermarked</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Adding the watermark failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      watermarkBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, resultName);
  });
})();
