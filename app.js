import {
  groups, parseFields, updateField, upgradeDocument, parseSections, parseContacts, parseEntries,
  entryTypes, contactTypes, removeSection, removeContact, removeEntry, addSection, addContact, addEntry, moveSection, EditHistory,
} from './cv-model.js';

const $ = id => document.getElementById(id);
const storageKey = 'folio.cv.draft.v1';
const titleStorageKey = 'folio.cv.title.v1';
const titleInput = $('cv-title');
const editor = $('source-editor');
let source = '';
let template = '';
let revision = 0;
let compiledRevision = -1;
let pdfUrl;
let pdfBlob;
let debounce;
let readyToCompile = false;
let currentCompile;
let mode = new URLSearchParams(location.search).get('mode') === 'latex' ? 'latex' : 'writing';
let openGroups = new Set(['contact', 'objective']);
const editHistory = new EditHistory();
let beforeInputFocus;
let sectionDrag;
let dragScrollFrame;

// Chromium's PDF viewer needs a useful internal viewport even on narrow phones.
new ResizeObserver(([entry]) => {
  const width = entry.contentRect.width;
  const scale = Math.min(1, width / 600);
  const stage = $('preview-stage');
  stage.style.setProperty('--pdf-width', scale < 1 ? '600px' : '100%');
  stage.style.setProperty('--pdf-height', `${entry.contentRect.height / scale}px`);
  stage.style.setProperty('--pdf-scale', String(scale));
}).observe($('preview-stage'));

function status(text, state = '') {
  $('render-status').textContent = text;
  $('render-status').dataset.state = state;
}

function saveDraft() {
  try {
    localStorage.setItem(storageKey, source);
    localStorage.setItem(titleStorageKey, titleInput.value);
    $('save-status').textContent = 'Draft saved in this browser';
  } catch { $('save-status').textContent = 'Browser storage unavailable. Export .tex to save.'; }
}

function updateDocumentTitle() {
  const title = titleInput.value.trim() || 'Untitled CV';
  document.title = `${title} | Folio`;
  titleInput.style.setProperty('--title-width', `${Math.max(10, Math.min(42, Array.from(title).length + 1))}ch`);
}

function documentFilename(extension) {
  let title = titleInput.value.trim().replace(/\.(pdf|tex)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/[. ]+$/, '').trim() || 'Untitled CV';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) title = `_${title}`;
  return `${title}.${extension}`;
}

titleInput.addEventListener('input', () => { updateDocumentTitle(); saveDraft(); });
titleInput.addEventListener('blur', () => {
  if (!titleInput.value.trim()) { titleInput.value = 'Untitled CV'; updateDocumentTitle(); saveDraft(); }
});
titleInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); titleInput.blur(); } });

function updateLines() {
  const count = source.split('\n').length;
  $('line-numbers').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
  $('editor-count').textContent = mode === 'latex' ? `${count} lines` : 'Your document, your words.';
}

function focusedInput() {
  const element = document.activeElement;
  if (!element?.matches('#source-editor, #writing-fields input, #writing-fields textarea')) return null;
  return { id: element.id, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection };
}

function changed(next, { record = true, group = null } = {}) {
  if (source === next) { beforeInputFocus = null; return; }
  if (record) editHistory.record({ source, focus: beforeInputFocus || focusedInput() }, { source: next, focus: focusedInput() }, group);
  beforeInputFocus = null;
  $('undo-structure').hidden = !editHistory.canUndo;
  source = next;
  revision++;
  editor.value = source;
  updateLines();
  saveDraft();
  clearTimeout(debounce);
  readyToCompile = false;
  status('Waiting for your edits…');
  debounce = setTimeout(() => { readyToCompile = true; compile(); }, 2000);
}

function changeStructure(description, operation, focusField) {
  try {
    const next = operation();
    if (source === next) return;
    changed(next);
    $('save-status').textContent = `${description}. Undo is available below.`;
    renderFields();
    if (focusField) document.getElementById(`field-${focusField}`)?.focus();
    else $('undo-structure').focus();
    return true;
  } catch (error) { showError(error.message); return false; }
}

