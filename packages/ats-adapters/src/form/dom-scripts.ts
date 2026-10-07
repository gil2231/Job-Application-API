/**
 * Scripts evaluated inside the application page. They only read the DOM
 * (no clicks, no typing, no attribute changes) and are kept as plain strings so
 * the Node bundler can't inject helpers the page doesn't have.
 *
 * They look inside open shadow roots too, since some ATSs (SmartRecruiters)
 * build their forms from web components.
 */

/** Per-platform knobs for the field scan. */
export interface ScanOptions {
  /** Only look for fields inside the first element matching one of these selectors (the whole page when none match). */
  roots?: string[];
  /** When none of `roots` is on the page there is no form yet (Workday's job page has its own search fields). */
  rootRequired?: boolean;
  /** Extra elements whose text labels a radio, checkbox or button group (e.g. Lever's `.application-label`). */
  groupLabelSelectors?: string[];
  /** Fields to leave alone, such as a "fill the form from my resume" upload. Matches the field or an ancestor. */
  ignore?: string[];
  /** Containers of buttons that act as a single choice (Ashby's Yes/No buttons). */
  buttonGroups?: string[];
}

/** Shared helpers: visibility, label text, required markers, a stable CSS path, shadow DOM traversal. */
const HELPERS = String.raw`
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const parentOf = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
  /** querySelectorAll that also looks inside open shadow roots. */
  const deepAll = (root, selector) => {
    const out = Array.from(root.querySelectorAll(selector));
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) out.push(...deepAll(el.shadowRoot, selector));
    return out;
  };
  const deepText = (root) => {
    let text = root.innerText || root.textContent || "";
    for (const el of root.querySelectorAll ? root.querySelectorAll("*") : []) if (el.shadowRoot) text += " " + deepText(el.shadowRoot);
    return text;
  };
  const hiddenByAncestor = (el) => {
    let node = el;
    while (node) {
      if (node.hidden || (node.getAttribute && node.getAttribute("aria-hidden") === "true")) return true;
      node = parentOf(node);
    }
    return false;
  };
  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      // Native radios/checkboxes are often visually replaced; fall back to their label.
      const lab = el.labels && el.labels[0];
      return !!lab && visible(lab);
    }
    // Pushed off the page (left: -9999px), not merely scrolled out of view.
    if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0) return false;
    return !hiddenByAncestor(el);
  };
  const textWithout = (container) => {
    const clone = container.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button, script, style, option, [role=listbox], .sr-only-ignore").forEach((n) => n.remove());
    return clean(clone.textContent);
  };
  const byIds = (ids, from) => {
    const root = from && from.getRootNode ? from.getRootNode() : document;
    const find = (id) => (root.getElementById ? root.getElementById(id) : null) || document.getElementById(id);
    return clean((ids || "").split(/\s+/).map((id) => { const n = id && find(id); return n ? n.textContent : ""; }).join(" "));
  };
  const labelOf = (el) => {
    if (el.id) {
      const root = el.getRootNode();
      const l = (root.querySelector ? root.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null) || document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && clean(l.textContent)) return { text: textWithout(l), via: "label" };
    }
    const wrap = el.closest("label");
    if (wrap && textWithout(wrap)) return { text: textWithout(wrap), via: "label" };
    const ariaBy = el.getAttribute("aria-labelledby");
    if (ariaBy && byIds(ariaBy, el)) return { text: byIds(ariaBy, el), via: "aria" };
    const aria = el.getAttribute("aria-label");
    if (aria && clean(aria)) return { text: clean(aria), via: "aria" };
    return null;
  };
  const GROUP_LABELS = [":scope > p", ":scope > span", ":scope > div.label", ":scope > h3", ":scope > h4", ":scope > .question", ":scope > .field-label", ":scope > legend"];
  const PLATFORM_GROUP_LABELS = (OPTIONS.groupLabelSelectors || []).map((s) => ":scope > " + s);
  const groupLabelOf = (el) => {
    const fieldset = el.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend && clean(legend.textContent)) return { text: clean(legend.textContent), via: "label" };
    }
    const group = el.matches('[role="radiogroup"], [role="group"]') ? el : el.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const by = group.getAttribute("aria-labelledby");
      if (by && byIds(by, group)) return { text: byIds(by, group), via: "aria" };
      const al = group.getAttribute("aria-label");
      if (al) return { text: clean(al), via: "aria" };
    }
    // DOM relationship: the nearest container whose own text (minus the options) reads like a question.
    // Start above the option's own label so its text ("Yes") isn't taken for the question.
    const start = (el.closest("label") || el).parentElement;
    for (const selectors of [PLATFORM_GROUP_LABELS, GROUP_LABELS]) {
      let node = start;
      for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        for (const sel of selectors) {
          const heading = node.querySelector(sel);
          if (heading && !heading.querySelector("input, button") && clean(heading.textContent)) return { text: clean(heading.textContent), via: "dom" };
        }
      }
    }
    return null;
  };
  const cssPathIn = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && !/\d{4,}/.test(node.id)) { parts.unshift("#" + node.id); break; }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      const siblings = parent ? Array.from(parent.children) : node.parentNode ? Array.from(node.parentNode.children) : [];
      const same = siblings.filter((c) => c.tagName === node.tagName);
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  /** A CSS path Playwright can follow, crossing into shadow roots with ">>". */
  const cssPath = (el) => {
    const root = el.getRootNode();
    const inner = cssPathIn(el);
    return root && root.host ? cssPath(root.host) + " >> " + inner : inner;
  };
  const REQUIRED_MARK = /(\*|✱|\(required\))\s*$/i;
  const isRequired = (el, label) => el.required || el.getAttribute("aria-required") === "true" || REQUIRED_MARK.test(label || "");
  const ignored = (el) => (OPTIONS.ignore || []).some((s) => { try { return !!el.closest(s); } catch (e) { return false; } });
`;

