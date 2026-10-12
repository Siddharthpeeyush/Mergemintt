/* MergeMint — Photo Filters tool logic. Brightness/contrast/saturation
   sliders plus one-tap presets. 100% client-side. Requires app.js (Mint). */
(function () {
  "use strict";

  var PRESETS = {
    normal:  { b: 100, c: 100, s: 100, g: 0, sep: 0 },
    bw:      { b: 100, c: 110, s: 0,   g: 100, sep: 0 },
    sepia:   { b: 100, c: 100, s: 80,  g: 0, sep: 60 },
    vintage: { b: 105, c: 90,  s: 70,  g: 0, sep: 40 },
    vivid:   { b: 102, c: 125, s: 150, g: 0, sep: 0 },
    cool:    { b: 100, c: 105, s: 110, g: 0, sep: 0 },
    warm:    { b: 104, c: 100, s: 125, g: 0, sep: 15 }
  };

  var file = null;
  var img = null;
  var resultBlob = null;
  var extra = { g: 0, sep: 0 };   // grayscale/sepia from the active preset
  var objUrl = null;              // blob URL for the preview (revoked on reset/new file)

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var applyBtn = Mint.el("applyBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");
  var preview = Mint.el("filterPreview");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  ["brightRange", "contrastRange", "satRange"].forEach(function (id) {
    Mint.el(id).addEventListener("input", function () {
      Mint.el(id + "Label").textContent = this.value + "%";
      paint();
    });
  });

  document.querySelectorAll(".preset-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".preset-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var p = PRESETS[btn.getAttribute("data-preset")] || PRESETS.normal;
      setSlider("brightRange", p.b); setSlider("contrastRange", p.c); setSlider("satRange", p.s);
      extra.g = p.g; extra.sep = p.sep;
      paint();
    });
  });

  function setSlider(id, v) {
    Mint.el(id).value = v;
    Mint.el(id + "Label").textContent = v + "%";
  }

  function filterString() {
    var b = Mint.el("brightRange").value, c = Mint.el("contrastRange").value, s = Mint.el("satRange").value;
    return "brightness(" + b + "%) contrast(" + c + "%) saturate(" + s + "%)" +
      " grayscale(" + extra.g + "%) sepia(" + extra.sep + "%)";
  }

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var ok = /image\/(png|jpeg|webp)/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
    if (!ok) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a supported image (PNG, JPG or WebP)."); return; }
    var url = URL.createObjectURL(f);
    var im = new Image();
    im.onload = function () {
      file = f; img = im;
      if (objUrl) URL.revokeObjectURL(objUrl);
      objUrl = url;
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      pageInfo.style.display = "";
      pageInfo.textContent = "🖼️ “" + file.name + "” — " + im.naturalWidth + "×" + im.naturalHeight + " px.";
      preview.src = objUrl;
      optionsBox.style.display = "";
      applyBtn.disabled = false;
      resultBox.style.display = "none";
      document.querySelectorAll(".preset-btn").forEach(function (b) {
        b.classList.toggle("active", b.getAttribute("data-preset") === "normal");
      });
      setSlider("brightRange", 100); setSlider("contrastRange", 100); setSlider("satRange", 100);
      extra.g = 0; extra.sep = 0;
      paint();
    };
    im.onerror = function () { URL.revokeObjectURL(url); Mint.showAlert("alertBox", "error", "Could not read that image."); };
    im.src = url;
  }

  function resetAll() {
    file = null; img = null; resultBlob = null;
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    applyBtn.disabled = true;
    resultBox.style.display = "none";
    preview.removeAttribute("src");
    Mint.hideAlert("alertBox");
  }

  function paint() {
    if (img) preview.style.filter = filterString();
  }

  applyBtn.addEventListener("click", function () {
    if (!img) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    applyBtn.disabled = true;
    Mint.setProgress("progressWrap", 30, "Applying filters…");
    try {
      var c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      var x = c.getContext("2d");
      x.filter = filterString();
      x.drawImage(img, 0, 0);
      Mint.el("filterResult").src = c.toDataURL("image/png");
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + c.width + "×" + c.height + "</strong>px output</div>";
      c.toBlob(function (blob) {
        resultBlob = blob;
        Mint.setProgress("progressWrap", 100, "Done!");
        resultBox.style.display = "block";
        resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
        Mint.hideProgress("progressWrap");
        applyBtn.disabled = false;
      }, "image/png");
    } catch (err) {
      Mint.hideProgress("progressWrap");
      applyBtn.disabled = false;
      Mint.showAlert("alertBox", "error", err.message || "Could not apply filters.");
    }
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, (file.name.replace(/\.[^.]+$/, "") || "photo") + "-filtered.png");
  });
})();
