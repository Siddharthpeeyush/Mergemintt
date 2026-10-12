/* MergeMint — Organize Pages tool logic.
   Visual page manager: per-page thumbnails, drag-and-drop reorder,
   per-page rotate (90-degree steps), delete/restore. Nothing is committed
   until Download is clicked.
   Requires pdf.js (pdfjsLib, lazy-loaded), pdf-lib (PDFLib), app.js (Mint). */
(function () {
  "use strict";

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  var THUMB_SCALE = 0.45;

  var fileBytes = null;
  var fileName = "";
  var pages = [];      // {src: 0-based, rot: user delta deg, del: bool, thumb: dataURL, origRot: deg}
  var pdfjsDoc = null; // pdf.js document (for thumbnail re-renders)
  var resultBlob = null;
  var dragIdx = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var thumbGrid = Mint.el("thumbGrid");
  var pageInfo = Mint.el("pageInfo");
  var organizeBtn = Mint.el("organizeBtn");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function ensurePdfJs() {
    if (typeof pdfjsLib !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
      return Promise.resolve();
    }
    return Mint.loadScript(PDFJS_CDN).then(function () {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_CDN;
    });
  }

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) { Mint.showAlert("alertBox", "error", "\u201C" + f.name + "\u201D is not a PDF file."); return; }
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.setProgress("progressWrap", 8, "Reading PDF\u2026");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        fileBytes = bytes;
        fileName = f.name;
        pages = [];
        for (var i = 0; i < doc.getPageCount(); i++) {
          pages.push({ src: i, rot: 0, del: false, thumb: "", origRot: doc.getPage(i).getRotation().angle });
        }
        fileList.innerHTML = "";
        fileList.appendChild(Mint.fileRow(f, 0, { onRemove: resetAll }));
        return ensurePdfJs().then(function () {
          return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        }).then(function (pdf) {
          pdfjsDoc = pdf;
          return renderAllThumbs();
        });
      });
    }).then(function () {
      pageInfo.style.display = "";
      updateCount();
      organizeBtn.disabled = false;
      resetResult();
      Mint.hideProgress("progressWrap");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetResult() { resultBox.style.display = "none"; resultBlob = null; }

  function resetAll() {
    fileBytes = null; fileName = ""; pages = []; pdfjsDoc = null;
    fileList.innerHTML = ""; thumbGrid.innerHTML = "";
    pageInfo.style.display = "none";
    organizeBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  function renderThumb(pg) {
    return pdfjsDoc.getPage(pg.src + 1).then(function (page) {
      var total = (pg.origRot + pg.rot) % 360;
      var viewport = page.getViewport({ scale: THUMB_SCALE, rotation: total });
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        pg.thumb = canvas.toDataURL("image/jpeg", 0.7);
      });
    });
  }

  function renderAllThumbs() {
    Mint.setProgress("progressWrap", 20, "Rendering page thumbnails\u2026");
    var chain = Promise.resolve();
    pages.forEach(function (pg, i) {
      chain = chain.then(function () {
        Mint.setProgress("progressWrap", 20 + Math.round((i / pages.length) * 60),
          "Rendering thumbnail " + (i + 1) + " of " + pages.length + "\u2026");
        return renderThumb(pg);
      });
    });
    return chain.then(function () { renderGrid(); });
  }

  function updateCount() {
    var kept = pages.filter(function (p) { return !p.del; }).length;
    pageInfo.textContent = "\u201C" + fileName + "\u201D \u2014 " + pages.length + " pages, " +
      kept + " will be saved. Drag cards to reorder.";
  }

  function renderGrid() {
    thumbGrid.innerHTML = "";
    pages.forEach(function (pg, i) {
      var card = document.createElement("div");
      card.className = "thumb-card" + (pg.del ? " deleted" : "");
      card.draggable = true;
      card.setAttribute("aria-label", "Page " + (i + 1));

      var img = document.createElement("img");
      img.src = pg.thumb;
      img.alt = "Page " + (i + 1);
      img.draggable = false;
      card.appendChild(img);

      if (pg.del) {
        var badge = document.createElement("span");
        badge.className = "thumb-badge";
        badge.textContent = "Removed";
        card.appendChild(badge);
      }

      var bar = document.createElement("div");
      bar.className = "thumb-bar";

      var num = document.createElement("span");
      num.className = "thumb-num";
      num.textContent = i + 1;
      bar.appendChild(num);

      var rotBtn = document.createElement("button");
      rotBtn.type = "button";
      rotBtn.className = "thumb-btn";
      rotBtn.title = "Rotate 90\u00B0 clockwise";
      rotBtn.setAttribute("aria-label", "Rotate page " + (i + 1));
      rotBtn.innerHTML = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 12a8 8 0 1 1-2.34-5.66\"/><path d=\"M20 3v5h-5\"/></svg>";
      rotBtn.addEventListener("click", function (e) { e.stopPropagation(); rotatePage(i); });
      bar.appendChild(rotBtn);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "thumb-btn" + (pg.del ? " restore" : "");
      delBtn.title = pg.del ? "Restore page" : "Remove page";
      delBtn.setAttribute("aria-label", (pg.del ? "Restore page " : "Remove page ") + (i + 1));
      delBtn.innerHTML = pg.del
        ? "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 12.5l5 5L20 6.5\"/></svg>"
        : "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13\"/></svg>";
      delBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleDelete(i); });
      bar.appendChild(delBtn);

      card.appendChild(bar);

      card.addEventListener("dragstart", function (e) {
        dragIdx = i;
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(i)); } catch (err) {}
      });
      card.addEventListener("dragend", function () { card.classList.remove("dragging"); });
      card.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
      card.addEventListener("drop", function (e) {
        e.preventDefault();
        if (dragIdx !== null && dragIdx !== i) movePage(dragIdx, i);
        dragIdx = null;
      });

      thumbGrid.appendChild(card);
    });
    updateCount();
  }

  function movePage(from, to) {
    var item = pages.splice(from, 1)[0];
    pages.splice(to, 0, item);
    renderGrid();
  }

  function rotatePage(i) {
    var pg = pages[i];
    pg.rot = (pg.rot + 90) % 360;
    renderThumb(pg).then(function () { renderGrid(); });
  }

  function toggleDelete(i) {
    pages[i].del = !pages[i].del;
    renderGrid();
  }

  organizeBtn.addEventListener("click", function () {
    if (!fileBytes || !pages.length) return;
    var order = pages.filter(function (p) { return !p.del; });
    if (!order.length) {
      Mint.showAlert("alertBox", "error", "Every page is marked as removed \u2014 restore at least one page.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    organizeBtn.disabled = true;
    Mint.setProgress("progressWrap", 30, "Building your organized PDF\u2026");

    PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true }).then(function (src) {
      return PDFLib.PDFDocument.create().then(function (out) {
        var indices = order.map(function (p) { return p.src; });
        return out.copyPages(src, indices).then(function (copied) {
          copied.forEach(function (cp, k) {
            var pg = order[k];
            var total = (pg.origRot + pg.rot) % 360;
            if (total) cp.setRotation(PDFLib.degrees(total));
            out.addPage(cp);
          });
          Mint.setProgress("progressWrap", 85, "Saving\u2026");
          return out.save();
        });
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + order.length + "</strong>pages saved</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>file size</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Could not build the PDF.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      organizeBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-organized.pdf");
  });
})();
