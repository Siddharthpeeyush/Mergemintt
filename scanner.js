/* MergeMint — Doc Scanner tool logic.
   Turn a photo of a document into a clean scan: drag the four corner
   handles onto the page corners, pick Color / Grayscale / B&W, and the
   tool perspective-corrects the page (homography warp, pure JS) and
   enhances it. An "Auto-detect corners" button tries OpenCV.js edge
   detection when that library loads; dragging the corners always works
   as a fallback. Output: JPG/PNG image, or a one-page PDF.
   Requires pdf-lib (PDFLib) for the PDF export and app.js (Mint). */
(function () {
  "use strict";

  var OPENCV_CDN = "https://docs.opencv.org/4.8.0/opencv.js";

  var file = null, img = null, imgUrl = null;
  // Corners in natural image pixels, in TL / TR / BR / BL order.
  var corners = null, dragIdx = -1, resultBlob = null, resultName = "", resultJpgBlob = null;

  Mint.setupDropzone("dropzone", {
    input: Mint.el("fileInput"),
    accept: ".jpg,.jpeg,.png,.webp",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    if (!/^image\//.test(f.type) && !/\.(jpg|jpeg|png|webp)$/i.test(f.name)) {
      Mint.showAlert("alertBox", "error", "Please upload an image (JPG, PNG or WebP)."); return;
    }
    file = f; resultBlob = null; resultJpgBlob = null;
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    imgUrl = URL.createObjectURL(f);
    img = new Image();
    img.onload = function () {
      var insetX = img.naturalWidth * 0.06, insetY = img.naturalHeight * 0.06;
      corners = [
        { x: insetX, y: insetY },
        { x: img.naturalWidth - insetX, y: insetY },
        { x: img.naturalWidth - insetX, y: img.naturalHeight - insetY },
        { x: insetX, y: img.naturalHeight - insetY }
      ];
      Mint.el("fileList").innerHTML = "";
      Mint.el("fileList").appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
      var stageImg = Mint.el("scanImg");
      stageImg.src = imgUrl;
      Mint.el("stageBox").style.display = "";
      Mint.el("optionsBox").style.display = "";
      Mint.el("scanBtn").disabled = false;
      Mint.el("resultBox").style.display = "none";
      drawOverlay();
    };
    img.onerror = function () { Mint.showAlert("alertBox", "error", "Could not read this image."); };
    img.src = imgUrl;
  }

  function resetAll() {
    file = null; img = null; corners = null; resultBlob = null; resultJpgBlob = null;
    Mint.el("fileList").innerHTML = "";
    Mint.el("stageBox").style.display = "none";
    Mint.el("optionsBox").style.display = "none";
    Mint.el("scanBtn").disabled = true;
    Mint.el("resultBox").style.display = "none";
    Mint.hideAlert("alertBox");
  }

  function scale() {
    var el = Mint.el("scanImg");
    if (!el.clientWidth || !img) return 1;
    return el.clientWidth / img.naturalWidth;
  }

  function drawOverlay() {
    if (!img || !corners) return;
    var s = scale();
    var svg = Mint.el("quadSvg");
    var pts = corners.map(function (c) { return (c.x * s) + "," + (c.y * s); }).join(" ");
    svg.querySelector("polygon").setAttribute("points", pts);
    corners.forEach(function (c, i) {
      var h = Mint.el("handle-" + i);
      h.style.left = (c.x * s - 11) + "px";
      h.style.top = (c.y * s - 11) + "px";
    });
  }

  window.addEventListener("resize", drawOverlay);
  Mint.el("scanImg").addEventListener("load", drawOverlay);

  [0, 1, 2, 3].forEach(function (i) {
    var h = Mint.el("handle-" + i);
    h.addEventListener("pointerdown", function (ev) {
      dragIdx = i;
      h.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    h.addEventListener("pointermove", function (ev) {
      if (dragIdx !== i || !img) return;
      var rect = Mint.el("scanImg").getBoundingClientRect();
      var s = scale();
      var x = (ev.clientX - rect.left) / s;
      var y = (ev.clientY - rect.top) / s;
      corners[i].x = Math.max(0, Math.min(img.naturalWidth, x));
      corners[i].y = Math.max(0, Math.min(img.naturalHeight, y));
      drawOverlay();
    });
    h.addEventListener("pointerup", function () { dragIdx = -1; });
    h.addEventListener("pointercancel", function () { dragIdx = -1; });
  });

  // ---- Homography (DLT, 8 unknowns, Gaussian elimination) ----
  function solveHomography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i].x, y = src[i].y, u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var n = 8;
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) { if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r; }
      if (Math.abs(A[piv][col]) < 1e-12) throw new Error("Corners are too close together to scan — spread them out.");
      var tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
      var tb = b[col]; b[col] = b[piv]; b[piv] = tb;
      for (var r2 = col + 1; r2 < n; r2++) {
        var f = A[r2][col] / A[col][col];
        for (var c = col; c < n; c++) A[r2][c] -= f * A[col][c];
        b[r2] -= f * b[col];
      }
    }
    var h = new Array(9);
    for (var r3 = n - 1; r3 >= 0; r3--) {
      var sum = b[r3];
      for (var c2 = r3 + 1; c2 < n; c2++) sum -= A[r3][c2] * h[c2];
      h[r3] = sum / A[r3][r3];
    }
    h[8] = 1;
    return h;
  }

  function invert3(h) {
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7], l = h[8];
    var A = e * l - f * k, B = -(d * l - f * g), C = d * k - e * g;
    var det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) throw new Error("Corners are too close together to scan — spread them out.");
    return [
      A / det, (c * k - b * l) / det, (b * f - c * e) / det,
      B / det, (a * l - c * g) / det, (c * d - a * f) / det,
      C / det, (b * g - a * k) / det, (a * e - b * d) / det
    ];
  }

  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  function otsuThreshold(gray, w, h) {
    var hist = new Array(256).fill(0);
    for (var i = 0; i < gray.length; i++) hist[gray[i]]++;
    var total = gray.length, sum = 0;
    for (var t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, max = 0, thr = 127;
    for (var t2 = 0; t2 < 256; t2++) {
      wB += hist[t2];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += t2 * hist[t2];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; thr = t2; }
    }
    return thr;
  }

  Mint.el("scanBtn").addEventListener("click", function () {
    if (!img || !corners) return;
    Mint.hideAlert("alertBox");
    Mint.el("resultBox").style.display = "none";
    Mint.setProgress("progressWrap", 10, "Warping the page… (a few seconds for big photos)");
    // Run the heavy warp after the progress bar paints.
    setTimeout(function () {
      try {
        var tl = corners[0], tr = corners[1], br = corners[2], bl = corners[3];
        var W = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
        var H = Math.round(Math.max(dist(tr, br), dist(tl, bl)));
        var maxDim = 2000;
        if (Math.max(W, H) > maxDim) { var s = maxDim / Math.max(W, H); W = Math.round(W * s); H = Math.round(H * s); }
        var Hm = solveHomography(corners, [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]);
        var Hi = invert3(Hm);
        var srcCanvas = document.createElement("canvas");
        srcCanvas.width = img.naturalWidth; srcCanvas.height = img.naturalHeight;
        srcCanvas.getContext("2d").drawImage(img, 0, 0);
        var src = srcCanvas.getContext("2d").getImageData(0, 0, srcCanvas.width, srcCanvas.height);
        var outCanvas = document.createElement("canvas");
        outCanvas.width = W; outCanvas.height = H;
        var octx = outCanvas.getContext("2d");
        var out = octx.createImageData(W, H);
        var sw = srcCanvas.width, sh = srcCanvas.height, sd = src.data, od = out.data;
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var wDen = Hi[6] * x + Hi[7] * y + Hi[8];
            var sx = (Hi[0] * x + Hi[1] * y + Hi[2]) / wDen;
            var sy = (Hi[3] * x + Hi[4] * y + Hi[5]) / wDen;
            var oi = (y * W + x) * 4;
            if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
              od[oi] = 255; od[oi + 1] = 255; od[oi + 2] = 255; od[oi + 3] = 255;
              continue;
            }
            var x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
            for (var ch = 0; ch < 3; ch++) {
              var p00 = sd[(y0 * sw + x0) * 4 + ch], p10 = sd[(y0 * sw + x0 + 1) * 4 + ch];
              var p01 = sd[((y0 + 1) * sw + x0) * 4 + ch], p11 = sd[((y0 + 1) * sw + x0 + 1) * 4 + ch];
              od[oi + ch] = Math.round(p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy);
            }
            od[oi + 3] = 255;
          }
        }
        octx.putImageData(out, 0, 0);
        // Enhancement pass.
        var mode = Mint.el("modeSel").value;
        if (mode !== "color") {
          var id = octx.getImageData(0, 0, W, H);
          var d = id.data, gray = new Uint8Array(W * H);
          for (var i = 0; i < W * H; i++) {
            gray[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
          }
          // Contrast stretch (2nd–98th percentile).
          var hist = new Array(256).fill(0);
          for (var j = 0; j < gray.length; j++) hist[gray[j]]++;
          var total = gray.length, acc = 0, lo = 0, hi = 255;
          for (var t = 0; t < 256; t++) { acc += hist[t]; if (acc >= total * 0.02) { lo = t; break; } }
          acc = 0;
          for (var t2 = 255; t2 >= 0; t2--) { acc += hist[t2]; if (acc >= total * 0.02) { hi = t2; break; } }
          if (hi <= lo) hi = lo + 1;
          var thr = mode === "bw" ? otsuThreshold(gray, W, H) : 0;
          for (var k = 0; k < W * H; k++) {
            var v = Math.max(0, Math.min(255, Math.round((gray[k] - lo) * 255 / (hi - lo))));
            if (mode === "bw") v = v > thr ? 255 : 0;
            d[k * 4] = v; d[k * 4 + 1] = v; d[k * 4 + 2] = v;
          }
          octx.putImageData(id, 0, 0);
        }
        var format = Mint.el("formatSel").value;
        var mime = format === "png" ? "image/png" : "image/jpeg";
        outCanvas.toBlob(function (blob) {
          if (!blob) { Mint.hideProgress("progressWrap"); Mint.showAlert("alertBox", "error", "Could not create the scan."); return; }
          resultBlob = blob;
          resultName = file.name.replace(/\.[^.]+$/, "") + "-scan." + format;
          Mint.el("scanResult").src = URL.createObjectURL(blob);
          Mint.el("statRow").innerHTML = "";
          var st = document.createElement("div"); st.className = "stat";
          st.textContent = "Scanned page: " + W + " × " + H + " px, " + Mint.formatBytes(blob.size);
          Mint.el("statRow").appendChild(st);
          Mint.el("resultBox").style.display = "";
          Mint.el("pdfBtn").disabled = false;
          Mint.hideProgress("progressWrap");
        }, mime, 0.92);
      } catch (err) {
        Mint.hideProgress("progressWrap");
        Mint.showAlert("alertBox", "error", err.message || "Could not scan this photo.");
      }
    }, 50);
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (resultBlob) Mint.downloadBlob(resultBlob, resultName);
  });

  Mint.el("pdfBtn").addEventListener("click", function () {
    if (!resultJpgBlob && !resultBlob) return;
    Mint.setProgress("progressWrap", 20, "Making PDF…");
    var useBlob = resultBlob;
    var chain = Promise.resolve(useBlob);
    if (resultBlob.type !== "image/jpeg") {
      var imgEl = new Image();
      chain = new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(resultBlob);
        imgEl.onload = function () {
          var c = document.createElement("canvas");
          c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight;
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(imgEl, 0, 0);
          c.toBlob(function (b) { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error("Could not make the PDF.")); }, "image/jpeg", 0.92);
        };
        imgEl.onerror = function () { reject(new Error("Could not make the PDF.")); };
        imgEl.src = url;
      });
    }
    chain.then(function (jpgBlob) {
      var r = new FileReader();
      r.onload = function () {
        var bytes = new Uint8Array(r.result);
        PDFLib.PDFDocument.create().then(function (doc) {
          return doc.embedJpg(bytes).then(function (jpg) {
            var page = doc.addPage([jpg.width, jpg.height]);
            page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
            return doc.save();
          });
        }).then(function (pdfBytes) {
          Mint.hideProgress("progressWrap");
          Mint.downloadBlob(new Blob([pdfBytes], { type: "application/pdf" }), file.name.replace(/\.[^.]+$/, "") + "-scan.pdf");
        });
      };
      r.readAsArrayBuffer(jpgBlob);
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not make the PDF.");
    });
  });

  // ---- Optional OpenCV auto-detect ----
  function cvReady() { return typeof cv !== "undefined" && cv && typeof cv.Mat === "function"; }

  Mint.el("autoBtn").addEventListener("click", function () {
    if (!img) return;
    Mint.el("autoBtn").disabled = true;
    Mint.el("autoBtn").textContent = "Detecting…";
    function runDetect() {
      try {
        var maxW = 1000;
        var s = Math.min(1, maxW / img.naturalWidth);
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var src = cv.imread(c);
        var gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
        cv.Canny(blur, edges, 50, 150);
        var contours = new cv.MatVector(), hierarchy = new cv.Mat();
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        var best = null, bestArea = 0;
        for (var i = 0; i < contours.size(); i++) {
          var cnt = contours.get(i);
          var area = cv.contourArea(cnt);
          if (area < bestArea) continue;
          var peri = cv.arcLength(cnt, true);
          var approx = new cv.Mat();
          cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
          if (approx.rows === 4 && area > bestArea) { best = approx; bestArea = area; }
          else { approx.delete(); }
        }
        if (!best) throw new Error("No page outline found — drag the corners instead.");
        var pts = [];
        for (var k = 0; k < 4; k++) {
          pts.push({ x: best.data32S[k * 2] / s, y: best.data32S[k * 2 + 1] / s });
        }
        var tl = pts.reduce(function (a, b) { return (a.x + a.y) < (b.x + b.y) ? a : b; });
        var br = pts.reduce(function (a, b) { return (a.x + a.y) > (b.x + b.y) ? a : b; });
        var tr = pts.reduce(function (a, b) { return (a.x - a.y) > (b.x - b.y) ? a : b; });
        var bl = pts.reduce(function (a, b) { return (a.x - a.y) < (b.x - b.y) ? a : b; });
        corners = [tl, tr, br, bl];
        drawOverlay();
        src.delete(); gray.delete(); blur.delete(); edges.delete(); contours.delete(); hierarchy.delete(); best.delete();
        Mint.el("autoBtn").textContent = "Auto-detect corners";
        Mint.el("autoBtn").disabled = false;
      } catch (err) {
        Mint.el("autoBtn").textContent = "Auto-detect corners";
        Mint.el("autoBtn").disabled = false;
        Mint.showAlert("alertBox", "info", err.message || "Auto-detect did not find a page — drag the corners instead.");
      }
    }
    if (cvReady()) { runDetect(); return; }
    Mint.loadScript(OPENCV_CDN).then(function () {
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        if (cvReady()) { clearInterval(timer); runDetect(); }
        else if (tries > 75) {
          clearInterval(timer);
          Mint.el("autoBtn").textContent = "Auto-detect corners";
          Mint.el("autoBtn").disabled = false;
          Mint.showAlert("alertBox", "info", "The vision library did not load (check connection). Drag the corners instead — that always works.");
        }
      }, 200);
    }).catch(function () {
      Mint.el("autoBtn").textContent = "Auto-detect corners";
      Mint.el("autoBtn").disabled = false;
      Mint.showAlert("alertBox", "info", "The vision library did not load (check connection). Drag the corners instead — that always works.");
    });
  });
})();