const withOptions = (body: string, options: ScanOptions) => String.raw`(() => {
  const OPTIONS = ${JSON.stringify(options)};
  ${HELPERS}
  ${body}
})()`;

const SCAN_FIELDS_BODY = String.raw`
  let root = document;
  let rootFound = false;
  for (const sel of OPTIONS.roots || []) { const r = deepAll(document, sel)[0]; if (r) { root = r; rootFound = true; break; } }
  if (OPTIONS.rootRequired && (OPTIONS.roots || []).length && !rootFound) return [];
  const out = [];
  const groups = new Map();
  const base = (el, type) => ({
    name: el.getAttribute("name") || "",
    id: el.id || "",
    placeholder: el.getAttribute("placeholder") || "",
    autocomplete: el.getAttribute("autocomplete") || "",
    inputType: type,
    accept: el.getAttribute("accept") || "",
    ariaLabel: el.getAttribute("aria-label") || "",
    domPath: cssPath(el),
  });
  const listboxOptions = (el) => {
    const ids = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    if (!ids) return undefined;
    const lb = ids.split(/\s+/).map((id) => document.getElementById(id) || el.getRootNode().getElementById?.(id)).find(Boolean);
    if (!lb) return undefined;
    const opts = Array.from(lb.querySelectorAll('[role="option"]')).map((o) => clean(o.textContent)).filter(Boolean);
    return opts.length ? opts : undefined;
  };

  // Custom dropdowns: react-select style comboboxes and Workday style listbox buttons.
  const customs = deepAll(root, 'input[role="combobox"], [role="combobox"]:not(input):not(:has(input)), button[aria-haspopup="listbox"]');
  const customSet = new Set(customs);
  for (const el of customs) {
    if (ignored(el) || el.disabled || el.getAttribute("aria-disabled") === "true" || !visible(el)) continue;
    const isButton = el.tagName === "BUTTON";
    const lab = labelOf(el);
    const label = lab ? lab.text : clean(el.getAttribute("placeholder")) || clean(el.getAttribute("name"));
    out.push({ ...base(el, isButton ? "button" : "text"), kind: "select", widget: isButton ? "listbox" : "combobox", label, labelVia: lab ? lab.via : "none", required: isRequired(el, label), options: listboxOptions(el), multiple: false });
  }

  // Groups of buttons that act as one choice (Yes / No).
  const selectors = (OPTIONS.buttonGroups || []).concat(['[role="radiogroup"]:not(:has(input))', '[role="group"]:has(> button[aria-pressed])']);
  const seenGroups = new Set();
  for (const container of deepAll(root, selectors.join(", "))) {
    if (seenGroups.has(container) || ignored(container) || !visible(container)) continue;
    seenGroups.add(container);
    const buttons = Array.from(container.querySelectorAll('button, [role="radio"]')).filter(visible);
    if (buttons.length < 2) continue;
    const lab = groupLabelOf(container);
    const label = lab ? lab.text : "";
    out.push({ ...base(container, "buttons"), id: "", kind: "radio", widget: "buttons", label, labelVia: lab ? lab.via : "none", required: container.getAttribute("aria-required") === "true" || REQUIRED_MARK.test(label), options: buttons.map((b) => clean(b.textContent)), multiple: false });
  }

  for (const el of deepAll(root, "input, select, textarea")) {
    if (customSet.has(el) || ignored(el)) continue;
    const type = (el.getAttribute("type") || (el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : "text")).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "search", "password"].includes(type)) continue;
    if (el.disabled || el.readOnly && type !== "file") continue;
    if (type === "file") {
      // Upload inputs are usually visually hidden behind an "Attach" button; their label or container is what shows.
      const lab = el.labels && el.labels[0];
      const by = el.getAttribute("aria-labelledby");
      const byEl = by ? by.split(/\s+/).map((id) => el.getRootNode().getElementById?.(id) || document.getElementById(id)).find(Boolean) : null;
      const shown = visible(el) || (lab && visible(lab)) || (byEl && visible(byEl)) || (!hiddenByAncestor(el) && el.parentElement && visible(el.parentElement));
      if (!shown) continue;
    } else if (!visible(el)) continue;
    const b = base(el, type);
    if (type === "radio" || type === "checkbox") {
      const key = type + ":" + (b.name || b.domPath);
      const own = labelOf(el);
      const optionLabel = own ? own.text : clean(el.value);
      if (!groups.has(key)) groups.set(key, { type, members: [], first: el, base: b });
      groups.get(key).members.push({ label: optionLabel, value: el.value, required: el.required || el.getAttribute("aria-required") === "true", checked: el.checked });
      continue;
    }
    const lab = labelOf(el);
    const label = lab ? lab.text : clean(b.placeholder) || clean(b.name);
    let options;
    if (el.tagName === "SELECT") options = Array.from(el.options).map((o) => clean(o.textContent));
    out.push({ ...b, kind: type, widget: "native", label, labelVia: lab ? lab.via : "none", required: isRequired(el, label), options, multiple: el.tagName === "SELECT" ? el.multiple : false });
  }
  for (const g of groups.values()) {
    const single = g.type === "checkbox" && g.members.length === 1;
    if (single) {
      const lab = labelOf(g.first);
      const label = lab ? lab.text : clean(g.base.name);
      out.push({ ...g.base, kind: "checkbox", widget: "native", label, labelVia: lab ? lab.via : "none", required: isRequired(g.first, label), options: undefined, multiple: false });
      continue;
    }
    const lab = groupLabelOf(g.first);
    const label = lab ? lab.text : clean(g.base.name);
    out.push({
      ...g.base,
      id: "",
      kind: g.type,
      widget: "native",
      label,
      labelVia: lab ? lab.via : "none",
      required: g.members.some((m) => m.required) || REQUIRED_MARK.test(label),
      options: g.members.map((m) => m.label),
      optionValues: g.members.map((m) => m.value),
      multiple: g.type === "checkbox",
    });
  }
  return out;`;

