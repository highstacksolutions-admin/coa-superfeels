'use strict';

// The results grid. Adds rows, removes rows, and pastes a whole panel out of a
// PDF. Everything it produces is plain form fields the server would accept
// typed by hand — with this file blocked, the pre-existing rows still save, so
// no data is ever only reachable through JavaScript.

(function () {
  var COLS = ['analyte', 'value_text', 'unit', 'lod', 'loq', 'limit_text'];

  // The next index for a grid. Read off existing rows so a new row never
  // collides with a saved one's name, which would make the parser drop one.
  function nextIndex(grid) {
    var max = -1;
    grid.querySelectorAll('[data-row] input[name]').forEach(function (el) {
      var m = el.name.match(/^rows\[(\d+)\]/);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return max + 1;
  }

  function buildRow(grid, index, values) {
    values = values || {};
    var row = document.createElement('div');
    row.className = 'rowgrid__row';
    row.setAttribute('data-row', '');

    function input(col, cls) {
      var el = document.createElement('input');
      el.type = 'text';
      el.name = 'rows[' + index + '][' + col + ']';
      el.value = values[col] || '';
      if (cls) el.className = cls;
      return el;
    }

    row.appendChild(input('analyte', 'analyte-in'));
    row.appendChild(input('value_text'));
    row.appendChild(input('unit'));
    row.appendChild(input('lod'));
    row.appendChild(input('loq'));
    row.appendChild(input('limit_text'));

    var sel = document.createElement('select');
    sel.name = 'rows[' + index + '][status]';
    ['pass', 'fail', 'nd', 'na'].forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      o.textContent = { pass: 'Pass', fail: 'Fail', nd: 'ND', na: '—' }[s];
      if ((values.status || 'na') === s) o.selected = true;
      sel.appendChild(o);
    });
    row.appendChild(sel);

    var sort = document.createElement('input');
    sort.type = 'hidden';
    sort.name = 'rows[' + index + '][sort]';
    sort.value = String(index);
    sort.setAttribute('data-sort', '');
    row.appendChild(sort);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'rowgrid__del';
    del.setAttribute('data-del', '');
    del.title = 'Remove row';
    del.textContent = '×';
    row.appendChild(del);

    return row;
  }

  function addRow(grid, values) {
    var idx = nextIndex(grid);
    var row = buildRow(grid, idx, values);
    grid.appendChild(row);
    return row;
  }

  // A pasted analyte value that is not a number ("ND", "<LOQ") gets a matching
  // status guess, so a pasted panel does not need every status set by hand.
  function guessStatus(valueText) {
    var v = (valueText || '').trim().toLowerCase();
    if (v === 'nd' || v === 'n/d' || v === 'not detected') return 'nd';
    if (!v) return 'na';
    return 'na';
  }

  function parsePaste(text) {
    return text.split(/\r?\n/).map(function (line) {
      return line.trim();
    }).filter(Boolean).map(function (line) {
      // Tab first (it survives a copy out of a PDF table), then comma.
      var parts = line.indexOf('\t') !== -1 ? line.split('\t') : line.split(',');
      parts = parts.map(function (p) { return p.trim(); });
      var row = {};
      COLS.forEach(function (c, i) { row[c] = parts[i] || ''; });
      row.status = guessStatus(row.value_text);
      return row;
    }).filter(function (r) { return r.analyte; });
  }

  // ── Wire each panel form ──────────────────────────────────────────────────
  document.querySelectorAll('[data-results-form]').forEach(function (form) {
    var grid = form.querySelector('[data-rowgrid]');
    if (!grid) return;

    form.addEventListener('click', function (e) {
      var t = e.target;

      if (t.closest('[data-add-row]')) {
        var row = addRow(grid);
        var first = row.querySelector('input');
        if (first) first.focus();
        return;
      }

      if (t.closest('[data-del]')) {
        var r = t.closest('[data-row]');
        if (r) r.remove();
        return;
      }

      if (t.closest('[data-toggle-paste]')) {
        var box = form.querySelector('[data-paste]');
        if (box) { box.hidden = !box.hidden; if (!box.hidden) form.querySelector('[data-paste-input]').focus(); }
        return;
      }

      if (t.closest('[data-paste-cancel]')) {
        var box2 = form.querySelector('[data-paste]');
        if (box2) { box2.hidden = true; form.querySelector('[data-paste-input]').value = ''; }
        return;
      }

      if (t.closest('[data-paste-apply]')) {
        var ta = form.querySelector('[data-paste-input]');
        var parsed = parsePaste(ta.value);
        parsed.forEach(function (values) { addRow(grid, values); });
        ta.value = '';
        form.querySelector('[data-paste]').hidden = true;
        return;
      }
    });
  });
})();
