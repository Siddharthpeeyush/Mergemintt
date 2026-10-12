/* MergeMint — Sign PDF tool logic (electronic signature).
   The user draws a signature on a canvas; on "Sign PDF" it is embedded as a
   transparent PNG onto the chosen page of a fresh copy of the document.
   100% client-side. Requires pdf-lib (PDFLib), app.js (Mint). */
(function () {
  "use strict";

  var MARGIN = 50;
  var BASE_SIG_WIDTH = 170; // pt at 100% size

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;

  /* visual position editor: signature CENTER as page fractions */
  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  var sigCX = 0.72, sigCY = 0.78;
  var pagePtW = 0, pagePtH = 0, previewScale = 1;
  var draggingSig = false;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var signBtn = Mint.el("signBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");
  var pad = Mint.el("sigPad");

  var padCtx = null;
  var padReady = false;
  var drawing = false;
  var hasDrawn = false;

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  /* ---------- visual position editor ---------- */
  function ensurePdfJs() {
    if (typeof pdfjsLib !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
      return Promise.resolve();
    }
    return Mint.loadScript(PDFJS_CDN).then(function () {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
    });
  }

  function previewPageNum() {
    var n = parseInt(Mint.el("pageInput").value, 10);
    return (isNaN(n) || n < 1) ? 1 : Math.min(n, pageCount || 1);
  }

  function isTypeMode() {
    return document.querySelector('input[name="sigmode"]:checked').value === "type";
  }

  function typedSigDataURL(scale) {
    var name = Mint.el("sigName").value.trim() || "Your Name";
    var font = Mint.el("sigFont").value;
    var family = font === "cursive" ? "'Segoe Script','Brush Script MT','Apple Chancery',cursive"
      : font === "serif" ? "Georgia,'Times New Roman',serif" : "Verdana,Geneva,sans-serif";
    var c = document.createElement("canvas");
    c.width = Math.round(600 * scale); c.height = Math.round(220 * scale);
    var x = c.getContext("2d");
    x.fillStyle = "#1e293b";
    var fs = 96 * scale;
    x.font = fs + "px " + family;
    x.textBaseline = "middle";
    var w = x.measureText(name).width;
    if (w > 560 * scale) { fs = fs * 560 * scale / w; x.font = fs + "px " + family; }
    x.fillText(name, 20 * scale, 115 * scale);
    return c.toDataURL("image/png");
  }

  function sigOverlayURL() {
    if (isTypeMode()) return typedSigDataURL(0.5);
    if (!padReady || !hasDrawn) return null;
    return pad.toDataURL("image/png");
  }

  function sigDrawSize() {
    var sizePct = (parseInt(Mint.el("sizeRange").value, 10) || 100) / 100;
    var aspect = (pad.width || 600) / (pad.height || 220);
    var dw = BASE_SIG_WIDTH * sizePct;
    return { w: dw, h: dw / aspect };
  }

  function paintSigOverlay() {
    var ov = Mint.el("signOverlay"), img = Mint.el("signOverlayImg");
    if (!ov || !img || !pagePtW) return;
    var url = sigOverlayURL();
    img.style.display = url ? "" : "none";
    if (url) img.src = url;
    var d = sigDrawSize();
    img.style.width = Math.max(24, Math.round(d.w * previewScale)) + "px";
    ov.style.left = (sigCX * 100) + "%";
    ov.style.top = (sigCY * 100) + "%";
    ov.style.transform = "translate(-50%,-50%)";
  }

  function renderPreview() {
    if (!fileBytes) return Promise.resolve();
    var n = previewPageNum();
    return ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdfDoc) {
      return pdfDoc.getPage(n);
    }).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      pagePtW = vp1.width; pagePtH = vp1.height;
      var scale = Math.min(1.5, 560 / vp1.width);
      var vp = page.getViewport({ scale: scale });
      previewScale = scale;
      var canvas = Mint.el("signPreviewCanvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }).then(function () {
      paintSigOverlay();
    }).catch(function (e) {
      if (window.console) console.warn("Sign preview failed:", e && e.message);
    });
  }

  (function initSigDrag() {
    var ov = Mint.el("signOverlay"), stage = Mint.el("signStage");
    if (!ov || !stage) return;
    ov.addEventListener("pointerdown", function (e) {
      draggingSig = true;
      try { ov.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    ov.addEventListener("pointermove", function (e) {
      if (!draggingSig) return;
      var r = stage.getBoundingClientRect();
      sigCX = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width));
      sigCY = Math.min(0.98, Math.max(0.02, (e.clientY - r.top) / r.height));
      ov.style.left = (sigCX * 100) + "%";
      ov.style.top = (sigCY * 100) + "%";
    });
    ["pointerup", "pointercancel"].forEach(function (t) {
      ov.addEventListener(t, function () { draggingSig = false; });
    });
  })();

  /* ---------- signature pad ---------- */
  function initPad() {
    // Size the canvas to its displayed width (optionsBox is visible by now).
    pad.width = pad.offsetWidth || 600;
    pad.height = 220;
    padCtx = pad.getContext("2d");
    padCtx.lineWidth = 3;
    padCtx.lineCap = "round";
    padCtx.lineJoin = "round";
    padCtx.strokeStyle = "#1e293b";
    padReady = true;
  }

  function padPoint(e) {
    var r = pad.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (pad.width / r.width),
      y: (e.clientY - r.top) * (pad.height / r.height)
    };
  }

  pad.addEventListener("pointerdown", function (e) {
    if (!padReady) return;
    e.preventDefault();
    drawing = true;
    hasDrawn = true;
    var p = padPoint(e);
    padCtx.beginPath();
    padCtx.moveTo(p.x, p.y);
    try { pad.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  });

  pad.addEventListener("pointermove", function (e) {
    if (!drawing || !padReady) return;
    e.preventDefault();
    var p = padPoint(e);
    padCtx.lineTo(p.x, p.y);
    padCtx.stroke();
  });

  function endStroke() { drawing = false; paintSigOverlay(); }
  pad.addEventListener("pointerup", endStroke);
  pad.addEventListener("pointercancel", endStroke);
  pad.addEventListener("pointerleave", endStroke);

  Mint.el("clearSigBtn").addEventListener("click", function () {
    if (!padReady) return;
    padCtx.clearRect(0, 0, pad.width, pad.height);
    hasDrawn = false;
    Mint.hideAlert("alertBox");
  });

  /* ---------- typed signature ---------- */
  document.querySelectorAll('input[name="sigmode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var isType = document.querySelector('input[name="sigmode"]:checked').value === "type";
      Mint.el("drawBox").style.display = isType ? "none" : "";
      Mint.el("typeBox").style.display = isType ? "" : "none";
      if (isType) updateSigPreview();
      paintSigOverlay();
    });
  });

  function updateSigPreview() {
    var name = Mint.el("sigName").value.trim() || "Your Name";
    var font = Mint.el("sigFont").value;
    var prev = Mint.el("sigPreview");
    prev.textContent = name;
    prev.style.fontFamily = font === "cursive" ? "'Segoe Script','Brush Script MT',cursive"
      : font === "serif" ? "Georgia,'Times New Roman',serif" : "Verdana,Geneva,sans-serif";
  }
  Mint.el("sigName").addEventListener("input", function () { updateSigPreview(); paintSigOverlay(); });
  Mint.el("sigFont").addEventListener("change", function () { updateSigPreview(); paintSigOverlay(); });
  Mint.el("sizeRange").addEventListener("input", function () {
    Mint.el("sigSizeLabel").textContent = Mint.el("sizeRange").value;
    paintSigOverlay();
  });
  Mint.el("pageInput").addEventListener("change", renderPreview);

  function typedSigPngBytes() {
    return new Promise(function (resolve, reject) {
      var name = Mint.el("sigName").value.trim();
      if (!name) { reject(new Error("Please type your name for the signature.")); return; }
      var font = Mint.el("sigFont").value;
      var family = font === "cursive" ? "'Segoe Script','Brush Script MT','Apple Chancery',cursive"
        : font === "serif" ? "Georgia,'Times New Roman',serif" : "Verdana,Geneva,sans-serif";
      var c = document.createElement("canvas");
      c.width = 600; c.height = 220;
      var x = c.getContext("2d");
      x.fillStyle = "#1e293b";
      x.font = "96px " + family;
      x.textBaseline = "middle";
      // shrink to fit
      var w = x.measureText(name).width;
      if (w > 560) { x.font = Math.floor(96 * 560 / w) + "px " + family; }
      x.fillText(name, 20, 115);
      c.toBlob(function (b) {
        if (!b) { reject(new Error("Could not create your signature.")); return; }
        b.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); },
          function () { reject(new Error("Could not create your signature.")); });
      }, "image/png");
    });
  }

  /* ---------- file handling ---------- */
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
        if (!padReady) initPad();
        signBtn.disabled = false;
        resetResult();
        Mint.hideProgress("progressWrap");
        renderPreview();
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
    signBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  function padToPngBytes() {
    return new Promise(function (resolve, reject) {
      pad.toBlob(function (b) {
        if (!b) { reject(new Error("Could not capture your signature.")); return; }
        b.arrayBuffer().then(function (buf) {
          resolve(new Uint8Array(buf));
        }, function () {
          reject(new Error("Could not capture your signature."));
        });
      }, "image/png");
    });
  }

  /* ---------- sign ---------- */
  signBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var isType = document.querySelector('input[name="sigmode"]:checked').value === "type";
    if (!isType && !hasDrawn) { Mint.showAlert("alertBox", "error", "Please draw your signature first."); return; }
    var pageNum = parseInt(Mint.el("pageInput").value, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > pageCount) {
      Mint.showAlert("alertBox", "error", "Enter a page number between 1 and " + pageCount + ".");
      return;
    }
    var sizePct = (parseInt(Mint.el("sizeRange").value, 10) || 100) / 100;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    signBtn.disabled = true;
    Mint.setProgress("progressWrap", 20, "Placing signature…");

    (isType ? typedSigPngBytes() : padToPngBytes()).then(function (pngBytes) {
      return PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true }).then(function (src) {
        if (src.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        return PDFLib.PDFDocument.create().then(function (out) {
          var indices = [];
          for (var i = 0; i < src.getPageCount(); i++) indices.push(i);
          return out.copyPages(src, indices).then(function (pages) {
            pages.forEach(function (p) { out.addPage(p); });
            return out.embedPng(pngBytes).then(function (img) {
              var d = sigDrawSize();
              var page = out.getPage(pageNum - 1);
              // drag position: signature center as page fractions
              var x = sigCX * page.getWidth() - d.w / 2;
              var y = (1 - sigCY) * page.getHeight() - d.h / 2;
              page.drawImage(img, { x: x, y: y, width: d.w, height: d.h });
              return out.save();
            });
          });
        });
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>1</strong>signature placed</div>" +
        "<div class='stat'><strong>Page " + pageNum + "</strong>of " + pageCount + " pages</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Could not sign the PDF. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      signBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-signed.pdf");
  });
})();
