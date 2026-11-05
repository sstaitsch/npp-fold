// Sprachen für die Syntaxhervorhebung (alles offline gebündelt)
import { StreamLanguage, LanguageSupport } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { php } from "@codemirror/lang-php";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { vbScript } from "@codemirror/legacy-modes/mode/vbscript";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { r } from "@codemirror/legacy-modes/mode/r";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { vhdl } from "@codemirror/legacy-modes/mode/vhdl";
import { verilog } from "@codemirror/legacy-modes/mode/verilog";
import { tcl } from "@codemirror/legacy-modes/mode/tcl";
import { gas } from "@codemirror/legacy-modes/mode/gas";
import { csharp, kotlin, dart, scala, objectiveC } from "@codemirror/legacy-modes/mode/clike";

const S = (m) => () => new LanguageSupport(StreamLanguage.define(m));

// --- Windows-Batch (.bat/.cmd), wie in Notepad++ vorhanden ---
const batch = {
  name: "batch",
  startState: () => ({}),
  token(stream) {
    if (stream.sol()) {
      stream.eatSpace();
      if (stream.match(/^(rem\b|::)/i)) { stream.skipToEnd(); return "comment"; }
      if (stream.match(/^:\w+/)) return "labelName";
      if (stream.peek() === "@") { stream.next(); return "operator"; }
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^%~?[\w]|^%[\w]+%|^!\w+!|^%%\w/)) return "variableName";
    if (stream.match(/^"[^"]*"?/)) return "string";
    if (stream.match(/^(echo|set|if|else|for|in|do|goto|call|exit|setlocal|endlocal|not|exist|defined|errorlevel|equ|neq|lss|leq|gtr|geq|start|cd|pushd|popd|shift|pause|cls|copy|move|del|mkdir|md|rmdir|rd|type|title|choice|timeout|xcopy|robocopy)\b/i)) return "keyword";
    if (stream.match(/^\d+/)) return "number";
    if (stream.match(/^[|&<>=()]+/)) return "operator";
    stream.next(); return null;
  },
};

// --- Yaskawa INFORM (.JBI) für YRC1000/DX200-Jobs ---
const INFORM_KW = new Set(("NOP END MOVJ MOVL MOVC MOVS IMOV SPEED REFP CALL JUMP RET IF ELSE ELSEIF ENDIF " +
  "WHILE ENDWHILE FOR NEXT SWITCH CASE DEFAULT ENDSWITCH TIMER WAIT UNTIL PAUSE CWAIT MSG INPUT DOUT DIN AOUT " +
  "PULSE OUT IN SET SETE GETE GETS CLEAR INC DEC ADD SUB MUL DIV AND OR NOT XOR CNVRT SIN COS ATAN SQRT " +
  "MFRAME SFTON SFTOF MSHIFT ARCON ARCOF ARCSET TOOLON TOOLOF SVSPOTMOV SPOT GUNCL STRSTJOB ADVINIT ADVSTOP " +
  "SETREG GETREG LABEL LAB COMMENT PSTART PWAIT TSYNC SYNC GETPOS CKPOS SETTOOL PREFETCH COMSET").split(" "));
