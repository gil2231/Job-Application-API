import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Local imitations of the five ATSs AutoApply has adapters for. Each copies
 * the structure its real counterpart uses (field names, automation ids,
 * custom dropdowns, shadow DOM, page flow, resume parsing, sign-in walls) so
 * the adapters can be tested without ever touching a real employer's site.
 * The content is invented; nothing here is a real job or company.
 */

type FieldValue = string | string[];
type Values = Record<string, FieldValue>;
type Files = Record<string, { name: string; size: number; type: string }>;

export interface AtsSession {
  /** Multi-step state keyed by flow (Workday keeps answers between steps). */
  steps: Record<string, { values: Values; files: Files }>;
  signedIn: boolean;
}

export interface AtsHelpers {
  send(res: ServerResponse, status: number, body: string, type?: string): void;
  redirect(res: ServerResponse, to: string): void;
  readForm(req: IncomingMessage): Promise<{ fields: Values; files: Files }>;
  /** Record a completed application and return its confirmation number. */
  record(form: string, fields: Values, files: Files): string;
  session: AtsSession;
  signedIn(): boolean;
  /** A button AutoApply must never press (third-party sign-in) was pressed. */
  flagForbidden(what: string): void;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const str = (v: FieldValue | undefined) => (Array.isArray(v) ? v.join(", ") : v ?? "");
const blank = (v: FieldValue | undefined) => !str(v).trim();

/** A tiny dropdown kit shared by the mocks: typeahead comboboxes, suggestion boxes and listbox buttons. */
const WIDGETS_JS = String.raw`<script>
(() => {
  const closeAll = () => {
    document.querySelectorAll(".mock-listbox").forEach((l) => l.remove());
    document.querySelectorAll('[aria-expanded="true"]').forEach((e) => e.setAttribute("aria-expanded", "false"));
  };
  const openList = (anchor, options, onPick) => {
    closeAll();
    if (!options.length) return;
    const r = anchor.getBoundingClientRect();
    const lb = document.createElement("div");
    lb.className = "mock-listbox";
    lb.setAttribute("role", "listbox");
    lb.id = anchor.getAttribute("aria-controls") || "";
    lb.style.cssText = "position:absolute;z-index:50;background:#fff;border:1px solid #cfd4dc;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:4px;min-width:" + r.width + "px;left:" + (r.left + scrollX) + "px;top:" + (r.bottom + scrollY + 2) + "px";
    for (const o of options) {
      const d = document.createElement("div");
      d.setAttribute("role", "option");
      d.textContent = o;
      d.style.cssText = "padding:6px 10px;cursor:pointer;border-radius:4px";
      d.addEventListener("mouseenter", () => (d.style.background = "#eef2ff"));
      d.addEventListener("mouseleave", () => (d.style.background = ""));
      d.addEventListener("mousedown", (e) => { e.preventDefault(); onPick(o); closeAll(); });
      lb.append(d);
    }
    document.body.append(lb);
    anchor.setAttribute("aria-expanded", "true");
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".mock-listbox, [role=combobox], [aria-haspopup=listbox]")) closeAll(); });
  const hiddenFor = (el) => document.querySelector('input[type=hidden][name="' + el.dataset.target + '"]');
  const clearError = (el) => { el.removeAttribute("aria-invalid"); const err = document.getElementById(el.id + "-error"); if (err) err.remove(); };
  // Dropdown with a fixed list that filters as you type (react-select style).
  for (const input of document.querySelectorAll("input[role=combobox][data-options]")) {
    const options = JSON.parse(input.dataset.options);
    const hidden = hiddenFor(input);
    const pick = (o) => { input.value = o; hidden.value = o; clearError(input); };
    input.addEventListener("click", () => openList(input, options, pick));
    input.addEventListener("input", () => { hidden.value = ""; openList(input, options.filter((o) => o.toLowerCase().includes(input.value.toLowerCase())), pick); });
  }
  // Suggestion box: nothing until you type, then matches arrive a moment later.
  for (const input of document.querySelectorAll("input[role=combobox][data-suggest]")) {
    const all = JSON.parse(input.dataset.suggest);
    const hidden = hiddenFor(input);
    let timer;
    const pick = (o) => { input.value = o; hidden.value = o; clearError(input); };
    input.addEventListener("input", () => {
      hidden.value = "";
      clearTimeout(timer);
      const q = input.value.toLowerCase();
      timer = setTimeout(() => openList(input, q.length < 2 ? [] : all.filter((o) => o.toLowerCase().includes(q)), pick), 150);
    });
  }
  // A button that opens a list (Workday style).
  for (const button of document.querySelectorAll("button[aria-haspopup=listbox][data-options]")) {
    const options = JSON.parse(button.dataset.options);
    const hidden = hiddenFor(button);
    button.addEventListener("click", () => openList(button, options, (o) => { button.textContent = o; hidden.value = o; clearError(button); }));
  }
})();
</script>`;

const BASE_STYLE = `*{box-sizing:border-box} body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#1d2433} input[type=text],input[type=email],input[type=tel],input[type=url],input:not([type]),select,textarea{width:100%;padding:8px 10px;border:1px solid #cfd4dc;border-radius:6px;font:inherit;background:#fff}
  .visually-hidden{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  [aria-invalid=true]{border-color:#c0362c!important} .error{color:#c0362c;font-size:13px;margin:4px 0 0} [hidden]{display:none!important}`;

function shell(title: string, style: string, body: string, scripts = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_STYLE}${style}</style></head><body>${body}${scripts}</body></html>`;
}

const errorHtml = (id: string, err?: string) => (err ? `<p class="error" id="${id}-error">${esc(err)}</p>` : "");
const invalidAttr = (id: string, err?: string) => (err ? ` aria-invalid="true" aria-describedby="${id}-error"` : "");

function requireAll(required: string[], fields: Values, files: Files, fileFields: string[] = []): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const name of required) {
    if (fileFields.includes(name) ? !files[name] : blank(fields[name])) errors[name] = fileFields.includes(name) ? "Please attach a file" : "This field is required";
  }
  return errors;
}

const SPONSOR_Q = "Will you now or in the future require sponsorship to work in the United States?";
const AUTH_Q = "Are you legally authorized to work in the United States?";
const CITIES = ["New York, New York, United States", "Newark, New Jersey, United States", "New Orleans, Louisiana, United States", "Boston, Massachusetts, United States", "Austin, Texas, United States"];

// ─── Greenhouse ─────────────────────────────────────────────────────────────

const GH_PATH = "/greenhouse/examplecorp/jobs/4012345";

function greenhousePage(values: Values = {}, errors: Record<string, string> = {}): string {
  const text = (id: string, name: string, label: string, type = "text", required = true) =>
    `<div class="field"><label for="${id}">${esc(label)}${required ? '<span class="asterisk">*</span>' : ""}</label><input type="${type}" id="${id}" name="${name}" value="${esc(str(values[name]))}"${required ? ' aria-required="true"' : ""}${invalidAttr(id, errors[name])}>${errorHtml(id, errors[name])}</div>`;
  const combo = (id: string, name: string, label: string, options: string[], required: boolean) =>
    `<div class="field"><label id="${id}-label">${esc(label)}${required ? '<span class="asterisk">*</span>' : ""}</label><div class="select__control"><input id="${id}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-listbox" aria-labelledby="${id}-label"${required ? ' aria-required="true"' : ""} data-target="${name}" data-options="${esc(JSON.stringify(options))}" value="${esc(str(values[name]))}" autocomplete="off"${invalidAttr(id, errors[name])}><input type="hidden" name="${name}" value="${esc(str(values[name]))}"></div>${errorHtml(id, errors[name])}</div>`;
  const upload = (id: string, name: string, label: string, required: boolean) =>
    `<div class="field"><div class="upload-label" id="upload-label-${id}">${esc(label)}${required ? '<span class="asterisk">*</span>' : ""}</div><div class="file-upload"><button type="button" class="btn btn--secondary" onclick="document.getElementById('${id}').click()">Attach</button> <span class="file-name" id="${id}-name">No file chosen</span><input type="file" id="${id}" name="${name}" class="visually-hidden" aria-labelledby="upload-label-${id}"${required ? ' aria-required="true"' : ""} accept=".pdf,.doc,.docx,.txt,.rtf" onchange="document.getElementById('${id}-name').textContent=this.files[0]?.name||'No file chosen'"></div>${errorHtml(id, errors[name])}</div>`;
  const summary = Object.keys(errors).length ? `<div class="alert" role="alert">There are errors in your application. Please fix them and submit again.</div>` : "";
  return shell(
    "Business Development Representative at Example Corp",
    `body{background:#fff} header{border-bottom:1px solid #e5e7eb;padding:18px 32px;font-weight:700;color:#24a47f} main{max-width:760px;margin:0 auto;padding:24px 32px 64px}
     h1{font-size:28px;margin:8px 0 4px} .location{color:#6b7280} .field{margin:16px 0} label,.upload-label{display:block;font-weight:600;font-size:14px;margin-bottom:6px} .asterisk{color:#c0362c;margin-left:2px}
     .btn{border:1px solid #24a47f;background:#fff;color:#24a47f;border-radius:20px;padding:6px 16px;font-weight:600;cursor:pointer} .file-name{color:#6b7280;font-size:13px;margin-left:8px}
     #submit_app{background:#24a47f;color:#fff;border:0;border-radius:24px;padding:12px 28px;font-weight:700;font-size:15px;cursor:pointer} h2{font-size:20px;margin:32px 0 8px}
     .alert{background:#fdecea;border:1px solid #f5c2bd;color:#8a1c12;padding:10px 12px;border-radius:6px} .eeoc{border-top:1px solid #e5e7eb;margin-top:28px;padding-top:8px}`,
    `<header>Example Corp · Careers</header><main>
      <h1>Business Development Representative</h1><p class="location">New York, NY</p>
      <p>Example Corp is hiring a BDR to build pipeline with mid-market software buyers. You'll prospect, qualify and book meetings for our account executives.</p>
      <div id="app"><h2>Apply for this job</h2>${summary}
      <form id="application_form" action="${GH_PATH}" method="post" enctype="multipart/form-data" novalidate data-source="greenhouse">
        ${text("first_name", "job_application[first_name]", "First Name")}
        ${text("last_name", "job_application[last_name]", "Last Name")}
        ${text("email", "job_application[email]", "Email", "email")}
        ${text("phone", "job_application[phone]", "Phone", "tel")}
        <div class="field"><label id="job_application_location-label">Location (City)<span class="asterisk">*</span></label><input id="job_application_location" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="location-listbox" aria-labelledby="job_application_location-label" aria-required="true" data-target="job_application[location]" data-suggest="${esc(JSON.stringify(CITIES))}" autocomplete="off" value="${esc(str(values["job_application[location]"]))}"${invalidAttr("job_application_location", errors["job_application[location]"])}><input type="hidden" name="job_application[location]" value="${esc(str(values["job_application[location]"]))}">${errorHtml("job_application_location", errors["job_application[location]"])}</div>
        ${upload("resume", "resume", "Resume/CV", true)}
        ${upload("cover_letter", "cover_letter", "Cover Letter", false)}
        ${text("question_7001", "job_application[answers_attributes][0][text_value]", "LinkedIn Profile", "text", false)}
        ${combo("question_8012", "job_application[answers_attributes][1][boolean_value]", AUTH_Q, ["Yes", "No"], true)}
        ${combo("question_8013", "job_application[answers_attributes][2][boolean_value]", SPONSOR_Q, ["Yes", "No"], true)}
        <div class="eeoc"><h2>Voluntary Self-Identification</h2><p>Completing this section is voluntary and won't affect your application.</p>
        ${combo("job_application_gender", "job_application[gender]", "Gender", ["Male", "Female", "Decline To Self Identify"], false)}
        ${combo("job_application_veteran_status", "job_application[veteran_status]", "Veteran Status", ["I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", "I don't wish to answer"], false)}</div>
        <p style="margin-top:28px"><button id="submit_app" type="submit">Submit Application</button></p>
      </form></div></main>`,
    WIDGETS_JS,
  );
}

async function greenhouse(req: IncomingMessage, res: ServerResponse, path: string, h: AtsHelpers): Promise<boolean> {
  if (path === `${GH_PATH}/confirmation`) {
    h.send(res, 200, shell("Thank you for applying", "main{max-width:640px;margin:64px auto;padding:0 24px}", `<main><h1>Thank you for applying.</h1><p>Your application has been received. If your application seems like a good fit for the position we will contact you soon.</p><p>Application ID: ${esc(String(new URL(req.url ?? "/", "http://x").searchParams.get("id") ?? ""))}</p></main>`));
    return true;
  }
  if (path !== GH_PATH) return false;
  if (req.method === "POST") {
    const { fields, files } = await h.readForm(req);
    const errors = requireAll(["job_application[first_name]", "job_application[last_name]", "job_application[email]", "job_application[phone]", "job_application[location]", "resume", "job_application[answers_attributes][1][boolean_value]", "job_application[answers_attributes][2][boolean_value]"], fields, files, ["resume"]);
    if (Object.keys(errors).length) {
      h.send(res, 422, greenhousePage(fields, errors));
      return true;
    }
    const id = h.record("greenhouse", fields, files);
    h.redirect(res, `${GH_PATH}/confirmation?id=${encodeURIComponent(id)}`);
    return true;
  }
  h.send(res, 200, greenhousePage());
  return true;
}

// ─── Lever ──────────────────────────────────────────────────────────────────

const LEVER_ID = "5f2e1c9a-7b3d-4e21-9c55-0a1b2c3d4e5f";
const LEVER_GUARDED_ID = "9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

function leverJob(id: string): string {
  return shell(
    "Example Corp - Account Executive",
    `body{background:#f9f9f9} .posting{max-width:800px;margin:40px auto;background:#fff;padding:40px} h2{font-size:30px;margin:0} .categories{color:#808080;text-transform:uppercase;font-size:12px;letter-spacing:1px}
     .postings-btn{display:inline-block;background:#579eee;color:#fff;text-decoration:none;padding:10px 24px;border-radius:3px;font-weight:700;margin-right:8px;font-size:13px;letter-spacing:.5px;text-transform:uppercase} .postings-btn.linkedin{background:#0a66c2}`,
    `<div class="posting"><div class="posting-headline"><h2>Account Executive</h2><div class="categories">New York, NY · Sales · Full-time</div></div>
      <div class="section"><p>Example Corp is looking for an Account Executive to close new business with mid-market software companies.</p></div>
      <div class="postings-btn-wrapper"><a class="postings-btn template-btn-submit" data-qa="show-page-apply" href="/lever/examplecorp/${id}/apply">Apply for this job</a><a class="postings-btn linkedin" href="/lever/oauth/linkedin">Apply with LinkedIn</a></div></div>`,
  );
}

function leverApply(id: string, values: Values = {}, errors: Record<string, string> = {}): string {
  const q = (name: string, label: string, opts: { type?: string; required?: boolean } = {}) =>
    `<li class="application-question"><label><div class="application-label">${esc(label)}${opts.required ? '<span class="required">✱</span>' : ""}</div><div class="application-field"><input type="${opts.type ?? "text"}" name="${name}" value="${esc(str(values[name]))}"${opts.required ? " required" : ""}${invalidAttr(`lv-${name.replace(/\W/g, "")}`, errors[name])} id="lv-${name.replace(/\W/g, "")}">${errorHtml(`lv-${name.replace(/\W/g, "")}`, errors[name])}</div></label></li>`;
  const card = (field: string, label: string, options: string[], type: "radio" | "checkbox", required: boolean) =>
    `<li class="application-question custom-question"><div class="application-label full-width"><div class="text">${esc(label)}${required ? '<span class="required">✱</span>' : ""}</div></div><div class="application-field full-width"><ul data-qa="multiple-choice">${options
      .map((o) => `<li><label><input type="${type}" name="cards[${LEVER_ID}][${field}]" value="${esc(o)}"${required && type === "radio" ? " required" : ""}${str(values[`cards[${LEVER_ID}][${field}]`]).split(", ").includes(o) ? " checked" : ""}><span class="application-answer-alternative">${esc(o)}</span></label></li>`)
      .join("")}</ul>${errors[`cards[${LEVER_ID}][${field}]`] ? `<p class="error">${esc(errors[`cards[${LEVER_ID}][${field}]`]!)}</p>` : ""}</div></li>`;
  const guarded = id === LEVER_GUARDED_ID;
  return shell(
    "Example Corp - Account Executive",
    `body{background:#f9f9f9} .content{max-width:800px;margin:40px auto;background:#fff;padding:40px} h4{text-transform:uppercase;font-size:13px;letter-spacing:1px;color:#515357;margin:32px 0 8px;border-bottom:1px solid #e2e2e2;padding-bottom:6px}
     ul{list-style:none;padding:0;margin:0} .application-question{display:flex;gap:16px;margin:14px 0} .application-label{width:220px;flex:none;font-size:14px;color:#515357;padding-top:8px} .application-field{flex:1} .full-width{width:100%}
     .custom-question{flex-direction:column;gap:6px} .custom-question .application-label{width:auto} .required{color:#ff794f;margin-left:4px;font-size:9px;vertical-align:top}
     .application-answer-alternative{margin-left:8px} [data-qa=multiple-choice] label{display:flex;align-items:center;margin:4px 0}
     .resume-upload{display:inline-block;border:1px solid #579eee;color:#579eee;padding:8px 18px;border-radius:3px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.5px}
     #btn-submit{background:#579eee;color:#fff;border:0;padding:12px 36px;border-radius:3px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;cursor:pointer} .resume-status{font-size:13px;color:#808080;margin-left:8px}`,
    `<div class="content"><div class="posting-headline"><h2>Account Executive</h2></div>
      <form id="application-form" class="application-form" method="POST" action="/lever/examplecorp/${id}/apply" enctype="multipart/form-data" novalidate>
        <h4>Submit your application</h4><ul>
          <li class="application-question resume"><label><div class="application-label">Resume/CV<span class="required">✱</span></div><div class="application-field"><span class="resume-upload">ATTACH RESUME/CV</span><span class="resume-status" id="resume-status"></span><input type="file" name="resume" id="resume-upload-input" class="visually-hidden" required></div></label>${errorHtml("resume-upload-input", errors.resume)}</li>
          ${q("name", "Full name", { required: true })}
          ${q("email", "Email", { type: "email", required: true })}
          ${q("phone", "Phone")}
          ${q("org", "Current company")}
        </ul>
        <h4>Links</h4><ul>
          ${q("urls[LinkedIn]", "LinkedIn URL")}
          ${q("urls[GitHub]", "GitHub URL")}
          ${q("urls[Portfolio]", "Portfolio URL")}
        </ul>
        <h4>Additional questions</h4><ul>
          ${card("field0", AUTH_Q, ["Yes", "No"], "radio", true)}
          ${card("field1", SPONSOR_Q, ["Yes", "No"], "radio", true)}
          ${card("field2", "Which of these sales tools have you used?", ["Salesforce", "HubSpot", "Outreach"], "checkbox", false)}
        </ul>
        <h4>Additional information</h4><ul><li class="application-question"><label><div class="application-label">Add a cover letter or anything else you want to share.</div><div class="application-field"><textarea name="comments" rows="4"></textarea></div></label></li></ul>
        <div id="captcha-slot"></div>
        <p><button id="btn-submit" type="submit" class="template-btn-submit postings-btn" data-qa="btn-submit">Submit application</button></p>
      </form></div>`,
    `<script>
      // Lever reads the resume and fills in what it parsed, overwriting what was typed.
      document.getElementById("resume-upload-input").addEventListener("change", (e) => {
        const f = e.target.files[0];
        document.getElementById("resume-status").textContent = f ? "Parsing " + f.name + "…" : "";
        setTimeout(() => {
          const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
          set("name", "JORDAN R."); set("email", "jordan.rivera@old-employer.example"); set("org", "Parsed Company LLC");
          document.getElementById("resume-status").textContent = f ? f.name + " ✓" : "";
        }, 400);
      });
      ${guarded ? `document.getElementById("application-form").addEventListener("submit", (e) => {
        if (document.querySelector("[name=h-captcha-response]")) return;
        e.preventDefault();
        document.getElementById("captcha-slot").innerHTML = '<div class="h-captcha" data-sitekey="mock-site-key"><iframe title="hCaptcha challenge" src="about:blank" style="width:304px;height:78px;border:1px solid #d0d5dd"></iframe></div>';
      });` : ""}
    </script>`,
  );
}

async function lever(req: IncomingMessage, res: ServerResponse, path: string, h: AtsHelpers): Promise<boolean> {
  if (path === "/lever/oauth/linkedin") {
    h.flagForbidden("lever: Apply with LinkedIn");
    h.send(res, 200, shell("LinkedIn", "", "<h1>Sign in to LinkedIn</h1><form><input type=password name=p></form>"));
    return true;
  }
  const m = /^\/lever\/examplecorp\/([0-9a-f-]{36})(\/apply|\/thanks)?$/.exec(path);
  if (!m) return false;
  const [, id, sub] = m;
  if (!sub) {
    h.send(res, 200, leverJob(id!));
    return true;
  }
  if (sub === "/thanks") {
    h.send(res, 200, shell("Application submitted", "main{max-width:640px;margin:64px auto;padding:0 24px}", `<main><h3>Application submitted!</h3><p>Thanks for applying to Example Corp. We'll be in touch.</p></main>`));
    return true;
  }
  if (req.method === "POST") {
    const { fields, files } = await h.readForm(req);
    const errors = requireAll(["resume", "name", "email", `cards[${LEVER_ID}][field0]`, `cards[${LEVER_ID}][field1]`], fields, files, ["resume"]);
    if (Object.keys(errors).length) {
      h.send(res, 422, leverApply(id!, fields, errors));
      return true;
    }
    h.record(id === LEVER_GUARDED_ID ? "lever-guarded" : "lever", fields, files);
    h.redirect(res, `/lever/examplecorp/${id}/thanks`);
    return true;
  }
  h.send(res, 200, leverApply(id!));
  return true;
}

// ─── Ashby ──────────────────────────────────────────────────────────────────

const ASHBY_ID = "3c7e9f10-2a4b-4c6d-8e0f-1a2b3c4d5e6f";
const ASHBY_PHONE = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9";
const ASHBY_LINKEDIN = "1c2d3e4f-5061-4728-93a4-b5c6d7e8f901";
const ASHBY_AUTH = "2d3e4f50-6172-4839-a4b5-c6d7e8f90112";
const ASHBY_SPONSOR = "3e4f5061-7283-494a-b5c6-d7e8f9011223";

function ashbyPage(): string {
  const base = `/ashby/examplecorp/${ASHBY_ID}`;
  const formHtml = `
    <div class="ashby-application-form-container">
      <div class="_autofillPane_x1"><p class="_autofill_title">Autofill from resume</p><p class="hint">Upload your resume here to autofill key application fields.</p><button type="button" onclick="document.getElementById('autofill-input').click()">Upload file</button><input type="file" id="autofill-input" class="visually-hidden"></div>
      <form class="ashby-application-form" novalidate onsubmit="return false">
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_name">Name<span class="req">*</span></label><input id="_systemfield_name" name="_systemfield_name" type="text" required></div>
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_email">Email<span class="req">*</span></label><input id="_systemfield_email" name="_systemfield_email" type="email" required></div>
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="${ASHBY_PHONE}">Phone Number</label><input id="${ASHBY_PHONE}" name="${ASHBY_PHONE}" type="tel"></div>
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_location">Location<span class="req">*</span></label><input id="_systemfield_location" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="_systemfield_location-listbox" aria-required="true" data-target="_systemfield_location_value" data-suggest="${esc(JSON.stringify(CITIES.map((c) => c.replace(", United States", ", US"))))}" autocomplete="off"><input type="hidden" name="_systemfield_location_value"></div>
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="_systemfield_resume">Resume<span class="req">*</span></label><div class="_fileUpload"><button type="button" onclick="document.getElementById('_systemfield_resume').click()">Upload File</button> <span id="resume-name"></span><input id="_systemfield_resume" name="_systemfield_resume" type="file" class="visually-hidden" required onchange="document.getElementById('resume-name').textContent=this.files[0]?.name||''"></div></div>
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="${ASHBY_LINKEDIN}">LinkedIn Profile</label><input id="${ASHBY_LINKEDIN}" name="${ASHBY_LINKEDIN}" type="text"></div>
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">${esc(AUTH_Q)}<span class="req">*</span></label><div class="_yesno_2ab3" data-name="${ASHBY_AUTH}"><button type="button" class="_option_9f1" aria-pressed="false">Yes</button><button type="button" class="_option_9f1" aria-pressed="false">No</button></div><input type="hidden" name="${ASHBY_AUTH}"></div>
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">${esc(SPONSOR_Q)}<span class="req">*</span></label><div class="_yesno_2ab3" data-name="${ASHBY_SPONSOR}"><button type="button" class="_option_9f1" aria-pressed="false">Yes</button><button type="button" class="_option_9f1" aria-pressed="false">No</button></div><input type="hidden" name="${ASHBY_SPONSOR}"></div>
        <div id="form-errors"></div>
        <button type="submit" class="ashby-application-form-submit-button">Submit Application</button>
      </form>
    </div>`;
  return shell(
    "Solutions Engineer @ Example Corp",
    `body{background:#fafafa} .wrap{max-width:720px;margin:32px auto;background:#fff;border:1px solid #ececec;border-radius:12px;padding:32px} h1{margin:0 0 4px;font-size:26px} .meta{color:#6b6b6b}
     nav{display:flex;gap:20px;border-bottom:1px solid #ececec;margin:20px 0} nav a{padding:10px 0;color:#6b6b6b;text-decoration:none;font-weight:600} nav a[aria-selected=true]{color:#4f46e5;border-bottom:2px solid #4f46e5}
     .ashby-application-form-field-entry{margin:18px 0} .ashby-application-form-question-title{display:block;font-weight:600;margin-bottom:6px} .req{color:#e11d48;margin-left:2px}
     ._yesno_2ab3{display:flex;gap:8px} ._option_9f1{flex:1;border:1px solid #d4d4d8;background:#fff;border-radius:8px;padding:8px;cursor:pointer;font:inherit} ._option_9f1[aria-pressed=true]{border-color:#4f46e5;background:#eef2ff;color:#3730a3;font-weight:600}
     ._autofillPane_x1{border:1px dashed #c7d2fe;background:#f5f7ff;border-radius:10px;padding:14px 16px;margin-bottom:18px} ._autofill_title{font-weight:600;margin:0} .hint{color:#6b6b6b;margin:2px 0 8px;font-size:13px}
     button{font:inherit} ._fileUpload button,._autofillPane_x1 button{border:1px solid #d4d4d8;background:#fff;border-radius:8px;padding:6px 14px;cursor:pointer}
     .ashby-application-form-submit-button{width:100%;background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:12px;font-weight:600;cursor:pointer;margin-top:12px}
     .ashby-application-form-success-container{text-align:center;padding:40px 0} .error{color:#e11d48}`,
    `<div class="wrap"><div class="ashby-job-posting-brief"><h1>Solutions Engineer</h1><p class="meta">Example Corp · Remote (US) · Full time</p></div>
      <nav role="tablist"><a role="tab" href="${base}" aria-selected="true" id="tab-overview">Overview</a><a role="tab" href="${base}/application" id="tab-application">Application</a></nav>
      <div id="view"><div class="ashby-job-posting-description"><p>Help mid-market customers evaluate and roll out Example Corp. You'll run demos, scope technical requirements and partner with account executives.</p><p><a class="ashby-job-posting-apply-button" href="${base}/application">Apply for this Job</a></p></div></div></div>`,
    `<script>
      const FORM = ${JSON.stringify(formHtml)};
      const view = document.getElementById("view");
      const showForm = () => {
        view.innerHTML = FORM;
        document.getElementById("tab-overview").setAttribute("aria-selected", "false");
        document.getElementById("tab-application").setAttribute("aria-selected", "true");
        for (const group of view.querySelectorAll("._yesno_2ab3")) {
          const hidden = view.querySelector('input[name="' + group.dataset.name + '"]');
          for (const b of group.querySelectorAll("button")) b.addEventListener("click", () => {
            group.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
            hidden.value = b.textContent;
          });
        }
        const s = document.createElement("script"); s.textContent = ${JSON.stringify(WIDGETS_JS.replace(/^<script>|<\/script>$/g, ""))}; document.body.append(s);
        view.querySelector("form").addEventListener("submit", async () => {
          const data = new FormData(view.querySelector("form"));
          const r = await fetch("${base}/application/submit", { method: "POST", body: data });
          const j = await r.json();
          if (j.ok) { view.innerHTML = '<div class="ashby-application-form-success-container"><h2>Thank you for applying</h2><p>Your application was successfully submitted. We\\'ll contact you if there are next steps.</p></div>'; return; }
          for (const [name, msg] of Object.entries(j.errors)) {
            const el = view.querySelector('[name="' + name + '"]');
            const target = el && el.type === "hidden" ? (view.querySelector('[data-name="' + name + '"]') || view.querySelector('[data-target="' + name + '"]')) : el;
            if (target) { target.setAttribute("aria-invalid", "true"); const p = document.createElement("p"); p.className = "error"; p.textContent = msg; target.after(p); }
          }
          document.getElementById("form-errors").innerHTML = '<p class="error" role="alert">Please fix the errors above.</p>';
        });
      };
      for (const a of document.querySelectorAll('a[href$="/application"]')) a.addEventListener("click", (e) => { e.preventDefault(); history.pushState({}, "", "${base}/application"); showForm(); });
      if (location.pathname.endsWith("/application")) showForm();
    </script>`,
  );
}

async function ashby(req: IncomingMessage, res: ServerResponse, path: string, h: AtsHelpers): Promise<boolean> {
  const base = `/ashby/examplecorp/${ASHBY_ID}`;
  if (path === `${base}/application/submit` && req.method === "POST") {
    const { fields, files } = await h.readForm(req);
    const errors = requireAll(["_systemfield_name", "_systemfield_email", "_systemfield_location_value", "_systemfield_resume", ASHBY_AUTH, ASHBY_SPONSOR], fields, files, ["_systemfield_resume"]);
    if (Object.keys(errors).length) {
      h.send(res, 200, JSON.stringify({ ok: false, errors }), "application/json");
      return true;
    }
    h.record("ashby", fields, files);
    h.send(res, 200, JSON.stringify({ ok: true }), "application/json");
    return true;
  }
  if (path === base || path === `${base}/application`) {
    h.send(res, 200, ashbyPage());
    return true;
  }
  return false;
}

// ─── Workday ────────────────────────────────────────────────────────────────

const WD_BASE = "/workday/examplecorp/job/New-York-NY/Business-Development-Representative_R12345";

interface WdField {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "listbox" | "radio" | "checkbox" | "file";
  required?: boolean;
  options?: string[];
  automationId: string;
}

const WD_STEPS: Array<{ title: string; fields: WdField[] }> = [
  {
    title: "My Information",
    fields: [
      { name: "source", label: "How Did You Hear About Us?", type: "listbox", required: true, options: ["Job Board", "LinkedIn", "Company Website", "Referral"], automationId: "sourceDropdown" },
      { name: "previousWorker", label: "Have you previously worked for Example Corp?", type: "radio", required: true, options: ["Yes", "No"], automationId: "previousWorker" },
      { name: "country", label: "Country", type: "listbox", required: true, options: ["Canada", "United Kingdom", "United States of America"], automationId: "countryDropdown" },
      { name: "firstName", label: "First Name", required: true, automationId: "legalNameSection_firstName" },
      { name: "lastName", label: "Last Name", required: true, automationId: "legalNameSection_lastName" },
      { name: "addressLine1", label: "Address Line 1", automationId: "addressSection_addressLine1" },
      { name: "city", label: "City", required: true, automationId: "addressSection_city" },
      { name: "state", label: "State", type: "listbox", required: true, options: ["California", "New Jersey", "New York", "Texas"], automationId: "addressSection_countryRegion" },
      { name: "postalCode", label: "Postal Code", automationId: "addressSection_postalCode" },
      { name: "email", label: "Email Address", type: "email", required: true, automationId: "email" },
      { name: "phoneType", label: "Phone Device Type", type: "listbox", required: true, options: ["Landline", "Mobile", "Telephone"], automationId: "phone-device-type" },
      { name: "phone", label: "Phone Number", type: "tel", required: true, automationId: "phone-number" },
    ],
  },
  {
    title: "My Experience",
    fields: [
      { name: "resume", label: "Resume/CV", type: "file", required: true, automationId: "file-upload-input-ref" },
      { name: "linkedin", label: "LinkedIn Profile URL", automationId: "linkedinQuestion" },
    ],
  },
  {
    title: "Application Questions",
    fields: [
      { name: "authorized", label: "Are you legally authorized to work in the country in which this job is located?", type: "listbox", required: true, options: ["Yes", "No"], automationId: "authorizedToWork" },
      { name: "sponsorship", label: "Will you now or in the future require sponsorship for employment visa status?", type: "listbox", required: true, options: ["Yes", "No"], automationId: "requiresSponsorship" },
    ],
  },
  {
    title: "Voluntary Disclosures",
    fields: [
      { name: "gender", label: "Gender", type: "listbox", options: ["Male", "Female", "I do not wish to answer"], automationId: "gender" },
      { name: "veteran", label: "Veteran Status", type: "listbox", options: ["I am not a veteran", "I identify as a protected veteran", "I do not wish to answer"], automationId: "veteranStatus" },
      { name: "terms", label: "I have read and consent to the terms and conditions", type: "checkbox", required: true, automationId: "agreementCheckbox" },
    ],
  },
];
const WD_REVIEW = WD_STEPS.length;

function workdayFrame(title: string, body: string, scripts = ""): string {
  return shell(
    `${title} | Example Corp Careers`,
    `body{background:#f2f2f2} header{background:#0b4d8c;color:#fff;padding:14px 32px;font-weight:600} main{max-width:860px;margin:24px auto;background:#fff;border-radius:8px;padding:28px 36px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
     h2{font-size:22px;margin:0 0 16px} .wd-field{margin:16px 0;max-width:420px} label,legend{display:block;font-weight:600;font-size:14px;margin-bottom:6px} abbr{color:#c0362c;text-decoration:none;margin-left:2px}
     button[aria-haspopup=listbox]{width:100%;text-align:left;padding:8px 10px;border:1px solid #a6a6a6;border-radius:4px;background:#fff;font:inherit;cursor:pointer}
     ol[data-automation-id=progressBar]{display:flex;gap:6px;list-style:none;padding:0;margin:0 0 24px} ol[data-automation-id=progressBar] li{flex:1;border-top:4px solid #ddd;padding-top:6px;font-size:12px;color:#666} ol[data-automation-id=progressBar] li[data-current]{border-color:#0b4d8c;color:#0b4d8c;font-weight:600} ol[data-automation-id=progressBar] li[data-done]{border-color:#7aa7d4}
     footer{display:flex;justify-content:space-between;margin-top:32px;border-top:1px solid #e6e6e6;padding-top:16px} .wd-btn{border:1px solid #0b4d8c;background:#fff;color:#0b4d8c;border-radius:20px;padding:8px 22px;font-weight:600;cursor:pointer;text-decoration:none;font-size:14px}
     .wd-primary{background:#0b4d8c;color:#fff} [data-automation-id=errorBanner]{background:#fdecea;border:1px solid #f5c2bd;color:#8a1c12;padding:10px 12px;border-radius:6px;margin-bottom:12px}
     [data-automation-id=errorMessage]{color:#c0362c;font-size:13px} .drop{border:1px dashed #a6a6a6;border-radius:6px;padding:18px;text-align:center;color:#666} dl{display:grid;grid-template-columns:240px 1fr;gap:6px 16px} dt{color:#666}`,
    `<header>Example Corp Careers</header><main>${body}</main>`,
    scripts,
  );
}

function workdayStep(step: number, values: Values, files: Files, errors: Record<string, string> = {}): string {
  const progress = `<ol data-automation-id="progressBar">${[...WD_STEPS.map((s) => s.title), "Review"].map((t, i) => `<li${i === step ? " data-current" : i < step ? " data-done" : ""}>${esc(t)}</li>`).join("")}</ol>`;
  const footer = (primary: string) =>
    `<footer>${step > 0 ? `<a class="wd-btn" data-automation-id="bottom-navigation-previous-button" href="${WD_BASE}/apply/step/${step - 1}">Back</a>` : "<span></span>"}<button class="wd-btn wd-primary" type="submit" data-automation-id="bottom-navigation-next-button">${primary}</button></footer>`;
  if (step === WD_REVIEW) {
    const rows = WD_STEPS.flatMap((s) => s.fields).map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.type === "file" ? files[f.name]?.name ?? "" : str(values[f.name]))}</dd>`).join("");
    return workdayFrame("Review", `<div data-automation-id="applyFlowPage">${progress}<div data-automation-id="reviewJobApplicationPage"><h2>Review</h2><dl>${rows}</dl></div><form method="post" action="${WD_BASE}/apply/step/${step}">${footer("Submit")}</form></div>`);
  }
  const def = WD_STEPS[step]!;
  let n = step * 20;
  const fieldHtml = def.fields
    .map((f) => {
      const id = `input-${++n}`;
      const err = errors[f.name];
      const req = f.required ? ' aria-required="true"' : "";
      const star = f.required ? '<abbr title="required">*</abbr>' : "";
      const invalid = err ? ` aria-invalid="true" aria-describedby="${id}-error"` : "";
      const errHtml = err ? `<div data-automation-id="errorMessage" id="${id}-error">${esc(err)}</div>` : "";
      const v = str(values[f.name]);
      switch (f.type) {
        case "listbox":
          return `<div class="wd-field" data-automation-id="formField-${f.automationId}"><label for="${id}">${esc(f.label)}${star}</label><button type="button" id="${id}" aria-haspopup="listbox" aria-controls="${id}-listbox" data-automation-id="${f.automationId}" data-target="${f.name}" data-options="${esc(JSON.stringify(f.options))}"${req}${invalid}>${esc(v || "Select One")}</button><input type="hidden" name="${f.name}" value="${esc(v)}">${errHtml}</div>`;
        case "radio":
          return `<div class="wd-field" data-automation-id="formField-${f.automationId}"><fieldset data-automation-id="${f.automationId}"${invalid}><legend>${esc(f.label)}${star}</legend>${f.options!.map((o, i) => `<label style="font-weight:400;display:flex;gap:8px"><input type="radio" name="${f.name}" value="${esc(o)}" id="${id}-${i}"${v === o ? " checked" : ""}${f.required && i === 0 ? " required" : ""}> ${esc(o)}</label>`).join("")}</fieldset>${errHtml}</div>`;
        case "checkbox":
          return `<div class="wd-field" data-automation-id="formField-${f.automationId}"><label style="font-weight:400;display:flex;gap:8px" for="${id}"><input type="checkbox" id="${id}" name="${f.name}" value="yes" data-automation-id="${f.automationId}"${v ? " checked" : ""}${req}${invalid}> ${esc(f.label)}${star}</label>${errHtml}</div>`;
        case "file":
          return `<div class="wd-field" data-automation-id="resumeSection"><h3 id="${id}-heading" style="font-size:15px;margin:0 0 6px">${esc(f.label)}${star}</h3><div class="drop" data-automation-id="file-upload-drop-zone">Drop file here <button type="button" class="wd-btn" data-automation-id="select-files" onclick="document.getElementById('${id}').click()">Select files</button><div id="${id}-name">${esc(files[f.name]?.name ?? "")}</div><input type="file" id="${id}" name="${f.name}" data-automation-id="${f.automationId}" aria-labelledby="${id}-heading" style="display:none"${req} onchange="document.getElementById('${id}-name').textContent=this.files[0]?.name||''"></div>${errHtml}</div>`;
        default:
          return `<div class="wd-field" data-automation-id="formField-${f.automationId}"><label for="${id}">${esc(f.label)}${star}</label><input type="${f.type ?? "text"}" id="${id}" name="${f.name}" data-automation-id="${f.automationId}" value="${esc(v)}"${req}${invalid}>${errHtml}</div>`;
      }
    })
    .join("");
  const banner = Object.keys(errors).length ? `<div data-automation-id="errorBanner" role="alert">Errors Found: ${Object.keys(errors).length}</div>` : "";
  return workdayFrame(
    def.title,
    `<div data-automation-id="applyFlowPage">${progress}<h2>${esc(def.title)}</h2>${banner}<form method="post" action="${WD_BASE}/apply/step/${step}" enctype="multipart/form-data" novalidate>${fieldHtml}${footer("Save and Continue")}</form></div>`,
    WIDGETS_JS,
  );
}

async function workday(req: IncomingMessage, res: ServerResponse, path: string, h: AtsHelpers): Promise<boolean> {
  if (!path.startsWith("/workday/")) return false;
  const flow = h.session.steps.workday ?? (h.session.steps.workday = { values: {}, files: {} });
  if (path === WD_BASE) {
    h.send(res, 200, workdayFrame("Business Development Representative", `<h2 data-automation-id="jobPostingHeader">Business Development Representative</h2><p>New York, NY · Full time · R12345</p><p>Build pipeline for Example Corp's mid-market sales team.</p><a class="wd-btn wd-primary" role="button" data-automation-id="adventureButton" href="${WD_BASE}/apply">Apply</a>`));
    return true;
  }
  if (path === `${WD_BASE}/apply`) {
    h.send(res, 200, workdayFrame("Start Your Application", `<h2>Start Your Application</h2><div style="display:grid;gap:10px;max-width:320px"><a class="wd-btn" role="button" data-automation-id="autofillWithResume" href="${WD_BASE}/apply/autofillWithResume">Autofill with Resume</a><a class="wd-btn" role="button" data-automation-id="applyManually" href="${WD_BASE}/apply/applyManually">Apply Manually</a><a class="wd-btn" role="button" data-automation-id="useMyLastApplication" href="${WD_BASE}/apply/useMyLastApplication">Use My Last Application</a></div>`));
    return true;
  }
  if (path === `${WD_BASE}/apply/autofillWithResume` || path === `${WD_BASE}/apply/useMyLastApplication`) {
    h.flagForbidden(`workday: ${path.split("/").pop()}`);
    h.redirect(res, `${WD_BASE}/apply/applyManually`);
    return true;
  }
  if (path === `${WD_BASE}/apply/applyManually` || path === `${WD_BASE}/signin`) {
    if (req.method === "POST") {
      const { fields } = await h.readForm(req);
      if (fields.email && fields.password) h.session.signedIn = true;
    }
    if (h.signedIn()) {
      h.redirect(res, `${WD_BASE}/apply/step/0`);
      return true;
    }
    h.send(
      res,
      200,
      workdayFrame(
        "Sign In",
        `<h2>Sign In</h2><form method="post" action="${WD_BASE}/signin" style="max-width:360px"><div class="wd-field"><label for="wd-email">Email Address</label><input type="email" id="wd-email" name="email" data-automation-id="email"></div><div class="wd-field"><label for="wd-password">Password</label><input type="password" id="wd-password" name="password" data-automation-id="password"></div><button class="wd-btn wd-primary" type="submit" data-automation-id="signInSubmitButton">Sign In</button> <a href="${WD_BASE}/createAccount" data-automation-id="createAccountLink">Create Account</a></form>`,
        `<script>setInterval(async()=>{const r=await fetch("/login/state");const j=await r.json();if(j.signedIn)location.href="${WD_BASE}/apply/step/0";},1000)</script>`,
      ),
    );
    return true;
  }
  if (path === `${WD_BASE}/apply/submitted`) {
    h.send(res, 200, workdayFrame("Application Submitted", `<h2>Application Submitted</h2><p>Congratulations! Your application has been submitted. You can track its status from your candidate home.</p>`));
    return true;
  }
  const m = /\/apply\/step\/(\d+)$/.exec(path);
  if (!m || !path.startsWith(WD_BASE)) return false;
  if (!h.signedIn()) {
    h.redirect(res, `${WD_BASE}/apply/applyManually`);
    return true;
  }
  const step = Math.min(WD_REVIEW, Number(m[1]));
  if (req.method === "POST") {
    if (step === WD_REVIEW) {
      h.record("workday", flow.values, flow.files);
      h.session.steps.workday = { values: {}, files: {} };
      h.redirect(res, `${WD_BASE}/apply/submitted`);
      return true;
    }
    const { fields, files } = await h.readForm(req);
    const def = WD_STEPS[step]!;
    const known = { ...flow.files, ...files };
    const errors = requireAll(def.fields.filter((f) => f.required).map((f) => f.name), fields, known, def.fields.filter((f) => f.type === "file").map((f) => f.name));
    if (Object.keys(errors).length) {
      h.send(res, 422, workdayStep(step, { ...flow.values, ...fields }, known, errors));
      return true;
    }
    Object.assign(flow.values, fields);
    Object.assign(flow.files, files);
    h.redirect(res, `${WD_BASE}/apply/step/${step + 1}`);
    return true;
  }
  h.send(res, 200, workdayStep(step, flow.values, flow.files));
  return true;
}

// ─── SmartRecruiters ────────────────────────────────────────────────────────

const SR_JOB = "/smartrecruiters/ExampleCorp/743999-inside-sales-representative";
const SR_FORM = "/smartrecruiters/oneclick-ui/company/ExampleCorp/publication/6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** SmartRecruiters' design system renders each field as a web component with its input in a shadow root. */
const SPL_COMPONENTS = String.raw`<script>
  const STYLE = '<style>:host{display:block;margin:14px 0} label{display:block;font-weight:600;font-size:14px;margin-bottom:6px;color:#2a2a2a} input,select,textarea{width:100%;padding:9px 11px;border:1px solid #c4c4c4;border-radius:4px;font:inherit;box-sizing:border-box} .opt{display:flex;gap:8px;font-weight:400;align-items:center} [aria-invalid=true]{border-color:#d32f2f}</style>';
  const field = (host) => ({ name: host.getAttribute("name"), label: host.getAttribute("label"), required: host.hasAttribute("required"), type: host.getAttribute("type") || "text" });
  customElements.define("spl-input", class extends HTMLElement {
    connectedCallback() {
      const f = field(this);
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = STYLE + '<label for="i">' + f.label + (f.required ? " *" : "") + '</label><input id="i" type="' + f.type + '" name="' + f.name + '"' + (f.required ? " required aria-required=true" : "") + '>';
    }
    get value() { return this.shadowRoot.querySelector("input").value; }
  });
  customElements.define("spl-textarea", class extends HTMLElement {
    connectedCallback() {
      const f = field(this);
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = STYLE + '<label for="t">' + f.label + '</label><textarea id="t" rows="4" name="' + f.name + '"></textarea>';
    }
    get value() { return this.shadowRoot.querySelector("textarea").value; }
  });
  customElements.define("spl-select", class extends HTMLElement {
    connectedCallback() {
      const f = field(this);
      const opts = this.getAttribute("options").split("|");
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = STYLE + '<label for="s">' + f.label + (f.required ? " *" : "") + '</label><select id="s" name="' + f.name + '"' + (f.required ? " required aria-required=true" : "") + '><option value="">Select</option>' + opts.map((o) => "<option>" + o + "</option>").join("") + "</select>";
    }
    get value() { return this.shadowRoot.querySelector("select").value; }
  });
  customElements.define("spl-checkbox", class extends HTMLElement {
    connectedCallback() {
      const f = field(this);
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = STYLE + '<label class="opt" for="c"><input type="checkbox" id="c" name="' + f.name + '"' + (f.required ? " required aria-required=true" : "") + " style=width:auto> " + f.label + (f.required ? " *" : "") + "</label>";
    }
    get value() { return this.shadowRoot.querySelector("input").checked ? "yes" : ""; }
  });
</script>`;

function smartRecruitersForm(): string {
  return shell(
    "Inside Sales Representative - Example Corp",
    `body{background:#f4f5f7} .card{max-width:680px;margin:28px auto;background:#fff;border-radius:6px;padding:28px 32px;box-shadow:0 1px 2px rgba(0,0,0,.08)} h1{font-size:22px;margin:0} .sub{color:#666;margin:2px 0 20px}
     .social{display:flex;gap:8px;margin-bottom:18px} .social button{flex:1;border:1px solid #c4c4c4;background:#fff;border-radius:4px;padding:9px;font:inherit;cursor:pointer} h3{font-size:16px;margin:24px 0 4px}
     .resume{margin:14px 0} .resume span{display:block;font-weight:600;font-size:14px;margin-bottom:6px} .resume button{border:1px dashed #0073e6;background:#f0f7ff;color:#0073e6;border-radius:4px;padding:12px;width:100%;cursor:pointer;font:inherit}
     [data-test=footer-submit]{background:#0073e6;color:#fff;border:0;border-radius:4px;padding:11px 28px;font:inherit;font-weight:600;cursor:pointer} .error{color:#d32f2f}`,
    `<div class="card"><h1>Inside Sales Representative</h1><p class="sub">Example Corp · Chicago, IL</p>
      <oc-application-form data-test="application-form">
        <div class="social"><button type="button" data-test="apply-with-linkedin" onclick="location.href='/smartrecruiters/oauth/linkedin'">Apply with LinkedIn</button><button type="button" data-test="apply-with-indeed" onclick="location.href='/smartrecruiters/oauth/indeed'">Apply with Indeed</button></div>
        <h3>Personal information</h3>
        <spl-input name="firstName" label="First name" required></spl-input>
        <spl-input name="lastName" label="Last name" required></spl-input>
        <spl-input name="email" label="Email" type="email" required></spl-input>
        <spl-input name="confirmEmail" label="Confirm your email" type="email" required></spl-input>
        <spl-input name="phoneNumber" label="Phone number" type="tel" required></spl-input>
        <spl-input name="linkedin" label="LinkedIn profile" type="url"></spl-input>
        <div class="resume"><span id="resume-label">Resume *</span><button type="button" onclick="document.getElementById('resume-input').click()">Choose a file or drop it here</button> <small id="resume-name"></small><input type="file" id="resume-input" name="resume" aria-labelledby="resume-label" aria-required="true" class="visually-hidden" onchange="document.getElementById('resume-name').textContent=this.files[0]?.name||''"></div>
        <h3>Screening questions</h3>
        <spl-select name="q_authorized" label="${esc(AUTH_Q)}" options="Yes|No" required></spl-select>
        <spl-select name="q_sponsorship" label="${esc(SPONSOR_Q)}" options="Yes|No" required></spl-select>
        <spl-textarea name="message" label="Message to the Hiring Team"></spl-textarea>
        <div id="errors"></div>
        <p><button type="button" data-test="footer-submit">Submit</button></p>
      </oc-application-form></div>`,
    `${SPL_COMPONENTS}<script>
      document.querySelector("[data-test=footer-submit]").addEventListener("click", async () => {
        const form = document.querySelector("oc-application-form");
        const data = new FormData();
        for (const el of form.querySelectorAll("spl-input, spl-select, spl-textarea, spl-checkbox")) data.append(el.getAttribute("name"), el.value);
        const file = document.getElementById("resume-input").files[0];
        if (file) data.append("resume", file);
        const r = await fetch("${SR_FORM}/submit", { method: "POST", body: data });
        const j = await r.json();
        if (j.ok) { document.querySelector(".card").innerHTML = "<h1>Thank you for applying!</h1><p>Your application has been successfully submitted to Example Corp. Reference number: " + j.reference + "</p>"; return; }
        for (const name of Object.keys(j.errors)) {
          const host = form.querySelector('[name="' + name + '"]');
          const input = host && host.shadowRoot && host.shadowRoot.querySelector("input,select,textarea");
          if (input) input.setAttribute("aria-invalid", "true");
        }
        document.getElementById("errors").innerHTML = '<p class="error" role="alert">' + Object.values(j.errors).join(" ") + "</p>";
      });
    </script>`,
  );
}

async function smartRecruiters(req: IncomingMessage, res: ServerResponse, path: string, h: AtsHelpers): Promise<boolean> {
  if (path === "/smartrecruiters/oauth/linkedin" || path === "/smartrecruiters/oauth/indeed") {
    h.flagForbidden(`smartrecruiters: ${path.split("/").pop()}`);
    h.send(res, 200, shell("Sign in", "", "<h1>Sign in</h1><form><input type=password name=p></form>"));
    return true;
  }
  if (path === SR_JOB) {
    h.send(
      res,
      200,
      shell(
        "Inside Sales Representative - Example Corp",
        `body{background:#f4f5f7} .job{max-width:760px;margin:28px auto;background:#fff;border-radius:6px;padding:32px} [data-test=footer-apply]{background:#0073e6;color:#fff;border:0;border-radius:4px;padding:11px 28px;font:inherit;font-weight:600;cursor:pointer}`,
        `<div class="job"><h1 class="job-title">Inside Sales Representative</h1><p>Example Corp · Chicago, IL · Full-time</p><p>Qualify inbound leads and run discovery calls for our SMB team.</p><button type="button" data-test="footer-apply" onclick="location.href='${SR_FORM}'">I'm interested</button></div>`,
      ),
    );
    return true;
  }
  if (path === `${SR_FORM}/submit` && req.method === "POST") {
    const { fields, files } = await h.readForm(req);
    const errors = requireAll(["firstName", "lastName", "email", "confirmEmail", "phoneNumber", "resume", "q_authorized", "q_sponsorship"], fields, files, ["resume"]);
    if (!errors.confirmEmail && str(fields.confirmEmail) !== str(fields.email)) errors.confirmEmail = "Emails don't match";
    if (Object.keys(errors).length) {
      h.send(res, 200, JSON.stringify({ ok: false, errors }), "application/json");
      return true;
    }
    const reference = h.record("smartrecruiters", fields, files);
    h.send(res, 200, JSON.stringify({ ok: true, reference }), "application/json");
    return true;
  }
  if (path === SR_FORM) {
    h.send(res, 200, smartRecruitersForm());
    return true;
  }
  return false;
}

/** Entry pages for each mock ATS, as a job's application link would point to them. */
export const ATS_ENTRY_POINTS = {
  greenhouse: GH_PATH,
  lever: `/lever/examplecorp/${LEVER_ID}`,
  leverGuarded: `/lever/examplecorp/${LEVER_GUARDED_ID}`,
  ashby: `/ashby/examplecorp/${ASHBY_ID}`,
  workday: WD_BASE,
  smartrecruiters: SR_JOB,
} as const;

/** Handle a request for one of the mock ATSs; false when the path isn't theirs. */
export async function handleAtsRequest(req: IncomingMessage, res: ServerResponse, path: string, helpers: AtsHelpers): Promise<boolean> {
  for (const handler of [greenhouse, lever, ashby, workday, smartRecruiters]) {
    if (await handler(req, res, path, helpers)) return true;
  }
  return false;
}
