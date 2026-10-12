/* MergeMint — Page Numbers tool logic. Requires pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var file = null;        // File
  var fileBytes = null;   // ArrayBuffer
  var pageCount = 0;
  var resultBlob = null;
  var resultName = "mergemint-numbered.pdf";
  var selectedPos = "mc"; // default: middle center

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var numberBtn = Mint.el("numberBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var rangeBox = Mint.el("rangeBox");
  var resultBox = Mint.el("resultBox");

  function posXY(pos, pageW, pageH, elW, elH, margin) {
    var x = pos.charAt(1) === "l" ? margin : pos.charAt(1) === "c" ? (pageW - elW) / 2 : pageW - margin - elW;
    var y = pos.charAt(0) === "t" ? pageH - margin - elH : pos.charAt(0) === "m" ? (pageH - elH) / 2 : margin;
    return { x: x, y: y };
  }

  function toRoman(n) {
    var table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
                 [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    var s = "";
    for (var i = 0; i < table.length && n > 0; i++) {
      while (n >= table[i][0]) { s += table[i][1]; n -= table[i][0]; }
    }
    return s || String(n);
  }

  function toAlpha(n) {
    var s = "";
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s || "A";
  }

  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return PDFLib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
  }

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  document.querySelectorAll("#posGrid .pos-cell").forEach(function (cell) {
    cell.addEventListener("click", function () {
      document.querySelectorAll("#posGrid .pos-cell").forEach(function (c) { c.classList.remove("selected"); });
      cell.classList.add("selected");
      selectedPos = cell.getAttribute("data-pos");
    });
  });

  Mint.el("sizeRange").addEventListener("input", function () {
    Mint.el("sizeLabel").textContent = this.value;
  });

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
      numberBtn.disabled = false;
      resetResult();
      Mint.hideProgress("progressWrap");
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
    numberBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  numberBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    numberBtn.disabled = true;

    var scope = document.querySelector('input[name="scope"]:checked').value;
    var skipFirst = scope === "all" && Mint.el("skipFirst").checked;
    var indices;
    if (scope === "all") {
      indices = [];
      var first = skipFirst ? 1 : 0;
      for (var i = first; i < pageCount; i++) indices.push(i);
    } else {
      try {
        indices = Mint.parsePageRanges(Mint.el("rangeInput").value, pageCount).map(function (p) { return p - 1; });
      } catch (e) {
        Mint.showAlert("alertBox", "error", e.message);
        numberBtn.disabled = false;
        return;
      }
    }

    var start = parseInt(Mint.el("startInput").value, 10);
    if (isNaN(start) || start < 1) start = 1;
    var format = Mint.el("formatSel").value;
    var size = parseInt(Mint.el("sizeRange").value, 10);
    var pos = selectedPos;
    var bold = Mint.el("boldCheck").checked;
    var color = hexToRgb(Mint.el("colorSel").value || "#475569");

    Mint.setProgress("progressWrap", 20, "Adding page numbers…");
    PDFLib.PDFDocument.load(fileBytes).then(function (doc) {
      return doc.embedFont(bold ? PDFLib.StandardFonts.HelveticaBold : PDFLib.StandardFonts.Helvetica).then(function (font) {
        indices.forEach(function (idx, k) {
          var num = start + (scope === "all" ? idx : k);
          var text = format === "n" ? String(num) :
            format === "nTotal" ? num + " / " + pageCount :
            format === "roman" ? toRoman(num) :
            format === "alpha" ? toAlpha(num) :
            "Page " + num;
          var tw = font.widthOfTextAtSize(text, size);
          var page = doc.getPage(idx);
          var xy = posXY(pos, page.getWidth(), page.getHeight(), tw, size, 36);
          page.drawText(text, {
            x: xy.x,
            y: xy.y,
            size: size,
            font: font,
            color: color
          });
        });
        return doc.save();
      });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      resultName = "mergemint-numbered.pdf";
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + indices.length + "</strong>pages numbered</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Adding page numbers failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      numberBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, resultName);
  });
})();
