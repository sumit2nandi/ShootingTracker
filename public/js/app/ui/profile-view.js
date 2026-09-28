import { $ } from '../core/dom.js';

/**
 * The Profile destination: who is signed in, and what they can do about it.
 *
 * It is a view like Dashboard, Calendar and Shoots — the router shows and
 * hides it — so this class only renders the account and wires its two actions.
 */
export class ProfileView {
  constructor({ api, actions }) {
    this.api = api;
    this.actions = actions;
  }

  mount() {
    $('#btn-access').addEventListener('click', () => this.actions.openAccess());
    $('#btn-signout').addEventListener('click', () => this.signOut());
  }

  /** The avatar carries the first letter of the account name (or its email). */
  static initial(user) {
    return String((user && (user.name || user.email)) || '?').trim().charAt(0).toUpperCase() || '?';
  }

  /** Paint the account into both the tab avatar and the profile view. */
  render(user) {
    const initial = ProfileView.initial(user);
    $('#profile-logo').textContent = initial;
    $('#profile-avatar').textContent = initial;
    $('#profile-name').textContent = (user && user.name) || (user && user.email) || 'Signed in';
    $('#profile-email').textContent = (user && user.email) || '';
    const isOwner = user && user.role === 'owner';
    $('#profile-role').textContent = isOwner ? 'Owner' : 'Member';
    $('#profile-role').classList.toggle('owner', Boolean(isOwner));
    $('#btn-access').hidden = !isOwner; // managing access is an owner's job
  }

  async signOut() {
    try {
      await this.api.signOut();
    } finally {
      window.location.replace('/');
    }
  }
}
