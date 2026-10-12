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

  /* ---- visual position editor ---- */
  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  var wmCX = 0.5, wmCY = 0.5;          // watermark center as page fractions
  var pagePtW = 0, pagePtH = 0;        // page 1 size in points
  var previewScale = 1;                // canvas px per point
  var wmImgObjUrl = null;              // overlay image object URL
  var draggingWm = false;

  function ensurePdfJs() {
    if (typeof pdfjsLib !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
      return Promise.resolve();
    }
    return Mint.loadScript(PDFJS_CDN).then(function () {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
    });
  }

  function renderPreview() {
    if (!fileBytes) return Promise.resolve();
    return ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdfDoc) {
      return pdfDoc.getPage(1);
    }).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      pagePtW = vp1.width; pagePtH = vp1.height;
      var targetW = 560;
      var scale = Math.min(1.5, targetW / vp1.width);
      var vp = page.getViewport({ scale: scale });
      previewScale = scale;
      var canvas = Mint.el("wmPreview");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }).then(function () {
      paintOverlay();
    }).catch(function (e) { if (window.console) console.warn('Watermark preview failed:', e && e.message); });
  }

  function paintOverlay() {
    var ov = Mint.el("wmOverlay");
    var stage = Mint.el("wmStage");
    if (!pagePtW || !stage) return;
    var wmType = document.querySelector('input[name="wmtype"]:checked').value;
    var size = parseInt(Mint.el("sizeRange").value, 10) || 60;
    var opacity = (parseInt(Mint.el("opacityRange").value, 10) || 30) / 100;
    var rotation = parseInt(Mint.el("rotRange").value, 10) || 0;
    var color = Mint.el("wmColor").value || "#8b9096";
    ov.style.left = (wmCX * 100) + "%";
    ov.style.top = (wmCY * 100) + "%";
    ov.style.transform = "translate(-50%,-50%) rotate(" + rotation + "deg)";
    ov.style.opacity = opacity;
    if (wmType === "image" && wmImageFile) {
      if (!wmImgObjUrl) wmImgObjUrl = URL.createObjectURL(wmImageFile);
      ov.innerHTML = "";
      var im = document.createElement("img");
      im.src = wmImgObjUrl;
      im.alt = "Watermark image";
      // match export sizing: max 70% of page, scaled by size/60
      im.style.width = Math.round(pagePtW * 0.7 * (size / 60) * previewScale) + "px";
      ov.appendChild(im);
    } else {
      if (wmImgObjUrl) { URL.revokeObjectURL(wmImgObjUrl); wmImgObjUrl = null; }
      var text = Mint.el("wmText").value.trim() || "Watermark";
      ov.textContent = text;
      ov.style.fontSize = Math.max(8, Math.round(size * previewScale)) + "px";
      ov.style.color = color;
    }
  }

  (function initWmDrag() {
    var ov = Mint.el("wmOverlay"), stage = Mint.el("wmStage");
    if (!ov || !stage) return;
    ov.addEventListener("pointerdown", function (e) {
      draggingWm = true;
      try { ov.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    ov.addEventListener("pointermove", function (e) {
      if (!draggingWm) return;
      var r = stage.getBoundingClientRect();
      wmCX = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      wmCY = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      ov.style.left = (wmCX * 100) + "%";
      ov.style.top = (wmCY * 100) + "%";
    });
    ["pointerup", "pointercancel"].forEach(function (t) {
      ov.addEventListener(t, function () { draggingWm = false; });
    });
  })();

  ["wmText", "wmColor"].forEach(function (id) {
    Mint.el(id).addEventListener("input", paintOverlay);
  });
  ["opacityRange", "sizeRange", "rotRange"].forEach(function (id) {
    Mint.el(id).addEventListener("input", paintOverlay);
  });

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
  Mint.el("rotRange").addEventListener("input", function () {
    Mint.el("rotLabel").textContent = this.value + "°";
  });

  var wmImageFile = null;
  document.querySelectorAll('input[name="wmtype"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var isImg = document.querySelector('input[name="wmtype"]:checked').value === "image";
      Mint.el("wmTextRow").style.display = isImg ? "none" : "";
      Mint.el("wmImageRow").style.display = isImg ? "" : "none";
      if (wmImgObjUrl) { URL.revokeObjectURL(wmImgObjUrl); wmImgObjUrl = null; }
      paintOverlay();
    });
  });
  Mint.el("wmImage").addEventListener("change", function () {
    wmImageFile = this.files && this.files[0] ? this.files[0] : null;
    Mint.el("wmImageName").textContent = wmImageFile ? wmImageFile.name : "No image chosen";
    if (wmImgObjUrl) { URL.revokeObjectURL(wmImgObjUrl); wmImgObjUrl = null; }
    paintOverlay();
  });

  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    var v = parseInt(h, 16);
    return PDFLib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
  }

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
      wmCX = 0.5; wmCY = 0.5;
      renderPreview();
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

    var wmType = document.querySelector('input[name="wmtype"]:checked').value;
    var text = Mint.el("wmText").value.trim();
    if (wmType === "text" && !text) {
      Mint.showAlert("alertBox", "error", "Please enter some watermark text.");
      watermarkBtn.disabled = false;
      return;
    }
    if (wmType === "image" && !wmImageFile) {
      Mint.showAlert("alertBox", "error", "Please choose an image for the watermark.");
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
    var rotation = parseInt(Mint.el("rotRange").value, 10) || 0;
    var color = hexToRgb(Mint.el("wmColor").value || "#8b9096");

    Mint.setProgress("progressWrap", 20, "Adding watermark…");
    PDFLib.PDFDocument.load(fileBytes).then(function (doc) {
      // embed the image first if needed, then the font
      var prep = wmType === "image"
        ? Mint.readAsArrayBuffer(wmImageFile).then(function (buf) {
            var bytes = new Uint8Array(buf);
            return doc.embedPng(bytes).catch(function () { return doc.embedJpg(bytes); });
          }).then(function (img) { return { img: img }; })
        : Promise.resolve(null);
      return prep.then(function (wmImg) {
        return doc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (font) {
          indices.forEach(function (idx) {
            var page = doc.getPage(idx);
            var pw = page.getWidth(), ph = page.getHeight();
            if (wmType === "image" && wmImg) {
              var dims = wmImg.img.scale(1);
              var maxW = pw * 0.7, maxH = ph * 0.7;
              var sc = Math.min(maxW / dims.width, maxH / dims.height, 1) * (size / 60);
              var dw = dims.width * sc, dh = dims.height * sc;
              page.drawImage(wmImg.img, {
                x: wmCX * pw - dw / 2,
                y: (1 - wmCY) * ph - dh / 2,
                width: dw, height: dh,
                rotate: PDFLib.degrees(rotation),
                opacity: opacity
              });
            } else {
              var tw = font.widthOfTextAtSize(text, size);
              page.drawText(text, {
                x: wmCX * pw - tw / 2,
                y: (1 - wmCY) * ph - size * 0.35,
                size: size,
                font: font,
                rotate: PDFLib.degrees(rotation),
                opacity: opacity,
                color: color
              });
            }
          });
          return doc.save();
        });
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
