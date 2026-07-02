/* hamlive-oss — MIT License. See LICENSE. */
const path = require('path');
const fs = require('fs');
const YAML = require('yaml');
const _ = require('lodash');

// Load environment variables from a root .env file if present.
// Secrets and instance-specific values live in .env (or the real environment),
// never in the committed YAML. See .env.example and INSTALL.md.
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

let baseConfigf;
let commonConfigf;
let conf = {};

try {
    commonConfigf = fs.readFileSync(path.resolve(__dirname, '../commonConfig.yaml'), 'utf8');

    if (process.env.NODE_ENV === 'development') {
        baseConfigf = fs.readFileSync(path.resolve(__dirname, '../devConfig.yaml'), 'utf8');
    } else {
        baseConfigf = fs.readFileSync(path.resolve(__dirname, '../prodConfig.yaml'), 'utf8');
    }

    conf = _.merge(YAML.parse(commonConfigf), YAML.parse(baseConfigf));
} catch (err) {
    console.error(err.stack);
}

// Overlay secrets / instance config from environment variables.
// Every integration is optional: when its variables are absent the related
// feature degrades gracefully (see INSTALL.md, "Local test drive").
const fromEnv = {
    dburi: process.env.MONGODB_URI,
    base_url: process.env.BASE_URL,
    cookie_session_key: process.env.COOKIE_SESSION_KEY,
    magic_link_secret: process.env.MAGIC_LINK_SECRET,
    sendgrid_api_key: process.env.SENDGRID_API_KEY,
    sendgrid_net_close_template_id: process.env.SENDGRID_NET_CLOSE_TEMPLATE_ID,
    zeptomail_api_key: process.env.ZEPTOMAIL_API_KEY,
    email_from: process.env.EMAIL_FROM,
    stream_api_key: process.env.STREAM_API_KEY,
    stream_api_secret: process.env.STREAM_API_SECRET,
    google_client_id: process.env.GOOGLE_CLIENT_ID,
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    qrz_username: process.env.QRZ_USERNAME,
    qrz_password: process.env.QRZ_PASSWORD,
    geo_key: process.env.GEO_KEY,
    cmd_help_url: process.env.CMD_HELP_URL,
    app_name: process.env.APP_NAME,
    // Ads & analytics provider IDs (optional; only used when the matching
    // feature is enabled below). Use your OWN accounts — never the project's.
    adplugg_access_code: process.env.ADPLUGG_ACCESS_CODE,
    google_analytics_id: process.env.GOOGLE_ANALYTICS_ID
};

for (const [key, value] of Object.entries(fromEnv)) {
    if (value !== undefined && value !== '') {
        conf[key] = value;
    }
}

// Feature toggles — OFF by default in the community edition (see commonConfig.yaml).
// Enable explicitly with ADS_ENABLED=true / ANALYTICS_ENABLED=true.
if (process.env.ADS_ENABLED !== undefined) {
    conf.ads_enabled = process.env.ADS_ENABLED === 'true';
}
if (process.env.ANALYTICS_ENABLED !== undefined) {
    conf.analytics_enabled = process.env.ANALYTICS_ENABLED === 'true';
}

module.exports.conf = conf;
