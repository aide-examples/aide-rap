#!/usr/bin/env node
/**
 * Generate SHA-256 password hash for AIDE RAP authentication
 *
 * Usage:
 *   node app/tools/generate-password-hash.js <password>
 *
 * Example:
 *   node app/tools/generate-password-hash.js mysecretpassword
 *   # Output: 5e884898da28047d1650f25e4ca478eb...
 *
 * Copy the output hash to your system's config.json:
 *   {
 *     "auth": {
 *       "passwords": {
 *         "admin": "<paste hash here>",
 *         "user": "",
 *         "guest": ""
 *       }
 *     }
 *   }
 *
 * The password is hashed client-side (browser) before transmission,
 * so only the SHA-256 hash travels over the network.
 */

const crypto = require('crypto');

const password = process.argv[2];

if (!password) {
    console.error('Usage: node generate-password-hash.js <password>');
    console.error('');
    console.error('Example:');
    console.error('  node app/tools/generate-password-hash.js admin123');
    process.exit(1);
}

const hash = crypto.createHash('sha256').update(password).digest('hex');
console.log(hash);
