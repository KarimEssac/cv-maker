# Folio

A basic CV creator in plain HTML, CSS, and JavaScript. Write into ordinary fields or edit the full LaTeX source, see the compiled PDF on the right, and download it.

## Run locally

Requires Node.js 22 or newer. There are no npm runtime dependencies and no frontend framework or build step.

```sh
npm run setup:latex
npm start
```

Open **http://localhost:3000**. The setup command downloads the official Tectonic 0.17.0 binary for Windows, Linux, or macOS into `.tools/`. You can instead [install Tectonic yourself](https://tectonic-typesetting.github.io/book/latest/installation/) and put it on PATH, or set `TECTONIC_PATH` to its executable. Set `PORT` to change the server port.

The first compilation downloads and caches TeX packages and fonts. Allow a few minutes and an internet connection for that first run. Later compiles use the local cache and normally take a few seconds. Google Fonts supplies the interface fonts; system fallbacks work without that connection.

## Editing

- Edit the **CV title** at the top to name your document. It is saved in this browser and used for PDF and `.tex` download filenames, for example `Engineering CV.pdf`. Press Enter to finish renaming. Renaming does not alter the CV contents or trigger compilation; the title input keeps native text undo.
- **Writing / LaTeX** switches between plain content fields and the complete source. The selected mode is kept in the URL.
- The **+** button beside the editor tabs opens **Add a section**. Create a named text or bullet section, or restore a removed standard section. Standard sections return to their original position; custom sections are appended.
- **Drag the grip beside a section heading** to reorder it. A blue line shows whether it will land before or after another section. The list temporarily collapses during a drag, then restores its expanded sections. Mouse and touch work; holding near the editor's top or bottom scrolls the list. Focus a grip and use **Arrow Up / Arrow Down** for keyboard movement. **Escape** or dropping outside the editor cancels. Personal details stay at the top.
- Section order changes the actual LaTeX, is saved in the browser draft, updates the PDF, and participates in undo/redo. Standard and custom sections can both move.
- Open a section to use **Remove section** or add/remove its individual roles, qualifications, projects, skills, or certifications. Every skill has an editable **Skill heading** and separate **Skills or tools** field, including the original template categories.
- Use **Remove** beside a contact detail to omit it from the CV. **Add a contact detail** restores a standard field or adds another link with its own label and URL. Empty contact values are omitted without stray separators.
- **Ctrl+Z** (or **Cmd+Z**) and **Undo last change** share one history for writing, LaTeX, additions, removals, reordering, imports, and resets. **Ctrl+Shift+Z** / **Cmd+Shift+Z** or **Ctrl+Y** redo. Continuous typing in one field is grouped; pauses, switching fields, and structural changes start another undo step. History keeps up to 100 steps in the current session and survives mode switches. New edits after undo clear redo. Unsaved fields in the add-section form retain their normal browser text undo.
- Removed fields' definitions remain in the source to preserve their values when a standard section or contact detail is restored.
- The preview recompiles **2 seconds after the last edit**. The refresh button or Ctrl/Cmd+Enter in the code editor compiles immediately.
- **Download PDF** compiles pending changes before downloading. A broken source never silently downloads an earlier PDF.
- An error keeps the last successful preview and displays compiler details.
- Drafts are saved in this browser's local storage. Export `.tex` to keep an independent copy. Reset asks before replacing the draft. Import automatically exports a changed draft before replacing it.
- The preview uses the browser's native PDF viewer. **Open PDF in a new tab** is available for browsers that do not support embedded PDFs.

## Template

`base.tex` retains the supplied A4 geometry, Palatino header, resume macros, section styling, and original section order: Objective, Experience, Education, Projects, Skills, Certifications, Additional Information. Names, contact information, employers, institutions, locations, dates, project details, credentials, links, and original author contact comments have been replaced with generic placeholders. Links use `example.com`.

Each content macro has an annotation that connects it to writing mode:

```tex
% @field contact|Full name|text
\newcommand{\cvName}{Your name}
```

The supported field types are `text`, `url`, `long`, and `bullets`. Bullet fields contain `\item` entries, shown as one achievement per line in writing mode. Special TeX characters are escaped automatically. Custom LaTeX formatting is retained; fields containing it become read-only in writing mode so switching modes cannot erase formatting.

Writing mode handles section, entry, and contact changes directly. LaTeX mode remains available for layout changes and importing another document. An imported document without annotations remains fully editable in LaTeX mode.

`% @section` / `% @endsection`, `% @entry` / `% @endentry`, and `% @contact` / `% @endcontact` annotations delimit the editable structure in the actual LaTeX source. New content fields use unique letters-only command names. Keep these annotations when editing the code to retain the matching writing controls. Unrecognized custom code is left intact; malformed annotations show an error instead of rewriting the document.

Drafts from earlier Folio versions are upgraded automatically on loading or import. The upgrade preserves content fields, saved skill headings, and custom preamble changes and only replaces the recognized original contact header. Fixed skill headings gain linked writing fields. A manually redesigned header remains editable through LaTeX mode.

## How it works

The frontend calls `POST /api/compile` with the source. The small Node server uses only built-in modules, compiles with Tectonic in a temporary directory, returns the PDF bytes, and removes the temporary files. Preview and download use the same PDF. The application does not send CV content to an external compilation service.

The server binds to loopback and runs Tectonic in untrusted mode with shell escape disabled, a source-size limit, a compilation timeout, and a single compiler slot. It is intended for local use. A publicly hosted version needs an isolated compilation worker before accepting arbitrary LaTeX from visitors; Tectonic's untrusted mode is not an operating-system sandbox. Static hosting alone cannot compile LaTeX.

## Checks

```sh
npm test
npm run test:integration
```

The 23 model tests cover editing, TeX escaping, section/contact removal and restoration, custom sections and links, repeatable entries, migration of older drafts, editable skill headings, malformed annotations, undo/redo ordering and grouping, and section movement without content loss. The 9 integration tests start their own local server and compile actual PDFs, including reordered sections, renamed skill headings, removed sections/links, empty repeatable sections, and newly added entries. They also verify errors and request validation. Tectonic is required for integration tests.

The interface follows the Hallmark Terrazzo app-screen direction, adapted to crisp neutrals and a blue accent. Design tokens live in `tokens.css`.
