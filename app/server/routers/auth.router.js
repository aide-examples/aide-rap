/**
 * Authentication Router
 * Handles login, logout, and session management
 * Emits: auth:login:after, auth:login:failed, auth:logout:after
 *
 * Password verification uses SHA-256:
 * - Client hashes password with SHA-256 before sending
 * - Server compares received hash against stored hash
 * - No plaintext passwords travel over the network
 */
const express = require('express');
const eventBus = require('../utils/EventBus');

module.exports = function(cfg) {
    const router = express.Router();

    // Get auth config from system config
    const authConfig = cfg.auth || {};
    const passwords = authConfig.passwords || {};
    const sessionTimeout = authConfig.sessionTimeout || 86400; // 24h default
    const sessionSecret = authConfig.sessionSecret || 'change-me-in-production';

    /**
     * GET /api/auth/config
     * Returns which roles require a password (for login dialog)
     * Public endpoint
     */
    router.get('/api/auth/config', (req, res) => {
        // Check if --noauth flag was passed (development mode)
        if (cfg.noauth) {
            return res.json({ enabled: false });
        }

        // Check if auth section exists in config
        if (!cfg.auth) {
            return res.json({
                enabled: false,
                notConfigured: true,
                message: 'Authentication not configured. Add "auth" section to config.json.'
            });
        }

        // Check if auth is explicitly disabled
        if (!authConfig.enabled) {
            return res.json({ enabled: false });
        }

        // Return which roles need passwords
        // admin always needs password, others only if hash is set
        res.json({
            enabled: true,
            roles: {
                admin: true, // admin always requires password
                user: !!passwords.user,
                guest: !!passwords.guest
            }
        });
    });

    /**
     * POST /api/auth/login
     * Body: { role: 'admin'|'user'|'guest', hash: string }
     * Client sends SHA-256 hash of password (not plaintext)
     * Sets session cookie on success
     */
    router.post('/api/auth/login', express.json(), async (req, res) => {
        const { role, hash: receivedHash } = req.body;

        // Validate role
        if (!['admin', 'user', 'guest'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Get stored password hash for role
        const storedHash = passwords[role];

        // Admin always requires password
        if (role === 'admin') {
            if (!storedHash) {
                return res.status(403).json({ error: 'Admin account not configured' });
            }

            if (receivedHash !== storedHash) {
                eventBus.emit('auth:login:failed', { role, reason: 'invalid_password', ip: req.ip });
                return res.status(401).json({ error: 'Invalid password' });
            }
        } else {
            // user/guest: if hash is empty, allow access without password
            if (storedHash) {
                if (receivedHash !== storedHash) {
                    eventBus.emit('auth:login:failed', { role, reason: 'invalid_password', ip: req.ip });
                    return res.status(401).json({ error: 'Invalid password' });
                }
            }
            // If no hash, allow access (password not required)
        }

        // Create session
        const session = {
            role,
            created: Date.now(),
            expires: Date.now() + (sessionTimeout * 1000)
        };

        // Set signed cookie
        res.cookie('rap-session', JSON.stringify(session), {
            httpOnly: true,
            signed: true,
            maxAge: sessionTimeout * 1000,
            sameSite: 'strict'
        });

        // Emit success event
        eventBus.emit('auth:login:after', { role, ip: req.ip });

        res.json({ success: true, role });
    });

    /**
     * POST /api/auth/logout
     * Clears session cookie
     */
    router.post('/api/auth/logout', (req, res) => {
        // Get role before clearing cookie
        const session = req.signedCookies?.['rap-session'];
        let role = null;
        try {
            const sessionData = typeof session === 'string' ? JSON.parse(session) : session;
            role = sessionData?.role;
        } catch { /* ignore */ }

        res.clearCookie('rap-session');

        // Emit logout event
        eventBus.emit('auth:logout:after', { role, ip: req.ip });

        res.json({ success: true });
    });

    /**
     * GET /api/auth/me
     * Returns current user's role, or 401 if not logged in
     */
    router.get('/api/auth/me', (req, res) => {
        const session = req.signedCookies?.['rap-session'];

        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        try {
            const sessionData = typeof session === 'string' ? JSON.parse(session) : session;

            // Check expiry
            if (sessionData.expires && Date.now() > sessionData.expires) {
                res.clearCookie('rap-session');
                return res.status(401).json({ error: 'Session expired' });
            }

            // Get client IP (prefer X-Forwarded-For for reverse proxy setups)
            const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

            res.json({ role: sessionData.role, ip });
        } catch (e) {
            res.clearCookie('rap-session');
            return res.status(401).json({ error: 'Invalid session' });
        }
    });

    return router;
};
