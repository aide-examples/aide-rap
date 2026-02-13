/**
 * Authentication Middleware
 * Handles session validation and role-based access control
 */

/**
 * Parse and validate session from signed cookie
 * Sets req.user = { role: 'admin'|'user'|'guest' } if valid
 */
function authMiddleware(req, res, next) {
    // If already authenticated (e.g. via API key), skip session check
    if (req.user) return next();

    const session = req.signedCookies?.['rap-session'];

    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        // Session is already parsed from signed cookie
        const sessionData = typeof session === 'string' ? JSON.parse(session) : session;

        // Check expiry
        if (sessionData.expires && Date.now() > sessionData.expires) {
            res.clearCookie('rap-session');
            return res.status(401).json({ error: 'Session expired' });
        }

        req.user = { role: sessionData.role };
        next();
    } catch (e) {
        res.clearCookie('rap-session');
        return res.status(401).json({ error: 'Invalid session' });
    }
}

/**
 * Optional auth middleware - sets req.user if session exists, but doesn't require it
 * Used for routes that work differently based on auth state
 */
function optionalAuth(req, res, next) {
    const session = req.signedCookies?.['rap-session'];

    if (session) {
        try {
            const sessionData = typeof session === 'string' ? JSON.parse(session) : session;
            if (!sessionData.expires || Date.now() <= sessionData.expires) {
                req.user = { role: sessionData.role };
            }
        } catch (e) {
            // Invalid session, just continue without user
        }
    }

    next();
}

/**
 * Role-based access control middleware factory
 * @param {...string} roles - Allowed roles
 * @returns {Function} Express middleware
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        next();
    };
}

module.exports = {
    authMiddleware,
    optionalAuth,
    requireRole
};
