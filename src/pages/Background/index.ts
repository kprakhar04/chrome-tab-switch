// const registry = {};

import { configs, deduplicates } from '../../shared/config';
import Storage from './Storage';

type Config = {
  tabId: number;
  url: string;
  title: string;
};

type State = {
  menu: { [x: string]: Config[] };
};

// const state: State = { menu: {} };

// chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
//   for (let i = 0; i < tabs.length; i++) {
//     const tab = tabs[i];
//     if (tab.url) {
//       registry[tab.url] = tab.id;
//     }
//   }
// });

type RegisterPayload = {
  url: string;
  belongTo: string;
  title: string;
  tabId?: number;
};

type DeletePayload = {
  tabId: number;
};

type TabIDByURL = { [x: string]: string };

chrome.windows.onCreated.addListener((event) => {
  chrome.windows.getAll((windows) => {
    chrome.tabs.query({ windowId: event.id }).then((tabs) => {
      const reloadPromises = tabs.map((tab) => {
        return tab.id ? chrome.tabs.reload(tab.id) : Promise.resolve();
      });
      Promise.all(reloadPromises).then(() => {});
      // chrome.storage.local.get('state', (result) => {
      //   const state: State = result.state;
      //   if (tabs.length === state.tabs.length) {

      //   }
      // })
    });
  });
});

chrome.storage.local.set({ state: { menu: {} } });

const updateURLByTabId = (tabId: number, url: string) => {
  return new Promise((resolve) => {
    chrome.storage.local.get('state', (result) => {
      const state: State = result.state || { menu: {} };
      Object.entries(state.menu).forEach(([menu, configs]) => {
        const config = configs.find((config) => config.tabId === tabId);
        if (config?.url) {
          config.url = url;
          config.title = ''; // if URL changes, then title might change, resetting here. we get new title by sending event to content script
          console.log('updating url ', config);
          state.menu[menu] = configs;
          chrome.storage.local.set({ state }, () => resolve(undefined));
        }
      });
    });
  });
};

const removeTabId = (tabId: number) => {
  chrome.storage.local.get('state', (result) => {
    const state: State = result.state;
    Object.entries(state.menu).forEach(([menu, configs]) => {
      const validConfigs = configs.filter((config) => config.tabId !== tabId);

      state.menu[menu] = validConfigs;
      chrome.storage.local.set({ state });
    });
  });
};

chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
  const tabIdByURL: TabIDByURL = {};
  tabs.forEach((tab) => {
    console.log('tab :>> ', tab);
    if (!tab.id || !tab.url) return;

    tabIdByURL[tab.id] = tab.url;
  });
  chrome.storage.local.set({ tabIdByURL });
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log('data :>> ', request);
  if (request.type === 'CHANGE_ACTIVE_TAB') {
    chrome.tabs.update(request.payload, { active: true });
  }

  if (request.type === 'REGISTER') {
    const {
      url,
      belongTo,
      title,
      tabId: eventTabId,
    } = request.payload as RegisterPayload;

    chrome.storage.local.get('state', (result) => {
      const state: State = result.state || { menu: {} };
      console.log('state :>> ', state);
      console.log('sender.tab?.id :>> ', sender.tab?.id);
      const tabId = sender.tab?.id || eventTabId;
      if (!tabId) {
        console.error('no tab present. request is :>>', request);
        return;
      }
      const configs = state.menu[belongTo] || [];
      const existingTab = configs.find((config) => config.tabId === tabId);
      if (existingTab) {
        existingTab.url = url;
        existingTab.title = title;
      } else {
        configs.push({
          tabId: tabId,
          url,
          title,
        });
      }
      state.menu[belongTo] = configs;
      Storage.save('state', state);
    });
  }

  if (request.type === 'DELETE') {
    const eventTabId = request.payload as number;
    removeTabId(eventTabId);
  }
});

const closeMatchedTab = (
  currentTabId: number,
  regex: RegExp,
  match: string
) => {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const existingTab = tabs.find((tab) => {
      const url = tab.url;
      const tabId = tab.id;
      if (!url || !tabId) return false;
      if (currentTabId === tabId) return false;
      return (regex.exec(url) || [])[1] === match;
    });

    if (!existingTab?.id) return;
    chrome.tabs.remove(existingTab.id);
    removeTabId(existingTab.id);
  });
};

const closeDuplicateTab = (tabId: number, url: string) => {
  deduplicates.forEach((deduplicateRegex) => {
    const match = deduplicateRegex.exec(url || '');
    console.log('match :>> ', match);
    if (match) {
      closeMatchedTab(tabId, deduplicateRegex, match[1]);
      return;
    }
  });
};

chrome.tabs.onCreated.addListener((tab) => {
  console.log('tab created');
  const url = tab.url || tab.pendingUrl;
  const tabId = tab.id;
  if (!url || !tabId) return;

  closeDuplicateTab(tabId, url);
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  console.log('tab updated', change);
  const url = change.url;

  // if URL present, it means navigation. else there is navigation
  if (url) {
    await updateURLByTabId(tabId, url);

    // if page reloads completely, the we are lucky. content script runs and REGISTER the tab
    // if page just updates history, then we need to send event to REGISTER again
    chrome.tabs.sendMessage(tabId, { type: 'UPDATE' });

    closeDuplicateTab(tabId, url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('tab removed');
  removeTabId(tabId);
});

// chrome.webNavigation.onHistoryStateUpdated.addListener((event) => {
// console.log('event :>> ', event.transitionType);
//   for (let i = 0; i < configs.length; i++) {
//     const config = configs[i];
//     const url = event.url;
//     if (config.urlRegex.exec(url)) {
//       chrome.tabs.sendMessage(event.tabId, { type: 'UPDATE' });
//       return;
//     }
//   }

// removeTabId(event.tabId);
// });
