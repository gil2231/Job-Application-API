// Small, self-contained helpers: what Save reads from a page, and cookie conversion.

/**
 * Runs inside the page the person is saving (chrome.scripting.executeScript),
 * so it must not use anything from outside its own body. Read-only. Never run
 * on LinkedIn: there only the link is saved.
 */
export function capturePage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const meta = (key) => {
    const el = document.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
    return el ? clean(el.getAttribute("content")) : "";
  };
  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => s.textContent || "")
    .filter((t) => /JobPosting/i.test(t))
    .slice(0, 5)
    .map((t) => t.slice(0, 200000));
  const main = document.querySelector("main, [role='main'], article") || document.body;
  const heading = document.querySelector("h1");
  return {
    url: location.href,
    title: meta("og:title") || clean(document.title),
    siteName: meta("og:site_name"),
    heading: heading ? clean(heading.innerText) : "",
    selection: String(window.getSelection() || "").trim().slice(0, 100000),
    text: main ? String(main.innerText || "").trim().slice(0, 100000) : "",
    jsonLd,
  };
}

const SAME_SITE = { no_restriction: "None", lax: "Lax", strict: "Strict", unspecified: "Lax" };

/**
 * chrome.cookies.Cookie[] → the cookie format Applyance's worker loads into
 * its browser (Playwright storage state).
 * @param {chrome.cookies.Cookie[]} cookies
 */
export function toStorageCookies(cookies) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    // A host-only cookie has no leading dot; a domain cookie keeps it.
    domain: c.hostOnly ? c.domain.replace(/^\./, "") : c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
    path: c.path || "/",
    expires: c.session || !c.expirationDate ? -1 : Math.floor(c.expirationDate),
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: SAME_SITE[c.sameSite] ?? "Lax",
  }));
}