function actionButton(text, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function moveEditorSection(id, target, position) {
  const title = parseSections(source).find(section => section.id === id)?.title || 'Section';
  const moved = changeStructure(`${title} moved`, () => moveSection(source, id, target, position));
  if (moved) {
    const handle = document.getElementById(`move-section-${id}`);
    handle?.focus({ preventScroll: true });
    handle?.scrollIntoView({ block: 'nearest' });
  }
}

function clearDropIndicators() {
  $('writing-fields').querySelectorAll('.section-drop-before, .section-drop-after').forEach(element => element.classList.remove('section-drop-before', 'section-drop-after'));
}

function finishSectionDrag() {
  const drag = sectionDrag;
  sectionDrag = undefined;
  cancelAnimationFrame(dragScrollFrame);
  $('writing-fields').classList.remove('is-reordering');
  $('writing-fields').querySelector('.is-dragging')?.classList.remove('is-dragging');
  clearDropIndicators();
  drag?.ghost?.remove();
  if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
}

function updateSectionDrop(drag) {
  clearDropIndicators();
  drag.target = undefined;
  const panel = $('writing-panel').getBoundingClientRect();
  if (drag.x < panel.left || drag.x > panel.right || drag.y < panel.top || drag.y > panel.bottom) return;
  const rows = [...$('writing-fields').querySelectorAll('[data-section]')]
    .filter(element => drag.ids.includes(element.dataset.section));
  const own = rows.find(element => element.dataset.section === drag.id)?.querySelector('summary').getBoundingClientRect();
  if (own && drag.y >= own.top && drag.y <= own.bottom) return;
  const candidates = rows.filter(element => element.dataset.section !== drag.id);
  let destination;
  let position = 'before';
  for (const row of candidates) {
    const rect = row.querySelector('summary').getBoundingClientRect();
    if (drag.y <= rect.bottom) {
      destination = row;
      position = drag.y < (rect.top + rect.bottom) / 2 ? 'before' : 'after';
      break;
    }
  }
  if (!destination && candidates.length) { destination = candidates.at(-1); position = 'after'; }
  if (destination) {
    drag.target = { id: destination.dataset.section, position };
    destination.querySelector('summary').classList.add(`section-drop-${position}`);
  }
}

function scrollSectionDrag() {
  const drag = sectionDrag;
  if (!drag?.active) return;
  const panel = $('writing-panel');
  const rect = panel.getBoundingClientRect();
  if (drag.x >= rect.left && drag.x <= rect.right && drag.y >= rect.top && drag.y <= rect.bottom) {
    const edge = 44;
    const speed = drag.y < rect.top + edge ? -14 * (rect.top + edge - drag.y) / edge
      : drag.y > rect.bottom - edge ? 14 * (drag.y - rect.bottom + edge) / edge : 0;
    if (speed) { panel.scrollTop += speed; updateSectionDrop(drag); }
  }
  dragScrollFrame = requestAnimationFrame(scrollSectionDrag);
}

function sectionMoveHandle(id, title) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.id = `move-section-${id}`;
  handle.className = 'section-drag-handle';
  handle.title = 'Drag to reorder. Use Arrow Up or Arrow Down with the keyboard.';
  handle.setAttribute('aria-label', `Move ${title}`);
  handle.setAttribute('aria-describedby', 'section-reorder-help');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 20 20');
  icon.setAttribute('aria-hidden', 'true');
  for (const [x, y] of [[7, 5], [13, 5], [7, 10], [13, 10], [7, 15], [13, 15]]) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', '0.8');
    icon.append(dot);
  }
  handle.append(icon);
  handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
  handle.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', ' ', 'Enter'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === ' ' || event.key === 'Enter') {
      $('save-status').textContent = 'Use Arrow Up or Arrow Down to move this section.';
      return;
    }
    const sections = parseSections(source);
    const index = sections.findIndex(section => section.id === id);
    const target = sections[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (target) moveEditorSection(id, target.id, event.key === 'ArrowUp' ? 'before' : 'after');
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || sectionDrag) return;
    event.preventDefault();
    event.stopPropagation();
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    sectionDrag = { id, handle, pointerId: event.pointerId, version: revision, active: false,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      ids: parseSections(source).map(section => section.id) };
  });
  handle.addEventListener('pointermove', event => {
    const drag = sectionDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.version !== revision) { finishSectionDrag(); return; }
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
      drag.active = true;
      $('writing-fields').classList.add('is-reordering');
      handle.closest('.field-section').classList.add('is-dragging');
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'section-drag-label';
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.textContent = handle.closest('summary').querySelector('.section-name').textContent;
      document.body.append(drag.ghost);
      dragScrollFrame = requestAnimationFrame(scrollSectionDrag);
    }
    event.preventDefault();
    const x = Math.max(8, Math.min(drag.x + 14, innerWidth - drag.ghost.offsetWidth - 8));
    const y = Math.max(8, Math.min(drag.y + 14, innerHeight - drag.ghost.offsetHeight - 8));
    drag.ghost.style.transform = `translate(${x}px, ${y}px)`;
    updateSectionDrop(drag);
  });
  handle.addEventListener('pointerup', event => {
    const drag = sectionDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const destination = drag.active && drag.version === revision && drag.target;
    finishSectionDrag();
    if (destination) moveEditorSection(id, destination.id, destination.position);
  });
  handle.addEventListener('pointercancel', finishSectionDrag);
  handle.addEventListener('lostpointercapture', () => { if (sectionDrag?.handle === handle) finishSectionDrag(); });
  return handle;
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && sectionDrag) { event.preventDefault(); finishSectionDrag(); $('save-status').textContent = 'Reordering cancelled.'; }
});
window.addEventListener('blur', finishSectionDrag);