/**
 * Returns every visible, enabled form field on the page as plain data. Radio
 * buttons and same-name checkboxes are grouped into one field with options.
 * Custom dropdowns (comboboxes and listbox buttons) and button groups are
 * reported as dropdowns and radios with a `widget` saying how to operate them.
 */
export function scanFieldsScript(options: ScanOptions = {}): string {
  return withOptions(SCAN_FIELDS_BODY, options);
}

/** Visible security checks (CAPTCHA widgets, sign-in and verification-code forms). Read-only. */
const SECURITY_BODY = String.raw`
  const captchaSelectors = [".g-recaptcha", ".h-captcha", ".cf-turnstile", "[data-sitekey]", "#captcha", "[data-captcha]", ".captcha", "#px-captcha", ".arkose"];
  // Google's invisible reCAPTCHA only shows a corner badge and scores the submission in the background; it isn't a challenge to solve.
  const badges = deepAll(document, ".grecaptcha-badge");
  const scoreOnly = (el) => {
    for (let node = el; node; node = parentOf(node)) {
      if (node.classList && node.classList.contains("grecaptcha-badge")) return true;
      if (node.getAttribute && node.getAttribute("data-size") === "invisible") return true;
    }
    return el.tagName === "IFRAME" && /[?&]size=invisible\b/.test(el.src || "");
  };
  const frames = deepAll(document, "iframe").filter((f) => visible(f) && !scoreOnly(f) && /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|captcha/i.test(f.src || f.title || ""));
  const widgets = captchaSelectors.flatMap((s) => deepAll(document, s)).filter((w) => visible(w) && !scoreOnly(w));
  const bodyText = clean(document.body ? deepText(document.body) : "").slice(0, 20000);
  const captchaText = /verify (that )?you('re| are) (a )?human|are you a robot|i'?m not a robot|complete the security check/i.test(bodyText);
  const otp = deepAll(document, 'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="verification" i], input[id*="otp" i]').filter(visible);
  const otpText = /(verification|security|one[- ]time|authentication) code|two[- ]factor|2fa|authenticator app/i.test(bodyText);
  const password = deepAll(document, 'input[type="password"]').filter(visible);
  const signInText = /sign in|log in|login|create (an )?account|create password/i.test(bodyText);
  return {
    captcha: frames.length > 0 || widgets.length > 0 || captchaText,
    mfa: otp.length > 0 || (otpText && deepAll(document, "input:not([type=hidden])").length <= 4 && !password.length),
    login: password.length > 0,
    signInText,
    scoreCheck: badges.length > 0,
  };`;
