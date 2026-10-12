/* MergeMint — Mix PDFs tool logic. Interleaves pages of two PDFs: A1, B1, A2, B2…
   100% client-side. Requires pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var fileA = null, fileB = null;
  var bytesA = null, bytesB = null;
  var pagesA = 0, pagesB = 0;
  var resultBlob = null;

  var mixBtn = Mint.el("mixBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");

  function readPdf(f) {
    if (typeof PDFLib === "undefined") return Promise.reject(new Error("The PDF library failed to load. Check your connection and reload."));
    return Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("“" + f.name + "” is password-protected. Please use a copy without password protection.");
        return { bytes: bytes, pages: doc.getPageCount() };
      });
    });
  }

  function setSlot(which, f) {
    Mint.hideAlert("alertBox");
    var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a PDF file."); return; }
    Mint.setProgress("progressWrap", 10, "Reading PDF…");
    readPdf(f).then(function (r) {
      if (which === "A") { fileA = f; bytesA = r.bytes; pagesA = r.pages; }
      else { fileB = f; bytesB = r.bytes; pagesB = r.pages; }
      renderSlots();
      Mint.hideProgress("progressWrap");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function slotRow(which, file, pages, onPick, onRemove) {
    var li = document.createElement("li");
    li.className = "file-item";
    var label = document.createElement("span");
    label.className = "mix-tag";
    label.textContent = which;
    li.appendChild(label);
    if (file) {
      var nm = document.createElement("span");
      nm.className = "fname";
      nm.textContent = file.name + " (" + pages + " pages)";
      li.appendChild(nm);
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "icon-btn"; btn.textContent = "✕";
      btn.setAttribute("aria-label", "Remove");
      btn.addEventListener("click", onRemove);
      li.appendChild(btn);
    } else {
      var pick = document.createElement("button");
      pick.type = "button"; pick.className = "btn btn-outline btn-sm";
      pick.textContent = "Choose PDF " + which;
      pick.addEventListener("click", onPick);
      li.appendChild(pick);
    }
    return li;
  }

  function renderSlots() {
    var list = Mint.el("mixList");
    list.innerHTML = "";
    var inputA = Mint.el("fileA"), inputB = Mint.el("fileB");
    list.appendChild(slotRow("A", fileA, pagesA,
      function () { inputA.click(); },
      function () { fileA = null; bytesA = null; pagesA = 0; renderSlots(); }));
    list.appendChild(slotRow("B", fileB, pagesB,
      function () { inputB.click(); },
      function () { fileB = null; bytesB = null; pagesB = 0; renderSlots(); }));
    var ready = fileA && fileB;
    optionsBox.style.display = ready ? "" : "none";
    mixBtn.disabled = !ready;
    if (ready) {
      pageInfo.style.display = "";
      pageInfo.textContent = "📄 A: “" + fileA.name + "” (" + pagesA + " pages)  •  B: “" + fileB.name + "” (" + pagesB + " pages). Output will have " + (pagesA + pagesB) + " pages.";
    } else {
      pageInfo.style.display = "none";
    }
    resultBox.style.display = "none";
    resultBlob = null;
  }

  Mint.el("fileA").addEventListener("change", function () {
    if (this.files[0]) setSlot("A", this.files[0]);
    this.value = "";
  });
  Mint.el("fileB").addEventListener("change", function () {
    if (this.files[0]) setSlot("B", this.files[0]);
    this.value = "";
  });
  Mint.setupDropzone("dropzone", {
    input: Mint.el("fileA"),
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { setSlot("A", fs[0]); }
  });

  mixBtn.addEventListener("click", function () {
    if (!bytesA || !bytesB) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    mixBtn.disabled = true;
    var startWithB = Mint.el("startSel").value === "B";
    Mint.setProgress("progressWrap", 10, "Mixing pages…");

    Promise.all([
      PDFLib.PDFDocument.load(bytesA.slice(0)),
      PDFLib.PDFDocument.load(bytesB.slice(0)),
      PDFLib.PDFDocument.create()
    ]).then(function (rs) {
      var docA = rs[0], docB = rs[1], out = rs[2];
      var order = [];
      var i = 0, j = 0;
      var first = startWithB ? "B" : "A";
      var second = startWithB ? "A" : "B";
      while (i < pagesA || j < pagesB) {
        if (first === "A" ? i < pagesA : j < pagesB) {
          order.push({ doc: first === "A" ? docA : docB, idx: first === "A" ? i++ : j++ });
        }
        if (second === "A" ? i < pagesA : j < pagesB) {
          order.push({ doc: second === "A" ? docA : docB, idx: second === "A" ? i++ : j++ });
        }
        // if one ran out, drain the other
        while (i < pagesA && j >= pagesB) order.push({ doc: docA, idx: i++ });
        while (j < pagesB && i >= pagesA) order.push({ doc: docB, idx: j++ });
      }
      var chain = Promise.resolve();
      // group consecutive pages from the same doc for fewer copy calls
      var groups = [];
      order.forEach(function (o) {
        var last = groups[groups.length - 1];
        if (last && last.doc === o.doc && o.idx === last.idxs[last.idxs.length - 1] + 1) last.idxs.push(o.idx);
        else groups.push({ doc: o.doc, idxs: [o.idx] });
      });
      groups.forEach(function (g, gi) {
        chain = chain.then(function () {
          Mint.setProgress("progressWrap", 10 + Math.round((gi / groups.length) * 80), "Mixing…");
          return g.doc === docA
            ? out.copyPages(docA, g.idxs).then(function (cp) { cp.forEach(function (p) { out.addPage(p); }); })
            : out.copyPages(docB, g.idxs).then(function (cp) { cp.forEach(function (p) { out.addPage(p); }); });
        });
      });
      return chain.then(function () { return out.save(); });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + (pagesA + pagesB) + "</strong>pages mixed</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Mixing failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      mixBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-mixed.pdf");
  });

  renderSlots();
})();
