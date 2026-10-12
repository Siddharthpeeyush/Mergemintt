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

/* Inline logo: the GitHub connector cannot push binary files, so the icon
   travels as a data URI and is swapped in as soon as this script runs. */
(function () {
  var MM_LOGO = "data:image/webp;base64,UklGRmQEAABXRUJQVlA4IFgEAAAwGgCdASpgAGAAPlEgjkUjoiEU6L48OAUEoA0I3pXz5G/kPyA6OzjSRY9JcH9Xu3M8wH8A/o37Qe8TpunoAeWz7Nv7XekzqsrGv7b+L3QwntH33OI/4D8jOCu4z+xmjSciRFR/0PTrzx/Qn/U/vfwC/qr/sPWA9enkzHtc/QShEqjE+Wn01IPfQ9Ww1PQRn/XTB119h9u0H2fIEJWBMyKh9YM5AuL5qLFnBfIQNxdYlvVlXzaN3OdAdlGGH3mO142X9LciVQMudzVttZrq9yDNfW/J4amOJ6vGAAD+/8ZQ3m8Td8GH9y5A01ec0K0YZWEgkbRRM4ARjovbdQWCUkXjg62bS4WsSrdPD5WdUa1GBip5eWhy4dx/q54TS/0MaAmdFhcoomQIhNa5JbLEcfJAQDo6V0SjRxsyH5jl895GTIAuomhfDfJAL5aBVpVtCICCWQp7Wtt0nOsW/BhYhlv9dk4lBv1M1VL6vywY7ub5nvLDODExtbGvJ59DIPRIW2U0z2yyQBkpqyL/n79eoF7OHG0hZnTgMQ91HPIF9FcX00aRcR+2VOt6JZK0xCGAPVu9bOZe5gJUgt/XKbnussXtu0849aduHXRQsbNQNsNe1d9YLkFMs2yWdGy8K6lziHnCBmlYVnZU7B4pRlPUjj8Xu5DkoAMrWvh2a1UryW8HYexbv7t5hGujPfC+Q0T4lU0Kwf+m979UwENgo9ywR/w0D0g5j879cWSIJ0mxRWvR5rNHv0At0S5X8udIn7z1iDe2H9c11vKSGxn3wHATpgxBAkzb6gmIlOzwo2w7j9CDkhkxG386SDYlvxwhW5IectEoke1UAISxCrJg19dlMaZ44s4q+/dMOHqcoZ1W2/vipxEWcetEwEmAS5tdP9+LlYZhygyAUjpGP0S1BWqJf1+NWN6Tws4AjYn77+whRr05j6ONLTWq8nq8lR/+g+y1tOmkeYtYgLI+b8qJLnmhw06I5JAmZQWerrZI3xKtTD/Gpn/Rd93mFp1KFWGNbXrUSZPPGw7VF4n4OriGx2xtx30tfvT9Jgl4JvEbcNZTjj17Xc0KG91T6Jf0V8pi/a51nA9ABLAWeep/723l/yf/mKQwGuP0mQ3lqHP+ZXt/z/spZApRXNFi0bB8U7/xnmiks6e7kLpM/+Z+bgJ5e2g2KslEzyWSSjwBjvwH22mKwZnaDZHAzYVBPo8tUNPgHoNPgF/S62jRUu/dOw/7ew9SWreqYaD0+C92ITrjjppU+NpUJav1mLjJUdxNbk1VRO0ekff4pVuiMlw5VaEstbWk/0ERX+v6xZmR/DHe5rTTwe7KKC5ZA2R836RTQy7m3z5lLgV5t+Ut+SOxnS9fPOJsZKTAk0u+dy4csQ/VnPuz/pHxbrMrzDIBPAc+bBVjwCRzN1QgenOkEIN1dNjm5ZIxOo2H/NN0C+6vBHRI6+Xf9O9WYnv7FxUeuo1zJb3VRfu9An182OfhBgAAAA==";
  var fav = document.querySelector('link[rel="icon"]');
  if (fav) fav.href = MM_LOGO;
  var imgs = document.querySelectorAll('img[src="assets/icon.webp"]');
  for (var i = 0; i < imgs.length; i++) { imgs[i].src = MM_LOGO; }
})();