export const SECURITY_SCRIPT = withOptions(SECURITY_BODY, {});

/** The page's visible, enabled navigation buttons (not dropdowns or answer buttons), with the attributes used to classify them. */
export function buttonsScript(options: ScanOptions = {}): string {
  return withOptions(
    String.raw`
  const isChoice = (b) => b.hasAttribute("aria-pressed") || !!b.closest('[role="radiogroup"]') || (OPTIONS.buttonGroups || []).some((s) => { try { return !!b.closest(s); } catch (e) { return false; } });
  const nodes = deepAll(document, 'button, input[type="submit"], input[type="button"], [role="button"], a.button, a.btn');
  return nodes.filter(visible).filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && b.getAttribute("aria-haspopup") !== "listbox" && !isChoice(b)).map((b) => ({
    text: clean(b.tagName === "INPUT" ? b.value : (b.getAttribute("aria-label") || b.textContent)),
    type: (b.getAttribute("type") || (b.tagName === "BUTTON" ? "submit" : "")).toLowerCase(),
    inForm: !!b.closest("form"),
    domPath: cssPath(b),
  }));`,
    options,
  );
}

/** Validation problems the page is showing: invalid fields with their messages, and alert text. */
export const VALIDATION_SCRIPT = withOptions(
  String.raw`
  const errors = [];
  const seen = new Set();
  for (const el of deepAll(document, 'input, select, textarea, button[aria-haspopup], [role="combobox"], [role="radiogroup"], [role="group"]')) {
    if (!visible(el) && el.type !== "radio" && el.type !== "checkbox") continue;
    if (el.getAttribute("aria-invalid") !== "true") continue;
    const lab = el.matches('[role="radiogroup"], [role="group"]') ? groupLabelOf(el) : labelOf(el) || groupLabelOf(el);
    const label = lab ? lab.text : el.getAttribute("name") || "Field";
    if (seen.has(label)) continue;
    seen.add(label);
    let message = byIds(el.getAttribute("aria-describedby") || "", el) || byIds(el.getAttribute("aria-errormessage") || "", el);
    if (!message) {
      const container = el.closest(".field, .form-group, .question, li, div");
      const errNode = container && container.querySelector('.error, .error-message, .invalid-feedback, [role="alert"], .field-error, [data-automation-id="errorMessage"]');
      if (errNode && visible(errNode)) message = clean(errNode.textContent);
    }
    errors.push({ label, message: message || "The site marked this field as invalid", name: el.getAttribute("name") || "" });
  }
  const alerts = deepAll(document, '[role="alert"], .alert-danger, .form-errors, .error-summary, [data-automation-id="errorBanner"]').filter(visible).map((n) => clean(n.textContent)).filter(Boolean);
  return { errors, alerts: alerts.slice(0, 10) };`,
  {},
);

