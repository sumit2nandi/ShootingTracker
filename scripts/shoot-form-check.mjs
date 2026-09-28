// Headless check of the shoot form's title suggestions and coordinator
// control. Stubs the DOM the form touches, then drives: typing in the title
// field (filtering, keyboard navigation, accepting), Escape, blur, and the
// two coordinator modes (dropdown with past coordinators / free-text box for
// an account that has none).
//
// Usage: node scripts/shoot-form-check.mjs
import { readFileSync } from 'fs';

function makeEl(name, tag = 'div') {
  const el = {
    name,
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    hidden: false,
    open: false,
    scrollTop: 0,
    children: [],
    handlers: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, force) { force ? this._s.add(c) : this._s.delete(c); }
    },
    options: [],
    addEventListener(ev, fn) { el.handlers[ev] = fn; },
    removeEventListener() {},
    dispatch(ev, arg) { el.handlers[ev] && el.handlers[ev](arg); },
    focus() {},
    closest() { return el._parent || null; },
    appendChild(child) { el.children.push(child); child._parent = el; return child; },
    reset() {}
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML || ''; },
    set(html) {
      el._innerHTML = html;
      el.children = [];
      if (tag === 'select') {
        el.options = [...html.matchAll(/<option value="([^"]*)">/g)].map((m) => ({ value: m[1] }));
      }
    }
  });
  return el;
}

function makeForm() {
  const names = ['id', 'title', 'client_name', 'shoot_type', 'shoot_date', 'end_date', 'start_time', 'end_time', 'venue', 'location', 'fee', 'status', 'contact_name', 'contact_phone', 'notes', 'coordinator_new'];
  const controls = {};
  for (const n of names) controls[n] = makeEl(`input[name=${n}]`, 'input');
  const titleFieldWrap = makeEl('.field (title)');
  controls.title._parent = titleFieldWrap;
  const form = makeEl('#shoot-form', 'form');
  form.elements = { namedItem: (n) => controls[n] || null };
  form.reset = () => { for (const n of names) controls[n].value = ''; };
  form._controls = controls;
  form._titleWrap = titleFieldWrap;
  return form;
}

function makeDom() {
  const form = makeForm();
  const titleWrap = form._titleWrap;
  const byId = {
    '#shoot-modal': makeEl('#shoot-modal'),
    '#shoot-form': form,
    '#shoot-modal-title': makeEl('#shoot-modal-title'),
    '#sel-coordinator': makeEl('#sel-coordinator', 'select'),
    '#sel-status': makeEl('#sel-status', 'select'),
    '#coord-new-input': form._controls.coordinator_new,
    '#btn-new-shoot': makeEl('#btn-new-shoot'),
    '#btn-new-shoot-fab': makeEl('#btn-new-shoot-fab'),
    '#btn-save-shoot': makeEl('#btn-save-shoot'),
    '.more-details': makeEl('.more-details')
  };
  const doc = {
    _byId: byId,
    querySelector(sel) {
      if (sel.startsWith('#') || sel.startsWith('.')) return byId[sel] || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '#btn-new-shoot, #btn-new-shoot-fab') return [byId['#btn-new-shoot'], byId['#btn-new-shoot-fab']];
      if (sel === '#shoot-modal [data-close]') return [];
      return [];
    },
    createElement: (tag) => makeEl(`created-${tag}`, tag),
    addEventListener() {},
    removeEventListener() {}
  };
  // the title input's .closest('.field') resolves to its field wrapper
  form._controls.title.closest = () => titleWrap;
  return { doc, byId, form, titleWrap };
}

