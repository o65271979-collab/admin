// Firebase Initialization Helper
// هذا الملف يضمن تهيئة Firebase بشكل صحيح في جميع الصفحات

(function () {
    'use strict';

    // Wait for Firebase to be loaded
    function waitForFirebase(callback, maxAttempts = 50) {
        let attempts = 0;

        function check() {
            attempts++;

            if (typeof firebase !== 'undefined' &&
                typeof window.auth !== 'undefined' &&
                typeof window.db !== 'undefined') {
                callback();
            } else if (attempts < maxAttempts) {
                setTimeout(check, 100);
            } else {
                // Try to initialize manually as fallback
                initializeFirebaseFallback();
                callback();
            }
        }

        check();
    }

    // Fallback initialization
    function initializeFirebaseFallback() {
        try {
            if (typeof firebase !== 'undefined') {
                if (!window.db && firebase.firestore) {
                    window.db = firebase.firestore();
                }
                if (!window.auth && firebase.auth) {
                    window.auth = firebase.auth();
                }
            }
        } catch (error) {
            // Silently fail
        }
    }

    // Global Firebase ready event
    window.firebaseReady = function (callback) {
        if (typeof callback !== 'function') {
            return;
        }

        waitForFirebase(callback);
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            waitForFirebase(function () {
                // Firebase is ready
                document.dispatchEvent(new CustomEvent('firebaseReady'));
            });
        });
    } else {
        waitForFirebase(function () {
            // Firebase is ready
            document.dispatchEvent(new CustomEvent('firebaseReady'));
        });
    }

    // Global error handler for Firebase
    window.addEventListener('error', function (event) {
        if (event.error && event.error.message &&
            (event.error.message.includes('auth is not defined') ||
                event.error.message.includes('db is not defined'))) {
            initializeFirebaseFallback();
        }
    });

})();

// Helper functions for common Firebase operations
window.FirebaseHelpers = {
    // Safe auth check
    isAuthenticated: function () {
        return window.auth && window.auth.currentUser;
    },

    // Safe database operation
    safeDbOperation: async function (operation) {
        if (!window.db) {
            throw new Error('قاعدة البيانات غير متاحة');
        }
        return await operation(window.db);
    },

    // Safe auth operation
    safeAuthOperation: async function (operation) {
        if (!window.auth) {
            throw new Error('نظام المصادقة غير متاح');
        }
        return await operation(window.auth);
    },

    // Wait for auth state
    waitForAuth: function (callback) {
        const authCallback = (user) => {
            if (user) {
                // Real-time listener for blocking status
                const userRef = window.db.collection('users').doc(user.uid);
                const unsubscribe = userRef.onSnapshot((doc) => {
                    const userData = doc.data();
                    if (userData && userData.isBlocked) {
                        unsubscribe(); // Stop listening
                        window.auth.signOut().then(() => {
                            // Clear any sensitive local storage if needed
                            localStorage.clear();
                            // Redirect with message
                            const currentPath = window.location.pathname;
                            const isLoginPage = currentPath.includes('login') || currentPath.includes('auth');
                            if (!isLoginPage) {
                                window.location.href = (currentPath.includes('admin') ? 'index.html' : '/login.html') + '?error=blocked_account';
                            }
                        });
                    }
                }, (error) => {
                    // Silently fail
                });
            }
            callback(user);
        };

        if (window.auth) {
            window.auth.onAuthStateChanged(authCallback);
        } else {
            window.firebaseReady(function () {
                window.auth.onAuthStateChanged(authCallback);
            });
        }
    }
};