/** HTML5 constraint validation for the visible fields (no events fired, nothing changed). */
export const NATIVE_VALIDITY_SCRIPT = withOptions(
  String.raw`
  const out = [];
  for (const el of deepAll(document, "input, select, textarea")) {
    if (el.type === "hidden" || el.disabled) continue;
    if (!visible(el) && el.type !== "radio" && el.type !== "checkbox" && el.type !== "file") continue;
    if (el.validity && !el.validity.valid) {
      const lab = labelOf(el) || groupLabelOf(el);
      out.push({ label: lab ? lab.text : el.getAttribute("name") || "Field", message: el.validationMessage || "Invalid value", name: el.getAttribute("name") || "" });
    }
  }
  const unique = [];
  const seen = new Set();
  for (const e of out) if (!seen.has(e.label)) { seen.add(e.label); unique.push(e); }
  return unique;`,
  {},
);

/** Signs the application went through: confirmation wording and a reference number if shown. */
const CONFIRMATION_BODY = String.raw`
  const text = (document.body ? deepText(document.body) : "").replace(/\s+/g, " ").slice(0, 20000);
  const confirmed = /thank you for (applying|your application|your interest)|thanks for applying|application (has been |was )?(successfully )?(submitted|received)|we('ve| have) received your application|your application is complete|successfully (submitted|applied)/i.test(text);
  const m = text.match(/(confirmation|reference|application|submission) (number|no\.?|id|#|code)\s*(?:is\s*)?[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i);
  // A reference always has a digit; this keeps words like "pending" out.
  return { confirmed, confirmation: m && /\d/.test(m[3]) ? m[3] : null, url: location.href };`;
export const CONFIRMATION_SCRIPT = withOptions(CONFIRMATION_BODY, {});

/** Text of the options a custom dropdown is currently showing (after it was opened). */
export const OPEN_OPTIONS_SCRIPT = withOptions(
  String.raw`
  return deepAll(document, '[role="option"]').filter(visible).map((o) => clean(o.textContent)).filter(Boolean);`,
  {},
);

/**
 * The field scan, security check and confirmation check as functions of their
 * scan options, for the browser extension. The extension can't run code it
 * downloads, so its page-scripts.js is generated from this at build time and
 * the worker and the extension read pages the same way.
 */
export function pageScriptsSource(): string {
  const fn = (body: string) => `(OPTIONS) => {\n  OPTIONS = OPTIONS || {};\n${HELPERS}\n${body}\n}`;
  return `{\nscanFields: ${fn(SCAN_FIELDS_BODY)},\nsecurity: ${fn(SECURITY_BODY)},\nconfirmation: ${fn(CONFIRMATION_BODY)},\n}`;
}
