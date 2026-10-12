/* MergeMint — Redact PDF tool logic. Draw black boxes over sensitive areas;
   they are burned into the PDF permanently on download.
   100% client-side. Requires pdf.js (pdfjsLib), pdf-lib (PDFLib), app.js (Mint). */
(function () {
  "use strict";

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var pdfjsDoc = null;
  var resultBlob = null;
  var currentPage = 1;
  var renderScale = 1.5;
  var pageCache = {};    // pageNum -> rendered canvas (at renderScale)
  var redactions = {};   // pageNum -> [{x, y, w, h}] in PDF points (bottom-left origin)
  var dragStart = null;  // {x, y} in canvas px
  var dragNow = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var redactBtn = Mint.el("redactBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");
  var canvas = Mint.el("redactCanvas");
  var ctx = canvas.getContext("2d");

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

  Mint.el("prevPage").addEventListener("click", function () { if (currentPage > 1) showPage(currentPage - 1); });
  Mint.el("nextPage").addEventListener("click", function () { if (currentPage < pageCount) showPage(currentPage + 1); });
  Mint.el("clearRects").addEventListener("click", function () {
    redactions[currentPage] = [];
    drawOverlay();
    renderRectList();
    updateCount();
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
        pageCount = doc.getPageCount();
        file = f;
        fileBytes = bytes;
        pageCache = {}; redactions = {}; currentPage = 1;
        return ensurePdfJs().then(function () {
          return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        });
      });
    }).then(function (pdfDoc) {
      pdfjsDoc = pdfDoc;
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      pageInfo.style.display = "";
      pageInfo.textContent = "📄 “" + file.name + "” — " + pageCount + (pageCount === 1 ? " page, " : " pages, ") + Mint.formatBytes(file.size) + ".";
      optionsBox.style.display = "";
      resetResult();
      Mint.hideProgress("progressWrap");
      updateCount();
      showPage(1);
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetResult() { resultBox.style.display = "none"; resultBlob = null; }

  function resetAll() {
    file = null; fileBytes = null; pageCount = 0; pdfjsDoc = null;
    pageCache = {}; redactions = {}; currentPage = 1;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    redactBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  function showPage(n) {
    currentPage = n;
    Mint.el("pageLabel").textContent = "Page " + n + " of " + pageCount;
    Mint.el("prevPage").disabled = n <= 1;
    Mint.el("nextPage").disabled = n >= pageCount;
    if (pageCache[n]) {
      paint();
    } else {
      Mint.setProgress("progressWrap", 10, "Rendering page " + n + "…");
      pdfjsDoc.getPage(n).then(function (page) {
        var viewport = page.getViewport({ scale: renderScale });
        var c = document.createElement("canvas");
        c.width = Math.ceil(viewport.width);
        c.height = Math.ceil(viewport.height);
        var cctx = c.getContext("2d");
        cctx.fillStyle = "#ffffff";
        cctx.fillRect(0, 0, c.width, c.height);
        return page.render({ canvasContext: cctx, viewport: viewport }).promise.then(function () {
          pageCache[n] = { canvas: c, widthPt: viewport.width / renderScale, heightPt: viewport.height / renderScale };
          Mint.hideProgress("progressWrap");
          if (currentPage === n) paint();
        });
      }).catch(function (err) {
        Mint.hideProgress("progressWrap");
        Mint.showAlert("alertBox", "error", err.message || "Could not render this page.");
      });
    }
    renderRectList();
  }

  function paint() {
    var pc = pageCache[currentPage];
    if (!pc) return;
    // fit canvas to container width, keep aspect
    var maxW = Math.min(680, canvas.parentElement.clientWidth || 680);
    var scale = maxW / pc.canvas.width;
    canvas.width = Math.round(pc.canvas.width * scale);
    canvas.height = Math.round(pc.canvas.height * scale);
    canvas.dataset.scale = scale; // css px per rendered px
    ctx.drawImage(pc.canvas, 0, 0, canvas.width, canvas.height);
    drawOverlay();
  }

  function drawOverlay() {
    var pc = pageCache[currentPage];
    if (!pc) return;
    // repaint base
    ctx.drawImage(pc.canvas, 0, 0, canvas.width, canvas.height);
    var k = (canvas.width / pc.canvas.width) * renderScale; // canvas px per PDF point
    function drawRect(r, fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(r.x * k, (pc.heightPt - r.y - r.h) * k, r.w * k, r.h * k);
    }
    (redactions[currentPage] || []).forEach(function (r) { drawRect(r, "rgba(0,0,0,0.85)"); });
    if (dragStart && dragNow) {
      var x = Math.min(dragStart.x, dragNow.x), y = Math.min(dragStart.y, dragNow.y);
      var w = Math.abs(dragNow.x - dragStart.x), h = Math.abs(dragNow.y - dragStart.y);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
  }

  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (!pageCache[currentPage]) return;
    e.preventDefault();
    dragStart = canvasPos(e);
    dragNow = dragStart;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragStart) return;
    dragNow = canvasPos(e);
    drawOverlay();
  });
  function endDrag(e) {
    if (!dragStart) return;
    var pc = pageCache[currentPage];
    var k = (canvas.width / pc.canvas.width) * renderScale; // canvas px per PDF point
    var x = Math.min(dragStart.x, dragNow.x), y = Math.min(dragStart.y, dragNow.y);
    var w = Math.abs(dragNow.x - dragStart.x), h = Math.abs(dragNow.y - dragStart.y);
    dragStart = null; dragNow = null;
    if (w > 6 && h > 6) {
      // convert top-left canvas rect to bottom-left PDF points
      var rPt = {
        x: x / k,
        y: pc.heightPt - (y + h) / k,
        w: w / k,
        h: h / k
      };
      if (!redactions[currentPage]) redactions[currentPage] = [];
      redactions[currentPage].push(rPt);
      renderRectList();
      updateCount();
    }
    drawOverlay();
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", function () { dragStart = null; dragNow = null; drawOverlay(); });

  function renderRectList() {
    var list = Mint.el("rectList");
    list.innerHTML = "";
    var rects = redactions[currentPage] || [];
    if (!rects.length) {
      list.innerHTML = "<li class='hint' style='list-style:none'>No redactions on this page yet — drag on the preview to black out an area.</li>";
      return;
    }
    rects.forEach(function (r, i) {
      var li = document.createElement("li");
      li.textContent = "Box " + (i + 1) + " (" + Math.round(r.w) + "×" + Math.round(r.h) + " pt)";
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "icon-btn"; btn.textContent = "✕";
      btn.setAttribute("aria-label", "Remove box " + (i + 1));
      btn.addEventListener("click", function () {
        redactions[currentPage].splice(i, 1);
        renderRectList(); drawOverlay(); updateCount();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function totalRects() {
    var n = 0;
    Object.keys(redactions).forEach(function (k) { n += redactions[k].length; });
    return n;
  }
  function updateCount() {
    var n = totalRects();
    redactBtn.disabled = !fileBytes || n === 0;
    Mint.el("redactCount").textContent = n ? n + (n === 1 ? " area" : " areas") + " marked" : "nothing marked yet";
  }

  redactBtn.addEventListener("click", function () {
    if (!fileBytes || totalRects() === 0) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    redactBtn.disabled = true;
    Mint.setProgress("progressWrap", 10, "Applying redactions…");

    PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true }).then(function (doc) {
      var black = PDFLib.rgb(0, 0, 0);
      Object.keys(redactions).forEach(function (key) {
        var pNum = parseInt(key, 10);
        var rects = redactions[key];
        if (!rects || !rects.length) return;
        var page = doc.getPage(pNum - 1);
        rects.forEach(function (r) {
          page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: black, borderWidth: 0 });
        });
      });
      return doc.save();
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + totalRects() + "</strong>areas redacted</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Redaction failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      updateCount();
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-redacted.pdf");
  });
})();
