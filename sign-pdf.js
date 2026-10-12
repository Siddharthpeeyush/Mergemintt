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
  var selPos = "br";

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

  /* ---------- position picker ---------- */
  var posCells = document.querySelectorAll("#posGrid .pos-cell");
  posCells.forEach(function (c) {
    if (c.getAttribute("data-pos") === selPos) c.classList.add("selected");
    c.addEventListener("click", function () {
      selPos = c.getAttribute("data-pos");
      posCells.forEach(function (x) { x.classList.toggle("selected", x === c); });
    });
  });

  Mint.el("sizeRange").addEventListener("input", function () {
    Mint.el("sigSizeLabel").textContent = Mint.el("sizeRange").value;
  });

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

  function endStroke() { drawing = false; }
  pad.addEventListener("pointerup", endStroke);
  pad.addEventListener("pointercancel", endStroke);
  pad.addEventListener("pointerleave", endStroke);

  Mint.el("clearSigBtn").addEventListener("click", function () {
    if (!padReady) return;
    padCtx.clearRect(0, 0, pad.width, pad.height);
    hasDrawn = false;
    Mint.hideAlert("alertBox");
  });

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

  /* PDF origin is bottom-left; (w,h) = page size, (dw,dh) = signature size. */
  function sigXY(pos, w, h, dw, dh) {
    var col = pos.charAt(1), row = pos.charAt(0);
    var x = col === "l" ? MARGIN : col === "c" ? (w - dw) / 2 : w - dw - MARGIN;
    var y = row === "t" ? h - MARGIN - dh : row === "m" ? (h - dh) / 2 : MARGIN;
    return { x: x, y: y };
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
    if (!hasDrawn) { Mint.showAlert("alertBox", "error", "Please draw your signature first."); return; }
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

    padToPngBytes().then(function (pngBytes) {
      return PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true }).then(function (src) {
        if (src.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        return PDFLib.PDFDocument.create().then(function (out) {
          var indices = [];
          for (var i = 0; i < src.getPageCount(); i++) indices.push(i);
          return out.copyPages(src, indices).then(function (pages) {
            pages.forEach(function (p) { out.addPage(p); });
            return out.embedPng(pngBytes).then(function (img) {
              var aspect = pad.width / pad.height;
              var drawW = BASE_SIG_WIDTH * sizePct;
              var drawH = drawW / aspect;
              var page = out.getPage(pageNum - 1);
              var pos = sigXY(selPos, page.getWidth(), page.getHeight(), drawW, drawH);
              page.drawImage(img, { x: pos.x, y: pos.y, width: drawW, height: drawH });
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
