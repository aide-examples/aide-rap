/**
 * Login Dialog Component
 * Simple authentication dialog with role selection and password input
 * Passwords are hashed client-side with SHA-256 before transmission
 */

/**
 * Pure JS SHA-256 implementation for non-secure contexts (HTTP)
 * Web Crypto API requires HTTPS, this fallback works over plain HTTP
 */
function sha256Fallback(message) {
    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);

    const H = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);

    const bytes = new TextEncoder().encode(message);
    const len = bytes.length;

    // Padding: message + 0x80 + zeros + 64-bit length
    const padLen = 64 - ((len + 9) % 64);
    const totalLen = len + 1 + padLen + 8;
    const M = new Uint8Array(totalLen);
    M.set(bytes);
    M[len] = 0x80;

    // Length in bits (big-endian, 64-bit) - only lower 32 bits needed for reasonable message sizes
    const view = new DataView(M.buffer);
    view.setUint32(totalLen - 4, len * 8, false);

    const W = new Uint32Array(64);

    for (let i = 0; i < totalLen; i += 64) {
        // Break chunk into 16 32-bit big-endian words
        for (let t = 0; t < 16; t++) {
            W[t] = view.getUint32(i + t * 4, false);
        }

        // Extend to 64 words
        for (let t = 16; t < 64; t++) {
            const s0 = ((W[t-15] >>> 7) | (W[t-15] << 25)) ^ ((W[t-15] >>> 18) | (W[t-15] << 14)) ^ (W[t-15] >>> 3);
            const s1 = ((W[t-2] >>> 17) | (W[t-2] << 15)) ^ ((W[t-2] >>> 19) | (W[t-2] << 13)) ^ (W[t-2] >>> 10);
            W[t] = (W[t-16] + s0 + W[t-7] + s1) >>> 0;
        }

        let [a, b, c, d, e, f, g, h] = H;

        for (let t = 0; t < 64; t++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }

        H[0] = (H[0] + a) >>> 0;
        H[1] = (H[1] + b) >>> 0;
        H[2] = (H[2] + c) >>> 0;
        H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0;
        H[5] = (H[5] + f) >>> 0;
        H[6] = (H[6] + g) >>> 0;
        H[7] = (H[7] + h) >>> 0;
    }

    return Array.from(H).map(h => h.toString(16).padStart(8, '0')).join('');
}

/**
 * Compute SHA-256 hash of a string
 * Uses Web Crypto API when available (HTTPS/localhost), falls back to JS implementation for HTTP
 * @param {string} text - The text to hash
 * @returns {Promise<string>} - Hex-encoded hash
 */
async function sha256(text) {
    // Web Crypto API is only available in secure contexts (HTTPS or localhost)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback for non-secure contexts (HTTP over network)
    return sha256Fallback(text);
}

// Export sha256 for use in URL-login (rap.js)
window.sha256 = sha256;

