'use strict';

(() => {
  const message = document.getElementById('auth-message');
  const button = document.getElementById('google-button');
  let busy = false;

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `auth-message${kind ? ` ${kind}` : ''}`;
  }

  async function signIn(response) {
    if (busy || !response.credential) return;
    busy = true;
    button.classList.add('disabled');
    setMessage('Verifying your account securely…');
    try {
      const result = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || 'Sign-in failed. Please try again.');
      setMessage(`Signed in as ${data.user.email}`, 'success');
      window.location.replace('/');
    } catch (error) {
      setMessage(error.message, 'error');
      busy = false;
      button.classList.remove('disabled');
    }
  }

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