function appendField(grid, field, sectionElement, titleField, remove) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  if (['long', 'bullets', 'url'].includes(field.type) || ['cvName', 'cvEmail', 'cvLocation'].includes(field.name) || field.group !== 'contact') wrapper.classList.add('field-wide');
  const labelRow = document.createElement('div');
  labelRow.className = 'field-label-row';
  const label = document.createElement('label');
  label.htmlFor = `field-${field.name}`;
  label.textContent = field.label.replace(/^(?:First (?:role|project)|Second (?:role|project)|Qualification \d+):\s*/i, '');
  if (field.group === 'skills' && !['Skill heading', 'Skill name'].includes(field.label)) label.textContent = 'Skills or tools';
  labelRow.append(label);
  if (remove) labelRow.append(actionButton('Remove', remove.label, remove.action));
  const input = document.createElement(['long', 'bullets'].includes(field.type) ? 'textarea' : 'input');
  input.id = label.htmlFor;
  input.name = field.name;
  input.value = field.value;
  input.dataset.kind = field.type;
  input.disabled = !field.editable;
  if (input.tagName === 'INPUT') input.type = field.type === 'url' ? 'url' : field.name === 'cvEmail' ? 'email' : field.name === 'cvPhone' ? 'tel' : 'text';
  const autocomplete = { cvName: 'name', cvEmail: 'email', cvPhone: 'tel', cvLocation: 'address-level2' };
  input.autocomplete = autocomplete[field.name] || 'off';
  input.spellcheck = field.type !== 'url';
  input.addEventListener('input', () => {
    try {
      changed(updateField(source, field.name, input.value), { group: field.name });
      if (field.name === titleField) {
        sectionElement.querySelector('.section-name').textContent = input.value || 'Untitled section';
        sectionElement.querySelector('.section-drag-handle')?.setAttribute('aria-label', `Move ${input.value || 'Untitled section'}`);
      }
      if (field.group === 'skills' && ['Skill heading', 'Skill name'].includes(field.label)) {
        const heading = input.closest('.entry-editor')?.querySelector('h3');
        if (heading) heading.textContent = input.value || 'Skill';
        input.closest('.entry-editor')?.querySelector('.entry-heading button')?.setAttribute('aria-label', `Remove ${input.value || 'Skill'}`);
      }
    } catch (error) { showError(error.message, 'Switch to LaTeX mode to edit this field.'); }
  });
  wrapper.append(labelRow, input);
  if (!field.editable) {
    const hint = document.createElement('small');
    hint.className = 'field-hint';
    hint.textContent = 'Custom formatting. Edit this field in LaTeX mode.';
    wrapper.append(hint);
  }
  grid.append(wrapper);
}

