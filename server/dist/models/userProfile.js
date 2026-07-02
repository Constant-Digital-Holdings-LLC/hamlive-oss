/* hamlive-oss — MIT License. See LICENSE. */

const { modelMaker } = require('../lib/modelMaker');
const { Schema, SchemaTypes } = require('mongoose');
const uniqueValidator = require('mongoose-unique-validator');
require('mongoose-type-email');

const { flexOptionsLocalSchema } = require('./flexOptions');
const { initialReg } = require('./initialRegTracker');

const userProfileSchema = new Schema(
    {
        displayName: {
            type: String,
            required: [true, 'display name required'],
            unique: false,
            minlength: 2,
            maxlength: 40,
            validate: {
                validator: function (v) {
                    return /^[\p{L}\p{N}'()\/ -]+$/u.test(v);
                },
                message: 'invalid characters in display name'
            }
        },
        googleId: String,
        lastLogin: { type: Date, default: Date.now },
        callSign: {
            type: String,
            unique: true,
            sparse: true,
            minlength: 3,
            maxlength: 7,
            validate: {
                validator: v => /^(\d?[a-zA-Z]{1,3}|[a-zA-Z]\d[a-zA-Z]?)\d[a-zA-Z]{1,4}$/.test(v),
                message: 'malformed callsign'
            }
        },
        photo: {
            type: String,
            validate: {
                validator: function (v) {
                    if (!v) return true; // Allow empty/null values
                    try {
                        new URL(v);
                        return true;
                    } catch (e) {
                        return false;
                    }
                },
                message: props => `${props.value} is not a valid URL!`
            }
        },
        location: {
            type: String,
            unique: false,
            minlength: 5,
            maxlength: 24,
            validate: {
                validator: function (v) {
                    return /^[0-9A-zÀ-ú-', ()]+$/.test(v);
                },
                message: 'invalid characters in location'
            }
        },
        newAccount: { type: Boolean, default: true },
        lastAuthVia: {
            type: String,
            enum: {
                values: ['google', 'email'],
                message: '{VALUE} not in auth via list'
            },
            required: [true, 'lastAuthVia required in userprofile']
        },
        policyConsent: { type: Boolean, default: false },
        flaggedForDeletion: { type: Boolean, default: false },
        email: {
            type: SchemaTypes.Email,
            required: true,
            unique: true,
            sparse: true
        },
        locked: { type: Boolean, default: false },
        superUser: { type: Boolean, default: false, index: true },
        verified: { type: Boolean, default: false },
        flexOptions: {
            type: flexOptionsLocalSchema
        },
        initialReg: {
            type: Schema.Types.ObjectId,
            ref: 'InitialReg'
        },
        myNets: [
            {
                type: Schema.Types.ObjectId,
                ref: 'NetProfile'
            }
        ],
        following: [
            {
                type: Schema.Types.ObjectId,
                ref: 'NetProfile'
            }
        ],
        dismissedNotifications: [
            {
                notificationId: {
                    type: String,
                    required: true
                },
                dismissedAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ]
    },
    { timestamps: true }
);

userProfileSchema.plugin(uniqueValidator, {
    message:
        'Callsign already registered to a different email address. To fix: logout and login again with the email you **1st registered with**'
});

module.exports = {
    getUserProfile: db => modelMaker({ db, m: 'UserProfile', s: userProfileSchema }),
    userProfileSchema
};
