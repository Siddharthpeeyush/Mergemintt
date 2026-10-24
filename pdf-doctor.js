/* MergeMint — PDF Doctor tool logic.
   Diagnoses a PDF in your browser: page count, size, metadata, per-page
   text/scanned classification, blank pages, duplicate pages and fonts.
   Fixes (remove blanks, drop duplicates keeping the first copy, clear
   metadata) are applied with pdf-lib, so page quality is unchanged.
   "Blank" means no extractable text and no images — a page made only of
   vector drawings may be flagged, so review the list before removing.
   Requires pdf.js (lazy), pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  var file = null, fileBytes = null, analysis = null, fixedBlob = null, fixedName = "";

  Mint.setupDropzone("dropzone", {
    input: Mint.el("fileInput"),
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      Mint.showAlert("alertBox", "error", "Please upload a PDF file."); return;
    }
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload."); return;
    }
    file = f; analysis = null; fixedBlob = null;
    Mint.setProgress("progressWrap", 10, "Reading PDF…");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        fileBytes = bytes;
        Mint.el("fileList").innerHTML = "";
        Mint.el("fileList").appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
        Mint.el("pageInfo").style.display = "";
        Mint.el("pageInfo").textContent = "“" + file.name + "” — " + doc.getPageCount() + " pages, " + Mint.formatBytes(file.size) + ".";
        Mint.el("analyzeBtn").disabled = false;
        Mint.el("reportBox").style.display = "none";
        Mint.el("resultBox").style.display = "none";
        Mint.hideProgress("progressWrap");
      });
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetAll() {
    file = null; fileBytes = null; analysis = null; fixedBlob = null;
    Mint.el("fileList").innerHTML = "";
    Mint.el("pageInfo").style.display = "none";
    Mint.el("analyzeBtn").disabled = true;
    Mint.el("reportBox").style.display = "none";
    Mint.el("resultBox").style.display = "none";
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

  function fmtMeta(v) { return v ? v : "—"; }

  Mint.el("analyzeBtn").addEventListener("click", function () {
    if (!file) return;
    Mint.hideAlert("alertBox");
    Mint.setProgress("progressWrap", 5, "Analyzing pages…");
    var meta = {};
    PDFLib.PDFDocument.load(fileBytes, { ignoreEncryption: true }).then(function (doc) {
      meta = {
        pages: doc.getPageCount(),
        title: doc.getTitle(), author: doc.getAuthor(), subject: doc.getSubject(),
        creator: doc.getCreator(), producer: doc.getProducer()
      };
      return ensurePdfJs().then(function () {
        return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
      }).then(function (pdfDoc) {
        var perPage = [], fonts = {}, chain = Promise.resolve();
        for (var p = 1; p <= pdfDoc.numPages; p++) {
          (function (pageNum) {
            chain = chain.then(function () {
              Mint.setProgress("progressWrap", 5 + Math.round((pageNum / pdfDoc.numPages) * 85), "Analyzing page " + pageNum + " of " + pdfDoc.numPages + "…");
              return pdfDoc.getPage(pageNum).then(function (page) {
                return page.getTextContent().then(function (tc) {
                  var text = tc.items.map(function (it) { return it.str; }).join(" ");
                  tc.items.forEach(function (it) { if (it.fontName) fonts[it.fontName] = true; });
                  return page.getOperatorList().then(function (ops) {
                    var images = 0;
                    for (var k = 0; k < ops.fnArray.length; k++) {
                      if (ops.fnArray[k] === pdfjsLib.OPS.paintImageXObject) images++;
                    }
                    perPage.push({
                      page: pageNum,
                      textChars: text.replace(/\s+/g, " ").trim().length,
                      textNorm: text.replace(/\s+/g, " ").trim().toLowerCase(),
                      images: images,
                      blank: text.replace(/\s+/g, " ").trim().length < 5 && images === 0
                    });
                  });
                });
              });
            });
          })(p);
        }
        return chain.then(function () {
          var blanks = perPage.filter(function (r) { return r.blank; }).map(function (r) { return r.page; });
          var seen = {}, dupGroups = [];
          perPage.forEach(function (r) {
            if (!r.textNorm) return;
            var key = r.textNorm + "|" + r.images;
            if (seen[key]) { seen[key].push(r.page); }
            else { seen[key] = [r.page]; }
          });
          Object.keys(seen).forEach(function (k) { if (seen[k].length > 1) dupGroups.push(seen[k]); });
          var scanned = perPage.filter(function (r) { return !r.blank && r.textChars < 20 && r.images > 0; }).length;
          var textPages = perPage.filter(function (r) { return !r.blank && r.textChars >= 20; }).length;
          analysis = { meta: meta, perPage: perPage, blanks: blanks, dupGroups: dupGroups, scanned: scanned, textPages: textPages, fonts: Object.keys(fonts) };
          Mint.hideProgress("progressWrap");
          var box = Mint.el("reportBox");
          box.style.display = "";
          var rows = Mint.el("reportRows");
          rows.innerHTML = "";
          function row(label, value) {
            var d = document.createElement("div"); d.className = "stat";
            var b = document.createElement("strong"); b.textContent = label + ": ";
            var s = document.createElement("span"); s.textContent = value;
            d.appendChild(b); d.appendChild(s); rows.appendChild(d);
          }
          row("Pages", meta.pages + " (" + textPages + " text, " + scanned + " scanned/image, " + blanks.length + " blank)");
          row("File size", Mint.formatBytes(file.size));
          row("Title", fmtMeta(meta.title));
          row("Author", fmtMeta(meta.author));
          row("Producer", fmtMeta(meta.producer || meta.creator));
          row("Blank pages", blanks.length ? blanks.join(", ") : "None — good");
          row("Duplicate pages", dupGroups.length ? dupGroups.map(function (g) { return g.join(", "); }).join("  ·  ") : "None — good");
          row("Fonts used", analysis.fonts.length ? analysis.fonts.join(", ") : "None detected (image-only pages)");
          Mint.el("fixBlanksBtn").disabled = blanks.length === 0;
          Mint.el("fixDupsBtn").disabled = dupGroups.length === 0;
          Mint.el("fixMetaBtn").disabled = false;
          Mint.el("fixAllBtn").disabled = false;
        });
      });
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not analyze this PDF.");
    });
  });

  function applyFixes(opts) {
    if (!analysis) return;
    Mint.setProgress("progressWrap", 20, "Applying fixes…");
    PDFLib.PDFDocument.load(fileBytes, { ignoreEncryption: true }).then(function (src) {
      var drop = {};
      if (opts.blanks) analysis.blanks.forEach(function (p) { drop[p] = true; });
      if (opts.dups) analysis.dupGroups.forEach(function (g) { g.slice(1).forEach(function (p) { drop[p] = true; }); });
      var keep = [];
      for (var i = 1; i <= src.getPageCount(); i++) { if (!drop[i]) keep.push(i - 1); }
      var out = PDFLib.PDFDocument.create();
      return out.copyPages(src, keep).then(function (pages) {
        pages.forEach(function (p) { out.addPage(p); });
        if (opts.meta) {
          out.setTitle(""); out.setAuthor(""); out.setSubject(""); out.setKeywords([]);
          out.setCreator(""); out.setProducer("");
        }
        return out.save();
      });
    }).then(function (bytes) {
      fixedBlob = new Blob([bytes], { type: "application/pdf" });
      fixedName = file.name.replace(/\.pdf$/i, "") + "-fixed.pdf";
      Mint.hideProgress("progressWrap");
      Mint.el("resultBox").style.display = "";
      Mint.el("statRow").innerHTML = "";
      var s = document.createElement("div"); s.className = "stat";
      s.textContent = "Fixed file: " + Mint.formatBytes(fixedBlob.size) + " (was " + Mint.formatBytes(file.size) + ")";
      Mint.el("statRow").appendChild(s);
      Mint.el("resultNote").textContent = "Download the fixed copy — your original file is untouched.";
      Mint.el("downloadBtn").disabled = false;
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not apply fixes.");
    });
  }

  Mint.el("fixBlanksBtn").addEventListener("click", function () { applyFixes({ blanks: true }); });
  Mint.el("fixDupsBtn").addEventListener("click", function () { applyFixes({ dups: true }); });
  Mint.el("fixMetaBtn").addEventListener("click", function () { applyFixes({ meta: true }); });
  Mint.el("fixAllBtn").addEventListener("click", function () { applyFixes({ blanks: true, dups: true, meta: true }); });
  Mint.el("downloadBtn").addEventListener("click", function () {
    if (fixedBlob) Mint.downloadBlob(fixedBlob, fixedName);
  });
})();