function renderContactPicker(section, contacts) {
  if (!source.includes('% @contact-row-end links')) return;
  const form = document.createElement('form');
  form.className = 'inline-add-form';
  const label = document.createElement('label');
  label.htmlFor = 'add-contact-type';
  label.textContent = 'Add a contact detail';
  const controls = document.createElement('div');
  const select = document.createElement('select');
  select.id = label.htmlFor;
  select.name = 'contact-type';
  select.append(new Option('Other link', 'custom'));
  for (const [id, title] of contactTypes) if (!contacts.some(contact => contact.id === id)) select.append(new Option(title, id));
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'button button-quiet';
  button.textContent = 'Add';
  button.setAttribute('aria-label', 'Add contact detail');
  form.addEventListener('submit', event => {
    event.preventDefault();
    openGroups.add('contact');
    changeStructure('Contact detail added', () => {
      const next = addContact(source, template, select.value);
      const created = parseContacts(next).find(contact => !contacts.some(existing => existing.id === contact.id));
      // The new fields are focused after the refreshed writing view is built.
      queueMicrotask(() => document.getElementById(`field-${created?.fields[0]}`)?.focus());
      return next;
    });
  });
  controls.append(select, button);
  form.append(label, controls);
  section.append(form);
}

function updateSectionPicker(sections) {
  $('add-section-controls').hidden = !source.includes('% @structure v2');
  $('show-add-section').disabled = !source.includes('% @structure v2');
  const picker = $('add-section-type');
  const selected = picker.value;
  picker.replaceChildren(new Option('Custom section', 'custom'));
  for (const [id, label] of groups.slice(1)) if (!sections.some(section => section.id === id)) picker.append(new Option(label, id));
  picker.value = [...picker.options].some(option => option.value === selected) ? selected : 'custom';
  $('custom-section-options').hidden = picker.value !== 'custom';
  $('new-section-title').required = picker.value === 'custom';
}

