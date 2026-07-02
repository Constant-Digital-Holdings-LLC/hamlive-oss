/* hamlive-oss — MIT License. See LICENSE. */

const { getUserProfile } = require('../models/userProfile');
const sgMail = require('@sendgrid/mail');
const axios = require('axios');
const he = require('he');
const { conf } = require('../lib/configLib');
const validator = require('validator');

const parseEmailFrom = value => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const match = trimmed.match(/^(.*?)<([^<>]+)>$/);
    const address = match ? match[2].trim() : trimmed;
    const name = match ? match[1].trim().replace(/^"|"$/g, '') : conf.app_name || 'Ham.Live';

    if (!validator.isEmail(address)) {
        return null;
    }

    return {
        address,
        name: name || conf.app_name || 'Ham.Live'
    };
};

// Email delivery is optional. ZeptoMail is preferred when fully configured,
// otherwise SendGrid is used. When neither provider is configured, messages are
// logged to the server console instead of being sent (see INSTALL.md,
// "Local test drive").
const RAW_EMAIL_FROM = process.env.EMAIL_FROM || conf.email_from || '';
const EMAIL_FROM = RAW_EMAIL_FROM || `${conf.app_name || 'Ham.Live'} <no-reply@example.com>`;
const zeptoMailEnabled = Boolean(conf.zeptomail_api_key && parseEmailFrom(RAW_EMAIL_FROM));
const sendGridEnabled = Boolean(conf.sendgrid_api_key);
const emailProvider = zeptoMailEnabled ? 'zeptomail' : sendGridEnabled ? 'sendgrid' : null;
const emailEnabled = Boolean(emailProvider);
const ZEPTOMAIL_EMAIL_URL = 'https://api.zeptomail.com/v1.1/email';

if (emailProvider === 'sendgrid') {
    sgMail.setApiKey(conf.sendgrid_api_key);
}
// SendGrid dynamic-template ID for the Net Close Report (the post-net log emailed
// to the net owner when a net closes). Self-hosters: create your own template from
// docs/email-templates/net-close-report.html and set SENDGRID_NET_CLOSE_TEMPLATE_ID.
// When unset, the close-report email is skipped (all other features still work).
const NET_CLOSE_TEMPLATE_ID = process.env.SENDGRID_NET_CLOSE_TEMPLATE_ID || conf.sendgrid_net_close_template_id || '';
const humanizeDuration = require('humanize-duration');
const { getFlexOptionsByUser, fetchChatLog } = require('../lib/serverUtils');
const { logger } = require('./logger');
// NOTE: roomHistory import removed - now using fetchChatLog from serverUtils which uses GetStream
const slugify = require('slugify');
const mongoose = require('mongoose');

const escapeHtml = value => he.escape(String(value ?? ''));

