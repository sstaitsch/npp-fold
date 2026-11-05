import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, rectangularSelection, crosshairCursor,
  highlightWhitespace, dropCursor,
} from "@codemirror/view";
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, toggleComment,
  copyLineDown, deleteLine, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown,
  indentLess, indentMore, cursorLineBoundaryBackward, cursorLineBoundaryForward, selectAll,
} from "@codemirror/commands";
import {
  search, searchKeymap, openSearchPanel, gotoLine, highlightSelectionMatches,
  selectNextOccurrence,
} from "@codemirror/search";
import {
  syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, foldKeymap,
  indentOnInput, defaultHighlightStyle,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { oneDarkTheme, oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { tags as t } from "@lezer/highlight";
import { LANGS, langById, langSupport, detectLang } from "./langs.js";

const native = window.Android || null;
const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------- Einstellungen
const DEFAULTS = { theme: "auto", wrap: false, ws: false, fontSize: 14, keys: true, brackets: false, autoUpd: true };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem("npp.settings") || "{}")); } catch {}
const saveSettings = () => { try { localStorage.setItem("npp.settings", JSON.stringify(settings)); } catch {} };

const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => settings.theme === "dark" || (settings.theme === "auto" && darkMQ.matches);

// Notepad++-ähnliche Farben (Standard-Design "Default")
const nppLight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: "#0000ff", fontWeight: "bold" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], color: "#8000ff" },
  { tag: [t.string, t.special(t.string), t.character], color: "#808080" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#008000" },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: "#ff8000" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#000080", fontWeight: "bold" },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: "#804000" },
  { tag: [t.tagName], color: "#0000ff" },
  { tag: [t.attributeName, t.propertyName], color: "#ff0000" },
  { tag: [t.labelName], color: "#c00000", fontWeight: "bold" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#000080" },
  { tag: [t.special(t.variableName), t.variableName], color: "#000000" },
  { tag: t.heading, color: "#0000ff", fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, color: "#0000ff", textDecoration: "underline" },
  { tag: t.invalid, color: "#ff0000" },
]);
const informDark = HighlightStyle.define([{ tag: t.labelName, color: "#e5c07b", fontWeight: "bold" }]);

const lightTheme = EditorView.theme({
  "&": { backgroundColor: "#ffffff", color: "#000000" },
  ".cm-gutters": { backgroundColor: "#e4e4e4", color: "#808080", borderRight: "1px solid #c8c8c8" },
  ".cm-activeLine": { backgroundColor: "#e8e8ff" },
  ".cm-activeLineGutter": { backgroundColor: "#d0d0f0", color: "#000" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "#c0c0c0 !important" },
  ".cm-selectionMatch": { backgroundColor: "#c0ffc0" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "transparent", color: "#ff0000", fontWeight: "bold", outline: "1px solid #ff0000" },
  ".cm-searchMatch": { backgroundColor: "#ffff00", outline: "1px solid #d0d000" },
  ".cm-searchMatch-selected": { backgroundColor: "#ff8000" },
  ".cm-cursor": { borderLeftColor: "#000", borderLeftWidth: "2px" },
}, { dark: false });
const darkExtra = EditorView.theme({
  ".cm-cursor": { borderLeftWidth: "2px" },
  ".cm-searchMatch": { backgroundColor: "#72a1ff59", outline: "1px solid #457dff" },
});

const baseTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { fontFamily: "'JetBrains Mono','Cascadia Mono','DejaVu Sans Mono','Droid Sans Mono',monospace", lineHeight: "1.45" },
  ".cm-gutterElement": { padding: "0 6px 0 8px" },
  ".cm-panels": { fontSize: "15px" },
  ".cm-panel.cm-search": { padding: "8px 36px 8px 8px", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" },
  ".cm-panel.cm-search input[type=checkbox]": { width: "20px", height: "20px", verticalAlign: "middle" },
  ".cm-panel.cm-search label": { fontSize: "14px", display: "inline-flex", alignItems: "center", gap: "4px", marginRight: "6px" },
  ".cm-panel.cm-search br": { flexBasis: "100%", height: 0 },
  ".cm-textfield": { fontSize: "16px", padding: "6px 8px", minWidth: "10em", borderRadius: "6px" },
  ".cm-button": { fontSize: "14px", padding: "6px 12px", borderRadius: "6px", backgroundImage: "none" },
  ".cm-panel.cm-search [name=close]": { fontSize: "26px", padding: "0 8px", top: "4px", right: "4px" },
  ".cm-panel.cm-gotoLine": { padding: "8px", fontSize: "15px" },
});

