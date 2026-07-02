#!/usr/bin/env node
/* hamlive-oss — MIT License. See LICENSE. */

const assert = require('assert');

const MODULES_TO_CLEAR = ['../server/dist/lib/configLib', '../server/dist/lib/userNotification'];

const resetModuleCache = () => {
    for (const modulePath of MODULES_TO_CLEAR) {
        delete require.cache[require.resolve(modulePath)];
    }
};

const withEmailEnv = (env, fn) => {
    const keys = ['SENDGRID_API_KEY', 'SENDGRID_NET_CLOSE_TEMPLATE_ID', 'ZEPTOMAIL_API_KEY', 'EMAIL_FROM'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));

    for (const key of keys) {
        process.env[key] = env[key] ?? '';
    }

    resetModuleCache();

    try {
        return fn(require('../server/dist/lib/userNotification'));
    } finally {
        for (const key of keys) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
        resetModuleCache();
    }
};

withEmailEnv({}, email => {
    assert.strictEqual(email.emailEnabled, false, 'email is disabled when no provider is configured');
    assert.strictEqual(email.emailProvider, null, 'no provider is selected when no provider is configured');
});

withEmailEnv({ SENDGRID_API_KEY: 'SG.fake' }, email => {
    assert.strictEqual(email.emailEnabled, true, 'SendGrid enables email');
    assert.strictEqual(email.emailProvider, 'sendgrid', 'SendGrid is selected when it is the only provider');
});

withEmailEnv(
    {
        SENDGRID_API_KEY: 'SG.fake',
        ZEPTOMAIL_API_KEY: 'zepto-fake',
        EMAIL_FROM: 'HamLive Test <no-reply@example.com>'
    },
    email => {
        const { buildZeptoMailPayload, parseEmailFrom, renderNetCloseReportHtml, toZeptoMailAttachment } =
            email.__test__;

        assert.strictEqual(email.emailEnabled, true, 'ZeptoMail enables email');
        assert.strictEqual(email.emailProvider, 'zeptomail', 'ZeptoMail wins over SendGrid');
        assert.deepStrictEqual(parseEmailFrom('HamLive Test <no-reply@example.com>'), {
            address: 'no-reply@example.com',
            name: 'HamLive Test'
        });
        assert.deepStrictEqual(parseEmailFrom('no-reply@example.com'), {
            address: 'no-reply@example.com',
            name: 'Ham.Live'
        });
        assert.strictEqual(parseEmailFrom('not an address'), null, 'invalid sender is rejected');
        assert.deepStrictEqual(
            toZeptoMailAttachment({
                content: 'Ym9keQ==',
                filename: 'report.csv',
                type: 'text/csv',
                disposition: 'attachment'
            }),
            {
                content: 'Ym9keQ==',
                mime_type: 'text/csv',
                name: 'report.csv'
            }
        );

        const payload = buildZeptoMailPayload(
            {
                from: 'HamLive Test <no-reply@example.com>',
                subject: 'Subject',
                html: '<p>Hello</p>',
                attachments: [
                    {
                        content: 'YXR0YWNobWVudA==',
                        filename: 'chat.txt',
                        type: 'text/plain'
                    }
                ]
            },
            ['operator@example.com']
        );

        assert.deepStrictEqual(payload.from, {
            address: 'no-reply@example.com',
            name: 'HamLive Test'
        });
        assert.deepStrictEqual(payload.to, [
            {
                email_address: {
                    address: 'operator@example.com'
                }
            }
        ]);
        assert.strictEqual(payload.subject, 'Subject');
        assert.strictEqual(payload.htmlbody, '<p>Hello</p>');
        assert.strictEqual(payload.track_clicks, false);
        assert.strictEqual(payload.track_opens, false);
        assert.deepStrictEqual(payload.attachments, [
            {
                content: 'YXR0YWNobWVudA==',
                mime_type: 'text/plain',
                name: 'chat.txt'
            }
        ]);

        const reportHtml = renderNetCloseReportHtml({
            title: 'Bad <Net>',
            url: 'https://example.com/net?a=1&b=2',
            startedAtString: 'Thu, 02 Jul 2026 12:00:00 GMT',
            formattedAttendees: [
                {
                    callSign: 'ON6ZQ<script>',
                    role: 'NCS',
                    checkInTime: '12:00:00 GMT',
                    sigReport: '59 & loud',
                    highlight: true
                }
            ]
        });

        assert(reportHtml.includes('Bad &lt;Net&gt;'), 'net title is escaped');
        assert(reportHtml.includes('ON6ZQ&lt;script&gt;'), 'callsign is escaped');
        assert(reportHtml.includes('59 &amp; loud'), 'signal report is escaped');
        assert(!reportHtml.includes('<script>'), 'raw script tags are not emitted');
    }
);

withEmailEnv({ ZEPTOMAIL_API_KEY: 'zepto-fake' }, email => {
    assert.strictEqual(email.emailProvider, null, 'ZeptoMail is not enabled without EMAIL_FROM');
});

withEmailEnv({ ZEPTOMAIL_API_KEY: 'zepto-fake', EMAIL_FROM: 'not an address' }, email => {
    assert.strictEqual(email.emailProvider, null, 'ZeptoMail is not enabled with invalid EMAIL_FROM');
});

console.log('Email provider verification passed.');
