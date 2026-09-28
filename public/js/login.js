'use strict';

(() => {
  const message = document.getElementById('auth-message');
  const button = document.getElementById('google-button');
  const signInBlock = document.getElementById('signin-block');
  const consentBlock = document.getElementById('consent-block');
  const agree = document.getElementById('consent-agree');
  const confirmButton = document.getElementById('consent-confirm');
  const cancelButton = document.getElementById('consent-cancel');

  let busy = false;
  let pendingCredential = null; // held while the consent form is on screen

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `auth-message${kind ? ` ${kind}` : ''}`;
  }

  function setBusy(isBusy) {
    busy = isBusy;
    button.classList.toggle('disabled', isBusy);
  }

  async function post(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const data = (await response.json().catch(() => ({}))) || {};
    if (!response.ok) throw new Error(data.error || 'Sign-in failed. Please try again.');
    return data;
  }

  /** Google's callback: known accounts sign in, new ones get the consent form. */
  async function signIn(response) {
    if (busy || !response.credential) return;
    setBusy(true);
    setMessage('Verifying your account securely…');
    try {
      const result = await post('/api/auth/google', { credential: response.credential });
      if (result.needsConsent) {
        showConsent(result.user, response.credential);
        // The consent form is now on screen and must be interactive — release
        // the busy flag (the Google button itself is hidden with the sign-in
        // block, so it cannot be re-clicked while the form is open).
        setBusy(false);
        return;
      }
      setMessage(`Signed in as ${result.user.email}`, 'success');
      window.location.replace('/');
    } catch (error) {
      setMessage(error.message, 'error');
      setBusy(false);
    }
  }

  /* ---------------- first-time consent ---------------- */

  function showConsent(user, credential) {
    pendingCredential = credential;
    document.getElementById('consent-name').textContent = user.name || '';
    document.getElementById('consent-email').textContent = user.email || '';
    agree.checked = false;
    confirmButton.disabled = true;
    signInBlock.hidden = true;
    consentBlock.hidden = false;
    setMessage('Review the terms, then create your profile.', 'success');
  }

  async function confirmConsent() {
    if (busy || !pendingCredential) return;
    setBusy(true);
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    setMessage('Creating your profile…');
    try {
      const result = await post('/api/auth/consent', { credential: pendingCredential });
      setMessage(`Signed in as ${result.user.email}`, 'success');
      window.location.replace('/');
    } catch (error) {
      setMessage(error.message, 'error');
      setBusy(false);
      confirmButton.disabled = !agree.checked;
      cancelButton.disabled = false;
    }
  }

  function cancelConsent() {
    if (busy) return;
    pendingCredential = null;
    consentBlock.hidden = true;
    signInBlock.hidden = false;
    setMessage('Sign-in cancelled — you can try again.', 'error');
  }

  agree.addEventListener('change', () => {
    confirmButton.disabled = !agree.checked || busy;
  });
  confirmButton.addEventListener('click', confirmConsent);
  cancelButton.addEventListener('click', cancelConsent);

  /* ---------------- boot ---------------- */

  async function start() {
    try {
      const [configResponse, sessionResponse] = await Promise.all([
        fetch('/api/auth/config', { cache: 'no-store' }),
        fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      ]);
      if (sessionResponse.ok) {
        window.location.replace('/');
        return;
      }
      const config = await configResponse.json();
      if (!config.clientId) {
        setMessage('Google sign-in needs GOOGLE_CLIENT_ID configured on the server.', 'error');
        return;
      }

      let tries = 0;
      const render = () => {
        if (window.google && google.accounts && google.accounts.id) {
          google.accounts.id.initialize({ client_id: config.clientId, callback: signIn, auto_select: false });
          google.accounts.id.renderButton(button, {
            type: 'standard', theme: 'outline', size: 'large', text: 'signin_with',
            shape: 'rectangular', logo_alignment: 'left', width: 320
          });
          setMessage('');
          return;
        }
        if (++tries < 40) setTimeout(render, 150);
        else setMessage('Google sign-in could not load. Check your connection and refresh.', 'error');
      };
      render();
    } catch (_error) {
      setMessage('Could not reach ShootingTracker. Please refresh and try again.', 'error');
    }
  }

  start();
})();
