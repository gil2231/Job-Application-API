/**
 * Answers to fields with fixed choices (dropdowns, radios, checkboxes): an
 * answer only helps if it is one of the choices, or the form can't take it.
 */

const PLACEHOLDER = /^(select|choose|please select|please choose|--|—|-|none selected|pick one)\b/i;

/** Options a person would never mean to pick (the "Select…" prompt). */
export function isPlaceholderOption(option: string): boolean {
  return option.trim() === "" || PLACEHOLDER.test(option.trim());
}

/** A list read with this many choices was cut short (Greenhouse shows its first 100 schools); its answer is searched for instead. */
export const SEARCHABLE_LIST_MIN = 100;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The parts of an answer to a group of checkboxes: the choices it names, in the
 * form's order, then any other pieces. Choices can contain commas ("By clicking
 * this box and submitting your application, you consent to…"), so whole choices
 * are found first and only the rest is split on commas.
 */
export function answerParts(value: string, options: readonly string[]): string[] {
  let rest = value;
  const named = new Set<string>();
  for (const option of options.filter((o) => o.trim()).sort((a, b) => b.length - a.length)) {
    const at = new RegExp(`(^|[,;\\n])\\s*${escape(option.trim())}\\s*(?=[,;\\n]|$)`).exec(rest);
    if (!at) continue;
    named.add(option);
    rest = rest.slice(0, at.index) + at[1] + rest.slice(at.index + at[0].length);
  }
  const others = rest.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  return [...options.filter((o) => named.has(o)), ...others];
}

/**
 * Whether an answer can go into a field with these choices: one of them, each
 * of them for a group of checkboxes, Yes or No for a lone checkbox. Fields
 * without choices, and lists too long to have been read in full, take any answer.
 */
export function answerFitsChoices(fieldType: string, options: readonly string[], value: string): boolean {
  const choices = options.filter((o) => !isPlaceholderOption(o));
  const answer = value.trim();
  if (fieldType === "CHECKBOX") {
    if (choices.length < 2) return /^(yes|no)$/i.test(answer);
    const parts = answerParts(answer, choices);
    return parts.length > 0 && parts.every((s) => choices.includes(s));
  }
  if (fieldType !== "SELECT" && fieldType !== "RADIO") return true;
  if (!choices.length || choices.length >= SEARCHABLE_LIST_MIN) return true;
  return choices.includes(answer);
}