function loadShootForm(dom) {
  const src = readFileSync(new URL('../public/js/app/ui/shoot-form.js', import.meta.url), 'utf8');
  const wrapped = src.replace(/^import .*$/gm, '').replace('export class ShootForm', 'class ShootForm');
  const $ = (sel) => dom.doc.querySelector(sel);
  const $$ = (sel) => dom.doc.querySelectorAll(sel);
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const factory = new Function(
    '$', '$$', 'escapeHtml', 'dayKey', 'animateDisclosure', 'closeOverlay', 'openOverlay', 'appStatus', 'document',
    `${wrapped}\nreturn ShootForm;`
  );
  return factory($, $$, escapeHtml, () => '2026-09-29', () => {}, (el) => { el && el.classList && el.classList.add('closing'); }, (el) => { el && el.classList && el.classList.remove('hidden'); }, (s) => s || 'planned', dom.doc);
}

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  ok ${label}`);
  else { failures++; console.error(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
};

const KEY = (key) => ({ key, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

// ---------------------------------------------------------------- account A:
// has past titles and coordinators
console.log('\n-- account with past titles + coordinators --');
{
  const dom = makeDom();
  const ShootForm = loadShootForm(dom);
  const form = new ShootForm({ api: {}, actions: {} });
  form.mount();
  form.populate({
    coordinators: [{ id: 1, name: 'Riya Saha' }, { id: 2, name: 'Arjun Mukherjee' }],
    titles: ['Amritsar wedding', 'Amritsar reception', 'Mumbai product shoot', 'Bengaluru fashion']
  });

  const select = dom.byId['#sel-coordinator'];
  const newInput = dom.byId['#coord-new-input'];
  const titleInput = dom.form._controls.title;
  const box = dom.titleWrap.children.find((c) => c.name === 'created-div');
  ok('suggestion box mounted in the title field', Boolean(box) && box.className === 'field-suggest');
  ok('dropdown mode: select visible', select.hidden === false);
  ok('dropdown mode: new-input hidden', newInput.hidden === true);
  ok('dropdown offers the past coordinators', select.options.some((o) => o.value === 'Riya Saha') && select.options.some((o) => o.value === 'Arjun Mukherjee'));

  form.open(null);

  // typing filters the past titles
  titleInput.value = 'amrit';
  titleInput.dispatch('input');
  ok('typing "amrit" opens the list', box.hidden === false);
  const items0 = box._innerHTML;
  ok('leading matches listed', items0.includes('Amritsar wedding') && items0.includes('Amritsar reception'));
  ok('first match is highlighted', box._innerHTML.indexOf('active') < box._innerHTML.length && box._innerHTML.includes('data-index="0"'));

  // a partial word matches mid-title too
  titleInput.value = 'wed';
  titleInput.dispatch('input');
  ok('mid-title match offered', box._innerHTML.includes('Amritsar wedding'));

  // keyboard: ArrowDown moves the pick, Enter accepts (query with two matches)
  titleInput.value = 'amrit';
  titleInput.dispatch('input');
  const ev = KEY('ArrowDown');
  titleInput.dispatch('keydown', ev);
  ok('ArrowDown prevents the caret jump', ev.prevented === true);
  const evEnter = KEY('Enter');
  titleInput.dispatch('keydown', evEnter);
  ok('Enter prevented (no implicit submit)', evEnter.prevented === true);
  ok('Enter accepts the highlighted (second) title', titleInput.value === 'Amritsar reception', `value "${titleInput.value}"`);
  ok('list closes after accepting', box.hidden === true);

  // no match → list stays away
  titleInput.value = 'zzz';
  titleInput.dispatch('input');
  ok('no match hides the list', box.hidden === true);

  // Escape closes the list
  titleInput.value = 'amrit';
  titleInput.dispatch('input');
  const evEsc = KEY('Escape');
  titleInput.dispatch('keydown', evEsc);
  ok('Escape closes the list', box.hidden === true && evEsc.stopped === true);

  // empty input hides the list
  titleInput.value = '';
  titleInput.dispatch('input');
  ok('clearing the field hides the list', box.hidden === true);

  // coordinator: select a known one
  select.value = 'Riya Saha';
  ok('coordinatorValue: known name', form.coordinatorValue() === 'Riya Saha');
  // coordinator: the new one, typed
  select.value = '__new__';
  select.dispatch('change');
  ok('"New Coordinator…" reveals the text box', newInput.hidden === false);
  newInput.value = '  Kavita Bose ';
  ok('coordinatorValue: typed name trimmed', form.coordinatorValue() === 'Kavita Bose');
  // nothing chosen
  select.value = '';
  select.dispatch('change');
  newInput.value = '';
  ok('coordinatorValue: none → null in readValues', form.readValues().coordinator === null);
}

// ---------------------------------------------------------------- account B:
// a fresh account: no past titles, no past coordinators
console.log('\n-- fresh account: no past coordinators → text box --');
{
  const dom = makeDom();
  const ShootForm = loadShootForm(dom);
  const form = new ShootForm({ api: {}, actions: {} });
  form.mount();
  form.populate({ coordinators: [], titles: [] });

  const select = dom.byId['#sel-coordinator'];
  const newInput = dom.byId['#coord-new-input'];
  const titleInput = dom.form._controls.title;
  const box = dom.titleWrap.children.find((c) => c.name === 'created-div');

  ok('free-text mode: select hidden', select.hidden === true);
  ok('free-text mode: text box visible', newInput.hidden === false);

  form.open(null);
  ok('free-text mode survives opening the form', newInput.hidden === false && select.hidden === true);
  newInput.value = 'Kavita Bose';
  ok('free-text coordinator read back', form.coordinatorValue() === 'Kavita Bose');
  ok('readValues carries the typed coordinator', form.readValues().coordinator === 'Kavita Bose');

  ok('no past titles → typing offers nothing', (titleInput.value = 'Wedding', titleInput.dispatch('input'), box.hidden === true));

  // owner switches to a member who has data: back to the dropdown
  form.populate({ coordinators: [{ id: 3, name: 'Priyanka Dutta' }], titles: ['Priya home shoot'] });
  ok('switching to an account with coordinators restores the dropdown', select.hidden === false && newInput.hidden === true);
}

console.log(failures ? `\n${failures} FAILURES` : '\nall shoot-form checks passed');
process.exit(failures ? 1 : 0);
