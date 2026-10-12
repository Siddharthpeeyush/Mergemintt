/* MergeMint — Passport Photo Maker tool logic.
   Crop any photo to ID size, set background color, and get a 4x6" print sheet.
   100% client-side. Requires app.js (Mint). */
(function () {
  "use strict";

  var DPI = 300;
  var SIZES = {
    "in3545": { label: "India Passport — 35×45 mm", wMm: 35, hMm: 45 },
    "us2x2": { label: "US Visa — 2×2 inch", wMm: 50.8, hMm: 50.8 }
  };

  var file = null;
  var img = null;          // HTMLImageElement (loaded)
  var natW = 0, natH = 0;
  var zoom = 1, offX = 0, offY = 0;   // pan/zoom state (stage px)
  var dragging = false, dragLast = null;
  var singleBlob = null, sheetBlob = null;
  var objUrl = null;       // blob URL for the stage preview (revoked on reset/new file)

  var fileInput = Mint.el("fileInput");
  var fileList = Mint.el("fileList");
  var makeBtn = Mint.el("makeBtn");
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

  Mint.el("sizeSel").addEventListener("change", layoutCrop);
  Mint.el("zoomRange").addEventListener("input", function () {
    zoom = parseInt(this.value, 10) / 100;
    Mint.el("zoomLabel").textContent = this.value + "%";
    paint();
  });

  stage.addEventListener("pointerdown", function (e) {
    dragging = true; dragLast = { x: e.clientX, y: e.clientY };
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  stage.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    offX += e.clientX - dragLast.x;
    offY += e.clientY - dragLast.y;
    dragLast = { x: e.clientX, y: e.clientY };
    paint();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) {
    stage.addEventListener(t, function () { dragging = false; });
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    var ok = /image\/(png|jpeg|webp)/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);
    if (!ok) { Mint.showAlert("alertBox", "error", "“" + f.name + "” is not a supported image (PNG, JPG or WebP)."); return; }
    var url = URL.createObjectURL(f);
    var im = new Image();
    im.onload = function () {
      file = f; img = im; natW = im.naturalWidth; natH = im.naturalHeight;
      if (objUrl) URL.revokeObjectURL(objUrl);
      objUrl = url;
      fileList.innerHTML = "";
      fileList.appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      pageInfo.style.display = "";
      pageInfo.textContent = "🖼️ “" + file.name + "” — " + natW + "×" + natH + " px.";
      stageImg.src = objUrl;
      optionsBox.style.display = "";
      makeBtn.disabled = false;
      resultBox.style.display = "none";
      zoom = 1; offX = 0; offY = 0;
      Mint.el("zoomRange").value = 100;
      Mint.el("zoomLabel").textContent = "100%";
      layoutCrop();
    };
    im.onerror = function () { URL.revokeObjectURL(url); Mint.showAlert("alertBox", "error", "Could not read that image."); };
    im.src = url;
  }

  function resetAll() {
    file = null; img = null;
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    stageImg.removeAttribute("src");
    fileList.innerHTML = "";
    pageInfo.style.display = "none";
    optionsBox.style.display = "none";
    makeBtn.disabled = true;
    resultBox.style.display = "none";
    Mint.hideAlert("alertBox");
  }

  function sizeSpec() { return SIZES[Mint.el("sizeSel").value] || SIZES.in3545; }

  var SHEET_W = 1200, SHEET_H = 1800;  // 4x6" at 300 DPI

  function maxSheetCols() {
    var spec = sizeSpec();
    return Math.max(1, Math.floor(SHEET_W / mmToPx(spec.wMm)));
  }
  function maxSheetRows() {
    var spec = sizeSpec();
    return Math.max(1, Math.floor(SHEET_H / mmToPx(spec.hMm)));
  }
  // rebuild the columns/rows options for the current photo size; keep the
  // user's choice when it still fits, otherwise default to the max grid
  function buildSheetOptions() {
    var keepC = parseInt(Mint.el("sheetCols").value, 10) || 0;
    var keepR = parseInt(Mint.el("sheetRows").value, 10) || 0;
    var mc = maxSheetCols(), mr = maxSheetRows();
    var cs = Mint.el("sheetCols"), rs = Mint.el("sheetRows");
    cs.innerHTML = ""; rs.innerHTML = "";
    for (var c = 1; c <= mc; c++) {
      var o = document.createElement("option");
      o.value = c; o.textContent = c + (c === 1 ? " column" : " columns");
      cs.appendChild(o);
    }
    for (var r = 1; r <= mr; r++) {
      var p = document.createElement("option");
      p.value = r; p.textContent = r + (r === 1 ? " row" : " rows");
      rs.appendChild(p);
    }
    cs.value = (keepC >= 1 && keepC <= mc) ? keepC : mc;
    rs.value = (keepR >= 1 && keepR <= mr) ? keepR : mr;
  }

  // Position the fixed-aspect crop box; fit image to cover it.
  function layoutCrop() {
    if (!img) return;
    var spec = sizeSpec();
    var aspect = spec.wMm / spec.hMm;
    var stageW = stage.clientWidth || 600;
    var stageH = 340;
    stage.style.height = stageH + "px";
    var cbH = stageH - 32, cbW = cbH * aspect;
    if (cbW > stageW - 32) { cbW = stageW - 32; cbH = cbW / aspect; }
    cropBox.style.width = cbW + "px";
    cropBox.style.height = cbH + "px";
    cropBox.style.left = ((stageW - cbW) / 2) + "px";
    cropBox.style.top = ((stageH - cbH) / 2) + "px";
    // reset pan/zoom to cover
    zoom = 1; offX = 0; offY = 0;
    Mint.el("zoomRange").value = 100;
    Mint.el("zoomLabel").textContent = "100%";
    buildSheetOptions();
    paint();
  }

  function paint() {
    if (!img) return;
    var stageW = stage.clientWidth, stageH = stage.clientHeight;
    var cbW = cropBox.offsetWidth, cbH = cropBox.offsetHeight;
    // base scale so image covers the crop box
    var base = Math.max(cbW / natW, cbH / natH);
    var s = base * zoom;
    var dw = natW * s, dh = natH * s;
    // center, then apply pan offset (clamped so crop box stays covered)
    var cbx = cropBox.offsetLeft, cby = cropBox.offsetTop;
    var cx = cbx + cbW / 2, cy = cby + cbH / 2;
    var ix = cx - dw / 2 + offX, iy = cy - dh / 2 + offY;
    // clamp so the crop box always stays covered by the image:
    // image-left must stay within [cropRight - imgW, cropLeft]
    ix = Math.min(cbx, Math.max(cbx + cbW - dw, ix));
    iy = Math.min(cby, Math.max(cby + cbH - dh, iy));
    offX = ix - (cx - dw / 2);
    offY = iy - (cy - dh / 2);
    stageImg.style.width = dw + "px";
    stageImg.style.height = dh + "px";
    stageImg.style.left = ix + "px";
    stageImg.style.top = iy + "px";
  }

  function mmToPx(mm) { return Math.round(mm / 25.4 * DPI); }

  makeBtn.addEventListener("click", function () {
    if (!img) return;
    Mint.hideAlert("alertBox");
    resultBox.style.display = "none";
    makeBtn.disabled = true;
    Mint.setProgress("progressWrap", 30, "Making your photo…");

    try {
      var spec = sizeSpec();
      var tw = mmToPx(spec.wMm), th = mmToPx(spec.hMm);
      var bg = Mint.el("bgSel").value;

      // source rect in natural pixels
      var stageW = stage.clientWidth;
      var cbW = cropBox.offsetWidth, cbH = cropBox.offsetHeight;
      var cbx = cropBox.offsetLeft, cby = cropBox.offsetTop;
      var base = Math.max(cbW / natW, cbH / natH);
      var s = base * zoom;
      var dw = natW * s, dh = natH * s;
      var cx = cbx + cbW / 2, cy = cby + cbH / 2;
      var ix = cx - dw / 2 + offX, iy = cy - dh / 2 + offY;
      var sx = Math.max(0, (cbx - ix) / s), sy = Math.max(0, (cby - iy) / s);
      var sw = Math.min(natW - sx, cbW / s), sh = Math.min(natH - sy, cbH / s);

      // single photo
      var c = document.createElement("canvas");
      c.width = tw; c.height = th;
      var x = c.getContext("2d");
      x.fillStyle = bg;
      x.fillRect(0, 0, tw, th);
      x.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);

      // 4x6" print sheet at 300 DPI, user-chosen grid, centered
      var sheetW = SHEET_W, sheetHpx = SHEET_H;
      var sh2 = document.createElement("canvas");
      sh2.width = sheetW; sh2.height = sheetHpx;
      var sx2 = sh2.getContext("2d");
      sx2.fillStyle = "#ffffff";
      sx2.fillRect(0, 0, sheetW, sheetHpx);
      var cols = Math.min(maxSheetCols(), parseInt(Mint.el("sheetCols").value, 10) || 1);
      var rows = Math.min(maxSheetRows(), parseInt(Mint.el("sheetRows").value, 10) || 1);
      var gx = (sheetW - cols * tw) / 2, gy = (sheetHpx - rows * th) / 2;
      for (var r = 0; r < rows; r++) {
        for (var q = 0; q < cols; q++) {
          sx2.drawImage(c, gx + q * tw, gy + r * th);
        }
      }

      Mint.el("singleImg").src = c.toDataURL("image/png");
      Mint.el("sheetImg").src = sh2.toDataURL("image/png");
      Mint.el("sheetNote").textContent = (cols * rows) + " " + ((cols * rows) === 1 ? "copy" : "copies") +
        " (" + cols + "×" + rows + ") on a 4×6″ sheet — print at 100% scale (300 DPI).";

      c.toBlob(function (b1) {
        sh2.toBlob(function (b2) {
          singleBlob = b1; sheetBlob = b2;
          Mint.el("statRow").innerHTML =
            "<div class='stat'><strong>" + tw + "×" + th + "</strong>px photo</div>" +
            "<div class='stat'><strong>" + (cols * rows) + "</strong>copies per sheet</div>";
          Mint.setProgress("progressWrap", 100, "Done!");
          resultBox.style.display = "block";
          resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
          Mint.hideProgress("progressWrap");
          makeBtn.disabled = false;
        }, "image/png");
      }, "image/png");
    } catch (err) {
      Mint.hideProgress("progressWrap");
      makeBtn.disabled = false;
      Mint.showAlert("alertBox", "error", err.message || "Could not make the photo. Please try again.");
    }
  });

  Mint.el("dlSingle").addEventListener("click", function () {
    if (singleBlob) Mint.downloadBlob(singleBlob, "passport-photo.png");
  });
  Mint.el("dlSheet").addEventListener("click", function () {
    if (sheetBlob) Mint.downloadBlob(sheetBlob, "passport-photos-4x6.png");
  });

  window.addEventListener("resize", function () { if (img) layoutCrop(); });
})();
