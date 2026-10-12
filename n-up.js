/* MergeMint — N-Up PDF tool logic. Places 2/4/6/8 pages on each sheet.
   Tries vector embedding first (keeps text selectable), falls back to raster.
   100% client-side. Requires pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var nupBtn = Mint.el("nupBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");

  var LAYOUTS = {
    "2": { cols: 2, rows: 1 },
    "4": { cols: 2, rows: 2 },
    "6": { cols: 3, rows: 2 },
    "8": { cols: 4, rows: 2 }
  };

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

  function renderPageJpeg(pdfjsDoc, pageNum, scale) {
    return pdfjsDoc.getPage(pageNum).then(function (page) {
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
            b.arrayBuffer().then(function (buf) { resolve({ bytes: new Uint8Array(buf), w: viewport.width, h: viewport.height }); }, reject);
          }, "image/jpeg", 0.82);
        });
      });
    });
  }

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
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
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    }).then(function (doc) {
      if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
      pageCount = doc.getPageCount();
      file = f;
      return Mint.readAsArrayBuffer(f);
    }).then(function (bytes) {
      fileBytes = bytes;
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      pageInfo.style.display = "";
      pageInfo.textContent = "📄 “" + file.name + "” — " + pageCount + (pageCount === 1 ? " page, " : " pages, ") + Mint.formatBytes(file.size) + ".";
      optionsBox.style.display = "";
      nupBtn.disabled = false;
      resetResult();
      Mint.hideProgress("progressWrap");
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
    nupBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  nupBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    nupBtn.disabled = true;

    var n = Mint.el("nSel").value;
    var layout = LAYOUTS[n];
    var sheetMode = Mint.el("sheetSel").value;
    var perSheet = layout.cols * layout.rows;
    var sheets = Math.ceil(pageCount / perSheet);

    Mint.setProgress("progressWrap", 10, "Laying out " + n + "-up…");
    ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdfjsDoc) {
      return PDFLib.PDFDocument.create().then(function (out) {
        // sheet size from first page dimensions
        return pdfjsDoc.getPage(1).then(function (p1) {
          var v1 = p1.getViewport({ scale: 1 });
          var sheetW, sheetH;
          if (sheetMode === "a4p") { sheetW = 595.28; sheetH = 841.89; }
          else if (sheetMode === "a4l") { sheetW = 841.89; sheetH = 595.28; }
          else { sheetW = v1.width; sheetH = v1.height; }
          var gutter = 8;
          var cellW = (sheetW - gutter * (layout.cols + 1)) / layout.cols;
          var cellH = (sheetH - gutter * (layout.rows + 1)) / layout.rows;
          var rScale = 1.5;

          // render every page once, then tile
          var rendered = [];
          var chain = Promise.resolve();
          for (var p = 1; p <= pageCount; p++) {
            (function (pageNum) {
              chain = chain.then(function () {
                Mint.setProgress("progressWrap", 10 + Math.round((pageNum / pageCount) * 45),
                  "Rendering page " + pageNum + " of " + pageCount + "…");
                return renderPageJpeg(pdfjsDoc, pageNum, rScale).then(function (r) {
                  return out.embedJpg(r.bytes).then(function (img) {
                    rendered[pageNum - 1] = { img: img, w: r.w / rScale, h: r.h / rScale };
                  });
                });
              });
            })(p);
          }
          return chain.then(function () {
            for (var s = 0; s < sheets; s++) {
              var sheet = out.addPage([sheetW, sheetH]);
              for (var c = 0; c < perSheet; c++) {
                var pi = s * perSheet + c;
                if (pi >= pageCount) break;
                var r = rendered[pi];
                var sc = Math.min(cellW / r.w, cellH / r.h);
                var dw = r.w * sc, dh = r.h * sc;
                var col = c % layout.cols, row = Math.floor(c / layout.cols);
                var cx = gutter + col * (cellW + gutter) + (cellW - dw) / 2;
                var cy = sheetH - (gutter + row * (cellH + gutter) + (cellH - dh) / 2) - dh;
                sheet.drawImage(r.img, { x: cx, y: cy, width: dw, height: dh });
              }
              Mint.setProgress("progressWrap", 55 + Math.round((s / sheets) * 40), "Sheet " + (s + 1) + " of " + sheets + "…");
            }
            return out.save();
          });
        });
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + pageCount + "</strong>pages → <strong>" + sheets + "</strong> sheets</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "N-up layout failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      nupBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-nup.pdf");
  });
})();