const inform = {
  name: "inform",
  startState: () => ({}),
  token(stream) {
    if (stream.sol() && stream.peek() === "/") { stream.skipToEnd(); return "meta"; }
    if (stream.sol() && stream.match(/^[CP]\d{5}=/)) { stream.skipToEnd(); return "number"; }
    if (stream.eatSpace()) return null;
    const ch = stream.peek();
    if (ch === "'") { stream.skipToEnd(); return "comment"; }
    if (ch === '"') { stream.next(); stream.skipTo('"') ? stream.next() : stream.skipToEnd(); return "string"; }
    if (ch === "*") { stream.match(/^\*\S+/); return "labelName"; }
    if (stream.match(/^(?:JOB|LABEL):\S+/)) return "labelName";
    if (stream.match(/^(?:LB|LI|LD|LR|LS|LP|LBP|LEX|BP|EX|[BIDRSPC])\[?\d+\]?/)) return "variableName";
    if (stream.match(/^(?:IN|OT|OG|IG|IGH|OGH|SIN|SOUT)#\(\d+\)/)) return "variableName.special";
    if (stream.match(/^[A-Z]+=/)) { stream.backUp(1); return "propertyName"; }
    if (stream.match(/^-?\d+(?:\.\d+)?/)) return "number";
    if (stream.match(/^[A-Z][A-Z0-9_]*/)) {
      return INFORM_KW.has(stream.current()) ? "keyword" : null;
    }
    if (stream.match(/^[=<>!+\-*/]+/)) return "operator";
    stream.next(); return null;
  },
};

export const LANGS = [
  { id: "text", name: "Normaler Text", ext: ["txt", "log", "text"], load: null },
  { id: "batch", name: "Batch", ext: ["bat", "cmd"], load: S(batch) },
  { id: "c", name: "C", ext: ["c", "h"], load: () => cpp() },
  { id: "cpp", name: "C++", ext: ["cpp", "cc", "cxx", "hpp", "hh", "hxx", "ino"], load: () => cpp() },
  { id: "csharp", name: "C#", ext: ["cs"], load: S(csharp) },
  { id: "cmake", name: "CMake", ext: ["cmake"], load: S(cmake) },
  { id: "css", name: "CSS", ext: ["css", "scss", "less"], load: () => css() },
  { id: "dart", name: "Dart", ext: ["dart"], load: S(dart) },
  { id: "diff", name: "Diff", ext: ["diff", "patch"], load: S(diff) },
  { id: "docker", name: "Dockerfile", ext: ["dockerfile"], load: S(dockerFile) },
  { id: "fortran", name: "Fortran", ext: ["f", "f90", "f95", "for"], load: S(fortran) },
  { id: "go", name: "Go", ext: ["go"], load: () => go() },
  { id: "html", name: "HTML", ext: ["html", "htm", "xhtml"], load: () => html() },
  { id: "ini", name: "INI / Properties", ext: ["ini", "cfg", "conf", "properties", "inf", "reg", "env"], load: S(properties) },
  { id: "inform", name: "INFORM (Yaskawa JBI)", ext: ["jbi", "jbr"], load: S(inform) },
  { id: "java", name: "Java", ext: ["java"], load: () => java() },
  { id: "js", name: "JavaScript", ext: ["js", "mjs", "cjs", "jsx"], load: () => javascript({ jsx: true }) },
  { id: "ts", name: "TypeScript", ext: ["ts", "tsx"], load: () => javascript({ typescript: true, jsx: true }) },
  { id: "json", name: "JSON", ext: ["json", "jsonc", "geojson"], load: () => json() },
  { id: "kotlin", name: "Kotlin", ext: ["kt", "kts"], load: S(kotlin) },
  { id: "lua", name: "Lua", ext: ["lua"], load: S(lua) },
  { id: "markdown", name: "Markdown", ext: ["md", "markdown"], load: () => markdown() },
  { id: "nginx", name: "Nginx", ext: ["nginx"], load: S(nginx) },
  { id: "objc", name: "Objective-C", ext: ["m", "mm"], load: S(objectiveC) },
  { id: "pascal", name: "Pascal / ST", ext: ["pas", "pp", "st", "scl"], load: S(pascal) },
  { id: "perl", name: "Perl", ext: ["pl", "pm"], load: S(perl) },
  { id: "php", name: "PHP", ext: ["php", "phtml"], load: () => php() },
  { id: "powershell", name: "PowerShell", ext: ["ps1", "psm1", "psd1"], load: S(powerShell) },
  { id: "python", name: "Python", ext: ["py", "pyw", "pyi"], load: () => python() },
  { id: "r", name: "R", ext: ["r"], load: S(r) },
  { id: "ruby", name: "Ruby", ext: ["rb"], load: S(ruby) },
  { id: "rust", name: "Rust", ext: ["rs"], load: () => rust() },
  { id: "scala", name: "Scala", ext: ["scala"], load: S(scala) },
  { id: "shell", name: "Shell (Bash)", ext: ["sh", "bash", "zsh"], load: S(shell) },
  { id: "sql", name: "SQL", ext: ["sql"], load: () => sql() },
  { id: "swift", name: "Swift", ext: ["swift"], load: S(swift) },
  { id: "tcl", name: "Tcl", ext: ["tcl"], load: S(tcl) },
  { id: "toml", name: "TOML", ext: ["toml"], load: S(toml) },
  { id: "vb", name: "Visual Basic", ext: ["vb", "bas", "cls", "frm"], load: S(vb) },
  { id: "vbs", name: "VBScript", ext: ["vbs"], load: S(vbScript) },
  { id: "verilog", name: "Verilog", ext: ["v", "sv", "svh"], load: S(verilog) },
  { id: "vhdl", name: "VHDL", ext: ["vhd", "vhdl"], load: S(vhdl) },
  { id: "asm", name: "Assembler", ext: ["asm", "s"], load: S(gas) },
  { id: "xml", name: "XML", ext: ["xml", "xsd", "xsl", "xslt", "svg", "plist", "csproj", "xaml", "arxml"], load: () => xml() },
  { id: "yaml", name: "YAML", ext: ["yaml", "yml"], load: () => yaml() },
];

const byId = new Map(LANGS.map((l) => [l.id, l]));
const cache = new Map();
export function langById(id) { return byId.get(id) || byId.get("text"); }
export function langSupport(id) {
  const l = langById(id);
  if (!l.load) return [];
  if (!cache.has(id)) cache.set(id, l.load());
  return cache.get(id);
}
export function detectLang(name, text) {
  const lower = (name || "").toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "docker";
  if (lower === "makefile" || lower === "cmakelists.txt") return "cmake";
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  for (const l of LANGS) if (l.ext.includes(ext)) return l.id;
  const first = (text || "").slice(0, 200);
  if (/^#!.*\b(ba|z)?sh\b/.test(first)) return "shell";
  if (/^#!.*python/.test(first)) return "python";
  if (/^<\?xml/.test(first)) return "xml";
  if (/^\/JOB\b/.test(first)) return "inform";
  return "text";
}
