'use strict';

// Renders the batch's lab PDF on the report page and drives the open/download
// buttons — all without a single PDF response crossing the network, so a
// download-manager browser extension (Internet Download Manager and its kind)
// has nothing to intercept.
//
// How it dodges IDM:
//   • The bytes arrive as base64 in a text/plain response, decoded here. IDM
//     inspects response headers to decide what to grab; text is invisible to it.
//   • PDF.js paints those bytes onto canvases — no browser PDF plugin involved.
//   • Open and Download act on an in-page blob: URL built from the same bytes.
//     IDM hooks http(s) requests; a blob: URL never makes one, so it cannot be
//     grabbed.
//
// Enhancement only. With JS off the page offers a link to open the PDF, and the
// two buttons fall back to their server hrefs (which a no-JS visitor with IDM would
// see intercepted — the rare edge this cannot reach).

(function () {
  var root = document.querySelector('[data-pdf]');
  if (!root) return;

  var statusEl = root.querySelector('[data-pdf-status]');
  var pagesEl = root.querySelector('[data-pdf-pages]');
  var src = root.getAttribute('data-src');
  var workerSrc = root.getAttribute('data-worker');
  var code = root.getAttribute('data-code') || 'report';

  var downloadName = 'superfeels-' + code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-coa.pdf';

  var bytes = null;    // Uint8Array of the PDF, kept for the blob actions
  var blobUrl = null;

  function fail(message) {
    if (!statusEl) return;
    statusEl.innerHTML = '';
    var p = document.createElement('p');
    p.textContent = message || 'The report could not be displayed here.';
    var a = document.createElement('a');
    a.className = 'btn btn--solid btn--sm';
    a.href = src.replace('embed=1', 'inline=1');
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Open the PDF';
    statusEl.appendChild(p);
    statusEl.appendChild(a);
    statusEl.hidden = false;
  }

  function blobUrlFor() {
    if (!blobUrl && bytes) {
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    }
    return blobUrl;
  }

  // Rewire the buttons once the bytes are in memory. Before that, their hrefs
  // stand, so an early click still does something sensible.
  function wireButtons() {
    var dl = document.querySelector('[data-pdf-download]');
    if (dl) dl.addEventListener('click', function (e) {
      if (!bytes) return; // not ready — let the href handle it
      e.preventDefault();
      var a = document.createElement('a');
      a.href = blobUrlFor();
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    var op = document.querySelector('[data-pdf-open]');
    if (op) op.addEventListener('click', function (e) {
      if (!bytes) return;
      e.preventDefault();
      window.open(blobUrlFor(), '_blank', 'noopener');
    });
  }

  function base64ToBytes(b64) {
    var raw = atob(b64.trim());
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  if (!window.pdfjsLib || !window.pdfjsLib.getDocument) {
    return fail('The report viewer could not load. Open the PDF instead.');
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  wireButtons();

  // Render at container width times device pixel ratio, capped, so a page is
  // crisp on a phone without asking for an enormous canvas on a tablet.
  function targetWidth() {
    var w = pagesEl.clientWidth || root.clientWidth || 800;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    return Math.min(w, 1100) * dpr;
  }

  // `reload` bypasses any stored entry for this URL and always takes the
  // network copy, so a corrected report is never masked by a cached one.
  fetch(src, { credentials: 'same-origin', cache: 'reload' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (b64) {
      bytes = base64ToBytes(b64);
      // PDF.js may transfer (detach) the buffer it is given to its worker, so
      // hand it a copy and keep `bytes` intact for the blob download.
      return window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    })
    .then(function (pdf) {
      statusEl.hidden = true;
      pagesEl.hidden = false;

      var chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) {
        (function (pageNum) {
          chain = chain.then(function () {
            return pdf.getPage(pageNum).then(function (page) {
              var unscaled = page.getViewport({ scale: 1 });
              var scale = targetWidth() / unscaled.width;
              var viewport = page.getViewport({ scale: scale });

              var canvas = document.createElement('canvas');
              canvas.className = 'doc__page';
              canvas.width = Math.floor(viewport.width);
              canvas.height = Math.floor(viewport.height);
              canvas.style.width = '100%';
              canvas.setAttribute('role', 'img');
              canvas.setAttribute('aria-label', 'Lab report page ' + pageNum + ' of ' + pdf.numPages);
              pagesEl.appendChild(canvas);

              return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
            });
          });
        })(n);
      }
      return chain;
    })
    .catch(function (err) {
      fail('The report could not be displayed here.');
      if (window.console) console.warn('PDF render failed:', err && err.message);
    });

  window.addEventListener('pagehide', function () {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  });
})();
