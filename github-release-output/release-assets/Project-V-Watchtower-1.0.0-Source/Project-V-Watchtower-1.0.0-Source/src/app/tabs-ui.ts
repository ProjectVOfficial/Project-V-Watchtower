// app/tabs-ui.ts

import {
  getTabs,
  getActiveTab,
  setActiveTab,
  createTab,
  subscribe
} from "./tab-manager";

export function initTabsUI() {
  const container = document.createElement("div");
  container.id = "tabs-bar";

  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.background = "#111";
  container.style.padding = "5px";
  container.style.borderBottom = "1px solid #333";

  document.body.prepend(container);

  function render() {
    container.innerHTML = "";

    const tabs = getTabs();
    const active = getActiveTab();

    tabs.forEach(tab => {
      const el = document.createElement("div");
      el.innerText = tab.name;

      el.style.padding = "6px 12px";
      el.style.marginRight = "5px";
      el.style.cursor = "pointer";
      el.style.borderRadius = "4px";

      el.style.background =
        tab.id === active ? "#444" : "#222";

      el.onclick = () => setActiveTab(tab.id);

      container.appendChild(el);
    });

    // + button
    const add = document.createElement("div");
    add.innerText = "+";
    add.style.padding = "6px 12px";
    add.style.cursor = "pointer";
    add.style.background = "#222";

    add.onclick = () => createTab();

    container.appendChild(add);
  }

  subscribe(render);
  render();
}