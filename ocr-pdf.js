/* MergeMint — OCR PDF tool logic. 100% client-side.
   Tesseract.js and pdf.js are lazy-loaded ONLY when this tool runs.
   Requires app.js (Mint) and pdf-lib (PDFLib, for page count / encryption check). */
(function () {
  "use strict";

  var TESS_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  var file = null;        // File object
  var fileBytes = null;   // ArrayBuffer
  var isPdf = false;
  var pageCount = 1;
  var resultText = "";

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var ocrBtn = Mint.el("ocrBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");
  var ocrOutput = Mint.el("ocrOutput");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var ok = f.type === "application/pdf" || /\.pdf$/i.test(f.name) ||
             /^image\/(jpeg|png)$/.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);
    if (!ok) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a PDF, JPG or PNG file."); return; }
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.setProgress("progressWrap", 10, "Reading file…");
    isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      fileBytes = bytes;
      if (!isPdf) {
        file = f; pageCount = 1;
        return loadImageDims(f);
      }
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected, so it can't be read here.");
        file = f;
        pageCount = doc.getPageCount();
      });
    }).then(function () {
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      pageInfo.style.display = "";
      pageInfo.textContent = "📄 “" + file.name + "” — " + (isPdf ? pageCount + (pageCount === 1 ? " page, " : " pages, ") : "") + Mint.formatBytes(file.size) + ".";
      optionsBox.style.display = "";
      ocrBtn.disabled = false;
      resetResult();
      Mint.hideProgress("progressWrap");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this file.");
    });
  }

  function loadImageDims(f) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read this image.")); };
      img.src = url;
    });
  }

  function resetResult() {
    resultBox.style.display = "none";
    ocrOutput.classList.remove("visible");
    ocrOutput.textContent = "";
    resultText = "";
  }

  function resetAll() {
    file = null; fileBytes = null; isPdf = false; pageCount = 1;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    ocrBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  function ensureTesseract() {
    if (typeof Tesseract !== "undefined") return Promise.resolve();
    Mint.setProgress("progressWrap", 5, "Downloading OCR engine (one-time, ~15 MB)…");
    return Mint.loadScript(TESS_CDN).catch(function () {
      throw new Error("The OCR engine failed to download. Check your internet connection and try again.");
    });
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

  /* Render each PDF page to a canvas at 2x scale for good OCR accuracy. */
  function pdfPagesToCanvases(bytes) {
    return ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    }).then(function (pdf) {
      var canvases = [];
      var chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (pageNum) {
          chain = chain.then(function () {
            Mint.setProgress("progressWrap", 10 + Math.round((pageNum / pdf.numPages) * 20), "Preparing page " + pageNum + " of " + pdf.numPages + "…");
            return pdf.getPage(pageNum).then(function (page) {
              var viewport = page.getViewport({ scale: 2 });
              var canvas = document.createElement("canvas");
              canvas.width = Math.floor(viewport.width);
              canvas.height = Math.floor(viewport.height);
              var ctx = canvas.getContext("2d");
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
                canvases.push(canvas);
              });
            });
          });
        })(i);
      }
      return chain.then(function () { return canvases; });
    });
  }

  function imageFileToCanvas(f) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve([canvas]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read this image.")); };
      img.src = url;
    });
  }

  ocrBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var lang = Mint.el("langSel").value;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    ocrBtn.disabled = true;

    var getCanvases = isPdf ? pdfPagesToCanvases(fileBytes) : imageFileToCanvas(file);

    ensureTesseract().then(function () { return getCanvases; }).then(function (canvases) {
      var texts = [];
      var chain = Promise.resolve();
      canvases.forEach(function (canvas, i) {
        chain = chain.then(function () {
          Mint.setProgress("progressWrap", 30 + Math.round((i / canvases.length) * 65),
            "Reading text — page " + (i + 1) + " of " + canvases.length + "…");
          return Tesseract.recognize(canvas, lang, {
            logger: function () { /* progress handled per-page above */ }
          }).then(function (res) {
            var t = (res && res.data && res.data.text ? res.data.text : "").trim();
            texts.push(t ? "--- Page " + (i + 1) + " ---\n" + t : "--- Page " + (i + 1) + " ---\n(no text found)");
          });
        });
      });
      return chain.then(function () { return texts.join("\n\n"); });
    }).then(function (text) {
      resultText = text;
      Mint.setProgress("progressWrap", 100, "Done!");
      var chars = text.replace(/--- Page \d+ ---/g, "").trim().length;
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + pageCount + "</strong>" + (pageCount === 1 ? "page" : "pages") + " scanned</div>" +
        "<div class='stat'><strong>" + chars.toLocaleString("en-IN") + "</strong>characters found</div>";
      ocrOutput.textContent = text;
      ocrOutput.classList.add("visible");
      if (!chars) {
        Mint.showAlert("alertBox", "info", "No readable text was found. Try a clearer scan or photo with good lighting.");
      }
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Text extraction failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      ocrBtn.disabled = false;
    });
  });

  Mint.el("copyBtn").addEventListener("click", function () {
    if (!resultText) return;
    function done() { Mint.showAlert("alertBox", "success", "Text copied to clipboard."); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = resultText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); }
      catch (e) { Mint.showAlert("alertBox", "error", "Could not copy automatically — please select the text manually."); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(resultText).then(done, fallback);
    } else { fallback(); }
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultText) Mint.downloadBlob(new Blob([resultText], { type: "text/plain" }), "mergemint-ocr.txt");
  });
})();
