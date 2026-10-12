/* MergeMint — Compress PDF tool logic.
   Two modes:
   - "quality": re-render each page at a fixed quality level.
   - "target": probe once, estimate the settings needed to land under the
     user's target file size, verify, and adjust once if needed.
   Strategy: re-render each page with pdf.js and embed as JPEG.
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
  // scale/jpeg ladder for target-size search, strongest first
  var LADDER = [
    [1.5, 0.85], [1.25, 0.78], [1.0, 0.65], [0.85, 0.58],
    [0.7, 0.5], [0.6, 0.42], [0.5, 0.35]
  ];

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;
  var pdfjsDoc = null;

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

  document.querySelectorAll('input[name="cmode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var target = document.querySelector('input[name="cmode"]:checked').value === "target";
      Mint.el("qualityBox").style.display = target ? "none" : "";
      Mint.el("targetBox").style.display = target ? "" : "none";
    });
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) { Mint.showAlert("alertBox", "error", "\u201C" + f.name + "\u201D is not a PDF file."); return; }
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.setProgress("progressWrap", 10, "Reading PDF\u2026");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        file = f;
        fileBytes = bytes;
        pageCount = doc.getPageCount();
        fileList.innerHTML = "";
        fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
        pageInfo.style.display = "";
        pageInfo.textContent = "\uD83D\uDCC4 \u201C" + file.name + "\u201D \u2014 " + pageCount + (pageCount === 1 ? " page, " : " pages, ") + Mint.formatBytes(file.size) + ".";
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
    file = null; fileBytes = null; pageCount = 0; pdfjsDoc = null;
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

  /* Build the compressed PDF at the given settings. Resolves to Uint8Array. */
  function buildCompressed(scale, jpegQuality, label) {
    return PDFLib.PDFDocument.create().then(function (out) {
      var chain = Promise.resolve();
      for (var i = 1; i <= pdfjsDoc.numPages; i++) {
        (function (pageNum) {
          chain = chain.then(function () {
            if (label) Mint.setProgress("progressWrap",
              Math.round(((pageNum - 1) / pdfjsDoc.numPages) * 100),
              label + " \u2014 page " + pageNum + " of " + pdfjsDoc.numPages + "\u2026");
            return renderPageToJpeg(pdfjsDoc, pageNum, scale, jpegQuality).then(function (r) {
              return out.embedJpg(r.dataUrl).then(function (img) {
                var page = out.addPage([r.width * 0.75, r.height * 0.75]);
                page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
              });
            });
          });
        })(i);
      }
      return chain.then(function () { return out.save(); });
    });
  }

  function showStats(note) {
    var saved = file.size - resultBlob.size;
    var pct = file.size > 0 ? Math.round((saved / file.size) * 100) : 0;
    Mint.el("statRow").innerHTML =
      "<div class='stat'><strong>" + Mint.formatBytes(file.size) + "</strong>before</div>" +
      "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>after</div>" +
      "<div class='stat'><strong>" + (pct >= 0 ? pct + "%" : "0%") + "</strong>smaller</div>";
    if (note) Mint.showAlert("alertBox", "info", note);
    else if (pct < 5) {
      Mint.showAlert("alertBox", "info", "This PDF is already well optimized \u2014 compression saved less than 5%. Try a lower quality level for a smaller file.");
    }
    resultBox.style.display = "block";
    resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function runQualityMode() {
    var q = QUALITY[document.querySelector('input[name="quality"]:checked').value];
    return ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdf) {
      pdfjsDoc = pdf;
      return buildCompressed(q.scale, q.jpeg, "Compressing (" + q.label + ")");
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      showStats(null);
    });
  }

  function runTargetMode() {
    var targetMB = parseFloat(Mint.el("targetSize").value);
    if (!targetMB || targetMB <= 0) throw new Error("Please enter a target size in MB (e.g. 2).");
    var target = Math.round(targetMB * 1024 * 1024);
    if (target >= file.size) {
      throw new Error("This PDF is already " + Mint.formatBytes(file.size) + ", which is under your " +
        targetMB + " MB target \u2014 no compression needed.");
    }
    var best = null; // {bytes, scale, jpeg}
    return ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdf) {
      pdfjsDoc = pdf;
      // 1. probe at medium
      return buildCompressed(1.0, 0.65, "Probing compression");
    }).then(function (probe) {
      if (probe.length <= target) {
        // Already under target at medium \u2014 try high for better quality.
        best = { bytes: probe, scale: 1.0, jpeg: 0.65 };
        return buildCompressed(1.5, 0.85, "Trying higher quality").then(function (hi) {
          if (hi.length <= target) best = { bytes: hi, scale: 1.5, jpeg: 0.85 };
          return best;
        });
      }
      // 2. estimate the scale needed (size \u2248 scale^2 * quality)
      var f = Math.sqrt(target / probe.length);
      var wantScale = Math.max(0.5, 1.0 * f * 0.92);
      var pick = LADDER[LADDER.length - 1];
      for (var i = 0; i < LADDER.length; i++) {
        if (LADDER[i][0] <= wantScale + 0.001) { pick = LADDER[i]; break; }
      }
      return buildCompressed(pick[0], pick[1], "Compressing toward " + targetMB + " MB").then(function (bytes) {
        if (bytes.length <= target) return { bytes: bytes, scale: pick[0], jpeg: pick[1], hit: true };
        // 3. last resort: lowest settings
        return buildCompressed(0.5, 0.35, "Trying maximum compression").then(function (low) {
          return { bytes: low, scale: 0.5, jpeg: 0.35, hit: low.length <= target };
        });
      });
    }).then(function (r) {
      resultBlob = new Blob([r.bytes], { type: "application/pdf" });
      var note = r.hit === false
        ? "Could not reach " + targetMB + " MB \u2014 the smallest achievable is " + Mint.formatBytes(resultBlob.size) + ". This usually means the PDF is mostly text, which is already compact."
        : "Target hit: " + Mint.formatBytes(resultBlob.size) + " (goal: under " + targetMB + " MB).";
      showStats(note);
    });
  }

  compressBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var mode = document.querySelector('input[name="cmode"]:checked').value;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    compressBtn.disabled = true;
    var job = mode === "target" ? runTargetMode() : runQualityMode();
    job.catch(function (err) {
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
