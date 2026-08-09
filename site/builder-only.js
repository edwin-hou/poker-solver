/** Keep the public page focused on one workspace at a time. */

const toolbar = document.querySelector(".solution-toolbar");
const builderPanel = document.querySelector(".builder-panel");
const resultsPanel = document.querySelector("#results-panel");
const placeholder = document.querySelector("#results-placeholder");
const progressView = document.querySelector("#progress-view");
const resultsView = document.querySelector("#results-view");
const editButton = document.querySelector("#resolve-button");

if (!toolbar || !builderPanel || !resultsPanel || !placeholder || !progressView || !resultsView) {
  throw new Error("The solution-builder workspace is incomplete.");
}

function outputIsActive() {
  return !progressView.hidden || !resultsView.hidden;
}

function syncWorkspace() {
  const showingOutput = outputIsActive();
  toolbar.hidden = showingOutput;
  builderPanel.hidden = showingOutput;
  resultsPanel.hidden = !showingOutput;
  document.body.classList.toggle("showing-solution", showingOutput);
}

function showBuilder() {
  placeholder.hidden = false;
  progressView.hidden = true;
  resultsView.hidden = true;
  syncWorkspace();
  document.querySelector("#solver")?.scrollIntoView({ block: "start" });
}

for (const view of [progressView, resultsView]) {
  new MutationObserver(syncWorkspace).observe(view, {
    attributes: true,
    attributeFilter: ["hidden"],
  });
}

if (editButton) {
  editButton.textContent = "← Edit spot";
  editButton.title = "Return to the solution builder";

  // app.js registers a re-run handler on the same button. Capture the event
  // first so this minimal interface returns to the builder instead.
  document.addEventListener(
    "click",
    (event) => {
      if (!event.target.closest?.("#resolve-button")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showBuilder();
    },
    true,
  );
}

syncWorkspace();
