/* MergeMint shell — theme toggle, mobile sidebar, Ctrl+K, tool search/filter. */
(function () {
  "use strict";

  /* ---------- theme toggle ---------- */
  var toggle = document.getElementById("themeToggle");
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("mm-theme", t); } catch (e) {}
    if (toggle) toggle.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
  if (toggle) {
    toggle.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      setTheme(cur === "dark" ? "light" : "dark");
    });
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }

  /* ---------- mobile sidebar ---------- */
  var menuBtn = document.getElementById("menuBtn");
  var scrim = document.getElementById("sbScrim");
  function closeSidebar() { document.body.classList.remove("sidebar-open"); }
  if (menuBtn) menuBtn.addEventListener("click", function () {
    document.body.classList.toggle("sidebar-open");
  });
  if (scrim) scrim.addEventListener("click", closeSidebar);
  document.querySelectorAll(".sidebar a").forEach(function (a) {
    a.addEventListener("click", closeSidebar);
  });

  /* ---------- search inputs ---------- */
  var sbSearch = document.getElementById("sbSearch");
  var heroSearch = document.getElementById("heroSearch");

  function goToSearch(q) {
    q = (q || "").trim();
    if (!q) return;
    window.location.href = "index.html?q=" + encodeURIComponent(q);
  }
  if (sbSearch) {
    sbSearch.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); goToSearch(sbSearch.value); }
    });
  }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      var target = heroSearch || sbSearch;
      if (target) { target.focus(); target.select(); }
    }
  });

  /* ---------- homepage live filter ---------- */
  var params = new URLSearchParams(window.location.search);
  var initialQ = params.get("q") || "";
  var pills = Array.prototype.slice.call(document.querySelectorAll(".pill"));
  var activeCat = "all";

  function norm(s) { return (s || "").toLowerCase(); }

  function applyFilter() {
    var q = norm(heroSearch ? heroSearch.value : initialQ);
    var shown = 0;
    document.querySelectorAll(".tool-row, .feat-card[data-name]").forEach(function (el) {
      var name = norm(el.getAttribute("data-name"));
      var cat = el.getAttribute("data-cat") || "all";
      var okQ = !q || name.indexOf(q) !== -1;
      var okC = activeCat === "all" || cat === activeCat;
      var show = okQ && okC;
      el.style.display = show ? "" : "none";
      if (show && el.classList.contains("tool-row")) shown++;
    });
    document.querySelectorAll(".cat").forEach(function (cat) {
      var anyVisible = Array.prototype.some.call(
        cat.querySelectorAll(".tool-row"),
        function (r) { return r.style.display !== "none"; }
      );
      cat.style.display = anyVisible ? "" : "none";
    });
    var empty = document.getElementById("noResults");
    if (empty) empty.classList.toggle("visible", shown === 0);
    var featLabel = document.getElementById("featLabel");
    var featGrid = document.getElementById("featGrid");
    if (featGrid) {
      var anyFeat = Array.prototype.some.call(
        featGrid.querySelectorAll(".feat-card"),
        function (c) { return c.style.display !== "none"; }
      );
      featGrid.style.display = anyFeat ? "" : "none";
      if (featLabel) featLabel.style.display = anyFeat ? "" : "none";
    }
  }

  if (heroSearch) {
    if (initialQ) heroSearch.value = initialQ;
    heroSearch.addEventListener("input", applyFilter);
    heroSearch.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); applyFilter(); }
    });
  }
  pills.forEach(function (p) {
    p.addEventListener("click", function () {
      pills.forEach(function (x) { x.classList.remove("active"); });
      p.classList.add("active");
      activeCat = p.getAttribute("data-cat") || "all";
      applyFilter();
    });
  });
  if (heroSearch || pills.length) applyFilter();
})();
