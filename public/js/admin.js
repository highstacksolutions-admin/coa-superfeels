'use strict';

// Admin-wide behaviour. Enhancement only: every action here is a real form
// that works with this file blocked.

(function () {
  // ── Confirm destructive actions ─────────────────────────────────────────
  // A data-confirm on a form asks before submitting. Server-side there is no
  // undo for a delete, so this is the one guard between a mis-click and a gone
  // batch — but it is only a guard, not the authorisation, which is the CSRF
  // token and the admin session.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var msg = form.getAttribute && form.getAttribute('data-confirm');
    // A submit button can carry its own confirm (the "remove panel" button
    // that shares a form with "save").
    var btn = e.submitter;
    if (btn && btn.getAttribute('data-confirm')) msg = btn.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // ── Slug helpers ────────────────────────────────────────────────────────
  // A slug field pre-fills from its source field until the moment someone types
  // in the slug themselves, after which it is left alone.
  document.querySelectorAll('[data-slug-from]').forEach(function (slugField) {
    var source = document.getElementById(slugField.getAttribute('data-slug-from'));
    if (!source) return;
    var edited = slugField.value.trim() !== '';
    slugField.addEventListener('input', function () { edited = true; });
    source.addEventListener('input', function () {
      if (edited) return;
      slugField.value = source.value.toLowerCase()
        .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    });
  });

  // ── File drop zone ──────────────────────────────────────────────────────
  var drop = document.getElementById('drop');
  var input = document.getElementById('report-input');
  var picked = document.getElementById('drop-picked');
  if (drop && input) {
    var showPicked = function () {
      if (!picked) return;
      if (input.files && input.files.length) {
        var names = Array.prototype.map.call(input.files, function (f) { return f.name; });
        picked.textContent = names.join(', ');
        picked.hidden = false;
      } else {
        picked.hidden = true;
      }
    };
    input.addEventListener('change', showPicked);
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        showPicked();
      }
    });
  }
})();
