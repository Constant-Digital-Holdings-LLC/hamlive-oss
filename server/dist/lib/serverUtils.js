/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
// NEW: Use GetStream.io chat history instead of Roomlio
// WHY: Roomlio is defunct, GetStream is the replacement
const { fetchChatHistory } = require('./streamChat');
const listEndpoints = require('express-list-endpoints');
const sanitizeHtml = require('sanitize-html');
const { nameCase } = require('@foundernest/namecase');
const validator = require('validator');
const { XMLParser } = require('fast-xml-parser');
const fillTemplate = require('es6-dynamic-template');
const NodeCache = require('node-cache');
const gOptsCache = new NodeCache({ stdTTL: 10, checkperiod: 600 });
const okToAdvertiseCache = new NodeCache({ stdTTL: 600, checkperiod: 600 });
const { logger } = require('../lib/logger');
const { conf } = require('../lib/configLib');
const { getFlexOption } = require('../models/flexOptions');
const { getQrzCache } = require('../models/qrzCache');
const { getInitialReg } = require('../models/initialRegTracker');
const axios = require('axios');
let qrzSessionKey = null;
let qrzInQuotaWait = 0;
let qrzReqPrevQuota;
const REQ_LOGIN = 0x0001;
const REQ_CALLSIGN = 0x0010;
const REQ_NETOWNER = 0x0100;
const REQ_SUPERUSER = 0x1000;

const isValidEmailFrom = value => {
    if (typeof value !== 'string') return false;

    const trimmed = value.trim();
    const match = trimmed.match(/^(.*?)<([^<>]+)>$/);
    const address = match ? match[2].trim() : trimmed;

    return validator.isEmail(address);
};

const publicEndpoints = app => {
    if ((!'listen') in app) throw new Error('publicEndpoints expected Express app instance as param');

    return listEndpoints(app)
        .filter(o => o.path.match(/^\/api\/.*/) && !o.path.includes('resolvelocation'))
        .map(o => {
            delete o.middlewares;
            return o;
        });
};

// fetchChatLog() abstracts away chat provider specifics
// WHY: This abstraction isolates the chat provider (now GetStream.io, was Roomlio)
// from the rest of the codebase. The rest of the code (e.g., userNotification.js for
// net close reports) calls fetchChatLog() without knowing about GetStream.
const fetchChatLog = async ({ NPID, since }) => {
    let chatLog = '';

    try {
        // fetchChatHistory() returns AsyncGenerator of message arrays - Messages are received in batches/chunks
        // Each message has: username, body, createdAt, reactions (formatted emoji string), edited (boolean)
        for await (const messages of fetchChatHistory({ npid: NPID, since })) {
            chatLog += messages
                .map(({ username, body, reactions, edited }) => {
                    const editedMarker = edited ? ' *' : '';
                    return `${username}: ${body}${reactions}${editedMarker}\n\n`;
                })
                .join('');
        }
    } catch (err) {
        // Gracefully handle if chat service unavailable (follows existing pattern in closeNet)
        logger.error(`Failed to fetch chat log: ${err.message}`);
        return ''; // Return empty string, don't fail the report
    }

    return chatLog;
};

