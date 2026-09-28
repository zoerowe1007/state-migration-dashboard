window.Common = (function () {
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("theme"); } catch (e) {}
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      const currentlyDark = current === "dark" || (!current && systemDark);
      const next = currentlyDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }

  function initNavShadow() {
    const nav = document.querySelector(".site-nav");
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function initBackToTop() {
    const btn = document.getElementById("back-to-top");
    if (!btn) return;
    const onScroll = () => btn.classList.toggle("is-visible", window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  function initReveal() {
    const els = document.querySelectorAll("[data-reveal]");
    if (!els.length) return;
    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -60px 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  function initToc() {
    const links = document.querySelectorAll(".toc-scroll a");
    if (!links.length) return;
    const targets = Array.from(links)
      .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
      .filter(Boolean);
    if (!("IntersectionObserver" in window) || !targets.length) return;

    const setActive = (id) => {
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + id));
    };
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
    );
    targets.forEach((el) => io.observe(el));

    links.forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const id = a.getAttribute("href").slice(1);
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
      });
    });
  }

  function countUp(el, target, opts) {
    opts = opts || {};
    const format = opts.format || ((v) => Math.round(v).toString());
    const duration = prefersReducedMotion() ? 0 : opts.duration || 900;
    if (!el) return;
    const start = Number(el.dataset.rawValue || 0);
    if (target == null || isNaN(target)) {
      el.textContent = opts.fallback || "n/a";
      el.dataset.rawValue = "";
      return;
    }
    el.dataset.rawValue = String(target);
    if (duration === 0 || start === target) {
      el.textContent = format(target);
      return;
    }
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function tick(now) {
      const p = Math.min(1, (now - t0) / duration);
      const val = start + (target - start) * ease(p);
      el.textContent = format(val);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = format(target);
    }
    requestAnimationFrame(tick);
  }

  function init() {
    initTheme();
    initNavShadow();
    initBackToTop();
    initReveal();
    initToc();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { countUp, prefersReducedMotion };
})();
