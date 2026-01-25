/**
 * Login Dialog Component
 * Simple authentication dialog with role selection and password input
 */
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
            const res = await fetch('/api/auth/config');
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
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, password })
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
            const res = await fetch('/api/auth/me');
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
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {
            console.error('Logout error:', e);
        }
        window.currentUser = null;
        window.location.reload();
    }
};

// Export for use in other modules
window.LoginDialog = LoginDialog;