const PHRASES = EditorState.phrases.of({
  "Find": "Suchen", "Replace": "Ersetzen", "next": "weiter", "previous": "zurück", "all": "alle",
  "match case": "Groß/klein", "regexp": "Regulärer Ausdruck", "by word": "Ganzes Wort",
  "replace": "ersetzen", "replace all": "alle ersetzen", "close": "schließen",
  "current match": "aktueller Treffer", "replaced $ matches": "$ Treffer ersetzt",
  "replaced match on line $": "Treffer in Zeile $ ersetzt", "on line": "in Zeile",
  "Go to line": "Gehe zu Zeile", "go": "los", "Folded lines": "Eingeklappte Zeilen",
  "Unfolded lines": "Ausgeklappte Zeilen", "to": "bis", "folded code": "eingeklappter Code",
  "unfold": "ausklappen", "Fold line": "Zeile einklappen", "Unfold line": "Zeile ausklappen",
});

// Compartments für umschaltbare Optionen
const cLang = new Compartment(), cTheme = new Compartment(), cWrap = new Compartment(),
  cWs = new Compartment(), cFont = new Compartment(), cBr = new Compartment();

function themeExt() {
  return isDark()
    ? [oneDarkTheme, darkExtra, syntaxHighlighting(oneDarkHighlightStyle), syntaxHighlighting(informDark)]
    : [lightTheme, syntaxHighlighting(nppLight), syntaxHighlighting(defaultHighlightStyle, { fallback: true })];
}
const fontExt = () => EditorView.theme({ "&": { fontSize: settings.fontSize + "px" } });
const wsExt = () => (settings.ws ? [highlightWhitespace()] : []);
const wrapExt = () => (settings.wrap ? EditorView.lineWrapping : []);
const brExt = () => (settings.brackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []);

const appKeys = keymap.of([
  { key: "Mod-s", run: () => (saveDoc(activeDoc()), true), preventDefault: true },
  { key: "Mod-Shift-s", run: () => (saveDocAs(activeDoc()), true), preventDefault: true },
  { key: "Mod-Alt-s", run: () => (saveAll(), true), preventDefault: true },
  { key: "Mod-o", run: () => (openFile(), true), preventDefault: true },
  { key: "Mod-n", run: () => (newDoc(), true), preventDefault: true },
  { key: "Mod-w", run: () => (closeDoc(activeDoc()), true), preventDefault: true },
  { key: "Mod-h", run: (v) => openSearchPanel(v), preventDefault: true },
  { key: "Mod-g", run: gotoLine, preventDefault: true },
  { key: "Mod-d", run: copyLineDown, preventDefault: true },
  { key: "Mod-l", run: deleteLine, preventDefault: true },
  { key: "Mod-q", run: toggleComment, preventDefault: true },
  { key: "Mod-Tab", run: () => (cycleTab(1), true), preventDefault: true },
  { key: "Mod-Shift-Tab", run: () => (cycleTab(-1), true), preventDefault: true },
  { key: "Mod-=", run: () => (zoom(1), true), preventDefault: true },
  { key: "Mod--", run: () => (zoom(-1), true), preventDefault: true },
  { key: "Mod-0", run: () => (settings.fontSize = 14, applySettings(), true), preventDefault: true },
]);

function makeState(text, langId) {
  return EditorState.create({
    doc: text,
    extensions: [
      appKeys,
      lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightSpecialChars(),
      history(), drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
      indentOnInput(), bracketMatching(), rectangularSelection(), crosshairCursor(),
      highlightActiveLine(), highlightSelectionMatches(), search({ top: true }),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      PHRASES, baseTheme,
      EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", autocomplete: "off" }),
      cLang.of(langSupport(langId)), cTheme.of(themeExt()), cWrap.of(wrapExt()),
      cWs.of(wsExt()), cFont.of(fontExt()), cBr.of(brExt()),
      EditorView.updateListener.of(onUpdate),
    ],
  });
}

// ---------------------------------------------------------------- Dokumente
let docs = [];
let seq = 1, newCount = 1;
const panes = [
  { el: $("#pane0"), tabs: $("#pane0 .tabbar"), active: null, view: null },
  { el: $("#pane1"), tabs: $("#pane1 .tabbar"), active: null, view: null },
];
let focusPane = 0;

function createDoc({ name, uri = null, text = "", encoding = "UTF-8", bom = false, eol = null, lang = null, view = 0, saved = null }) {
  if (eol == null) eol = /\r\n/.test(text) ? "\r\n" : /\r(?!\n)/.test(text) ? "\r" : "\n";
  const langId = lang || detectLang(name, text);
  const d = { id: seq++, name, uri, encoding, bom, eol, langId, view, state: makeState(text, langId) };
  d.saved = saved == null ? d.state.doc : EditorState.create({ doc: saved }).doc;
  docs.push(d);
  return d;
}
const isDirty = (d) => !d.state.doc.eq(d.saved);
const stateOf = (d) => (panes[d.view].active === d ? panes[d.view].view.state : d.state);
const textOf = (d) => stateOf(d).doc.sliceString(0, undefined, d.eol);
const visibleDocs = (p) => (splitActive() ? docs.filter((d) => d.view === p) : p === 0 ? docs : []);
const activeDoc = () => panes[focusPane].active || panes[0].active;