const escapeAttr = value => escapeHtml(value).replace(/"/g, '&quot;');

const csvValue = value => {
    const stringValue = String(value ?? '');

    if (/[",\n\r]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
};

const makeEmailLayout = ({ title, preheader = '', bodyHtml }) => {
    const appName = escapeHtml(conf.app_name || 'Ham.Live');
    const safeTitle = escapeHtml(title);
    const safePreheader = escapeHtml(preheader);

    return (
        '<!doctype html>' +
        '<html><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        `<title>${safeTitle}</title>` +
        '</head>' +
        '<body style="margin:0;padding:0;background:#f6f7f9;color:#1f2933;font-family:Arial,Helvetica,sans-serif;">' +
        `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${safePreheader}</span>` +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:24px 12px;">' +
        '<tr><td align="center">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;background:#ffffff;border:1px solid #d9e2ec;border-radius:8px;overflow:hidden;">' +
        `<tr><td style="background:#102a43;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold;">${appName}</td></tr>` +
        '<tr><td style="padding:24px;">' +
        `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#102a43;">${safeTitle}</h1>` +
        bodyHtml +
        '</td></tr>' +
        `<tr><td style="padding:16px 24px;background:#f0f4f8;color:#52606d;font-size:12px;">Sent by ${appName}</td></tr>` +
        '</table>' +
        '</td></tr>' +
        '</table>' +
        '</body></html>'
    );
};

const renderMagicLinkEmail = link =>
    makeEmailLayout({
        title: 'Finish signing in',
        preheader: 'Use this secure link to finish signing in.',
        bodyHtml:
            '<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">Use the button below to finish signing in. If you did not request this email, you can ignore it.</p>' +
            `<p style="margin:0 0 22px;"><a href="${escapeAttr(link)}" style="display:inline-block;background:#0967d2;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:bold;">Finish signing in</a></p>` +
            `<p style="margin:0;color:#52606d;font-size:12px;line-height:1.5;">If the button does not work, copy and paste this link into your browser:<br><a href="${escapeAttr(link)}" style="color:#0967d2;">${escapeHtml(link)}</a></p>`
    });

const renderNetCloseReportHtml = ({ title, url, formattedAttendees, startedAtString }) => {
    const attendeeRows = formattedAttendees
        .map(attendee => {
            const role = attendee.role ? `[${escapeHtml(attendee.role)}]` : '';
            const sigReport = attendee.sigReport ? ` (${escapeHtml(attendee.sigReport)})` : '';
            const rowBackground = attendee.highlight ? 'background:#f0f4f8;' : '';

            return (
                `<tr style="${rowBackground}">` +
                `<td style="padding:8px 10px;border-top:1px solid #d9e2ec;">${role}</td>` +
                `<td style="padding:8px 10px;border-top:1px solid #d9e2ec;"><strong>${escapeHtml(
                    attendee.callSign
                )}</strong>${sigReport}</td>` +
                `<td style="padding:8px 10px;border-top:1px solid #d9e2ec;">${escapeHtml(attendee.checkInTime)}</td>` +
                '</tr>'
            );
        })
        .join('');

    const startedHtml = startedAtString
        ? `<p style="margin:0 0 16px;color:#52606d;">Net start time: ${escapeHtml(startedAtString)}</p>`
        : '';

    return makeEmailLayout({
        title: `${title} - Net Close Report`,
        preheader: `Post-net report for ${title}`,
        bodyHtml:
            `<p style="margin:0 0 16px;"><a href="${escapeAttr(url)}" style="color:#0967d2;font-weight:bold;">${escapeHtml(
                title
            )}</a></p>` +
            startedHtml +
            '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #d9e2ec;border-collapse:collapse;font-size:14px;">' +
            '<caption style="caption-side:top;text-align:left;padding:0 0 8px;font-weight:bold;color:#102a43;">Station Info</caption>' +
            '<thead><tr style="background:#f0f4f8;">' +
            '<th align="left" style="padding:8px 10px;">Role</th>' +
            '<th align="left" style="padding:8px 10px;">Callsign</th>' +
            '<th align="left" style="padding:8px 10px;">Check-In Time</th>' +
            '</tr></thead>' +
            `<tbody>${attendeeRows}</tbody>` +
            '</table>' +
            '<p style="margin:16px 0 0;color:#52606d;font-size:13px;">The roster CSV and chat log are attached.</p>'
    });
};

const sendGridTemplateToHtml = emailData => {
    const templateData = emailData.dynamic_template_data || {};

    return renderNetCloseReportHtml({
        title: templateData.title || 'Net',
        url: templateData.url || conf.base_url || '',
        formattedAttendees: templateData.formattedAttendees || [],
        startedAtString: templateData.startedAtString || ''
    });
};

const toZeptoMailAttachment = attachment => ({
    content: attachment.content,
    mime_type: attachment.mime_type || attachment.type || 'application/octet-stream',
    name: attachment.name || attachment.filename || 'attachment'
});

const buildZeptoMailPayload = (emailData, validRecipients) => {
    const from = parseEmailFrom(emailData.from || RAW_EMAIL_FROM);

    if (!from) {
        throw new Error('ZeptoMail requires EMAIL_FROM to be a valid verified sender address');
    }

    const subject = emailData.subject || emailData.dynamic_template_data?.subject;
    const htmlbody = emailData.html || emailData.htmlbody || sendGridTemplateToHtml(emailData);
    const payload = {
        from,
        to: validRecipients.map(address => ({
            email_address: {
                address
            }
        })),
        subject,
        htmlbody,
        track_clicks: false,
        track_opens: false
    };

    if (Array.isArray(emailData.attachments) && emailData.attachments.length) {
        payload.attachments = emailData.attachments.map(toZeptoMailAttachment);
    }

    return payload;
};

const shouldRetryZeptoMailError = err => {
    if (!err.response) {
        return true;
    }

    return err.response.status === 429 || err.response.status >= 500;
};

const getErrorMessage = err => err.response?.data?.error?.message || err.response?.data?.message || err.message;

class EmailBase {
    #subject;
    #message;
    #body;

    constructor(param = {}) {
        const { subject, message, body } = param;

        this.#subject = subject;
        this.#message = message;
        this.#body = body;

        if (!body && !(subject && message)) {
            throw new Error('In the constructor, if "body" is missing, both "subject" and "message" are mandatory.');
        }
    }

    get body() {
        return this.#body;
    }

    async sendMailToAddrs(recipients) {
        if (!Array.isArray(recipients)) {
            const error = 'Invalid parameter: recipients should be an array';
            logger.error(`sendMailToAddrs() ${error}`);
            throw new Error(error);
        }

        if (!recipients.length) {
            const error = 'Invalid parameter: recipients array is empty';
            logger.error(`sendMailToAddrs() ${error}`);
            throw new Error(error);
        }

        const uniqueRecipients = this.getUniqueRecipients(recipients);
        const validRecipients = this.getValidRecipients(uniqueRecipients);

        if (validRecipients.length !== uniqueRecipients.length) {
            logger.error('sendMailToAddrs() contains invalid email addresses');
            throw new Error('Invalid email addresses in recipients');
        }

        if (uniqueRecipients.length !== recipients.length) {
            logger.warn('sendMailToAddrs() contains duplicate email addresses');
        }

        try {
            const subject = this.getSubject();
            const emailData = this.getEmailData(validRecipients, subject);
            await this.sendEmailWithRetry(emailData, validRecipients);
        } catch (err) {
            logger.error(`Failed to send mail: ${err.message}`);
            throw err;
        }
    }

    getUniqueRecipients(recipients) {
        return [...new Set(recipients)];
    }

    getValidRecipients(uniqueRecipients) {
        return uniqueRecipients.filter(email => validator.isEmail(email));
    }

    getSubject() {
        return this.#subject || this.body?.subject || this.body?.dynamic_template_data?.subject;
    }

    getEmailData(validRecipients, subject) {
        return this.#body
            ? { ...this.#body, to: validRecipients }
            : {
                  to: validRecipients,
                  from: EMAIL_FROM,
                  subject: subject,
                  html: this.#message
              };
    }

    async sendEmailWithRetry(emailData, validRecipients) {
        if (!emailEnabled) {
            const subject = emailData.subject || emailData.dynamic_template_data?.subject || '(templated email)';
            logger.info(`[email disabled] Would send "${subject}" to ${validRecipients.join(', ')}`);
            return;
        }

        if (emailProvider === 'zeptomail') {
            return this.sendZeptoMailWithRetry(emailData, validRecipients);
        }

        return this.sendSendGridWithRetry(emailData, validRecipients);
    }

    async sendSendGridWithRetry(emailData, validRecipients) {
        if ('templateId' in emailData && !emailData.templateId) {
            const skipSubject = emailData.dynamic_template_data?.subject || emailData.subject || '(templated email)';
            logger.warn(
                `[email] Skipping "${skipSubject}" — no SendGrid template configured. ` +
                    `Set SENDGRID_NET_CLOSE_TEMPLATE_ID (see docs/email-templates/). ` +
                    `Recipients: ${validRecipients.join(', ')}`
            );
            return;
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await sgMail.sendMultiple(emailData);
                logger.info(`Mail successfully sent to SendGrid for ${validRecipients.length} recipients`);
                return;
            } catch (err) {
                if (attempt < 2) {
                    logger.warn(`Failed to send to SendGrid on attempt ${attempt + 1}: ${err.message}. Retrying...`);
                } else {
                    logger.error(`Failed to send to SendGrid on final attempt: ${err.message}`);
                    throw err;
                }
            }
        }
    }

    async sendZeptoMailWithRetry(emailData, validRecipients) {
        const payload = buildZeptoMailPayload(emailData, validRecipients);

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await axios.post(ZEPTOMAIL_EMAIL_URL, payload, {
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        Authorization: `Zoho-enczapikey ${conf.zeptomail_api_key}`
                    },
                    timeout: Number(conf.http_client_timeout) || 15000
                });
                logger.info(`Mail successfully sent to ZeptoMail for ${validRecipients.length} recipients`);
                return;
            } catch (err) {
                const message = getErrorMessage(err);

                if (attempt < 2 && shouldRetryZeptoMailError(err)) {
                    logger.warn(`Failed to send to ZeptoMail on attempt ${attempt + 1}: ${message}. Retrying...`);
                } else {
                    logger.error(`Failed to send to ZeptoMail on final attempt: ${message}`);
                    throw err;
                }
            }
        }
    }

    async sendMailToUPIDs({ upids, db = mongoose.connection }) {
        try {
            const UserProfile = getUserProfile(db);

            if (!Array.isArray(upids)) {
                logger.error('sendMailToUPIDs() expects upids array as param');
                throw new Error('Invalid parameter: UPIDs should be an array');
            }

            if (!upids.length) {
                logger.error('sendMailToUPIDs() UPIDs array length 0');
                throw new Error('Invalid parameter: UPIDs array is empty');
            }

            const users = await Promise.all(
                upids.map(upid =>
                    UserProfile.findById(upid).catch(err => {
                        logger.error(`Error fetching user profile for UPID ${upid}: ${err.message}`);
                        return null;
                    })
                )
            ).then(users => users.filter(user => user !== null));

            if (!users.length) {
                logger.warn('No valid user profiles found for provided UPIDs');
                return;
            }

            const boolArray = await Promise.all(
                users.map(async user => {
                    try {
                        return (await getFlexOptionsByUser({ user, cachedResponse: false, db })).email;
                    } catch (err) {
                        logger.error(`Error fetching flex options for user ${user._id}: ${err.message}`);
                        return false;
                    }
                })
            );

            const recipients = users.filter((value, index) => boolArray[index]).map(user => user.email);

            if (recipients?.length) {
                await this.sendMailToAddrs(recipients);
            } else {
                logger.info(
                    `All intended recipients of "${
                        this.body?.subject || this.body.dynamic_template_data.subject
                    }" have email disabled`
                );
            }
        } catch (err) {
            logger.error(`Error in sendMailToUPIDs: ${err.message}`);
        }
    }
}

