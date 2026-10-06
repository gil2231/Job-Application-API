import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ATS_ENTRY_POINTS, handleAtsRequest, type AtsSession } from "./ats";

/**
 * Local mock application sites for testing the worker. Nothing here talks to
 * a real employer. Each page imitates a pattern real application forms use:
 * plain forms, multi-step flows, dropdowns, checkbox groups, uploads,
 * conditional questions, server-side validation, a CAPTCHA, a sign-in wall
 * and questions AutoApply can't know the answer to.
 *
 * Run it on its own with `pnpm --filter @autoapply/worker mock-site`.
 */

export interface MockSubmission {
  form: string;
  confirmation: string;
  fields: Record<string, string | string[]>;
  files: Record<string, { name: string; size: number; type: string }>;
  at: string;
}

interface Session {
  id: string;
  captchaSolved: boolean;
  signedIn: boolean;
  multi: Record<string, string | string[]>;
  multiFiles: MockSubmission["files"];
  ats: AtsSession;
}

type FieldValue = string | string[];
type Values = Record<string, FieldValue>;
type Errors = Record<string, string>;

interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "url" | "number" | "textarea" | "select" | "radio" | "checkbox" | "checkboxes" | "file" | "date";
  required?: boolean;
  options?: string[];
  autocomplete?: string;
  pattern?: string;
  accept?: string;
  hint?: string;
  /** Only shown when another field has this value. */
  showIf?: { field: string; equals: string };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderField(f: FieldDef, values: Values, errors: Errors): string {
  const id = `f-${f.name}`;
  const value = values[f.name];
  const err = errors[f.name];
  const req = f.required ? " required aria-required=\"true\"" : "";
  const invalid = err ? ` aria-invalid="true" aria-describedby="${id}-error"` : "";
  const star = f.required ? ' <span class="req">*</span>' : "";
  const errHtml = err ? `<p class="error" id="${id}-error">${esc(err)}</p>` : "";
  const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : "";
  const cond = f.showIf ? ` data-show-if="${esc(f.showIf.field)}" data-equals="${esc(f.showIf.equals)}"` : "";
  const hidden = f.showIf && values[f.showIf.field] !== f.showIf.equals ? " hidden" : "";
  const type = f.type ?? "text";
  let control: string;
  switch (type) {
    case "textarea":
      control = `<label for="${id}">${esc(f.label)}${star}</label><textarea id="${id}" name="${f.name}" rows="4"${req}${invalid}>${esc(String(value ?? ""))}</textarea>`;
      break;
    case "select":
      control = `<label for="${id}">${esc(f.label)}${star}</label><select id="${id}" name="${f.name}"${req}${invalid}><option value="">Select…</option>${(f.options ?? [])
        .map((o) => `<option${value === o ? " selected" : ""}>${esc(o)}</option>`)
        .join("")}</select>`;
      break;
    case "radio":
      control = `<fieldset${invalid}><legend>${esc(f.label)}${star}</legend>${(f.options ?? [])
        .map((o, i) => `<label class="choice"><input type="radio" name="${f.name}" value="${esc(o)}" id="${id}-${i}"${value === o ? " checked" : ""}${i === 0 ? req : ""}> ${esc(o)}</label>`)
        .join("")}</fieldset>`;
      break;
    case "checkboxes": {
      const selected = Array.isArray(value) ? value : value ? [value] : [];
      control = `<fieldset${invalid}><legend>${esc(f.label)}${star}</legend>${(f.options ?? [])
        .map((o, i) => `<label class="choice"><input type="checkbox" name="${f.name}" value="${esc(o)}" id="${id}-${i}"${selected.includes(o) ? " checked" : ""}> ${esc(o)}</label>`)
        .join("")}</fieldset>`;
      break;
    }
    case "checkbox":
      control = `<label class="choice" for="${id}"><input type="checkbox" id="${id}" name="${f.name}" value="yes"${value === "yes" ? " checked" : ""}${req}${invalid}> ${esc(f.label)}${star}</label>`;
      break;
    case "file":
      control = `<label for="${id}">${esc(f.label)}${star}</label><input type="file" id="${id}" name="${f.name}"${f.accept ? ` accept="${esc(f.accept)}"` : ""}${req}${invalid}>`;
      break;
    default:
      control = `<label for="${id}">${esc(f.label)}${star}</label><input type="${type}" id="${id}" name="${f.name}" value="${esc(String(value ?? ""))}"${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ""}${f.pattern ? ` pattern="${esc(f.pattern)}"` : ""}${req}${invalid}>`;
  }
  return `<div class="field"${cond}${hidden}>${control}${hint}${errHtml}</div>`;
}