function syncState(d) { if (d && panes[d.view].active === d) d.state = panes[d.view].view.state; }

function activate(d, focus = true) {
  if (!d) return;
  const p = splitActive() ? d.view : 0;
  const pane = panes[p];
  if (pane.active && pane.active !== d) syncState(pane.active);
  // Falls dieses Dokument in einem anderen Bereich angezeigt war
  for (const q of panes) if (q !== pane && q.active === d) { syncState(d); q.active = null; }
  if (pane.active !== d) { pane.active = d; pane.view.setState(d.state); }
  focusPane = p;
  render();
  if (focus) setTimeout(() => pane.view.focus(), 0);
}

function onUpdate(u) {
  for (const p of panes) {
    if (p.view === u.view && p.active) {
      p.active.state = u.state;
      if (u.docChanged) { renderTabs(); scheduleSession(); }
      if (u.docChanged || u.selectionSet) renderStatus();
    }
  }
}

function newDoc() {
  const d = createDoc({ name: "neu " + newCount++, view: splitActive() ? focusPane : 0 });
  activate(d);
}

function closeDoc(d, force = false) {
  if (!d) return;
  syncState(d);
  if (!force && isDirty(d)) {
    return confirmDialog(`„${d.name}" wurde geändert. Änderungen speichern?`,
      [["Speichern", async () => { if (await saveDoc(d)) closeDoc(d, true); }],
       ["Verwerfen", () => closeDoc(d, true)], ["Abbrechen", null]]);
  }
  const idx = docs.indexOf(d);
  docs.splice(idx, 1);
  for (const p of panes) if (p.active === d) p.active = null;
  if (!docs.length) { newCount = 1; createDoc({ name: "neu " + newCount++ }); }
  ensureActive();
  render(); scheduleSession();
}

function ensureActive() {
  const split = splitActive();
  [0, 1].forEach((p) => {
    const vis = visibleDocs(p);
    const pane = panes[p];
    if (!split && p === 1) { if (pane.active) syncState(pane.active); pane.active = null; return; }
    if (!pane.active || !vis.includes(pane.active)) {
      const d = vis[vis.length - 1] || null;
      pane.active = d;
      if (d) pane.view.setState(d.state);
    }
  });
  if (!panes[focusPane].active) focusPane = 0;
}

function moveToOtherView(d) {
  if (!d) return;
  if (!isWide()) return toast("Zweite Ansicht nur im aufgeklappten Zustand / Querformat");
  syncState(d);
  for (const p of panes) if (p.active === d) p.active = null;
  d.view = d.view === 0 ? 1 : 0;
  syncSplit();
  ensureActive();
  activate(d);
  scheduleSession();
}

function cycleTab(dir) {
  const list = visibleDocs(focusPane);
  const cur = panes[focusPane].active;
  if (list.length < 2) return;
  activate(list[(list.indexOf(cur) + dir + list.length) % list.length]);
}

// ---------------------------------------------------------------- Layout / Split
const isWide = () => window.innerWidth >= 600;
const splitActive = () => isWide() && docs.some((d) => d.view === 1);
let wasSplit = null;
function syncSplit() {
  const split = splitActive();
  if (split !== wasSplit) {
    wasSplit = split;
    if (!split && panes[1].active) { syncState(panes[1].active); panes[1].active = null; }
    ensureActive();
  }
  document.body.classList.toggle("wide", isWide());
  document.body.classList.toggle("split", split);
}
function layout() { render(); }
window.addEventListener("resize", layout);

// ---------------------------------------------------------------- Darstellung
const ICONS = {
  new: "M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM12 11v6M9 14h6",
  open: "M5 19a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1M5 19h14a2 2 0 0 0 2-1.6l1-5.4H8l-3 7z",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  goto: "M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3",
  wrap: "M3 6h18M3 12h15a3 3 0 1 1 0 6h-4M16 16l-2 2 2 2M3 18h7",
  ws: "M4 17h3M10.5 17h3M17 17h3M6 7h12M12 7v7",
  split: "M4 4h16v16H4zM12 4v16",
  zin: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35M11 8v6M8 11h6",
  zout: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35M8 11h6",
  theme: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z",
  more: "M12 5h.01M12 12h.01M12 19h.01",
  keys: "M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10",
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[n]}"/></svg>`;