const sanitizeNotes = notes =>
    sanitizeHtml(
        notes
            .replace(/\r?\n|\r/g, '')
            .replace(/"/g, '&#34;')
            .replace(/'/g, '&#39;'),
        {
            allowedTags: ['li', 'p', 'ul', 'b', 'br', 'em', 'i']
        }
    ) || '';

const getFlexOptionsByUser = async ({ user, cachedResponse = false, db = mongoose.connection }) => {
    let gOpts;
    let resp = {};

    if (!user?.flexOptions) return resp;

    if (cachedResponse) gOpts = gOptsCache.get(user.id);

    const FlexOption = getFlexOption(db);

    if (!gOpts) {
        if ((gOpts = await FlexOption.findOne({ scope: 'global' }))) {
        } else {
            logger.warn('getFlexOptionsByUser(): missing global options, creating default global options');
            gOpts = await FlexOption.create({
                scope: 'global',
                option: {}
            });
        }
        gOptsCache.set(user.id, gOpts.toObject());
    }

    if (!gOpts) return resp;

    for (let property in gOpts.option) {
        resp[property] = user.flexOptions?.option[property] ?? gOpts.option[property];
    }

    return resp;
};

const flexOpts = async (req, res, next) => {
    res.locals.flexOpts = await getFlexOptionsByUser({ user: req.user, cachedResponse: true });
    next();
};

const okToAdvertiseHelper = async (callSign, ads, gracePeriodDays) => {
    const validateParams = (callSign, ads, gracePeriodDays) => {
        const validations = [
            { condition: !callSign, message: 'okToAdvertise() missing callsign' },
            { condition: typeof ads !== 'number', message: 'okToAdvertise() missing ads percentage' },
            { condition: ads < 0 || ads > 100, message: 'okToAdvertise() ads percentage out of range' },
            { condition: ads === 0, message: 'okToAdvertise() ads percentage is zero' },
            { condition: typeof gracePeriodDays !== 'number', message: 'okToAdvertise() missing grace period days' }
        ];

        for (const { condition, message } of validations) {
            if (condition) {
                logger.debug(message);
                return false;
            }
        }

        return true;
    };

    if (!validateParams(callSign, ads, gracePeriodDays)) {
        return false;
    }

    if (okToAdvertiseCache.has(callSign)) {
        const v = okToAdvertiseCache.get(callSign);
        logger.debug(`${callSign} okToAdvertise (cached hit) - serve : ${v}`);
        return v;
    }

    try {
        const InitialReg = getInitialReg(null);
        const regRecord = await InitialReg.findOne({ callSign });

        let startOfGracePeriod;

        if (!regRecord) {
            logger.warn(`${callSign} not found in initialRegTracker`);
            return false;
        }

        ({ startOfGracePeriod } = regRecord);

        const now = new Date();
        const elapsedDays = Math.floor((now - startOfGracePeriod) / (1000 * 60 * 60 * 24));

        if (elapsedDays > gracePeriodDays) {
            const decision = Math.random() * 100 < ads;
            logger.debug(
                `${callSign} grace period expired, okToAdvertise (cache miss) @ ${ads}% - serve : ${decision}`
            );
            okToAdvertiseCache.set(callSign, decision);
            return decision;
        } else {
            logger.debug(`${callSign} grace period active for ${gracePeriodDays - elapsedDays} more days`);
        }

        return false;
    } catch (err) {
        logger.error(`In okToAdvertise(): ${callSign}: ${err}`);
        return false;
    }
};

const addServerInfo = async (req, res, next) => {
    try {
        const isLoggedIn = Boolean(req.user);

        const { NODE_ENV: nodeEnv, LOG_LEVEL: logLevel } = process.env;
        const { callSign = null, displayName = null, id: userId = null, newAccount = false } = req.user || {};
        const { gracePeriodDays, ads, requestRateFactor, httpClientTimeout, chat, analytics, awayInMs } =
            res.locals.flexOpts || {};
        const { applogname: appLogName, cmd_help_url: cmdHelpUrl = '', app_name: appName = 'Ham.Live' } = conf || {};
        const googleAuth = Boolean(conf.google_client_id && conf.google_client_secret);
        const chatEnabled = Boolean(conf.stream_api_key && conf.stream_api_secret);
        const emailEnabled = Boolean(
            (conf.zeptomail_api_key && isValidEmailFrom(conf.email_from)) || conf.sendgrid_api_key
        );

        // Ads & analytics are OFF by default in the community edition; they only
        // run when explicitly enabled AND a provider ID is configured.
        const adsEnabled = Boolean(conf.ads_enabled) && Boolean(conf.adplugg_access_code);
        const analyticsEnabled = Boolean(conf.analytics_enabled) && Boolean(conf.google_analytics_id);

        let okToAdvertise = false;

        if (adsEnabled) {
            try {
                okToAdvertise = await okToAdvertiseHelper(callSign, ads, gracePeriodDays);
            } catch (err) {
                logger.error(`addServerInfo() okToAdvertise() error: ${err}`);
            }
        }

        res.locals.serverInfo = {
            server: {
                nodeEnv,
                logLevel,
                appLogName,
                appName,
                cmdHelpUrl,
                googleAuth,
                chatEnabled,
                emailEnabled,
                adsEnabled,
                analyticsEnabled,
                adPluggAccessCode: conf.adplugg_access_code || '',
                googleAnalyticsId: conf.google_analytics_id || '',
                ts: Date.now(),
                requestRateFactor,
                httpClientTimeout,
                awayInMs
            },
            user: {
                isLoggedIn,
                callSign,
                displayName,
                userId,
                newAccount,
                chat,
                okToAdvertise,
                analytics: analyticsEnabled ? analytics : false
            }
        };

        next();
    } catch (err) {
        logger.error(`addServerInfo() error: ${err}`);
        next(err); // Pass the error to the next middleware (error handler)
    }
};

const populate = (req, res, additions) => {
    return {
        ...res.locals.serverInfo,
        ...additions
    };
};

const cookieSessionKeepAlive = (intervalMinutes = 10) => {
    return (req, res, next) => {
        if (!req.session) {
            return next(new Error('Session is not initialized'));
        }

        const now = Date.now();

        if (!req.session.lastRenewal) {
            req.session.lastRenewal = now;
        }

        const intervalMs = intervalMinutes * 60 * 1000;
        const timeSinceLastRenewal = now - req.session.lastRenewal;

        if (timeSinceLastRenewal > intervalMs) {
            logger.debug(`Renewing session +${intervalMinutes}min`);
            req.session.lastRenewal = now;
        }

        next();
    };
};

const cookieSessionStubs = (req, _res, next) => {
    if (req.session && !req.session.regenerate) {
        req.session.regenerate = callback => {
            logger.debug('session.regenerate() placeholder was called');
            callback(undefined);
        };
    }
    if (req.session && !req.session.save) {
        req.session.save = callback => {
            logger.debug('session.save() placeholder was called');
            callback(undefined);
        };
    }
    next();
};

const wellFormedCall = station => {
    return /^(\d?[a-zA-Z]{1,3}|[a-zA-Z]\d[a-zA-Z]?)\d[a-zA-Z]{1,4}$/.test(station);
};

const toTitleCase = str => {
    return str.replace(/\w\S*/g, function (txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
};

const resolveLocation = async ({ lat, lon }) => {
    const key = conf.geo_key;

    logger.debug(`resolving: ${lat}, ${lon}`);

    // Reverse geocoding is optional; skip cleanly when no GEO_KEY is configured.
    if (!key) {
        logger.debug('resolveLocation() disabled (no GEO_KEY configured)');
        return { location: '' };
    }

    if (!lat || !lon) {
        throw new Error('resolveLocation() missing coordinates params');
    }

    const rawResponse = await axios.get(fillTemplate(conf.geo_endpoint, { lat, lon, key }));

    const { municipality, countrySubdivision, country, countryCode } = rawResponse.data.addresses[0].address;

    if (countryCode === 'US') {
        return { location: `${municipality}, ${countrySubdivision}` };
    } else {
        return { location: `${municipality} (${country})` };
    }
};

const qrzLookup = async (callSign, flexOpts, db = mongoose.connection) => {
    callSign = callSign.toUpperCase();

    // QRZ.com lookup is optional; skip cleanly when no credentials are configured.
    if (!conf.qrz_username || !conf.qrz_password) {
        logger.debug(`qrzLookup(${callSign}): disabled (no QRZ_USERNAME/QRZ_PASSWORD configured)`);
        return { result: null, atQuota: false };
    }

    qrzSessionKey && logger.info(`qrzLookup(${callSign}): using cached session: ${JSON.stringify(qrzSessionKey)}`);

    const { qrzSessionReqTimeoutMs, qrzDataReqTimeoutMs, qrzReqQuota } = flexOpts;

    if (qrzReqPrevQuota && qrzReqPrevQuota !== qrzReqQuota) {
        logger.info(`qrzLookup(${callSign}): detected dynamic quota change`);
        qrzInQuotaWait = 0;
    }

    qrzReqPrevQuota = qrzReqQuota;

    logger.debug(
        `qrzLookup(${callSign} session_req_timeout_ms:${qrzSessionReqTimeoutMs} data_req_timeout_ms:${qrzDataReqTimeoutMs}, quota:${qrzReqQuota})`
    );

    if (!wellFormedCall(callSign)) return { result: null, atQuota: false };

    const QrzCache = getQrzCache(db);
    let foundRecord;

    try {
        if ((foundRecord = await QrzCache.findOne({ callSign }))) {
            logger.info(`qrzLookup(${callSign}): Cache Hit`);

            const { id, _id, ...result } = foundRecord.toObject();
            return { result, atQuota: false };
        } else {
            logger.info(`qrzLookup(${callSign}): Cache Miss`);
        }
    } catch (err) {
        if ('message' in err) {
            logger.error(`qrzLookup(${callSign}) ${err.message}`);
        } else {
            logger.error(err);
        }
    }

    if (qrzInQuotaWait) {
        logger.warn(`QRZ in quotaWait (${qrzInQuotaWait--})`);
        return { result: null, atQuota: true };
    }

    let retry = 2;
    const parser = new XMLParser();

    const getQrzSessionKey = async ({ refresh = false } = {}) => {
        let session;

        if (qrzSessionKey === null || refresh) {
            try {
                ({
                    QRZDatabase: { Session: session }
                } = parser.parse(
                    (
                        await axios.get(
                            fillTemplate(
                                conf.qrz_auth_endpoint,
                                ({ qrz_username, qrz_password, qrz_version, applogname } = conf)
                            ),
                            { timeout: qrzSessionReqTimeoutMs }
                        )
                    ).data
                ));
            } catch (err) {
                if ('message' in err) {
                    logger.error(`getQrzSessionKey() ${err.message}`);
                }
                logger.error(`getQrzSessionKey() returning null key`);
                return (qrzSessionKey = null);
            }

            if (session?.Error) {
                logger.error(`getQrzSessionKey(): ${session.Error}`);
                logger.error(`getQrzSessionKey() returning null key`);
                return (qrzSessionKey = null);
            }

            if (Number.isInteger(session?.Count)) {
                if (session.Count < qrzReqQuota) {
                    logger.info(`qrzLookup(${callSign}): QRZ service provided session: ${JSON.stringify(session.Key)}`);
                    return (qrzSessionKey = session.Key);
                } else {
                    logger.error(
                        `qrzLookup(${callSign}): at quota: ${session.Count}/${qrzReqQuota} in getQrzSessionKey()`
                    );
                    qrzInQuotaWait = 5;
                    return (qrzSessionKey = null);
                }
            } else {
                logger.warn(`qrzLookup(${callSign}): no valid count property in server session`);
            }
        } else {
            return qrzSessionKey;
        }
    };

    if (await getQrzSessionKey()) {
        do {
            let qrzData;

            try {
                ({ data: qrzData } = await axios.get(
                    fillTemplate(conf.qrz_query_endpoint, {
                        qrzSessionKey,
                        callSign,
                        qrz_version: conf.qrz_version
                    }),
                    { timeout: qrzDataReqTimeoutMs }
                ));
            } catch (err) {
                logger.warn(`qrzLookup(${callSign}): Network error in station-data request`);
                if ('message' in err) {
                    logger.warn(err.message);
                }
                if (retry--) {
                    continue;
                } else {
                    logger.error(`qrzLookup(${callSign}): retries exhausted`);
                    return { result: null, atQuota: false };
                }
            }

            try {
                let {
                    Callsign: {
                        nickname = '',
                        name_fmt = '',
                        image: photo = '',
                        email = '',
                        country = '',
                        state = '',
                        addr2 = '',
                        lat = '',
                        lon = ''
                    } = {},
                    Session: { Key: key, Count: count, Error: error } = {}
                } = parser.parse(qrzData).QRZDatabase || {};

                if (Number.isInteger(count)) {
                    logger.info(`qrzLookup(${callSign}) qrz service stats: ${count + 1}/${qrzReqQuota}`);

                    if (count + 1 >= qrzReqQuota) {
                        logger.error(`qrzLookup(${callSign}): at quota: ${count + 1}/${qrzReqQuota} in data req`);

                        qrzSessionKey = null;
                        qrzInQuotaWait = 5;
                        break;
                    }
                }

                if (!key || error?.includes('Session Timeout')) {
                    logger.warn(`qrzLookup(${callSign}): QRZ service indicated session timeout, retries: ${retry}`);
                    await getQrzSessionKey({ refresh: true });

                    if (retry--) {
                        continue;
                    } else {
                        logger.error(`qrzLookup(${callSign}): retries exhausted`);
                        return { result: null, atQuota: false };
                    }
                }

                if (error?.includes('Not found:')) {
                    logger.info(`qrzLookup(${callSign}): station not found`);
                    return { result: null, atQuota: false };
                } else {
                    error && logger.warn(error);

                    if (!name_fmt) return { result: null, atQuota: false };

                    const displayName = nameCase(nickname || name_fmt || '');

                    const location = country?.includes('United States')
                        ? `${toTitleCase(addr2)}, ${state.toUpperCase()}`
                        : `${toTitleCase(addr2)} (${country})`;

                    // logger.debug(await resolveLocation({ lat, lon }));

                    if (!location && lat && lon) {
                        logger.warn(
                            `QRZ Record for ${callSign} has lot/lon but no location, consider calling resolveLocation() for this condition`
                        );
                    }

                    email = validator.isEmail(email) ? email : '';

                    if (conf.qrz_keep_profile_images) {
                        photo = photo.replace(/(https?:\/\/)files.qrz.com/, conf.qrz_image_host);
                        //API (sometimes) Returns: https://files.qrz.com/q/aa7bq/aa7bq.jpg
                        //We Want: https://s3.amazonaws.com/files.qrz.com/q/aa7bq/aa7bq.jpg

                        photo = validator.isURL(photo, {
                            protocols: ['https'],
                            require_tld: true,
                            require_protocol: true,
                            require_host: true,
                            require_port: false,
                            require_valid_protocol: true,
                            allow_underscores: false,
                            allow_trailing_dot: false,
                            allow_protocol_relative_urls: false,
                            allow_fragments: false,
                            allow_query_components: true,
                            disallow_auth: false,
                            validate_length: true
                        })
                            ? photo
                            : '';
                    } else {
                        photo = '';
                    }

                    logger.info(`qrzLookup(${callSign}): Cache Write`);

                    new QrzCache({
                        callSign,
                        displayName,
                        location,
                        photo,
                        email,
                        geo: {
                            type: 'Point',
                            coordinates: [lon, lat]
                        }
                    }).save();

                    return { result: { callSign, displayName, location, photo, email, lat, lon }, atQuota: false };
                }
            } catch (err) {
                if ('message' in err) {
                    logger.error(`qrzLookup(${callSign}) ${err.message}`);
                    return { result: null, atQuota: false };
                }
            }
        } while (retry + 1);

        return { result: null, atQuota: true };
    } else {
        if (qrzInQuotaWait) {
            return { result: null, atQuota: true };
        } else {
            return { result: null, atQuota: false };
        }
    }
};

const authCheck = options => {
    return (req, res, next) => {
        if (options & REQ_LOGIN) {
            if (req.user) {
                next();
            } else {
                logger.debug('authCheck() login missing!');
                res.redirect('/views/login');
            }
        }

        if (options & REQ_CALLSIGN) {
            if (req.user && req.user.callSign) {
                next();
            } else {
                logger.debug('authCheck() callsign missing!');
                res.redirect('/views/myaccount?cswarn=true');
            }
        }
    };
};

const hoursToMilliseconds = hours => hours * 60 * 60 * 1000;

module.exports = {
    addServerInfo,
    populate,
    cookieSessionKeepAlive,
    cookieSessionStubs,
    authCheck,
    flexOpts,
    getFlexOptionsByUser,
    wellFormedCall,
    resolveLocation,
    qrzLookup,
    sanitizeNotes,
    publicEndpoints,
    hoursToMilliseconds,
    fetchChatLog,
    REQ_LOGIN,
    REQ_CALLSIGN,
    REQ_NETOWNER,
    REQ_SUPERUSER
};