function renderFields() {
  if (sectionDrag) finishSectionDrag();
  const container = $('writing-fields');
  container.replaceChildren();
  let fields, sections, contacts, entriesBySection;
  try {
    fields = parseFields(source);
    sections = parseSections(source);
    contacts = parseContacts(source);
    entriesBySection = new Map(sections.map(section => [section.id, parseEntries(source, section.id)]));
    updateSectionPicker(sections);
  }
  catch (error) {
    const notice = document.createElement('p');
    notice.className = 'writing-notice';
    notice.textContent = error.message;
    container.append(notice);
    $('add-section-controls').hidden = true;
    $('show-add-section').disabled = true;
    return;
  }
  if (!fields.length) {
    const notice = document.createElement('p');
    notice.className = 'writing-notice';
    notice.textContent = 'This document has no linked writing fields. Use LaTeX mode to edit it, or reset to the template to start with writing fields.';
    container.append(notice);
    return;
  }
  const managedContact = source.includes('% @contact-row-end links');
  const contactNames = new Set(contacts.flatMap(contact => contact.fields));
  const writingSections = [{ id: 'contact', title: 'Personal details' }, ...sections];
  // Imported annotated files can still expose writing fields without Folio sections.
  if (!source.includes('% @structure v2')) for (const [id, title] of groups.slice(1)) if (fields.some(field => field.group === id)) writingSections.push({ id, title });
  writingSections.forEach((sectionData, index) => {
    const group = sectionData.id;
    const title = sectionData.title;
    const body = sectionData.contentStart !== undefined ? source.slice(sectionData.contentStart, sectionData.contentEnd) : '';
    const members = fields.filter(field => field.group === group && (group === 'contact'
      ? !managedContact || field.name === 'cvName' || contactNames.has(field.name)
      : !body || new RegExp(`\\\\${field.name}(?![A-Za-z])`).test(body)));
    if (group === 'contact' && !members.length) return;
    const section = document.createElement('details');
    section.className = 'field-section';
    section.dataset.section = group;
    section.open = openGroups.has(group);
    section.addEventListener('toggle', () => {
      if (section.open) openGroups.add(group); else openGroups.delete(group);
    });
    const summary = document.createElement('summary');
    if (sectionData.contentStart !== undefined) summary.append(sectionMoveHandle(group, title));
    const number = document.createElement('span');
    number.className = 'section-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'section-name';
    name.textContent = title;
    summary.append(number, name);
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('aria-hidden', 'true');
    chevron.classList.add('section-chevron');
    const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chevronPath.setAttribute('d', 'm6 9 6 6 6-6');
    chevron.append(chevronPath);
    summary.append(chevron);
    section.append(summary);
    const entries = entriesBySection.get(group) || [];
    const entryNames = new Set(entries.flatMap(entry => entry.fields));
    const standalone = members.filter(field => !entryNames.has(field.name));
    if (standalone.length) {
      const grid = document.createElement('div');
      grid.className = 'section-fields';
      for (const field of standalone) {
        const contact = contacts.find(item => item.fields.at(-1) === field.name);
        const remove = contact ? { label: `Remove ${contact.label}`, action: () => changeStructure(`${contact.label} removed`, () => removeContact(source, contact.id)) } : undefined;
        appendField(grid, field, section, sectionData.titleField, remove);
      }
      section.append(grid);
    }
    entries.forEach((entry, entryIndex) => {
      const entryElement = document.createElement('div');
      entryElement.className = 'entry-editor';
      const entryFields = entry.fields.map(name => members.find(field => field.name === name)).filter(Boolean);
      const skillHeading = group === 'skills' ? entryFields.find(field => ['Skill heading', 'Skill name'].includes(field.label)) : undefined;
      const entryLabel = skillHeading?.value || (entryFields.length === 1 ? entry.label : `${entry.label} ${entryIndex + 1}`);
      const remove = { label: `Remove ${entryLabel}`, action: () => changeStructure(`${entryElement.querySelector('h3')?.textContent || entryLabel} removed`, () => removeEntry(source, entry.id)) };
      if (entryFields.length > 1) {
        const heading = document.createElement('div');
        heading.className = 'entry-heading';
        const headingText = document.createElement('h3');
        headingText.textContent = entryLabel;
        heading.append(headingText, actionButton('Remove', remove.label, remove.action));
        entryElement.append(heading);
      }
      const grid = document.createElement('div');
      grid.className = 'section-fields';
      for (const field of entryFields) appendField(grid, field, section, sectionData.titleField, entryFields.length === 1 ? remove : undefined);
      entryElement.append(grid);
      section.append(entryElement);
    });
    if (group === 'contact') renderContactPicker(section, contacts);
    else if (sectionData.contentStart !== undefined) {
      const actions = document.createElement('div');
      actions.className = 'section-actions';
      if (entryTypes[group]) actions.append(actionButton(entryTypes[group][1], entryTypes[group][1], () => {
        openGroups.add(group);
        changeStructure(`${entryTypes[group][0]} added`, () => {
          const next = addEntry(source, template, group);
          const created = parseEntries(next, group).find(item => !entries.some(existing => existing.id === item.id));
          queueMicrotask(() => document.getElementById(`field-${created?.fields[0]}`)?.focus());
          return next;
        });
      }));
      actions.append(actionButton('Remove section', `Remove ${title} section`, () => changeStructure(`${title} section removed`, () => removeSection(source, group))));
      section.insertBefore(actions, summary.nextSibling);
    }
    container.append(section);
  });
}

function setMode(next, focus = false) {
  editHistory.breakGroup();
  mode = next;
  const writing = next === 'writing';
  $('writing-panel').hidden = !writing;
  $('code-panel').hidden = writing;
  for (const [id, active] of [['writing-tab', writing], ['code-tab', !writing]]) {
    $(id).setAttribute('aria-selected', String(active));
    $(id).tabIndex = active ? 0 : -1;
    if (active && focus) $(id).focus();
  }
  if (writing) renderFields();
  else editor.value = source;
  updateLines();
  const url = new URL(location.href);
  url.searchParams.set('mode', next);
  history.replaceState(null, '', url);
}

