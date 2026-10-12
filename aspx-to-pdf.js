/* MergeMint — ASPX to PDF tool logic.
   Many Indian government/university sites serve documents through URLs ending
   in .aspx, so browsers save them as "file.aspx" even though the content is
   a perfectly good PDF. This tool inspects the file's magic bytes: if it's
   really a PDF, it hands it back as a proper .pdf download.
   100% client-side. Requires app.js (Mint). */
(function () {
  "use strict";

  var file = null;
  var fileBytes = null;
  var detected = null;   // 'pdf' | 'html' | 'unknown'
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var convertBtn = Mint.el("convertBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");
  var detectBox = Mint.el("detectBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: ".aspx,application/pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function sniff(bytes) {
    var head = "";
    for (var i = 0; i < Math.min(bytes.length, 64); i++) head += String.fromCharCode(bytes[i]);
    if (head.indexOf("%PDF") === 0) return "pdf";
    var low = head.toLowerCase();
    if (low.indexOf("<!doctype html") >= 0 || low.indexOf("<html") >= 0) return "html";
    return "unknown";
  }

  function addFile(f) {
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    resultBlob = null;
    Mint.setProgress("progressWrap", 15, "Inspecting file…");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      file = f;
      fileBytes = bytes;
      detected = sniff(new Uint8Array(bytes));
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      pageInfo.style.display = "";
      pageInfo.textContent = "📄 “" + file.name + "” — " + Mint.formatBytes(file.size) + ".";
      optionsBox.style.display = "";
      detectBox.style.display = "";
      if (detected === "pdf") {
        detectBox.className = "alert success";
        detectBox.innerHTML = "✅ Good news — this file <strong>is actually a PDF</strong> inside. Click below to download it with the correct .pdf name.";
        convertBtn.disabled = false;
      } else if (detected === "html") {
        detectBox.className = "alert info";
        detectBox.innerHTML = "ℹ️ This file is a <strong>web page</strong>, not a document. It was probably an error or login page. There is no PDF to recover from it.";
        convertBtn.disabled = true;
      } else {
        detectBox.className = "alert info";
        detectBox.innerHTML = "❓ This file doesn't look like a PDF. It may be corrupted or in another format — conversion isn't possible.";
        convertBtn.disabled = true;
      }
      Mint.hideProgress("progressWrap");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this file.");
    });
  }

  function resetAll() {
    file = null; fileBytes = null; detected = null; resultBlob = null;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    convertBtn.disabled = true;
    resultBox.style.display = "none";
    Mint.hideAlert("alertBox");
  }

  convertBtn.addEventListener("click", function () {
    if (!fileBytes || detected !== "pdf") return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    convertBtn.disabled = true;
    Mint.setProgress("progressWrap", 60, "Preparing PDF…");
    try {
      resultBlob = new Blob([fileBytes.slice(0)], { type: "application/pdf" });
      var base = file.name.replace(/\.aspx$/i, "") || "document";
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>PDF</strong>detected inside</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>file size</div>";
      Mint.el("downloadBtn").onclick = function () {
        Mint.downloadBlob(resultBlob, base + ".pdf");
      };
      Mint.setProgress("progressWrap", 100, "Done!");
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      Mint.showAlert("alertBox", "error", err.message || "Conversion failed.");
    } finally {
      Mint.hideProgress("progressWrap");
      convertBtn.disabled = false;
    }
  });
})();
