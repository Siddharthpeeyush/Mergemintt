/* MergeMint — PDF Compare tool logic.
   Extracts the text of two PDFs page by page (pdf.js), groups text
   fragments into visual lines, and diffs the lines with an LCS
   algorithm (falling back to set comparison for very long pages).
   Shows added lines in green, removed lines in red, per page.
   Requires pdf.js (lazy) and app.js (Mint). */
(function () {
  "use strict";

  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
  var WORKER_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  var fileA = null, bytesA = null, fileB = null, bytesB = null, diffs = [];

  Mint.setupDropzone("dropzoneA", {
    input: Mint.el("fileInputA"),
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { setFile("A", fs[0]); }
  });
  Mint.setupDropzone("dropzoneB", {
    input: Mint.el("fileInputB"),
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { setFile("B", fs[0]); }
  });

  function setFile(which, f) {
    Mint.hideAlert("alertBox");
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      Mint.showAlert("alertBox", "error", "Please upload PDF files only."); return;
    }
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      if (which === "A") { fileA = f; bytesA = bytes; Mint.el("pageInfoA").style.display = ""; Mint.el("pageInfoA").textContent = "A: “" + f.name + "” — " + Mint.formatBytes(f.size); }
      else { fileB = f; bytesB = bytes; Mint.el("pageInfoB").style.display = ""; Mint.el("pageInfoB").textContent = "B: “" + f.name + "” — " + Mint.formatBytes(f.size); }
      Mint.el("compareBtn").disabled = !(fileA && fileB);
      Mint.el("diffBox").style.display = "none";
    }).catch(function () {
      Mint.showAlert("alertBox", "error", "Could not read that file.");
    });
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

  function extractLines(pdfDoc) {
    var pages = [], chain = Promise.resolve();
    for (var p = 1; p <= pdfDoc.numPages; p++) {
      (function (pageNum) {
        chain = chain.then(function () {
          return pdfDoc.getPage(pageNum).then(function (page) {
            return page.getTextContent().then(function (tc) {
              var items = tc.items.filter(function (it) { return it.str.trim(); });
              items.sort(function (a, b) {
                var dy = b.transform[5] - a.transform[5];
                if (Math.abs(dy) > 4) return dy;
                return a.transform[4] - b.transform[4];
              });
              var lines = [], curY = null, cur = [];
              items.forEach(function (it) {
                var y = it.transform[5];
                if (curY === null || Math.abs(y - curY) > 4) {
                  if (cur.length) lines.push(cur.join(" "));
                  cur = [it.str]; curY = y;
                } else { cur.push(it.str); }
              });
              if (cur.length) lines.push(cur.join(" "));
              pages.push(lines.map(function (l) { return l.replace(/\s+/g, " ").trim(); }).filter(Boolean));
            });
          });
        });
      })(p);
    }
    return chain.then(function () { return pages; });
  }

  function diffLines(a, b) {
    if (a.length * b.length > 250000) {
      // Long pages: set-based comparison (order not preserved).
      var setB = {}, setA = {};
      b.forEach(function (l) { setB[l] = (setB[l] || 0) + 1; });
      a.forEach(function (l) { setA[l] = (setA[l] || 0) + 1; });
      var ops = [];
      a.forEach(function (l) { if (setB[l]) setB[l]--; else ops.push({ type: "del", text: l }); });
      b.forEach(function (l) { if (setA[l]) setA[l]--; else ops.push({ type: "add", text: l }); });
      return ops;
    }
    var n = a.length, m = b.length;
    var dp = [];
    for (var i = 0; i <= n; i++) { dp[i] = []; for (var j = 0; j <= m; j++) dp[i][j] = 0; }
    for (var x = n - 1; x >= 0; x--) {
      for (var y = m - 1; y >= 0; y--) {
        dp[x][y] = a[x] === b[y] ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
      }
    }
    var ops = [], p = 0, q = 0;
    while (p < n && q < m) {
      if (a[p] === b[q]) { ops.push({ type: "same", text: a[p] }); p++; q++; }
      else if (dp[p + 1][q] >= dp[p][q + 1]) { ops.push({ type: "del", text: a[p] }); p++; }
      else { ops.push({ type: "add", text: b[q] }); q++; }
    }
    while (p < n) { ops.push({ type: "del", text: a[p] }); p++; }
    while (q < m) { ops.push({ type: "add", text: b[q] }); q++; }
    return ops;
  }

  function renderPage(idx) {
    var d = diffs[idx];
    var area = Mint.el("diffArea");
    area.innerHTML = "";
    var head = document.createElement("p");
    head.className = "hint";
    head.textContent = "Page " + (idx + 1) + " — " + d.added + " line" + (d.added === 1 ? "" : "s") + " added, " + d.removed + " removed.";
    area.appendChild(head);
    if (d.ops.length === 0) {
      var none = document.createElement("p");
      none.textContent = "No text on this page in either file.";
      area.appendChild(none);
      return;
    }
    var shown = 0;
    d.ops.forEach(function (op) {
      if (shown >= 300) return;
      shown++;
      var line = document.createElement("div");
      line.style.cssText = "padding:6px 10px;margin:3px 0;border-radius:8px;font-size:14px;line-height:1.5;word-break:break-word;" +
        (op.type === "add" ? "background:#e6f7e6;border-left:4px solid #2fd08c;" :
         op.type === "del" ? "background:#fdecec;border-left:4px solid #e5484d;text-decoration:line-through;" :
         "background:rgba(128,128,128,.08);");
      line.textContent = (op.type === "add" ? "+ " : op.type === "del" ? "− " : "") + op.text;
      area.appendChild(line);
    });
    if (d.ops.length > 300) {
      var more = document.createElement("p");
      more.className = "hint";
      more.textContent = "Showing the first 300 lines of this page.";
      area.appendChild(more);
    }
  }

  function renderTabs() {
    var tabs = Mint.el("pageTabs");
    tabs.innerHTML = "";
    var onlyChanged = Mint.el("changedOnly").checked;
    diffs.forEach(function (d, idx) {
      if (onlyChanged && d.added === 0 && d.removed === 0) return;
      var btn = document.createElement("button");
      btn.className = "btn btn-outline btn-sm";
      btn.type = "button";
      btn.textContent = "Page " + (idx + 1) + (d.added || d.removed ? " (" + d.added + "+ / " + d.removed + "−)" : " (same)");
      btn.addEventListener("click", function () { renderPage(idx); });
      tabs.appendChild(btn);
    });
    if (!tabs.children.length) {
      var p = document.createElement("p");
      p.textContent = "No changed pages — the two documents have identical text.";
      tabs.appendChild(p);
    } else {
      var first = onlyChanged ? diffs.findIndex(function (d) { return d.added || d.removed; }) : 0;
      renderPage(first < 0 ? 0 : first);
    }
  }

  Mint.el("changedOnly").addEventListener("change", function () {
    if (diffs.length) renderTabs();
  });

  Mint.el("compareBtn").addEventListener("click", function () {
    if (!fileA || !fileB) return;
    Mint.hideAlert("alertBox");
    Mint.setProgress("progressWrap", 5, "Reading both PDFs…");
    ensurePdfJs().then(function () {
      return Promise.all([
        pdfjsLib.getDocument({ data: bytesA.slice(0) }).promise.then(extractLines),
        pdfjsLib.getDocument({ data: bytesB.slice(0) }).promise.then(extractLines)
      ]);
    }).then(function (res) {
      var pagesA = res[0], pagesB = res[1];
      var max = Math.max(pagesA.length, pagesB.length);
      diffs = [];
      for (var i = 0; i < max; i++) {
        var a = pagesA[i] || [], b = pagesB[i] || [];
        var ops = diffLines(a, b);
        var added = ops.filter(function (o) { return o.type === "add"; }).length;
        var removed = ops.filter(function (o) { return o.type === "del"; }).length;
        diffs.push({ ops: ops, added: added, removed: removed });
      }
      Mint.hideProgress("progressWrap");
      var changed = diffs.filter(function (d) { return d.added || d.removed; }).length;
      Mint.el("diffBox").style.display = "";
      Mint.el("diffSummary").textContent = "A has " + pagesA.length + " pages, B has " + pagesB.length + " pages. " +
        changed + " page" + (changed === 1 ? "" : "s") + " with text changes.";
      renderTabs();
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not compare these PDFs.");
    });
  });
})();
