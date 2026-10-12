/* MergeMint — Edit PDF tool logic (add text).
   Loads the PDF, copies all pages into a fresh document (so encrypted
   originals can still be saved), and draws the user's text at the chosen
   position with word-wrapping. 100% client-side.
   Requires pdf-lib (PDFLib), app.js (Mint). */
(function () {
  "use strict";

  var COLORS = {
    black: [0, 0, 0],
    blue: [0.1, 0.3, 0.8],
    red: [0.8, 0.15, 0.15],
    green: [0.1, 0.5, 0.25]
  };
  var MARGIN = 50;

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;

  /* visual position editor: top-left of the text block as page fractions */
  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  var editFX = 0.15, editFY = 0.4;
  var pagePtW = 0, pagePtH = 0, previewScale = 1;
  var draggingTx = false;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var editBtn = Mint.el("editBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");

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
      var canvas = Mint.el("editPreview");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }).then(function () {
      paintOverlay();
    }).catch(function (e) {
      if (window.console) console.warn("Edit preview failed:", e && e.message);
    });
  }

  function paintOverlay() {
    var ov = Mint.el("editOverlay");
    if (!pagePtW || !ov) return;
    var text = Mint.el("editText").value.trim() || "Your text";
    var size = parseInt(Mint.el("sizeRange").value, 10) || 14;
    var colorKey = Mint.el("colorSel").value;
    var cssColor = { black: "#111", blue: "#1a4dcc", red: "#cc2626", green: "#1a8040" }[colorKey] || "#111";
    // show first 3 lines wrapped roughly like the export
    var words = text.split(/\s+/), lines = [], cur = "";
    var approx = Math.max(12, Math.floor((pagePtW - MARGIN * 2) / (size * 0.55 * previewScale)));
    words.forEach(function (w) {
      var trial = cur ? cur + " " + w : w;
      if (trial.length <= approx) cur = trial;
      else { if (cur) lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    ov.innerHTML = "";
    lines.slice(0, 3).forEach(function (ln) {
      var d = document.createElement("div");
      d.textContent = ln;
      ov.appendChild(d);
    });
    if (lines.length > 3) {
      var more = document.createElement("div");
      more.textContent = "…";
      ov.appendChild(more);
    }
    ov.style.left = (editFX * 100) + "%";
    ov.style.top = (editFY * 100) + "%";
    ov.style.transform = "translate(0,0)";
    ov.style.fontSize = Math.max(9, Math.round(size * previewScale)) + "px";
    ov.style.color = cssColor;
    ov.style.whiteSpace = "normal";
    ov.style.maxWidth = "80%";
    ov.style.textAlign = "left";
  }

  (function initEditDrag() {
    var ov = Mint.el("editOverlay"), stage = Mint.el("editStage");
    if (!ov || !stage) return;
    ov.addEventListener("pointerdown", function (e) {
      draggingTx = true;
      try { ov.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    ov.addEventListener("pointermove", function (e) {
      if (!draggingTx) return;
      var r = stage.getBoundingClientRect();
      editFX = Math.min(0.95, Math.max(0, (e.clientX - r.left) / r.width));
      editFY = Math.min(0.95, Math.max(0, (e.clientY - r.top) / r.height));
      ov.style.left = (editFX * 100) + "%";
      ov.style.top = (editFY * 100) + "%";
    });
    ["pointerup", "pointercancel"].forEach(function (t) {
      ov.addEventListener(t, function () { draggingTx = false; });
    });
  })();

  Mint.el("sizeRange").addEventListener("input", function () {
    Mint.el("sizeLabel").textContent = Mint.el("sizeRange").value;
    paintOverlay();
  });
  Mint.el("editText").addEventListener("input", paintOverlay);
  Mint.el("colorSel").addEventListener("change", paintOverlay);
  Mint.el("pageInput").addEventListener("change", renderPreview);

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
        editBtn.disabled = false;
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
    editBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  /* ---------- text layout ---------- */
  function wrapLines(font, text, size, maxWidth) {
    var words = text.split(/\s+/).filter(function (w) { return w.length; });
    var lines = [], cur = "";
    words.forEach(function (wd) {
      var trial = cur ? cur + " " + wd : wd;
      if (!cur || font.widthOfTextAtSize(trial, size) <= maxWidth) { cur = trial; }
      else { lines.push(cur); cur = wd; }
    });
    if (cur) lines.push(cur);
    if (!lines.length) lines = [text];
    return lines;
  }

  /* ---------- add text ---------- */
  editBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var text = Mint.el("editText").value;
    if (!text.trim()) { Mint.showAlert("alertBox", "error", "Please type the text you want to add."); return; }
    var pageNum = parseInt(Mint.el("pageInput").value, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > pageCount) {
      Mint.showAlert("alertBox", "error", "Enter a page number between 1 and " + pageCount + ".");
      return;
    }
    var size = parseInt(Mint.el("sizeRange").value, 10) || 14;
    var colorKey = Mint.el("colorSel").value;
    var color = COLORS[colorKey] || COLORS.black;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    editBtn.disabled = true;
    Mint.setProgress("progressWrap", 20, "Adding text…");

    PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true }).then(function (src) {
      if (src.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
      return PDFLib.PDFDocument.create().then(function (out) {
        var indices = [];
        for (var i = 0; i < src.getPageCount(); i++) indices.push(i);
        return out.copyPages(src, indices).then(function (pages) {
          pages.forEach(function (p) { out.addPage(p); });
          return out.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
            var page = out.getPage(pageNum - 1);
            var w = page.getWidth(), h = page.getHeight();
            var lines = wrapLines(font, text, size, w - MARGIN * 2);
            var lineHeight = size * 1.3;
            var blockH = lines.length * lineHeight;
            // drag position: top-left of the text block, clamped to the page
            var x = Math.min(Math.max(MARGIN, editFX * w), w - MARGIN - 80);
            var topY = Math.min(Math.max(MARGIN + blockH, (1 - editFY) * h), h - MARGIN);
            lines.forEach(function (ln, idx) {
              page.drawText(ln, {
                x: x, y: topY - size - idx * lineHeight, size: size, font: font,
                color: PDFLib.rgb(color[0], color[1], color[2])
              });
            });
            return out.save();
          });
        });
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + text.length + "</strong>characters added</div>" +
        "<div class='stat'><strong>Page " + pageNum + "</strong>of " + pageCount + " pages</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Could not add the text. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      editBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-edited.pdf");
  });
})();
