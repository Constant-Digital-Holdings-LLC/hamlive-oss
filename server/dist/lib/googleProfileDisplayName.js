/* hamlive-oss — MIT License. See LICENSE. */

const { userProfileSchema } = require('../models/userProfile');

const displayNamePath = userProfileSchema.path('displayName');
const displayNameCharacterValidator = displayNamePath.options.validate?.validator || (() => true);
const DISPLAY_NAME_MIN_LENGTH = displayNamePath.options.minlength;
const DISPLAY_NAME_MAX_LENGTH = displayNamePath.options.maxlength;
const DEFAULT_GOOGLE_DISPLAY_NAME = 'Google User';

const trimSeparators = value => value.replace(/^[/' -]+|[/' -]+$/g, '');

const sanitizeCandidate = candidate => {
    if (typeof candidate !== 'string') {
        return '';
    }

    const normalizedCandidate = candidate.normalize('NFC');
    const allowedCharactersOnly = Array.from(normalizedCandidate)
        .filter(char => displayNameCharacterValidator(char) || /\s/u.test(char))
        .join('');
    const normalizedWhitespace = allowedCharactersOnly.replace(/\s+/gu, ' ').trim();
    const truncated = normalizedWhitespace.slice(0, DISPLAY_NAME_MAX_LENGTH);

    return trimSeparators(truncated).trim();
};

const isAcceptableDisplayName = value =>
    typeof value === 'string' &&
    value.length >= DISPLAY_NAME_MIN_LENGTH &&
    value.length <= DISPLAY_NAME_MAX_LENGTH &&
    /\p{L}/u.test(value) &&
    displayNameCharacterValidator(value);

const buildGoogleDisplayNameCandidates = profile => {
    const displayName = profile?.displayName;
    const givenName = profile?.name?.givenName;
    const familyName = profile?.name?.familyName;
    const emailLocalPart = profile?.emails?.[0]?.value?.split('@')[0];
    const combinedName = [givenName, familyName].filter(Boolean).join(' ');

    return [displayName, combinedName, givenName, familyName, emailLocalPart, DEFAULT_GOOGLE_DISPLAY_NAME];
};

const getSafeGoogleDisplayName = profile => {
    for (const candidate of buildGoogleDisplayNameCandidates(profile)) {
        const sanitized = sanitizeCandidate(candidate);

        if (isAcceptableDisplayName(sanitized)) {
            return sanitized;
        }
    }

    return DEFAULT_GOOGLE_DISPLAY_NAME;
};

module.exports = {
    DEFAULT_GOOGLE_DISPLAY_NAME,
    DISPLAY_NAME_MAX_LENGTH,
    DISPLAY_NAME_MIN_LENGTH,
    getSafeGoogleDisplayName,
    sanitizeCandidate
};
