/* hamlive-oss — MIT License. See LICENSE. */

const assert = require('node:assert/strict');
const {
    DEFAULT_GOOGLE_DISPLAY_NAME,
    DISPLAY_NAME_MAX_LENGTH,
    DISPLAY_NAME_MIN_LENGTH,
    getSafeGoogleDisplayName
} = require('../server/dist/lib/googleProfileDisplayName');
const { userProfileSchema } = require('../server/dist/models/userProfile');

const displayNamePath = userProfileSchema.path('displayName');
const validateDisplayName = value => displayNamePath.doValidateSync(value, {});

const testCases = [
    {
        name: 'long radio-style Google display name stays valid',
        profile: {
            displayName: 'Christophe David (ON6ZQ / AC6ZQ)',
            emails: [{ value: 'christophe@example.com' }]
        },
        expected: 'Christophe David (ON6ZQ / AC6ZQ)'
    },
    {
        name: 'short valid display name stays unchanged',
        profile: {
            displayName: 'Chris David',
            emails: [{ value: 'chris@example.com' }]
        },
        expected: 'Chris David'
    },
    {
        name: 'invalid-only display name falls back safely',
        profile: {
            displayName: '1234 / _:)',
            emails: [{ value: '!!!@example.com' }]
        },
        expected: DEFAULT_GOOGLE_DISPLAY_NAME
    },
    {
        name: 'whitespace is normalized',
        profile: {
            displayName: '  Ana   Maria  ',
            emails: [{ value: 'ana@example.com' }]
        },
        expected: 'Ana Maria'
    },
    {
        name: 'email local-part can be used as fallback when appropriate',
        profile: {
            displayName: '***',
            emails: [{ value: 'john.smith@example.com' }]
        },
        expected: 'johnsmith'
    }
];

for (const testCase of testCases) {
    const actual = getSafeGoogleDisplayName(testCase.profile);

    assert.equal(actual, testCase.expected, testCase.name);
    assert.ok(actual.length >= DISPLAY_NAME_MIN_LENGTH, `${testCase.name}: meets minimum length`);
    assert.ok(actual.length <= DISPLAY_NAME_MAX_LENGTH, `${testCase.name}: meets maximum length`);
    assert.equal(validateDisplayName(actual), undefined, `${testCase.name}: passes schema validation`);
}

console.log(`Verified ${testCases.length} Google display-name sanitization scenarios.`);
