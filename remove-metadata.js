/* MergeMint — Remove Metadata tool logic.
   Shows the hidden document properties stored inside a PDF
   (title, author, creator tool, etc.) and strips them out.
   Requires pdf-lib (PDFLib), app.js (Mint). */
(function () {
  "use strict";

  var FIELDS = [
    ["Title", "getTitle", "setTitle"],
    ["Author", "getAuthor", "setAuthor"],
    ["Subject", "getSubject", "setSubject"],
    ["Keywords", "getKeywords", "setKeywords"],
    ["Creator", "getCreator", "setCreator"],
    ["Producer", "getProducer", "setProducer"]
  ];

  var file = null;
  var fileBytes = null;
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var metaBox = Mint.el("metaBox");
  var metaBody = Mint.el("metaBody");
  var cleanBtn = Mint.el("cleanBtn");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function fieldValue(doc, getter) {
    try {
      var v = doc[getter]();
      if (Array.isArray(v)) v = v.join(", ");
      return v ? String(v) : "";
    } catch (e) { return ""; }
  }

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) { Mint.showAlert("alertBox", "error", "\u201C" + f.name + "\u201D is not a PDF file."); return; }
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.setProgress("progressWrap", 20, "Reading document properties\u2026");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        file = f;
        fileBytes = bytes;
        fileList.innerHTML = "";
        fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
        renderTable(doc, false);
        metaBox.style.display = "";
        cleanBtn.disabled = false;
        resetResult();
        Mint.hideProgress("progressWrap");
      });
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function renderTable(doc, cleared) {
    metaBody.innerHTML = "";
    var found = 0;
    FIELDS.forEach(function (fd) {
      var v = cleared ? "" : fieldValue(doc, fd[1]);
      if (v) found++;
      var tr = document.createElement("tr");
      var tdK = document.createElement("td");
      tdK.textContent = fd[0];
      var tdV = document.createElement("td");
      tdV.textContent = v || "\u2014";
      tdV.className = v ? "meta-found" : "meta-empty";
      tr.appendChild(tdK);
      tr.appendChild(tdV);
      metaBody.appendChild(tr);
    });
    Mint.el("metaNote").textContent = cleared
      ? "All properties cleared."
      : (found ? found + " propert" + (found === 1 ? "y" : "ies") + " found \u2014 ready to strip."
               : "No hidden properties found \u2014 this file is already clean.");
  }

  function resetResult() { resultBox.style.display = "none"; resultBlob = null; }

  function resetAll() {
    file = null; fileBytes = null;
    fileList.innerHTML = "";
    metaBox.style.display = "none";
    cleanBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  cleanBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    cleanBtn.disabled = true;
    Mint.setProgress("progressWrap", 40, "Stripping metadata\u2026");

    PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true }).then(function (doc) {
      FIELDS.forEach(function (fd) {
        try {
          if (fd[2] === "setKeywords") doc.setKeywords([]);
          else doc[fd[2]]("");
        } catch (e) {}
      });
      try { doc.setModificationDate(new Date()); } catch (e) {}
      Mint.setProgress("progressWrap", 75, "Saving clean PDF\u2026");
      return doc.save().then(function (bytes) { return { bytes: bytes, doc: doc }; });
    }).then(function (r) {
      resultBlob = new Blob([r.bytes], { type: "application/pdf" });
      renderTable(r.doc, true);
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + Mint.formatBytes(file.size) + "</strong>before</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>after</div>" +
        "<div class='stat'><strong>0</strong>properties left</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Could not clean this PDF.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      cleanBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-clean.pdf");
  });
})();
