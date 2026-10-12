/* MergeMint — Encrypt PDF tool logic. Password-protects a PDF with AES-256
   (PDF Standard Security Handler V5/R6 via pdf-encrypt-lib + pdf-lib).
   100% client-side. Requires pdf-lib (PDFLib) and app.js (Mint).
   The encryption engine (pdf-encrypt-lib.js) loads on demand. */
(function () {
  "use strict";

  var file = null;
  var fileBytes = null;
  var pageCount = 0;
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var encryptBtn = Mint.el("encryptBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");

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
      if (doc.isEncrypted) throw new Error("This PDF is already password-protected.");
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
      encryptBtn.disabled = false;
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
    encryptBtn.disabled = true;
    resetResult();
    Mint.hideAlert("alertBox");
  }

  var FORGE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/forge/1.3.1/forge.min.js";

  function ensureEngine() {
    if (window.PdfEncrypt && window.PdfEncrypt.encryptPdf) return Promise.resolve();
    return Mint.loadScript(FORGE_CDN).then(function () {
      return Mint.loadScript("pdf-encrypt-lib.js");
    }).then(function () {
      if (!window.PdfEncrypt || !window.PdfEncrypt.encryptPdf) {
        throw new Error("The encryption engine failed to load. Check your connection and reload.");
      }
    });
  }

  encryptBtn.addEventListener("click", function () {
    if (!fileBytes) return;
    var pw = Mint.el("pwInput").value;
    var pw2 = Mint.el("pwConfirm").value;
    var ownerPw = Mint.el("ownerInput").value;
    if (!pw) { Mint.showAlert("alertBox", "error", "Please enter a password."); return; }
    if (pw.length < 4) { Mint.showAlert("alertBox", "error", "Please use a password of at least 4 characters."); return; }
    if (pw !== pw2) { Mint.showAlert("alertBox", "error", "The two passwords don't match. Please re-enter them."); return; }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    encryptBtn.disabled = true;
    Mint.setProgress("progressWrap", 10, "Loading encryption engine…");

    ensureEngine().then(function () {
      Mint.setProgress("progressWrap", 30, "Encrypting with AES-256…");
      return window.PdfEncrypt.encryptPdf(new Uint8Array(fileBytes), pw, ownerPw ? { ownerPassword: ownerPw } : {});
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>AES-256</strong>encryption</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>output size</div>";
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Encryption failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      encryptBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) {
      var name = (file ? file.name.replace(/\.pdf$/i, "") : "document") + "-protected.pdf";
      Mint.downloadBlob(resultBlob, name);
    }
  });
})();