function showError(message, detail = '') {
  $('compile-error').hidden = false;
  $('error-message').textContent = message;
  $('error-details').textContent = detail;
  status(pdfBlob ? 'Preview is out of date' : 'Preview unavailable', 'error');
  $('preview-loading-message').textContent = 'Check the compiler details below, then try again.';
}

function compile() {
  if (currentCompile) return currentCompile;
  clearTimeout(debounce);
  readyToCompile = false;
  const snapshot = source;
  const requestedRevision = revision;
  status('Typesetting…');
  $('preview-stage').setAttribute('aria-busy', 'true');
  $('compile-error').hidden = true;
  $('refresh-preview').disabled = true;
  currentCompile = (async () => {
    try {
      const response = await fetch('/api/compile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: snapshot }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || error.message || 'Please try compiling again.');
      }
      const blob = await response.blob();
      if (requestedRevision !== revision) return false;
      pdfBlob = blob;
      compiledRevision = requestedRevision;
      const previousUrl = pdfUrl;
      pdfUrl = URL.createObjectURL(blob);
      const preview = $('pdf-preview');
      preview.src = `${pdfUrl}#toolbar=0&navpanes=0&view=FitH`;
      preview.hidden = false;
      if (previousUrl) setTimeout(() => URL.revokeObjectURL(previousUrl), 5000);
      $('preview-placeholder').hidden = true;
      $('open-pdf').href = pdfUrl;
      $('open-pdf').hidden = false;
      const pages = Number(response.headers.get('X-PDF-Pages'));
      $('page-info').textContent = `A4 / 210 × 297 mm${pages ? ` / ${pages} ${pages === 1 ? 'page' : 'pages'}` : ''}`;
      status('Up to date', 'success');
      return true;
    } catch (error) {
      if (requestedRevision === revision) showError(pdfBlob ? 'The last successful PDF is still shown. Fix the source and try again.' : 'Your document could not be compiled. Check the details and try again.', error.message);
      return false;
    } finally {
      currentCompile = undefined;
      $('preview-stage').setAttribute('aria-busy', 'false');
      $('refresh-preview').disabled = false;
      if (readyToCompile) compile();
    }
  })();
  return currentCompile;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

$('writing-tab').addEventListener('click', () => setMode('writing'));
$('code-tab').addEventListener('click', () => setMode('latex'));
$('show-add-section').addEventListener('click', () => {
  setMode('writing');
  $('add-section-controls').open = true;
  $('add-section-controls').scrollIntoView({ block: 'nearest' });
  $('add-section-type').focus();
});
$('add-section-type').addEventListener('change', () => {
  const custom = $('add-section-type').value === 'custom';
  $('custom-section-options').hidden = !custom;
  $('new-section-title').required = custom;
});
$('add-section-form').addEventListener('submit', event => {
  event.preventDefault();
  const type = $('add-section-type').value;
  const existing = parseSections(source);
  const added = changeStructure('Section added', () => {
    const next = addSection(source, template, type, $('new-section-title').value, $('new-section-format').value);
    const section = parseSections(next).find(item => !existing.some(previous => previous.id === item.id));
    openGroups.add(section.id);
    const field = parseFields(next).find(item => item.group === section.id);
    queueMicrotask(() => document.getElementById(`field-${field?.name}`)?.focus());
    return next;
  });
  if (added) $('new-section-title').value = '';
});
function restoreHistory(redo = false) {
  const state = redo ? editHistory.redo() : editHistory.undo();
  if (!state) return;
  beforeInputFocus = null;
  changed(state.source, { record: false });
  if (mode === 'writing') renderFields();
  const input = state.focus && document.getElementById(state.focus.id);
  if (input && !input.closest('[hidden]')) {
    const section = input.closest('.field-section');
    if (section) { section.open = true; openGroups.add(section.dataset.section); }
    input.focus();
    if (state.focus.start !== null) input.setSelectionRange(state.focus.start, state.focus.end, state.focus.direction || 'none');
  } else if (mode === 'latex') editor.focus();
  else if (editHistory.canUndo) $('undo-structure').focus();
  else document.querySelector('.field-section summary')?.focus();
  $('save-status').textContent = redo ? 'Change redone.' : 'Change undone.';
}

$('undo-structure').addEventListener('click', () => restoreHistory());
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  // Unsaved fields in the add-section form keep their native text undo.
  if (event.target.matches('input, textarea, [contenteditable="true"]') && !event.target.matches('#source-editor, #writing-fields input, #writing-fields textarea')) return;
  event.preventDefault();
  restoreHistory(key === 'y' || event.shiftKey);
});
document.addEventListener('beforeinput', event => {
  if (!event.target.matches('#source-editor, #writing-fields input, #writing-fields textarea')) return;
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault();
    restoreHistory(event.inputType === 'historyRedo');
  } else beforeInputFocus = focusedInput();
});
document.addEventListener('focusout', event => {
  if (event.target.matches('#source-editor, #writing-fields input, #writing-fields textarea')) editHistory.breakGroup();
});
document.querySelector('.mode-switch').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    setMode(event.key === 'Home' ? 'writing' : event.key === 'End' ? 'latex' : mode === 'writing' ? 'latex' : 'writing', true);
  }
});
editor.addEventListener('input', () => changed(editor.value, { group: 'source' }));
editor.addEventListener('scroll', () => { $('line-numbers').scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', event => {
  if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText('  ', start, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compile(); }
});
$('refresh-preview').addEventListener('click', compile);
$('retry-compile').addEventListener('click', compile);
$('download-source').addEventListener('click', () => download(new Blob([source], { type: 'application/x-tex;charset=utf-8' }), documentFilename('tex')));
$('download-pdf').addEventListener('click', async () => {
  const button = $('download-pdf');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.querySelector('span').textContent = 'Preparing PDF…';
  try {
    clearTimeout(debounce);
    readyToCompile = false;
    if (currentCompile) await currentCompile;
    if (compiledRevision !== revision) await compile();
    // Never silently download a PDF from an earlier draft.
    if (pdfBlob && compiledRevision === revision) download(pdfBlob, documentFilename('pdf'));
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.querySelector('span').textContent = 'Download PDF';
  }
});

