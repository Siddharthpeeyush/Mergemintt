/* MergeMint — Background Remover tool logic.
   Removes the background from photos with an on-device AI model
   (@imgly/background-removal, ONNX/WASM). Nothing is uploaded.
   Requires app.js (Mint). The AI library loads on demand via dynamic import. */
(function () {
  "use strict";

  var BG_LIB = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

  var file = null;
  var resultBlob = null;
  var resultUrl = null;
  var working = false;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var removeBtn = Mint.el("removeBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");
  var previewImg = Mint.el("previewImg");
  var resultImg = Mint.el("resultImg");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var ok = /image\/(png|jpeg|webp)/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
    if (!ok) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a supported image (PNG, JPG or WebP)."); return; }
    file = f;
    resetResult();
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    fileList.innerHTML = "";
    fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
    pageInfo.style.display = "";
    pageInfo.textContent = "🖼️ “" + file.name + "” — " + Mint.formatBytes(file.size) + ".";
    previewImg.src = URL.createObjectURL(f);
    optionsBox.style.display = "";
    removeBtn.disabled = false;
    Mint.hideAlert("alertBox");
  }

  function resetResult() {
    resultBox.style.display = "none";
    resultBlob = null;
    resultImg.removeAttribute("src");
  }

  function resetAll() {
    file = null;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    removeBtn.disabled = true;
    previewImg.removeAttribute("src");
    resetResult();
    Mint.hideAlert("alertBox");
  }

  function stageLabel(key) {
    if (/fetch/i.test(key)) return "Downloading AI model…";
    if (/inference|compute/i.test(key)) return "Removing background…";
    return "Working…";
  }

  removeBtn.addEventListener("click", function () {
    if (!file || working) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    removeBtn.disabled = true;
    working = true;
    Mint.setProgress("progressWrap", 2, "Loading AI model…");

    var lib;
    Promise.resolve()
      .then(function () { return import(BG_LIB); })
      .then(function (mod) {
        lib = mod;
        Mint.setProgress("progressWrap", 5, "Preparing image…");
        return lib.removeBackground(file, {
          progress: function (key, current, total) {
            var pct = total > 0 ? Math.round((current / total) * 100) : 0;
            // reserve 0-10% for load, 10-95% for model/inference
            var overall = /fetch/i.test(key)
              ? Math.round(pct * 0.5)
              : 50 + Math.round(pct * 0.45);
            Mint.setProgress("progressWrap", Math.min(96, overall), stageLabel(key) + " " + pct + "%");
          }
        });
      })
      .then(function (blob) {
        resultBlob = blob;
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        resultUrl = URL.createObjectURL(blob);
        resultImg.src = resultUrl;
        Mint.el("statRow").innerHTML =
          "<div class='stat'><strong>" + Mint.formatBytes(file.size) + "</strong>original</div>" +
          "<div class='stat'><strong>" + Mint.formatBytes(blob.size) + "</strong>transparent PNG</div>";
        Mint.setProgress("progressWrap", 100, "Done!");
        resultBox.style.display = "block";
        resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
      .catch(function (err) {
        var msg = (err && err.message) || "Background removal failed. Please try again.";
        if (/failed to fetch|network|load/i.test(msg)) {
          msg = "Could not download the AI model. Check your internet connection and try again — the model (~40 MB) downloads once, then works offline.";
        }
        Mint.showAlert("alertBox", "error", msg);
      })
      .then(function () {
        Mint.hideProgress("progressWrap");
        removeBtn.disabled = false;
        working = false;
      });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) {
      var name = (file ? file.name.replace(/\.[^.]+$/, "") : "photo") + "-no-bg.png";
      Mint.downloadBlob(resultBlob, name);
    }
  });
})();
