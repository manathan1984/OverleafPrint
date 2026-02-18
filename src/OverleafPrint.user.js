// ==UserScript==
// @name         Overleaf: Cmd+P prints latest compiled PDF
// @namespace    https://example.com/
// @version      0.3
// @description  Intercept Cmd/Ctrl+P in Overleaf editor and print the latest compiled PDF. Cmd/Ctrl+Shift+P opens PDF in new tab.
// @match        https://www.overleaf.com/project/*
// @grant        GM_xmlhttpRequest
// @connect      compiles.overleafusercontent.com
// @connect      *.overleafusercontent.com
// ==/UserScript==

(function () {
  "use strict";

  function toast(msg, ms = 5000) {
    const id = "ol-print-toast";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.style.cssText = `
        position: fixed; right: 16px; bottom: 16px; z-index: 999999;
        background: rgba(0,0,0,.85); color: white; padding: 10px 12px;
        border-radius: 10px; font: 13px/1.3 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        max-width: 340px;
      `;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = "none"), ms);
  }

  function findLatestPdfUrl() {
    // 1) Try resource timing (usually the most reliable)
    const resources = performance.getEntriesByType?.("resource") || [];
    for (let i = resources.length - 1; i >= 0; i--) {
      const u = resources[i]?.name || "";
      if (u.includes("output/output.pdf")) return u;
    }

    // 2) Fallback: look for iframe/a tags containing output/output.pdf
    for (const ifr of document.querySelectorAll("iframe")) {
      const src = ifr.getAttribute("src") || "";
      if (src.includes("output/output.pdf")) return new URL(src, location.href).href;
    }
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      if (href.includes("output/output.pdf")) return new URL(href, location.href).href;
    }

    return null;
  }

  function withCacheBuster(pdfUrl) {
    const u = new URL(pdfUrl);
    u.searchParams.set("_tmts", String(Date.now())); // cache buster
    return u.toString();
  }

  function openLatestPdfInNewTab() {
    const pdfUrl = findLatestPdfUrl();
    if (!pdfUrl) {
      toast("No compiled PDF URL found yet. Compile once, then try Cmd+Shift+P again.", 5000);
      return;
    }
    const fetchUrl = withCacheBuster(pdfUrl);
    toast("Opening compiled PDF in a new tab…");
    window.open(fetchUrl, "_blank", "noopener,noreferrer");
  }

  function gmFetchArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        onload: (resp) => {
          if (resp.status >= 200 && resp.status < 300 && resp.response) {
            resolve(resp.response);
          } else {
            reject(new Error(`HTTP ${resp.status}`));
          }
        },
        onerror: () => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Timeout")),
        timeout: 60000,
      });
    });
  }

  function printPdfBlob(blob) {
    const blobUrl = URL.createObjectURL(blob);

    // Hidden iframe so we can call print() in a same-origin context (blob URL)
    const iframe = document.createElement("iframe");
    iframe.style.cssText = `
      position: fixed; width: 0; height: 0; border: 0; left: -9999px; top: -9999px;
    `;
    iframe.src = blobUrl;

    const cleanup = () => {
      try { URL.revokeObjectURL(blobUrl); } catch {}
      try { iframe.remove(); } catch {}
    };

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } finally {
          setTimeout(cleanup, 60000);
        }
      }, 700);
    };

    document.body.appendChild(iframe);
  }

  async function cmdPPrintLatestPdf() {
    const pdfUrl = findLatestPdfUrl();
    if (!pdfUrl) {
      toast("No compiled PDF URL found yet. Compile once, then try Cmd+P again.");
      return;
    }
    const fetchUrl = withCacheBuster(pdfUrl);

    toast("Fetching latest compiled PDF…");
    try {
      const ab = await gmFetchArrayBuffer(fetchUrl);
      const blob = new Blob([ab], { type: "application/pdf" });
      toast("Opening print dialog…");
      printPdfBlob(blob);
    } catch (err) {
      console.warn("Overleaf print script failed:", err);
      toast("Fetch/print failed — opening PDF in a new tab (then Cmd+P).", 5000);
      window.open(fetchUrl, "_blank", "noopener,noreferrer");
    }
  }

  // Capture to beat CodeMirror/Overleaf handlers.
  document.addEventListener(
    "keydown",
    (e) => {
      const key = (e.key || "").toLowerCase();
      const isCmdOrCtrl = (e.metaKey || e.ctrlKey) && !e.altKey;
      const isP = key === "p";
      if (!(isCmdOrCtrl && isP)) return;

      e.preventDefault();
      e.stopPropagation();

      // Cmd/Ctrl+Shift+P -> open PDF in a new tab
      if (e.shiftKey) {
        openLatestPdfInNewTab();
        return;
      }

      // Cmd/Ctrl+P -> print
      cmdPPrintLatestPdf();
    },
    true
  );

  toast("Overleaf hook installed: Cmd+P prints PDF, Cmd+Shift+P opens PDF in new tab.");
})();