const LoginDialog = {
    modalElement: null,
    authConfig: null,
    selectedRole: 'guest',

    /**
     * Initialize and show the login dialog
     */
    async show() {
        // Load auth config from server
        try {
            const res = await fetch('api/auth/config');
            this.authConfig = await res.json();

            // If auth is not configured at all, show error and block access
            if (this.authConfig.notConfigured) {
                this.renderError(this.authConfig.message || 'Authentication not configured');
                return false; // Block access
            }

            // If auth is explicitly disabled, allow access without login
            if (!this.authConfig.enabled) {
                return true;
            }
        } catch (e) {
            console.error('Failed to load auth config:', e);
            this.renderError('Failed to load authentication configuration');
            return false; // Block access on error
        }

        this.selectedRole = 'guest';
        this.render();
        return false; // Login dialog shown, app should wait
    },

    /**
     * Hide the dialog
     */
    hide() {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
    },

    /**
     * Render an error message (e.g., when auth is not configured)
     */
    renderError(message) {
        // Remove existing modal if any
        if (this.modalElement) {
            this.modalElement.remove();
        }

        this.modalElement = document.createElement('div');
        this.modalElement.className = 'modal-container active';
        this.modalElement.innerHTML = `
            <div class="modal-overlay login-overlay">
                <div class="modal-dialog login-dialog">
                    <div class="modal-header">
                        <h2>Access Denied</h2>
                    </div>
                    <div class="modal-body">
                        <div class="login-error" style="display: block; margin: 0;">
                            ${message}
                        </div>
                        <p style="margin-top: 1rem; color: var(--color-text-muted); font-size: 0.9em;">
                            Please contact your system administrator.
                        </p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.modalElement);

        // Prevent closing by clicking overlay
        this.modalElement.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                const dialog = this.modalElement.querySelector('.login-dialog');
                dialog.classList.add('shake');
                setTimeout(() => dialog.classList.remove('shake'), 300);
            }
        });
    },

    /**
     * Check if role requires password
     */
    roleNeedsPassword(role) {
        if (!this.authConfig || !this.authConfig.roles) return true;
        return this.authConfig.roles[role] === true;
    },

    /**
     * Render the dialog
     */
    render() {
        // Remove existing modal if any
        if (this.modalElement) {
            this.modalElement.remove();
        }

        const needsPassword = this.roleNeedsPassword(this.selectedRole);

        // Create modal element
        this.modalElement = document.createElement('div');
        this.modalElement.className = 'modal-container active';
        this.modalElement.innerHTML = `
            <div class="modal-overlay login-overlay">
                <div class="modal-dialog login-dialog">
                    <div class="modal-header">
                        <h2>Login</h2>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="login-role">Role</label>
                            <select id="login-role" class="form-control">
                                <option value="guest" ${this.selectedRole === 'guest' ? 'selected' : ''}>Guest</option>
                                <option value="user" ${this.selectedRole === 'user' ? 'selected' : ''}>User</option>
                                <option value="admin" ${this.selectedRole === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                        </div>
                        <div class="form-group" id="password-group" style="${needsPassword ? '' : 'display: none;'}">
                            <label for="login-password">Password</label>
                            <input type="password" id="login-password" class="form-control"
                                   placeholder="${needsPassword ? 'Enter password' : 'No password required'}"
                                   ${needsPassword ? '' : 'disabled'}>
                        </div>
                        <div id="login-error" class="login-error" style="display: none;"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-primary" id="login-btn">Login</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.modalElement);
        this.bindEvents();

        // Focus appropriate field
        if (needsPassword) {
            document.getElementById('login-password').focus();
        } else {
            document.getElementById('login-btn').focus();
        }
    },

    /**
     * Bind event handlers
     */
    bindEvents() {
        const roleSelect = document.getElementById('login-role');
        const passwordInput = document.getElementById('login-password');
        const passwordGroup = document.getElementById('password-group');
        const loginBtn = document.getElementById('login-btn');
        const errorDiv = document.getElementById('login-error');

        // Role change - show/hide password field
        roleSelect.addEventListener('change', () => {
            this.selectedRole = roleSelect.value;
            const needsPassword = this.roleNeedsPassword(this.selectedRole);

            passwordGroup.style.display = needsPassword ? '' : 'none';
            passwordInput.disabled = !needsPassword;
            passwordInput.placeholder = needsPassword ? 'Enter password' : 'No password required';
            passwordInput.value = '';
            errorDiv.style.display = 'none';

            if (needsPassword) {
                passwordInput.focus();
            }
        });

        // Login button click
        loginBtn.addEventListener('click', () => this.doLogin());

        // Enter key in password field
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.doLogin();
            }
        });

        // Prevent closing by clicking overlay (login is required)
        this.modalElement.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                // Shake the dialog to indicate it can't be closed
                const dialog = this.modalElement.querySelector('.login-dialog');
                dialog.classList.add('shake');
                setTimeout(() => dialog.classList.remove('shake'), 300);
            }
        });
    },

    /**
     * Perform login
     * Password is hashed with SHA-256 before transmission
     */
    async doLogin() {
        const role = document.getElementById('login-role').value;
        const password = document.getElementById('login-password').value;
        const loginBtn = document.getElementById('login-btn');
        const errorDiv = document.getElementById('login-error');

        // Disable button during request
        loginBtn.disabled = true;
        loginBtn.textContent = 'Logging in...';
        errorDiv.style.display = 'none';

        try {
            // Hash password client-side before sending
            const hash = password ? await sha256(password) : '';

            const res = await fetch('api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, hash })
            });

            if (res.ok) {
                const data = await res.json();
                this.hide();
                // Store role for UI adjustments
                window.currentUser = { role: data.role };
                // Reload page to reinitialize with authenticated session
                window.location.reload();
            } else {
                const error = await res.json();
                errorDiv.textContent = error.error || 'Login failed';
                errorDiv.style.display = 'block';
                loginBtn.disabled = false;
                loginBtn.textContent = 'Login';
            }
        } catch (e) {
            console.error('Login error:', e);
            errorDiv.textContent = 'Connection error';
            errorDiv.style.display = 'block';
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login';
        }
    },

    /**
     * Check if user is authenticated
     * @returns {Promise<{authenticated: boolean, role?: string}>}
     */
    async checkAuth() {
        try {
            const res = await fetch('api/auth/me');
            if (res.ok) {
                const data = await res.json();
                window.currentUser = { role: data.role };
                return { authenticated: true, role: data.role };
            }
            return { authenticated: false };
        } catch (e) {
            return { authenticated: false };
        }
    },

    /**
     * Logout the current user
     */
    async logout() {
        try {
            await fetch('api/auth/logout', { method: 'POST' });
        } catch (e) {
            console.error('Logout error:', e);
        }
        window.currentUser = null;
        window.location.reload();
    }
};

// Export for use in other modules
window.LoginDialog = LoginDialog;
