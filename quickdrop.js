/* MergeMint homepage quick-drop: drop a file, get its actions instantly.
   Everything runs in the browser. No uploads, no Shift key needed. */
(function () {
  "use strict";

  var wrap = document.getElementById("qaWrap");
  if (!wrap) return;
  var drop = document.getElementById("qaDrop");
  var picker = document.getElementById("qaFile");
  var card = document.getElementById("qaCard");
  var thumb = document.getElementById("qaThumb");
  var thumbIcon = document.getElementById("qaThumbIcon");
  var fileName = document.getElementById("qaName");
  var fileMeta = document.getElementById("qaMeta");
  var note = document.getElementById("qaNote");
  var actions = document.getElementById("qaActions");
  var workspace = document.getElementById("qaWorkspace");
  var status = document.getElementById("qaStatus");
  var clearBtn = document.getElementById("qaClear");

  var currentFile = null;
  var currentImg = null; /* loaded HTMLImageElement for image files */
  var currentURL = null;

  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }
  function extOf(name) {
    var i = name.lastIndexOf(".");
    return i > -1 ? name.slice(i + 1).toLowerCase() : "";
  }
  function stemOf(name) {
    var i = name.lastIndexOf(".");
    return i > -1 ? name.slice(0, i) : name;
  }
  function setStatus(msg) { status.textContent = msg || ""; }
  function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function makeBtn(label, onClick, primary) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "qa-btn" + (primary ? " qa-btn-primary" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
  function makeLink(label, href, primary, carry) {
    var a = document.createElement("a");
    a.className = "qa-btn" + (primary ? " qa-btn-primary" : "");
    a.href = href;
    a.textContent = label;
    if (carry) {
      /* Carry the file into the tool: save it locally first, then go.
         If saving fails, still navigate (old behaviour) rather than
         trapping the user on the homepage. */
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (!currentFile) return;
        if (!window.Mint || !Mint.saveQuickDrop) return;
        e.preventDefault();
        setStatus("Loading your file into the tool…");
        Mint.saveQuickDrop(currentFile).then(function () {
          window.location.href = href;
        }).catch(function () {
          window.location.href = href;
        });
      });
    }
    return a;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function drawToCanvas() {
    var c = document.createElement("canvas");
    c.width = currentImg.naturalWidth;
    c.height = currentImg.naturalHeight;
    var ctx = c.getContext("2d");
    ctx.drawImage(currentImg, 0, 0);
    return c;
  }
  function convertImage(mime, ext, quality) {
    if (!currentImg) return;
    try {
      var c = drawToCanvas();
      if (mime === "image/jpeg") {
        /* JPEG has no transparency: paint white behind the image. */
        var ctx = c.getContext("2d");
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
      }
      c.toBlob(function (blob) {
        if (!blob) { setStatus("Could not convert this image in this browser."); return; }
        downloadBlob(blob, stemOf(currentFile.name) + "." + ext);
        setStatus("Downloaded as " + ext.toUpperCase() + ".");
      }, mime, quality);
    } catch (e) { setStatus("Could not convert this image in this browser."); }
  }

  function showCompressPanel() {
    clearEl(workspace);
    var label = document.createElement("label");
    label.className = "qa-field";
    label.textContent = "Quality";
    var range = document.createElement("input");
    range.type = "range"; range.min = "10"; range.max = "100"; range.value = "85";
    var val = document.createElement("span");
    val.className = "qa-range-val";
    val.textContent = "85%";
    range.addEventListener("input", function () { val.textContent = range.value + "%"; });
    var fmtLabel = document.createElement("label");
    fmtLabel.className = "qa-field";
    fmtLabel.textContent = "Format";
    var sel = document.createElement("select");
    var ext = extOf(currentFile.name);
    var opts = [];
    if (ext === "jpg" || ext === "jpeg") opts = [["jpeg", "JPG (original)"], ["webp", "WebP"], ["png", "PNG"]];
    else if (ext === "webp") opts = [["webp", "WebP (original)"], ["jpeg", "JPG"], ["png", "PNG"]];
    else if (ext === "png") opts = [["png", "PNG (original)"], ["jpeg", "JPG"], ["webp", "WebP"]];
    else opts = [["jpeg", "JPG"], ["webp", "WebP"], ["png", "PNG"]];
    opts.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
    });
    var dl = makeBtn("Download compressed", function () {
      var mime = sel.value === "jpeg" ? "image/jpeg" : sel.value === "webp" ? "image/webp" : "image/png";
      var q = sel.value === "png" ? undefined : range.value / 100;
      convertImage(mime, sel.value === "jpeg" ? "jpg" : sel.value, q);
    }, true);
    workspace.appendChild(label); workspace.appendChild(range); workspace.appendChild(val);
    workspace.appendChild(fmtLabel); workspace.appendChild(sel); workspace.appendChild(dl);
    var hint = document.createElement("p");
    hint.className = "qa-hint";
    hint.textContent = "PNG is lossless, so quality only applies to JPG and WebP.";
    workspace.appendChild(hint);
  }

  function showResizePanel() {
    clearEl(workspace);
    var w = currentImg.naturalWidth, h = currentImg.naturalHeight;
    var wLabel = document.createElement("label"); wLabel.className = "qa-field"; wLabel.textContent = "Width (px)";
    var wIn = document.createElement("input"); wIn.type = "number"; wIn.min = "1"; wIn.value = String(w);
    var hLabel = document.createElement("label"); hLabel.className = "qa-field"; hLabel.textContent = "Height (px)";
    var hIn = document.createElement("input"); hIn.type = "number"; hIn.min = "1"; hIn.value = String(h);
    var lockLabel = document.createElement("label"); lockLabel.className = "qa-check";
    var lock = document.createElement("input"); lock.type = "checkbox"; lock.checked = true;
    lockLabel.appendChild(lock);
    lockLabel.appendChild(document.createTextNode(" Keep aspect ratio"));
    wIn.addEventListener("input", function () {
      if (lock.checked && +wIn.value > 0) hIn.value = String(Math.max(1, Math.round(+wIn.value * h / w)));
    });
    hIn.addEventListener("input", function () {
      if (lock.checked && +hIn.value > 0) wIn.value = String(Math.max(1, Math.round(+hIn.value * w / h)));
    });
    var dl = makeBtn("Download resized", function () {
      var nw = +wIn.value, nh = +hIn.value;
      if (!(nw > 0 && nh > 0)) { setStatus("Enter a valid width and height."); return; }
      try {
        var c = document.createElement("canvas");
        c.width = nw; c.height = nh;
        c.getContext("2d").drawImage(currentImg, 0, 0, nw, nh);
        var ext = extOf(currentFile.name);
        var mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        var outExt = ext === "png" ? "png" : ext === "webp" ? "webp" : "jpg";
        if (mime === "image/jpeg") {
          var ctx = c.getContext("2d");
          ctx.globalCompositeOperation = "destination-over";
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, nw, nh);
        }
        c.toBlob(function (blob) {
          if (!blob) { setStatus("Could not resize this image in this browser."); return; }
          downloadBlob(blob, stemOf(currentFile.name) + "-" + nw + "x" + nh + "." + outExt);
          setStatus("Downloaded at " + nw + " × " + nh + " px.");
        }, mime, 0.92);
      } catch (e) { setStatus("Could not resize this image in this browser."); }
    }, true);
    workspace.appendChild(wLabel); workspace.appendChild(wIn);
    workspace.appendChild(hLabel); workspace.appendChild(hIn);
    workspace.appendChild(lockLabel); workspace.appendChild(dl);
  }

  function buildActions(file) {
    clearEl(actions);
    clearEl(workspace);
    setStatus("");
    var type = file.type || "";
    var ext = extOf(file.name);
    var isImage = type.indexOf("image/") === 0 ||
      ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"].indexOf(ext) !== -1;
    var isPdf = type === "application/pdf" || ext === "pdf";

    if (isImage) {
      actions.appendChild(makeBtn("Convert to JPG", function () { convertImage("image/jpeg", "jpg", 0.92); }, true));
      actions.appendChild(makeBtn("Convert to PNG", function () { convertImage("image/png", "png"); }));
      actions.appendChild(makeBtn("Convert to WebP", function () { convertImage("image/webp", "webp", 0.9); }));
      actions.appendChild(makeBtn("Compress", showCompressPanel));
      actions.appendChild(makeBtn("Resize", showResizePanel));
      actions.appendChild(makeLink("Crop image →", "crop-image.html", false, true));
      actions.appendChild(makeLink("Remove background →", "bg-remover.html", false, true));
      actions.appendChild(makeLink("Passport photo →", "passport-photo.html", false, true));
      actions.appendChild(makeLink("Make a PDF →", "jpg-to-pdf.html", false, true));
      setStatus("Tip: JPG / PNG / WebP, compress and resize happen right here. Crop, background removal and passport photos open their full tool — with this file already loaded.");
    } else if (isPdf) {
      actions.appendChild(makeLink("Merge PDF →", "merge.html", true, true));
      actions.appendChild(makeLink("Split PDF →", "split.html", false, true));
      actions.appendChild(makeLink("Compress PDF →", "compress.html", false, true));
      actions.appendChild(makeLink("PDF to JPG →", "pdf-to-jpg.html", false, true));
      setStatus("Your file will open inside the tool you pick — no need to choose it again. It is never uploaded in any of them.");
    } else {
      var browse = document.createElement("a");
      browse.className = "qa-btn qa-btn-primary";
      browse.href = "#tools";
      browse.textContent = "Browse all tools ↓";
      actions.appendChild(browse);
      setStatus("No quick action for this file type yet — the full tool list is just below.");
    }
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    if (currentURL) { URL.revokeObjectURL(currentURL); currentURL = null; }
    currentFile = files[0];
    currentImg = null;
    fileName.textContent = currentFile.name;
    fileMeta.textContent = fmtSize(currentFile.size);
    note.textContent = files.length > 1
      ? files.length + " files dropped — using the first one for now."
      : "";
    var type = currentFile.type || "";
    var ext = extOf(currentFile.name);
    var isImage = type.indexOf("image/") === 0 ||
      ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"].indexOf(ext) !== -1;
    if (isImage) {
      currentURL = URL.createObjectURL(currentFile);
      thumb.src = currentURL;
      thumb.style.display = "block";
      thumbIcon.style.display = "none";
      var img = new Image();
      img.onload = function () { currentImg = img; };
      img.src = currentURL;
    } else {
      thumb.removeAttribute("src");
      thumb.style.display = "none";
      thumbIcon.style.display = "flex";
      thumbIcon.textContent = (ext || "FILE").toUpperCase().slice(0, 4);
    }
    card.hidden = false;
    buildActions(currentFile);
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  drop.addEventListener("click", function () { picker.click(); });
  drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picker.click(); }
  });
  picker.addEventListener("change", function () {
    handleFiles(picker.files);
    picker.value = "";
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    wrap.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.add("qa-dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    wrap.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === "drop") handleFiles(e.dataTransfer.files);
      drop.classList.remove("qa-dragover");
    });
  });

  clearBtn.addEventListener("click", function () {
    if (currentURL) { URL.revokeObjectURL(currentURL); currentURL = null; }
    currentFile = null; currentImg = null;
    card.hidden = true;
    clearEl(actions); clearEl(workspace); setStatus("");
    note.textContent = "";
  });
})();
