/* MergeMint — Image Converter tool logic. 100% client-side via canvas.
   Converts JPG/PNG/WebP to JPG/PNG/WebP. Requires app.js (Mint).
   JSZip is lazy-loaded only when ZIP download is used. */
(function () {
  "use strict";

  var JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  var images = []; // {file, name, img, w, h, thumbUrl, outBlob, outName}

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var convertBtn = Mint.el("convertBtn");
  var optionsBox = Mint.el("optionsBox");
  var resultBox = Mint.el("resultBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    onFiles: addFiles
  });

  Mint.el("formatSel").addEventListener("change", function () {
    var isPng = Mint.el("formatSel").value === "png";
    Mint.el("qualityRow").style.display = isPng ? "none" : "";
  });
  Mint.el("qualityRange").addEventListener("input", function () {
    Mint.el("qualityLabel").textContent = Mint.el("qualityRange").value + "%";
  });

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
        images.push({ file: file, name: file.name, img: img, w: img.naturalWidth, h: img.naturalHeight, thumbUrl: url, outBlob: null, outName: null });
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
          renderList(); resetResult();
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
    Mint.el("dlList").innerHTML = "";
    Mint.el("zipBtn").style.display = "none";
    images.forEach(function (it) { it.outBlob = null; it.outName = null; });
  }

  function baseName(name) { return name.replace(/\.[^.]+$/, ""); }
  function extFor(format) { return format === "jpeg" ? ".jpg" : format === "png" ? ".png" : ".webp"; }

  function convertOne(item, format, quality) {
    return new Promise(function (resolve, reject) {
      var canvas = document.createElement("canvas");
      canvas.width = item.w;
      canvas.height = item.h;
      var ctx = canvas.getContext("2d");
      if (format === "jpeg") { // JPEG has no transparency — paint white behind
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, item.w, item.h);
      }
      ctx.drawImage(item.img, 0, 0);
      canvas.toBlob(function (b) {
        if (!b) {
          reject(new Error("Your browser could not encode " + format.toUpperCase() + ". Try PNG instead."));
          return;
        }
        item.outBlob = b;
        item.outName = baseName(item.name) + extFor(format);
        resolve();
      }, "image/" + format, format === "png" ? undefined : quality);
    });
  }

  convertBtn.addEventListener("click", function () {
    if (!images.length) return;
    var format = Mint.el("formatSel").value;
    var quality = parseInt(Mint.el("qualityRange").value, 10) / 100;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    convertBtn.disabled = true;

    var chain = Promise.resolve();
    images.forEach(function (item, i) {
      chain = chain.then(function () {
        Mint.setProgress("progressWrap", Math.round((i / images.length) * 100),
          "Converting image " + (i + 1) + " of " + images.length + "…");
        return convertOne(item, format, quality);
      });
    });

    chain.then(function () {
      Mint.setProgress("progressWrap", 100, "Done!");
      var totalIn = images.reduce(function (a, it) { return a + it.file.size; }, 0);
      var totalOut = images.reduce(function (a, it) { return a + it.outBlob.size; }, 0);
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + images.length + "</strong>images converted</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(totalIn) + "</strong>before</div>" +
        "<div class='stat'><strong>" + Mint.formatBytes(totalOut) + "</strong>after</div>";
      var dlList = Mint.el("dlList");
      dlList.innerHTML = "";
      images.forEach(function (item) {
        var li = document.createElement("li");
        li.className = "file-item";
        var name = document.createElement("span");
        name.className = "fname";
        name.textContent = item.outName + " (" + item.w + "×" + item.h + ")";
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
      Mint.showAlert("alertBox", "error", err.message || "Conversion failed. Please try again.");
    }).then(function () {
      Mint.hideProgress("progressWrap");
      convertBtn.disabled = false;
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
      Mint.downloadBlob(blob, "mergemint-converted.zip");
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not create the ZIP file.");
    });
  });
})();
