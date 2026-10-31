(() => {
  const trigger = document.querySelector('#profile-menu-trigger');
  const menu = document.querySelector('#profile-menu');
  const wrapper = document.querySelector('.profile-menu-wrap');
  const themeToggle = document.querySelector('[data-theme-toggle]');
  const dialog = document.querySelector('#login-dialog');
  const loginMenuItem = menu?.querySelector('[data-profile-login]');
  const logoutMenuItem = menu?.querySelector('[data-profile-logout]');
  const logoutStatus = menu?.querySelector('#logout-status');
  if (!trigger || !menu || !wrapper) return;

  const menuItems = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')];
  const enabledItems = () => menuItems.filter(item => !item.disabled && item.getAttribute('aria-disabled') !== 'true');
  let closeTimer;

  function setOpen(open, returnFocus = false) {
    window.clearTimeout(closeTimer);
    wrapper.classList.toggle('is-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? 'Close profile menu' : 'Open profile menu');
    menuItems.forEach(item => item.tabIndex = open && !item.disabled ? 0 : -1);
    if (open) enabledItems()[0]?.focus();
    else if (returnFocus) trigger.focus();
  }

  trigger.addEventListener('click', () => setOpen(trigger.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      setOpen(false, true);
    }
    if (trigger.getAttribute('aria-expanded') !== 'true' || !menu.contains(document.activeElement)) return;
    const items = enabledItems();
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items.at(-1))?.focus();
    }
  });
  menu.addEventListener('focusout', () => {
    closeTimer = window.setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) setOpen(false);
    }, 0);
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('[data-profile-login]')) {
      setOpen(false);
      startSignIn();
    } else if (event.target.closest('[data-profile-logout]')) {
      setOpen(false);
      startSignOut();
    } else if (event.target.closest('a')) setOpen(false);
  });

  async function loadAuth() {
    return import('./dist/cognito-auth.js');
  }

  async function startSignIn() {
    try {
      const auth = await loadAuth();
      await auth.signInRedirect();
    } catch {
      window.alert('Sign-in could not start. Check that the Agri Smart server is running and that Cognito is configured for this local address.');
    }
  }

  async function startSignOut() {
    try {
      const auth = await loadAuth();
      await auth.signOutRedirect();
    } catch {
      window.alert('Sign-out could not start. Please try again after refreshing Agri Smart.');
    }
  }

  document.querySelectorAll('[data-login-trigger]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    startSignIn();
  }));

  dialog?.querySelectorAll('[data-login-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog?.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  function applyTheme(theme, persist = false) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    themeToggle?.setAttribute('aria-checked', String(dark));
    if (persist) {
      try { localStorage.setItem('agriSmartTheme', dark ? 'dark' : 'light'); } catch { /* Storage can be disabled. */ }
    }
  }

  let savedTheme = 'light';
  try { savedTheme = localStorage.getItem('agriSmartTheme') === 'dark' ? 'dark' : 'light'; } catch { /* Use light theme if storage is unavailable. */ }
  applyTheme(savedTheme);
  themeToggle?.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });

  async function syncAuthenticationState() {
    try {
      const auth = await loadAuth();
      const query = new URLSearchParams(window.location.search);
      if (query.has('code') || query.has('error')) {
        try {
          await auth.completeSignIn();
        } catch {
          window.alert('Sign-in could not be completed. Please try signing in again.');
        } finally {
          for (const name of ['code', 'state', 'error', 'error_description', 'session_state', 'iss']) query.delete(name);
          const suffix = query.toString();
          window.history.replaceState({}, document.title, `${window.location.pathname}${suffix ? `?${suffix}` : ''}${window.location.hash}`);
        }
      }
      const user = await auth.getCurrentUser();
      const signedIn = Boolean(user && !user.expired);
      loginMenuItem?.toggleAttribute('disabled', signedIn);
      if (loginMenuItem && signedIn) {
        const name = user.profile?.name || user.profile?.email || user.profile?.['cognito:username'] || 'Signed in';
        loginMenuItem.textContent = `Signed in as ${name}`;
      }
      if (logoutMenuItem) logoutMenuItem.disabled = !signedIn;
      if (logoutStatus) logoutStatus.textContent = signedIn ? 'End this session' : 'Not signed in';
    } catch {
      // A missing build or unavailable browser storage must not break the rest of the site.
    }
  }

  syncAuthenticationState();
})();