function buildToolbar() {
  const items = [
    ["new", "Neu", newDoc], ["open", "Öffnen", openFile], ["save", "Speichern", () => saveDoc(activeDoc())], "|",
    ["undo", "Rückgängig", () => undo(curView())], ["redo", "Wiederholen", () => redo(curView())], "|",
    ["search", "Suchen", () => { openSearchPanel(curView()); }], ["goto", "Gehe zu", () => gotoLine(curView())], "|",
    ["wrap", "Umbruch", () => toggle("wrap"), "wrap"], ["ws", "Leerzeichen", () => toggle("ws"), "ws"],
    ["zout", "Kleiner", () => zoom(-1)], ["zin", "Größer", () => zoom(1)], "|",
    ["split", "Andere Ansicht", () => moveToOtherView(activeDoc()), null, "wide-only"],
    ["keys", "Sondertasten", () => toggle("keys"), "keys"],
    ["theme", "Design", cycleTheme],
  ];
  const tb = $("#toolbar .tools");
  tb.innerHTML = "";
  for (const it of items) {
    if (it === "|") { tb.insertAdjacentHTML("beforeend", '<span class="sep"></span>'); continue; }
    const [ic, label, fn, flag, cls] = it;
    const b = document.createElement("button");
    b.className = "tb" + (cls ? " " + cls : "");
    b.title = label;
    b.innerHTML = icon(ic) + `<span class="lbl">${label}</span>`;
    if (flag) b.dataset.flag = flag;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // Fokus im Editor lassen
    b.addEventListener("click", fn);
    tb.appendChild(b);
  }
  const sel = $("#lang");
  sel.innerHTML = LANGS.map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
  sel.addEventListener("change", () => setLang(activeDoc(), sel.value));
  const mb = $("#menubtn");
  mb.innerHTML = icon("more");
  mb.addEventListener("click", (e) => { e.stopPropagation(); showMenu(); });
}

const curView = () => panes[focusPane].view;

function renderTabs() {
  const split = splitActive();
  [0, 1].forEach((p) => {
    const pane = panes[p];
    const vis = visibleDocs(p);
    pane.tabs.innerHTML = "";
    for (const d of vis) {
      const tab = document.createElement("div");
      tab.className = "tab" + (pane.active === d ? " active" : "") + (isDirty(d) ? " dirty" : "");
      tab.title = d.uri ? decodeURIComponent(d.uri) : d.name;
      tab.innerHTML = `<span class="ico"></span><span class="name"></span><button class="x" aria-label="Schließen">×</button>`;
      tab.querySelector(".name").textContent = d.name;
      tab.addEventListener("click", (e) => { if (!e.target.closest(".x")) activate(d); });
      tab.querySelector(".x").addEventListener("click", (e) => { e.stopPropagation(); closeDoc(d); });
      tab.addEventListener("contextmenu", (e) => { e.preventDefault(); showTabMenu(d, e); });
      pane.tabs.appendChild(tab);
      if (pane.active === d) setTimeout(() => tab.scrollIntoView({ block: "nearest", inline: "nearest" }), 0);
    }
    pane.el.classList.toggle("focused", split && focusPane === p);
  });
}

function renderStatus() {
  const d = activeDoc();
  if (!d) return;
  const st = stateOf(d);
  const sel = st.selection.main;
  const line = st.doc.lineAt(sel.head);
  const selLen = st.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
  const eolName = { "\r\n": "Windows (CR LF)", "\n": "Unix (LF)", "\r": "Mac (CR)" }[d.eol];
  const enc = d.encoding === "UTF-8" && d.bom ? "UTF-8-BOM" : d.encoding;
  $("#status").innerHTML =
    `<span class="s-lang">${langById(d.langId).name}</span>` +
    `<span>Länge: ${st.doc.length.toLocaleString("de-DE")} &nbsp;Zeilen: ${st.doc.lines.toLocaleString("de-DE")}</span>` +
    `<span>Z: ${line.number} &nbsp;Sp: ${sel.head - line.from + 1}${selLen ? ` &nbsp;Ausw: ${selLen}` : ""}</span>` +
    `<span class="s-eol" data-act="eol">${eolName}</span><span class="s-enc" data-act="enc">${enc}</span>`;
  $("#lang").value = d.langId;
}

function render() {
  syncSplit();
  renderTabs();
  renderStatus();
  document.querySelectorAll(".tb[data-flag]").forEach((b) => b.classList.toggle("on", !!settings[b.dataset.flag]));
  document.body.classList.toggle("nokeys", !settings.keys);
  document.body.classList.toggle("dark", isDark());
}

// ---------------------------------------------------------------- Einstellungen anwenden
function applySettings() {
  const effects = [cTheme.reconfigure(themeExt()), cWrap.reconfigure(wrapExt()), cWs.reconfigure(wsExt()),
    cFont.reconfigure(fontExt()), cBr.reconfigure(brExt())];
  for (const d of docs) {
    const pane = panes.find((p) => p.active === d);
    if (pane) pane.view.dispatch({ effects });
    else d.state = d.state.update({ effects }).state;
  }
  saveSettings();
  const bar = isDark() ? "#21252b" : "#f0f0f0";
  document.querySelector('meta[name="theme-color"]').content = bar;
  if (native && native.setTheme) native.setTheme(isDark(), bar);
  render();
}
function toggle(k) { settings[k] = !settings[k]; applySettings(); }
function zoom(dir) { settings.fontSize = Math.max(8, Math.min(32, settings.fontSize + dir)); applySettings(); }
function cycleTheme() {
  settings.theme = { auto: "light", light: "dark", dark: "auto" }[settings.theme];
  toast("Design: " + { auto: "System", light: "Hell", dark: "Dunkel" }[settings.theme]);
  applySettings();
}
darkMQ.addEventListener?.("change", () => settings.theme === "auto" && applySettings());

