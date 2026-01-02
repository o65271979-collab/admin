// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCzQjVixn8D_3T9v1hfLqy7Q0dKn3B0nyw",
    authDomain: "system-ef973.firebaseapp.com",
    projectId: "system-ef973",
    storageBucket: "system-ef973.firebasestorage.app",
    messagingSenderId: "947634219183",
    appId: "1:947634219183:web:2974735cfadd5411654c5a",
    measurementId: "G-D22ERXVGG7"
};

// Initialize Firebase with error handling
try {
    firebase.initializeApp(firebaseConfig);
} catch (error) {
    // Silent fail
}

// Initialize Firebase services with proper settings
let db, auth;

try {
    // Set Firestore settings BEFORE initializing
    if (!firebase.apps.length || !firebase.app().firestore) {
        db = firebase.firestore();

        // Apply settings only if Firestore hasn't been started yet
        db.settings({
            timestampsInSnapshots: true,
            experimentalForceLongPolling: false,
            merge: true
        });

    } else {
        db = firebase.firestore();
    }

    auth = firebase.auth();

    // Enable offline persistence
    db.enablePersistence({ synchronizeTabs: true })
        .then(() => {
            // Success
        })
        .catch((err) => {
            // Silent fail
        });

} catch (error) {
    // Fallback initialization
    db = firebase.firestore();
    auth = firebase.auth();
}

// Make Firebase services globally available
window.db = db;
window.auth = auth;
window.firebase = firebase;

// Connection state monitoring
let isOnline = navigator.onLine;
let connectionRetries = 0;
const maxRetries = 3;

// Monitor network status
window.addEventListener('online', () => {
    isOnline = true;
    connectionRetries = 0;
    showConnectionStatus('متصل', 'success');
});

window.addEventListener('offline', () => {
    isOnline = false;
    showConnectionStatus('غير متصل - العمل في الوضع المحلي', 'warning');
});

// Show connection status
function showConnectionStatus(message, type) {
    const statusDiv = document.getElementById('connectionStatus');
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = `connection-status ${type}`;
        statusDiv.style.display = 'block';

        if (type === 'success') {
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 3000);
        }
    }
}

// Auth state observer with connection handling
auth.onAuthStateChanged((user) => {
    if (user) {
        updateUIForAuthenticatedUser(user);
    } else {
        updateUIForUnauthenticatedUser();
    }
});

// Update UI based on authentication state
function updateUIForAuthenticatedUser(user) {
    const loginBtn = document.querySelector('.btn-login');
    if (loginBtn) {
        loginBtn.textContent = 'حسابي';
        loginBtn.href = 'account.html';
    }
}

function updateUIForUnauthenticatedUser() {
    const loginBtn = document.querySelector('.btn-login');
    if (loginBtn) {
        loginBtn.textContent = 'تسجيل الدخول';
        loginBtn.href = 'login.html';
    }
}

// Initialize Secondary Firebase App for Admin User Management
// This prevents the current admin from being signed out when creating new users
let secondaryApp;
try {
    secondaryApp = firebase.initializeApp(firebaseConfig, 'SecondaryApp');
} catch (error) {
    // Silent fail
}

