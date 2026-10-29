// Resolve file usage on download, including files with no response scripts.
export async function prepareFileUsage(res, context, store, flow) {
    const file = context?.source?.$file;
    if (!file || context.fileUsagePrepared) return;
    context.fileUsagePrepared = true;

    const headers = res.header || res.headers || {};
    if (file.noFlow || Object.entries(headers).some(([key, value]) =>
        key.toLowerCase() === 'subscription-userinfo' && value)) return;

    const type = ['mihomoConfig', 'mihomoProfile'].includes(file.type)
        ? (file.sourceType || 'collection') : (file.source || file.sourceType);
    const firstUrl = value => String(value || '').split(/[\r\n]+/).map(s => s.trim()).find(Boolean);
    const find = (key, name) => (store.read(key) || []).find(item => item.name === name);
    const merged = item => ['localFirst', 'remoteFirst'].includes(item.mergeSources);
    const fetchFlow = async (...args) => {
        try {
            return await flow.getFlowHeaders(...args);
        } catch {
            store.error('读取文件上游用量失败，保留文件内容和已有响应头');
        }
    };
    const custom = (value, proxy) => /^https?:\/\//.test(value || '')
        ? fetchFlow(undefined, undefined, undefined, proxy, value) : value;

    async function remote(item, proxy) {
        const url = firstUrl(item.url);
        if (!url) return;
        let args = {};
        const fragment = url.split('#')[1];
        if (fragment) {
            try {
                args = JSON.parse(decodeURIComponent(fragment)) || {};
            } catch {
                args = Object.fromEntries(fragment.split('&').map(pair => {
                    const [key, ...values] = pair.split('=');
                    try { return [key, values.length ? decodeURIComponent(values.join('=')) || true : true]; }
                    catch { return [key, true]; }
                }));
            }
        }
        if (!args.noFlow) return fetchFlow(url, args.flowUserAgent || item.ua,
            undefined, proxy, args.flowUrl, args.flowHeaders);
    }

    async function subscription(sub, proxy) {
        if (!sub || sub.noFlow) return [];
        proxy = sub.proxy || proxy;
        return [await custom(sub.subUserinfo, proxy),
            sub.source !== 'local' || merged(sub) ? await remote(sub, proxy) : undefined];
    }

    try {
        const infos = [];
        if (type === 'subscription') {
            infos.push(...await subscription(find('subs', file.sourceName), file.proxy));
        } else if (type === 'collection') {
            const collection = find('collections', file.sourceName);
            if (collection && !collection.noFlow) {
                const proxy = collection.proxy || file.proxy;
                infos.push(await custom(collection.subUserinfo, proxy));
                if (collection.firstSubFlow !== false) {
                    infos.push(...await subscription(find('subs', collection.subscriptions?.[0]), proxy));
                }
            }
        } else if (type === 'remote' || (type === 'local' && merged(file))) {
            infos.push(await remote(file, file.proxy));
        }
        const values = infos.filter(Boolean).join('; ');
        if (!values) return;
        const usage = flow.normalizeFlowHeader(values, true)?.['subscription-userinfo'];
        if (usage) {
            for (const key of Object.keys(headers)) {
                if (key.toLowerCase() === 'subscription-userinfo') delete headers[key];
            }
            headers['subscription-userinfo'] = usage;
            if (res.header) res.header = headers;
            else res.headers = headers;
        }
    } catch {
        store.error('处理文件用量失败，保留文件内容和已有响应头');
    }
}