function setLang(d, id) {
  if (!d) return;
  d.langId = id;
  const eff = cLang.reconfigure(langSupport(id));
  const pane = panes.find((p) => p.active === d);
  if (pane) pane.view.dispatch({ effects: eff }); else d.state = d.state.update({ effects: eff }).state;
  render(); scheduleSession();
}

// ---------------------------------------------------------------- Bearbeiten-Befehle
function transformLines(fn) {
  const v = curView();
  const st = v.state;
  const sel = st.selection.main;
  let from = 0, to = st.doc.length;
  if (!sel.empty) { from = st.doc.lineAt(sel.from).from; to = st.doc.lineAt(sel.to).to; }
  const lines = st.sliceDoc(from, to).split("\n");
  const out = fn(lines).join("\n");
  v.dispatch({ changes: { from, to, insert: out } });
}
function transformSel(fn) {
  const v = curView();
  v.dispatch(v.state.changeByRange((r) => {
    const txt = fn(v.state.sliceDoc(r.from, r.to));
    return { changes: { from: r.from, to: r.to, insert: txt }, range: EditorSelection.range(r.from, r.from + txt.length) };
  }));
}

// ---------------------------------------------------------------- Menüs
function showMenu() {
  const d = activeDoc();
  const enc = d.encoding === "UTF-8" && d.bom ? "UTF-8-BOM" : d.encoding;
  const chk = (b) => (b ? "✓ " : "");
  openMenu([
    ["Datei"],
    ["Neu", newDoc, "Strg+N"], ["Öffnen …", openFile, "Strg+O"],
    ["Speichern", () => saveDoc(d), "Strg+S"], ["Speichern unter …", () => saveDocAs(d), "Strg+Umsch+S"],
    ["Alle speichern", saveAll], ["Schließen", () => closeDoc(d), "Strg+W"], ["Alle schließen", closeAll],
    ["Bearbeiten"],
    ["Alles markieren", () => selectAll(curView())],
    ["Nächstes Vorkommen markieren", () => selectNextOccurrence(curView())],
    ["Zeile duplizieren", () => copyLineDown(curView()), "Strg+D"],
    ["Zeile löschen", () => deleteLine(curView()), "Strg+L"],
    ["Kommentar umschalten", () => toggleComment(curView()), "Strg+Q"],
    ["Zeilen sortieren (aufsteigend)", () => transformLines((l) => l.sort((a, b) => a.localeCompare(b, "de")))],
    ["Zeilen sortieren (absteigend)", () => transformLines((l) => l.sort((a, b) => b.localeCompare(a, "de")))],
    ["Doppelte Zeilen entfernen", () => transformLines((l) => [...new Set(l)])],
    ["Leere Zeilen entfernen", () => transformLines((l) => l.filter((x) => x.trim() !== ""))],
    ["Leerzeichen am Zeilenende entfernen", () => transformLines((l) => l.map((x) => x.replace(/[ \t]+$/, "")))],
    ["Tabs → Leerzeichen", () => transformLines((l) => l.map((x) => x.replace(/\t/g, "    ")))],
    ["GROSSBUCHSTABEN", () => transformSel((s) => s.toUpperCase())],
    ["kleinbuchstaben", () => transformSel((s) => s.toLowerCase())],
    ["Zeilenende"],
    ...[["\r\n", "Windows (CR LF)"], ["\n", "Unix (LF)"], ["\r", "Mac (CR)"]].map(([e, n]) =>
      [chk(d.eol === e) + n, () => { d.eol = e; render(); scheduleSession(); markChanged(d); }]),
    ["Kodierung"],
    ...[["UTF-8", "UTF-8", false], ["UTF-8-BOM", "UTF-8-BOM", true], ["windows-1252", "ANSI (Windows-1252)", false],
      ["ISO-8859-1", "ISO-8859-1", false], ["UTF-16LE", "UTF-16 LE BOM", true], ["UTF-16BE", "UTF-16 BE BOM", true]]
      .map(([key, label, bom]) => [chk(enc === key || (key === "UTF-16LE" && enc === "UTF-16LE") ) + label, () => {
        d.encoding = key === "UTF-8-BOM" ? "UTF-8" : key; d.bom = bom; render(); scheduleSession(); markChanged(d);
      }]),
    ["Ansicht"],
    ...(isWide() ? [["In andere Ansicht verschieben", () => moveToOtherView(d)]] : []),
    [chk(settings.wrap) + "Zeilenumbruch", () => toggle("wrap")],
    [chk(settings.ws) + "Leerzeichen und Tabs anzeigen", () => toggle("ws")],
    [chk(settings.brackets) + "Klammern automatisch schließen", () => toggle("brackets")],
    [chk(settings.keys) + "Sondertasten-Leiste", () => toggle("keys")],
    ["Design: " + { auto: "System", light: "Hell", dark: "Dunkel" }[settings.theme], cycleTheme],
    ["?"],
    ...(appInfo.updates ? [["Nach Updates suchen", () => checkUpdate(true)],
      [chk(settings.autoUpd) + "Automatisch nach Updates suchen", () => toggle("autoUpd")]] : []),
    ["Über Npp Fold", () => confirmDialog(
      `Npp Fold ${appInfo.versionName}\nEditor im Stil von Notepad++ für Android,\noptimiert für das Galaxy Z Fold.\n\nBasierend auf CodeMirror 6 (MIT-Lizenz).\nNicht mit dem Notepad++-Projekt verbunden.`, [["OK", null]])],
  ]);
}
// Kodierung/Zeilenende geändert: Datei gilt als geändert (wie in Notepad++)
function markChanged(d) { d.saved = EditorState.create({ doc: "\u0000changed" }).doc; renderTabs(); }

