// Lightweight syntax colors for the displayed text. The diff can begin in the middle
// of a file, so a token is recognized only from text on that line.
const SLASH = String.raw`\/\/.*|\/\*.*?(?:\*\/|$)`;
const HASH = "#.*";
const MARKUP = "<!--.*?(?:-->|$)";
const STRING = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'` + '|`(?:\\\\.|[^`\\\\])*`';
const NUMBER = String.raw`\b(?:0[xob][0-9a-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d[\d_]*)?)\b`;
const IDENTIFIER = "[a-z_][a-z0-9_]*";
const COMMON = "as break case catch class const continue default do else enum export extends false finally for foreach from function if import in let new null private public return static super switch this throw true try type undefined var void while yield";

function grammar(comments, keywords) {
  return {
    pattern: new RegExp("(" + comments + ")|(" + STRING + ")|(" + NUMBER + ")|(" + IDENTIFIER + ")", "gi"),
    words: new Set(keywords.split(" ")),
  };
}

const slash = grammar(SLASH, COMMON + " async await interface implements instanceof of readonly require use namespace struct fn func go defer mut pub use match impl self");
const php = grammar(SLASH + "|#(?!\\[).*", COMMON + " abstract array echo endif final isset namespace null parent self unset use");
const hash = grammar(HASH, COMMON + " and async await def elif end except fi lambda None not or pass print raise require then with");
const css = grammar(String.raw`\/\*.*?(?:\*\/|$)`, "important inherit initial revert unset");
const data = grammar(HASH, "true false null yes no");
const json = grammar(SLASH, "true false null");
const markup = grammar(MARKUP, "");
const sql = grammar(String.raw`--.*|\/\*.*?(?:\*\/|$)`, "alter and as by create delete distinct drop exists from group insert into join limit not null on order select table union update values where");

const suffixes = new Map();
for (const [kind, endings] of [
  [slash, "js jsx ts tsx mjs cjs mts cts java kt cs go rs c cc cpp h hpp swift dart vue svelte"],
  [php, "php phtml"], [hash, "py rb sh bash zsh fish pl"], [css, "css scss less"],
  [data, "yml yaml toml ini"], [json, "json jsonc"], [markup, "html htm xml svg"], [sql, "sql"],
]) {
  for (const ending of endings.split(" ")) suffixes.set(ending, kind);
}

export function language(path) {
  return suffixes.get(path.split(".").pop().toLowerCase()) ?? null;
}

export function spans(text, kind) {
  const result = [];
  for (const match of text.matchAll(kind.pattern)) {
    const tone = match[1] ? "comment" : match[2] ? "string" : match[3] ? "number"
      : kind.words.has(match[0]) || (kind === sql && kind.words.has(match[0].toLowerCase())) ? "keyword" : null;
    if (tone) result.push({ start: match.index, end: match.index + match[0].length, tone });
  }
  return result;
}

// Overlay token colors and word-change marks without losing any spaces.
export function colorPieces(text, marks, colors) {
  if (!colors.length && !marks?.length) return null;
  const boundaries = new Set([0, text.length]);
  for (const [start, end] of marks ?? []) { boundaries.add(start); boundaries.add(end); }
  for (const { start, end } of colors) { boundaries.add(start); boundaries.add(end); }
  const cuts = Array.from(boundaries).sort((a, b) => a - b);
  let color = 0, mark = 0;
  const out = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i], end = cuts[i + 1];
    while (colors[color]?.end <= start) color++;
    while (marks?.[mark]?.[1] <= start) mark++;
    out.push({
      text: text.slice(start, end),
      tone: colors[color]?.start <= start ? colors[color].tone : null,
      marked: marks?.[mark]?.[0] <= start,
    });
  }
  return out;
}
