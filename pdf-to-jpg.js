/* MergeMint — PDF to JPG tool logic.
   Strategy: read the PDF (pdf-lib for page count + encryption check),
   then render each page with pdf.js onto a canvas and export as JPEG/PNG.
   Requires pdf-lib (PDFLib), app.js (Mint). pdf.js and JSZip are lazy-loaded. */
(function () {
  "use strict";

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  var JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var results = []; // {blob, name}

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var convertBtn = Mint.el("pdfJpgBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  Mint.el("formatSel").addEventListener("change", function () {
    Mint.el("qualityRow").style.display = Mint.el("formatSel").value === "png" ? "none" : "";
  });
  Mint.el("qualityRange").addEventListener("input", function () {
    Mint.el("qualityLabel").textContent = Mint.el("qualityRange").value + "%";
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
        convertBtn.disabled = false;
        resetResult();
        Mint.hideProgress("progressWrap");
      });
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetResult() {
    resultBox.style.display = "none";
    results = [];
    Mint.el("dlList").innerHTML = "";
    Mint.el("zipBtn").style.display = "none";
  }

  function resetAll() {
    file = null; fileBytes = null; pageCount = 0;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    convertBtn.disabled = true;
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

  function renderPage(pdf, pageNum, scale, mime, quality) {
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
            resolve(b);
          }, mime, mime === "image/jpeg" ? quality : undefined);
        });
      });
    });
  }

  convertBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var fmt = Mint.el("formatSel").value; // "jpeg" | "png"
    var scale = parseFloat(Mint.el("scaleSel").value);
    var quality = parseInt(Mint.el("qualityRange").value, 10) / 100;
    var mime = fmt === "jpeg" ? "image/jpeg" : "image/png";
    var ext = fmt === "jpeg" ? ".jpg" : ".png";
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    convertBtn.disabled = true;

    ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdf) {
      results = [];
      var chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (pageNum) {
          chain = chain.then(function () {
            Mint.setProgress("progressWrap", Math.round(((pageNum - 1) / pdf.numPages) * 100),
              "Rendering page " + pageNum + " of " + pdf.numPages + "…");
            return renderPage(pdf, pageNum, scale, mime, quality).then(function (blob) {
              results.push({ blob: blob, name: "mergemint-page-" + pageNum + ext });
            });
          });
        })(i);
      }
      return chain;
    }).then(function () {
      Mint.setProgress("progressWrap", 100, "Done!");
      var totalOut = results.reduce(function (a, r) { return a + r.blob.size; }, 0);
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + results.length + "</strong>pages converted</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(totalOut) + "</strong>total image size</div>";
      var dlList = Mint.el("dlList");
      dlList.innerHTML = "";
      results.forEach(function (r) {
        var li = document.createElement("li");
        li.className = "file-item";
        var name = document.createElement("span");
        name.className = "fname";
        name.textContent = r.name + " (" + Mint.formatBytes(r.blob.size) + ")";
        name.title = r.name;
        li.appendChild(name);
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn";
        b.textContent = "⬇ Download";
        b.addEventListener("click", function () { Mint.downloadBlob(r.blob, r.name); });
        li.appendChild(b);
        dlList.appendChild(li);
      });
      Mint.el("zipBtn").style.display = results.length > 1 ? "" : "none";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Conversion failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      convertBtn.disabled = false;
    });
  });

  Mint.el("zipBtn").addEventListener("click", function () {
    if (!results.length) return;
    Mint.setProgress("progressWrap", 50, "Preparing ZIP…");
    Mint.loadScript(JSZIP_CDN).then(function () {
      var zip = new JSZip();
      results.forEach(function (r) { zip.file(r.name, r.blob); });
      return zip.generateAsync({ type: "blob" });
    }).then(function (blob) {
      Mint.hideProgress("progressWrap");
      Mint.downloadBlob(blob, "mergemint-pages.zip");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not create the ZIP file.");
    });
  });
})();
