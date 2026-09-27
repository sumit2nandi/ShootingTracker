import { $, $$ } from '../core/dom.js';

/** The bottom-bar profile sheet: identity, access shortcut, sign out. */
export class ProfileView {
  constructor({ api, actions }) {
    this.api = api;
    this.actions = actions;
    this.modal = $('#profile-modal');
    this.tab = $('#tab-profile');
  }

  mount() {
    this.tab.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.modal.addEventListener('click', (event) => {
      if (event.target.id === 'profile-modal') this.close();
    });
    $$('#profile-modal [data-close]').forEach((button) => button.addEventListener('click', () => this.close()));
    $('#btn-access').addEventListener('click', () => {
      this.close();
      this.actions.openAccess();
    });
    $('#btn-signout').addEventListener('click', () => this.signOut());
  }

  get isOpen() {
    return !this.modal.classList.contains('hidden');
  }

  open() {
    this.modal.classList.remove('hidden');
    this.tab.classList.add('is-open');
    this.tab.setAttribute('aria-expanded', 'true');
    document.body.classList.add('profile-open');
  }

  close() {
    this.modal.classList.add('hidden');
    this.tab.classList.remove('is-open');
    this.tab.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('profile-open');
  }

  /** The avatar carries the first letter of the account name (or its email). */
  static initial(user) {
    return String((user && (user.name || user.email)) || '?').trim().charAt(0).toUpperCase() || '?';
  }

  render(user) {
    const initial = ProfileView.initial(user);
    $('#profile-logo').textContent = initial;
    $('#profile-avatar').textContent = initial;
    $('#profile-name').textContent = (user && user.name) || (user && user.email) || 'Signed in';
    $('#profile-email').textContent = (user && user.email) || '';
    const isOwner = user && user.role === 'owner';
    $('#profile-role').textContent = isOwner ? 'Owner' : 'Member';
    $('#profile-role').classList.toggle('owner', Boolean(isOwner));
    $('#btn-access').hidden = !isOwner;
  }

  async signOut() {
    document.body.classList.remove('profile-open');
    try {
      await this.api.signOut();
    } finally {
      window.location.replace('/');
    }
  }
}
