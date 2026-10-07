// Runs in a tab the person opened from the Applyance popup to finish an
// application themselves. It fills the answers Applyance already has (the
// same ones the worker would use), marks what's left for the person, and shows
// a small panel. It never solves a CAPTCHA, never touches a password field,
// and never presses Submit: the person does those.
(() => {
  if (window.__applyanceHandoff) return;
  window.__applyanceHandoff = true;
  if (/(^|\.)linkedin\.com$/i.test(location.hostname)) return;

  const page = globalThis.__applyancePage;
  const isTop = window === window.top;
  const TICK_MS = 1500;
  const MARK = "data-applyance-yours";

  const send = async (message) => {
    const response = await chrome.runtime.sendMessage(message);
    if (!response) return null;
    if (!response.ok) throw new Error(response.error);
    return response.result;
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

  // ─── Finding and filling fields ───────────────────────────────────────────

  /** Follow a scan DOM path, which uses " >> " to step into shadow roots. */
  function byPath(path) {
    let root = document;
    let el = null;
    for (const part of path.split(" >> ")) {
      el = root.querySelector(part);
      if (!el) return null;
      root = el.shadowRoot || el;
    }
    return el;
  }

  function groupInputs(field) {
    const first = byPath(field.domPath);
    if (!first) return [];
    if (!field.name) return [first];
    const root = first.getRootNode();
    return Array.from(root.querySelectorAll(`input[type="${field.kind}"][name="${CSS.escape(field.name)}"]`));
  }

  function labelText(input) {
    const label = (input.labels && input.labels[0]) || input.closest("label");
    return clean(label ? label.textContent : input.value);
  }

  /** Set a value the way typing would, so frameworks (React and others) notice. */
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  async function waitForOption(predicate, ms = 1500) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const option = Array.from(document.querySelectorAll('[role="option"]')).find((o) => visible(o) && predicate(clean(o.textContent)));
      if (option) return option;
      await sleep(100);
    }
    return null;
  }

  const escape = (el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  /** @returns {Promise<boolean>} whether the page now shows the value */
  async function fill(field, value) {
    const el = byPath(field.domPath);
    if (!el) return false;
    const widget = field.widget || "native";
    const kind = field.kind;
    if (kind === "radio" && widget === "buttons") {
      const button = Array.from(el.querySelectorAll('button, [role="radio"]')).find((b) => same(b.textContent, value));
      if (!button) return false;
      button.click();
      return true;
    }
    if (kind === "radio" || (kind === "checkbox" && field.multiple)) {
      const wanted = Array.isArray(value) ? value : [value];
      const inputs = groupInputs(field);
      const options = field.options || [];
      const matches = (input, option) => same(labelText(input), option) || (field.optionValues && input.value === field.optionValues[options.indexOf(option)]);
      let ok = true;
      for (const option of wanted) if (!inputs.some((i) => matches(i, option))) ok = false;
      if (!ok) return false;
      for (const input of inputs) {
        const should = wanted.some((option) => matches(input, option));
        if (kind === "radio" ? should && !input.checked : input.checked !== should) input.click();
      }
      return true;
    }
    if (kind === "checkbox") {
      const want = value === "Yes";
      if (el.checked !== want) el.click();
      return el.checked === want;
    }
    if (el instanceof HTMLSelectElement) {
      const option = Array.from(el.options).find((o) => same(o.textContent, value));
      if (!option) return false;
      setValue(el, option.value);
      return true;
    }
    if (widget === "listbox") {
      el.click();
      const option = await waitForOption((text) => same(text, value));
      if (!option) {
        escape(el);
        return false;
      }
      option.click();
      return true;
    }
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    if (widget === "combobox" || widget === "autocomplete") {
      el.click();
      setValue(el, text);
      const option = await waitForOption((t) => same(t, text) || (widget === "autocomplete" && t.toLowerCase().startsWith(text.toLowerCase())));
      if (option) {
        option.click();
        return true;
      }
      if (widget === "combobox") {
        escape(el);
        setValue(el, "");
        return false;
      }
      return true;
    }
    setValue(el, text);
    return true;
  }

  async function attach(field, kind, fileName) {
    const input = byPath(field.domPath);
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return false;
    const doc = await send({ type: "handoff:document", kind });
    if (!doc) return false;
    const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], fileName, { type: doc.type }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function markYours(field) {
    const el = byPath(field.domPath);
    const target = el && (el.type === "file" ? el.parentElement : el);
    if (!target || target.hasAttribute(MARK)) return;
    target.setAttribute(MARK, "");
    target.style.outline = "2px dashed #f59e0b";
    target.style.outlineOffset = "2px";
  }

  /** Fill one page of the form from the plan Applyance worked out for it. */
  async function fillPage(fields, newPage) {
    const { plan } = await send({ type: "handoff:fill", url: location.href, newPage, fields });
    const yours = [];
    const failed = [];
    let filled = 0;
    // Files first: some sites read a resume and rewrite the fields, which are then set back below.
    for (const item of plan.filter((p) => p.action === "upload")) {
      if (await attach(fields[item.index], item.document, item.fileName).catch(() => false)) filled++;
      else failed.push(item.label);
    }
    if (filled) await sleep(1200);
    for (const item of plan.filter((p) => p.action === "fill")) {
      if (await fill(fields[item.index], item.value).catch(() => false)) filled++;
      else {
        failed.push(item.label);
        markYours(fields[item.index]);
      }
    }
    for (const item of plan.filter((p) => p.action === "yours")) {
      yours.push(item.label);
      markYours(fields[item.index]);
    }
    await send({ type: "handoff:status", status: { filled, yours, failed } });
  }

  // ─── Watching the page ───────────────────────────────────────────────────

  let signature = "";
  let busy = false;
  let stopped = false;
  let security = { captcha: false, mfa: false, login: false };

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const context = await send({ type: "handoff:context" });
      if (!context) return;
      if (context.done) {
        if (isTop) panel.render(context);
        return;
      }
      security = page.security({});
      const fields = page.scanFields(context.scanOptions || {});
      const confirmation = page.confirmation({});
      if (confirmation.confirmed && fields.length === 0) {
        await send({ type: "handoff:submitted", detected: true, confirmation: confirmation.confirmation });
        return;
      }
      if (isTop) panel.render(context);
      // Sign-in pages are the person's alone.
      if (security.login || security.mfa || !fields.length) return;
      const next = fields.map((f) => f.domPath + "|" + f.label).join("\n");
      if (next === signature) return;
      // Entirely different fields mean the form moved on to its next page.
      const newPage = !!signature && !fields.some((f) => signature.includes(f.domPath + "|"));
      signature = next;
      await fillPage(fields, newPage);
    } catch (error) {
      if (isTop) panel.error(error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
    }
  }

  // ─── The panel (top frame only) ──────────────────────────────────────────

  const panel = (() => {
    if (!isTop) return { render() {}, error() {} };
    const host = document.createElement("div");
    host.id = "applyance-panel";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { all: initial; }
      .card { font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #18181b; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.15); width: 320px; overflow: hidden; }
      .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #f4f4f5; }
      .logo { width: 20px; height: 20px; border-radius: 6px; background: #4f46e5; color: #fff; font-weight: 700; font-size: 12px; display: grid; place-items: center; flex: none; }
      .title { flex: 1; min-width: 0; }
      .title b { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .title span { color: #71717a; font-size: 12px; }
      .x { border: 0; background: none; color: #a1a1aa; font-size: 18px; cursor: pointer; line-height: 1; padding: 2px 4px; }
      .body { padding: 10px 12px 12px; display: grid; gap: 8px; }
      .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px; }
      .ok { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px; }
      .err { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px; color: #991b1b; }
      ul { margin: 4px 0 0; padding-left: 18px; }
      .muted { color: #71717a; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      button.btn { font: inherit; font-weight: 500; border-radius: 8px; padding: 6px 10px; cursor: pointer; border: 1px solid #e4e4e7; background: #fff; color: #18181b; }
      button.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
      button.btn:disabled { opacity: .6; cursor: default; }
      .links { display: flex; gap: 12px; font-size: 12px; }
      .links a { color: #4f46e5; cursor: pointer; text-decoration: none; }
    </style><div class="card"><div class="head"><div class="logo">A</div><div class="title"><b></b><span>Applyance is helping on this tab</span></div><button class="x" title="Hide">×</button></div><div class="body"></div></div>`;
    const body = root.querySelector(".body");
    root.querySelector(".x").addEventListener("click", () => host.remove());
    document.documentElement.appendChild(host);
    let lastError = "";
    let pending = false;

    const el = (tag, attrs = {}, text = "") => {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (text) node.textContent = text;
      return node;
    };
    const button = (label, primary, onClick) => {
      const b = el("button", { class: primary ? "btn primary" : "btn" }, label);
      b.disabled = pending;
      b.addEventListener("click", async () => {
        pending = true;
        lastError = "";
        b.disabled = true;
        try {
          await onClick();
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        } finally {
          pending = false;
          void tick();
        }
      });
      return b;
    };

    let shown = "";
    function render(h) {
      if (!host.isConnected) return;
      // Re-render only on a change, so a click in progress isn't lost.
      const key = JSON.stringify([h.done, h.status, security, lastError, pending]);
      if (key === shown) return;
      shown = key;
      root.querySelector(".title b").textContent = `${h.company} · ${h.title}`;
      body.replaceChildren();
      if (h.done === "submitted") {
        body.append(el("div", { class: "ok" }, "Recorded as submitted. Flightpath shows it as Submitted, and you can close this tab."));
        body.append(links(h, false));
        return;
      }
      if (h.done === "continued") {
        body.append(el("div", { class: "ok" }, "Saved your sign-in. Applyance is carrying on with the application by itself, so you can close this tab."));
        body.append(links(h, false));
        return;
      }
      const { filled, yours, failed } = h.status;
      if (filled) body.append(el("div", {}, `Filled ${filled} field${filled === 1 ? "" : "s"} from your profile and approved answers. Check them before you submit.`));
      const left = [...yours, ...failed];
      if (left.length) {
        const box = el("div", { class: "note" }, `Yours to fill (outlined on the page):`);
        const list = el("ul");
        for (const label of left.slice(0, 6)) list.append(el("li", {}, label));
        if (left.length > 6) list.append(el("li", {}, `and ${left.length - 6} more`));
        box.append(list);
        body.append(box);
      }
      if (security.captcha) body.append(el("div", { class: "note" }, "There's a security check on this page. Solve it yourself; Applyance never does."));
      if (security.login || security.mfa) body.append(el("div", { class: "note" }, "Sign in yourself. Applyance never sees or types your password."));
      body.append(el("div", { class: "muted" }, h.howToFinish));
      if (lastError) body.append(el("div", { class: "err" }, lastError));
      const actions = el("div", { class: "row" });
      if (h.canContinueAfterSignIn) actions.append(button("Continue in Applyance", true, () => send({ type: "handoff:signed-in" })));
      actions.append(button("I submitted it", !h.canContinueAfterSignIn, () => send({ type: "handoff:submitted", detected: false })));
      body.append(actions);
      body.append(links(h, true));
    }

    function links(h, helping) {
      const row = el("div", { class: "links" });
      const open = el("a", { href: h.link, target: "_blank", rel: "noopener" }, "Open in Applyance");
      row.append(open);
      if (helping) {
        const again = el("a", {}, "Fill again");
        again.addEventListener("click", () => {
          signature = "";
          void tick();
        });
        const stop = el("a", {}, "Stop helping here");
        stop.addEventListener("click", async () => {
          stopped = true;
          await send({ type: "handoff:end" }).catch(() => undefined);
          host.remove();
        });
        row.append(again, stop);
      }
      return row;
    }

    return {
      render,
      error(message) {
        lastError = message;
      },
    };
  })();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "handoff:update" && message.handoff && isTop) panel.render(message.handoff);
  });

  void tick();
  setInterval(tick, TICK_MS);
})();
