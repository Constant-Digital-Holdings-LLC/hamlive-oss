/* hamlive-oss — MIT License. See LICENSE. */

const router = require('express').Router();
const passport = require('passport');
const { conf } = require('../lib/configLib');
const { logger } = require('../lib/logger');
const UserProfile = require('../models/userProfile').getUserProfile(null);
const GoogleStrategy = require('passport-google-oauth20');
const MagicLoginStrategy = require('passport-magic-login').default;
const gravatar = require('gravatar');
const { EmailBase, emailEnabled, renderMagicLinkEmail } = require('../lib/userNotification');
const { getSafeGoogleDisplayName } = require('../lib/googleProfileDisplayName');

//MagicLogin Auth:
const magicLogin = new MagicLoginStrategy({
    secret: conf.magic_link_secret,
    callbackUrl: '/auth/magiclogin/callback',

    sendMagicLink: async (destination, href, _code, req) => {
        const link = `${conf.base_url}${href}`;

        // Local test drive: when email delivery is not configured, surface the
        // sign-in link directly (returned to the browser by the route below) and
        // also print it to the server console.
        if (!emailEnabled) {
            if (req) req._devMagicLink = link;
            logger.info(
                `\n\n========== LOCAL LOGIN (email delivery disabled) ==========\n` +
                    `Magic sign-in link for ${destination}:\n${link}\n` +
                    `Open it in your browser to finish logging in.\n` +
                    `==========================================================\n`
            );
            return;
        }

        try {
            const email = new EmailBase({
                subject: 'Click to finish signing in',
                message: renderMagicLinkEmail(link)
            });

            await email.sendMailToAddrs([destination]);

            logger.info(`Auth link email sent to ${destination}`);
        } catch (err) {
            logger.error(err.stack);
        }
    },

    verify: (payload, done) => {
        logger.info(`look for user with this email or create user: ${payload.destination}`);

        if (!payload.destination) {
            logger.error(`paylaod: ${payload}`);
            logger.error(`paylaod type: ${typeof payload}`);
            logger.error(`paylaod stringified: ${JSON.stringify(payload)}`);

            throw new Error('Magic login payload missing destination');
        }
        //check if user already exists in our db
        UserProfile.findOneAndUpdate(
            { email: payload.destination },
            {
                lastLogin: Date.now(),
                lastAuthVia: 'email',
                photo: gravatar.url(payload.destination, { protocol: 'https' })
            }
        ).then(currentUser => {
            if (currentUser) {
                //already have the user
                logger.debug('Magic Login Auth-return user found: ', currentUser);
                if (currentUser.locked) {
                    logger.error(`Account locked for ${currentUser.email}`);

                    done(null, false);
                } else {
                    done(null, currentUser);
                }
            } else {
                // if not, create user in our db
                new UserProfile({
                    lastAuthVia: 'email',
                    displayName: '',
                    flexOptions: {
                        option: {}
                    },
                    email: payload.destination,
                    photo: gravatar.url(payload.destination),
                    newAccount: true
                })
                    .save({ validateBeforeSave: false })
                    .then(newUser => {
                        logger.info('new partial user account created (email link)' + newUser);
                        done(null, newUser);
                    })
                    .catch(err => {
                        logger.error(err.stack);
                        logger.error('Likely data validation error. Missing required info on user creation?');
                    });
            }
        });
    },

    jwtOptions: {
        expiresIn: '30 days'
    }
});

passport.use(magicLogin);
router.post('/magiclogin', (req, res, next) => {
    // When email delivery is disabled (local test drive), include the sign-in
    // link in the JSON response so the browser can show it — no logs needed.
    if (!emailEnabled) {
        const origJson = res.json.bind(res);
        res.json = body => origJson({ ...body, devMagicLink: req._devMagicLink || null });
    }
    return magicLogin.send(req, res, next);
});
// router.get('/magiclogin/callback', passport.authenticate('magiclogin'));
router.get('/magiclogin/callback', passport.authenticate('magiclogin'), (req, res) => {
    if (req.user) {
        if (req.user.callSign) {
            res.redirect('/views/dashboard');
        } else {
            res.redirect('/views/myaccount');
        }
    } else {
        res.redirect('/views/login');
    }
});

//Google Auth (optional):
// Only register the Google strategy and routes when credentials are configured.
// Without them, the login page shows email magic-link sign-in only.
const googleAuthEnabled = Boolean(conf.google_client_id && conf.google_client_secret);

if (googleAuthEnabled) {
    passport.use(
        new GoogleStrategy(
            {
                //options for google strat
                callbackURL: `${conf.base_url}/auth/google/redirect`,
                clientID: conf.google_client_id,
                clientSecret: conf.google_client_secret
            },
            (accessToken, refreshToken, profile, done) => {
            //passport callback function

            logger.debug('Google authenticated: ' + profile.displayName);
            const safeDisplayName = getSafeGoogleDisplayName(profile);

            //check if user already exists in our db
            UserProfile.findOneAndUpdate(
                { email: profile.emails[0].value },
                {
                    lastLogin: Date.now(),
                    lastAuthVia: 'google',
                    photo: profile.photos[0].value
                }
            ).then(currentUser => {
                if (currentUser) {
                    //already have the user
                    logger.debug('Google Auth-return user found: ', currentUser);

                    if (currentUser.locked) {
                        logger.error(`Account locked for ${currentUser.email}`);

                        done(null, false);
                    } else {
                        done(null, currentUser);
                    }
                } else {
                    // if not, create user in our db
                    new UserProfile({
                        lastAuthVia: 'google',
                        displayName: safeDisplayName,
                        googleId: profile.id,
                        flexOptions: {
                            option: {}
                        },
                        email: profile.emails[0].value,
                        photo: profile.photos[0].value,
                        newAccount: true
                    })
                        .save()
                        .then(newUser => {
                            logger.debug('new partial user account created (google)' + newUser);
                            done(null, newUser);
                        })
                        .catch(err => {
                            logger.error(err.stack);
                            logger.error('Likely data validation error. Missing required info on user creation?');
                        });
                }
            });
        }
    )
);

//callback for google to redirect to
router.get('/google/redirect', passport.authenticate('google'), (req, res) => {
    // this time around, we have a "code" on the uri from google. Passport will exchange the code
    // for profile info

    if (req.user) {
        if (req.user.callSign) {
            res.redirect('/views/dashboard');
        } else {
            res.redirect('/views/myaccount');
        }
    } else {
        res.redirect('/views/login');
    }
});

// google specific auth, specify what we want from google (scope)
router.get(
    '/google',
    passport.authenticate('google', {
        scope: ['profile', 'email']
    })
);
} else {
    logger.warn('Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) — email sign-in only.');
    // Fallback so a stray link does not 404; send users to the login page.
    router.get(['/google', '/google/redirect'], (req, res) => res.redirect('/views/login'));
}

//logout is now async
router.get('/logout', function (req, res, next) {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        res.redirect('/views/dashboard');
    });
});

//old sync version
// router.get('/logout', (req, res) => {
//     req.logout();
//     res.redirect('/views/dashboard');
// });

router.get('/login', (req, res) => {
    res.redirect('/views/login');
});

module.exports = router;
