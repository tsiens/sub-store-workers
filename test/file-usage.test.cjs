const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');

let prepareFileUsage;
before(async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/utils/file-usage.js'), 'utf8');
    ({ prepareFileUsage } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')));
});

function fixture(file, { collections = [], subs = [], response, fail = false } = {}) {
    const calls = [], errors = [];
    const res = response || { status: 200, headers: { 'x-test': 'keep' }, body: 'config' };
    const context = { source: { $file: { type: 'mihomoConfig', ...file } } };
    const store = { read: key => key === 'subs' ? subs : collections, error: error => errors.push(error) };
    const flow = {
        getFlowHeaders: async (...args) => {
            calls.push(args);
            if (fail) throw Error('unavailable');
            return 'upload=2; download=3; total=100';
        },
        normalizeFlowHeader: value => {
            const fields = new Map();
            for (const pair of value.split(';').map(s => s.trim()).filter(Boolean)) {
                const [key, ...rest] = pair.split('=');
                if (!fields.has(key)) fields.set(key, rest.join('='));
            }
            return { 'subscription-userinfo': [...fields].map(([key, value]) => key + '=' + value).join('; ') };
        },
    };
    return { res, context, calls, errors, run: () => prepareFileUsage(res, context, store, flow) };
}

test('single subscription uses its selected source, proxy and first URL', async () => {
    const f = fixture({ sourceType: 'subscription', sourceName: 'one' }, { subs: [
        { name: 'other', url: 'https://wrong.invalid' },
        { name: 'one', url: 'https://example.invalid/a\nhttps://example.invalid/b', proxy: 'selected' },
    ] });
    await f.run();
    assert.equal(f.res.headers['subscription-userinfo'], 'upload=2; download=3; total=100');
    assert.equal(f.calls[0][0], 'https://example.invalid/a');
    assert.equal(f.calls[0][3], 'selected');
    assert.equal(f.res.body, 'config');
    assert.equal(f.res.headers['x-test'], 'keep');
});

test('collection usage overrides first-subscription values, including partial overrides', async () => {
    const f = fixture({ sourceType: 'collection', sourceName: 'combo' }, {
        collections: [{ name: 'combo', subscriptions: ['one'], subUserinfo: 'total=300' }],
        subs: [{ name: 'one', source: 'remote', url: 'https://example.invalid/sub' }],
    });
    await f.run();
    assert.equal(f.res.headers['subscription-userinfo'], 'total=300; upload=2; download=3');
});

test('collection can disable forwarding the first subscription', async () => {
    const f = fixture({ sourceType: 'collection', sourceName: 'combo' }, {
        collections: [{ name: 'combo', subscriptions: ['one'], firstSubFlow: false,
            subUserinfo: 'upload=10; download=20; total=300' }],
        subs: [{ name: 'one', url: 'https://example.invalid/sub' }],
    });
    await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal(f.res.headers['subscription-userinfo'], 'upload=10; download=20; total=300');
});

test('remote sources pass flow URL, User-Agent and custom headers to the host', async () => {
    const f = fixture({ sourceType: 'remote', url: 'https://example.invalid/sub#flowUserAgent=UA&flowUrl=https%3A%2F%2Fexample.invalid%2Fusage&flowHeaders=%7B%22x-test%22%3A%22value%22%7D' });
    await f.run();
    assert.equal(f.calls[0][1], 'UA');
    assert.equal(f.calls[0][4], 'https://example.invalid/usage');
    assert.equal(f.calls[0][5], '{"x-test":"value"}');
});

test('remote noFlow URL flag skips the request', async () => {
    const f = fixture({ sourceType: 'remote', url: 'https://example.invalid/sub#noFlow' });
    await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal(f.res.headers['subscription-userinfo'], undefined);
});

test('local and none have no implicit upstream request', async () => {
    for (const sourceType of ['local', 'none']) {
        const f = fixture({ sourceType, url: 'https://example.invalid/unused' });
        await f.run();
        assert.equal(f.calls.length, 0);
        assert.equal(f.res.headers['subscription-userinfo'], undefined);
    }
});

test('merged local sources can use the remote portion', async () => {
    const f = fixture({ sourceType: 'local', mergeSources: 'localFirst', url: 'https://example.invalid/sub' });
    await f.run();
    assert.equal(f.calls.length, 1);
    assert.equal(f.res.headers['subscription-userinfo'], 'upload=2; download=3; total=100');
});

test('ordinary file source takes precedence over a stale mihomo sourceType', async () => {
    const f = fixture({ type: 'file', source: 'remote', sourceType: 'collection', url: 'https://example.invalid/sub' });
    await f.run();
    assert.equal(f.calls.length, 1);
});

test('local subscription can supply a custom usage endpoint', async () => {
    const f = fixture({ sourceType: 'subscription', sourceName: 'one' }, {
        subs: [{ name: 'one', source: 'local', subUserinfo: 'https://example.invalid/usage' }],
    });
    await f.run();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][0], undefined);
    assert.equal(f.calls[0][4], 'https://example.invalid/usage');
});

test('existing headers take precedence and fallback execution does not fetch again', async () => {
    const f = fixture({ sourceType: 'remote', url: 'https://example.invalid/sub' }, {
        response: { header: { 'Subscription-Userinfo': 'total=900' }, body: 'config' },
    });
    await f.run(); await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal(f.res.header['Subscription-Userinfo'], 'total=900');
    const other = fixture({ sourceType: 'remote', url: 'https://example.invalid/sub' });
    await other.run(); await other.run();
    assert.equal(other.calls.length, 1);
});

test('network failure does not fail the file response', async () => {
    const f = fixture({ sourceType: 'remote', url: 'https://example.invalid/sub' }, { fail: true });
    await f.run();
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.res, { status: 200, headers: { 'x-test': 'keep' }, body: 'config' });
});

test('missing or noFlow source returns without fabricating usage', async () => {
    for (const file of [
        { sourceType: 'subscription', sourceName: 'missing' },
        { sourceType: 'remote', noFlow: true, url: 'https://example.invalid/sub' },
    ]) {
        const f = fixture(file);
        await f.run();
        assert.equal(f.calls.length, 0);
        assert.equal(f.res.headers['subscription-userinfo'], undefined);
    }
});