const STYLE = `
  *{box-sizing:border-box} body{font:15px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1d2433;margin:0}
  header{background:#1d2433;color:#fff;padding:14px 24px;font-weight:600} main{max-width:640px;margin:24px auto;background:#fff;border:1px solid #e3e6ec;border-radius:10px;padding:24px 28px}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#667085;margin:0 0 18px} .field{margin:14px 0} label{display:block;font-weight:500;margin-bottom:4px}
  input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],input[type=date],select,textarea{width:100%;padding:8px 10px;border:1px solid #cfd4dc;border-radius:6px;font:inherit}
  fieldset{border:0;padding:0;margin:0} legend{font-weight:500;margin-bottom:4px} .choice{font-weight:400;display:flex;gap:8px;align-items:center;margin:2px 0}
  .req{color:#c0362c} .error{color:#c0362c;font-size:13px;margin:4px 0 0} .hint{color:#667085;font-size:13px;margin:4px 0 0}
  [aria-invalid=true]{border-color:#c0362c!important} .alert{background:#fdecea;border:1px solid #f5c2bd;color:#8a1c12;padding:10px 12px;border-radius:6px}
  button{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer} .steps{color:#667085;font-size:13px}
  .captcha{border:1px solid #d0d5dd;border-radius:4px;padding:14px;display:flex;gap:10px;align-items:center;background:#f9fafb;width:300px}
  [hidden]{display:none!important} ul.forms li{margin:6px 0}`;