function showTabMenu(d, e) {
  openMenu([
    ["Schließen", () => closeDoc(d)],
    ["Alle anderen schließen", () => docs.filter((x) => x !== d).forEach((x) => closeDoc(x))],
    ["Speichern", () => saveDoc(d)], ["Speichern unter …", () => saveDocAs(d)],
    ...(isWide() ? [["In andere Ansicht verschieben", () => moveToOtherView(d)]] : []),
    ["Dateinamen kopieren", () => navigator.clipboard?.writeText(d.name)],
  ], e.clientX, e.clientY);
}

function openMenu(items, x, y) {
  closeMenu();
  const m = document.createElement("div");
  m.id = "menu";
  if (items.length > 12) m.className = "big";
  let sec = m;
  for (const it of items) {
    if (it.length === 1) {
      sec = document.createElement("div"); sec.className = "sec"; m.appendChild(sec);
      sec.insertAdjacentHTML("beforeend", `<div class="mh">${it[0]}</div>`); continue;
    }
    const b = document.createElement("button");
    b.innerHTML = `<span></span>${it[2] ? `<kbd>${it[2].replace("*", "")}</kbd>` : ""}`;
    b.firstChild.textContent = it[0];
    b.addEventListener("click", () => { closeMenu(); it[1](); });
    sec.appendChild(b);
  }
  const back = document.createElement("div");
  back.id = "menuback";
  back.addEventListener("click", closeMenu);
  document.body.append(back, m);
  if (x != null) {
    m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + "px";
    m.style.right = "auto";
  }
}
function closeMenu() { $("#menu")?.remove(); $("#menuback")?.remove(); }

function confirmDialog(msg, buttons) {
  closeMenu();
  const back = document.createElement("div");
  back.id = "modal";
  back.innerHTML = `<div class="box"><p></p><div class="btns"></div></div>`;
  back.querySelector("p").textContent = msg;
  for (const [label, fn] of buttons) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => { back.remove(); fn && fn(); });
    back.querySelector(".btns").appendChild(b);
  }
  document.body.appendChild(back);
}
let toastT;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200);
}
window.nppBack = () => {
  if ($("#modal")) { $("#modal").remove(); return true; }
  if ($("#menu")) { closeMenu(); return true; }
  const v = curView();
  if (v.dom.querySelector(".cm-search")) { v.dom.querySelector(".cm-search [name=close]")?.click(); return true; }
  return false;
};

// ---------------------------------------------------------------- Sondertasten-Leiste
function buildKeys() {
  const keys = [
    ["⇥", (v) => indentMore(v)], ["⇤", (v) => indentLess(v)],
    ["◀", cursorCharLeft], ["▶", cursorCharRight], ["▲", cursorLineUp], ["▼", cursorLineDown],
    ["Pos1", cursorLineBoundaryBackward], ["Ende", cursorLineBoundaryForward],
    ..."{}()[]<>;:=\"'/\\|&!#$%_-+*,.?@~`^".split("").map((c) => [c, null]),
  ];
  const bar = $("#keys");
  for (const [label, cmd] of keys) {
    const b = document.createElement("button");
    b.textContent = label;
    if (label.length > 1 && !cmd) b.className = "w";
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    const run = () => {
      const v = curView();
      if (cmd) cmd(v);
      else v.dispatch(v.state.replaceSelection(label), { scrollIntoView: true, userEvent: "input.type" });
      v.focus();
    };
    b.addEventListener("touchend", (e) => { e.preventDefault(); run(); });
    b.addEventListener("click", run);
    bar.appendChild(b);
  }
}

