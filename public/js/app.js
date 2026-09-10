'use strict';

// Site-wide behaviour. Everything here is an enhancement: every form on this
// site submits and every page reads correctly with this file blocked.

(function () {
  // ── Toasts ────────────────────────────────────────────────────────────────
  // Flash messages fade themselves out. Errors stay: a message explaining why
  // something did not work should not vanish while it is being read.
  document.querySelectorAll('.toast').forEach(function (el) {
    if (el.classList.contains('toast--error')) return;
    setTimeout(function () {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 320);
    }, 5000);
  });

  // ── Submit state ──────────────────────────────────────────────────────────
  // A spinner on the button and a disabled resubmit, so a slow connection does
  // not produce three identical enquiries.
  //
  // The disable is deferred by a tick on purpose: setting `disabled` on the
  // submit button synchronously during the submit event stops some browsers
  // from including it in the payload, and on a form whose action depends on
  // which button was pressed that silently changes what the server receives.
  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function () {
      if (!form.checkValidity()) return;
      var btn = form.querySelector('button[type=submit], button:not([type])');
      if (!btn || btn.classList.contains('is-busy')) return;
      setTimeout(function () {
        btn.classList.add('is-busy');
        btn.setAttribute('aria-disabled', 'true');
      }, 0);
    });
  });
})();
