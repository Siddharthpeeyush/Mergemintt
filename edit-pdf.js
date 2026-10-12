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
  var selPos = "mc";

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
    Mint.el("sizeLabel").textContent = Mint.el("sizeRange").value;
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
        editBtn.disabled = false;
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

  /* topY = y of the top edge of the text block (cap top); returns baseline y per line. */
  function textXY(row, col, w, h, tw, topY, size, lineIdx, lineHeight) {
    var x = col === "l" ? MARGIN : col === "c" ? (w - tw) / 2 : w - tw - MARGIN;
    var y = topY - size - lineIdx * lineHeight;
    return { x: x, y: y };
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
            var row = selPos.charAt(0), col = selPos.charAt(1);
            var topY = row === "t" ? h - MARGIN : row === "m" ? (h + blockH) / 2 : MARGIN + blockH;
            lines.forEach(function (ln, idx) {
              var tw = font.widthOfTextAtSize(ln, size);
              var pos = textXY(row, col, w, h, tw, topY, size, idx, lineHeight);
              page.drawText(ln, {
                x: pos.x, y: pos.y, size: size, font: font,
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
