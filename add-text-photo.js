/* MergeMint — Add Text to Photo tool logic. Draggable text overlay with
   font, size, color and opacity controls. 100% client-side. Requires app.js (Mint). */
(function () {
  "use strict";

  var file = null;
  var img = null;
  var tx = 0.5, ty = 0.85;   // text center as fractions
  var dragging = false;
  var resultBlob = null;
  var objUrl = null;       // blob URL for the stage preview (revoked on reset/new file)

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var addBtn = Mint.el("addBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");
  var stage = Mint.el("textStage");
  var stageImg = Mint.el("stageImg");
  var overlay = Mint.el("textOverlay");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  ["textInput", "fontSel", "textColor"].forEach(function (id) {
    Mint.el(id).addEventListener("input", paint);
  });
  ["textSize", "textOpacity"].forEach(function (id) {
    Mint.el(id).addEventListener("input", function () {
      Mint.el(id + "Label").textContent = this.value + (id === "textOpacity" ? "%" : "px");
      paint();
    });
  });

  overlay.addEventListener("pointerdown", function (e) {
    dragging = true;
    try { overlay.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  overlay.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var r = stage.getBoundingClientRect();
    tx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    ty = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    position();
  });
  ["pointerup", "pointercancel"].forEach(function (t) {
    overlay.addEventListener(t, function () { dragging = false; });
  });

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
      stageImg.src = objUrl;
      optionsBox.style.display = "";
      addBtn.disabled = false;
      resultBox.style.display = "none";
      tx = 0.5; ty = 0.85;
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
    addBtn.disabled = true;
    resultBox.style.display = "none";
    stageImg.removeAttribute("src");
    Mint.hideAlert("alertBox");
  }

  function settings() {
    return {
      text: Mint.el("textInput").value || "Your text",
      font: Mint.el("fontSel").value,
      size: parseInt(Mint.el("textSize").value, 10) || 48,
      color: Mint.el("textColor").value || "#ffffff",
      opacity: (parseInt(Mint.el("textOpacity").value, 10) || 100) / 100
    };
  }

  function position() {
    overlay.style.left = (tx * 100) + "%";
    overlay.style.top = (ty * 100) + "%";
  }

  function paint() {
    if (!img) return;
    var s = settings();
    overlay.textContent = s.text;
    overlay.style.fontFamily = s.font;
    // scale preview font by displayed width vs natural width
    var scale = (stage.clientWidth || 600) / img.naturalWidth;
    overlay.style.fontSize = Math.max(10, Math.round(s.size * scale)) + "px";
    overlay.style.color = s.color;
    overlay.style.opacity = s.opacity;
    position();
  }

  addBtn.addEventListener("click", function () {
    if (!img) return;
    var s = settings();
    if (!Mint.el("textInput").value.trim()) {
      Mint.showAlert("alertBox", "error", "Please enter some text first.");
      return;
    }
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    addBtn.disabled = true;
    Mint.setProgress("progressWrap", 30, "Adding text…");
    try {
      var c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      var x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      x.globalAlpha = s.opacity;
      x.font = "700 " + s.size + "px " + s.font;
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillStyle = s.color;
      // subtle shadow for readability
      x.shadowColor = "rgba(0,0,0,0.45)";
      x.shadowBlur = Math.round(s.size / 12);
      x.fillText(s.text, tx * c.width, ty * c.height);
      Mint.el("textResult").src = c.toDataURL("image/png");
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + c.width + "×" + c.height + "</strong>px output</div>";
      c.toBlob(function (blob) {
        resultBlob = blob;
        Mint.setProgress("progressWrap", 100, "Done!");
        resultBox.style.display = "block";
        resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
        Mint.hideProgress("progressWrap");
        addBtn.disabled = false;
      }, "image/png");
    } catch (err) {
      Mint.hideProgress("progressWrap");
      addBtn.disabled = false;
      Mint.showAlert("alertBox", "error", err.message || "Could not add text.");
    }
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, (file.name.replace(/\.[^.]+$/, "") || "photo") + "-text.png");
  });

  window.addEventListener("resize", function () { if (img) paint(); });
})();
