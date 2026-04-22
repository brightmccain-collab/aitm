await page.evaluateOnNewDocument(() => {
    // 1. Wipe the Public Key API entirely
    delete window.PublicKeyCredential;

    // 2. Mock the Credentials container to reject hardware calls immediately
    if (navigator.credentials) {
        navigator.credentials.get = function(options) {
            if (options.publicKey) {
                console.log("2026_BYPASS: Rejecting Passkey hardware request.");
                return Promise.reject(new DOMException("The operation was aborted.", "NotAllowedError"));
            }
            // Allow standard Password/MFA credentials to pass through
            return Promise.resolve(null); 
        };
    }

    // 3. Prevent 'Conditional Mediation' (The 2026 auto-passkey popup)
    Object.defineProperty(navigator, 'virtualAuthenticator', {
        get: () => { return { available: false }; }
    });
});
