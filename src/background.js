const api = globalThis.browser ?? chrome;
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || !message || typeof message.command !== 'string') return;
  const run = async () => {
    const tab = sender.tab;
    switch (message.command) {
      case 'next-tab':
      case 'previous-tab': {
        const tabs = await api.tabs.query({ windowId: tab.windowId });
        const ordered = tabs.sort((a, b) => a.index - b.index);
        const direction = message.command === 'next-tab' ? 1 : -1;
        const index = ordered.findIndex(item => item.id === tab.id);
        const count = Math.min(Math.max(Number(message.count) || 1, 1), 9999);
        const next = ordered[((index + direction * count) % ordered.length + ordered.length) % ordered.length];
        await api.tabs.update(next.id, { active: true });
        break;
      }
      case 'close-tab': await api.tabs.remove(tab.id); break;
      case 'tabs': return (await api.tabs.query({ windowId: tab.windowId })).map(({ id, title, url }) => ({ id, title, url }));
      case 'activate-tab': {
        const target = await api.tabs.get(message.id);
        if (target.windowId === tab.windowId) await api.tabs.update(target.id, { active: true });
        break;
      }
      case 'open': {
        const url = new URL(message.url);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP(S) URLs can be opened');
        await api.tabs.create({ url: url.href, active: !message.background, windowId: tab.windowId, openerTabId: tab.id });
        break;
      }
      default: throw new Error('Unknown browser command');
    }
    return null;
  };
  run().then(value => respond({ value, buildId }), error => respond({ error: error.message, buildId }));
  return true;
});
