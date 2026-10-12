/* MergeMint — PDF to Word tool logic (text-based conversion).
   Extracts text page by page with pdf.js, groups it into lines/paragraphs,
   and builds an editable .docx with the `docx` library (lazy-loaded from CDN).
   Honest scope: text-based conversion — layout, images and complex formatting
   are not preserved. Scanned PDFs need OCR first.
   100% client-side. Requires pdf.js (lazy), docx (lazy), app.js (Mint). */
(function () {
  "use strict";

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  var DOCX_CDN = "https://cdn.jsdelivr.net/npm/docx@9.1.1/dist/index.iife.js";

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var convertBtn = Mint.el("convertBtn");
  var pageInfo = Mint.el("pageInfo");
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

  function ensureDocx() {
    if (typeof docx !== "undefined") return Promise.resolve();
    return Mint.loadScript(DOCX_CDN);
  }

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a PDF file."); return; }
    Mint.setProgress("progressWrap", 10, "Reading PDF…");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      file = f;
      fileBytes = bytes;
      return ensurePdfJs().then(function () {
        return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      }).then(function (doc) {
        pageCount = doc.numPages;
        fileList.innerHTML = "";
        fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
        pageInfo.style.display = "";
        pageInfo.textContent = "📄 “" + file.name + "” — " + pageCount + (pageCount === 1 ? " page, " : " pages, ") + Mint.formatBytes(file.size) + ".";
        convertBtn.disabled = false;
        resultBox.style.display = "none";
        Mint.hideProgress("progressWrap");
      });
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetAll() {
    file = null; fileBytes = null; pageCount = 0; resultBlob = null;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    convertBtn.disabled = true;
    resultBox.style.display = "none";
    Mint.hideAlert("alertBox");
  }

  /* Group pdf.js text items into lines by Y position, then into paragraphs
     when the vertical gap looks like a paragraph break. */
  function pageToParagraphs(textContent) {
    var items = textContent.items.filter(function (it) { return it.str && it.str.trim(); });
    if (!items.length) return [];
    // sort top-to-bottom (pdf.js y grows upward), then left-to-right
    items.sort(function (a, b) {
      var dy = b.transform[5] - a.transform[5];
      if (Math.abs(dy) > 2) return dy;
      return a.transform[4] - b.transform[4];
    });
    var lines = [];
    items.forEach(function (it) {
      var y = it.transform[5];
      var last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) <= 2) {
        last.items.push(it);
      } else {
        lines.push({ y: y, items: [it] });
      }
    });
    lines.forEach(function (ln) {
      ln.items.sort(function (a, b) { return a.transform[4] - b.transform[4]; });
      ln.text = ln.items.map(function (it) { return it.str; }).join(" ").replace(/\s+/g, " ").trim();
      // average font size from transform scale
      var h = ln.items.map(function (it) {
        var t = it.transform;
        return Math.sqrt(t[2] * t[2] + t[3] * t[3]);
      });
      ln.size = h.reduce(function (s, v) { return s + v; }, 0) / h.length;
    });
    // paragraph breaks on large vertical gaps
    var paras = [], cur = [];
    lines.forEach(function (ln, i) {
      if (i > 0) {
        var gap = lines[i - 1].y - ln.y;
        var refSize = Math.max(lines[i - 1].size, ln.size, 8);
        if (gap > refSize * 1.8) { paras.push(cur); cur = []; }
      }
      cur.push(ln.text);
    });
    if (cur.length) paras.push(cur);
    return paras.map(function (ls) { return ls.join(" "); }).filter(Boolean);
  }

  convertBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    convertBtn.disabled = true;
    Mint.setProgress("progressWrap", 15, "Loading converter…");

    ensureDocx().then(function () {
      Mint.setProgress("progressWrap", 25, "Extracting text…");
      return ensurePdfJs();
    }).then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (doc) {
      var n = doc.numPages;
      var chain = Promise.resolve();
      var allParas = [];
      for (var p = 1; p <= n; p++) {
        (function (pageNum) {
          chain = chain.then(function () {
            Mint.setProgress("progressWrap", 25 + Math.round(55 * (pageNum - 1) / n),
              "Reading page " + pageNum + " of " + n + "…");
            return doc.getPage(pageNum).then(function (page) {
              return page.getTextContent().then(function (tc) {
                allParas.push({ page: pageNum, paras: pageToParagraphs(tc) });
              });
            });
          });
        })(p);
      }
      return chain.then(function () { return allParas; });
    }).then(function (allParas) {
      Mint.setProgress("progressWrap", 85, "Building Word document…");
      var children = [];
      var totalParas = 0;
      allParas.forEach(function (pg, idx) {
        pg.paras.forEach(function (text) {
          children.push(new docx.Paragraph({ text: text }));
          totalParas++;
        });
        if (idx < allParas.length - 1) {
          children.push(new docx.Paragraph({
            children: [new docx.PageBreak()]
          }));
        }
      });
      if (!totalParas) {
        throw new Error("No text found in this PDF. If it's a scanned document, convert it with the OCR PDF tool first, then try again.");
      }
      var doc = new docx.Document({
        sections: [{ children: children }]
      });
      return docx.Packer.toBlob(doc).then(function (blob) { return { blob: blob, paras: totalParas }; });
    }).then(function (res) {
      resultBlob = res.blob;
      var base = (file.name.replace(/\.pdf$/i, "") || "document");
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + res.paras + "</strong>paragraphs extracted</div>" +
        "<div class='stat'><strong>" + pageCount + "</strong>pages</div>";
      Mint.el("downloadBtn").onclick = function () {
        Mint.downloadBlob(resultBlob, base + ".docx");
      };
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Conversion failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      convertBtn.disabled = false;
    });
  });
})();
