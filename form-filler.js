/* MergeMint — Form Filler tool logic.
   Fills real fillable PDF forms (AcroForm fields) in your browser:
   text fields, checkboxes, radio groups and dropdowns. Optionally
   flattens the form so the values become permanent.
   If a PDF has no form fields, it says so plainly — use Edit PDF
   to add text on top of a non-fillable document instead.
   Requires pdf-lib (PDFLib) and app.js (Mint). */
(function () {
  "use strict";

  var file = null, fileBytes = null, fields = [], filledBlob = null, filledName = "";

  Mint.setupDropzone("dropzone", {
    input: Mint.el("fileInput"),
    accept: "application/pdf,.pdf",
    multiple: false,
    onFiles: function (fs) { addFile(fs[0]); }
  });

  function addFile(f) {
    Mint.hideAlert("alertBox");
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      Mint.showAlert("alertBox", "error", "Please upload a PDF file."); return;
    }
    if (typeof PDFLib === "undefined") {
      Mint.showAlert("alertBox", "error", "The PDF library failed to load. Check your connection and reload."); return;
    }
    file = f; fields = []; filledBlob = null;
    Mint.setProgress("progressWrap", 10, "Reading form…");
    Mint.readAsArrayBuffer(f).then(function (bytes) {
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }).then(function (doc) {
        if (doc.isEncrypted) throw new Error("This PDF is password-protected. Please upload a copy without password protection.");
        fileBytes = bytes;
        var form = doc.getForm();
        fields = form.getFields();
        Mint.el("fileList").innerHTML = "";
        Mint.el("fileList").appendChild(Mint.fileRow(file, 0, { onRemove: resetAll }));
        Mint.el("pageInfo").style.display = "";
        Mint.el("pageInfo").textContent = "“" + file.name + "” — " + fields.length + " fillable field" + (fields.length === 1 ? "" : "s") + " found.";
        Mint.hideProgress("progressWrap");
        if (fields.length === 0) {
          Mint.showAlert("alertBox", "info", "This PDF has no fillable form fields. It is probably a flat document — use the Edit PDF tool to add text on top instead.");
          Mint.el("fieldsBox").style.display = "none";
          return;
        }
        renderFields();
      });
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not read this PDF.");
    });
  }

  function resetAll() {
    file = null; fileBytes = null; fields = []; filledBlob = null;
    Mint.el("fileList").innerHTML = "";
    Mint.el("pageInfo").style.display = "none";
    Mint.el("fieldsBox").style.display = "none";
    Mint.el("resultBox").style.display = "none";
    Mint.hideAlert("alertBox");
  }

  function fieldKind(field) {
    if (field instanceof PDFLib.PDFTextField) return "text";
    if (field instanceof PDFLib.PDFCheckBox) return "checkbox";
    if (field instanceof PDFLib.PDFRadioGroup) return "radio";
    if (field instanceof PDFLib.PDFDropdown) return "dropdown";
    return "other";
  }

  function renderFields() {
    var box = Mint.el("fieldsBox");
    box.style.display = "";
    var list = Mint.el("fieldList");
    list.innerHTML = "";
    fields.forEach(function (field, idx) {
      var kind = fieldKind(field);
      var wrap = document.createElement("div");
      wrap.className = "field-row";
      var label = document.createElement("label");
      label.setAttribute("for", "fld-" + idx);
      label.textContent = field.getName() + (kind === "other" ? " (unsupported field type)" : "");
      wrap.appendChild(label);
      var input;
      if (kind === "text") {
        input = document.createElement("input");
        input.type = "text"; input.id = "fld-" + idx;
        try { input.value = field.getText() || ""; } catch (e) { input.value = ""; }
      } else if (kind === "checkbox") {
        input = document.createElement("input");
        input.type = "checkbox"; input.id = "fld-" + idx;
        try { input.checked = field.isChecked(); } catch (e) { input.checked = false; }
      } else if (kind === "radio" || kind === "dropdown") {
        input = document.createElement("select");
        input.id = "fld-" + idx;
        var opts = kind === "radio" ? field.getOptions() : field.getOptions();
        var blank = document.createElement("option");
        blank.value = ""; blank.textContent = "— choose —";
        input.appendChild(blank);
        opts.forEach(function (o) {
          var op = document.createElement("option");
          op.value = o; op.textContent = o;
          input.appendChild(op);
        });
        try {
          var cur = kind === "radio" ? field.getSelected() : field.getSelected();
          if (cur) input.value = cur;
        } catch (e) { /* leave unselected */ }
      } else {
        input = document.createElement("input");
        input.type = "text"; input.id = "fld-" + idx; input.disabled = true;
        input.placeholder = "This field type is not supported yet";
      }
      input.setAttribute("data-field-index", idx);
      wrap.appendChild(input);
      list.appendChild(wrap);
    });
    Mint.el("fillBtn").disabled = false;
    Mint.el("resultBox").style.display = "none";
  }

  Mint.el("fillBtn").addEventListener("click", function () {
    if (!file || fields.length === 0) return;
    Mint.hideAlert("alertBox");
    Mint.setProgress("progressWrap", 20, "Filling form…");
    PDFLib.PDFDocument.load(fileBytes, { ignoreEncryption: true }).then(function (doc) {
      var form = doc.getForm();
      var live = form.getFields();
      live.forEach(function (field, idx) {
        var el = document.getElementById("fld-" + idx);
        if (!el || el.disabled) return;
        var kind = fieldKind(field);
        try {
          if (kind === "text") field.setText(el.value);
          else if (kind === "checkbox") { if (el.checked) field.check(); else field.uncheck(); }
          else if (kind === "radio") { if (el.value) field.select(el.value); }
          else if (kind === "dropdown") { if (el.value) field.select(el.value); }
        } catch (e) { /* leave this field as-is */ }
      });
      if (Mint.el("flattenCheck").checked) form.flatten();
      return doc.save();
    }).then(function (bytes) {
      filledBlob = new Blob([bytes], { type: "application/pdf" });
      filledName = file.name.replace(/\.pdf$/i, "") + "-filled.pdf";
      Mint.hideProgress("progressWrap");
      Mint.el("resultBox").style.display = "";
      Mint.el("statRow").innerHTML = "";
      var s = document.createElement("div"); s.className = "stat";
      s.textContent = "Filled PDF ready — " + Mint.formatBytes(filledBlob.size);
      Mint.el("statRow").appendChild(s);
      Mint.el("downloadBtn").disabled = false;
    }).catch(function (err) {
      Mint.hideProgress("progressWrap");
      Mint.showAlert("alertBox", "error", err.message || "Could not fill this form.");
    });
  });

  Mint.el("downloadBtn").addEventListener("click", function () {
    if (filledBlob) Mint.downloadBlob(filledBlob, filledName);
  });
})();
