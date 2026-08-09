const fragments = [
  "chrome.html",
  "hero.html",
  "solver-config.html",
  "solver-results.html",
  "method.html",
  "footer.html",
];

const responses = await Promise.all(
  fragments.map(async (name) => {
    const response = await fetch(new URL(`./partials/${name}`, import.meta.url));
    if (!response.ok) throw new Error(`Unable to load ${name}: ${response.status}`);
    return response.text();
  }),
);
const root = document.querySelector("#page-root");
root.outerHTML = responses.join("");
await import("./app.js");
