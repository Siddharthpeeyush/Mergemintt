/* MergeMint — Split by Size tool logic.
   Splits a PDF into chunks that each stay under a target size (MB),
   e.g. 16 MB for WhatsApp or 25 MB for Gmail. Pages are copied, not
   re-rendered, so quality is unchanged. A single page that is already
   bigger than the target becomes a chunk on its own.
   Requires pdf-lib (PDFLib), JSZip (lazy) and app.js (Mint). */
(function () {
  "use strict";

  var JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  var file = null, fileBytes = null, chunks = [], zipBlob = null;

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
    file = f; chunks = []; zipBlob = null;
    Mint.setProgress("progressWrap", 10, "Reading PDF…");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        fileBytes = bytes;
        Mint.el("fileList").innerHTML = "";
        Mint.el("fileList").appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
        Mint.el("pageInfo").style.display = "";
        Mint.el("pageInfo").textContent = "“" + file.name + "” — " + doc.getPageCount() + " pages, " + Mint.formatBytes(file.size) + ".";
        Mint.el("optionsBox").style.display = "";
        Mint.el("splitBtn").disabled = false;
        Mint.el("resultBox").style.display = "none";
        Mint.hideProgress("progressWrap");
      });
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetAll() {
    file = null; fileBytes = null; chunks = []; zipBlob = null;
    Mint.el("fileList").innerHTML = "";
    Mint.el("pageInfo").style.display = "none";
    Mint.el("optionsBox").style.display = "none";
    Mint.el("splitBtn").disabled = true;
    Mint.el("resultBox").style.display = "none";
    Mint.hideAlert("alertBox");
  }

  function saveWithPages(srcDoc, indices) {
    var out = PDFLib.PDFDocument.create();
    return out.copyPages(srcDoc, indices).then(function (pages) {
      pages.forEach(function (p) { out.addPage(p); });
      return out.save();
    });
  }

  Mint.el("splitBtn").addEventListener("click", function () {
    if (!file) return;
    var targetMB = parseFloat(Mint.el("targetMB").value);
    if (!targetMB || targetMB <= 0) {
      Mint.showAlert("alertBox", "error", "Enter a target size in MB (for example 16)."); return;
    }
    var target = Math.floor(targetMB * 1024 * 1024);
    Mint.hideAlert("alertBox");
    Mint.el("resultBox").style.display = "none";
    Mint.setProgress("progressWrap", 5, "Measuring pages…");
    PDFLib.PDFDocument.load(fileBytes, { ignoreEncryption: true }).then(function (srcDoc) {
      var total = srcDoc.getPageCount();
      var cur = [], curBytes = null, chain = Promise.resolve();
      for (var i = 0; i < total; i++) {
        (function (pageIdx) {
          chain = chain.then(function () {
            Mint.setProgress("progressWrap", 5 + Math.round((pageIdx / total) * 80), "Measuring page " + (pageIdx + 1) + " of " + total + "…");
            var trial = cur.concat([pageIdx]);
            return saveWithPages(srcDoc, trial).then(function (bytes) {
              if (bytes.length > target && cur.length > 0) {
                chunks.push({ pages: cur.slice(), bytes: curBytes });
                cur = [pageIdx];
                return saveWithPages(srcDoc, cur).then(function (b2) { curBytes = b2; });
              }
              cur = trial; curBytes = bytes;
            });
          });
        })(i);
      }
      return chain.then(function () {
        if (cur.length > 0) chunks.push({ pages: cur, bytes: curBytes });
        Mint.setProgress("progressWrap", 90, "Packing ZIP…");
        if (typeof JSZip === "undefined") return Mint.loadScript(JSZIP_CDN);
      }).then(function () {
        var zip = new JSZip();
        var base = file.name.replace(/\.pdf$/i, "");
        chunks.forEach(function (c, idx) {
          var from = c.pages[0] + 1, to = c.pages[c.pages.length - 1] + 1;
          zip.file(base + "-part" + (idx + 1) + "-pages-" + from + "-" + to + ".pdf", c.bytes);
        });
        return zip.generateAsync({ type: "blob" });
      });
    }).then(function (zip) {
      zipBlob = zip;
      Mint.hideProgress("progressWrap");
      Mint.el("resultBox").style.display = "";
      var list = Mint.el("chunkList");
      list.innerHTML = "";
      var overNote = false;
      chunks.forEach(function (c, idx) {
        var from = c.pages[0] + 1, to = c.pages[c.pages.length - 1] + 1;
        if (c.bytes.length > target) overNote = true;
        var row = document.createElement("div");
        row.className = "stat";
        row.textContent = "Part " + (idx + 1) + ": pages " + from + "–" + to + " (" + c.pages.length + " pages, " + Mint.formatBytes(c.bytes.length) + (c.bytes.length > target ? " — over target, single page too big" : "") + ")";
        list.appendChild(row);
      });
      Mint.el("resultNote").textContent = chunks.length + " parts, each " + (overNote ? "at or under target except single pages that were already bigger than it. " : "under your target. ") + "Download everything as one ZIP, or grab single parts below.";
      var singles = Mint.el("singleList");
      singles.innerHTML = "";
      var base = file.name.replace(/\.pdf$/i, "");
      chunks.forEach(function (c, idx) {
        var from = c.pages[0] + 1, to = c.pages[c.pages.length - 1] + 1;
        var btn = document.createElement("button");
        btn.className = "btn btn-outline btn-sm";
        btn.type = "button";
        btn.textContent = "Part " + (idx + 1) + " (pages " + from + "–" + to + ")";
        btn.addEventListener("click", function () {
          Mint.downloadBlob(new Blob([c.bytes], { type: "application/pdf" }), base + "-part" + (idx + 1) + ".pdf");
        });
        singles.appendChild(btn);
      });
      Mint.el("downloadBtn").disabled = false;
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Something went wrong.");
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (zipBlob) Mint.downloadBlob(zipBlob, file.name.replace(/\.pdf$/i, "") + "-split-by-size.zip");
  });
})();