const CONDITIONAL_JS = `<script>
  for (const el of document.querySelectorAll("[data-show-if]")) {
    const source = document.querySelectorAll('[name="' + el.dataset.showIf + '"]');
    const update = () => {
      const checked = Array.from(source).find((s) => (s.type === "radio" ? s.checked : true));
      const v = checked ? checked.value : "";
      el.hidden = v !== el.dataset.equals;
      for (const input of el.querySelectorAll("input,select,textarea")) input.disabled = el.hidden;
    };
    source.forEach((s) => s.addEventListener("change", update));
    update();
  }
</script>`;

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style>${extraHead}</head><body><header>Mock Careers · ${esc(title)}</header><main>${body}</main></body></html>`;
}

function formPage(opts: { title: string; subtitle?: string; action: string; fields: FieldDef[]; values?: Values; errors?: Errors; button?: string; multipart?: boolean; before?: string; steps?: string }): string {
  const errors = opts.errors ?? {};
  const summary = Object.keys(errors).length ? `<div class="alert" role="alert">Please fix ${Object.keys(errors).length} error${Object.keys(errors).length === 1 ? "" : "s"} below.</div>` : "";
  return page(
    opts.title,
    `<h1>${esc(opts.title)}</h1>${opts.subtitle ? `<p class="sub">${esc(opts.subtitle)}</p>` : ""}${opts.steps ? `<p class="steps">${esc(opts.steps)}</p>` : ""}${summary}
    <form method="post" action="${opts.action}"${opts.multipart ? ' enctype="multipart/form-data"' : ""} novalidate>
      ${opts.fields.map((f) => renderField(f, opts.values ?? {}, errors)).join("\n")}
      ${opts.before ?? ""}
      <p><button type="submit">${esc(opts.button ?? "Submit application")}</button></p>
    </form>${CONDITIONAL_JS}`,
  );
}

// ─── Form definitions ───────────────────────────────────────────────────────

const CONTACT: FieldDef[] = [
  { name: "first_name", label: "First Name", required: true, autocomplete: "given-name" },
  { name: "last_name", label: "Last Name", required: true, autocomplete: "family-name" },
  { name: "email", label: "Email Address", type: "email", required: true },
  { name: "mobile", label: "Mobile Number", type: "tel", required: true },
];

const FORMS: Record<string, { title: string; subtitle: string; fields: FieldDef[] }> = {
  simple: {
    title: "Business Development Representative",
    subtitle: "Example Corp · New York, NY",
    fields: [
      ...CONTACT,
      { name: "linkedin", label: "LinkedIn Profile", type: "url" },
      { name: "resume", label: "Resume/CV", type: "file", required: true, accept: ".pdf,.doc,.docx" },
    ],
  },
  dropdowns: {
    title: "Account Executive",
    subtitle: "Dropdown Co · Remote",
    fields: [
      { name: "first_name", label: "First name", required: true },
      { name: "last_name", label: "Last name", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "country", label: "Country", type: "select", required: true, options: ["Canada", "Mexico", "United States of America", "United Kingdom"] },
      { name: "state", label: "State", type: "select", required: true, options: ["California", "New Jersey", "New York", "Texas"] },
      { name: "experience", label: "How many years of experience do you have?", type: "select", required: true, options: ["Less than 1 year", "1-2 years", "3-5 years", "6-10 years", "10+ years"] },
      { name: "resume", label: "Resume", type: "file", required: true },
    ],
  },
  checkboxes: {
    title: "Sales Development Representative",
    subtitle: "Checkbox Inc · Hybrid",
    fields: [
      ...CONTACT,
      { name: "authorized", label: "Are you legally authorized to work in the United States?", type: "radio", required: true, options: ["Yes", "No"] },
      { name: "sponsorship", label: "Will you now or in the future require visa sponsorship?", type: "radio", required: true, options: ["Yes", "No"] },
      { name: "privacy", label: "I have read and agree to the privacy notice", type: "checkbox", required: true },
      { name: "resume", label: "Resume", type: "file", required: true },
    ],
  },
  uploads: {
    title: "Marketing Associate",
    subtitle: "Upload Labs · Boston, MA",
    fields: [
      ...CONTACT,
      { name: "resume", label: "Resume", type: "file", required: true, accept: ".pdf,.doc,.docx" },
      { name: "cover_letter", label: "Cover Letter", type: "file", accept: ".pdf,.doc,.docx" },
      { name: "writing_sample", label: "Writing sample", type: "file" },
    ],
  },
  conditional: {
    title: "Solutions Consultant",
    subtitle: "Conditional Systems · Austin, TX",
    fields: [
      ...CONTACT,
      { name: "sponsorship", label: "Will you now or in the future require visa sponsorship?", type: "select", required: true, options: ["Yes", "No"] },
      { name: "visa_type", label: "Which visa type will you require?", required: true, showIf: { field: "sponsorship", equals: "Yes" } },
      { name: "relocate", label: "Are you willing to relocate?", type: "radio", required: true, options: ["Yes", "No"] },
      { name: "relocate_where", label: "Preferred city to relocate to", required: true, showIf: { field: "relocate", equals: "Yes" } },
      { name: "resume", label: "Resume", type: "file", required: true },
    ],
  },
  validation: {
    title: "Customer Success Manager",
    subtitle: "Strict Forms LLC · Chicago, IL",
    fields: [
      { name: "first_name", label: "First Name", required: true },
      { name: "last_name", label: "Last Name", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Phone Number", type: "tel", required: true, hint: "Format: 555-555-5555" },
      { name: "resume", label: "Resume", type: "file", required: true },
    ],
  },
  "unknown-fields": {
    title: "Operations Analyst",
    subtitle: "Curious Corp · Denver, CO",
    fields: [
      ...CONTACT,
      { name: "favorite_tool", label: "What is the last tool you built for yourself, and why?", type: "textarea", required: true },
      { name: "shirt", label: "T-shirt size", type: "select", options: ["S", "M", "L", "XL"] },
      { name: "resume", label: "Resume", type: "file", required: true },
    ],
  },
  captcha: {
    title: "Partnerships Manager",
    subtitle: "Guarded Co · Seattle, WA",
    fields: [...CONTACT, { name: "resume", label: "Resume", type: "file", required: true }],
  },
  login: {
    title: "Revenue Operations Analyst",
    subtitle: "Members Only Inc · Remote",
    fields: [...CONTACT, { name: "resume", label: "Resume", type: "file", required: true }],
  },
};

const MULTI_STEPS: Array<{ title: string; fields: FieldDef[] }> = [
  { title: "Contact information", fields: CONTACT },
  {
    title: "Experience",
    fields: [
      { name: "resume", label: "Resume", type: "file", required: true },
      { name: "cover_letter", label: "Cover letter", type: "file" },
      { name: "current_company", label: "Current Company" },
      { name: "years", label: "Total years of experience", type: "number", required: true },
    ],
  },
  {
    title: "Eligibility",
    fields: [
      { name: "authorized", label: "Are you legally authorized to work in the United States?", type: "radio", required: true, options: ["Yes", "No"] },
      { name: "sponsorship", label: "Will you now or in the future require visa sponsorship?", type: "radio", required: true, options: ["Yes", "No"] },
    ],
  },
];

// ─── Server ─────────────────────────────────────────────────────────────────

export interface MockSite {
  url: string;
  submissions: MockSubmission[];
  /** Buttons AutoApply must never press (apply with LinkedIn, Workday autofill) that were pressed anyway. */
  forbidden: string[];
  /** Simulate a person completing the CAPTCHA in the browser AutoApply opened. */
  solveCaptchas(): void;
  /** Simulate a person signing in within that browser. */
  grantSignIns(): void;
  reset(): void;
  close(): Promise<void>;
}

export async function startMockSite(port = 0, host = "127.0.0.1"): Promise<MockSite> {
  const sessions = new Map<string, Session>();
  const submissions: MockSubmission[] = [];
  const forbidden: string[] = [];
  let captchaSolvedGlobally = false;
  let signInGranted = false;

  const sessionFor = (req: IncomingMessage, res: ServerResponse): Session => {
    const cookie = /mock_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
    if (cookie && sessions.has(cookie)) return sessions.get(cookie)!;
    const id = randomBytes(8).toString("hex");
    const s: Session = { id, captchaSolved: false, signedIn: false, multi: {}, multiFiles: {}, ats: { steps: {}, signedIn: false } };
    sessions.set(id, s);
    res.setHeader("Set-Cookie", `mock_session=${id}; Path=/; HttpOnly; SameSite=Lax`);
    return s;
  };

  const send = (res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8") => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };
  const redirect = (res: ServerResponse, to: string) => {
    res.writeHead(303, { Location: to });
    res.end();
  };

  async function readForm(req: IncomingMessage, base: string) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(new URL(req.url ?? "/", base), { method: "POST", headers: Object.entries(req.headers).flatMap(([k, v]) => (v == null ? [] : Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]])), body: Buffer.concat(chunks) });
    const data = await request.formData();
    const fields: Values = {};
    const files: MockSubmission["files"] = {};
    for (const [key, value] of data.entries()) {
      if (typeof value === "string") {
        const prev = fields[key];
        fields[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
      } else if (value.size > 0) {
        files[key] = { name: value.name, size: value.size, type: value.type };
      }
    }
    return { fields, files };
  }

  function validate(defs: FieldDef[], fields: Values, files: MockSubmission["files"]): Errors {
    const errors: Errors = {};
    for (const f of defs) {
      if (f.showIf && fields[f.showIf.field] !== f.showIf.equals) continue;
      const v = fields[f.name];
      const empty = f.type === "file" ? !files[f.name] : v == null || (Array.isArray(v) ? v.length === 0 : v.trim() === "");
      if (f.required && empty) errors[f.name] = f.type === "file" ? "Please attach a file" : "This field is required";
      else if (!empty && f.type === "email" && typeof v === "string" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errors[f.name] = "Enter a valid email address";
      else if (!empty && f.options && f.type !== "checkboxes" && typeof v === "string" && !f.options.includes(v)) errors[f.name] = "Choose one of the options";
    }
    return errors;
  }

  function record(form: string, fields: Values, files: MockSubmission["files"]): string {
    const confirmation = `MOCK-${1000 + Math.floor(Math.random() * 9000)}-${randomBytes(2).toString("hex").toUpperCase()}`;
    submissions.push({ form, confirmation, fields, files, at: new Date().toISOString() });
    return confirmation;
  }

  function confirm(res: ServerResponse, form: string, fields: Values, files: MockSubmission["files"]) {
    const confirmation = record(form, fields, files);
    send(res, 200, page("Application received", `<h1>Thank you for applying!</h1><p>We've received your application.</p><p>Your confirmation number is <strong>${confirmation}</strong>.</p>`));
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const base = `http://${req.headers.host}`;
      const url = new URL(req.url ?? "/", base);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const session = sessionFor(req, res);

      // Test controls.
      if (path === "/__submissions") return send(res, 200, JSON.stringify(submissions), "application/json");
      if (path === "/__captcha/solve") {
        captchaSolvedGlobally = true;
        return send(res, 200, "ok", "text/plain");
      }
      if (path === "/__login/grant") {
        signInGranted = true;
        return send(res, 200, "ok", "text/plain");
      }
      if (path === "/captcha/state" && url.searchParams.get("solve") === "1") session.captchaSolved = true;
      if (path === "/captcha/state") return send(res, 200, JSON.stringify({ solved: session.captchaSolved || captchaSolvedGlobally }), "application/json");
      if (path === "/login/state") return send(res, 200, JSON.stringify({ signedIn: session.signedIn || session.ats.signedIn || signInGranted }), "application/json");

      const handled = await handleAtsRequest(req, res, path, {
        send,
        redirect,
        readForm: (r) => readForm(r, base),
        record,
        session: session.ats,
        signedIn: () => session.ats.signedIn || signInGranted,
        flagForbidden: (what) => forbidden.push(what),
      });
      if (handled) return;

      if (path === "/") {
        const links = [...Object.entries(FORMS).map(([k, f]) => [k, f.title] as const), ["multi-page", "Inside Sales Representative (multi-page)"] as const, ["job/listing", "Job description with an Apply button"] as const];
        const ats = [
          ["Greenhouse", ATS_ENTRY_POINTS.greenhouse],
          ["Lever", ATS_ENTRY_POINTS.lever],
          ["Lever with an hCaptcha on submit", ATS_ENTRY_POINTS.leverGuarded],
          ["Ashby", ATS_ENTRY_POINTS.ashby],
          ["Workday (needs a sign-in)", ATS_ENTRY_POINTS.workday],
          ["SmartRecruiters", ATS_ENTRY_POINTS.smartrecruiters],
        ] as const;
        const list = (items: ReadonlyArray<readonly [string, string]>) => `<ul class="forms">${items.map(([t, href]) => `<li><a href="${href}">${esc(t)}</a> <code>${esc(href)}</code></li>`).join("")}</ul>`;
        return send(
          res,
          200,
          page(
            "Mock application sites",
            `<h1>Mock application sites</h1><p class="sub">Local test pages for the Applyance worker. Nothing here is a real employer.</p><h2>Form patterns</h2>${list(links.map(([k, t]) => [t, `/${k}`] as const))}<h2>Applicant tracking systems</h2><p class="sub">Imitations of each ATS's form structure.</p>${list(ats)}`,
          ),
        );
      }

      if (path === "/job/listing") {
        return send(res, 200, page("Inside Sales Representative", `<h1>Inside Sales Representative</h1><p class="sub">Listing Co · Remote</p><p>We're hiring an inside sales rep to grow our SMB pipeline.</p><p><a class="button" href="/simple" role="button">Apply now</a></p>`));
      }

      // Multi-page flow with server-side state between steps.
      if (path === "/multi-page") {
        const step = Math.min(MULTI_STEPS.length - 1, Math.max(0, Number(url.searchParams.get("step") ?? 0)));
        if (req.method === "POST") {
          const { fields, files } = await readForm(req, base);
          const def = MULTI_STEPS[step]!;
          const errors = validate(def.fields, fields, files);
          if (Object.keys(errors).length) {
            return send(res, 422, formPage({ title: def.title, steps: `Step ${step + 1} of ${MULTI_STEPS.length}`, action: `/multi-page?step=${step}`, fields: def.fields, values: fields, errors, multipart: true, button: step === MULTI_STEPS.length - 1 ? "Submit application" : "Next" }));
          }
          Object.assign(session.multi, fields);
          Object.assign(session.multiFiles, files);
          if (step === MULTI_STEPS.length - 1) {
            const all = { ...session.multi };
            const allFiles = { ...session.multiFiles };
            session.multi = {};
            session.multiFiles = {};
            return confirm(res, "multi-page", all, allFiles);
          }
          return redirect(res, `/multi-page?step=${step + 1}`);
        }
        const def = MULTI_STEPS[step]!;
        return send(res, 200, formPage({ title: def.title, subtitle: "Steady Sales Co · Inside Sales Representative", steps: `Step ${step + 1} of ${MULTI_STEPS.length}`, action: `/multi-page?step=${step}`, fields: def.fields, values: session.multi, multipart: true, button: step === MULTI_STEPS.length - 1 ? "Submit application" : "Next" }));
      }

      const name = path.slice(1);
      const form = FORMS[name];
      if (!form) return send(res, 404, page("Not found", "<h1>Not found</h1>"));

      // Sign-in wall: the form only appears once the person has signed in.
      if (name === "login" && !(session.signedIn || signInGranted)) {
        if (req.method === "POST" && url.searchParams.get("signin") === "1") {
          const { fields } = await readForm(req, base);
          if (fields.username && fields.password) {
            session.signedIn = true;
            return redirect(res, "/login");
          }
        }
        return send(
          res,
          200,
          page(
            "Sign in",
            `<h1>Sign in to apply</h1><p class="sub">Members Only Inc requires an account.</p><form method="post" action="/login?signin=1"><div class="field"><label for="u">Username</label><input type="text" id="u" name="username"></div><div class="field"><label for="p">Password</label><input type="password" id="p" name="password"></div><button type="submit">Sign in</button></form>
            <script>setInterval(async()=>{const r=await fetch("/login/state");const j=await r.json();if(j.signedIn)location.reload();},1000)</script>`,
          ),
        );
      }

      const captchaWidget =
        name === "captcha"
          ? session.captchaSolved || captchaSolvedGlobally
            ? `<input type="hidden" name="captcha_token" value="solved">`
            : `<div class="field"><div class="g-recaptcha captcha" data-sitekey="mock-site-key" id="captcha-box"><input type="checkbox" id="robot" aria-label="I'm not a robot"> <span>I'm not a robot</span></div></div>
               <script>
                 document.getElementById("robot").addEventListener("change", async () => { await fetch("/captcha/state?solve=1"); });
                 setInterval(async () => { const r = await fetch("/captcha/state"); const j = await r.json(); if (j.solved) { const b = document.getElementById("captcha-box"); if (b) b.closest(".field").outerHTML = '<input type="hidden" name="captcha_token" value="solved">'; } }, 1000);
               </script>`
          : "";
      if (req.method === "POST") {
        const { fields, files } = await readForm(req, base);
        const errors = validate(form.fields, fields, files);
        if (name === "validation" && typeof fields.phone === "string" && fields.phone && !/^\d{3}-\d{3}-\d{4}$/.test(fields.phone)) {
          errors.phone = "Enter your phone number as 555-555-5555";
        }
        if (name === "captcha" && fields.captcha_token !== "solved") {
          return send(res, 403, formPage({ ...form, action: `/${name}`, values: fields, errors: { first_name: "Please complete the CAPTCHA" }, multipart: true, before: captchaWidget }));
        }
        if (Object.keys(errors).length) {
          return send(res, 422, formPage({ ...form, action: `/${name}`, values: fields, errors, multipart: true, before: captchaWidget }));
        }
        return confirm(res, name, fields, files);
      }
      return send(res, 200, formPage({ ...form, action: `/${name}`, multipart: true, before: captchaWidget }));
    } catch (error) {
      send(res, 500, `Mock site error: ${error instanceof Error ? error.message : String(error)}`, "text/plain");
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${address.port}`,
    submissions,
    forbidden,
    solveCaptchas: () => {
      captchaSolvedGlobally = true;
    },
    grantSignIns: () => {
      signInGranted = true;
    },
    reset: () => {
      submissions.length = 0;
      forbidden.length = 0;
      sessions.clear();
      captchaSolvedGlobally = false;
      signInGranted = false;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