// ---------------------------------------------------------------- Dateien (Android-Brücke oder Browser)
const pendingSaveAs = new Map();
let reqSeq = 1;

function openFile() {
  if (native) return native.openFile();
  const inp = document.createElement("input");
  inp.type = "file"; inp.multiple = true;
  inp.onchange = async () => {
    for (const f of inp.files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      const r = decodeBytes(buf);
      openText({ name: f.name, uri: null, ...r });
    }
  };
  inp.click();
}

function decodeBytes(b) {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(b.subarray(3)), encoding: "UTF-8", bom: true };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(b.subarray(2)), encoding: "UTF-16LE", bom: true };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(b.subarray(2)), encoding: "UTF-16BE", bom: true };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(b), encoding: "UTF-8", bom: false }; }
  catch { return { text: new TextDecoder("windows-1252").decode(b), encoding: "windows-1252", bom: false }; }
}

function openText({ name, uri, text, encoding, bom }) {
  const existing = uri && docs.find((d) => d.uri === uri);
  if (existing) { activate(existing); return toast("Bereits geöffnet"); }
  // Unveränderten, leeren "neu"-Tab ersetzen (wie Notepad++)
  const only = docs.length === 1 && !docs[0].uri && !isDirty(docs[0]) && stateOf(docs[0]).doc.length === 0 ? docs[0] : null;
  const d = createDoc({ name, uri, text, encoding, bom, view: splitActive() ? focusPane : 0 });
  if (only) { docs.splice(docs.indexOf(only), 1); for (const p of panes) if (p.active === only) p.active = null; }
  activate(d);
  scheduleSession();
}

// Rückrufe aus Java
window.nppNative = {
  opened(id) {
    const r = JSON.parse(native.take(id));
    if (r.error) return toast(r.error);
    openText(r);
  },
  savedAs(req, id) {
    const r = JSON.parse(native.take(id));
    const p = pendingSaveAs.get(req);
    pendingSaveAs.delete(req);
    if (!p) return;
    if (r.error) { toast(r.error); return p.resolve(false); }
    if (r.cancelled) return p.resolve(false);
    const d = p.doc;
    d.uri = r.uri; d.name = r.name;
    const nl = detectLang(d.name, "");
    if (d.langId === "text" && nl !== "text") setLang(d, nl);
    d.saved = stateOf(d).doc;
    toast("Gespeichert: " + d.name);
    render(); scheduleSession();
    p.resolve(true);
  },
};

async function saveDoc(d) {
  if (!d) return false;
  if (!d.uri) return saveDocAs(d);
  const text = textOf(d);
  const err = native.save(d.uri, text, d.encoding, d.bom);
  if (err) { toast(err); return saveDocAs(d); }
  d.saved = stateOf(d).doc;
  toast("Gespeichert: " + d.name);
  render(); scheduleSession();
  return true;
}

function saveDocAs(d) {
  if (!d) return Promise.resolve(false);
  const text = textOf(d);
  if (!native) {
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = /\./.test(d.name) ? d.name : d.name + ".txt"; a.click();
    d.saved = stateOf(d).doc; render();
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const req = String(reqSeq++);
    pendingSaveAs.set(req, { doc: d, resolve });
    let name = d.name;
    if (!/\./.test(name)) name += "." + (langById(d.langId).ext[0] || "txt");
    native.saveAs(req, name, text, d.encoding, d.bom);
  });
}

async function saveAll() {
  for (const d of [...docs]) { syncState(d); if (isDirty(d)) if (!(await saveDoc(d))) return; }
}
function closeAll() {
  const dirty = docs.filter((d) => (syncState(d), isDirty(d)));
  const doIt = () => { docs = []; panes.forEach((p) => (p.active = null)); newCount = 1; createDoc({ name: "neu " + newCount++ }); ensureActive(); render(); scheduleSession(); };
  if (dirty.length) confirmDialog(`${dirty.length} Datei(en) mit ungespeicherten Änderungen. Trotzdem alle schließen?`, [["Alle schließen", doIt], ["Abbrechen", null]]);
  else doIt();
}

// ---------------------------------------------------------------- Updates
let appInfo = { versionName: "1.0", versionCode: 0, updates: false };
try { if (native && native.appInfo) appInfo = JSON.parse(native.appInfo()); } catch {}
let manualCheck = false;

