import { api, connect, DEFAULT_API_URL, disconnect, getConnection, isLinkedIn, normalizeApiUrl, originPattern } from "../lib/api.js";

const app = document.getElementById("app");
const account = document.getElementById("account");
const openApp = document.getElementById("open-app");

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(string | Node)[]} children */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

/** Ask the background worker to do something that must outlive the popup. */
async function background(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? "Something went wrong.");
  return response.result;
}

function busy(button, label) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

const message = (kind, text) => h("div", { class: `box ${kind}` }, text);

// ─── Not connected ───────────────────────────────────────────────────────────

async function renderConnect(savedUrl) {
  account.textContent = "Not connected";
  openApp.hidden = true;
  const address = h("input", { id: "api-url", value: savedUrl ?? DEFAULT_API_URL, autocomplete: "off", spellcheck: "false" });
  const code = h("input", { id: "code", class: "code", placeholder: "ABCD-1234", maxlength: "9", autocomplete: "off", spellcheck: "false" });
  const button = h("button", { class: "btn primary", type: "submit" }, "Connect");
  const status = h("div");
  const form = h(
    "form",
    { class: "grid" },
    h("section", {},
      h("h2", {}, "Connect to your account"),
      h("ol", {}, h("li", {}, "In Applyance, open Settings and find Browser extension."), h("li", {}, "Choose Create code, and type the code below.")),
      h("label", {}, "Code", code),
      h("label", {}, h("span", {}, "Applyance server address ", h("span", { class: "muted small" }, "(usually leave as is)")), address),
      button,
      status,
    ),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.replaceChildren();
    const apiUrl = normalizeApiUrl(address.value);
    if (!apiUrl) return status.append(message("err", "Enter the server's address, like http://localhost:4000."));
    if (!code.value.trim()) return status.append(message("err", "Enter the code from Settings."));
    // Called straight from the click, as Chrome requires; it's a no-op for localhost.
    const allowed = await chrome.permissions.request({ origins: [originPattern(apiUrl)] }).catch(() => false);
    if (!allowed) return status.append(message("err", `Allow the extension to reach ${new URL(apiUrl).host} to connect.`));
    const done = busy(button, "Connecting…");
    try {
      await connect(apiUrl, code.value.trim());
      await render();
    } catch (error) {
      done();
      status.append(message("err", error.message));
    }
  });
  app.replaceChildren(form);
  code.focus();
}

// ─── Connected ───────────────────────────────────────────────────────────────

function renderSave(tab) {
  const linkedIn = tab?.url && isLinkedIn(tab.url);
  const saveable = tab?.url && /^https?:/i.test(tab.url);
  const button = h("button", { class: "btn primary", id: "save" }, "Save job");
  const result = h("div");
  button.disabled = !saveable;
  button.addEventListener("click", async () => {
    result.replaceChildren();
    const done = busy(button, "Saving…");
    try {
      const saved = await background({ type: "save-tab", tab: { id: tab.id, url: tab.url } });
      const ok = saved.result === "saved" || saved.result === "already_saved";
      const box = message(ok ? "ok" : "warn", saved.message);
      if (saved.job) box.append(h("div", { class: "small" }, h("a", { class: "link", href: saved.job.link, target: "_blank", rel: "noopener" }, `Open “${saved.job.title}” in Applyance`)));
      result.append(box);
    } catch (error) {
      result.append(message("err", error.message));
    } finally {
      done();
    }
  });
  return h(
    "section",
    {},
    h("h2", {}, "Save this job"),
    saveable
      ? h("div", { class: "page" }, h("strong", { class: "ellipsis", title: tab.title ?? "" }, tab.title || tab.url), h("span", { class: "muted small ellipsis" }, new URL(tab.url).hostname))
      : h("div", { class: "muted" }, "Open a job's page, then save it here."),
    linkedIn
      ? message("warn", "On LinkedIn, Applyance saves only the link and never reads the page. Paste the job description on the job's page in Applyance to score it.")
      : saveable && h("div", { class: "muted small" }, "Tip: select the job description first to save just that."),
    button,
    result,
  );
}

function renderWaiting(data) {
  const section = h("section", {}, h("h2", {}, `Needs you${data.total ? ` (${data.total})` : ""}`, h("a", { class: "link", href: data.link, target: "_blank", rel: "noopener" }, "Open Needs Attention")));
  if (!data.applications.length) {
    section.append(h("div", { class: "muted" }, "Nothing needs you right now. When an application stops for a CAPTCHA, a sign-in or a question, it shows up here."));
    return section;
  }
  const list = h("div", { class: "list" });
  for (const a of data.applications) {
    const status = h("div");
    const item = h(
      "div",
      { class: "item" },
      h("div", { class: "item-head" }, h("div", { class: "ellipsis" }, h("strong", {}, a.company), h("div", { class: "muted small ellipsis" }, a.title)), h("span", { class: "chip" }, a.reasonLabel ?? a.statusLabel)),
    );
    if (a.canFinishInBrowser) {
      const button = h("button", { class: "btn primary" }, "Finish in my browser");
      button.addEventListener("click", async () => {
        status.replaceChildren();
        // Chrome asks the person to allow the application's site here, before anything opens.
        const allowed = await chrome.permissions.request({ origins: a.origins }).catch(() => false);
        if (!allowed) return status.append(message("err", "Allow Applyance on this site to fill the application there."));
        const done = busy(button, "Opening…");
        try {
          await background({ type: "start-handoff", applicationId: a.id });
          window.close();
        } catch (error) {
          done();
          status.append(message("err", error.message));
        }
      });
      item.append(h("div", { class: "muted small" }, a.howToFinish), h("div", { class: "row" }, button, h("a", { class: "link", href: a.link, target: "_blank", rel: "noopener" }, "Details")));
    } else {
      item.append(h("div", { class: "muted small" }, "Applyance never opens LinkedIn pages. Apply there yourself, then mark it submitted in Applyance."), h("a", { class: "link", href: a.link, target: "_blank", rel: "noopener" }, "Open in Applyance"));
    }
    item.append(status);
    list.append(item);
  }
  section.append(list);
  return section;
}

async function render() {
  const connection = await getConnection();
  if (!connection.token) return renderConnect(connection.apiUrl);
  account.textContent = connection.user?.email ?? "";
  if (connection.appUrl) {
    openApp.href = connection.appUrl;
    openApp.hidden = false;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const footer = h("section", { class: "row small" }, h("span", { class: "muted" }, "Connected to your account."));
  const disconnectButton = h("button", { class: "link" }, "Disconnect");
  disconnectButton.addEventListener("click", async () => {
    await disconnect();
    await render();
  });
  footer.append(disconnectButton);
  const waiting = h("section", {}, h("h2", {}, "Needs you"), h("div", { class: "muted" }, "Loading…"));
  app.replaceChildren(renderSave(tab), waiting, footer);
  try {
    const data = await api("/applications");
    waiting.replaceWith(renderWaiting(data));
    void background({ type: "refresh-badge" }).catch(() => undefined);
  } catch (error) {
    if ((await getConnection()).token) waiting.replaceChildren(h("h2", {}, "Needs you"), message("err", error.message));
    else await renderConnect(connection.apiUrl);
  }
}

void render();
