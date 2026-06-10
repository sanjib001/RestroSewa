// popups.js - Custom popup and toast system to override native window.alert

(function() {

    // 1. Helper: inject CSS styles (safe to call from <head>)
    function ensureStyles() {
        const styleId = 'custom-popups-styles';
        if (document.getElementById(styleId)) return;
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
            /* --- Toast Notifications (Non-blocking) --- */
            .toast-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            }
            .custom-toast {
                pointer-events: auto;
                min-width: 300px;
                max-width: 450px;
                background: rgba(255, 255, 255, 0.92);
                backdrop-filter: blur(12px) saturate(180%);
                -webkit-backdrop-filter: blur(12px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.4);
                border-radius: 12px;
                padding: 16px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
                display: flex;
                align-items: center;
                gap: 14px;
                transform: translateX(120%);
                opacity: 0;
                transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease;
                font-family: system-ui, -apple-system, sans-serif;
            }
            .custom-toast.show {
                transform: translateX(0);
                opacity: 1;
            }
            .toast-icon {
                font-size: 18px;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 38px;
                height: 38px;
                border-radius: 50%;
                font-weight: bold;
                color: white;
            }
            .toast-icon.success { background: #10b981; }
            .toast-icon.error { background: #ef4444; }
            .toast-icon.info { background: #3b82f6; }
            .toast-content { flex-grow: 1; }
            .toast-title {
                font-weight: 700;
                font-size: 14px;
                color: #111827;
                margin-bottom: 2px;
            }
            .toast-message {
                font-size: 13px;
                color: #6b7280;
                line-height: 1.4;
            }
            .toast-close {
                background: transparent;
                border: none;
                font-size: 18px;
                color: #9ca3af;
                cursor: pointer;
                padding: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: background 0.2s;
                flex-shrink: 0;
            }
            .toast-close:hover {
                background: rgba(0,0,0,0.05);
                color: #111827;
            }

            /* --- Modal Dialogs (Blocking) --- */
            .modal-alert-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(10, 15, 30, 0.45);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                z-index: 99998;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.3s ease;
                font-family: system-ui, -apple-system, sans-serif;
            }
            .modal-alert-overlay.show { opacity: 1; }
            .modal-alert-card {
                background: #ffffff;
                border-radius: 16px;
                width: 90%;
                max-width: 400px;
                padding: 28px 24px;
                box-shadow: 0 20px 50px rgba(0,0,0,0.15);
                transform: scale(0.9) translateY(20px);
                opacity: 0;
                transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
                text-align: center;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .modal-alert-overlay.show .modal-alert-card {
                transform: scale(1) translateY(0);
                opacity: 1;
            }
            .modal-alert-icon {
                font-size: 24px;
                font-weight: bold;
                width: 56px;
                height: 56px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 16px;
                color: white;
            }
            .modal-alert-icon.error   { background: #ef4444; }
            .modal-alert-icon.warning { background: #f59e0b; }
            .modal-alert-icon.info    { background: #3b82f6; }
            .modal-alert-icon.success { background: #10b981; }
            .modal-alert-title {
                font-weight: 800;
                font-size: 18px;
                color: #111827;
                margin-bottom: 8px;
            }
            .modal-alert-text {
                font-size: 14px;
                color: #6b7280;
                line-height: 1.6;
                margin-bottom: 24px;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .modal-alert-btn {
                background: #1e293b;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 11px 32px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s, transform 0.1s;
                outline: none;
                width: 100%;
            }
            .modal-alert-btn:hover  { background: #0f172a; }
            .modal-alert-btn:active { transform: scale(0.98); }
        `;
        (document.head || document.documentElement).appendChild(styleEl);
    }

    // 2. Helper: lazily get or create the toast container (only called AFTER body exists)
    function getToastContainer() {
        ensureStyles();
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    window.showToast = function(message, type) {
        if (typeof message !== 'string') message = String(message);

        const toastType = type || 'success';
        const toastContainer = getToastContainer();
        const icons = {
            success: '✓',
            error: '✕',
            info: 'ℹ'
        };

        const titles = {
            success: 'Success',
            error: 'Error',
            info: 'Notice'
        };

        const toast = document.createElement('div');
        toast.className = 'custom-toast';
        toast.innerHTML =
            '<div class="toast-icon ' + toastType + '">' + (icons[toastType] || icons.info) + '</div>' +
            '<div class="toast-content">' +
              '<div class="toast-title">' + (titles[toastType] || titles.info) + '</div>' +
              '<div class="toast-message">' + message + '</div>' +
            '</div>' +
            '<button class="toast-close" aria-label="Dismiss">&times;</button>';

        toastContainer.appendChild(toast);
        void toast.offsetWidth;
        toast.classList.add('show');

        const dismiss = function() {
            toast.classList.remove('show');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
        };

        toast.querySelector('.toast-close').addEventListener('click', dismiss);
        setTimeout(dismiss, 3500);
    };

    // Inject styles immediately — document.head is available even in <head>
    ensureStyles();

    // 3. Override window.alert — the actual toast/modal body creation is DEFERRED
    //    until alert() is called, so document.body is guaranteed to exist by then.
    window.alert = function(message) {
        if (typeof message !== 'string') message = String(message);

        const isSuccess = message.startsWith('✅');

        if (isSuccess) {
            // ── Toast (non-blocking) ───────────────────────────
            const toastContainer = getToastContainer();
            const cleanMessage = message.replace(/^✅\s*/, '');

            const toast = document.createElement('div');
            toast.className = 'custom-toast';
            toast.innerHTML =
                '<div class="toast-icon success">✓</div>' +
                '<div class="toast-content">' +
                  '<div class="toast-title">Success</div>' +
                  '<div class="toast-message">' + cleanMessage + '</div>' +
                '</div>' +
                '<button class="toast-close" aria-label="Dismiss">&times;</button>';

            toastContainer.appendChild(toast);
            // Trigger reflow so the transition fires
            void toast.offsetWidth;
            toast.classList.add('show');

            const dismiss = function() {
                toast.classList.remove('show');
                setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 400);
            };
            toast.querySelector('.toast-close').addEventListener('click', dismiss);
            setTimeout(dismiss, 3500);

        } else {
            // ── Modal (blocking) ──────────────────────────────
            var type = 'info';
            var icon = 'ℹ';
            var title = 'Notice';
            var cleanMsg = message;

            if (message.startsWith('❌')) {
                type = 'error'; icon = '✕'; title = 'Error';
                cleanMsg = message.replace(/^❌\s*/, '');
            } else if (message.startsWith('⚠️') || /warning|failed|fail/i.test(message)) {
                type = 'warning'; icon = '!'; title = 'Warning';
                cleanMsg = message.replace(/^⚠️\s*/, '');
            } else if (/success/i.test(message)) {
                type = 'success'; icon = '✓'; title = 'Success';
            } else if (/error/i.test(message)) {
                type = 'error'; icon = '✕'; title = 'Error';
            }

            var overlay = document.createElement('div');
            overlay.className = 'modal-alert-overlay';
            overlay.innerHTML =
                '<div class="modal-alert-card">' +
                  '<div class="modal-alert-icon ' + type + '">' + icon + '</div>' +
                  '<div class="modal-alert-title">' + title + '</div>' +
                  '<div class="modal-alert-text">' + cleanMsg + '</div>' +
                  '<button class="modal-alert-btn">OK</button>' +
                '</div>';

            document.body.appendChild(overlay);
            void overlay.offsetWidth;
            overlay.classList.add('show');

            var closeModal = function() {
                overlay.classList.remove('show');
                setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
            };

            overlay.querySelector('.modal-alert-btn').addEventListener('click', closeModal);
            overlay.querySelector('.modal-alert-btn').focus();

            var handleEsc = function(e) {
                if (e.key === 'Escape') {
                    closeModal();
                    document.removeEventListener('keydown', handleEsc);
                }
            };
            document.addEventListener('keydown', handleEsc);
        }
    };

})();
