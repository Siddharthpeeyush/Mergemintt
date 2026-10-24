/* MergeMint — Form Ready tool logic.
   Resize a photo or signature to a form's exact dimensions and land its
   file size inside the form's min–max range, using a cover-crop (no
   stretching) plus a JPEG quality search.
   Presets are common sizes used by Indian government/bank forms, shown
   editable — always check your own form's notification, because specs vary.
   Requires app.js (Mint). */
(function () {
  "use strict";

  var PRESETS = {
    photo: { w: 276, h: 354, min: 20, max: 50, label: "Photo (common govt/bank form)" },
    signature: { w: 276, h: 118, min: 10, max: 20, label: "Signature (common govt/bank form)" },
    custom: null
  };

  var file = null, resultBlob = null, resultName = "";

  Mint.setupDropzone("dropzone", {
    input: Mint.el("fileInput"),
    accept: ".jpg,.jpeg,.png,.webp",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  Mint.el("presetSel").addEventListener("change", function () {
    var p = PRESETS[Mint.el("presetSel").value];
    if (p) {
      Mint.el("widthInput").value = p.w;
      Mint.el("heightInput").value = p.h;
      Mint.el("minInput").value = p.min;
      Mint.el("maxInput").value = p.max;
    }
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    if (!/^image\//.test(f.type) && !/\.(jpg|jpeg|png|webp)$/i.test(f.name)) {
      Mint.showAlert("alertBox", "error", "Please upload an image (JPG, PNG or WebP)."); return;
    }
    file = f; resultBlob = null;
    Mint.el("fileList").innerHTML = "";
    Mint.el("fileList").appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
    Mint.el("pageInfo").style.display = "";
    Mint.el("pageInfo").textContent = "Image ready — " + Mint.formatBytes(file.size) + ". Set your form's size and go.";
    Mint.el("optionsBox").style.display = "";
    Mint.el("readyBtn").disabled = false;
    Mint.el("resultBox").style.display = "none";
  }

  function resetAll() {
    file = null; resultBlob = null;
    Mint.el("fileList").innerHTML = "";
    Mint.el("pageInfo").style.display = "none";
    Mint.el("optionsBox").style.display = "none";
    Mint.el("readyBtn").disabled = true;
    Mint.el("resultBox").style.display = "none";
    Mint.hideAlert("alertBox");
  }

  function loadImage(f) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { reject(new Error("Could not read this image.")); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, q) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error("Could not encode the image.")); }, "image/jpeg", q);
    });
  }

  Mint.el("readyBtn").addEventListener("click", function () {
    if (!file) return;
    var w = parseInt(Mint.el("widthInput").value, 10);
    var h = parseInt(Mint.el("heightInput").value, 10);
    var minKB = parseFloat(Mint.el("minInput").value);
    var maxKB = parseFloat(Mint.el("maxInput").value);
    if (!w || !h || !maxKB || maxKB <= 0) {
      Mint.showAlert("alertBox", "error", "Enter width, height and a maximum size in KB."); return;
    }
    if (minKB && minKB > maxKB) {
      Mint.showAlert("alertBox", "error", "Minimum size cannot be larger than maximum size."); return;
    }
    Mint.hideAlert("alertBox");
    Mint.el("resultBox").style.display = "none";
    Mint.setProgress("progressWrap", 10, "Resizing…");
    loadImage(file).then(function (img) {
      // Cover-crop to the target aspect ratio (centred, no stretching).
      var srcAspect = img.naturalWidth / img.naturalHeight;
      var dstAspect = w / h;
      var sw, sh, sx, sy;
      if (srcAspect > dstAspect) { sh = img.naturalHeight; sw = Math.round(sh * dstAspect); sx = Math.round((img.naturalWidth - sw) / 2); sy = 0; }
      else { sw = img.naturalWidth; sh = Math.round(sw / dstAspect); sx = 0; sy = Math.round((img.naturalHeight - sh) / 2); }
      var canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      var maxBytes = Math.floor(maxKB * 1024);
      var minBytes = minKB ? Math.floor(minKB * 1024) : 0;
      var lo = 0.2, hi = 0.95, best = null;
      var chain = Promise.resolve();
      for (var i = 0; i < 9; i++) {
        (function () {
          var q = (lo + hi) / 2;
          chain = chain.then(function () {
            return canvasToBlob(canvas, q).then(function (b) {
              if (b.size <= maxBytes) { best = b; lo = q; } else { hi = q; }
            });
          });
        })();
      }
      return chain.then(function () {
        var used = best || null;
        if (!used) {
          return canvasToBlob(canvas, 0.2).then(function (b) {
            resultBlob = b;
            return { verdict: "above", size: b.size };
          });
        }
        resultBlob = used;
        if (used.size < minBytes) return { verdict: "below", size: used.size };
        return { verdict: "ok", size: used.size };
      });
    }).then(function (res) {
      resultName = file.name.replace(/\.[^.]+$/, "") + "-form-ready.jpg";
      Mint.hideProgress("progressWrap");
      Mint.el("resultBox").style.display = "";
      Mint.el("statRow").innerHTML = "";
      var a = document.createElement("div"); a.className = "stat";
      a.textContent = "Size: " + Mint.formatBytes(file.size) + " → " + Mint.formatBytes(res.size);
      var b = document.createElement("div"); b.className = "stat";
      b.textContent = "Dimensions: " + w + " × " + h + " px";
      var c = document.createElement("div"); c.className = "stat";
      c.textContent = res.verdict === "ok" ? "Within your form's range ✓" : res.verdict === "below" ? "Below the minimum — see note" : "Above the maximum — see note";
      Mint.el("statRow").appendChild(a); Mint.el("statRow").appendChild(b); Mint.el("statRow").appendChild(c);
      Mint.el("resultNote").textContent = res.verdict === "ok"
        ? "Ready to upload. Still double-check your form's notification — specs differ between exams and banks."
        : res.verdict === "below"
        ? "The image is very simple, so even at high quality it stays below your minimum. Most portals accept smaller files, but check your notification — if it insists on the minimum, use a slightly larger photo."
        : "Even at the lowest quality this image is above your maximum. Try smaller dimensions, or a different photo with less detail.";
      Mint.el("downloadBtn").disabled = false;
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Something went wrong.");
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, resultName);
  });
})();
