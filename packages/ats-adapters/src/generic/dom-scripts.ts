/**
 * Scripts evaluated inside the application page. They only read the DOM
 * (no clicks, no typing, no attribute changes) and are kept as plain strings so
 * the Node bundler can't inject helpers the page doesn't have.
 */

/** Shared helpers: visibility, label text, required markers, a stable CSS path. */
const HELPERS = String.raw`
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
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
    if (rect.right < 0 || rect.bottom < 0) return false;
    let node = el;
    while (node) {
      if (node.hidden || node.getAttribute && node.getAttribute("aria-hidden") === "true") return false;
      node = node.parentElement;
    }
    return true;
  };
  const textWithout = (container, exclude) => {
    const clone = container.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button, script, style, option, .sr-only-ignore").forEach((n) => n.remove());
    return clean(clone.textContent);
  };
  const byIds = (ids) => clean((ids || "").split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.textContent : ""; }).join(" "));
  const labelOf = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l && clean(l.textContent)) return { text: textWithout(l), via: "label" };
    }
    const wrap = el.closest("label");
    if (wrap && textWithout(wrap)) return { text: textWithout(wrap), via: "label" };
    const ariaBy = el.getAttribute("aria-labelledby");
    if (ariaBy && byIds(ariaBy)) return { text: byIds(ariaBy), via: "aria" };
    const aria = el.getAttribute("aria-label");
    if (aria && clean(aria)) return { text: clean(aria), via: "aria" };
    return null;
  };
  const groupLabelOf = (el) => {
    const fieldset = el.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend && clean(legend.textContent)) return { text: clean(legend.textContent), via: "label" };
    }
    const group = el.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const by = group.getAttribute("aria-labelledby");
      if (by && byIds(by)) return { text: byIds(by), via: "aria" };
      const al = group.getAttribute("aria-label");
      if (al) return { text: clean(al), via: "aria" };
    }
    // DOM relationship: the nearest container whose own text (minus the options) reads like a question.
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const heading = node.querySelector(":scope > p, :scope > span, :scope > div.label, :scope > h3, :scope > h4, :scope > .question, :scope > .field-label");
      if (heading && !heading.querySelector("input") && clean(heading.textContent)) return { text: clean(heading.textContent), via: "dom" };
    }
    return null;
  };
  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && !/\d{4,}/.test(node.id)) { parts.unshift("#" + node.id); break; }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const isRequired = (el, label) => el.required || el.getAttribute("aria-required") === "true" || /\*\s*$|\(required\)/i.test(label || "");
`;

/**
 * Returns every visible, enabled form field on the page as plain data. Radio
 * buttons and same-name checkboxes are grouped into one field with options.
 */
export const SCAN_FIELDS_SCRIPT = String.raw`(() => {
  ${HELPERS}
  const out = [];
  const groups = new Map();
  const els = Array.from(document.querySelectorAll("input, select, textarea"));
  for (const el of els) {
    const type = (el.getAttribute("type") || (el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : "text")).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "search"].includes(type)) continue;
    if (el.disabled || el.readOnly && type !== "file") continue;
    if (!visible(el) && type !== "file") continue;
    if (type === "file" && !visible(el) && !(el.labels && el.labels[0] && visible(el.labels[0]))) continue;
    const base = {
      name: el.getAttribute("name") || "",
      id: el.id || "",
      placeholder: el.getAttribute("placeholder") || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      inputType: type,
      accept: el.getAttribute("accept") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      domPath: cssPath(el),
    };
    if (type === "radio" || type === "checkbox") {
      const key = type + ":" + (base.name || base.domPath);
      const own = labelOf(el);
      const optionLabel = own ? own.text : clean(el.value);
      if (!groups.has(key)) groups.set(key, { type, members: [], first: el, base });
      groups.get(key).members.push({ label: optionLabel, value: el.value, required: el.required || el.getAttribute("aria-required") === "true", checked: el.checked });
      continue;
    }
    const lab = labelOf(el);
    const label = lab ? lab.text : clean(base.placeholder) || clean(base.name);
    let options;
    if (el.tagName === "SELECT") options = Array.from(el.options).map((o) => clean(o.textContent));
    out.push({ ...base, kind: type, label, labelVia: lab ? lab.via : "none", required: isRequired(el, label), options, multiple: el.tagName === "SELECT" ? el.multiple : false });
  }
  for (const g of groups.values()) {
    const single = g.type === "checkbox" && g.members.length === 1;
    if (single) {
      const lab = labelOf(g.first);
      const label = lab ? lab.text : clean(g.base.name);
      out.push({ ...g.base, kind: "checkbox", label, labelVia: lab ? lab.via : "none", required: isRequired(g.first, label), options: undefined, multiple: false });
      continue;
    }
    const lab = groupLabelOf(g.first);
    const label = lab ? lab.text : clean(g.base.name);
    out.push({
      ...g.base,
      id: "",
      kind: g.type,
      label,
      labelVia: lab ? lab.via : "none",
      required: g.members.some((m) => m.required) || /\*\s*$|\(required\)/i.test(label),
      options: g.members.map((m) => m.label),
      optionValues: g.members.map((m) => m.value),
      multiple: g.type === "checkbox",
    });
  }
  return out;
})()`;

