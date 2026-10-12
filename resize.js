/* MergeMint — Image Resizer tool logic. 100% client-side via canvas.
   Requires app.js (Mint). JSZip is lazy-loaded only when ZIP download is used. */
(function () {
  "use strict";

  var JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  var images = []; // {file, name, img, w, h, thumbUrl, outBlob, outW, outH, outName}

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var resizeBtn = Mint.el("resizeBtn");
  var optionsBox = Mint.el("optionsBox");
  var resultBox = Mint.el("resultBox");
  var previewBox = Mint.el("previewBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    onFiles: addFiles
  });

  /* ---------- settings UI wiring ---------- */
  document.querySelectorAll('input[name="rmode"]').forEach(function (r) {
    r.addEventListener("change", syncModeUI);
  });
  Mint.el("lockAspect").addEventListener("change", function () {
    Mint.el("heightInput").disabled = Mint.el("lockAspect").checked;
    updatePreview();
  });
  Mint.el("formatSel").addEventListener("change", function () {
    var isPng = Mint.el("formatSel").value === "png";
    Mint.el("qualityRow").style.display = isPng ? "none" : "";
    updatePreview();
  });
  ["widthInput", "heightInput", "percentInput"].forEach(function (id) {
    Mint.el(id).addEventListener("input", updatePreview);
  });
  Mint.el("qualityRange").addEventListener("input", function () {
    Mint.el("qualityLabel").textContent = Mint.el("qualityRange").value + "%";
  });

  function syncModeUI() {
    var mode = document.querySelector('input[name="rmode"]:checked').value;
    Mint.el("dimsBox").style.display = mode === "dims" ? "" : "none";
    Mint.el("percentBox").style.display = mode === "percent" ? "" : "none";
    updatePreview();
  }

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
        previewBox.style.display = "";
        resizeBtn.disabled = false;
        resetResult();
        updatePreview();
      }
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        images.push({ file: file, name: file.name, img: img, w: img.naturalWidth, h: img.naturalHeight, thumbUrl: url, outBlob: null });
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
        onRemove: function (idx) {
          URL.revokeObjectURL(images[idx].thumbUrl);
          images.splice(idx, 1);
          renderList(); resetResult(); updatePreview();
          if (!images.length) {
            optionsBox.style.display = "none";
            previewBox.style.display = "none";
            resizeBtn.disabled = true;
          }
        }
      }));
    });
  }

  function resetResult() {
    resultBox.style.display = "none";
    images.forEach(function (it) { it.outBlob = null; });
    Mint.el("dlList").innerHTML = "";
  }

  /* ---------- sizing ---------- */
  function getSettings() {
    return {
      mode: document.querySelector('input[name="rmode"]:checked').value,
      width: parseInt(Mint.el("widthInput").value, 10),
      height: parseInt(Mint.el("heightInput").value, 10),
      lock: Mint.el("lockAspect").checked,
      percent: parseFloat(Mint.el("percentInput").value),
      format: Mint.el("formatSel").value, // "jpeg" | "png" | "webp"
      quality: parseInt(Mint.el("qualityRange").value, 10) / 100
    };
  }

  function targetDims(item, s) {
    if (s.mode === "percent") {
      var p = isNaN(s.percent) ? 0 : s.percent;
      if (p < 1 || p > 500) throw new Error("Percentage must be between 1 and 500.");
      return { w: Math.max(1, Math.round(item.w * p / 100)), h: Math.max(1, Math.round(item.h * p / 100)) };
    }
    if (s.lock) {
      if (!s.width || s.width < 1 || s.width > 20000) throw new Error("Enter a target width between 1 and 20000 px.");
      return { w: s.width, h: Math.max(1, Math.round(s.width * item.h / item.w)) };
    }
    if (!s.width || s.width < 1 || s.width > 20000 || !s.height || s.height < 1 || s.height > 20000) {
      throw new Error("Enter both width and height between 1 and 20000 px (or lock the aspect ratio).");
    }
    return { w: s.width, h: s.height };
  }

  function baseName(name) {
    return name.replace(/\.[^.]+$/, "");
  }
  function extFor(format) {
    return format === "jpeg" ? ".jpg" : format === "png" ? ".png" : ".webp";
  }

  /* ---------- preview (first image) ---------- */
  function updatePreview() {
    if (!images.length || optionsBox.style.display === "none") return;
    var item = images[0];
    var dims;
    try {
      dims = targetDims(item, getSettings());
    } catch (e) {
      Mint.el("previewDims").innerHTML = item.w + "×" + item.h + ' <span class="arrow">→</span> <span style="color:#b91c1c">fix settings</span>';
      Mint.el("previewCanvas").style.display = "none";
      return;
    }
    Mint.el("previewDims").innerHTML = item.w + "×" + item.h + ' <span class="arrow">→</span> ' + dims.w + "×" + dims.h + " px";
    var canvas = Mint.el("previewCanvas");
    canvas.style.display = "";
    var maxSide = 360;
    var sc = Math.min(1, maxSide / Math.max(dims.w, dims.h));
    canvas.width = Math.max(1, Math.round(dims.w * sc));
    canvas.height = Math.max(1, Math.round(dims.h * sc));
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(item.img, 0, 0, canvas.width, canvas.height);
    Mint.el("previewNote").textContent = images.length > 1
      ? "Preview of “" + item.name + "” — the same settings apply to all " + images.length + " images."
      : "Live preview — matches your current settings.";
  }

  /* ---------- resize ---------- */
  function resizeOne(item, s) {
    return new Promise(function (resolve, reject) {
      var dims;
      try { dims = targetDims(item, s); }
      catch (e) { reject(e); return; }
      var canvas = document.createElement("canvas");
      canvas.width = dims.w;
      canvas.height = dims.h;
      var ctx = canvas.getContext("2d");
      if (s.format === "jpeg") { // JPEG has no transparency — paint white behind
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, dims.w, dims.h);
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(item.img, 0, 0, dims.w, dims.h);
      var mime = "image/" + s.format;
      canvas.toBlob(function (b) {
        if (!b) {
          reject(new Error("Your browser could not encode " + s.format.toUpperCase() + ". Try PNG instead."));
          return;
        }
        item.outBlob = b;
        item.outW = dims.w;
        item.outH = dims.h;
        item.outName = baseName(item.name) + "-" + dims.w + "x" + dims.h + extFor(s.format);
        resolve();
      }, mime, s.format === "png" ? undefined : s.quality);
    });
  }

  resizeBtn.addEventListener("click", function () {
    if (!images.length) return;
    var s;
    try {
      s = getSettings();
      targetDims(images[0], s); // validate early for a friendly error
    } catch (e) {
      Mint.showAlert("alertBox", "error", e.message);
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    resizeBtn.disabled = true;

    var chain = Promise.resolve();
    images.forEach(function (item, i) {
      chain = chain.then(function () {
        Mint.setProgress("progressWrap", Math.round((i / images.length) * 100),
          "Resizing image " + (i + 1) + " of " + images.length + "…");
        return resizeOne(item, s);
      });
    });

    chain.then(function () {
      Mint.setProgress("progressWrap", 100, "Done!");
      var totalIn = images.reduce(function (a, it) { return a + it.file.size; }, 0);
      var totalOut = images.reduce(function (a, it) { return a + it.outBlob.size; }, 0);
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + images.length + "</strong>images resized</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(totalIn) + "</strong>before</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(totalOut) + "</strong>after</div>";
      var dlList = Mint.el("dlList");
      dlList.innerHTML = "";
      images.forEach(function (item) {
        var li = document.createElement("li");
        li.className = "file-item";
        var name = document.createElement("span");
        name.className = "fname";
        name.textContent = item.outName + " (" + item.outW + "×" + item.outH + ")";
        name.title = item.outName;
        li.appendChild(name);
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn";
        b.textContent = "⬇ Download";
        b.addEventListener("click", function () { Mint.downloadBlob(item.outBlob, item.outName); });
        li.appendChild(b);
        dlList.appendChild(li);
      });
      Mint.el("zipBtn").style.display = images.length > 1 ? "" : "none";
      resultBox.style.display = "block";
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function (err) {
      Mint.showAlert("alertBox", "error", err.message || "Resizing failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      resizeBtn.disabled = false;
    });
  });

  Mint.el("zipBtn").addEventListener("click", function () {
    Mint.setProgress("progressWrap", 50, "Preparing ZIP…");
    Mint.loadScript(JSZIP_CDN).then(function () {
      var zip = new JSZip();
      images.forEach(function (item) { zip.file(item.outName, item.outBlob); });
      return zip.generateAsync({ type: "blob" });
    }).then(function (blob) {
      Mint.hideProgress("progressWrap");
      Mint.downloadBlob(blob, "mergemint-resized.zip");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not create the ZIP file.");
    });
  });
})();
