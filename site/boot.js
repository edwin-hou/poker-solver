const fragments = ["solver-config.html", "solver-results.html"];

const root = document.querySelector("#page-root");

try {
  if (!root) throw new Error("Page root was not found.");
  const responses = await Promise.all(
    fragments.map(async (name) => {
      const response = await fetch(new URL(`./partials/${name}`, import.meta.url));
      if (!response.ok) throw new Error(`Unable to load ${name}: HTTP ${response.status}`);
      return response.text();
    }),
  );

  root.outerHTML = responses.join("");
  await import("./app.js");
  await import("./builder-only.js");
} catch (error) {
  console.error("Poker Solver failed to start", error);
  if (root) {
    root.removeAttribute("aria-busy");
    root.innerHTML = `
      <main style="max-width:760px;margin:12vh auto;padding:28px;font-family:system-ui;color:#f4f8ff;background:#0d1b2f;border:1px solid #29405e;border-radius:20px">
        <h1 style="margin-top:0">Poker Solver could not start</h1>
        <p style="color:#aebed3">${escapeHtml(error?.message ?? String(error))}</p>
        <p style="color:#91a1b8">Reload the page. If the problem persists, open the repository’s Actions tab and verify the latest Pages deployment.</p>
      </main>`;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
