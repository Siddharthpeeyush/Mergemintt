/* MergeMint — Grayscale PDF tool logic. Re-renders each page in black & white.
   100% client-side. Requires pdf.js (pdfjsLib), pdf-lib (PDFLib), app.js (Mint). */
(function () {
  "use strict";

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var grayBtn = Mint.el("grayBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  function ensurePdfJs() {
    if (typeof pdfjsLib !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
      return Promise.resolve();
    }
    return Mint.loadScript(PDFJS_CDN).then(function () {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
    });
  }

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
      grayBtn.disabled = false;
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
    grayBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  function renderGray(pdfjsDoc, out, pageNum) {
    return pdfjsDoc.getPage(pageNum).then(function (page) {
      var scale = parseFloat(Mint.el("qualitySel").value) || 1.25;
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        // convert to grayscale in place
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var d = img.data;
        for (var i = 0; i < d.length; i += 4) {
          var g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
          d[i] = d[i + 1] = d[i + 2] = g;
        }
        ctx.putImageData(img, 0, 0);
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (b) {
            if (!b) { reject(new Error("Could not render page " + pageNum + ".")); return; }
            b.arrayBuffer().then(function (buf) {
              out.embedJpg(new Uint8Array(buf)).then(function (jpg) {
                var pg = out.addPage([viewport.width, viewport.height]);
                pg.drawImage(jpg, { x: 0, y: 0, width: viewport.width, height: viewport.height });
                resolve();
              }, reject);
            }, reject);
          }, "image/jpeg", 0.85);
        });
      });
    });
  }

  grayBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    grayBtn.disabled = true;
    Mint.setProgress("progressWrap", 5, "Converting to grayscale…");

    ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdfjsDoc) {
      return PDFLib.PDFDocument.create().then(function (out) {
        var chain = Promise.resolve();
        for (var p = 1; p <= pageCount; p++) {
          (function (pageNum) {
            chain = chain.then(function () {
              Mint.setProgress("progressWrap", 5 + Math.round((pageNum / pageCount) * 85),
                "Page " + pageNum + " of " + pageCount + "…");
              return renderGray(pdfjsDoc, out, pageNum);
            });
          })(p);
        }
        return chain.then(function () { return out.save(); });
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + pageCount + "</strong>pages converted</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Conversion failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      grayBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-grayscale.pdf");
  });
})();