// Function to set user as admin (for development/setup)
async function setUserAsAdmin(userId) {
    try {
        const userRef = db.collection('users').doc(userId);
        await userRef.update({
            role: 'super_admin',
            isAdmin: true,
            adminLevel: 'super',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (error) {
        return false;
    }
}

// Setup check completed
// (Auto-setup for default admin removed to allow manual deletion)

// Utility functions for Firebase operations
const FirebaseUtils = {
    // Add document to collection
    async addDocument(collection, data) {
        try {
            const docRef = await db.collection(collection).add({
                ...data,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return { success: true, id: docRef.id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Get documents with query and connection handling
    async getDocuments(collection, orderBy = null, limit = null) {
        try {
            let query = db.collection(collection);

            if (orderBy) {
                query = query.orderBy(orderBy.field, orderBy.direction || 'asc');
            }

            if (limit) {
                query = query.limit(limit);
            }

            // Try to get from cache first if offline
            const options = !isOnline ? { source: 'cache' } : { source: 'default' };
            const snapshot = await query.get(options);
            const documents = [];

            snapshot.forEach(doc => {
                documents.push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            // Show cache indicator if data is from cache
            if (snapshot.metadata.fromCache && !isOnline) {
                showConnectionStatus('البيانات من التخزين المحلي', 'info');
            }

            return { success: true, data: documents, fromCache: snapshot.metadata.fromCache };
        } catch (error) {
            // Try cache if server request failed
            if (error.code === 'unavailable' && isOnline) {
                try {
                    const cacheSnapshot = await db.collection(collection).get({ source: 'cache' });
                    const cacheDocuments = [];

                    cacheSnapshot.forEach(doc => {
                        cacheDocuments.push({
                            id: doc.id,
                            ...doc.data()
                        });
                    });

                    showConnectionStatus('البيانات من التخزين المحلي', 'warning');

                    return { success: true, data: cacheDocuments, fromCache: true };
                } catch (cacheError) {
                    // Silently fail
                }
            }

            return { success: false, error: error.message, code: error.code };
        }
    },

    // Update document
    async updateDocument(collection, docId, data) {
        try {
            await db.collection(collection).doc(docId).update({
                ...data,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Set document (creates if doesn't exist, updates if exists)
    async setDocument(collection, docId, data, merge = true) {
        try {
            await db.collection(collection).doc(docId).set({
                ...data,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: merge });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Delete document
    async deleteDocument(collection, docId) {
        try {
            await db.collection(collection).doc(docId).delete();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Get document by ID
    async getDocument(collection, docId) {
        try {
            const doc = await db.collection(collection).doc(docId).get();
            if (doc.exists) {
                return {
                    success: true,
                    data: { id: doc.id, ...doc.data() }
                };
            } else {
                return { success: false, error: 'Document not found' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Listen to collection changes
    listenToCollection(collection, callback, orderBy = null) {
        let query = db.collection(collection);

        if (orderBy) {
            query = query.orderBy(orderBy.field, orderBy.direction || 'desc');
        }

        return query.onSnapshot(callback);
    },

    // User authentication
    async signInWithEmail(email, password) {
        try {
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // Check if user is blocked
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                if (userDoc.data().isBlocked) {
                    await auth.signOut();
                    return { success: false, error: 'blocked_account' };
                }
            } else {
                // Auto-create profile for users who exist in Auth but not in Firestore (e.g. created via Console)
                try {
                    await db.collection('users').doc(user.uid).set({
                        uid: user.uid,
                        email: email,
                        name: user.displayName || email.split('@')[0],
                        role: 'customer', // Default role
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        isBlocked: false,
                        authSource: 'auto_sync' // Flag to identify these auto-created accounts
                    });
                } catch (createError) {
                    // Silently fail
                }
            }

            return { success: true, user: user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    async signUpWithEmail(email, password, userData) {
        try {
            // Check if secondary app is available
            if (!secondaryApp) {
                try {
                    secondaryApp = firebase.initializeApp(firebaseConfig, 'SecondaryApp');
                } catch (e) {
                    throw new Error('فشل تهيئة نظام إنشاء الحسابات. يرجى التحقق من إضافات المتصفح.');
                }
            }

            // Use secondary app auth to create user without signing out current admin
            const secondaryAuth = secondaryApp.auth();
            const userCredential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
            const newUser = userCredential.user;

            // Try to add user data to Firestore
            // We try using the secondaryApp's firestore instance first, 
            // as the rules might allow a user to create their own record.
            const secondaryDb = secondaryApp.firestore();

            try {
                await secondaryDb.collection('users').doc(newUser.uid).set({
                    ...userData,
                    uid: newUser.uid,
                    email: email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (firestoreError) {
                // If secondary fails (e.g. rules prevent setting 'admin' role by user),
                // fall back to main db (admin)
                if (firestoreError.code === 'permission-denied') {
                    await db.collection('users').doc(newUser.uid).set({
                        ...userData,
                        uid: newUser.uid,
                        email: email,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                } else {
                    throw firestoreError;
                }
            }

            // Sign out from secondary app immediately
            await secondaryAuth.signOut();

            return { success: true, user: newUser };
        } catch (error) {
            let errorMessage = error.message;
            if (error.code === 'auth/email-already-in-use') errorMessage = 'هذا البريد الإلكتروني مسجل مسبقاً';
            if (error.code === 'auth/weak-password') errorMessage = 'كلمة المرور ضعيفة جداً';
            if (error.code === 'auth/invalid-email') errorMessage = 'صيغة البريد الإلكتروني غير صحيحة';
            if (error.code === 'permission-denied' || error.message.includes('permission')) {
                errorMessage = 'ليس لديك صلاحية كافية في Firebase لإنشاء حسابات. يرجى مراجعة قواعد البيانات.';
            }

            return { success: false, error: errorMessage };
        }
    },

    async signOut() {
        try {
            await auth.signOut();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Get current user
    getCurrentUser() {
        return auth.currentUser;
    },

    // Check if user is admin
    async isAdmin(userId) {
        try {
            // Check by userId as document ID
            const userDocById = await db.collection('users').doc(userId).get();
            if (userDocById.exists) {
                const userData = userDocById.data();
                // User must be admin/super_admin AND NOT blocked
                return (userData.role === 'admin' || userData.role === 'super_admin') && !userData.isBlocked;
            }

            return false;
        } catch (error) {
            return false;
        }
    }
};