class NetAnnounceStart extends EmailBase {
    constructor({ netControl, netProfileDoc: { title }, liveNetDoc: { countdownTimer, url } }) {
        let humanTime;

        if (countdownTimer <= 1) {
            humanTime = 'now';
        } else {
            humanTime =
                'in ' +
                humanizeDuration(countdownTimer * 60 * 1000, {
                    largest: 2,
                    round: true,
                    delimiter: '--',
                    units: ['h', 'm']
                });
        }

        super({
            body: {
                from: EMAIL_FROM,
                subject: `${title}(★) is going live ${humanTime} !`,
                html: makeEmailLayout({
                    title: `${title} is going live ${humanTime}`,
                    preheader: `${title} is going live ${humanTime}`,
                    bodyHtml:
                        `<p style="margin:0 0 18px;font-size:15px;line-height:1.5;">${escapeHtml(
                            netControl
                        )} is starting <a href="${escapeAttr(`${conf.base_url}${url}`)}" style="color:#0967d2;">${escapeHtml(
                            title
                        )}</a>.</p>` +
                        `<p style="margin:0 0 22px;"><a href="${escapeAttr(
                            `${conf.base_url}${url}`
                        )}" style="display:inline-block;background:#0967d2;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:bold;">Join the net</a></p>` +
                        `<p style="margin:0;color:#52606d;font-size:12px;line-height:1.5;">To stop receiving these messages, unfollow ${escapeHtml(
                            title
                        )} at <a href="${escapeAttr(
                            `${conf.base_url}/views/favorites`
                        )}" style="color:#0967d2;">Favorites</a>.</p>`
                })
            }
        });
    }
}

