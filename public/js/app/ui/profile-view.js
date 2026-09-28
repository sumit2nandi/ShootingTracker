import { $, escapeHtml } from '../core/dom.js';

/**
 * The Profile destination: who is signed in, and what they can do about it.
 *
 * It is a view like Dashboard, Calendar and Shoots — the router shows and
 * hides it — so this class only renders the account and wires its actions.
 *
 * A member's profile shows their own details and nothing else. An owner
 * additionally gets the "viewing" switch — whose data to look at — and the
 * People-with-Access management entry.
 */
export class ProfileView {
  constructor({ api, actions }) {
    this.api = api;
    this.actions = actions;
  }

  mount() {
    $('#btn-access').addEventListener('click', () => this.actions.openAccess());
    $('#btn-signout').addEventListener('click', () => this.signOut());
    $('#viewing-select').addEventListener('change', (event) => this.actions.setViewingAs(event.target.value));
  }

  /** The avatar carries the first letter of the account name (or its email). */
  static initial(user) {
    return String((user && (user.name || user.email)) || '?').trim().charAt(0).toUpperCase() || '?';
  }

  /**
   * Paint the account into both the tab avatar and the profile view.
   *
   * @param {object} user the signed-in account
   * @param {object[]} [users] the allow-list, owner-only (the viewing choices)
   * @param {string|null} [viewingAs] the account the owner is currently viewing
   */
  render(user, users = [], viewingAs = null) {
    const initial = ProfileView.initial(user);
    $('#profile-logo').textContent = initial;
    $('#profile-avatar').textContent = initial;
    $('#profile-name').textContent = (user && user.name) || (user && user.email) || 'Signed in';
    $('#profile-email').textContent = (user && user.email) || '';
    const isOwner = user && user.role === 'owner';
    $('#profile-role').textContent = isOwner ? 'Owner' : 'Member';
    $('#profile-role').classList.toggle('owner', Boolean(isOwner));
    $('#btn-access').hidden = !isOwner; // managing access is an owner's job

    // the viewing switch is an owner's tool; members see their own data only
    $('#viewing-card').hidden = !isOwner;
    if (!isOwner) return;

    const select = $('#viewing-select');
    const me = String((user && user.email) || '').toLowerCase();
    // The first option *is* the owner's own data — their account is not
    // offered as a second "(you)" row, so there is one way to say "mine".
    const options = [`<option value="">My own data (${escapeHtml((user && (user.name || user.email)) || 'me')})</option>`];
    for (const entry of users) {
      if (String(entry.email).toLowerCase() === me) continue;
      const label = `${entry.name || entry.email}${entry.is_active ? '' : ' (inactive)'}`;
      options.push(`<option value="${escapeHtml(entry.email)}">${escapeHtml(label)}</option>`);
    }
    select.innerHTML = options.join('');
    select.value = viewingAs || '';
    // a restored choice that no longer matches an option snaps back to "me"
    if (select.value !== (viewingAs || '')) select.value = '';
  }

  async signOut() {
    try {
      await this.api.signOut();
    } finally {
      window.location.replace('/');
    }
  }
}
