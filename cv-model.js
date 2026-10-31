// Field annotations connect ordinary writing to the actual LaTeX document.
export const groups = [
  ['contact', 'Personal details', 'Your name, contact details, and links'],
  ['objective', 'Objective', 'A short introduction to your work'],
  ['experience', 'Experience', 'Roles, employers, and achievements'],
  ['education', 'Education', 'Qualifications and academic work'],
  ['projects', 'Projects', 'Selected work and the tools behind it'],
  ['skills', 'Skills', 'Technical knowledge and strengths'],
  ['certifications', 'Certifications', 'Courses and professional qualifications'],
  ['additional', 'Additional information', 'Languages and anything else to include'],
];

// One document history keeps typing and structural changes in the same order.
export class EditHistory {
  constructor(limit = 100, typingDelay = 1000) {
    this.limit = limit;
    this.typingDelay = typingDelay;
    this.past = [];
    this.future = [];
    this.breakGroup();
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  breakGroup() { this.group = null; this.lastEdit = -Infinity; }
  record(before, after, group = null, now = Date.now()) {
    if (before.source === after.source) return;
    const last = this.past.at(-1);
    if (group && group === this.group && now - this.lastEdit < this.typingDelay && last) last.after = after;
    else {
      this.past.push({ before, after });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.group = group;
    this.lastEdit = now;
  }
  undo() {
    this.breakGroup();
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push(entry);
    return entry.before;
  }
  redo() {
    this.breakGroup();
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push(entry);
    return entry.after;
  }
}

function balancedGroup(source, start) {
  let depth = 1;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '%') { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue; }
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return { value: source.slice(start + 1, i), start: start + 1, end: i };
  }
  throw new Error('A writing field has an unclosed brace. Fix it in LaTeX mode.');
}

