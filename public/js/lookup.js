'use strict';

// The batch input. Cosmetic only — src/lib/validate.js#batchKey does the real
// normalising on the server, and this file being blocked changes nothing about
// which codes resolve.

(function () {
  var input = document.getElementById('batch');
  if (!input) return;

  // Codes are printed in capitals, so what is typed should look like what is
  // on the label. `text-transform` in CSS only changes the rendering, which
  // means a pasted lowercase code still *reads* as lowercase in the field on
  // some mobile keyboards; this makes the value itself match.
  input.addEventListener('input', function () {
    var start = input.selectionStart;
    var end = input.selectionEnd;
    var upper = input.value.toUpperCase();
    if (upper === input.value) return;
    input.value = upper;
    // Rewriting `value` collapses the caret to the end, which makes correcting
    // a character in the middle of a code impossible.
    try { input.setSelectionRange(start, end); } catch (e) { /* not a text input */ }
  });

  // A code pasted out of an email arrives wrapped in whitespace and sometimes
  // in an en dash, because a mail client turned the hyphen into one. Both are
  // handled server-side too, but trimming here means the field shows the same
  // thing the server will read.
  input.addEventListener('paste', function () {
    setTimeout(function () {
      input.value = input.value.trim().replace(/[‐-―]/g, '-').toUpperCase();
    }, 0);
  });
})();
