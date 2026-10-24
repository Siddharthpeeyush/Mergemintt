/* MergeMint — Target Size tool logic.
   Images: binary-search JPEG/WebP quality until the file lands at or under
   the target size. PNG is lossless, so an over-target PNG is offered as JPEG.
   PDFs: re-render pages as JPEGs (like the Compress tool) and walk a
   quality ladder until one build lands under target. PDF pages become
   images, so text is no longer selectable in the output.
   Requires app.js (Mint). PDF mode also needs pdf.js (lazy) + pdf-lib. */
(function () {
  "use strict";

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  var LADDER = [
    [1.5, 0.85], [1.25, 0.78], [1.0, 0.65], [0.85, 0.58],
    [0.7, 0.5], [0.6, 0.42], [0.5, 0.35]
  ];

  var file = null, fileBytes = null, isPdf = false, resultBlob = null, resultName = "";

  Mint.setupDropzone("dropzone", {
    input: Mint.el("fileInput"),
    accept: ".pdf,.jpg,.jpeg,.png,.webp",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var ok = /\.pdf$/i.test(f.name) || /^image\//.test(f.type) || /\.(jpg|jpeg|png|webp)$/i.test(f.name);
    if (!ok) { Mint.showAlert("alertBox", "error", "Please upload a PDF or an image (JPG, PNG, WebP)."); return; }
    isPdf = /\.pdf$/i.test(f.name);
    file = f; resultBlob = null; resultName = "";
    Mint.el("fileList").innerHTML = "";
    Mint.el("fileList").appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
    Mint.el("pageInfo").style.display = "";
    Mint.el("pageInfo").textContent = (isPdf ? "PDF" : "Image") + " — " + Mint.formatBytes(file.size) + ". Pick a target size and go.";
    Mint.el("optionsBox").style.display = "";
    Mint.el("pdfNote").style.display = isPdf ? "" : "none";
    Mint.el("imgNote").style.display = isPdf ? "none" : "";
    Mint.el("targetBtn").disabled = false;
    Mint.el("resultBox").style.display = "none";
    if (isPdf) { Mint.readAsArrayBuffer(f).then(function (b) { fileBytes = b; }); }
  }

  function resetAll() {
    file = null; fileBytes = null; resultBlob = null;
    Mint.el("fileList").innerHTML = "";
    Mint.el("pageInfo").style.display = "none";
    Mint.el("optionsBox").style.display = "none";
    Mint.el("targetBtn").disabled = true;
    Mint.el("resultBox").style.display = "none";
    Mint.hideAlert("alertBox");
  }

  function targetBytes() {
    var kb = parseFloat(Mint.el("targetSize").value);
    if (!kb || kb <= 0) return 0;
    return Math.floor(kb * 1024);
  }

  function blobToBytes(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(new Error("Could not read the result.")); };
      r.readAsArrayBuffer(blob);
    });
  }

  function canvasToBlob(canvas, mime, q) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error("Could not encode the image.")); }, mime, q);
    });
  }

  function loadImage(f) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { reject(new Error("Could not read this image.")); };
      img.src = url;
    });
  }

  function shrinkImage() {
    var target = targetBytes();
    var format = Mint.el("formatSel").value;
    if (format === "png") {
      if (file.size <= target) {
        resultBlob = file; resultName = file.name;
        return Promise.resolve({ hit: true, note: "Already under target — original kept as-is." });
      }
      throw new Error("PNG is lossless, so it cannot shrink to your target. Pick JPEG or WebP instead.");
    }
    var mime = format === "webp" ? "image/webp" : "image/jpeg";
    return loadImage(file).then(function (img) {
      var canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      var ctx = canvas.getContext("2d");
      if (mime === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(img, 0, 0);
      var lo = 0.2, hi = 0.95, best = null, bestSize = Infinity;
      var chain = Promise.resolve();
      for (var i = 0; i < 9; i++) {
        (function () {
          var q = (lo + hi) / 2;
          chain = chain.then(function () {
            return canvasToBlob(canvas, mime, q).then(function (b) {
              if (b.size <= target) { best = b; bestSize = b.size; lo = q; }
              else { hi = q; }
            });
          });
        })();
      }
      return chain.then(function () {
        if (best) {
          resultBlob = best;
          resultName = file.name.replace(/\.[^.]+$/, "") + "-target." + format;
          return { hit: true, note: "Landed under target." };
        }
        return canvasToBlob(canvas, mime, 0.2).then(function (b) {
          resultBlob = b;
          resultName = file.name.replace(/\.[^.]+$/, "") + "-smallest." + format;
          return { hit: false, note: "Even the lowest quality is above your target. This is the smallest version — try a larger target or resize the image smaller first." };
        });
      });
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

  function renderPageToJpeg(pdf, pageNum, scale, quality) {
    return pdf.getPage(pageNum).then(function (page) {
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        return canvasToBlob(canvas, "image/jpeg", quality);
      });
    });
  }

  function buildPdf(scale, quality, pdfDoc) {
    var out = PDFLib.PDFDocument.create();
    var chain = Promise.resolve();
    for (var p = 1; p <= pdfDoc.numPages; p++) {
      (function (pageNum) {
        chain = chain.then(function () {
          return renderPageToJpeg(pdfDoc, pageNum, scale, quality).then(function (blob) {
            return blobToBytes(blob).then(function (bytes) {
              return out.embedJpg(bytes).then(function (img) {
                var page = out.addPage([img.width, img.height]);
                page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
              });
            });
          });
        });
      })(p);
    }
    return chain.then(function () { return out.save(); });
  }

  function shrinkPdf() {
    var target = targetBytes();
    if (typeof PDFLib === "undefined") throw new Error("The PDF library failed to load. Check your connection and reload.");
    return ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdfDoc) {
      var smallest = null, smallestSize = Infinity, chain = Promise.resolve(), hit = false;
      LADDER.forEach(function (step) {
        chain = chain.then(function () {
          if (hit) return;
          Mint.setProgress("progressWrap", 10, "Trying quality level " + step[1] + "…");
          return buildPdf(step[0], step[1], pdfDoc).then(function (bytes) {
            if (bytes.length < smallestSize) { smallest = bytes; smallestSize = bytes.length; }
            if (bytes.length <= target) {
              hit = true;
              resultBlob = new Blob([bytes], { type: "application/pdf" });
              resultName = file.name.replace(/\.pdf$/i, "") + "-target.pdf";
            }
          });
        });
      });
      return chain.then(function () {
        if (!hit) {
          resultBlob = new Blob([smallest], { type: "application/pdf" });
          resultName = file.name.replace(/\.pdf$/i, "") + "-smallest.pdf";
          return { hit: false, note: "No quality level reached your target. This is the smallest version — try a larger target." };
        }
        return { hit: true, note: "Landed under target. Note: PDF pages became images, so text is no longer selectable." };
      });
    });
  }

  Mint.el("targetBtn").addEventListener("click", function () {
    if (!file) return;
    var target = targetBytes();
    if (!target) { Mint.showAlert("alertBox", "error", "Enter a target size in KB (for example 200)."); return; }
    Mint.hideAlert("alertBox");
    Mint.el("resultBox").style.display = "none";
    Mint.setProgress("progressWrap", 5, "Working…");
    var job;
    try { job = isPdf ? shrinkPdf() : shrinkImage(); }
    catch (e) { job = Promise.reject(e); }
    job.then(function (res) {
      Mint.hideProgress("progressWrap");
      Mint.el("resultBox").style.display = "";
      Mint.el("statRow").innerHTML = "";
      var s1 = document.createElement("div"); s1.className = "stat";
      s1.textContent = "Before: " + Mint.formatBytes(file.size);
      var s2 = document.createElement("div"); s2.className = "stat";
      s2.textContent = "After: " + Mint.formatBytes(resultBlob.size) + " (" + Math.max(0, Math.round((1 - resultBlob.size / file.size) * 100)) + "% smaller)";
      var s3 = document.createElement("div"); s3.className = "stat";
      s3.textContent = "Target: " + Mint.formatBytes(target) + " — " + (res.hit ? "HIT ✓" : "MISSED");
      Mint.el("statRow").appendChild(s1); Mint.el("statRow").appendChild(s2); Mint.el("statRow").appendChild(s3);
      Mint.el("resultNote").textContent = res.note;
      Mint.el("downloadBtn").disabled = false;
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Something went wrong.");
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, resultName);
  });
})();