function checkUpdate(manual) {
  if (!native || !appInfo.updates) return;
  manualCheck = manual;
  if (manual) toast("Suche nach Updates …");
  try { localStorage.setItem("npp.updCheck", String(Date.now())); } catch {}
  native.checkUpdate();
}
function autoCheckUpdate() {
  if (!settings.autoUpd) return;
  let last = 0;
  try { last = +localStorage.getItem("npp.updCheck") || 0; } catch {}
  if (Date.now() - last > 6 * 3600 * 1000) setTimeout(() => checkUpdate(false), 3000);
}
function updBar(text, pct) {
  let el = $("#upd");
  if (!el) { el = document.createElement("div"); el.id = "upd"; el.innerHTML = "<span></span><i><b></b></i>"; document.body.appendChild(el); }
  el.querySelector("span").textContent = text;
  el.querySelector("b").style.width = (pct < 0 ? 100 : pct) + "%";
  el.classList.toggle("indet", pct < 0);
}
function startUpdate(r) {
  saveSession();
  updBar("Update wird geladen …", 0);
  native.installUpdate();
}
Object.assign(window.nppNative, {
  updChecked(id) {
    const r = JSON.parse(native.take(id));
    if (r.error) { if (manualCheck) confirmDialog("Update-Prüfung fehlgeschlagen:\n" + r.error, [["OK", null]]); return; }
    let skipped = 0;
    try { skipped = +localStorage.getItem("npp.updSkip") || 0; } catch {}
    if (!r.available) { if (manualCheck) toast(`Du hast die neueste Version (${r.current})`); return; }
    if (!manualCheck && r.versionCode === skipped) return;
    confirmDialog(`Update verfügbar: Version ${r.versionName}\n(installiert: ${r.current})` + (r.notes ? `\n\nNeu:\n${r.notes}` : "") +
      "\n\nDie App schließt sich nach der Installation. Offene Dateien bleiben erhalten.",
      [["Jetzt aktualisieren", () => startUpdate(r)], ["Später", null],
       ["Diese Version überspringen", () => { try { localStorage.setItem("npp.updSkip", String(r.versionCode)); } catch {} }]]);
  },
  updProgress(pct) { updBar(pct >= 100 ? "Wird installiert …" : pct < 0 ? "Update wird geladen …" : `Update wird geladen … ${pct} %`, pct); },
  updMessage(msg) { $("#upd")?.remove(); toast(msg); },
  updFailed(msg) { $("#upd")?.remove(); confirmDialog("Update fehlgeschlagen:\n" + msg, [["OK", null]]); },
});

// ---------------------------------------------------------------- Sitzung (wie Notepad++: alles bleibt offen)
let sessT;
function scheduleSession() { clearTimeout(sessT); sessT = setTimeout(saveSession, 800); }
function saveSession() {
  clearTimeout(sessT);
  try {
    for (const p of panes) if (p.active) syncState(p.active);
    const data = {
      newCount,
      active: [panes[0].active?.id, panes[1].active?.id], focus: focusPane,
      docs: docs.map((d) => {
        const text = d.state.doc.toString();
        return { id: d.id, name: d.name, uri: d.uri, encoding: d.encoding, bom: d.bom, eol: d.eol, lang: d.langId, view: d.view,
          text, saved: isDirty(d) ? d.saved.toString() : null, sel: d.state.selection.main.head };
      }),
    };
    localStorage.setItem("npp.session", JSON.stringify(data));
  } catch (e) { console.warn("Sitzung nicht gespeichert", e); }
}
window.nppSaveSession = saveSession;
document.addEventListener("visibilitychange", () => document.hidden && saveSession());

function restoreSession() {
  let data;
  try { data = JSON.parse(localStorage.getItem("npp.session") || "null"); } catch {}
  if (!data || !data.docs?.length) { createDoc({ name: "neu " + newCount++ }); return; }
  newCount = data.newCount || 1;
  const map = {};
  for (const s of data.docs) {
    const d = createDoc({ name: s.name, uri: s.uri, text: s.text, encoding: s.encoding, bom: s.bom, eol: s.eol, lang: s.lang, view: s.view || 0 });
    if (s.saved != null) d.saved = EditorState.create({ doc: s.saved }).doc;
    const pos = Math.min(s.sel || 0, d.state.doc.length);
    d.state = d.state.update({ selection: { anchor: pos }, scrollIntoView: true }).state;
    map[s.id] = d;
  }
  wasSplit = splitActive();
  [0, 1].forEach((p) => { const d = map[data.active?.[p]]; if (d && (p === 0 || wasSplit)) { panes[p].active = d; panes[p].view.setState(d.state); } });
  focusPane = data.focus === 1 && wasSplit ? 1 : 0;
}

// ---------------------------------------------------------------- Start
function init() {
  for (const [i, p] of panes.entries()) {
    p.view = new EditorView({ state: makeState("", "text"), parent: p.el.querySelector(".host") });
    p.el.addEventListener("focusin", () => { if (focusPane !== i) { focusPane = i; render(); } });
    p.el.addEventListener("pointerdown", () => { if (focusPane !== i && p.active) { focusPane = i; render(); } });
  }
  buildToolbar();
  buildKeys();
  restoreSession();
  ensureActive();
  layout();
  applySettings();
  $("#status").addEventListener("click", (e) => { if (e.target.dataset.act) showMenu(); });
  if (native && native.ready) native.ready();
  autoCheckUpdate();
}
init();
