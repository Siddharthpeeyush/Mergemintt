/* MergeMint — Sensitive Finder tool logic.
   Scans a PDF for Aadhaar numbers, PAN numbers, Indian mobile numbers
   and email addresses, shows a masked report (never the full values),
   and covers the matches with black boxes in a downloaded copy.
   Aadhaar matches must also pass the Verhoeff checksum, which cuts
   false positives from other 12-digit numbers. Note: covering hides
   text visually on the page; for a copy that must be unrecoverable,
   share a flattened image copy (PDF to JPG) instead.
   Requires pdf.js (lazy), pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  // Verhoeff tables (used by Aadhaar numbers).
  var VERHOEFF_D = [
    [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
    [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
    [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
    [9,8,7,6,5,4,3,2,1,0]
  ];
  var VERHOEFF_P = [
    [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
    [8,0,1,3,2,4,9,6,7,5],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
    [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
  ];
  function verhoeffValid(num) {
    var c = 0;
    for (var i = 0; i < num.length; i++) {
      var d = parseInt(num[num.length - 1 - i], 10);
      c = VERHOEFF_D[c][VERHOEFF_P[i % 8][d]];
    }
    return c === 0;
  }

  var PATTERNS = {
    aadhaar: { label: "Aadhaar number", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
    pan: { label: "PAN", re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
    mobile: { label: "Mobile number", re: /(^|[^\d])((?:\+91[\s-]?|0)?[6-9]\d{9})\b/g, group: 2 },
    email: { label: "Email address", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g }
  };

  var file = null, fileBytes = null, matches = [], coveredBlob = null, coveredName = "";

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
    file = f; matches = []; coveredBlob = null;
    Mint.setProgress("progressWrap", 10, "Reading PDF…");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        fileBytes = bytes;
        Mint.el("fileList").innerHTML = "";
        Mint.el("fileList").appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
        Mint.el("pageInfo").style.display = "";
        Mint.el("pageInfo").textContent = "“" + file.name + "” — " + doc.getPageCount() + " pages, " + Mint.formatBytes(file.size) + ".";
        Mint.el("scanBtn").disabled = false;
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
    file = null; fileBytes = null; matches = []; coveredBlob = null;
    Mint.el("fileList").innerHTML = "";
    Mint.el("pageInfo").style.display = "none";
    Mint.el("scanBtn").disabled = true;
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

  function maskValue(type, v) {
    if (type === "email") {
      var parts = v.split("@");
      if (parts.length === 2) return parts[0].charAt(0) + "•••@" + parts[1];
    }
    if (v.length <= 4) return "••" + v.slice(-2);
    return v.slice(0, 2) + "•••" + v.slice(-2);
  }

  function enabledTypes() {
    var out = [];
    ["aadhaar", "pan", "mobile", "email"].forEach(function (t) {
      if (Mint.el("type-" + t).checked) out.push(t);
    });
    return out;
  }

  Mint.el("scanBtn").addEventListener("click", function () {
    if (!file) return;
    var types = enabledTypes();
    if (types.length === 0) {
      Mint.showAlert("alertBox", "error", "Tick at least one type to look for."); return;
    }
    Mint.hideAlert("alertBox");
    Mint.setProgress("progressWrap", 5, "Scanning…");
    ensurePdfJs().then(function () {
      return pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    }).then(function (pdfDoc) {
      var found = [], chain = Promise.resolve();
      for (var p = 1; p <= pdfDoc.numPages; p++) {
        (function (pageNum) {
          chain = chain.then(function () {
            Mint.setProgress("progressWrap", 5 + Math.round((pageNum / pdfDoc.numPages) * 80), "Scanning page " + pageNum + " of " + pdfDoc.numPages + "…");
            return pdfDoc.getPage(pageNum).then(function (page) {
              var viewport = page.getViewport({ scale: 1 });
              var rotated = page.rotate !== 0;
              return page.getTextContent().then(function (tc) {
                tc.items.forEach(function (item) {
                  types.forEach(function (type) {
                    var re = new RegExp(PATTERNS[type].re.source, "g");
                    var m;
                    while ((m = re.exec(item.str)) !== null) {
                      var val = PATTERNS[type].group ? m[PATTERNS[type].group] : m[0];
                      var off = PATTERNS[type].group ? m.index + m[1].length : m.index;
                      if (type === "aadhaar") {
                        var digits = val.replace(/[\s-]/g, "");
                        if (digits.length !== 12 || !verhoeffValid(digits)) return;
                      }
                      var rect = null;
                      var t = item.transform;
                      var horizontal = Math.abs(t[1]) < 0.01 && Math.abs(t[2]) < 0.01;
                      if (horizontal && !rotated) {
                        var charW = item.width / Math.max(1, item.str.length);
                        var fontH = item.height || Math.sqrt(t[1] * t[1] + t[3] * t[3]);
                        var top = viewport.height - t[5];
                        rect = {
                          x: t[4] + off * charW - 1,
                          y: top - fontH - 1,
                          width: val.length * charW + 2,
                          height: fontH + 3
                        };
                      }
                      found.push({ page: pageNum, type: type, value: val, masked: maskValue(type, val), rect: rect, rotated: rotated });
                    }
                  });
                });
              });
            });
          });
        })(p);
      }
      return chain.then(function () { return found; });
    }).then(function (found) {
      matches = found;
      Mint.hideProgress("progressWrap");
      var box = Mint.el("reportBox");
      box.style.display = "";
      var rows = Mint.el("reportRows");
      rows.innerHTML = "";
      var counts = {};
      found.forEach(function (m) { counts[m.type] = (counts[m.type] || 0) + 1; });
      if (found.length === 0) {
        var none = document.createElement("div"); none.className = "stat";
        none.textContent = "No matches found for the types you ticked. Good news — or the text may be inside scanned images (run OCR first).";
        rows.appendChild(none);
        Mint.el("coverBtn").disabled = true;
        return;
      }
      Object.keys(counts).forEach(function (t) {
        var d = document.createElement("div"); d.className = "stat";
        var b = document.createElement("strong"); b.textContent = PATTERNS[t].label + ": ";
        var s = document.createElement("span"); s.textContent = counts[t] + " match" + (counts[t] === 1 ? "" : "es");
        d.appendChild(b); d.appendChild(s); rows.appendChild(d);
      });
      found.slice(0, 50).forEach(function (m) {
        var d = document.createElement("div"); d.className = "stat";
        d.textContent = "Page " + m.page + " — " + PATTERNS[m.type].label + ": " + m.masked + (m.rect ? "" : " (listed only — rotated text, cannot be covered)");
        rows.appendChild(d);
      });
      if (found.length > 50) {
        var more = document.createElement("div"); more.className = "stat";
        more.textContent = "…and " + (found.length - 50) + " more matches (all are covered when you download).";
        rows.appendChild(more);
      }
      Mint.el("coverBtn").disabled = !found.some(function (m) { return !!m.rect; });
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not scan this PDF.");
    });
  });

  Mint.el("coverBtn").addEventListener("click", function () {
    if (!file || matches.length === 0) return;
    Mint.setProgress("progressWrap", 20, "Covering matches…");
    PDFLib.PDFDocument.load(fileBytes, { ignoreEncryption: true }).then(function (doc) {
      var byPage = {};
      matches.forEach(function (m) {
        if (!m.rect) return;
        (byPage[m.page] = byPage[m.page] || []).push(m.rect);
      });
      Object.keys(byPage).forEach(function (p) {
        var page = doc.getPage(parseInt(p, 10) - 1);
        byPage[p].forEach(function (r) {
          page.drawRectangle({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, color: PDFLib.rgb(0, 0, 0) });
        });
      });
      return doc.save();
    }).then(function (bytes) {
      coveredBlob = new Blob([bytes], { type: "application/pdf" });
      coveredName = file.name.replace(/\.pdf$/i, "") + "-covered.pdf";
      Mint.hideProgress("progressWrap");
      Mint.el("resultBox").style.display = "";
      Mint.el("statRow").innerHTML = "";
      var s = document.createElement("div"); s.className = "stat";
      s.textContent = matches.filter(function (m) { return !!m.rect; }).length + " matches covered across the document.";
      Mint.el("statRow").appendChild(s);
      Mint.el("resultNote").textContent = "Matches are covered with black boxes in the downloaded PDF. For a copy that must be unrecoverable, share a flattened image copy (PDF to JPG) instead.";
      Mint.el("downloadBtn").disabled = false;
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not cover matches.");
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (coveredBlob) Mint.downloadBlob(coveredBlob, coveredName);
  });
})();
