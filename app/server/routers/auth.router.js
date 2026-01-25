/**
 * Authentication Router
 * Handles login, logout, and session management
 */
const express = require('express');
const bcrypt = require('bcrypt');

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
     * Body: { role: 'admin'|'user'|'guest', password: string }
     * Sets session cookie on success
     */
    router.post('/api/auth/login', express.json(), async (req, res) => {
        const { role, password } = req.body;

        // Validate role
        if (!['admin', 'user', 'guest'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Get password hash for role
        const hash = passwords[role];

        // Admin always requires password
        if (role === 'admin') {
            if (!hash) {
                return res.status(403).json({ error: 'Admin account not configured' });
            }

            const valid = await bcrypt.compare(password || '', hash);
            if (!valid) {
                return res.status(401).json({ error: 'Invalid password' });
            }
        } else {
            // user/guest: if hash is empty, allow access without password
            if (hash) {
                const valid = await bcrypt.compare(password || '', hash);
                if (!valid) {
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

        res.json({ success: true, role });
    });

    /**
     * POST /api/auth/logout
     * Clears session cookie
     */
    router.post('/api/auth/logout', (req, res) => {
        res.clearCookie('rap-session');
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

            res.json({ role: sessionData.role });
        } catch (e) {
            res.clearCookie('rap-session');
            return res.status(401).json({ error: 'Invalid session' });
        }
    });

    return router;
};
