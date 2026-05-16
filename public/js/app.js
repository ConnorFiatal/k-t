// Dark mode toggle — works for both sidebar button and mobile header button
document.addEventListener('click', function (e) {
  if (!e.target.closest('.btn-dark-toggle')) return;
  var isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// Mobile sidebar drawer
(function () {
  var toggle = document.getElementById('sidebarToggle');
  var backdrop = document.getElementById('sidebarBackdrop');
  if (!toggle) return;

  function openSidebar() {
    document.body.classList.add('sidebar-open');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function () {
    document.body.classList.contains('sidebar-open') ? closeSidebar() : openSidebar();
  });

  if (backdrop) backdrop.addEventListener('click', closeSidebar);

  // Close when a nav link is tapped on mobile
  var sidebar = document.getElementById('appSidebar');
  if (sidebar) {
    sidebar.addEventListener('click', function (e) {
      if (e.target.closest('.nav-links a') && window.innerWidth <= 768) closeSidebar();
    });
  }

  // Swipe-to-open from left edge, swipe-left to close
  var touchStartX = 0, touchStartY = 0;
  document.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < Math.abs(dy) * 0.8 || Math.abs(dx) < 40) return;
    if (dx > 0 && touchStartX < 24) openSidebar();
    else if (dx < -40) closeSidebar();
  }, { passive: true });
}());

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