$('import-source').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 300_000) throw new Error('Choose a .tex file smaller than 300 KB.');
    if (!file.name.toLowerCase().endsWith('.tex')) throw new Error('Choose a LaTeX file ending in .tex.');
    const imported = upgradeDocument((await file.text()).replace(/\r\n/g, '\n'));
    if (!imported.trim()) throw new Error('This file is empty. Choose a LaTeX document.');
    // Exporting first provides a recoverable copy before an imported file replaces a draft.
    if (source !== template && source !== imported) download(new Blob([source], { type: 'application/x-tex' }), 'cv-before-import.tex');
    changed(imported);
    setMode('latex');
    $('save-status').textContent = 'Imported document saved in this browser';
  } catch (error) { showError(error.message); }
  event.target.value = '';
});
$('reset-template').addEventListener('click', () => { $('reset-confirmation').hidden = false; $('cancel-reset').focus(); });
$('cancel-reset').addEventListener('click', () => { $('reset-confirmation').hidden = true; $('reset-template').focus(); });
$('confirm-reset').addEventListener('click', () => {
  changed(template);
  $('reset-confirmation').hidden = true;
  setMode(mode);
  $('reset-template').focus();
});
window.addEventListener('beforeunload', () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); });

try {
  const response = await fetch('/base.tex');
  if (!response.ok) throw new Error('The template could not be loaded. Refresh the page to try again.');
  template = (await response.text()).replace(/\r\n/g, '\n');
  try {
    source = localStorage.getItem(storageKey) || template;
    titleInput.value = (localStorage.getItem(titleStorageKey) || 'Untitled CV').slice(0, 100);
  }
  catch { source = template; }
  source = upgradeDocument(source);
  updateDocumentTitle();
  titleInput.disabled = false;
  editor.value = source;
  setMode(mode);
  saveDraft();
  for (const id of ['download-source', 'download-pdf', 'reset-template', 'refresh-preview']) $(id).disabled = false;
  compile();
} catch (error) {
  $('save-status').textContent = 'Template unavailable';
  $('writing-fields').textContent = error.message;
  showError(error.message);
}
