/* MergeMint — JPG to PDF tool logic. 100% client-side.
   Images are re-encoded via canvas (JPEG for jpeg sources, PNG otherwise),
   then embedded into a new PDF with pdf-lib.
   Requires pdf-lib (PDFLib), app.js (Mint). */
(function () {
  "use strict";

  var images = []; // {file, name, img, w, h, thumbUrl}
  var resultBlob = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var convertBtn = Mint.el("jpgPdfBtn");
  var optionsBox = Mint.el("optionsBox");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    onFiles: addFiles
  });

  /* ---------- file handling ---------- */
  function addFiles(newFiles) {
    Mint.hideAlert("alertBox");
    var jobs = [];
    newFiles.forEach(function (f) {
      var ok = /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
      if (!ok) {
        Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a JPG, PNG or WebP image and was skipped.");
        return;
      }
      jobs.push(loadImage(f));
    });
    if (!jobs.length) return;
    Mint.setProgress("progressWrap", 20, "Loading images…");
    Promise.all(jobs).then(function () {
      Mint.hideProgress("progressWrap");
      renderList();
      if (images.length) {
        optionsBox.style.display = "";
        convertBtn.disabled = false;
        resetResult();
      }
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        images.push({ file: file, name: file.name, img: img, w: img.naturalWidth, h: img.naturalHeight, thumbUrl: url });
        resolve();
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        Mint.showAlert("alertBox", "error", "Could not read “" + file.name + "” as an image.");
        resolve();
      };
      img.src = url;
    });
  }

  function renderList() {
    fileList.innerHTML = "";
    images.forEach(function (item, i) {
      var proxy = { name: item.name + " (" + item.w + "×" + item.h + ")", size: item.file.size, thumbUrl: item.thumbUrl };
      fileList.appendChild(Mint.fileRow(proxy, i, {
        showThumb: true,
        onUp: function (idx) { Mint.moveInArray(images, idx, -1); renderList(); resetResult(); },
        onDown: function (idx) { Mint.moveInArray(images, idx, 1); renderList(); resetResult(); },
        onRemove: function (idx) {
          URL.revokeObjectURL(images[idx].thumbUrl);
          images.splice(idx, 1);
          renderList();
          resetResult();
          if (!images.length) {
            optionsBox.style.display = "none";
            convertBtn.disabled = true;
          }
        }
      }));
    });
  }

  function resetResult() {
    resultBox.style.display = "none";
    resultBlob = null;
  }

  /* ---------- encoding ---------- */
  function encodeImage(item) {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement("canvas");
      canvas.width = item.w;
      canvas.height = item.h;
      var ctx = canvas.getContext("2d");
      var isJpeg = /^image\/jpeg$/.test(item.file.type) || /\.jpe?g$/i.test(item.name);
      var mime = isJpeg ? "image/jpeg" : "image/png";
      if (isJpeg) { // JPEG has no transparency — paint white behind
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, item.w, item.h);
      }
      ctx.drawImage(item.img, 0, 0);
      canvas.toBlob(function (b) {
        if (!b) { reject(new Error("Could not encode “" + item.name + "”. Try a different image.")); return; }
        b.arrayBuffer().then(function (buf) {
          resolve({ bytes: new Uint8Array(buf), png: !isJpeg });
        }, function () {
          reject(new Error("Could not read the encoded image “" + item.name + "”."));
        });
      }, mime, 0.92);
    });
  }

  /* ---------- convert ---------- */
  convertBtn.addEventListener("click", function () {
    if (!images.length) return;
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    convertBtn.disabled = true;
    var mode = Mint.el("pageSizeSel").value;

    PDFLib.PDFDocument.create().then(function (out) {
      var chain = Promise.resolve();
      images.forEach(function (item, i) {
        chain = chain.then(function () {
          Mint.setProgress("progressWrap", Math.round((i / images.length) * 100),
            "Adding image " + (i + 1) + " of " + images.length + "…");
          return encodeImage(item).then(function (enc) {
            return (enc.png ? out.embedPng(enc.bytes) : out.embedJpg(enc.bytes)).then(function (img) {
              var page;
              if (mode === "fit") {
                // One page per image, sized to the image (px → pt at 96 dpi).
                page = out.addPage([item.w * 0.75, item.h * 0.75]);
                page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
              } else {
                var pw = 595.28, ph = 841.89; // A4 portrait
                if (mode === "a4l") { pw = 841.89; ph = 595.28; }
                else if (mode === "lep") { pw = 612; ph = 792; }       // Letter portrait
                else if (mode === "lel") { pw = 792; ph = 612; }       // Letter landscape
                page = out.addPage([pw, ph]);
                var sc = Math.min(pw / (item.w * 0.75), ph / (item.h * 0.75));
                var dw = item.w * 0.75 * sc;
                var dh = item.h * 0.75 * sc;
                page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
              }
            });
          });
        });
      });
      return chain.then(function () { return out.save(); });
    }).then(function (bytes) {
      resultBlob = new Blob([bytes], { type: "application/pdf" });
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + images.length + "</strong>images converted</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(resultBlob.size) + "</strong>PDF size</div>";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Conversion failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      convertBtn.disabled = false;
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, "mergemint-images.pdf");
  });
})();
