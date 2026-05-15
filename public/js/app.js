// Confirm dialogs on buttons: <button data-confirm="Are you sure?">
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-confirm]');
  if (btn && !confirm(btn.dataset.confirm)) e.preventDefault();
});

// Confirm dialogs on form submit: <form data-confirm="Are you sure?">
document.addEventListener('submit', function (e) {
  if (e.target.dataset.confirm && !confirm(e.target.dataset.confirm)) e.preventDefault();
});

// Print buttons: <button class="print-btn">
document.addEventListener('click', function (e) {
  if (e.target.closest('.print-btn')) window.print();
});

// Sync secret toggle: span[data-secret] + .toggle-secret button
// (async fetch variant in system-accounts/detail.ejs uses data-id instead and is handled separately)
document.addEventListener('click', function (e) {
  const btn = e.target.closest('.toggle-secret');
  if (!btn) return;
  const span = btn.previousElementSibling;
  if (!span || !('secret' in span.dataset)) return;
  if (btn.textContent.trim() === 'Show') {
    if (!span.dataset.mask) span.dataset.mask = span.textContent;
    span.textContent = span.dataset.secret;
    btn.textContent = 'Hide';
  } else {
    span.textContent = span.dataset.mask || '••••••••';
    btn.textContent = 'Show';
  }
});
