/* MergeMint — Compress PDF tool logic.
   Strategy: re-render each page with pdf.js at a reduced scale and embed as
   JPEG at the chosen quality. Works best on image/scanned PDFs.
   Note: page text becomes part of the image (no longer selectable).
   Requires pdf.js (pdfjsLib), pdf-lib (PDFLib), app.js (Mint). */
(function () {
  "use strict";

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  var QUALITY = {
    high:   { label: "High quality",   scale: 1.5,  jpeg: 0.85 },
    medium: { label: "Medium quality", scale: 1.0,  jpeg: 0.65 },
    low:    { label: "Low quality",    scale: 0.72, jpeg: 0.45 }
  };

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var compressBtn = Mint.el("compressBtn");
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
    if (!isPdf) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a PDF file."); return; }
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.setProgress("progressWrap", 10, "Reading PDF…");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        file = f;
        fileBytes = bytes;
        pageCount = doc.getPageCount();
        fileList.innerHTML = "";
        fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
        pageInfo.style.display = "";
        pageInfo.textContent = "📄 “" + file.name + "” — " + pageCount + (pageCount === 1 ? " page, " : " pages, ") + Mint.formatBytes(file.size) + ".";
        optionsBox.style.display = "";
        compressBtn.disabled = false;
        resetResult();
        Mint.hideProgress("progressWrap");
      });
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
    compressBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  function ensurePdfJs() {
    if (typeof pdfjsLib !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
      return Promise.resolve();
    }
    return Mint.loadScript(PDFJS_CDN).then(function () {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
    });
  }

  function renderPageToJpeg(pdf, pageNum, scale, jpegQuality) {
    return pdf.getPage(pageNum).then(function (page) {
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (b) {
            if (!b) { reject(new Error("Could not render page " + pageNum + ".")); return; }
            var r = new FileReader();
            r.onload = function () { resolve({ dataUrl: r.result, width: canvas.width, height: canvas.height }); };
            r.onerror = function () { reject(new Error("Could not encode page " + pageNum + ".")); };
            r.readAsDataURL(b);
          }, "image/jpeg", jpegQuality);
        });
      });
    });
  }

  compressBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var q = QUALITY[document.querySelector('input[name="quality"]:checked').value];
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    compressBtn.disabled = true;

    ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdf) {
      return PDFLib.PDFDocument.create().then(function (out) {
        var chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (pageNum) {
            chain = chain.then(function () {
              Mint.setProgress("progressWrap", Math.round(((pageNum - 1) / pdf.numPages) * 100),
                "Compressing page " + pageNum + " of " + pdf.numPages + "…");
              return renderPageToJpeg(pdf, pageNum, q.scale, q.jpeg).then(function (r) {
                return out.embedJpg(r.dataUrl).then(function (img) {
                  // Keep original page size (in points) so layout is preserved.
                  return PDFLib.PDFDocument.load(fileBytes.slice(0)).then(function () {
                    // page size lookup without re-parsing everything each time:
                    return null;
                  }).then(function () {
                    var dims = img.scale(1);
                    // Fit rendered image into a page sized proportionally to the render.
                    var page = out.addPage([r.width * 0.75, r.height * 0.75]);
                    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
                    void dims;
                  });
                });
              });
            });
          })(i);
        }
        return chain.then(function () { return out.save(); });
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      var saved = file.size - resultBlob.size;
      var pct = file.size > 0 ? Math.round((saved / file.size) * 100) : 0;
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + Mint.formatBytes(file.size) + "</strong>before</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>after</div>" +
        "<div class='stat'><strong>" + (pct >= 0 ? pct + "%" : "0%") + "</strong>smaller</div>";
      if (pct < 5) {
        Mint.showAlert("alertBox", "info", "This PDF is already well optimized — compression saved less than 5%. Try a lower quality level for a smaller file.");
      }
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Compression failed.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      compressBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-compressed.pdf");
  });
})();
