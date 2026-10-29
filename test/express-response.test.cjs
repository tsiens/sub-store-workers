const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');

let express;
before(async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/vendor/express.js'), 'utf8')
        .replace("import { ENV } from './open-api';", 'const ENV = () => ({});');
    ({ default: express } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')));
});

test('response transformers can read the actual status and existing headers', async () => {
    const app = express({ substore: { error() {} } });
    app.get('/test', (req, res) => {
        res.status(201).set('Subscription-Userinfo', 'total=100');
        assert.equal(res.statusCode, 201);
        assert.equal(res.getHeader('SUBSCRIPTION-USERINFO'), 'total=100');
        const snapshot = res.getHeaders();
        assert.equal(snapshot['subscription-userinfo'], 'total=100');
        snapshot['subscription-userinfo'] = 'changed';
        assert.equal(res.getHeader('subscription-userinfo'), 'total=100');
        res.set('Content-Type', 'application/json');
        res.set('content-type', 'text/plain');
        res.setHeader('X-Remove', 'value').removeHeader('x-remove');
        res.send('body');
    });
    const response = await app.handleRequest(new Request('https://example.invalid/test'));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('subscription-userinfo'), 'total=100');
    assert.equal(response.headers.get('content-type'), 'text/plain');
    assert.equal(response.headers.get('x-remove'), null);
    assert.equal(await response.text(), 'body');
});
