const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { patchFileUsage } = require('../scripts/file-usage-patch.cjs');

const upstream = fs.readFileSync(path.join(__dirname,
    '../../Sub-Store/backend/src/restful/response-transformer.js'), 'utf8');
let prepareFileUsage;
before(async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/utils/file-usage.js'), 'utf8');
    ({ prepareFileUsage } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')));
});

function fixture({ source, usage = 'upload=2; download=3; total=100', fail = false,
    headers = {}, process = [] } = {}) {
    const calls = [];
    const responseHeaders = { 'content-type': 'text/plain', ...headers };
    const res = {
        statusCode: 207,
        getHeaders: () => ({ ...responseHeaders }),
        set: (key, value) => { responseHeaders[key] = value; },
        removeHeader: key => { delete responseHeaders[key]; },
        status: code => { res.statusCode = code; },
    };
    const store = {
        read: key => key === 'subs' ? [{ name: 'one', url: 'https://example.invalid/sub' }] : [],
        error: () => {},
    };
    const flow = {
        getFlowHeaders: async () => {
            calls.push('fetch');
            if (fail) throw Error('offline');
            return usage;
        },
        normalizeFlowHeader: value => ({ 'subscription-userinfo': value }),
    };
    const proxyUtils = {
        processResponse: async (response, operators) => {
            for (const operator of operators) response = await operator(response);
            return response;
        },
    };
    // Execute the patched upstream response pipeline, with only external dependencies mocked.
    const executable = patchFileUsage(upstream)
        .replace(/^import .*;\r?\n/gm, '')
        .replace('export async function applyResponseTransformers', 'async function applyResponseTransformers');
    const apply = new Function('ProxyUtils', '$', 'getFlowHeaders', 'normalizeFlowHeader',
        'prepareFileUsage', executable + '\nreturn applyResponseTransformers;')(
            proxyUtils, store, flow.getFlowHeaders, flow.normalizeFlowHeader, prepareFileUsage);
    return {
        headers: responseHeaders, calls, res,
        run: () => apply({ res, body: 'config', process, source }),
    };
}

test('file download forwards usage with no response script configured', async () => {
    const f = fixture({ source: { $file: {
        type: 'mihomoConfig', sourceType: 'subscription', sourceName: 'one',
    } } });
    assert.equal(await f.run(), 'config');
    assert.equal(f.headers['subscription-userinfo'], 'upload=2; download=3; total=100');
    assert.equal(f.headers['content-type'], 'text/plain');
    assert.equal(f.res.statusCode, 207);
    assert.equal(f.calls.length, 1);
});

test('existing response scripts see automatic usage and can override it', async () => {
    const f = fixture({ source: { $file: { source: 'remote', url: 'https://example.invalid/sub' } },
        process: [response => {
            assert.equal(response.headers['subscription-userinfo'], 'upload=2; download=3; total=100');
            response.headers['subscription-userinfo'] = 'total=200';
            return response;
        }],
    });
    await f.run();
    assert.equal(f.headers['subscription-userinfo'], 'total=200');
});

test('explicit file usage wins without another upstream request', async () => {
    const f = fixture({ source: { $file: { source: 'remote', url: 'https://example.invalid/sub' } },
        headers: { 'subscription-userinfo': 'total=500' },
    });
    await f.run();
    assert.equal(f.calls.length, 0);
    assert.equal(f.headers['subscription-userinfo'], 'total=500');
});

test('ordinary subscription downloads do not trigger file usage lookup', async () => {
    const f = fixture({ source: { one: { url: 'https://example.invalid/sub' } } });
    assert.equal(await f.run(), 'config');
    assert.equal(f.calls.length, 0);
});

test('upstream usage failure still returns the config body and status', async () => {
    const f = fixture({ source: { $file: { source: 'remote', url: 'https://example.invalid/sub' } },
        fail: true,
    });
    assert.equal(await f.run(), 'config');
    assert.equal(f.res.statusCode, 207);
    assert.equal(f.headers['subscription-userinfo'], undefined);
});

test('upstream entry changes fail the build instead of dropping file usage', () => {
    assert.throws(() => patchFileUsage(upstream.replace('const currentHeaders =', 'const headers =')),
        /refusing to build/);
    assert.throws(() => patchFileUsage(upstream + '\n    const currentHeaders = getCurrentHeaders(res);'),
        /refusing to build/);
    assert.throws(() => patchFileUsage(upstream.replace('applyResponseTransformers({', 'transform({')),
        /refusing to build/);
});
