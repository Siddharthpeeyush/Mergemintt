/* MergeMint — Image Cropper tool logic. Drag to crop with aspect presets,
   rotate and flip. 100% client-side. Requires app.js (Mint). */
(function () {
  "use strict";

  var file = null;
  var srcCanvas = null;      // transformed source (rotation/flip baked in)
  var natW = 0, natH = 0;
  var rotation = 0, flipH = false;
  var crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };  // fractions of image
  var aspect = 0;            // 0 = free, else w/h
  var dragMode = null, dragLast = null;
  var origImg = null;

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var cropBtn = Mint.el("cropBtn");
  var optionsBox = Mint.el("optionsBox");
  var pageInfo = Mint.el("pageInfo");
  var resultBox = Mint.el("resultBox");
  var stage = Mint.el("cropStage");
  var stageImg = Mint.el("stageImg");
  var cropBox = Mint.el("cropBox");

  Mint.setupDropzone("dropzone", {
    input: fileInput,
    accept: "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  document.querySelectorAll('input[name="aspect"]').forEach(function (r) {
    r.addEventListener("change", function () {
      aspect = parseFloat(document.querySelector('input[name="aspect"]:checked').value) || 0;
      if (aspect > 0) fitAspect();
      paint();
    });
  });
  Mint.el("rotBtn").addEventListener("click", function () {
    rotation = (rotation + 90) % 360;
    bakeTransform();
  });
  Mint.el("flipBtn").addEventListener("click", function () {
    flipH = !flipH;
    bakeTransform();
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var ok = /image\/(png|jpeg|webp)/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
    if (!ok) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a supported image (PNG, JPG or WebP)."); return; }
    var url = URL.createObjectURL(f);
    var im = new Image();
    im.onload = function () {
      file = f; origImg = im;
      URL.revokeObjectURL(url);
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      rotation = 0; flipH = false;
      crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      bakeTransform();
      optionsBox.style.display = "";
      cropBtn.disabled = false;
      resultBox.style.display = "none";
    };
    im.onerror = function () { Mint.showAlert("alertBox", "error", "Could not read that image."); };
    im.src = url;
  }

  function resetAll() {
    file = null; origImg = null; srcCanvas = null;
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    cropBtn.disabled = true;
    resultBox.style.display = "none";
    Mint.hideAlert("alertBox");
  }

  // bake rotation + flip into srcCanvas; refresh preview
  function bakeTransform() {
    var iw = origImg.naturalWidth, ih = origImg.naturalHeight;
    var sw = (rotation % 180 !== 0) ? ih : iw;
    var sh = (rotation % 180 !== 0) ? iw : ih;
    var c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    var x = c.getContext("2d");
    x.translate(sw / 2, sh / 2);
    x.rotate(rotation * Math.PI / 180);
    x.scale(flipH ? -1 : 1, 1);
    x.drawImage(origImg, -iw / 2, -ih / 2);
    srcCanvas = c; natW = sw; natH = sh;
    stageImg.src = c.toDataURL("image/png");
    pageInfo.style.display = "";
    pageInfo.textContent = "🖼️ “" + file.name + "” — " + natW + "×" + natH + " px.";
    crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    if (aspect > 0) fitAspect();
    paint();
  }

  function fitAspect() {
    // work in pixels: fractions of w/h are not square on non-square images
    var c = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
    var pxW = c.w * natW, pxH = c.h * natH;
    if (pxW / pxH > aspect) { var nw = pxH * aspect / natW; c.x += (c.w - nw) / 2; c.w = nw; }
    else { var nh = pxW / aspect / natH; c.y += (c.h - nh) / 2; c.h = nh; }
    crop = c;
  }
  function lockAspectWH(c, fromW) {
    // keep w/h pixel ratio == aspect; fromW true when width drove the change
    if (fromW) c.h = c.w * natW / aspect / natH;
    else c.w = c.h * natH * aspect / natW;
  }

  function imgBox() {
    var stageW = stage.clientWidth || 600, stageH = 360;
    var s = Math.min(stageW / natW, stageH / natH);
    var w = natW * s, h = natH * s;
    return { x: (stageW - w) / 2, y: (stageH - h) / 2, w: w, h: h, s: s };
  }

  function paint() {
    if (!srcCanvas) return;
    var stageW = stage.clientWidth || 600;
    stage.style.height = "360px";
    var b = imgBox();
    stageImg.style.width = b.w + "px";
    stageImg.style.height = b.h + "px";
    stageImg.style.left = b.x + "px";
    stageImg.style.top = b.y + "px";
    cropBox.style.left = (b.x + crop.x * b.w) + "px";
    cropBox.style.top = (b.y + crop.y * b.h) + "px";
    cropBox.style.width = (crop.w * b.w) + "px";
    cropBox.style.height = (crop.h * b.h) + "px";
    Mint.el("cropLabel").textContent =
      Math.round(crop.w * natW) + "×" + Math.round(crop.h * natH) + " px";
  }

  cropBox.addEventListener("pointerdown", function (e) {
    var t = e.target.getAttribute("data-handle");
    dragMode = t ? "resize-" + t : "move";
    var r = stage.getBoundingClientRect();
    dragLast = { x: e.clientX - r.left, y: e.clientY - r.top };
    try { cropBox.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault(); e.stopPropagation();
  });
  cropBox.addEventListener("pointermove", function (e) {
    if (!dragMode || !srcCanvas) return;
    var r = stage.getBoundingClientRect();
    var px = e.clientX - r.left, py = e.clientY - r.top;
    var b = imgBox();
    var dx = (px - dragLast.x) / b.w, dy = (py - dragLast.y) / b.h;
    dragLast = { x: px, y: py };
    var c = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
    if (dragMode === "move") {
      c.x = Math.min(1 - c.w, Math.max(0, c.x + dx));
      c.y = Math.min(1 - c.h, Math.max(0, c.y + dy));
    } else {
      var h = dragMode.slice(7);
      if (h.indexOf("e") >= 0) c.w = Math.min(1 - c.x, Math.max(0.05, c.w + dx));
      if (h.indexOf("s") >= 0) c.h = Math.min(1 - c.y, Math.max(0.05, c.h + dy));
      if (h.indexOf("w") >= 0) { var nx = Math.min(c.x + c.w - 0.05, Math.max(0, c.x + dx)); c.w += c.x - nx; c.x = nx; }
      if (h.indexOf("n") >= 0) { var ny = Math.min(c.y + c.h - 0.05, Math.max(0, c.y + dy)); c.h += c.y - ny; c.y = ny; }
      if (aspect > 0) {
        var fromW = (h === "e" || h === "w" || h === "se" || h === "ne");
        lockAspectWH(c, fromW);
        if (c.x + c.w > 1) { c.w = 1 - c.x; lockAspectWH(c, true); }
        if (c.y + c.h > 1) { c.h = 1 - c.y; lockAspectWH(c, false); }
      }
    }
    crop = c;
    paint();
  });
  ["pointerup", "pointercancel"].forEach(function (t) {
    cropBox.addEventListener(t, function () { dragMode = null; });
  });

  cropBtn.addEventListener("click", function () {
    if (!srcCanvas) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    cropBtn.disabled = true;
    Mint.setProgress("progressWrap", 30, "Cropping…");
    try {
      var sx = Math.round(crop.x * natW), sy = Math.round(crop.y * natH);
      var cw = Math.round(crop.w * natW), ch = Math.round(crop.h * natH);
      var out = document.createElement("canvas");
      out.width = cw; out.height = ch;
      out.getContext("2d").drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, cw, ch);
      Mint.el("cropResult").src = out.toDataURL("image/png");
      Mint.el("statRow").innerHTML =
        "<div class='stat'><strong>" + cw + "×" + ch + "</strong>px output</div>";
      out.toBlob(function (blob) {
        Mint.el("downloadBtn").onclick = function () {
          Mint.downloadBlob(blob, (file.name.replace(/\.[^.]+$/, "") || "image") + "-cropped.png");
        };
        Mint.setProgress("progressWrap", 100, "Done!");
        resultBox.style.display = "block";
        resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
        Mint.hideProgress("progressWrap");
        cropBtn.disabled = false;
      }, "image/png");
    } catch (err) {
      Mint.hideProgress("progressWrap");
      cropBtn.disabled = false;
      Mint.showAlert("alertBox", "error", err.message || "Cropping failed.");
    }
  });

  window.addEventListener("resize", function () { if (srcCanvas) paint(); });
})();