class NetCloseReport extends EmailBase {
    // Static private symbol used to control constructor access
    static #_internal = Symbol('internal');

    // Private properties
    #title;
    #NPID;
    #attendees;

    // Static async constructor
    static async init({ netProfileDoc: { id: NPID, title }, liveNetDoc: { url, started, startedAt }, attendees }) {
        // Attempt to fetch chat log, but continue with empty log if it fails
        let chatLog = null;
        try {
            chatLog = await fetchChatLog({ NPID, since: attendees[0]?.checkedInAt });
        } catch (chatErr) {
            logger.warn(`Failed to fetch chat log for NPID: ${NPID}. Error: ${chatErr.message}`);
            logger.info('Continuing report generation without chat log (chat service unavailable)');
            // chatLog remains null - report will be generated without it
        }

        // Pass the private symbol when calling the actual constructor
        // Report is always created, with or without chat log
        return new NetCloseReport(NetCloseReport.#_internal, {
            title,
            NPID,
            url,
            started,
            startedAt,
            attendees,
            chatLog
        });
    }

    // Private constructor
    constructor(key, { title, NPID, url, started, startedAt, attendees, chatLog }) {
        // Check if the key matches the private static symbol
        if (key !== NetCloseReport.#_internal) {
            throw new Error('NetCloseReport constructor is private. Use NetCloseReport.init() instead.');
        }

        // Perform computations before calling super()
        const sortedAttendees = NetCloseReport.#sortAttendees(attendees);
        const formattedAttendees = NetCloseReport.#formatAttendees(sortedAttendees);
        const attachments = NetCloseReport.#createAttachments({
            title,
            NPID,
            url,
            started,
            startedAt,
            formattedAttendees,
            chatLog
        });

        // Call the parent class constructor
        super({
            body: {
                from: EMAIL_FROM,
                templateId: NET_CLOSE_TEMPLATE_ID,
                dynamic_template_data: {
                    subject: `${title} - Net Close Report`,
                    url: `${conf.base_url}${url}`,
                    title: title,
                    formattedAttendees: formattedAttendees,
                    startedAtString: started ? new Date(startedAt).toUTCString() : ''
                },
                attachments: attachments
            }
        });

        // Set instance properties
        this.#title = title;
        this.#NPID = NPID;
        this.#attendees = sortedAttendees;
        this.#reportGeneration();

        logger.debug(this.body.dynamic_template_data);
    }

    // Private method to log report generation
    #reportGeneration() {
        logger.info(
            `Generating Report for ${this.#title} (NPID:${this.#NPID}): ${this.#attendees
                .map(attendee => attendee.callSign)
                .join(', ')}`
        );
    }

    // Static method to sort attendees
    static #sortAttendees(attendees) {
        // Sorting logic based on role and check-in time
        return attendees.sort((a, b) => {
            const rolePriority = { netcontrol: 1, netlogger: 2, netrelay: 3 };
            const aRole = rolePriority[a.role] || 4;
            const bRole = rolePriority[b.role] || 4;

            if (aRole !== bRole) {
                return aRole - bRole;
            }

            return new Date(a.checkedInAt) - new Date(b.checkedInAt);
        });
    }

    // Static method to format attendees
    static #formatAttendees(attendees) {
        // Formatting attendee data for the report
        return attendees.map(a => ({
            callSign: a.callSign,
            role:
                a.role === 'netcontrol'
                    ? 'NCS'
                    : a.role === 'netrelay'
                      ? 'Relay'
                      : a.role === 'netlogger'
                        ? 'Logger'
                        : '',
            checkInIsoDate: new Date(a.checkedInAt).toISOString(),
            checkInTime: new Date(a.checkedInAt).toUTCString().split(' ').slice(4).join(' '),
            displayName: a.displayName || '',
            location: a.location || '',
            sigReport: a.rst || '',
            highlight: a.highlight || false
        }));
    }

    // Static method to create email attachments
    static #createAttachments({ title, NPID, url, started, startedAt, formattedAttendees, chatLog }) {
        // Header and chat log:
        const chatHeader = `${title} (ID: ${NPID})\n\n`;
        const chatLogString = chatLog ? chatHeader + chatLog : chatHeader + '[ Empty Chat Log ]';

        const csvString = [
            [
                'Net',
                'Callsign',
                'Role',
                'Highlighted',
                'Check-In Date',
                'Name',
                'Location',
                'SigReport',
                'URL',
                'Net ID',
                'Net Start Date'
            ],
            ...formattedAttendees.map(a => [
                csvValue(title),
                csvValue(a.callSign),
                csvValue(a.role),
                csvValue(a.highlight ? 'True' : ''),
                csvValue(a.checkInIsoDate),
                csvValue(a.displayName),
                csvValue(a.location),
                csvValue(a.sigReport),
                csvValue(`${conf.base_url}${url}`),
                csvValue(NPID),
                csvValue(started ? new Date(startedAt).toISOString() : '')
            ])
        ]
            .map(e => e.join(','))
            .join('\n');

        const slug = slugify(title, {
            replacement: '_',
            lower: true,
            strict: true,
            locale: 'vi',
            trim: true
        });

        const formattedStartedAt = startedAt
            ? new Date(startedAt).toISOString().replace(/[:.]/g, '-')
            : 'in_pre-start_grace_period';

        // Returning attachments array
        return [
            {
                content: Buffer.from(csvString, 'utf8').toString('base64'),
                filename: `${slug}_${formattedStartedAt}_report.csv`,
                type: 'text/csv',
                disposition: 'attachment',
                content_id: 'report'
            },
            {
                content: Buffer.from(chatLogString, 'utf8').toString('base64'),
                filename: `${slug}_${formattedStartedAt}_chat.txt`,
                type: 'text/plain',
                disposition: 'attachment',
                content_id: 'chatlog'
            }
        ];
    }
}

module.exports = {
    EmailBase,
    NetAnnounceStart,
    NetCloseReport,
    emailEnabled,
    emailProvider,
    renderMagicLinkEmail,
    __test__: {
        buildZeptoMailPayload,
        parseEmailFrom,
        renderMagicLinkEmail,
        renderNetCloseReportHtml,
        toZeptoMailAttachment
    }
};