/** Visible security checks (CAPTCHA widgets, sign-in and verification-code forms). Read-only. */
export const SECURITY_SCRIPT = String.raw`(() => {
  ${HELPERS}
  const captchaSelectors = [".g-recaptcha", ".h-captcha", ".cf-turnstile", "[data-sitekey]", "#captcha", "[data-captcha]", ".captcha", "#px-captcha", ".arkose"];
  const frames = Array.from(document.querySelectorAll("iframe")).filter((f) => visible(f) && /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|captcha/i.test(f.src || f.title || ""));
  const widgets = captchaSelectors.flatMap((s) => Array.from(document.querySelectorAll(s))).filter(visible);
  const bodyText = clean(document.body ? document.body.innerText : "").slice(0, 20000);
  const captchaText = /verify (that )?you('re| are) (a )?human|are you a robot|i'?m not a robot|complete the security check/i.test(bodyText);
  const otp = Array.from(document.querySelectorAll('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="verification" i], input[id*="otp" i]')).filter(visible);
  const otpText = /(verification|security|one[- ]time|authentication) code|two[- ]factor|2fa|authenticator app/i.test(bodyText);
  const password = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
  const signInText = /sign in|log in|login|create (an )?account|create password/i.test(bodyText);
  return {
    captcha: frames.length > 0 || widgets.length > 0 || captchaText,
    mfa: otp.length > 0 || (otpText && document.querySelectorAll("input:not([type=hidden])").length <= 4 && !password.length),
    login: password.length > 0,
    signInText,
  };
})()`;

/** The page's navigation buttons, classified as next-page or submit. */
export const BUTTONS_SCRIPT = String.raw`(() => {
  ${HELPERS}
  const nodes = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a.button, a.btn'));
  return nodes.filter(visible).filter((b) => !b.disabled).map((b) => ({
    text: clean(b.tagName === "INPUT" ? b.value : (b.getAttribute("aria-label") || b.textContent)),
    type: (b.getAttribute("type") || (b.tagName === "BUTTON" ? "submit" : "")).toLowerCase(),
    inForm: !!b.closest("form"),
    domPath: cssPath(b),
  }));
})()`;

/** Validation problems the page is showing: invalid fields with their messages, and alert text. */
export const VALIDATION_SCRIPT = String.raw`(() => {
  ${HELPERS}
  const errors = [];
  const seen = new Set();
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    if (!visible(el) && el.type !== "radio" && el.type !== "checkbox") continue;
    const invalidAria = el.getAttribute("aria-invalid") === "true";
    if (!invalidAria) continue;
    const lab = labelOf(el) || groupLabelOf(el);
    const label = lab ? lab.text : el.name || "Field";
    if (seen.has(label)) continue;
    seen.add(label);
    let message = byIds(el.getAttribute("aria-describedby") || "") || byIds(el.getAttribute("aria-errormessage") || "");
    if (!message) {
      const container = el.closest(".field, .form-group, .question, li, div");
      const errNode = container && container.querySelector('.error, .error-message, .invalid-feedback, [role="alert"], .field-error');
      if (errNode && visible(errNode)) message = clean(errNode.textContent);
    }
    errors.push({ label, message: message || "The site marked this field as invalid", name: el.getAttribute("name") || "" });
  }
  const alerts = Array.from(document.querySelectorAll('[role="alert"], .alert-danger, .form-errors, .error-summary')).filter(visible).map((n) => clean(n.textContent)).filter(Boolean);
  return { errors, alerts: alerts.slice(0, 10) };
})()`;

/** HTML5 constraint validation for the visible fields (no events fired, nothing changed). */
export const NATIVE_VALIDITY_SCRIPT = String.raw`(() => {
  ${HELPERS}
  const out = [];
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    if (el.type === "hidden" || el.disabled) continue;
    if (!visible(el) && el.type !== "radio" && el.type !== "checkbox" && el.type !== "file") continue;
    if (el.validity && !el.validity.valid) {
      const lab = labelOf(el) || groupLabelOf(el);
      out.push({ label: lab ? lab.text : el.name || "Field", message: el.validationMessage || "Invalid value", name: el.getAttribute("name") || "" });
    }
  }
  const unique = [];
  const seen = new Set();
  for (const e of out) if (!seen.has(e.label)) { seen.add(e.label); unique.push(e); }
  return unique;
})()`;

/** Signs the application went through: confirmation wording and a reference number if shown. */
export const CONFIRMATION_SCRIPT = String.raw`(() => {
  const text = (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 20000);
  const confirmed = /thank you for (applying|your application|your interest)|application (has been |was )?(submitted|received)|we('ve| have) received your application|your application is complete|successfully (submitted|applied)/i.test(text);
  const m = text.match(/(confirmation|reference|application|submission) (number|no\.?|id|#|code)\s*(?:is\s*)?[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i);
  // A reference always has a digit; this keeps words like "pending" out.
  return { confirmed, confirmation: m && /\d/.test(m[3]) ? m[3] : null, url: location.href };
})()`;
