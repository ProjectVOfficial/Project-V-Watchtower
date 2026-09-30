// app/tab-manager.ts

export type Tab = {
  id: string;
  name: string;
};

let tabs: Tab[] = [
  { id: "main", name: "Main" }
];

let activeTabId: string = "main";

// listeners so UI updates automatically
const listeners: Function[] = [];

export function getTabs() {
  return tabs;
}

export function getActiveTab() {
  return activeTabId;
}

export function setActiveTab(id: string) {
  activeTabId = id;
  notify();
}

export function createTab(name: string = "New Tab") {
  const id = crypto.randomUUID();

  tabs.push({ id, name });
  activeTabId = id;

  notify();
}

export function renameTab(id: string, name: string) {
  const tab = tabs.find(t => t.id === id);
  if (tab) {
    tab.name = name;
    notify();
  }
}

export function subscribe(fn: Function) {
  listeners.push(fn);
}

function notify() {
  listeners.forEach(fn => fn());
}