export function encodeText(text) {
  const escapes = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '$': '\\$', '&': '\\&', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
  return text.replace(/[\\{}%$&#_~^]/g, char => escapes[char]);
}

export function decodeText(value) {
  const decoded = value.replace(/\\(textbackslash|textasciitilde|textasciicircum)\{\}|\\([{}%$&#_])/g,
    (_, command, char) => char ?? ({ textbackslash: '\\', textasciitilde: '~', textasciicircum: '^' })[command]);
  // Only enable writing for content that survives a lossless round trip.
  return { text: decoded, editable: encodeText(decoded) === value };
}

export function parseFields(source) {
  const fields = [];
  const pattern = /^% @field (\w+)\|([^|\r\n]+)\|(text|long|bullets|url)\r?\n\\newcommand\{\\([A-Za-z]+)\}\s*\{/gm;
  for (const match of source.matchAll(pattern)) {
    const raw = balancedGroup(source, match.index + match[0].length - 1);
    const type = match[3];
    let content = raw.value;
    let editable = true;
    if (type === 'bullets') {
      if (content.trim() === '\\item[]') content = '';
      if (content.trim() && !content.trimStart().startsWith('\\item ')) editable = false;
      content = content.trim().replace(/^\\item\s+/, '').split(/\s*\\item\s+/).join('\n');
    }
    const decoded = decodeText(content);
    fields.push({ group: match[1], label: match[2], type, name: match[4], value: decoded.text,
      editable: editable && decoded.editable, start: raw.start, end: raw.end,
      definitionStart: match.index, definitionEnd: raw.end + 1 });
  }
  return fields;
}

export function updateField(source, name, value) {
  const field = parseFields(source).find(item => item.name === name);
  if (!field) throw new Error('This field was removed in LaTeX mode.');
  if (!field.editable) throw new Error('This field contains custom LaTeX. Edit it in LaTeX mode.');
  const encoded = field.type === 'bullets'
    ? value.split(/\r?\n/).filter(line => line.trim()).map(line => `\\item ${encodeText(line.trim())}`).join('\n') || '\\item[]'
    : encodeText(value.replace(/\r\n/g, '\n'));
  return source.slice(0, field.start) + encoded + source.slice(field.end);
}

export const entryTypes = {
  experience: ['Role', 'Add role'], education: ['Qualification', 'Add qualification'],
  projects: ['Project', 'Add project'], skills: ['Skill', 'Add skill'],
  certifications: ['Certification', 'Add certification'],
};

export const contactTypes = [
  ['cvPhone', 'Phone', 'details'], ['cvEmail', 'Email', 'details'],
  ['cvLinkedin', 'LinkedIn', 'links'], ['cvGithub', 'GitHub', 'links'],
  ['cvPortfolio', 'Portfolio', 'links'], ['cvLocation', 'Location', 'location'],
];

const contactHelpers = String.raw`% Optional contact rows omit empty items and their separators.
\newif\ifcvContactSeparator
\newcommand{\cvContactItem}[2]{%
  \ifx#1\empty\else
    \ifcvContactSeparator\ | \fi#2\cvContactSeparatortrue
  \fi
}
\newcommand{\cvContactRow}[1]{%
  \begingroup
  \setbox0=\hbox{\small\cvContactSeparatorfalse #1}%
  \ifdim\wd0>0pt
    \vspace{-6mm}\begin{center}\usebox0\end{center}%
  \fi
  \endgroup
}
`;

const legacyHeader = String.raw`\begin{center}
  {\Huge\textbf{\cvName}}
\end{center}
\vspace{-6mm}
\begin{center}
  \small{\cvPhone\ | \href{mailto:\cvEmail}{\cvEmail}}
\end{center}
\vspace{-6mm}
\begin{center}
  \small{\socialicon{\faLinkedin}\ \href{\cvLinkedin}{LinkedIn} |
  \socialicon{\faGithub}\ \href{\cvGithub}{GitHub} |
  \socialicon{\faUserTie}\ \href{\cvPortfolio}{Portfolio}}
\end{center}
\vspace{-6mm}
\begin{center}\small{\cvLocation}\end{center}
\vspace{-6mm}`;

const flexibleHeader = String.raw`\begin{center}
  {\Huge\textbf{\cvName}}
\end{center}
% @contact-row-start details
\cvContactRow{%
% @contact cvPhone|Phone|cvPhone
  \cvContactItem{\cvPhone}{\cvPhone}%
% @endcontact cvPhone
% @contact cvEmail|Email|cvEmail
  \cvContactItem{\cvEmail}{\href{mailto:\cvEmail}{\cvEmail}}%
% @endcontact cvEmail
}
% @contact-row-end details
% @contact-row-start links
\cvContactRow{%
% @contact cvLinkedin|LinkedIn|cvLinkedin
  \cvContactItem{\cvLinkedin}{\socialicon{\faLinkedin}\ \href{\cvLinkedin}{LinkedIn}}%
% @endcontact cvLinkedin
% @contact cvGithub|GitHub|cvGithub
  \cvContactItem{\cvGithub}{\socialicon{\faGithub}\ \href{\cvGithub}{GitHub}}%
% @endcontact cvGithub
% @contact cvPortfolio|Portfolio|cvPortfolio
  \cvContactItem{\cvPortfolio}{\socialicon{\faUserTie}\ \href{\cvPortfolio}{Portfolio}}%
% @endcontact cvPortfolio
}
% @contact-row-end links
% @contact-row-start location
\cvContactRow{%
% @contact cvLocation|Location|cvLocation
  \cvContactItem{\cvLocation}{\cvLocation}%
% @endcontact cvLocation
}
% @contact-row-end location
\vspace{-6mm}`;

function letters(number) {
  let result = '';
  do { result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26) - 1; } while (number >= 0);
  return result;
}

function blocks(source, kind) {
  const pattern = new RegExp(`^% @${kind} (\\w+)\\|([^\\r\\n]+)\\r?\\n`, 'gm');
  const result = [];
  for (const match of source.matchAll(pattern)) {
    const ending = new RegExp(`^% @end${kind} ${match[1]}[ \\t]*(?:\\r?\\n|$)`, 'gm');
    ending.lastIndex = match.index + match[0].length;
    const end = ending.exec(source);
    if (!end) throw new Error(`The ${kind} "${match[1]}" has no closing annotation. Fix it in LaTeX mode.`);
    if (result.some(block => block.id === match[1] || block.end > match.index)) throw new Error(`The ${kind} annotations overlap or repeat. Fix them in LaTeX mode.`);
    const [label, names = ''] = match[2].split('|');
    result.push({ id: match[1], label, fields: names.split(',').filter(Boolean), start: match.index,
      contentStart: match.index + match[0].length, contentEnd: end.index, end: end.index + end[0].length });
  }
  return result;
}

export function parseSections(source) {
  const fields = parseFields(source);
  return blocks(source, 'section').map(section => {
    const title = fields.find(field => field.name === section.label);
    return { ...section, titleField: title?.name, title: title?.value || section.label };
  });
}

export function parseContacts(source) { return blocks(source, 'contact'); }
export function parseEntries(source, sectionId) {
  const section = blocks(source, 'section').find(item => item.id === sectionId);
  if (!section) return [];
  return blocks(source, 'entry').filter(entry => entry.start > section.start && entry.end < section.end);
}

function annotateEntries(body, group, fields) {
  const patterns = {
    experience: /^[ \t]*\\resumeSubheading\b[\s\S]*?\\resumeItemListEnd[^\S\n]*(?:\n|$)/gm,
    education: /^[ \t]*\\resumeSubheading\b[\s\S]*?\\resumeItemListEnd[^\S\n]*(?:\n|$)/gm,
    projects: /^[ \t]*\\resumeProject\b[\s\S]*?\\resumeItemListEnd[^\S\n]*(?:\n|$)/gm,
    skills: /^[ \t]*\\resumeSubItem\b[^\n]*(?:\n|$)/gm,
    certifications: /^[ \t]*\\resumePOR\b[^\n]*(?:\n|$)/gm,
  };
  if (!patterns[group]) return body;
  let index = 0;
  return body.replace(patterns[group], entry => {
    const members = fields.filter(field => field.group === group && new RegExp(`\\\\${field.name}(?![A-Za-z])`).test(entry));
    if (!members.length) return entry;
    const id = `${group}${letters(index++)}`;
    const label = group === 'skills' ? members[0].label : entryTypes[group][0];
    return `% @entry ${id}|${label}|${members.map(field => field.name).join(',')}\n${entry.trimEnd()}\n% @endentry ${id}\n`;
  });
}

// Upgrade earlier Folio drafts without replacing their content or custom commands.
export function upgradeDocument(source) {
  if (source.includes('% @structure v2')) return upgradeSkillHeadings(source);
  if (!source.includes('\\newcommand{\\cvName}')) return source;
  const fields = parseFields(source);
  const headingPattern = /^\\section\{/gm;
  const headings = [...source.matchAll(headingPattern)];
  const known = new Map(groups.slice(1).map(([id, label]) => [label.toLowerCase(), id]));
  const replacements = [];
  for (let i = 0; i < headings.length; i++) {
    const match = headings[i];
    const heading = balancedGroup(source, match.index + match[0].length - 1);
    const title = heading.value.replace(/^\\textbf\{(.*)\}$/, '$1');
    const group = known.get(title.toLowerCase());
    if (!group) continue;
    const end = headings[i + 1]?.index ?? source.indexOf('\\end{document}', heading.end);
    if (end < 0) continue;
    const body = source.slice(match.index, end);
    replacements.push({ start: match.index, end, value: `% @section ${group}|${title}\n${annotateEntries(body, group, fields).trimEnd()}\n% @endsection ${group}\n\n` });
  }
  for (const replacement of replacements.reverse()) source = source.slice(0, replacement.start) + replacement.value + source.slice(replacement.end);
  const headerStart = source.indexOf('% Header\n');
  const headerEnd = source.indexOf('% @section ', headerStart);
  if (headerStart >= 0 && headerEnd >= 0) {
    const start = headerStart + '% Header\n'.length;
    const original = source.slice(start, headerEnd);
    if (original.replace(/\s/g, '') === legacyHeader.replace(/\s/g, '')) {
      source = source.slice(0, start) + flexibleHeader + '\n\n' + source.slice(headerEnd);
      const insertion = source.indexOf('\\begin{document}');
      source = source.slice(0, insertion) + contactHelpers + '\n' + source.slice(insertion);
    }
  }
  return upgradeSkillHeadings('% @structure v2\n' + source);
}

// Convert fixed skill labels into content fields, retaining saved titles and values.
function upgradeSkillHeadings(source) {
  const replacements = [];
  const definitions = [];
  let reserved = source;
  let entries;
  try { entries = parseEntries(source, 'skills'); }
  catch { return source; } // Keep incomplete code drafts available for repair.
  for (const entry of entries) {
    if (entry.fields.length !== 1) continue;
    const content = source.slice(entry.contentStart, entry.contentEnd);
    const command = /\\resumeSubItem\s*\{/.exec(content);
    if (!command) continue;
    const heading = balancedGroup(source, entry.contentStart + command.index + command[0].length - 1);
    const suffix = nextSuffix(reserved, 'cvSkillHeading');
    const name = `cvSkillHeading${suffix}`;
    reserved += `\\${name}`;
    const colon = /:\s*$/.test(heading.value) ? ':' : '';
    const title = heading.value.replace(/:\s*$/, '').trim();
    definitions.push(`% @field skills|Skill heading|text\n\\newcommand{\\${name}}{${title}}`);
    const start = heading.start - entry.contentStart;
    const end = heading.end - entry.contentStart;
    const updated = content.slice(0, start) + `\\${name}${colon}` + content.slice(end);
    replacements.push({ start: entry.start, end: entry.end,
      value: `% @entry ${entry.id}|Skill|${name},${entry.fields.join(',')}\n${updated}% @endentry ${entry.id}\n` });
  }
  for (const replacement of replacements.reverse()) source = source.slice(0, replacement.start) + replacement.value + source.slice(replacement.end);
  return definitions.length ? insertDefinitions(source, definitions.join('\n\n')) : source;
}

function removeBlock(source, block) {
  if (!block) throw new Error('This item has already been removed.');
  return source.slice(0, block.start) + source.slice(block.end);
}

export function removeSection(source, id) { return removeBlock(source, blocks(source, 'section').find(section => section.id === id)); }
export function moveSection(source, id, targetId, position = 'after') {
  if (!['before', 'after'].includes(position)) throw new Error('Choose a position before or after another section.');
  const sections = blocks(source, 'section');
  const moved = sections.find(section => section.id === id);
  const target = sections.find(section => section.id === targetId);
  if (!moved || !target) throw new Error('This section is no longer in the document.');
  if (id === targetId) return source;
  const order = sections.map(section => section.id).filter(sectionId => sectionId !== id);
  order.splice(order.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id);
  if (order.every((sectionId, index) => sectionId === sections[index].id)) return source;
  const content = source.slice(moved.start, moved.end);
  const remaining = removeBlock(source, moved);
  let insertion = position === 'after' ? target.end : target.start;
  if (moved.start < insertion) insertion -= moved.end - moved.start;
  return remaining.slice(0, insertion) + content + remaining.slice(insertion);
}
export function removeContact(source, id) { return removeBlock(source, parseContacts(source).find(contact => contact.id === id)); }
export function removeEntry(source, id) {
  const entry = blocks(source, 'entry').find(item => item.id === id);
  if (!entry) throw new Error('This entry has already been removed.');
  const section = blocks(source, 'section').find(item => entry.start > item.start && entry.end < item.end);
  if (!section) throw new Error('This entry is outside a section. Fix its annotations in LaTeX mode.');
  let next = removeBlock(source, entry);
  // Empty itemize environments do not compile, so retain a nonprinting item.
  if (parseEntries(next, section.id).length === 0) {
    next = next.replace(new RegExp(`(% @section ${section.id}\\|[\\s\\S]*?)(\\\\resume(?:SubHeadingListStart|HeadingSkillStart))\\s*(\\\\resume(?:SubHeadingListEnd|HeadingSkillEnd))`), '$1$2\n% @empty-entry\n\\item[]\n$3');
  }
  return next;
}

function insertDefinitions(source, definitions) {
  const insertion = source.indexOf('\\begin{document}');
  if (insertion < 0) throw new Error('Add a document body in LaTeX mode first.');
  return source.slice(0, insertion) + definitions + '\n\n' + source.slice(insertion);
}

function ensureDefinitions(source, template, names) {
  const existing = new Set(parseFields(source).map(field => field.name));
  const missing = parseFields(template).filter(field => names.includes(field.name) && !existing.has(field.name));
  for (const field of missing) {
    if (new RegExp(`\\\\(?:newcommand|renewcommand|providecommand)\\{\\\\${field.name}\\}`).test(source)) throw new Error(`The field ${field.name} has custom annotations. Restore them in LaTeX mode first.`);
  }
  return missing.length ? insertDefinitions(source, missing.map(field => template.slice(field.definitionStart, field.definitionEnd)).join('\n\n')) : source;
}

function nextSuffix(source, prefix) {
  let index = 0;
  while (source.includes(`${prefix}${letters(index)}`)) index++;
  return letters(index);
}

export function addSection(source, template, type, title = '', contentType = 'long') {
  if (type !== 'custom') {
    if (parseSections(source).some(section => section.id === type)) throw new Error('This section is already in your CV.');
    const section = blocks(template, 'section').find(item => item.id === type);
    if (!section) throw new Error('Choose a section from the list.');
    source = ensureDefinitions(source, template, parseFields(template).filter(field => field.group === type).map(field => field.name));
    const order = groups.map(([id]) => id);
    const successor = parseSections(source).find(item => order.indexOf(item.id) > order.indexOf(type));
    const insertion = successor?.start ?? source.indexOf('\\end{document}');
    if (insertion < 0) throw new Error('Restore the end of the document in LaTeX mode first.');
    return source.slice(0, insertion) + template.slice(section.start, section.end) + '\n' + source.slice(insertion);
  }
  if (!title.trim() || title.length > 100) throw new Error('Give the section a name of 1 to 100 characters.');
  if (!['long', 'bullets'].includes(contentType)) throw new Error('Choose text or a bullet list.');
  const suffix = nextSuffix(source, 'cvCustomTitle');
  const id = `custom${suffix}`;
  const titleName = `cvCustomTitle${suffix}`;
  const contentName = `cvCustomContent${suffix}`;
  const definitions = `% @field ${id}|Section name|text\n\\newcommand{\\${titleName}}{${encodeText(title.trim())}}\n\n% @field ${id}|${contentType === 'bullets' ? 'Details (one per line)' : 'Details'}|${contentType}\n\\newcommand{\\${contentName}}{${contentType === 'bullets' ? '\\item[]' : ''}}`;
  source = insertDefinitions(source, definitions);
  const body = contentType === 'bullets'
    ? `\\resumeItemListStart\n  \\${contentName}\n\\resumeItemListEnd`
    : `{\\small \\${contentName}\\par}`;
  const block = `% @section ${id}|${titleName}\n\\section{\\textbf{\\${titleName}}}\n\\vspace{1mm}\n${body}\n\\vspace{-2mm}\n% @endsection ${id}\n\n`;
  const insertion = source.indexOf('\\end{document}');
  if (insertion < 0) throw new Error('Restore the end of the document in LaTeX mode first.');
  return source.slice(0, insertion) + block + source.slice(insertion);
}

export function addContact(source, template, type) {
  if (parseContacts(source).some(contact => contact.id === type)) throw new Error('This contact detail is already in your CV.');
  let row = 'links';
  let block;
  if (type === 'custom') {
    const suffix = nextSuffix(source, 'cvLinkLabel');
    const labelName = `cvLinkLabel${suffix}`;
    const urlName = `cvLinkUrl${suffix}`;
    source = insertDefinitions(source, `% @field contact|Link label|text\n\\newcommand{\\${labelName}}{Website}\n\n% @field contact|Link URL|url\n\\newcommand{\\${urlName}}{https://example.com}`);
    block = `% @contact link${suffix}|Website|${labelName},${urlName}\n  \\cvContactItem{\\${urlName}}{\\href{\\${urlName}}{\\${labelName}}}%\n% @endcontact link${suffix}\n`;
  } else {
    const option = contactTypes.find(([id]) => id === type);
    const contact = parseContacts(template).find(item => item.id === type);
    if (!option || !contact) throw new Error('Choose a contact detail from the list.');
    row = option[2];
    source = ensureDefinitions(source, template, contact.fields);
    block = template.slice(contact.start, contact.end);
  }
  const rowEnd = source.indexOf(`% @contact-row-end ${row}`);
  if (rowEnd < 0) throw new Error('This header has custom LaTeX. Edit its links in LaTeX mode.');
  const insertion = source.lastIndexOf('}', rowEnd);
  return source.slice(0, insertion) + block + source.slice(insertion);
}

export function addEntry(source, template, sectionId) {
  const original = parseEntries(template, sectionId)[0];
  if (!original) throw new Error('Use a custom section to add this type of content.');
  const section = blocks(source, 'section').find(item => item.id === sectionId);
  if (!section) throw new Error('Add the section before adding an entry.');
  const suffix = nextSuffix(source, 'cvEntry');
  const members = parseFields(template).filter(field => original.fields.includes(field.name));
  const names = new Map(members.map((field, index) => [field.name, `cvEntry${suffix}Field${letters(index)}`]));
  let definitions = members.map(field => {
    let definition = template.slice(field.definitionStart, field.definitionEnd);
    definition = definition.replace(`|${field.label}|`, `|${field.label.replace(/^(?:First (?:role|project)|Second (?:role|project)|Qualification \d+):\s*/i, '')}|`);
    return definition.replace(new RegExp(`\\\\${field.name}(?![A-Za-z])`, 'g'), () => `\\${names.get(field.name)}`);
  }).join('\n\n');
  const id = `entry${suffix}`;
  let content = template.slice(original.contentStart, original.contentEnd).replace(/\\([A-Za-z]+)/g, (match, name) => names.has(name) ? `\\${names.get(name)}` : match);
  let fieldNames = [...names.values()];
  if (sectionId === 'skills') {
    fieldNames = [`cvEntry${suffix}FieldA`, `cvEntry${suffix}FieldB`];
    definitions = `% @field skills|Skill heading|text\n\\newcommand{\\${fieldNames[0]}}{Skill name}\n\n% @field skills|Skills or tools|text\n\\newcommand{\\${fieldNames[1]}}{Your skills}`;
    content = `  \\resumeSubItem{\\${fieldNames[0]}:}{\\${fieldNames[1]}}\n`;
  }
  const block = `% @entry ${id}|${entryTypes[sectionId][0]}|${fieldNames.join(',')}\n${content}% @endentry ${id}\n`;
  let body = source.slice(section.contentStart, section.contentEnd).replace(/% @empty-entry\n\\item\[\]\n/g, '');
  const ending = /\\resume(?:SubHeadingListEnd|HeadingSkillEnd)/.exec(body);
  if (!ending) throw new Error('This section has custom LaTeX. Add its entries in LaTeX mode.');
  body = body.slice(0, ending.index) + block + body.slice(ending.index);
  source = source.slice(0, section.contentStart) + body + source.slice(section.contentEnd);
  return insertDefinitions(source, definitions);
}
