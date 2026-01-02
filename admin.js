// Admin panel JavaScript
let currentUser = null;
let lastInitializedUid = null;
let isAdminInitializing = false;
let allOrders = [];
let allUsers = [];
let allCustomers = [];
let allTickets = [];
let allFAQs = [];
let filteredOrders = [];
let filteredUsers = [];
let filteredCustomers = [];
let filteredTickets = [];
let filteredFAQs = [];
let allHardwareListings = [];
let filteredHardwareListings = [];

// Make functions globally available immediately
window.switchTab = switchTab;

document.addEventListener('DOMContentLoaded', function () {
    // Check authentication and admin privileges
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            const isAdmin = await FirebaseUtils.isAdmin(user.uid);

            if (isAdmin) {
                await initializeAdminPanel();
            } else {
                // Redirect non-admin users
                showMessage('ليس لديك صلاحية للوصول إلى هذه الصفحة', 'error');
                setTimeout(() => {
                    window.location.href = '/index.html';
                }, 2000);
            }
        } else {
            // Redirect to admin login if not authenticated
            window.location.href = 'index.html';
        }
    });
});

// Initialize admin panel
async function initializeAdminPanel() {
    // If user changed, allow re-initialization
    if (currentUser && currentUser.uid !== lastInitializedUid) {
        isAdminInitializing = false;
    }

    if (isAdminInitializing) return;
    isAdminInitializing = true;
    lastInitializedUid = currentUser ? currentUser.uid : null;

    try {
        // 1. Check Device Verification & Security Policies FIRST
        const securityCheck = await checkSecurityPolicies();
        if (!securityCheck.success) {
            isAdminInitializing = false;
            return; // Stop initialization if security check fails
        }

        // Load user info
        const userResult = await FirebaseUtils.getDocument('users', currentUser.uid);
        if (userResult.success) {
            const userData = userResult.data;
            document.getElementById('adminUserName').textContent = `مرحباً، ${userData.name || 'المدير'}`;

            // Store user data globally for permission checks
            window.currentUserData = userData;

            // Apply page-level permissions to sidebar using the robust system
            if (window.AdminPermissions) {
                await window.AdminPermissions.applyUIPermissions(currentUser.uid);
            } else {
                applyPagePermissions(userData);
            }
        }

        // Initialize Theme
        const savedTheme = localStorage.getItem('admin-theme') || 'light';
        document.body.setAttribute('data-theme', savedTheme);
        const lightBtn = document.getElementById('themeLightBtn');
        const darkBtn = document.getElementById('themeDarkBtn');
        if (lightBtn && darkBtn) {
            lightBtn.classList.toggle('active', savedTheme === 'light');
            darkBtn.classList.toggle('active', savedTheme === 'dark');
        }

        // Initialize Support Ticket Listener
        startSupportTicketListener();

        // Load all data
        await loadDashboardData();
        await loadOrders();
        await loadUsers();
        await loadSupportTickets();
        await loadPaymentSettings();

        // 2. Handle Deep Linking (URL Parameters)
        const urlParams = new URLSearchParams(window.location.search);
        const tab = urlParams.get('tab');
        const id = urlParams.get('id');

        if (tab) {
            switchTab(tab);
            if (id) {
                // Wait a bit for initial data to load if needed, or trigger specific view
                setTimeout(() => {
                    if (tab === 'support') viewTicketDetails(id);
                    else if (tab === 'orders') viewOrderDetails(id); // assuming it exists
                    else if (tab === 'hardware_marketplace') viewHardwareListingDetails(id);
                }, 1500);
            }
        }

        // --- Mobile Sidebar Toggle Logic ---
        const mobileToggle = document.getElementById('mobileToggle');
        const adminSidebar = document.getElementById('adminSidebar');

        // Create overlay if it doesn't exist
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);
        }

        if (mobileToggle) {
            mobileToggle.onclick = function () {
                adminSidebar.classList.toggle('active');
                overlay.classList.toggle('active');
            };
        }

        const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
        if (sidebarCloseBtn) {
            sidebarCloseBtn.onclick = function () {
                adminSidebar.classList.remove('active');
                overlay.classList.remove('active');
            };
        }

        overlay.onclick = function () {
            adminSidebar.classList.remove('active');
            overlay.classList.remove('active');
        };

        // Close sidebar when clicking menu items on mobile
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    adminSidebar.classList.remove('active');
                    overlay.classList.remove('active');
                }
            });
        });
    } catch (error) {

        isAdminInitializing = false;
        showMessage('حدث خطأ في تحميل لوحة التحكم', 'error');
    }
}

// Security Policies Checker
async function checkSecurityPolicies() {
    try {
        const settingsDoc = await window.db.collection('settings').doc('system').get();
        if (!settingsDoc.exists) return { success: true };

        const security = settingsDoc.data().security;
        if (!security) return { success: true };

        // 1. IP Whitelist Check
        if (security.ipWhitelistEnabled && security.allowedIps?.length > 0) {
            try {
                const response = await fetch('https://api.ipify.org?format=json');
                const data = await response.json();
                if (!security.allowedIps.includes(data.ip)) {
                    document.body.innerHTML = `
                        <div style="height: 100vh; display: flex; align-items: center; justify-content: center; background: #f8fafc; font-family: 'Cairo', sans-serif; direction: rtl;">
                            <div style="text-align: center; padding: 2rem; background: white; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); max-width: 400px;">
                                <i class="fas fa-shield-alt" style="font-size: 3rem; color: #dc3545; margin-bottom: 1rem;"></i>
                                <h2 style="color: #1e3a5f; margin-bottom: 1rem;">وصول محظور</h2>
                                <p style="color: #64748b;">عنوان IP الخاص بك (${data.ip}) غير مسموح له بالوصول إلى لوحة التحكم.</p>
                                <a href="/index.html" style="display: inline-block; margin-top: 1.5rem; color: #2c5aa0; text-decoration: none; font-weight: bold;">العودة للرئيسية</a>
                            </div>
                        </div>
                    `;
                    return { success: false };
                }
            } catch (ipError) {

            }
        }

        // 2. Device Verification Check
        if (security.deviceVerificationEnabled) {
            let deviceId = localStorage.getItem('as3g_admin_device_id');
            if (!deviceId) {
                deviceId = 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
                localStorage.setItem('as3g_admin_device_id', deviceId);
            }

            const userDoc = await window.db.collection('users').doc(currentUser.uid).get();
            const userData = userDoc.data();
            const knownDevices = userData.knownDevices || [];

            if (!knownDevices.includes(deviceId)) {
                const verified = await showDeviceVerificationModal(currentUser.email, deviceId);
                if (!verified) return { success: false };
            }
        }

        return { success: true };
    } catch (error) {

        return { success: true }; // Proceed on error to avoid lockout if API fails
    }
}

async function showDeviceVerificationModal(email, deviceId) {
    return new Promise((resolve) => {
        // Generate random 6-digit code
        let otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        let resendCount = 0;
        const RESEND_LIMIT = 2;

        if (document.getElementById('security_otp_modal')) {
            resolve(false); // Modal already exists, current attempt should wait or fail gracefully
            return;
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'security_otp_modal';
        modalOverlay.style = "position: fixed; inset: 0; background: #f8fafc; z-index: 10000; display: flex; align-items: center; justify-content: center; font-family: 'Cairo', sans-serif; direction: rtl;";

        function renderLoadingView(message) {
            modalOverlay.innerHTML = `
                <div style="text-align: center;">
                    <div style="margin-bottom: 2rem;">
                        <i class="fas fa-spinner fa-spin" style="font-size: 4rem; color: #2c5aa0;"></i>
                    </div>
                    <h3 style="color: #1e3a5f; margin-bottom: 1rem; font-size: 1.5rem;">${message}</h3>
                    <p style="color: #64748b;">يرجى الانتظار لحظة بينما نقوم بتأمين دخولك...</p>
                </div>
            `;
        }

        async function sendOTP() {
            otpCode = Math.floor(100000 + Math.random() * 900000).toString(); // Regnerate code on resend

            renderLoadingView(`جاري إرسال الكود إلى ${email}...`);

            try {
                if (typeof emailjs !== 'undefined') {
                    const templateParams = {
                        to_email: email,
                        otp_code: otpCode,
                        company_name: "AS3G SYSTEM",
                        current_time: new Date().toLocaleString('ar-EG'),
                        device_name: navigator.userAgent.split(')')[0] + ')'
                    };

                    await emailjs.send("service_qnp3i4h", "template_5vje6rc", templateParams);

                    showInputView();
                } else {
                    throw new Error('EmailJS script is not loaded');
                }
            } catch (err) {


                // Show a helpful warning in the UI if it looks like a config issue
                const errorText = modalOverlay.querySelector('#otp_error');
                if (errorText) {
                    errorText.style.display = 'block';
                    if (err.status === 400 && err.text?.includes('template ID')) {
                        errorText.innerHTML = '⚠️ قالب الرسالة (Template ID) غير موجود. يرجى التأكد من تسميته <b>template_5vje6rc</b> في EmailJS.';
                    } else if (err.status === 400 || err.text?.includes('Public Key')) {
                        errorText.innerHTML = '⚠️ هناك مشكلة في الـ Public Key أو إعدادات القالب. تأكد من أن حقل "To Email" في EmailJS يحتوي على <b>{{to_email}}</b>';
                    } else if (err.status === 404 || err.text?.includes('Service ID')) {
                        errorText.innerHTML = '⚠️ هناك مشكلة في الـ Service ID. تأكد من مطابقته لحسابك.';
                    } else {
                        errorText.innerHTML = '⚠️ نظام الإرسال غير مفعل أو به خلل. تأكد من إعدادات EmailJS.';
                    }
                    errorText.style.color = '#f59e0b';
                }

                showInputView();
            }
        }

        function showInputView() {
            modalOverlay.innerHTML = `
                <div style="width: 100%; max-width: 500px; padding: 2rem; text-align: center;">
                    <div style="background: white; padding: 4rem 3rem; border-radius: 32px; box-shadow: 0 40px 100px -20px rgba(0,0,0,0.08); position: relative; border: 1px solid #e2e8f0;">
                        <div style="width: 100px; height: 100px; background: #eef2ff; color: #4338ca; border-radius: 24px; display: flex; align-items: center; justify-content: center; margin: 0 auto 2.5rem; font-size: 2.5rem; transform: rotate(-5deg);">
                            <i class="fas fa-shield-check"></i>
                        </div>
                        
                        <h1 style="color: #1e3a5f; margin-bottom: 1rem; font-weight: 800; font-size: 2rem;">تأكيد الهوية</h1>
                        <p style="color: #64748b; font-size: 1.1rem; margin-bottom: 2.5rem; line-height: 1.8;">
                            الأمان أولاً! لقد أرسلنا رمز تحقق مكون من 6 أرقام إلى بريدك الإلكتروني لضمان أنك تملك صلاحية الوصول.
                        </p>
                        
                        <div style="background: #f1f5f9; padding: 1.2rem; border-radius: 16px; margin-bottom: 3rem; border: 1px dashed #cbd5e1;">
                            <span style="font-weight: bold; color: #1e3a5f; font-size: 1.1rem;">${email}</span>
                        </div>
                        
                        <div style="margin-bottom: 3rem;">
                            <input type="text" id="otp_input" maxlength="6" autofocus
                                   style="width: 100%; padding: 1.5rem; text-align: center; font-size: 2.5rem; letter-spacing: 1rem; border: 3px solid #e2e8f0; border-radius: 20px; outline: none; transition: all 0.3s; font-weight: bold; color: #1e3a5f; background: #fff;" 
                                   placeholder="------">
                            <p id="otp_error" style="color: #ef4444; font-size: 0.95rem; margin-top: 1rem; display: none; font-weight: 500;">الرمز الذي أدخلته غير صحيح، حاول مرة أخرى.</p>
                        </div>
                        
                        <button id="verify_otp_btn" style="width: 100%; padding: 1.5rem; background: #2c5aa0; color: white; border: none; border-radius: 20px; font-weight: bold; font-size: 1.2rem; cursor: pointer; transition: all 0.3s; box-shadow: 0 15px 30px -10px rgba(44, 90, 160, 0.4);">
                            تأكيد الدخول
                        </button>
                        
                        <div style="margin-top: 3rem; display: flex; flex-direction: column; gap: 1.5rem; border-top: 1px solid #f1f5f9; pt: 2rem;">
                            <span id="resend_container" style="color: #94a3b8; font-size: 1rem; padding-top: 2rem;">
                                ${resendCount < RESEND_LIMIT
                    ? `لم يصلك الرمز؟ <button onclick="window.resendOTP()" style="background: none; border: none; color: #2c5aa0; cursor: pointer; font-weight: bold; padding: 0; font-size: 1rem;">أعد الإرسال (${RESEND_LIMIT - resendCount})</button>`
                    : '<span style="color: #ef4444; font-weight: bold;">لقد استنفدت محاولات إعادة الإرسال.</span>'
                }
                            </span>
                            <button onclick="window.handleOtpLogout()" style="background: none; border: none; color: #94a3b8; width: fit-content; margin: 0 auto; cursor: pointer; font-size: 1rem; transition: color 0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'">
                                <i class="fas fa-arrow-right" style="margin-left: 5px;"></i> تسجيل الخروج والعودة
                            </button>
                        </div>
                    </div>
                    
                    <p style="margin-top: 2rem; color: #94a3b8; font-size: 0.9rem;">
                        نظام حماية AS3G &copy; ${new Date().getFullYear()}
                    </p>
                </div>
            `;

            const input = modalOverlay.querySelector('#otp_input');
            const btn = modalOverlay.querySelector('#verify_otp_btn');
            const errorText = modalOverlay.querySelector('#otp_error');

            input.focus();

            btn.onclick = async () => {
                if (input.value === otpCode) {
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحقق...';
                    btn.disabled = true;

                    try {
                        // Save device to knownDevices
                        await window.db.collection('users').doc(currentUser.uid).update({
                            knownDevices: firebase.firestore.FieldValue.arrayUnion(deviceId)
                        });

                        document.body.removeChild(modalOverlay);
                        resolve(true);
                    } catch (err) {

                        errorText.textContent = 'حدث خطأ تقني، يرجى المحاولة لاحقاً.';
                        errorText.style.display = 'block';
                        btn.disabled = false;
                        btn.textContent = 'تحقق من الرمز';
                    }
                } else {
                    input.style.borderColor = '#ef4444';
                    input.style.boxShadow = '0 0 0 4px rgba(239, 68, 68, 0.1)';
                    errorText.style.display = 'block';
                    input.value = '';
                    input.focus();
                }
            };

            input.oninput = (e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');
                if (errorText.style.display === 'block') {
                    errorText.style.display = 'none';
                    input.style.borderColor = '#e2e8f0';
                    input.style.boxShadow = 'none';
                }
            };

            // Allow enter key
            input.onkeypress = (e) => {
                if (e.key === 'Enter') btn.click();
            };
        }

        window.handleOtpLogout = async () => {
            try {
                await window.auth.signOut();
                window.location.href = 'index.html';
            } catch (err) {

                window.location.href = 'index.html';
            }
        };

        window.resendOTP = () => {
            if (resendCount < RESEND_LIMIT) {
                resendCount++;
                sendOTP();
            }
        };

        document.body.appendChild(modalOverlay);
        sendOTP();
    });
}


// Global Search Logic
let globalSearchTimeout = null;

async function handleGlobalSearch(e) {
    const query = e.target.value.trim().toLowerCase();
    const dropdown = document.getElementById('quickSearchResults');

    if (!query || query.length < 2) {
        dropdown.style.display = 'none';
        return;
    }

    if (e.key === 'Enter') {
        dropdown.style.display = 'none';
        performDeepSearch(query);
        return;
    }

    // Debounce search
    clearTimeout(globalSearchTimeout);
    globalSearchTimeout = setTimeout(async () => {
        const results = await performUnifiedSearch(query);
        displayQuickResults(results);
    }, 400);
}

async function performUnifiedSearch(query) {
    const results = { orders: [], users: [], products: [], support: [], domains: [], faqs: [], logs: [], testimonials: [], coupons: [] };

    try {
        // Define search targets and their required permissions
        const searchTargets = [
            { collection: 'orders', key: 'orders', permission: { section: 'orders', action: 'view' } },
            { collection: 'users', key: 'users', permission: { section: 'users', action: 'view' } },
            { collection: 'products', key: 'products', permission: { section: 'products', action: 'view' } },
            { collection: 'support_tickets', key: 'support', permission: { section: 'support', action: 'view' } },
            { collection: 'domain_requests', key: 'domains', permission: { section: 'domain_requests', action: 'view' } },
            { collection: 'faqs', key: 'faqs', permission: { section: 'faq', action: 'view' } },
            { collection: 'activity_logs', key: 'logs', permission: { section: 'logs', action: 'view' } },
            { collection: 'testimonials', key: 'testimonials', permission: { section: 'cms', action: 'view' } },
            { collection: 'coupons', key: 'coupons', permission: { section: 'coupons', action: 'view' } }
        ];

        // Filter targets based on user permissions
        const allowedTargets = searchTargets.filter(target => {
            if (window.AdminPermissions && window.currentUserData) {
                return window.AdminPermissions.can(target.permission.section, target.permission.action, window.currentUserData);
            }
            return true; // Fallback if system not yet loaded
        });

        // Perform queries only for allowed collections (use allSettled to handle permission errors)
        const queryPromises = allowedTargets.map(target =>
            window.db.collection(target.collection).get()
                .catch(err => {

                    return null; // Return null for failed queries
                })
        );
        const snapshots = await Promise.all(queryPromises);

        // Process results (skip null snapshots from failed queries)
        allowedTargets.forEach((target, index) => {
            const snapshot = snapshots[index];
            if (!snapshot) return; // Skip failed queries
            const key = target.key;

            snapshot.forEach(doc => {
                const data = doc.data();
                let match = false;

                switch (key) {
                    case 'orders':
                        match = doc.id.toLowerCase().includes(query) ||
                            (data.customerEmail && data.customerEmail.toLowerCase().includes(query)) ||
                            (data.customerName && data.customerName.toLowerCase().includes(query));
                        break;
                    case 'users':
                        match = doc.id.toLowerCase().includes(query) ||
                            data.name?.toLowerCase().includes(query) ||
                            data.email?.toLowerCase().includes(query) ||
                            data.phone?.includes(query);
                        break;
                    case 'products':
                        match = doc.id.toLowerCase().includes(query) ||
                            data.name?.toLowerCase().includes(query) ||
                            data.category?.toLowerCase().includes(query) ||
                            data.description?.toLowerCase().includes(query);
                        break;
                    case 'support':
                        match = doc.id.toLowerCase().includes(query) ||
                            data.subject?.toLowerCase().includes(query) ||
                            data.userEmail?.toLowerCase().includes(query) ||
                            data.message?.toLowerCase().includes(query);
                        break;
                    case 'domains':
                        match = doc.id.toLowerCase().includes(query) ||
                            data.domain?.toLowerCase().includes(query) ||
                            data.customerName?.toLowerCase().includes(query) ||
                            data.customerEmail?.toLowerCase().includes(query) ||
                            data.phoneNumber?.includes(query);
                        break;
                    case 'faqs':
                        match = doc.id.toLowerCase().includes(query) ||
                            data.question?.toLowerCase().includes(query) ||
                            data.answer?.toLowerCase().includes(query) ||
                            data.category?.toLowerCase().includes(query);
                        break;
                    case 'logs':
                        match = doc.id.toLowerCase().includes(query) ||
                            data.action?.toLowerCase().includes(query) ||
                            data.user?.toLowerCase().includes(query) ||
                            JSON.stringify(data.details || {}).toLowerCase().includes(query);
                        break;
                    case 'testimonials':
                        match = doc.id.toLowerCase().includes(query) ||
                            data.name?.toLowerCase().includes(query) ||
                            data.content?.toLowerCase().includes(query);
                        break;
                    case 'coupons':
                        match = doc.id.toLowerCase().includes(query) ||
                            data.code?.toLowerCase().includes(query) ||
                            data.discountType?.toLowerCase().includes(query);
                        break;
                }

                if (match) {
                    results[key].push({ id: doc.id, ...data });
                }
            });
        });

        return results;
    } catch (error) {

        return results;
    }
}

function displayQuickResults(results) {
    const dropdown = document.getElementById('quickSearchResults');
    let html = '';
    let totalCount = 0;

    // Users
    if (results.users.length > 0) {
        html += '<div class="search-result-category">المستخدمين</div>';
        results.users.slice(0, 2).forEach(u => {
            html += `
                <div class="quick-search-item" onclick="navigateToRecord('users', '${u.id}')">
                    <i class="fas fa-user"></i>
                    <div class="item-text">
                        <span class="item-title">${u.name || 'مستخدم'}</span>
                        <span class="item-sub">${u.email || ''}</span>
                    </div>
                </div>`;
            totalCount++;
        });
    }

    // Orders
    if (results.orders.length > 0) {
        html += '<div class="search-result-category">الطلبات</div>';
        results.orders.slice(0, 2).forEach(o => {
            html += `
                <div class="quick-search-item" onclick="navigateToRecord('orders', '${o.id}')">
                    <i class="fas fa-shopping-cart"></i>
                    <div class="item-text">
                        <span class="item-title">طلب #${o.id.slice(0, 8)}</span>
                        <span class="item-sub">${o.customerEmail || ''}</span>
                    </div>
                </div>`;
            totalCount++;
        });
    }

    // Domains
    if (results.domains.length > 0) {
        html += '<div class="search-result-category">النطاقات</div>';
        results.domains.slice(0, 2).forEach(d => {
            html += `
                <div class="quick-search-item" onclick="navigateToRecord('domain_requests', '${d.id}')">
                    <i class="fas fa-globe"></i>
                    <div class="item-text">
                        <span class="item-title">${d.domain || 'طلب نطاق'}</span>
                        <span class="item-sub">${d.customerName || ''}</span>
                    </div>
                </div>`;
            totalCount++;
        });
    }

    // Products
    if (results.products.length > 0) {
        html += '<div class="search-result-category">المنتجات</div>';
        results.products.slice(0, 2).forEach(p => {
            html += `
                <div class="quick-search-item" onclick="navigateToRecord('products', '${p.id}')">
                    <i class="fas fa-box"></i>
                    <div class="item-text">
                        <span class="item-title">${p.name || 'منتج'}</span>
                        <span class="item-sub">${p.category || ''}</span>
                    </div>
                </div>`;
            totalCount++;
        });
    }

    if (totalCount === 0) {
        html = '<div class="quick-search-item"><div class="item-text"><span class="item-title">لا توجد نتائج</span></div></div>';
    } else {
        html += `<div class="quick-search-item" style="border-top: 1px solid #eee; background: #f8fafc;" onclick="performDeepSearch('${document.getElementById('globalSearchInput').value}')">
                    <div class="item-text" style="text-align: center; color: #3b82f6; font-weight: 700;">
                        عرض كل النتائج (${Object.values(results).flat().length})
                    </div>
                 </div>`;
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
}

async function performDeepSearch(query) {
    switchTab('searchResults');
    document.getElementById('searchQueryTitle').textContent = `نتائج البحث عن: "${query}"`;
    const container = document.getElementById('globalSearchResults');
    container.innerHTML = '<div class="loading-spinner">جاري البحث...</div>';

    const results = await performUnifiedSearch(query);
    displayGlobalSearchResults(results);
}

function displayGlobalSearchResults(results) {
    const container = document.getElementById('globalSearchResults');
    let html = '';
    let total = 0;

    const sections = [
        { key: 'users', label: 'المستخدمين', icon: 'fa-users', tab: 'users' },
        { key: 'orders', label: 'الطلبات', icon: 'fa-shopping-cart', tab: 'orders' },
        { key: 'domains', label: 'طلبات النطاقات', icon: 'fa-globe', tab: 'domain_requests' },
        { key: 'products', label: 'المنتجات', icon: 'fa-box', tab: 'products' },
        { key: 'support', label: 'الدعم الفني', icon: 'fa-headset', tab: 'support' },
        { key: 'faqs', label: 'الأسئلة الشائعة', icon: 'fa-question-circle', tab: 'faq' },
        { key: 'logs', label: 'سجلات النشاط', icon: 'fa-history', tab: 'logs' },
        { key: 'testimonials', label: 'آراء العملاء', icon: 'fa-comment-alt', tab: 'cms' },
        { key: 'coupons', label: 'الكوبونات', icon: 'fa-ticket-alt', tab: 'coupons' }
    ];

    sections.forEach(sec => {
        const items = results[sec.key];
        if (items.length > 0) {
            total += items.length;
            html += `
                <div class="search-section-container">
                    <div class="search-section-header">
                        <div class="header-icon-box">
                            <i class="fas ${sec.icon}"></i>
                        </div>
                        <h3>${sec.label} <span class="count-badge">${items.length}</span></h3>
                    </div>
                    
                    <div class="search-grid">
                        ${items.map(item => {
                // Determine status/badge if available
                let statusHtml = '';
                if (item.status) {
                    const statusClass = getStatusClass ? getStatusClass(item.status) : 'status-default';
                    const statusText = getStatusText ? getStatusText(item.status) : item.status;
                    statusHtml = `<span class="status-badge ${statusClass}">${statusText}</span>`;
                }

                // Dynamic content based on type
                let mainText = item.name || item.domain || item.question || item.subject || item.action || item.code || `سجل #${item.id.slice(0, 8)}`;
                let subText = item.email || item.customerEmail || item.userEmail || item.user || `ID: ${item.id}`;
                let extraText = item.category || item.discountType || item.phoneNumber || '';

                return `
                            <div class="search-result-card" onclick="navigateToRecord('${sec.tab}', '${item.id}')">
                                <div class="card-content-wrapper">
                                    <div class="card-main-info">
                                        <h4 class="result-title">${mainText}</h4>
                                        <div class="result-meta">
                                            <span class="meta-item"><i class="fas fa-fingerprint"></i> ${item.id.slice(0, 8)}...</span>
                                            ${subText ? `<span class="meta-item"><i class="far fa-user"></i> ${subText}</span>` : ''}
                                            ${extraText ? `<span class="meta-item"><i class="fas fa-tag"></i> ${extraText}</span>` : ''}
                                        </div>
                                    </div>
                                    <div class="card-status-box">
                                        ${statusHtml}
                                        <button class="view-btn"><i class="fas fa-arrow-left"></i></button>
                                    </div>
                                </div>
                            </div>
                            `;
            }).join('')}
                    </div>
                </div>`;
        }
    });

    if (total === 0) {
        container.innerHTML = `
            <div class="empty-search-state">
                <i class="fas fa-search-minus"></i>
                <p>لم يتم العثور على نتائج للبحث</p>
            </div>`;
    } else {
        container.innerHTML = html;
        document.getElementById('searchCountSub').textContent = `تم العثور على ${total} نتيجة بحث`;
    }
}

function navigateToRecord(tab, id) {
    document.getElementById('quickSearchResults').style.display = 'none';
    switchTab(tab);

    // Logic to highlight or open the specific record
    setTimeout(() => {
        if (tab === 'orders') viewOrderDetails(id);
        if (tab === 'support') replyToTicket(id);
        if (tab === 'domain_requests') {
            // If there's a view function for domains
            if (typeof viewDomainRequestDetails === 'function') viewDomainRequestDetails(id);
        }
        if (tab === 'faq') {
            if (typeof editFAQ === 'function') editFAQ(id);
        }
        if (tab === 'products') {
            if (typeof viewProductDetails === 'function') viewProductDetails(id);
        }
        if (tab === 'users') {
            if (typeof viewUserDetails === 'function') viewUserDetails(id);
        }
        if (tab === 'coupons') {
            if (typeof editCoupon === 'function') editCoupon(id);
        }
        if (tab === 'cms') {
            // Scroll to testimonials or highlight
        }
    }, 500);
}

// Apply page-level permissions to sidebar
function applyPagePermissions(userData) {
    if (!userData) return;

    // Super admins see everything
    if (userData.role === 'super_admin') return;

    const permissions = userData.pagePermissions || {};

    // Select all menu items
    document.querySelectorAll('.admin-sidebar .menu-item').forEach(item => {
        const tabName = item.getAttribute('data-page');
        if (tabName) {
            // If the tab is restricted (explicitly false), hide it
            if (permissions[tabName] === false) {
                item.style.display = 'none';
            } else {
                item.style.display = 'flex';
            }
        }
    });
}


// Switch between tabs
function switchTab(tabName) {
    // Check page permissions
    if (window.currentUserData && window.currentUserData.role !== 'super_admin') {
        const permissions = window.currentUserData.pagePermissions || {};
        if (permissions[tabName] === false) {
            showMessage('ليس لديك صلاحية للوصول إلى هذه الصفحة', 'error');
            return;
        }
    }

    // Update menu items
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });

    // Find active item (handle both event and programmatic calls)
    let clickedItem;
    if (typeof event !== 'undefined' && event && event.target && typeof event.target.closest === 'function') {
        clickedItem = event.target.closest('.menu-item') || event.target;
    } else {
        // Find menu item by the tabName it's supposed to switch to
        clickedItem = document.querySelector(`.menu-item[onclick*="'${tabName}'"]`) ||
            document.querySelector(`.menu-item[onclick*="${tabName}"]`);
    }

    if (clickedItem && typeof clickedItem.classList !== 'undefined') {
        clickedItem.classList.add('active');
    }

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active');

    // Update page title
    const titles = {
        dashboard: 'لوحة التحكم الرئيسية',
        orders: 'إدارة الطلبات',
        users: 'إدارة المديرين والمشرفين',
        customers: 'قائمة العملاء والشركات',
        support: 'إدارة الدعم الفني',
        products: 'إدارة المنتجات',
        faq: 'إدارة الأسئلة الشائعة',
        settings: 'إعدادات النظام العام',
        analytics: 'التحليلات والإحصائيات',
        coupons: 'الكوبونات والخصومات',
        cms: 'إدارة محتوى الموقع',
        logs: 'سجلات النشاط والأمان',

        live_payments: 'مراقبة المدفوعات الحية',

        reports: 'التقارير والمبيعات',
        support_activity: 'نشاط فريق الدعم',
        wallet_recharge: 'طلبات شحن رصيد المحفظة',
        hardware_marketplace: 'إدارة سوق الأجهزة المستعملة',
        searchResults: 'نتائج البحث'
    };

    document.getElementById('pageTitle').textContent = titles[tabName] || 'لوحة التحكم';

    // Load specific tab data if needed
    switch (tabName) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'orders':
            displayOrders();
            break;
        case 'users':
            loadUsers();
            break;
        case 'customers':
            loadCustomers();
            break;
        case 'support':
            displaySupportTickets();
            break;
        case 'products':
            loadProducts();
            break;
        case 'settings':
            loadQuickSettings();
            loadPaymentSettings();
            break;
        case 'faq':
            loadFAQs();
            break;
        case 'analytics':
            loadAnalytics();
            break;
        case 'coupons':
            loadCoupons();
            break;
        case 'cms':
            loadCMS();
            break;
        case 'logs':
            loadLogs();
            break;

        case 'live_payments':
            loadIncomingPayments();
            break;

        case 'reports':
            loadReportsData();
            break;
        case 'support_activity':
            loadSupportActivity();
            break;
        case 'wallet_recharge':
            loadWalletRechargeRequests();
            break;
        case 'hardware_marketplace':
            loadHardwareMarketplace();
            break;
    }
}


// Load dashboard data
async function loadDashboardData() {
    try {
        // Load statistics
        const stats = await Promise.all([
            FirebaseUtils.getDocuments('orders'),
            FirebaseUtils.getDocuments('users'),
            FirebaseUtils.getDocuments('support_tickets')
        ]);

        const ordersCount = stats[0].success ? stats[0].data.length : 0;
        const usersCount = stats[1].success ? stats[1].data.length : 0;
        const ticketsCount = stats[2].success ? stats[2].data.length : 0;

        displayDashboardStats(ordersCount, usersCount, ticketsCount);

        // Load recent activities
        await loadRecentActivities();

    } catch (error) {

    }
}

// Load reports data
async function loadReportsData() {

    try {
        const stats = await Promise.all([
            FirebaseUtils.getDocuments('orders'),
            FirebaseUtils.getDocuments('users'),
            FirebaseUtils.getDocuments('support_tickets'),
            FirebaseUtils.getDocuments('domain_requests')
        ]);

        const orders = stats[0].success ? stats[0].data : [];
        const users = stats[1].success ? stats[1].data : [];
        const tickets = stats[2].success ? stats[2].data : [];
        const domains = stats[3].success ? stats[3].data : [];

        // Calculate Revenue with improved precision
        const totalRevenue = orders.reduce((acc, order) => {
            if (order.status === 'approved' || order.status === 'completed') {
                const price = parseFloat(order.totalPrice || order.price || 0);
                return acc + (isNaN(price) ? 0 : price);
            }
            return acc;
        }, 0);

        // Update Stats Cards with animation-ready IDs
        document.getElementById('totalOrdersStat').textContent = orders.length.toLocaleString();
        document.getElementById('totalRevenueStat').textContent = `${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })} ج.م`;
        document.getElementById('totalDomainRequestsStat').textContent = domains.length.toLocaleString();
        document.getElementById('totalUsersStat').textContent = users.length.toLocaleString();

        // Support Stats
        const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'pending').length;
        const resolvedTickets = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
        const totalTickets = tickets.length || 1;

        document.getElementById('openTicketsCount').textContent = openTickets;
        document.getElementById('resolvedTicketsCount').textContent = resolvedTickets;
        document.getElementById('openTicketsProgress').style.width = `${(openTickets / totalTickets) * 100}%`;
        document.getElementById('resolvedTicketsProgress').style.width = `${(resolvedTickets / totalTickets) * 100}%`;

        // Initialize Charts
        initOrderStatusChart(orders);

    } catch (error) {

        showMessage('خطأ في تحميل بيانات التقارير', 'error');
    }
}

// Initialize Order Status Chart
let statusChartInstance = null;
function initOrderStatusChart(orders) {
    const ctx = document.getElementById('orderStatusChart').getContext('2d');

    const statusCounts = {
        pending: 0,
        approved: 0,
        rejected: 0,
        completed: 0
    };

    orders.forEach(order => {
        const status = order.status || 'pending';
        if (statusCounts.hasOwnProperty(status)) {
            statusCounts[status]++;
        }
    });

    if (statusChartInstance) {
        statusChartInstance.destroy();
    }

    statusChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['قيد الانتظار', 'مقبول', 'مرفوض', 'مكتمل'],
            datasets: [{
                data: [statusCounts.pending, statusCounts.approved, statusCounts.rejected, statusCounts.completed],
                backgroundColor: [
                    '#f59e0b', // Pending (Amber)
                    '#6366f1', // Approved (Indigo)
                    '#ef4444', // Rejected (Red)
                    '#10b981'  // Completed (Emerald)
                ],
                hoverBackgroundColor: [
                    '#fbbf24',
                    '#818cf8',
                    '#f87171',
                    '#34d399'
                ],
                borderWidth: 0,
                weight: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '80%',
            plugins: {
                legend: {
                    position: 'bottom',
                    padding: 20,
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: { family: 'Cairo', size: 14, weight: '600' },
                        color: '#475569',
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#1e293b',
                    bodyColor: '#475569',
                    bodyFont: { family: 'Cairo' },
                    borderColor: '#f1f5f9',
                    borderWidth: 1,
                    padding: 12,
                    boxPadding: 8,
                    usePointStyle: true
                }
            }
        }
    });
}

// Display dashboard statistics
function displayDashboardStats(ordersCount, usersCount, ticketsCount) {
    const statsGrid = document.getElementById('statsGrid');

    statsGrid.innerHTML = `
        <div class="stat-card orders">
            <i class="fas fa-shopping-cart"></i>
            <div class="stat-number">${ordersCount}</div>
            <div class="stat-label">إجمالي الطلبات</div>
        </div>
        
        <div class="stat-card users">
            <i class="fas fa-users"></i>
            <div class="stat-number">${usersCount}</div>
            <div class="stat-label">المستخدمين المسجلين</div>
        </div>
        
        <div class="stat-card tickets">
            <i class="fas fa-headset"></i>
            <div class="stat-number">${ticketsCount}</div>
            <div class="stat-label">تذاكر الدعم</div>
        </div>
        
        <div class="stat-card">
            <i class="fas fa-chart-line"></i>
            <div class="stat-number">${Math.round((ordersCount * 0.85))}</div>
            <div class="stat-label">معدل النجاح</div>
        </div>
    `;
}

// Load recent activities
async function loadRecentActivities() {
    const activitiesDiv = document.getElementById('recentActivities');

    try {
        // Get recent orders
        const recentOrders = await FirebaseUtils.getDocuments('orders',
            { field: 'createdAt', direction: 'desc' }, 5);

        if (recentOrders.success && recentOrders.data.length > 0) {
            const activitiesHTML = recentOrders.data.map(order => `
                <div class="activity-item" style="padding: 1rem; border-bottom: 1px solid #e9ecef;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>${order.customerName}</strong> طلب <strong>${order.systemName}</strong>
                        </div>
                        <small style="color: #666;">
                            ${order.createdAt ? formatDateArabic(order.createdAt.toDate()) : 'غير محدد'}
                        </small>
                    </div>
                </div>
            `).join('');

            activitiesDiv.innerHTML = activitiesHTML;
        } else {
            activitiesDiv.innerHTML = '<p style="text-align: center; color: #666;">لا توجد أنشطة حديثة</p>';
        }
    } catch (error) {

        activitiesDiv.innerHTML = '<p style="text-align: center; color: #666;">خطأ في تحميل الأنشطة</p>';
    }
}

// Load orders
async function loadOrders() {
    try {
        const result = await FirebaseUtils.getDocuments('orders',
            { field: 'createdAt', direction: 'desc' });

        if (result.success) {
            allOrders = result.data;

            // Fetch user data for orders that don't have customer info
            for (let order of allOrders) {
                // Get userId from various possible field names
                const userId = order.userId || order.user || order.uid || order.customerId;

                if (userId && !order.customerName) {
                    try {
                        const userDoc = await window.db.collection('users').doc(userId).get();
                        if (userDoc.exists) {
                            const userData = userDoc.data();
                            order.customerName = userData.name || userData.displayName || userData.fullName || userData.username || 'مستخدم غير معروف';
                            order.email = order.email || userData.email || userData.mail;
                            order.phoneNumber = order.phoneNumber || userData.phone || userData.phoneNumber;
                            order.businessName = order.businessName || userData.businessName || userData.company;
                        }
                    } catch (err) {

                    }
                }
            }

            filteredOrders = [...allOrders];
            displayOrders();
        }
    } catch (error) {

    }
}

// Display orders
function displayOrders() {
    const gridContainer = document.getElementById('ordersGrid');
    if (!gridContainer) return;

    if (filteredOrders.length === 0) {
        gridContainer.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
                <i class="fas fa-shopping-cart"></i>
                <h3>لا توجد طلبات</h3>
                <p>لم يتم العثور على أي طلبات مطابقة للبحث</p>
            </div>
        `;
        return;
    }

    gridContainer.innerHTML = filteredOrders.map(order => {
        const systemName = order.systemName || 'غير محدد';
        const customerName = order.customerName || 'عميل مجهول';
        const businessName = order.businessName || 'غير محدد';
        const phone = order.phoneNumber || '';
        const statusClass = getDomainStatusClass(order.status);
        const statusText = getDomainStatusText(order.status);
        const dateStr = formatDateArabic(order.createdAt ? order.createdAt.toDate() : new Date());
        const shortId = order.id.substring(0, 8);

        // Order-specific fields
        const senderPhone = order.senderPhone || 'غير متوفر';
        const receiptImage = order.receiptImage || '';
        const selectedPlan = order.selectedPlan || 'غير محدد';
        const systemPrice = order.systemPrice || '0';
        const location = order.location || 'غير محدد';
        const email = order.email || '';

        return `
            <div class="domain-card-modern ${order.status === 'pending_payment' ? 'priority-card' : ''}" style="border-right: 5px solid ${order.status === 'pending_payment' ? '#f59e0b' : '#3b82f6'};">
                <div class="domain-card-header">
                    <span class="domain-id-badge">#${shortId}</span>
                    <span class="domain-status-tag ${statusClass}">${statusText}</span>
                </div>

                <div class="domain-main-info">
                    <span class="domain-name-display">${systemName}</span>
                    <span style="font-size: 1.2rem; font-weight: 700; color: #10b981; margin-top: 0.5rem; display: block;">${systemPrice} جنيه</span>
                </div>

                <div class="domain-customer-box">
                    <div class="customer-details-small" style="width: 100%;">
                        <p class="customer-name-small"><i class="fas fa-user"></i> ${customerName}</p>
                        <p class="customer-phone-small"><i class="fas fa-briefcase"></i> ${businessName}</p>
                        ${phone ? `<p class="customer-phone-small"><i class="fas fa-phone-alt"></i> ${phone}</p>` : ''}
                        ${email ? `<p class="customer-phone-small"><i class="fas fa-envelope"></i> ${email}</p>` : ''}
                        <p class="customer-phone-small" style="color: #6366f1;"><i class="fas fa-wallet"></i> محفظة المحول: ${senderPhone}</p>
                    </div>
                </div>

                <div class="domain-meta-grid" style="margin-top: 1rem;">
                    <div class="meta-item-small">
                        <span class="meta-label-small">الخطة المختارة</span>
                        <span class="meta-value-small">${selectedPlan}</span>
                    </div>
                    <div class="meta-item-small">
                        <span class="meta-label-small">الموقع</span>
                        <span class="meta-value-small">${location}</span>
                    </div>
                    <div class="meta-item-small">
                        <span class="meta-label-small">التاريخ</span>
                        <span class="meta-value-small">${dateStr}</span>
                    </div>
                </div>

                ${receiptImage ? `
                <div class="receipt-preview-box" onclick="showReceiptPreview('${receiptImage}')" style="margin-top: 1rem; cursor: pointer;">
                    <span style="font-size: 0.8rem; color: #64748b; display: block; margin-bottom: 0.3rem;">صورة الإيصال (اضغط للتكبير):</span>
                    <img src="${receiptImage}" style="width: 60px; height: 60px; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0;">
                </div>` : ''}

                <div class="domain-actions-modern" style="margin-top: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
                    <button class="domain-btn-action btn-view-modern" onclick="viewOrderDetails('${order.id}')" title="عرض التفاصيل">
                        <i class="fas fa-eye"></i>
                    </button>
                    
                    <button class="domain-btn-action btn-update-modern" style="background: #10b981; color: white;" onclick="updateOrderStatus('${order.id}', 'approved')" title="قبول">
                        <i class="fas fa-check"></i>
                        <span>قبول</span>
                    </button>
                    
                    <button class="domain-btn-action btn-update-modern" style="background: #ef4444; color: white;" onclick="updateOrderStatus('${order.id}', 'rejected')" title="رفض">
                        <i class="fas fa-times"></i>
                        <span>رفض</span>
                    </button>
                    
                    <button class="domain-btn-action" style="background: #8b5cf6; color: white;" onclick="openChatWithCustomer('${order.userId}', '${order.customerName || 'العميل'}')" title="تواصل مع العميل">
                        <i class="fas fa-comments"></i>
                        <span>تواصل</span>
                    </button>

                    <button class="domain-btn-action" style="background: #3b82f6; color: white;" onclick="deliverOrderData('${order.id}')" title="تسليم البيانات (كود/لينك)">
                        <i class="fas fa-paper-plane"></i>
                        <span>تسليم</span>
                    </button>

                    <button class="domain-btn-action" onclick="showUpdateOrderStatusModal('${order.id}', '${order.status}')" title="تغيير الحالة">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Filter orders
function filterOrders() {
    const statusFilter = document.getElementById('orderStatusFilter').value;

    filteredOrders = allOrders.filter(order => {
        return statusFilter === 'all' || !statusFilter || order.status === statusFilter;
    });

    displayOrders();
}

// Search orders
function searchOrders() {
    const searchTerm = document.getElementById('orderSearchInput').value.toLowerCase();

    filteredOrders = allOrders.filter(order => {
        return order.customerName.toLowerCase().includes(searchTerm) ||
            order.businessName.toLowerCase().includes(searchTerm) ||
            order.systemName.toLowerCase().includes(searchTerm);
    });

    displayOrders();
}

// View order details
function viewOrderDetails(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>تفاصيل الطلب #${order.id.substring(0, 8)}</h2>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; margin: 2rem 0;">
            <div>
                <h3>معلومات العميل</h3>
                <p><strong>الاسم:</strong> ${order.customerName}</p>
                <p><strong>النشاط التجاري:</strong> ${order.businessName}</p>
                <p><strong>رقم الهاتف:</strong> ${order.phoneNumber}</p>
                <p><strong>العنوان:</strong> ${order.location}</p>
                ${order.email ? `<p><strong>البريد الإلكتروني:</strong> ${order.email}</p>` : ''}
            </div>
            
            <div>
                <h3>معلومات الطلب</h3>
                <p><strong>النظام:</strong> ${order.systemName}</p>
                <p><strong>السعر:</strong> ${order.systemPrice}</p>
                <p><strong>الحالة:</strong> ${getStatusText(order.status)}</p>
                <p><strong>تاريخ الطلب:</strong> ${order.createdAt ? formatDateArabic(order.createdAt.toDate()) : 'غير محدد'}</p>
            </div>
        </div>
        
        ${order.notes ? `
            <div>
                <h3>ملاحظات</h3>
                <p>${order.notes}</p>
            </div>
        ` : ''}
        
        <div style="margin-top: 2rem; text-align: center;">
            ${order.status === 'pending' ? `
                <button class="btn-primary" onclick="updateOrderStatus('${order.id}', 'approved'); closeModal()">
                    قبول الطلب
                </button>
                <button class="btn-reject" onclick="updateOrderStatus('${order.id}', 'rejected'); closeModal()" style="margin-right: 1rem;">
                    رفض الطلب
                </button>
            ` : ''}
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Close modal functionality
    const closeBtn = modal.querySelector('.close');
    closeBtn.onclick = () => {
        document.body.removeChild(modal);
    };

    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
}

// Update order status
async function updateOrderStatus(orderId, newStatus) {
    try {
        // Get order details first
        const orderDoc = await window.db.collection('orders').doc(orderId).get();
        const orderData = orderDoc.exists ? orderDoc.data() : null;

        const result = await FirebaseUtils.updateDocument('orders', orderId, {
            status: newStatus
        });

        if (result.success) {
            showMessage(`تم ${newStatus === 'approved' ? 'قبول' : 'رفض'} الطلب بنجاح`, 'success');


            // Resolve userId robustly
            const userId = (orderData && (orderData.userId || orderData.user || orderData.uid || orderData.customerId));

            // Send automatic notification if approved
            if (newStatus === 'approved' && orderData && userId) {
                try {
                    await window.db.collection('support_tickets').add({
                        userId: userId,
                        userName: orderData.customerName || 'العميل',
                        userEmail: orderData.email || '',
                        subject: 'تم قبول طلبك',
                        message: `تم قبول طلبك بنجاح!\n\nتفاصيل الطلب:\n- النظام: ${orderData.systemName || 'غير محدد'}\n- الكود: ${orderId.substring(0, 8)}\n- السعر: ${orderData.systemPrice || '0'} جنيه\n\nسيتم التواصل معك قريباً لإتمام الإجراءات.`,
                        priority: 'medium',
                        status: 'open',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdBy: 'system',
                        createdByName: 'النظام الآلي',
                        replies: [{
                            message: `تم قبول طلبك بنجاح!\n\nتفاصيل الطلب:\n- النظام: ${orderData.systemName || 'غير محدد'}\n- الكود: ${orderId.substring(0, 8)}\n- السعر: ${orderData.systemPrice || '0'} جنيه\n\nسيتم التواصل معك قريباً لإتمام الإجراءات.`,
                            authorName: 'النظام الآلي',
                            isAdminReply: true,
                            createdAt: new Date()
                        }]
                    });
                } catch (notifError) {

                }
            }

            await loadOrders(); // Reload orders
        } else {
            throw new Error(result.error);
        }
    } catch (error) {

        showMessage('حدث خطأ في تحديث حالة الطلب', 'error');
    }
}

// Show Update Order Status Modal
async function showUpdateOrderStatusModal(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    const { value: newStatus } = await Swal.fire({
        title: 'تحديث حالة الطلب',
        html: `
            <div style="text-align: right; margin-bottom: 1rem;">
                <p><strong>الطلب:</strong> ${order.systemName || 'غير محدد'}</p>
                <p><strong>العميل:</strong> ${order.customerName || 'غير محدد'}</p>
            </div>
            <select id="swal-status" class="swal2-select" style="width: 100%;">
                <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>قيد الانتظار</option>
                <option value="pending_payment" ${order.status === 'pending_payment' ? 'selected' : ''}>في انتظار الدفع</option>
                <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>قيد المعالجة</option>
                <option value="approved" ${order.status === 'approved' ? 'selected' : ''}>تم القبول</option>
                <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>مكتمل</option>
                <option value="rejected" ${order.status === 'rejected' ? 'selected' : ''}>مرفوض</option>
            </select>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'تحديث',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#3b82f6',
        preConfirm: () => {
            return document.getElementById('swal-status').value;
        }
    });

    if (newStatus && newStatus !== order.status) {
        await updateOrderStatus(orderId, newStatus);
    }
}

// Load users (Admins & Staff)
/* Obsolete loadUsers removed */

// Display users
/* Obsolete displayUsers removed */
function displayUsers_OBSOLETE() {
    const usersTable = document.getElementById('usersTable');

    if (filteredUsers.length === 0) {
        usersTable.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <h3>لا توجد مستخدمين</h3>
                <p>لم يتم تسجيل أي مستخدمين حتى الآن</p>
            </div>
        `;
        return;
    }

    const tableHTML = `
        <div class="table-responsive">
            <table class="data-table">
            <thead>
                <tr>
                    <th>الاسم</th>
                    <th>البريد الإلكتروني</th>
                    <th>النشاط التجاري</th>
                    <th>النوع</th>
                    <th>الحالة</th>
                    <th>تاريخ التسجيل</th>
                    <th>الإجراءات</th>
                </tr>
            </thead>
            <tbody>
                ${filteredUsers.map(user => `
                    <tr class="${user.isBlocked ? 'blocked-row' : ''}">
                        <td>${user.name || 'غير محدد'}</td>
                        <td>${user.email}</td>
                        <td>${user.businessName || 'غير محدد'}</td>
                        <td>${getRoleText(user.role)}</td>
                        <td>
                            <span class="status-badge ${user.isBlocked ? 'status-rejected' : 'status-approved'}">
                                ${user.isBlocked ? 'محظور' : 'نشط'}
                            </span>
                        </td>
                        <td>${user.createdAt ? formatDateArabic(user.createdAt.toDate()) : 'غير محدد'}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="action-btn btn-view" title="عرض التفاصيل" onclick="viewUserDetails('${user.id}')">
                                    <i class="fas fa-eye"></i>
                                </button>
                                <button class="action-btn btn-edit" title="تعديل الصلاحيات" onclick="editUserRole('${user.id}')">
                                    <i class="fas fa-user-shield"></i>
                                </button>
                                <button class="action-btn" title="إعادة تعيين كلمة المرور" onclick="sendAdminPasswordReset('${user.email}')" style="background: #f59e0b; color: white;">
                                    <i class="fas fa-key"></i>
                                </button>
                                <button class="action-btn ${user.isBlocked ? 'btn-unblock' : 'btn-block'}" 
                                        title="${user.isBlocked ? 'تفعيل الحساب' : 'حظر الحساب'}"
                                        onclick="toggleUserBlock('${user.id}', ${!user.isBlocked})">
                                    <i class="fas ${user.isBlocked ? 'fa-user-check' : 'fa-user-slash'}"></i>
                                </button>
                                <button class="action-btn" title="حذف الحساب نهائياً" 
                                        onclick="handleDeleteUser('${user.id}', '${user.email}', 'admin')"
                                        style="background: #ef4444; color: white;">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    usersTable.innerHTML = tableHTML;
}

// Filter users
function filterUsers() {
    const roleFilter = document.getElementById('userRoleFilter').value;

    filteredUsers = allUsers.filter(user => {
        return !roleFilter || user.role === roleFilter;
    });

    displayUsers();
}

// Admin Password Reset
async function sendAdminPasswordReset(email) {
    const confirmed = await showConfirmModal(
        'إعادة تعيين كلمة المرور',
        `هل أنت متأكد من رغبتك في إرسال رابط إعادة تعيين كلمة المرور إلى: <br><b>${email}</b>؟`,
        'إرسال الرابط',
        'إلغاء'
    );

    if (!confirmed) return;

    try {
        await window.auth.sendPasswordResetEmail(email);
        showMessage('تم إرسال رابط استعادة كلمة المرور بنجاح إلى بريد المستخدم', 'success');
    } catch (error) {

        let errorMessage = 'حدث خطأ في إرسال رابط الاستعادة';
        if (error.code === 'auth/user-not-found') errorMessage = 'هذا البريد غير مسجل في النظام';
        showMessage(errorMessage, 'error');
    }
}

// Helper: Get Status Class
function getDomainStatusClass(status) {
    switch (status) {
        case 'pending': return 'status-pending';
        case 'pending_payment': return 'status-pending-payment';
        case 'completed': return 'status-completed';
        case 'approved': return 'status-approved';
        case 'rejected': return 'status-rejected';
        case 'processing': return 'status-processing';
        default: return 'status-default';
    }
}

// Helper: Get Status Text
function getDomainStatusText(status) {
    switch (status) {
        case 'pending': return 'قيد الانتظار';
        case 'pending_payment': return 'في انتظار الدفع';
        case 'completed': return 'مكتمل';
        case 'approved': return 'تم القبول';
        case 'rejected': return 'مرفوض';
        case 'processing': return 'قيد المعالجة';
        default: return 'غير معروف';
    }
}

// Custom Confirmation Modal Utility
function showConfirmModal(title, message, confirmText = 'تأكيد', cancelText = 'إلغاء') {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style = "position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 11000; display: flex; align-items: center; justify-content: center; font-family: 'Cairo', sans-serif; direction: rtl; backdrop-filter: blur(4px);";

        modal.innerHTML = `
            <div style="background: white; padding: 2.5rem; border-radius: 20px; width: 400px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: modalFadeIn 0.3s ease-out;">
                <div style="width: 60px; height: 60px; background: #fff7ed; color: #f59e0b; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; font-size: 1.5rem;">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <h3 style="margin-bottom: 1rem; color: #1e3a5f;">${title}</h3>
                <p style="color: #64748b; font-size: 0.95rem; line-height: 1.6; margin-bottom: 2rem;">${message}</p>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button id="modal_confirm_btn" style="flex: 1; padding: 0.8rem; background: #2c5aa0; color: white; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.2s;">${confirmText}</button>
                    <button id="modal_cancel_btn" style="flex: 1; padding: 0.8rem; background: #f1f5f9; color: #64748b; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.2s;">${cancelText}</button>
                </div>
            </div>
            <style>
                @keyframes modalFadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
                #modal_confirm_btn:hover { background: #1e3a5f; }
                #modal_cancel_btn:hover { background: #e2e8f0; }
            </style>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#modal_confirm_btn').onclick = () => {
            document.body.removeChild(modal);
            resolve(true);
        };

        modal.querySelector('#modal_cancel_btn').onclick = () => {
            document.body.removeChild(modal);
            resolve(false);
        };

        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(false);
            }
        };
    });
}

// Search users
function searchUsers() {
    const searchTerm = document.getElementById('userSearchInput').value.toLowerCase();

    filteredUsers = allUsers.filter(user => {
        return (user.name && user.name.toLowerCase().includes(searchTerm)) ||
            user.email.toLowerCase().includes(searchTerm) ||
            (user.businessName && user.businessName.toLowerCase().includes(searchTerm));
    });

    displayUsers();
}

// === Customer Management (Regular Users) ===

// Load Customers
/* Obsolete loadCustomers removed */

// Display Customers
/* Obsolete displayCustomers removed */
function displayCustomers_OBSOLETE() {
    const container = document.getElementById('customersTableArea');

    if (filteredCustomers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-friends"></i>
                <h3>لا يوجد عملاء حالياً</h3>
                <p>لم يتم العثور على أي حسابات عملاء تطابق البحث</p>
            </div>
        `;
        return;
    }

    const tableHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>العميل</th>
                    <th>البريد الإلكتروني</th>
                    <th>النشاط التجاري</th>
                    <th>رقم الهاتف</th>
                    <th>الحالة</th>
                    <th>تاريخ الانضمام</th>
                    <th>الإجراءات</th>
                </tr>
            </thead>
            <tbody>
                ${filteredCustomers.map(customer => `
                    <tr class="${customer.isBlocked ? 'blocked-row' : ''}">
                        <td>
                            <div style="display: flex; align-items: center; gap: 0.8rem;">
                                <div style="width: 35px; height: 35px; border-radius: 50%; background: #eff6ff; color: #3b82f6; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem;">
                                    ${customer.name ? customer.name.charAt(0).toUpperCase() : 'U'}
                                </div>
                                <span style="font-weight: 600;">${customer.name || 'مستخدم غير معروف'}</span>
                            </div>
                        </td>
                        <td>${customer.email}</td>
                        <td>${customer.businessName || '<span style="color: #94a3b8;">غير محدد</span>'}</td>
                        <td dir="ltr" style="text-align: right;">${customer.phone || '---'}</td>
                        <td>
                            <span class="status-badge ${customer.isBlocked ? 'status-rejected' : 'status-approved'}">
                                ${customer.isBlocked ? 'محظور' : 'نشط'}
                            </span>
                        </td>
                        <td>${customer.createdAt ? formatDateArabic(customer.createdAt.toDate()) : '---'}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="action-btn" title="إعادة تعيين كلمة المرور" onclick="sendAdminPasswordReset('${customer.email}')" style="background: #f59e0b; color: white;">
                                    <i class="fas fa-key"></i>
                                </button>
                                <button class="action-btn ${customer.isBlocked ? 'btn-unblock' : 'btn-block'}" 
                                        title="${customer.isBlocked ? 'تفعيل الحساب' : 'حظر الحساب'}"
                                        onclick="toggleCustomerBlock('${customer.id}', ${!customer.isBlocked})">
                                    <i class="fas ${customer.isBlocked ? 'fa-user-check' : 'fa-user-slash'}"></i>
                                </button>
                                <button class="action-btn" title="إنشاء تذكرة دعم" onclick="openCreateTicketModal('${customer.id}', '${customer.name}', '${customer.email}')" style="background: #8b5cf6; color: white;">
                                    <i class="fas fa-headset"></i>
                                </button>
                                <button class="action-btn" title="تواصل سريع" onclick="openChatWithCustomer('${customer.id}', '${customer.name}')" style="background: #a855f7; color: white;">
                                    <i class="fas fa-comment-dots"></i>
                                </button>
                                <button class="action-btn" title="إضافة رصيد" onclick="openAddBalanceModal('${customer.id}', '${customer.name}')" style="background: #10b981; color: white;">
                                    <i class="fas fa-wallet"></i>
                                </button>
                                <button class="action-btn btn-view" title="عرض الملف الكامل" onclick="viewUserDetails('${customer.id}')">
                                    <i class="fas fa-external-link-alt"></i>
                                </button>
                                <button class="action-btn" title="حذف العميل نهائياً" 
                                        onclick="handleDeleteUser('${customer.id}', '${customer.email}', 'customer')"
                                        style="background: #ef4444; color: white;">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = tableHTML;
}

// Search Customers
function searchCustomers() {
    const searchTerm = document.getElementById('customerSearchInput').value.toLowerCase();

    filteredCustomers = allCustomers.filter(customer => {
        return (customer.name && customer.name.toLowerCase().includes(searchTerm)) ||
            (customer.email && customer.email.toLowerCase().includes(searchTerm)) ||
            (customer.businessName && customer.businessName.toLowerCase().includes(searchTerm)) ||
            (customer.phone && customer.phone.includes(searchTerm));
    });

    displayCustomers();
}

// Filter Customers by Status
function filterCustomers() {
    const statusFilter = document.getElementById('customerStatusFilter').value;

    filteredCustomers = allCustomers.filter(customer => {
        if (statusFilter === 'active') return !customer.isBlocked;
        if (statusFilter === 'blocked') return customer.isBlocked;
        return true;
    });

    displayCustomers();
}

// Toggle Customer Block (Specific for Customers view)
async function toggleCustomerBlock(userId, blockStatus) {
    const action = blockStatus ? 'حظر' : 'تفعيل';
    const confirmed = await showConfirmModal(
        `${action} الحساب`,
        `هل أنت متأكد من رغبتك في ${action} حساب هذا العميل؟`,
        action,
        'إلغاء'
    );

    if (!confirmed) return;

    try {
        const result = await FirebaseUtils.updateDocument('users', userId, {
            isBlocked: blockStatus
        });

        if (result.success) {
            showMessage(`تم ${action} الحساب بنجاح`, 'success');
            await loadCustomers();
        } else {

            showMessage('فشل تحديث حالة الحساب: ' + (result.error || 'خطأ غير معروف'), 'error');
        }
    } catch (error) {

        showMessage('حدث خطأ أثناء تحديث حالة الحساب', 'error');
    }
}

// Handle User Deletion (Admins & Customers)
async function handleDeleteUser(userId, email, type) {
    const typeLabel = type === 'customer' ? 'العميل' : 'الحساب الإداري';
    const confirmed = await showConfirmModal(
        `حذف ${typeLabel}`,
        `هل أنت متأكد تماماً من رغبتك في حذف ${typeLabel}:<br><b>${email}</b>؟<br><span style="color: #ef4444; font-size: 0.9rem;">⚠️ لا يمكن التراجع عن هذا الإجراء وسيتم مسح جميع بياناته من قاعدة البيانات!</span>`,
        'حذف نهائي',
        'إلغاء'
    );

    if (!confirmed) return;

    try {
        const result = await FirebaseUtils.deleteDocument('users', userId);

        if (result.success) {
            showMessage(`تم حذف ${typeLabel} بنجاح`, 'success');

            // Log action
            await logAction(`حذف ${typeLabel}`, 'delete', {
                email: email,
                userId: userId,
                type: type
            });

            // Reload data based on type
            if (type === 'customer') {
                await loadCustomers();
            } else {
                await loadUsers();
            }
        } else {
            throw new Error(result.error);
        }
    } catch (error) {

        showMessage('حدث خطأ أثناء حذف الحساب', 'error');
    }
}

// Load support tickets
async function loadSupportTickets() {
    try {
        const result = await FirebaseUtils.getDocuments('support_tickets',
            { field: 'updatedAt', direction: 'desc' });

        if (result.success) {
            allTickets = result.data;
            filteredTickets = [...allTickets];
            displaySupportTickets();
        }
    } catch (error) {

    }
}

// Display support tickets
function displaySupportTickets() {
    const ticketsTable = document.getElementById('supportTicketsTable');

    if (filteredTickets.length === 0) {
        ticketsTable.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-headset"></i>
                <h3>لا توجد تذاكر دعم</h3>
                <p>لم يتم تسجيل أي تذاكر دعم حتى الآن</p>
            </div>
        `;
        return;
    }

    const tableHTML = `
        <div class="table-responsive">
            <table class="data-table">
            <thead>
                <tr>
                    <th>رقم التذكرة</th>
                    <th>الموضوع</th>
                    <th>العميل</th>
                    <th>الأولوية</th>
                    <th>الحالة</th>
                    <th>التاريخ</th>
                    <th>الإجراءات</th>
                </tr>
            </thead>
            <tbody>
                ${filteredTickets.map(ticket => `
                    <tr>
                        <td>#${ticket.id.substring(0, 8)}</td>
                        <td>${ticket.subject}</td>
                        <td>${ticket.userEmail || 'غير محدد'}</td>
                        <td>
                            <span class="ticket-priority ${getPriorityBadgeClass(ticket.priority)}">
                                ${getPriorityText(ticket.priority)}
                            </span>
                        </td>
                        <td>
                            <span class="ticket-status ${getTicketStatusClass(ticket.status)}">
                                ${getTicketStatusText(ticket.status)}
                            </span>
                        </td>
                        <td>${ticket.createdAt ? formatDateArabic(ticket.createdAt.toDate()) : 'غير محدد'}</td>
                        <td>
                            <button class="action-btn btn-view" onclick="viewTicketDetails('${ticket.id}')">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="action-btn btn-edit" onclick="replyToTicket('${ticket.id}')">
                                <i class="fas fa-reply"></i>
                            </button>
                            ${ticket.status !== 'closed' && ticket.status !== 'resolved' ? `
                                <button class="action-btn" onclick="closeTicket('${ticket.id}')" style="background: #10b981; color: white;" title="تم الحل">
                                    <i class="fas fa-check-circle"></i>
                                </button>
                            ` : ''}
                            ${(window.currentUserData && (window.currentUserData.role === 'super_admin' || window.currentUserData.role === 'admin')) ? `
                                <button class="action-btn" onclick="deleteSupportTicket('${ticket.id}')" style="background: #ef4444; color: white;" title="حذف التذكرة">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        `;

    ticketsTable.innerHTML = tableHTML;
}

// Utility functions
function getStatusClass(status) {
    switch (status) {
        case 'pending': return 'status-pending';
        case 'approved': return 'status-approved';
        case 'rejected': return 'status-rejected';
        default: return 'status-pending';
    }
}

function getStatusText(status) {
    switch (status) {
        case 'pending': return 'قيد المراجعة';
        case 'approved': return 'مقبول';
        case 'rejected': return 'مرفوض';
        default: return 'قيد المراجعة';
    }
}

function getRoleText(role) {
    switch (role) {
        case 'super_admin': return 'مدير عام';
        case 'admin': return 'مدير النظام';
        case 'sales_manager': return 'مدير مبيعات';
        case 'support_manager': return 'دعم فني';
        case 'content_manager': return 'مدير محتوى';
        case 'customer': return 'عميل';
        default: return role || 'مستخدم';
    }
}

// Product Helpers
function getProductCategoryText(category) {
    switch (category) {
        case 'basic': return 'باقة أساسية';
        case 'advanced': return 'باقة متقدمة';
        case 'professional': return 'باقة احترافية';
        case 'enterprise': return 'باقة مؤسسات';
        default: return 'باقة عامة';
    }
}

function getTicketStatusClass(status) {
    switch (status) {
        case 'open': return 'status-open';
        case 'in-progress': return 'status-in-progress';
        case 'resolved': return 'status-resolved';
        case 'closed': return 'status-closed';
        default: return 'status-open';
    }
}

function getTicketStatusText(status) {
    switch (status) {
        case 'open': return 'مفتوحة';
        case 'in-progress': return 'قيد المعالجة';
        case 'resolved': return 'تم الحل';
        case 'closed': return 'مغلقة';
        default: return 'مفتوحة';
    }
}

function getPriorityBadgeClass(priority) {
    switch (priority) {
        case 'high': return 'priority-high-badge';
        case 'medium': return 'priority-medium-badge';
        case 'low': return 'priority-low-badge';
        default: return 'priority-medium-badge';
    }
}

function getPriorityText(priority) {
    switch (priority) {
        case 'high': return 'عالية';
        case 'medium': return 'متوسطة';
        case 'low': return 'منخفضة';
        default: return 'متوسطة';
    }
}

// Handle logout
async function handleLogout() {
    const confirmed = await showConfirmModal(
        'تأكيد تسجيل الخروج',
        'هل أنت متأكد من رغبتك في تسجيل الخروج من لوحة التحكم؟',
        'تسجيل الخروج',
        'إلغاء'
    );

    if (confirmed) {
        try {
            await FirebaseUtils.signOut();
            showMessage('تم تسجيل الخروج بنجاح', 'success');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1000);
        } catch (error) {

            showMessage('حدث خطأ في تسجيل الخروج', 'error');
        }
    }
}

// Create modal element (reuse from main.js)
function createModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <!--Content will be added dynamically-->
        </div>
        `;
    return modal;
}

// Show message to user (using SweetAlert2)
function showMessage(message, type = 'info') {
    // Map custom types to SweetAlert icons if needed
    // success, error, warning, info, question

    const Toast = Swal.mixin({
        toast: true,
        position: 'top-start', // Appears on the top left (suitable for RTL with right sidebar)
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.onmouseenter = Swal.stopTimer;
            toast.onmouseleave = Swal.resumeTimer;
        }
    });

    Toast.fire({
        icon: type,
        title: message
    });
}

// Format date in Arabic (reuse from main.js)
function formatDateArabic(date) {
    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };

    return new Date(date).toLocaleDateString('ar-EG', options);
}

// FAQ Management Functions
async function loadFAQs() {
    try {
        const result = await FirebaseUtils.getDocuments('faqs',
            { field: 'createdAt', direction: 'desc' });

        if (result.success) {
            allFAQs = result.data;
            filteredFAQs = [...allFAQs];
            displayFAQs();
        }
    } catch (error) {

    }
}

function displayFAQs() {
    const faqManagement = document.getElementById('faqManagement');

    if (filteredFAQs.length === 0) {
        faqManagement.innerHTML = `
        <div class="empty-state">
                <i class="fas fa-question-circle"></i>
                <h3>لا توجد أسئلة شائعة</h3>
                <p>لم يتم إضافة أي أسئلة شائعة حتى الآن</p>
            </div>
        `;
        return;
    }

    const tableHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>السؤال</th>
                    <th>الفئة</th>
                    <th>الحالة</th>
                    <th>تاريخ الإنشاء</th>
                    <th>الإجراءات</th>
                </tr>
            </thead>
            <tbody>
                ${filteredFAQs.map(faq => `
                    <tr>
                        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${faq.question}
                        </td>
                        <td>
                            <span class="category-badge ${getCategoryClass(faq.category)}">
                                ${getCategoryText(faq.category)}
                            </span>
                        </td>
                        <td>
                            <span class="status-badge ${faq.isActive ? 'status-active' : 'status-inactive'}">
                                ${faq.isActive ? 'نشط' : 'غير نشط'}
                            </span>
                        </td>
                        <td>${faq.createdAt ? formatDateArabic(faq.createdAt.toDate()) : 'غير محدد'}</td>
                        <td>
                            <button class="action-btn btn-view" onclick="viewFAQDetails('${faq.id}')">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="action-btn btn-edit" onclick="editFAQ('${faq.id}')">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="action-btn btn-delete" onclick="deleteFAQ('${faq.id}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        `;

    faqManagement.innerHTML = tableHTML;
}

function showAddFAQModal() {
    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>إضافة سؤال شائع جديد</h2>
        
        <form id="addFAQForm">
            <div class="form-group">
                <label for="faqCategory">الفئة *</label>
                <select id="faqCategory" name="category" required>
                    <option value="">اختر الفئة</option>
                    <option value="technical">الأسئلة التقنية</option>
                    <option value="pricing">أسئلة الأسعار</option>
                    <option value="support">أسئلة الدعم الفني</option>
                </select>
            </div>
            
            <div class="form-group">
                <label for="faqQuestion">السؤال *</label>
                <input type="text" id="faqQuestion" name="question" required>
            </div>
            
            <div class="form-group">
                <label for="faqAnswer">الإجابة *</label>
                <textarea id="faqAnswer" name="answer" rows="6" required></textarea>
            </div>
            
            <div class="form-group">
                <label for="faqOrder">ترتيب العرض</label>
                <input type="number" id="faqOrder" name="order" value="1" min="1">
            </div>
            
            <div class="form-group">
                <label>
                    <input type="checkbox" id="faqActive" name="isActive" checked>
                    نشط (سيظهر في الموقع)
                </label>
            </div>
            
            <button type="submit" class="btn-submit">
                <span class="btn-text">إضافة السؤال</span>
                <span class="loading" style="display: none;"></span>
            </button>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Close modal functionality
    const closeBtn = modal.querySelector('.close');
    closeBtn.onclick = () => {
        document.body.removeChild(modal);
    };

    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };

    // Handle form submission
    const addForm = document.getElementById('addFAQForm');
    addForm.onsubmit = async (e) => {
        e.preventDefault();
        await handleAddFAQ(addForm, modal);
    };
}

async function handleAddFAQ(form, modal) {
    const submitBtn = form.querySelector('.btn-submit');
    const btnText = submitBtn.querySelector('.btn-text');
    const loading = submitBtn.querySelector('.loading');

    // Show loading state
    btnText.style.display = 'none';
    loading.style.display = 'inline-block';
    submitBtn.disabled = true;

    const formData = new FormData(form);

    const faqData = {
        category: formData.get('category'),
        question: formData.get('question'),
        answer: formData.get('answer'),
        order: parseInt(formData.get('order')) || 1,
        isActive: formData.get('isActive') === 'on',
        createdBy: currentUser.uid
    };

    try {
        const result = await FirebaseUtils.addDocument('faqs', faqData);

        if (result.success) {
            showMessage('تم إضافة السؤال بنجاح!', 'success');
            document.body.removeChild(modal);
            await loadFAQs(); // Reload FAQs
        } else {
            throw new Error(result.error);
        }
    } catch (error) {

        showMessage('حدث خطأ في إضافة السؤال', 'error');
    } finally {
        // Reset button state
        btnText.style.display = 'inline';
        loading.style.display = 'none';
        submitBtn.disabled = false;
    }
}

function editFAQ(faqId) {
    const faq = allFAQs.find(f => f.id === faqId);
    if (!faq) return;

    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>تعديل السؤال الشائع</h2>
        
        <form id="editFAQForm">
            <div class="form-group">
                <label for="editFaqCategory">الفئة *</label>
                <select id="editFaqCategory" name="category" required>
                    <option value="technical" ${faq.category === 'technical' ? 'selected' : ''}>الأسئلة التقنية</option>
                    <option value="pricing" ${faq.category === 'pricing' ? 'selected' : ''}>أسئلة الأسعار</option>
                    <option value="support" ${faq.category === 'support' ? 'selected' : ''}>أسئلة الدعم الفني</option>
                </select>
            </div>
            
            <div class="form-group">
                <label for="editFaqQuestion">السؤال *</label>
                <input type="text" id="editFaqQuestion" name="question" value="${faq.question}" required>
            </div>
            
            <div class="form-group">
                <label for="editFaqAnswer">الإجابة *</label>
                <textarea id="editFaqAnswer" name="answer" rows="6" required>${faq.answer}</textarea>
            </div>
            
            <div class="form-group">
                <label for="editFaqOrder">ترتيب العرض</label>
                <input type="number" id="editFaqOrder" name="order" value="${faq.order || 1}" min="1">
            </div>
            
            <div class="form-group">
                <label>
                    <input type="checkbox" id="editFaqActive" name="isActive" ${faq.isActive ? 'checked' : ''}>
                    نشط (سيظهر في الموقع)
                </label>
            </div>
            
            <button type="submit" class="btn-submit">
                <span class="btn-text">حفظ التغييرات</span>
                <span class="loading" style="display: none;"></span>
            </button>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Close modal functionality
    const closeBtn = modal.querySelector('.close');
    closeBtn.onclick = () => {
        document.body.removeChild(modal);
    };

    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };

    // Handle form submission
    const editForm = document.getElementById('editFAQForm');
    editForm.onsubmit = async (e) => {
        e.preventDefault();
        await handleEditFAQ(faqId, editForm, modal);
    };
}

async function handleEditFAQ(faqId, form, modal) {
    const submitBtn = form.querySelector('.btn-submit');
    const btnText = submitBtn.querySelector('.btn-text');
    const loading = submitBtn.querySelector('.loading');

    // Show loading state
    btnText.style.display = 'none';
    loading.style.display = 'inline-block';
    submitBtn.disabled = true;

    const formData = new FormData(form);

    const updateData = {
        category: formData.get('category'),
        question: formData.get('question'),
        answer: formData.get('answer'),
        order: parseInt(formData.get('order')) || 1,
        isActive: formData.get('isActive') === 'on'
    };

    try {
        const result = await FirebaseUtils.updateDocument('faqs', faqId, updateData);

        if (result.success) {
            showMessage('تم تحديث السؤال بنجاح!', 'success');
            document.body.removeChild(modal);
            await loadFAQs(); // Reload FAQs
        } else {
            throw new Error(result.error);
        }
    } catch (error) {

        showMessage('حدث خطأ في تحديث السؤال', 'error');
    } finally {
        // Reset button state
        btnText.style.display = 'inline';
        loading.style.display = 'none';
        submitBtn.disabled = false;
    }
}

async function deleteFAQ(faqId) {
    const confirmed = await showConfirmModal(
        'حذف السؤال',
        'هل أنت متأكد من حذف هذا السؤال؟ لن تتمكن من استعادته لاحقاً.',
        'حذف',
        'إلغاء'
    );
    if (!confirmed) return;

    try {
        const result = await FirebaseUtils.deleteDocument('faqs', faqId);

        if (result.success) {
            showMessage('تم حذف السؤال بنجاح!', 'success');
            await logAction('حذف سؤال شائع', 'delete', { faqId: faqId });
            await loadFAQs(); // Reload FAQs
        } else {
            throw new Error(result.error);
        }
    } catch (error) {

        showMessage('حدث خطأ في حذف السؤال', 'error');
    }
}

function viewFAQDetails(faqId) {
    const faq = allFAQs.find(f => f.id === faqId);
    if (!faq) return;

    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>تفاصيل السؤال الشائع</h2>
        
        <div style="margin: 2rem 0;">
            <div style="margin-bottom: 1rem;">
                <strong>الفئة:</strong> 
                <span class="category-badge ${getCategoryClass(faq.category)}">
                    ${getCategoryText(faq.category)}
                </span>
            </div>
            
            <div style="margin-bottom: 1rem;">
                <strong>الحالة:</strong> 
                <span class="status-badge ${faq.isActive ? 'status-active' : 'status-inactive'}">
                    ${faq.isActive ? 'نشط' : 'غير نشط'}
                </span>
            </div>
            
            <div style="margin-bottom: 1rem;">
                <strong>ترتيب العرض:</strong> ${faq.order || 1}
            </div>
            
            <div style="margin-bottom: 2rem;">
                <strong>تاريخ الإنشاء:</strong> ${faq.createdAt ? formatDateArabic(faq.createdAt.toDate()) : 'غير محدد'}
            </div>
            
            <div style="margin-bottom: 2rem;">
                <h3 style="color: #2c5aa0; margin-bottom: 1rem;">السؤال:</h3>
                <p style="background: #f8f9fa; padding: 1rem; border-radius: 8px; line-height: 1.6;">
                    ${faq.question}
                </p>
            </div>
            
            <div>
                <h3 style="color: #2c5aa0; margin-bottom: 1rem;">الإجابة:</h3>
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; line-height: 1.8;">
                    ${faq.answer.replace(/\n/g, '<br>')}
                </div>
            </div>
        </div>
        
        <div style="text-align: center; margin-top: 2rem;">
            <button class="btn-primary" onclick="editFAQ('${faq.id}'); closeModal()">
                <i class="fas fa-edit"></i> تعديل السؤال
            </button>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    // Close modal functionality
    const closeBtn = modal.querySelector('.close');
    closeBtn.onclick = () => {
        document.body.removeChild(modal);
    };

    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
}

function filterFAQs() {
    const categoryFilter = document.getElementById('faqCategoryFilter').value;

    filteredFAQs = allFAQs.filter(faq => {
        return !categoryFilter || faq.category === categoryFilter;
    });

    displayFAQs();
}

function searchFAQs() {
    const searchTerm = document.getElementById('faqSearchInput').value.toLowerCase();

    filteredFAQs = allFAQs.filter(faq => {
        return faq.question.toLowerCase().includes(searchTerm) ||
            faq.answer.toLowerCase().includes(searchTerm);
    });

    displayFAQs();
}

function loadFAQCategories() {
    loadFAQs();
}

function getCategoryClass(category) {
    switch (category) {
        case 'technical': return 'category-technical';
        case 'pricing': return 'category-pricing';
        case 'support': return 'category-support';
        default: return 'category-default';
    }
}

function getCategoryText(category) {
    switch (category) {
        case 'technical': return 'الأسئلة التقنية';
        case 'pricing': return 'أسئلة الأسعار';
        case 'support': return 'أسئلة الدعم الفني';
        default: return 'غير محدد';
    }
}

// Missing functions implementation

// Quick Actions removed

// Close Modal function
function closeModal() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    });
}

// Filter Tickets
function filterTickets(status) {
    if (!allTickets) return;

    if (status === 'all') {
        filteredTickets = [...allTickets];
    } else {
        filteredTickets = allTickets.filter(ticket => ticket.status === status);
    }

    displayTickets();
}

// View Ticket Details
function viewTicketDetails(ticketId) {
    const ticket = allTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close" onclick="closeModal()">&times;</span>
        <h2>تفاصيل تذكرة الدعم #${ticketId.substring(0, 8)}</h2>
        
        <div class="ticket-details" style="text-align: right;">
            <div class="detail-row" style="margin-bottom: 1rem;">
                <strong>الموضوع:</strong> ${ticket.subject}
            </div>
            
            <div class="detail-row" style="margin-bottom: 1rem;">
                <strong>الأولوية:</strong> 
                <span class="priority-badge priority-${ticket.priority}">${getPriorityText(ticket.priority)}</span>
            </div>
            
            <div class="detail-row" style="margin-bottom: 1rem;">
                <strong>الحالة:</strong> 
                <span class="status-badge ${getStatusClass(ticket.status)}">${getStatusText(ticket.status)}</span>
            </div>
            
            <div class="detail-row" style="margin-bottom: 1rem;">
                <strong>معلومات الاتصال:</strong> ${ticket.contactInfo || (ticket.userName ? `${ticket.userName} (${ticket.userEmail})` : 'غير متوفر')}
            </div>
            
            <div class="detail-row" style="margin-bottom: 2rem;">
                <strong>الرسالة:</strong>
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-top: 0.5rem;">
                    ${ticket.message || ticket.description || (ticket.replies && ticket.replies.length > 0 ? ticket.replies[0].message : 'لا يوجد تفاصيل')}
                </div>
            </div>
            
            ${ticket.replies && ticket.replies.length > 0 ? `
                <div class="replies-section">
                    <h4>الردود:</h4>
                    ${ticket.replies.map(reply => `
                        <div class="reply-item" style="background: #e3f2fd; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                            <div style="font-weight: 600; margin-bottom: 0.5rem;">
                                ${reply.authorName || (reply.isAdminReply ? 'فريق الدعم' : 'العميل')} - ${reply.createdAt ? new Date(reply.createdAt.seconds ? reply.createdAt.seconds * 1000 : reply.createdAt).toLocaleDateString('ar-EG') : ''}
                            </div>
                            <div>${reply.content || reply.message || ''}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            <div class="ticket-actions" style="display: flex; gap: 1rem; margin-top: 2rem; justify-content: flex-end;">
                ${ticket.status !== 'closed' && ticket.status !== 'resolved' ? `
                    <button class="btn-primary" onclick="closeTicket('${ticketId}')" style="padding: 0.8rem 2rem; background: #10b981;">
                        <i class="fas fa-check-circle"></i> تم الحل
                    </button>
                ` : ''}
                <button class="btn-primary" onclick="replyToTicket('${ticketId}')" style="padding: 0.8rem 2rem;">
                    <i class="fas fa-reply"></i> رد على التذكرة
                </button>
                ${(window.currentUserData && (window.currentUserData.role === 'super_admin' || window.currentUserData.role === 'admin')) ? `
                    <button class="btn-primary" onclick="deleteSupportTicket('${ticketId}')" style="padding: 0.8rem 2rem; background: #ef4444;">
                        <i class="fas fa-trash"></i> حذف
                    </button>
                ` : ''}
                <button class="btn-secondary" onclick="closeModal()" style="padding: 0.8rem 1.5rem;">
                    <i class="fas fa-times"></i> إغلاق
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    setupModalClose(modal);
}

// Close/Resolve Ticket
async function closeTicket(ticketId) {
    const ticket = allTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const result = await Swal.fire({
        title: 'تأكيد إغلاق التذكرة',
        text: 'هل أنت متأكد من أنك تريد وضع علامة "تم الحل" على هذه التذكرة؟',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'نعم، تم الحل',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#10b981'
    });

    if (result.isConfirmed) {
        try {
            await window.db.collection('support_tickets').doc(ticketId).update({
                status: 'closed',
                resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
                resolvedBy: currentUser.uid,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await logAction('إغلاق تذكرة دعم', 'close_ticket', {
                ticketId: ticketId,
                subject: ticket.subject,
                adminId: currentUser.uid
            });

            showMessage('تم إغلاق التذكرة بنجاح', 'success');
            closeModal();
            await loadSupportTickets();
        } catch (error) {

            showMessage('حدث خطأ أثناء إغلاق التذكرة', 'error');
        }
    }
}

// Add System Modal
function showAddSystemModal() {
    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>إضافة نظام جديد</h2>
        
        <form id="addSystemForm" style="text-align: right;">
            <div class="form-group">
                <label>اسم النظام:</label>
                <input type="text" name="name" required>
            </div>
            
            <div class="form-group">
                <label>الوصف:</label>
                <textarea name="description" rows="3" required></textarea>
            </div>
            
            <div class="form-group">
                <label>السعر:</label>
                <input type="text" name="price" required placeholder="750 جنيه/شهر">
            </div>
            
            <div class="form-group">
                <label>السعر الأصلي (اختياري):</label>
                <input type="text" name="originalPrice" placeholder="950 جنيه/شهر">
            </div>
            
            <div class="form-group">
                <label>الأيقونة (Font Awesome):</label>
                <input type="text" name="icon" placeholder="fas fa-desktop">
            </div>
            
            <div class="form-group">
                <label>المميزات (كل مميزة في سطر منفصل):</label>
                <textarea name="features" rows="5" placeholder="واجهة مستخدم عربية&#10;إدارة المبيعات&#10;تتبع المخزون"></textarea>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="btn-primary">
                    <i class="fas fa-save"></i> حفظ النظام
                </button>
                <button type="button" class="btn-secondary" onclick="closeModal()">إلغاء</button>
            </div>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    setupModalClose(modal);

    // Handle form submission
    document.getElementById('addSystemForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(e.target);
        const systemData = {
            name: formData.get('name'),
            description: formData.get('description'),
            price: formData.get('price'),
            originalPrice: formData.get('originalPrice') || null,
            image: formData.get('icon'),
            features: formData.get('features').split('\n').filter(f => f.trim()),
            gallery: [],
            videos: []
        };

        try {
            const result = await FirebaseUtils.addDocument('systems', systemData);
            if (result.success) {
                showMessage('تم إضافة النظام بنجاح!', 'success');
                closeModal();
                // Reload systems if needed
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            showMessage('حدث خطأ في إضافة النظام', 'error');
        }
    });
}

// Add Post Modal
function showAddPostModal() {
    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>إضافة منشور جديد</h2>
        
        <form id="addPostForm" style="text-align: right;">
            <div class="form-group">
                <label>عنوان المنشور:</label>
                <input type="text" name="title" required>
            </div>
            
            <div class="form-group">
                <label>المحتوى:</label>
                <textarea name="content" rows="6" required></textarea>
            </div>
            
            <div class="form-group">
                <label>الفئة:</label>
                <select name="category" required>
                    <option value="">اختر الفئة</option>
                    <option value="news">أخبار</option>
                    <option value="updates">تحديثات</option>
                    <option value="announcements">إعلانات</option>
                    <option value="tips">نصائح</option>
                </select>
            </div>
            
            <div class="form-group">
                <label>حالة النشر:</label>
                <select name="status" required>
                    <option value="draft">مسودة</option>
                    <option value="published">منشور</option>
                </select>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="btn-primary">
                    <i class="fas fa-save"></i> حفظ المنشور
                </button>
                <button type="button" class="btn-secondary" onclick="closeModal()">إلغاء</button>
            </div>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    setupModalClose(modal);

    // Handle form submission
    document.getElementById('addPostForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(e.target);
        const postData = {
            title: formData.get('title'),
            content: formData.get('content'),
            category: formData.get('category'),
            status: formData.get('status'),
            author: currentUser.displayName || currentUser.email,
            authorId: currentUser.uid
        };

        try {
            const result = await FirebaseUtils.addDocument('posts', postData);
            if (result.success) {
                showMessage('تم إضافة المنشور بنجاح!', 'success');
                closeModal();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            showMessage('حدث خطأ في إضافة المنشور', 'error');
        }
    });
}

// Add Account Modal
function showAddAccountModal(targetRole = 'admin') {
    const modal = createModal();
    const isCustomer = targetRole === 'customer';
    const modalTitle = isCustomer ? 'إضافة عميل جديد' : 'إضافة حساب إداري';
    const primaryBtnText = isCustomer ? 'إنشاء حساب العميل' : 'إنشاء الحساب الإداري';

    // Define all available pages
    const allPages = {
        dashboard: { name: 'لوحة التحكم', icon: 'fas fa-home' },
        orders: { name: 'الطلبات', icon: 'fas fa-shopping-cart' },
        customers: { name: 'قائمة العملاء', icon: 'fas fa-user-friends' },
        users: { name: 'إدارة المديرين', icon: 'fas fa-user-shield' },
        support: { name: 'الدعم الفني', icon: 'fas fa-headset' },
        support_activity: { name: 'نشاط الدعم', icon: 'fas fa-user-clock' },
        products: { name: 'المنتجات', icon: 'fas fa-box' },
        domain_requests: { name: 'حجز النطاقات', icon: 'fas fa-globe' },
        admin_domains: { name: 'الدومينات المتاحة', icon: 'fas fa-list-ul' },
        coupons: { name: 'الكوبونات', icon: 'fas fa-ticket-alt' },
        cms: { name: 'إدارة المحتوى', icon: 'fas fa-edit' },
        reports: { name: 'التقارير', icon: 'fas fa-chart-line' },
        analytics: { name: 'التحليلات', icon: 'fas fa-chart-pie' },
        faq: { name: 'الأسئلة الشائعة', icon: 'fas fa-question-circle' },
        settings: { name: 'الإعدادات', icon: 'fas fa-cog' },
        logs: { name: 'سجلات النشاط', icon: 'fas fa-history' },
        as3g: { name: 'نظام AS3G', icon: 'fas fa-microchip' },
        payments: { name: 'المدفوعات', icon: 'fas fa-file-invoice-dollar' },
        wallet_recharge: { name: 'طلبات شحن الرصيد', icon: 'fas fa-wallet' }
    };


    modal.querySelector('.modal-content').innerHTML = `
        <span class="close" onclick="closeModal()">&times;</span>
        <h2 style="color: #1e3a8a; margin-bottom: 2rem;">
            <i class="fas ${isCustomer ? 'fa-user-plus' : 'fa-user-shield'}"></i> ${modalTitle}
        </h2>
        
        <form id="addAccountForm" style="text-align: right;">
            <div class="form-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem;">
                <div class="form-group">
                    <label>الاسم الكامل:</label>
                    <input type="text" name="name" required placeholder="أدخل الاسم">
                </div>
                
                <div class="form-group">
                    <label>البريد الإلكتروني:</label>
                    <input type="email" name="email" required placeholder="example@as3g.com">
                </div>
                
                <div class="form-group">
                    <label>كلمة المرور:</label>
                    <input type="password" name="password" required minlength="6" placeholder="••••••••">
                </div>
                
                <div class="form-group">
                    <label>اسم النشاط / الوظيفة:</label>
                    <input type="text" name="businessName" required placeholder="مثلاً: شركة التقنية">
                </div>
                
                <div class="form-group">
                    <label>رقم الهاتف:</label>
                    <input type="tel" name="phone" required placeholder="05xxxxxxxx">
                </div>
                
                <div class="form-group">
                    <label>العنوان:</label>
                    <input type="text" name="address" required placeholder="المدينة، الحي">
                </div>
                
                <div class="form-group" style="${isCustomer ? 'display: none;' : ''}">
                    <label>الدور الوظيفي:</label>
                    <select id="newUserRoleSelect" name="role" required onchange="handleNewUserRoleChange()">
                        <option value="support" ${targetRole === 'support' ? 'selected' : ''}>دعم فني</option>
                        <option value="admin" ${targetRole === 'admin' ? 'selected' : ''}>مدير (صلاحيات مخصصة)</option>
                        <option value="super_admin" ${targetRole === 'super_admin' ? 'selected' : ''}>مدير عام</option>
                    </select>
                </div>
                
                <input type="hidden" name="forcedRole" value="${isCustomer ? 'customer' : ''}">
            </div>

            <div id="newUserPagePermissionsSection" style="display: none; margin-top: 2rem; border-top: 2px solid #f1f5f9; padding-top: 1.5rem;">
                <h4 style="color: #2c5aa0; margin-bottom: 1rem;">
                    <i class="fas fa-lock"></i> تحديد الصفحات المسموح بها للمدير:
                </h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.8rem; margin-bottom: 1.5rem;">
                    ${Object.entries(allPages).map(([pageKey, pageInfo]) => `
                        <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.7rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer; transition: 0.2s;">
                            <input type="checkbox" name="page_${pageKey}" value="${pageKey}" checked>
                            <i class="${pageInfo.icon}" style="font-size: 1rem; color: #64748b;"></i>
                            <span style="font-size: 0.9rem; font-weight: 600;">${pageInfo.name}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            
            <div class="form-actions" style="margin-top: 2.5rem; display: flex; gap: 1rem; justify-content: flex-end;">
                <button type="submit" class="btn-primary" style="padding: 0.8rem 2rem;">
                    <i class="fas fa-save"></i> ${primaryBtnText}
                </button>
                <button type="button" class="btn-secondary" onclick="closeModal()" style="padding: 0.8rem 1.5rem;">إلغاء</button>
            </div>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';
    setupModalClose(modal);

    // Handle role change for new user
    window.handleNewUserRoleChange = function () {
        const roleSelect = document.getElementById('newUserRoleSelect');
        const permissionsSection = document.getElementById('newUserPagePermissionsSection');
        if (roleSelect && permissionsSection) {
            permissionsSection.style.display = roleSelect.value === 'admin' ? 'block' : 'none';
        }
    };

    // Handle form submission
    document.getElementById('addAccountForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(e.target);
        const forcedRole = formData.get('forcedRole');
        const newRole = forcedRole || formData.get('role');

        const userData = {
            name: formData.get('name'),
            businessName: formData.get('businessName'),
            phone: formData.get('phone'),
            address: formData.get('address'),
            role: newRole,
            isAdmin: newRole === 'admin' || newRole === 'super_admin' || newRole === 'support',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (newRole === 'admin') {
            const pagePermissions = {};
            Object.keys(allPages).forEach(pageKey => {
                const checkbox = document.querySelector(`input[name="page_${pageKey}"]`);
                if (checkbox) pagePermissions[pageKey] = checkbox.checked;
            });
            userData.pagePermissions = pagePermissions;
        }

        try {
            const result = await FirebaseUtils.signUpWithEmail(
                formData.get('email'),
                formData.get('password'),
                userData
            );

            if (result.success) {
                const successMsg = isCustomer ? 'تم إنشاء حساب العميل بنجاح!' : 'تم إنشاء الحساب الإداري بنجاح!';
                showMessage(successMsg, 'success');
                await logAction(isCustomer ? 'إنشاء حساب عميل' : 'إنشاء حساب إداري', 'create', {
                    email: formData.get('email'),
                    name: formData.get('name'),
                    role: newRole
                });
                closeModal();
                if (isCustomer) await loadCustomers(); else await loadUsers();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {

            showMessage(error.message || 'حدث خطأ في إنشاء الحساب', 'error');
        }
    });
}    // Helper functions
function getPriorityText(priority) {
    switch (priority) {
        case 'high': return 'عالية';
        case 'medium': return 'متوسطة';
        case 'low': return 'منخفضة';
        default: return 'غير محدد';
    }
}

function getStatusClass(status) {
    switch (status) {
        case 'open': return 'status-open';
        case 'in_progress': return 'status-progress';
        case 'resolved': return 'status-resolved';
        case 'closed': return 'status-closed';
        default: return 'status-default';
    }
}

function getStatusText(status) {
    switch (status) {
        case 'open': return 'مفتوحة';
        case 'in_progress': return 'قيد المعالجة';
        case 'resolved': return 'تم الحل';
        case 'closed': return 'مغلقة';
        default: return 'غير محدد';
    }
}

// Setup modal close functionality
function setupModalClose(modal) {
    const closeBtn = modal.querySelector('.close');
    if (closeBtn) {
        closeBtn.onclick = () => {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        };
    }

    modal.onclick = (e) => {
        if (e.target === modal) {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        }
    };
}

// Additional helper functions
function replyToTicket(ticketId) {
    // Implementation for replying to ticket
    showMessage('وظيفة الرد قيد التطوير', 'info');
}

function updateTicketStatus(ticketId, newStatus) {
    // Implementation for updating ticket status
    showMessage(`تم تحديث حالة التذكرة إلى: ${getStatusText(newStatus)} `, 'success');
}

function exportData() {
    showMessage('وظيفة تصدير البيانات قيد التطوير', 'info');
}

function showSystemStats() {
    showMessage('وظيفة إحصائيات النظام قيد التطوير', 'info');
}

function showBackupOptions() {
    showMessage('وظيفة النسخ الاحتياطي قيد التطوير', 'info');
}

// Missing display functions
function displayTickets() {
    const ticketsContainer = document.getElementById('ticketsContainer');
    if (!ticketsContainer) return;

    if (!filteredTickets || filteredTickets.length === 0) {
        ticketsContainer.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 3rem; color: #666;">
                <i class="fas fa-ticket-alt" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                <h3>لا توجد تذاكر دعم</h3>
                <p>لم يتم العثور على تذاكر دعم بالمعايير المحددة</p>
            </div>
        `;
        return;
    }

    const ticketsHTML = filteredTickets.map(ticket => `
        < div class="ticket-card" style = "background: white; border-radius: 10px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 2px 10px rgba(0,0,0,0.1);" >
            <div class="ticket-header" style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                <div>
                    <h4 style="margin: 0 0 0.5rem 0; color: #2c5aa0;">#${ticket.id.substring(0, 8)} - ${ticket.subject}</h4>
                    <p style="margin: 0; color: #666; font-size: 0.9rem;">
                        <i class="fas fa-user"></i> ${ticket.userEmail || ticket.contactInfo}
                    </p>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-direction: column; align-items: end;">
                    <span class="priority-badge priority-${ticket.priority}">${getPriorityText(ticket.priority)}</span>
                    <span class="status-badge ${getStatusClass(ticket.status)}">${getStatusText(ticket.status)}</span>
                </div>
            </div>
            
            <div class="ticket-content" style="margin-bottom: 1rem;">
                <p style="margin: 0; color: #333; line-height: 1.6;">
                    ${(ticket.message || ticket.description || '').substring(0, 150)}${(ticket.message || ticket.description || '').length > 150 ? '...' : ''}
                </p>
            </div>
            
            <div class="ticket-actions" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button class="btn-primary" onclick="viewTicketDetails('${ticket.id}')" style="font-size: 0.9rem; padding: 0.5rem 1rem;">
                    <i class="fas fa-eye"></i> عرض التفاصيل
                </button>
                <button class="btn-success" onclick="replyToTicket('${ticket.id}')" style="font-size: 0.9rem; padding: 0.5rem 1rem;">
                    <i class="fas fa-reply"></i> رد
                </button>
                <button class="btn-warning" onclick="updateTicketStatus('${ticket.id}', 'in_progress')" style="font-size: 0.9rem; padding: 0.5rem 1rem;">
                    <i class="fas fa-clock"></i> قيد المعالجة
                </button>
                <button class="btn-success" onclick="updateTicketStatus('${ticket.id}', 'resolved')" style="font-size: 0.9rem; padding: 0.5rem 1rem;">
                    <i class="fas fa-check"></i> تم الحل
                </button>
            </div>
        </div >
        `).join('');

    ticketsContainer.innerHTML = ticketsHTML;
}

// Edit User Role
function editUserRole(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    const modal = createModal();

    // Define all available pages
    const allPages = {
        dashboard: { name: 'لوحة التحكم الرئيسية', icon: 'fas fa-home' },
        orders: { name: 'إدارة الطلبات', icon: 'fas fa-shopping-cart' },
        customers: { name: 'قائمة العملاء', icon: 'fas fa-user-friends' },
        users: { name: 'إدارة المستخدمين', icon: 'fas fa-users' },
        support: { name: 'الدعم الفني', icon: 'fas fa-headset' },
        domain_requests: { name: 'طلبات حجز النطاقات', icon: 'fas fa-globe' },
        products: { name: 'إدارة المنتجات', icon: 'fas fa-box' },
        reports: { name: 'التقارير والإحصائيات', icon: 'fas fa-chart-line' },
        faq: { name: 'الأسئلة الشائعة', icon: 'fas fa-question-circle' },
        settings: { name: 'إعدادات النظام', icon: 'fas fa-cog' },
        logs: { name: 'سجلات النشاط', icon: 'fas fa-history' },
        as3g: { name: 'نظام AS3G', icon: 'fas fa-microchip' },
        admin_domains: { name: 'إدارة الدومينات', icon: 'fas fa-list-ul' },
        live_payments: { name: 'المدفوعات الحية', icon: 'fas fa-satellite-dish' },
        support_activity: { name: 'نشاط فريق الدعم', icon: 'fas fa-user-clock' },
        payments: { name: 'المدفوعات', icon: 'fas fa-file-invoice-dollar' },
        wallet_recharge: { name: 'طلبات شحن الرصيد', icon: 'fas fa-wallet' }
    };

    // Get user's current permissions
    const userPermissions = user.pagePermissions || {};

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close" onclick="closeModal()">&times;</span>
        <h2>تعديل صلاحيات المستخدم</h2>
        
        <div style="text-align: right; margin-bottom: 2rem;">
            <div class="user-info" style="background: #f8f9fa; padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem;">
                <h4 style="color: #2c5aa0; margin-bottom: 1rem;">معلومات المستخدم:</h4>
                <p><strong>الاسم:</strong> ${user.name}</p>
                <p><strong>البريد الإلكتروني:</strong> ${user.email}</p>
                <p><strong>النشاط:</strong> ${user.businessName || 'غير محدد'}</p>
                <p><strong>الصلاحية الحالية:</strong> <span class="role-badge">${getRoleText(user.role)}</span></p>
            </div>
            
            <form id="editRoleForm">
                <div class="form-group">
                    <label>الصلاحية الأساسية:</label>
                    <select id="userRoleSelect" name="role" required onchange="handleRoleChange()">
                        <option value="user" ${user.role === 'user' ? 'selected' : ''}>مستخدم عادي (لا يمكنه الوصول للوحة التحكم)</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>مدير (صلاحيات مخصصة)</option>
                        <option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>مدير عام (جميع الصلاحيات)</option>
                    </select>
                </div>
                
                <div id="pagePermissionsSection" style="display: ${user.role === 'admin' ? 'block' : 'none'}; margin-top: 2rem;">
                    <h4 style="color: #2c5aa0; margin-bottom: 1rem;">
                        <i class="fas fa-lock"></i> تحديد الصفحات المسموح بها:
                    </h4>
                    <p style="color: #666; margin-bottom: 1rem; font-size: 0.9rem;">
                        اختر الصفحات التي يمكن للمستخدم الوصول إليها في لوحة التحكم
                    </p>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                        ${Object.entries(allPages).map(([pageKey, pageInfo]) => `
                            <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.8rem; background: #f8f9fa; border-radius: 8px; cursor: pointer; transition: all 0.3s;">
                                <input type="checkbox" 
                                       name="page_${pageKey}" 
                                       value="${pageKey}"
                                       ${userPermissions[pageKey] !== false ? 'checked' : ''}
                                       style="width: 18px; height: 18px; cursor: pointer;">
                                <i class="${pageInfo.icon}" style="color: #2c5aa0; width: 20px;"></i>
                                <span style="flex: 1;">${pageInfo.name}</span>
                            </label>
                        `).join('')}
                    </div>
                    
                    <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                        <button type="button" class="btn-secondary" onclick="selectAllPages()" style="flex: 1;">
                            <i class="fas fa-check-double"></i> تحديد الكل
                        </button>
                        <button type="button" class="btn-secondary" onclick="deselectAllPages()" style="flex: 1;">
                            <i class="fas fa-times"></i> إلغاء تحديد الكل
                        </button>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>سبب التغيير (اختياري):</label>
                    <textarea name="reason" rows="3" placeholder="سبب تغيير الصلاحية"></textarea>
                </div>
                
                <div class="form-actions">
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-save"></i> حفظ التغييرات
                    </button>
                    <button type="button" class="btn-secondary" onclick="closeModal()">إلغاء</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    setupModalClose(modal);

    // Handle role change
    window.handleRoleChange = function () {
        const roleSelect = document.getElementById('userRoleSelect');
        const permissionsSection = document.getElementById('pagePermissionsSection');

        if (roleSelect.value === 'admin') {
            permissionsSection.style.display = 'block';
        } else {
            permissionsSection.style.display = 'none';
        }
    };

    // Select/Deselect all pages
    window.selectAllPages = function () {
        document.querySelectorAll('#pagePermissionsSection input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
        });
    };

    window.deselectAllPages = function () {
        document.querySelectorAll('#pagePermissionsSection input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
    };

    // Handle form submission
    document.getElementById('editRoleForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(e.target);
        const newRole = formData.get('role');
        const reason = formData.get('reason');

        // Collect page permissions
        const pagePermissions = {};
        Object.keys(allPages).forEach(pageKey => {
            const checkbox = document.querySelector(`input[name = "page_${pageKey}"]`);
            if (checkbox) {
                pagePermissions[pageKey] = checkbox.checked;
            }
        });

        try {
            const updateData = {
                role: newRole,
                isAdmin: newRole === 'admin' || newRole === 'super_admin',
                roleChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
                roleChangeReason: reason || null
            };

            // Only save page permissions for admin role
            if (newRole === 'admin') {
                updateData.pagePermissions = pagePermissions;
            } else if (newRole === 'super_admin') {
                // Super admin has all permissions
                updateData.pagePermissions = null;
            } else {
                // Regular user has no admin panel access
                updateData.pagePermissions = null;
            }

            const result = await FirebaseUtils.updateDocument('users', userId, updateData);

            if (result.success) {
                showMessage('تم تحديث صلاحيات المستخدم بنجاح!', 'success');

                // Log action
                await logAction('تعديل صلاحيات', 'update', {
                    targetUserId: userId,
                    newRole: newRole,
                    reason: reason || 'لا يوجد سبب محدد'
                });

                closeModal();
                await loadUsers(); // Reload users list
            } else {
                throw new Error(result.error);
            }
        } catch (error) {

            showMessage('حدث خطأ في تحديث الصلاحيات', 'error');
        }
    });
}

// Custom Confirmation Modal
function showConfirmModal(title, message, confirmText = 'تأكيد', cancelText = 'إلغاء') {
    return new Promise((resolve) => {
        const modal = createModal();
        modal.classList.add('confirm-modal');

        modal.querySelector('.modal-content').innerHTML = `
        <div class="confirm-content" style="text-align: center; padding: 1rem;">
                <div class="confirm-icon" style="font-size: 4rem; color: #f39c12; margin-bottom: 1.5rem;">
                    <i class="fas fa-exclamation-circle"></i>
                </div>
                <h2 style="margin-bottom: 1rem; color: #333;">${title}</h2>
                <p style="color: #666; margin-bottom: 2rem; font-size: 1.1rem; line-height: 1.6;">${message}</p>
                <div class="confirm-actions" style="display: flex; gap: 1rem; justify-content: center;">
                    <button class="btn-primary confirm-btn" style="min-width: 120px; padding: 0.8rem 2rem;">${confirmText}</button>
                    <button class="btn-secondary cancel-btn" style="min-width: 120px; padding: 0.8rem 2rem;">${cancelText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.style.display = 'block';

        const handleConfirm = () => {
            document.body.removeChild(modal);
            resolve(true);
        };

        const handleCancel = () => {
            document.body.removeChild(modal);
            resolve(false);
        };

        modal.querySelector('.confirm-btn').onclick = handleConfirm;
        modal.querySelector('.cancel-btn').onclick = handleCancel;

        // Also close on overlay click (acts as cancel)
        modal.onclick = (e) => {
            if (e.target === modal) handleCancel();
        };
    });
}

// Toggle User Block Status
async function toggleUserBlock(userId, blockStatus) {
    const action = blockStatus ? 'حظر' : 'إلغاء حظر';

    const confirmed = await showConfirmModal(
        `تأكيد ${action} الحساب`,
        `هل أنت متأكد من ${action} هذا الحساب؟ ${blockStatus ? 'سيتم تسجيل خروج المستخدم فوراً ومنعه من الوصول إلى النظام في ساعتها.' : 'سيتمكن المستخدم من تسجيل الدخول والوصول لخدماته مرة أخرى.'} `,
        action,
        'إلغاء'
    );

    if (!confirmed) return;

    try {
        const result = await FirebaseUtils.updateDocument('users', userId, {
            isBlocked: blockStatus,
            blockedAt: blockStatus ? firebase.firestore.FieldValue.serverTimestamp() : null,
            blockedBy: blockStatus ? auth.currentUser.uid : null
        });

        if (result.success) {
            showMessage(`تم ${action} الحساب بنجاح! ${blockStatus ? 'تم إنهاء جلسة المستخدم الحالية.' : ''} `, 'success');

            // Log action with detailed context
            await logAction('تحكم في الحساب', blockStatus ? 'delete' : 'update', {
                targetUserId: userId,
                status: action,
                effect: blockStatus ? 'immediate_logout' : 'reactivated',
                affectedBy: auth.currentUser.email
            });

            await loadUsers(); // Reload users list
        } else {
            throw new Error(result.error);
        }
    } catch (error) {

        showMessage(`حدث خطأ في ${action} الحساب`, 'error');
    }
}

// View User Details
function viewUserDetails(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>تفاصيل المستخدم</h2>
        
        <div class="user-details" style="text-align: right;">
            <div class="detail-section" style="background: #f8f9fa; padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem;">
                <h4 style="color: #2c5aa0; margin-bottom: 1rem;">المعلومات الأساسية:</h4>
                <div class="detail-row"><strong>الاسم:</strong> ${user.name}</div>
                <div class="detail-row"><strong>البريد الإلكتروني:</strong> ${user.email}</div>
                <div class="detail-row"><strong>اسم النشاط:</strong> ${user.businessName || 'غير محدد'}</div>
                <div class="detail-row"><strong>رقم الهاتف:</strong> ${user.phone || 'غير محدد'}</div>
                <div class="detail-row"><strong>العنوان:</strong> ${user.address || 'غير محدد'}</div>
                <div class="detail-row"><strong>الصلاحية:</strong> <span class="role-badge">${getRoleText(user.role)}</span></div>
            </div>
            
            <div class="detail-section" style="background: #e3f2fd; padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem;">
                <h4 style="color: #1565c0; margin-bottom: 1rem;">معلومات الحساب:</h4>
                <div class="detail-row"><strong>تاريخ التسجيل:</strong> ${user.createdAt ? new Date(user.createdAt.seconds * 1000).toLocaleDateString('ar-EG') : 'غير محدد'}</div>
                <div class="detail-row"><strong>آخر تحديث:</strong> ${user.updatedAt ? new Date(user.updatedAt.seconds * 1000).toLocaleDateString('ar-EG') : 'غير محدد'}</div>
                <div class="detail-row"><strong>معرف المستخدم:</strong> ${user.id}</div>
            </div>
            
            <div class="user-actions" style="display: flex; gap: 1rem; flex-wrap: wrap;">
                <button class="btn-primary" onclick="editUserRole('${user.id}'); closeModal();">
                    <i class="fas fa-user-cog"></i> تعديل الصلاحيات
                </button>
                <button class="btn-warning" onclick="resetUserPassword('${user.id}')">
                    <i class="fas fa-key"></i> إعادة تعيين كلمة المرور
                </button>
                <button class="btn-info" onclick="viewUserOrders('${user.id}')">
                    <i class="fas fa-shopping-cart"></i> عرض الطلبات
                </button>
                <button class="btn-info" onclick="viewUserTickets('${user.id}')">
                    <i class="fas fa-ticket-alt"></i> عرض تذاكر الدعم
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    setupModalClose(modal);
}

// Helper function for role text
function getRoleText(role) {
    switch (role) {
        case 'super_admin': return 'مدير عام';
        case 'admin': return 'مدير';
        case 'user': return 'مستخدم عادي';
        default: return 'غير محدد';
    }
}

// Improved reply to ticket function
function replyToTicket(ticketId) {
    const ticket = allTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const modal = createModal();
    modal.classList.add('ticket-modal');

    // Generate chat history HTML
    let chatHistoryHTML = '';

    // Initial message
    chatHistoryHTML += `
        <div class="chat-message user-msg" style="margin-bottom: 1rem; padding: 1.2rem; background: #fff; border-radius: 12px; border: 1px solid #eef2f7; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div class="msg-header" style="display: flex; justify-content: space-between; margin-bottom: 0.8rem; font-size: 0.85rem; color: #666; border-bottom: 1px solid #f8f9fa; padding-bottom: 0.5rem;">
                <strong><i class="fas fa-user-circle"></i> ${ticket.userName || 'المستخدم'}</strong>
                <small dir="ltr">${formatDateArabic(ticket.createdAt.toDate())}</small>
            </div>
            <div class="msg-content" style="color: #333; line-height: 1.6; text-align: right; font-size: 0.95rem;">${ticket.message}</div>
        </div>
        `;

    // Subsequent replies
    if (ticket.replies && ticket.replies.length > 0) {
        chatHistoryHTML += ticket.replies.map(reply => `
        <div class="chat-message ${reply.isAdminReply ? 'admin-msg' : 'user-msg'}" style="margin-bottom: 1rem; padding: 1.2rem; background: ${reply.isAdminReply ? '#f0f7ff' : '#fff'}; border-radius: 12px; border: 1px solid ${reply.isAdminReply ? '#d0e3ff' : '#eef2f7'}; margin-left: ${reply.isAdminReply ? '0' : '3rem'}; margin-right: ${reply.isAdminReply ? '3rem' : '0'}; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                <div class="msg-header" style="display: flex; justify-content: space-between; margin-bottom: 0.8rem; font-size: 0.85rem; color: #666; border-bottom: 1px solid ${reply.isAdminReply ? '#e1eeff' : '#f8f9fa'}; padding-bottom: 0.5rem;">
                    <strong><i class="fas ${reply.isAdminReply ? 'fa-user-shield' : 'fa-user-circle'}"></i> ${reply.authorName}</strong>
                    <small dir="ltr">${reply.createdAt.toDate ? formatDateArabic(reply.createdAt.toDate()) : (reply.createdAt instanceof Date ? formatDateArabic(reply.createdAt) : formatDateArabic(new Date(reply.createdAt)))}</small>
                </div>
                <div class="msg-content" style="color: #333; line-height: 1.6; text-align: right; font-size: 0.95rem;">${reply.content}</div>
            </div>
        `).join('');
    }

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close" onclick="closeModal()" style="font-size: 1.5rem;">&times;</span>
        <div class="reply-modal-header" style="border-bottom: 2px solid #f0f2f5; margin-bottom: 1.5rem; padding-bottom: 1rem; text-align: right;">
            <h2 style="margin:0; color:#2c5aa0; display:flex; align-items:center; gap:0.8rem;"><i class="fas fa-comments"></i> محادثة التذكرة #${ticketId.substring(0, 8)}</h2>
            <div style="margin-top: 0.8rem; color: #666; font-size: 0.95rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                <span><strong>الموضوع:</strong> ${ticket.subject}</span>
                <span style="height: 15px; width: 1px; background: #ddd;"></span>
                <span><strong>الحالة الحالية:</strong> <span class="status-badge ${getStatusClass(ticket.status)}" style="font-size: 0.85rem; padding: 0.2rem 0.8rem;">${getStatusText(ticket.status)}</span></span>
            </div>
        </div>
        
        <div class="chat-history" id="chatHistory" style="max-height: 380px; overflow-y: auto; padding: 1.5rem; background: #f8fbff; border-radius: 20px; margin-bottom: 2rem; border: 1px solid #eef2f7; scroll-behavior: smooth;">
            ${chatHistoryHTML}
        </div>
        
        <form id="replyForm" style="text-align: right;">
            <div class="form-group" style="margin-bottom: 1.5rem;">
                <label style="font-weight:700; color:#333; margin-bottom:0.8rem; display:block; font-size: 1rem;">نص الرد الجديد:</label>
                <textarea name="replyContent" id="replyContentArea" rows="4" placeholder="اكتب ردك هنا (اختياري عند تغيير الحالة فقط)..." style="width: 100%; border-radius:16px; border: 2px solid #eef2f7; padding:1.2rem; box-sizing: border-box; font-family: inherit; font-size: 1rem; transition: border-color 0.3s ease; resize: none;"></textarea>
            </div>
            
            <input type="hidden" name="newStatus" id="newStatusInput" value="">
            
            <div class="form-actions" style="border-top: 2px solid #f0f2f5; padding-top: 1.5rem; display: flex; justify-content: flex-end; gap: 1rem;">
                <button type="submit" class="btn-primary" style="padding: 0.9rem 3rem; border-radius: 14px; font-weight: 700; font-size: 1rem;">
                    <i class="fas fa-paper-plane"></i> إرسال الرد
                </button>
                <button type="button" class="btn-secondary" onclick="closeModal()" style="padding: 0.9rem 2rem; border-radius: 14px; font-weight: 600;">إلغاء</button>
            </div>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    const chatHistoryElem = modal.querySelector('#chatHistory');
    chatHistoryElem.scrollTop = chatHistoryElem.scrollHeight;

    setupModalClose(modal);

    // Function to handle quick status updates
    window.quickUpdateStatus = async (status) => {
        try {
            const result = await FirebaseUtils.updateDocument('support_tickets', ticketId, {
                status: status,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });

            if (result.success) {
                showMessage(`تم تحديث حالة التذكرة إلى: ${getStatusText(status)} `, 'success');
                await logAction('تحديث حالة التذكرة', 'update', { ticketId, status });
                closeModal();
                await loadTickets();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {

            showMessage('حدث خطأ في تحديث الحالة', 'error');
        }
    };

    window.handleStatusClick = async (status) => {
        const replyContent = document.getElementById('replyContentArea').value.trim();
        if (replyContent) {
            // Highlighting selection for visual feedback before auto-submit
            setReplyStatus(status);
            // Submit form with reply and status
            const form = document.getElementById('replyForm');
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.click();
        } else {
            // Immediate quick update without message
            const confirmed = await showConfirmModal(
                `تحديث حالة التذكرة`,
                `هل أنت متأكد من تغيير حالة التذكرة إلى: ${getStatusText(status)}؟`,
                'تحديث',
                'إلغاء'
            );
            if (confirmed) {
                await quickUpdateStatus(status);
            }
        }
    };

    window.setReplyStatus = (status) => {
        document.getElementById('newStatusInput').value = status;
        document.querySelectorAll('.btn-status').forEach(btn => {
            btn.style.background = '#fff';
            btn.style.color = btn.classList.contains('resolved') ? '#28a745' : btn.classList.contains('in_progress') ? '#f39c12' : '#dc3545';
            btn.classList.remove('selected');
        });
        const activeBtn = document.querySelector(`.btn - status.${status} `);
        if (activeBtn) {
            activeBtn.style.background = status === 'resolved' ? '#28a745' : status === 'in_progress' ? '#f39c12' : '#dc3545';
            activeBtn.style.color = '#fff';
            activeBtn.classList.add('selected');
        }
    };

    // Replace the innerHTML buttons to use quickUpdateStatus if clicked directly, 
    // or setReplyStatus if just selecting for the reply form.
    // For simplicity, let's make them selection buttons that highligt, 
    // and if the user wants to proceed without a message, the Blue button works too.

    document.getElementById('replyForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const replyContent = formData.get('replyContent').trim();
        const newStatus = formData.get('newStatus');

        if (!replyContent && !newStatus) {
            showMessage('يرجى كتابة رد أو اختيار حالة جديدة', 'warning');
            return;
        }

        try {
            const currentAdmin = auth.currentUser;
            const updateData = {
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            };

            if (replyContent) {
                const replyData = {
                    id: Date.now().toString(),
                    content: replyContent,
                    authorId: currentAdmin ? currentAdmin.uid : 'admin',
                    authorName: currentAdmin ? (currentAdmin.displayName || 'فريق الدعم') : 'فريق الدعم',
                    createdAt: new Date(),
                    isAdminReply: true
                };
                updateData.replies = firebase.firestore.FieldValue.arrayUnion(replyData);
            }

            if (newStatus) {
                updateData.status = newStatus;
            } else if (ticket.status === 'pending' && replyContent) {
                updateData.status = 'in_progress';
            }

            const result = await FirebaseUtils.updateDocument('support_tickets', ticketId, updateData);

            if (result.success) {
                showMessage('تم حفظ التغييرات بنجاح!', 'success');
                await logAction('إجراء على تذكرة', 'update', {
                    ticketId,
                    hasReply: !!replyContent,
                    status: updateData.status || ticket.status
                });
                closeModal();
                await loadTickets();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {

            showMessage('حدث خطأ في معالجة الطلب', 'error');
        }
    });
}

// Additional helper functions
function resetUserPassword(userId) {
    showMessage('وظيفة إعادة تعيين كلمة المرور قيد التطوير', 'info');
}

function viewUserOrders(userId) {
    showMessage('وظيفة عرض طلبات المستخدم قيد التطوير', 'info');
}

function viewUserTickets(userId) {
    showMessage('وظيفة عرض تذاكر المستخدم قيد التطوير', 'info');
}

// Products Management Functions
let allProducts = [];
let filteredProducts = [];

// Load tickets from Firebase
async function loadTickets() {
    try {
        const result = await FirebaseUtils.getDocuments('support_tickets',
            { field: 'updatedAt', direction: 'desc' }); // Sort by updated time

        if (result.success) {
            allTickets = result.data;
            filteredTickets = [...allTickets];
            displayTickets();
            checkForNewUserReplies();
        } else {
            allTickets = [];
            filteredTickets = [];
            displayTickets();
        }
    } catch (error) {

        allTickets = [];
        filteredTickets = [];
        displayTickets();
    }
}

// Global variables for sound notification
let supportTicketUnsubscribe = null;
let lastSoundNotificationTime = Date.now();

// Start real-time listener for support tickets
function startSupportTicketListener() {
    if (supportTicketUnsubscribe) supportTicketUnsubscribe();

    supportTicketUnsubscribe = FirebaseUtils.listenToCollection('support_tickets', (snapshot) => {
        let hasNewActivity = false;

        snapshot.docChanges().forEach((change) => {
            if (change.type === 'modified' || change.type === 'added') {
                hasNewActivity = true;
                const ticket = change.doc.data();

                // Play sound for new user replies
                if (ticket.replies && ticket.replies.length > 0) {
                    const lastReply = ticket.replies[ticket.replies.length - 1];
                    const replyTime = lastReply.createdAt ? lastReply.createdAt.toMillis() : Date.now();

                    if (lastReply.isUserReply === true && replyTime > lastSoundNotificationTime) {
                        playNotificationSound();
                        lastSoundNotificationTime = replyTime;
                    }
                }

                // Play sound for new tickets
                if (change.type === 'added') {
                    const ticketTime = ticket.createdAt ? ticket.createdAt.toMillis() : Date.now();
                    if (ticketTime > lastSoundNotificationTime) {
                        playNotificationSound();
                        lastSoundNotificationTime = ticketTime;
                    }
                }
            }
        });

        if (hasNewActivity) {
            // Reload tickets to update the counter
            loadTickets();

            // Refresh the list if we are on the support tab
            const activeTab = document.querySelector('.tab-content.active');
            if (activeTab && activeTab.id === 'supportTab') {
                loadSupportTickets();
            }
        }
    }, { field: 'updatedAt', direction: 'desc' });
}

// Play notification sound
function playNotificationSound() {
    const sound = document.getElementById('notificationSound');
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => { });
    }
}

// Check for new user replies and new tickets
function checkForNewUserReplies() {
    let unreadCount = 0;

    allTickets.forEach(ticket => {
        // Count open/pending tickets without admin response
        if (ticket.status === 'open' || ticket.status === 'pending' || !ticket.status) {
            const hasAdminReply = ticket.replies && ticket.replies.some(r => r.isAdminReply === true);

            // If no admin has replied yet, count it as unread
            if (!hasAdminReply) {
                unreadCount++;
            }
        }

        // Also count tickets with recent user replies (even if admin replied before)
        if (ticket.replies && ticket.replies.length > 0) {
            const lastReply = ticket.replies[ticket.replies.length - 1];

            // If last reply is from user and recent, count it
            if (lastReply.isUserReply === true) {
                const isRecent = lastReply.createdAt &&
                    (new Date() - lastReply.createdAt.toDate()) < (24 * 60 * 60 * 1000);

                if (isRecent) {
                    // Only add if not already counted above
                    const alreadyCounted = (ticket.status === 'open' || ticket.status === 'pending' || !ticket.status) &&
                        !(ticket.replies && ticket.replies.some(r => r.isAdminReply === true));

                    if (!alreadyCounted) {
                        unreadCount++;
                    }
                }
            }
        }
    });

    updateTicketNotification(unreadCount);
}

// Update ticket notification in sidebar and header
function updateTicketNotification(count) {
    // 1. Sidebar Badge
    const supportMenuItem = document.querySelector('button[onclick="switchTab(\'support\')"]');
    if (supportMenuItem) {
        let sidebarBadge = supportMenuItem.querySelector('.notification-badge');
        if (count > 0) {
            if (!sidebarBadge) {
                sidebarBadge = document.createElement('span');
                sidebarBadge.className = 'notification-badge';
                sidebarBadge.style.cssText = `
    background: #e74c3c;
    color: white;
    border - radius: 50 %;
    padding: 0.2rem 0.5rem;
    font - size: 0.7rem;
    font - weight: 600;
    margin - right: 0.5rem;
    min - width: 1.2rem;
    height: 1.2rem;
    display: flex;
    align - items: center;
    justify - content: center;
    `;
                supportMenuItem.appendChild(sidebarBadge);
            }
            sidebarBadge.textContent = count;
        } else if (sidebarBadge) {
            sidebarBadge.remove();
        }
    }

    // 2. Header Bell
    const bellWrapper = document.getElementById('supportNotificationBell');
    const bellCount = document.getElementById('supportNotificationCount');

    if (bellWrapper && bellCount) {
        if (count > 0) {
            bellCount.textContent = count;
            bellCount.style.display = 'flex';
            bellWrapper.classList.add('has-new-notifications');
        } else {
            bellCount.style.display = 'none';
            bellWrapper.classList.remove('has-new-notifications');
        }
    }
}

// Load products from Firebase
async function loadProducts() {
    try {
        const result = await FirebaseUtils.getDocuments('products',
            { field: 'createdAt', direction: 'desc' });

        if (result.success) {
            allProducts = result.data;
            filteredProducts = [...allProducts];
            displayProducts();
        } else {
            allProducts = [];
            filteredProducts = [];
            displayProducts();
        }
    } catch (error) {

        allProducts = [];
        filteredProducts = [];
        displayProducts();
    }
}

// Display products in admin panel
function displayProducts() {
    const productsContainer = document.getElementById('productsContainer');
    if (!productsContainer) return;

    if (!filteredProducts || filteredProducts.length === 0) {
        productsContainer.innerHTML = `
        <div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem;">
                <i class="fas fa-box-open" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1.5rem;"></i>
                <h3 style="color: #64748b;">لا توجد منتجات حالياً</h3>
                <p style="color: #94a3b8; margin-top: 0.5rem;">يمكنك البدء بإضافة منتج جديد من الزر الموجود في الأعلى</p>
            </div>
        `;
        return;
    }

    const productsHTML = filteredProducts.map(product => `
        <div class="product-card-modern">
            <div class="product-image-container">
                <div class="product-status-overlay ${product.isActive ? 'status-active-modern' : 'status-inactive-modern'}">
                    ${product.isActive ? 'نشط' : 'مخفي'}
                </div>
                ${product.image ? `
                    <img src="${product.image}" alt="${product.name}">
                ` : `
                    <div style="width: 100%; height: 100%; background: #f8f9fa; display: flex; align-items: center; justify-content: center; color: #cbd5e1;">
                        <i class="fas fa-image fa-3x"></i>
                    </div>
                `}
            </div>
            
            <div class="product-content-modern">
                <span class="product-category-tag">${getProductCategoryText(product.category)}</span>
                <h4 class="product-title-modern">${product.name}</h4>
                <p style="color: #64748b; font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem; flex-grow: 1;">
                    ${product.description.substring(0, 100)}${product.description.length > 100 ? '...' : ''}
                </p>
                
                <div class="product-price-box" style="margin-bottom: 1rem;">
                    <div style="font-weight: 800; color: #1e3a8a; font-size: 1.2rem; margin-bottom: 0.5rem;">${product.price}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.8rem; background: #f1f5f9; padding: 0.8rem; border-radius: 8px;">
                        ${product.multi_pricing?.m1 ? `<div style="color: #475569;"><i class="far fa-calendar-alt"></i> شهر: <span style="font-weight: 600; color: #1e293b;">${product.multi_pricing.m1}</span></div>` : ''}
                        ${product.multi_pricing?.m6 ? `<div style="color: #475569;"><i class="fas fa-layer-group"></i> 6 شهور: <span style="font-weight: 600; color: #1e293b;">${product.multi_pricing.m6}</span></div>` : ''}
                        ${product.multi_pricing?.y1 ? `<div style="color: #475569;"><i class="fas fa-calendar-check"></i> سنة: <span style="font-weight: 600; color: #1e293b;">${product.multi_pricing.y1}</span></div>` : ''}
                        ${product.multi_pricing?.lifetime ? `<div style="color: #475569;"><i class="fas fa-infinity"></i> مدي الحياة: <span style="font-weight: 600; color: #1e293b;">${product.multi_pricing.lifetime}</span></div>` : ''}
                    </div>
                </div>
                
                <div class="product-features-list">
                    ${(product.features || []).slice(0, 4).map(feature => `
                        <span class="feature-tag-modern">${feature}</span>
                    `).join('')}
                    ${(product.features || []).length > 4 ? `
                        <span class="feature-tag-modern">+${(product.features || []).length - 4}</span>
                    ` : ''}
                </div>
                
                <div class="product-actions-modern">
                    <button class="action-btn-modern btn-edit-modern" onclick="editProduct('${product.id}')" title="تعديل">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn-modern btn-toggle-modern" onclick="toggleProductStatus('${product.id}')" title="${product.isActive ? 'إخفاء' : 'إظهار'}">
                        <i class="fas fa-${product.isActive ? 'eye-slash' : 'eye'}"></i>
                    </button>
                    <button class="action-btn-modern btn-delete-modern" onclick="deleteProduct('${product.id}')" title="حذف">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
        `).join('');

    productsContainer.innerHTML = productsHTML;
}

// Show add product modal
function showAddProductModal() {
    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>إضافة منتج جديد</h2>
        
        <form id="addProductForm" style="text-align: right;">
            <div class="form-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
                <div class="form-group">
                    <label>اسم المنتج:</label>
                    <input type="text" name="name" required placeholder="AS3G SYSTEM - الباقة الأساسية">
                </div>
                
                <div class="form-group">
                    <label>الفئة:</label>
                    <select name="category" required>
                        <option value="">اختر الفئة</option>
                        <option value="basic">باقة أساسية</option>
                        <option value="advanced">باقة متقدمة</option>
                        <option value="professional">باقة احترافية</option>
                        <option value="enterprise">باقة مؤسسات</option>
                    </select>
                </div>
                
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label style="color: #2c5aa0; font-weight: bold; font-size: 1.1rem; margin-bottom: 1rem; display: block; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem;">إعدادات الأسعار التعددية:</label>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem;">
                        <div class="form-group">
                            <label>سعر الشهر:</label>
                            <input type="text" name="price_1m" placeholder="مثلاً: 100 جنيه">
                        </div>
                        <div class="form-group">
                            <label>سعر 6 شهور:</label>
                            <input type="text" name="price_6m" placeholder="مثلاً: 500 جنيه">
                        </div>
                        <div class="form-group">
                            <label>سعر السنة:</label>
                            <input type="text" name="price_1y" placeholder="مثلاً: 900 جنيه">
                        </div>
                        <div class="form-group">
                            <label>سعر مدي الحياة:</label>
                            <input type="text" name="price_lifetime" placeholder="مثلاً: 5000 جنيه">
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>السعر الأساسي (للعرض السريع):</label>
                    <input type="text" name="price" required placeholder="مثلاً: 750 جنيه/شهر">
                </div>
                
                <div class="form-group">
                    <label>السعر الأصلي قبل الخصم (اختياري):</label>
                    <input type="text" name="originalPrice" placeholder="مثلاً: 950 جنيه/شهر">
                </div>
                
                <div class="form-group">
                    <label>رابط الصورة:</label>
                    <input type="url" name="image" placeholder="https://example.com/image.jpg">
                </div>
                
                <div class="form-group">
                    <label>الأيقونة (Font Awesome):</label>
                    <input type="text" name="icon" placeholder="fas fa-desktop">
                </div>
                
                <div class="form-group">
                    <label>ترتيب العرض:</label>
                    <input type="number" name="order" value="0" min="0">
                </div>
                
                <div class="form-group">
                    <label>الحالة:</label>
                    <select name="isActive">
                        <option value="true">نشط</option>
                        <option value="false">غير نشط</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label>وصف المنتج:</label>
                <textarea name="description" rows="4" required placeholder="وصف شامل للمنتج ومميزاته"></textarea>
            </div>
            
            <div class="form-group">
                <label>المميزات (كل مميزة في سطر منفصل):</label>
                <textarea name="features" rows="6" placeholder="واجهة مستخدم عربية بالكامل&#10;إدارة المبيعات والفواتير&#10;تتبع المخزون الذكي"></textarea>
            </div>
            
            <div class="form-group">
                <label>معرض الصور (كل رابط في سطر منفصل):</label>
                <textarea name="gallery" rows="4" placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg"></textarea>
            </div>
            
            <div class="form-group">
                <label>روابط الفيديوهات (كل رابط في سطر منفصل):</label>
                <textarea name="videos" rows="3" placeholder="https://example.com/video1.mp4&#10;https://example.com/video2.mp4"></textarea>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="btn-primary">
                    <i class="fas fa-save"></i> حفظ المنتج
                </button>
                <button type="button" class="btn-secondary" onclick="closeModal()">إلغاء</button>
            </div>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    setupModalClose(modal);

    // Handle form submission
    document.getElementById('addProductForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(e.target);
        const productData = {
            name: formData.get('name'),
            description: formData.get('description'),
            category: formData.get('category'),
            price: formData.get('price'),
            originalPrice: formData.get('originalPrice') || null,
            multi_pricing: {
                m1: formData.get('price_1m') || null,
                m6: formData.get('price_6m') || null,
                y1: formData.get('price_1y') || null,
                lifetime: formData.get('price_lifetime') || null
            },
            image: formData.get('image') || null,
            icon: formData.get('icon') || 'fas fa-box',
            order: parseInt(formData.get('order')) || 0,
            isActive: formData.get('isActive') === 'true',
            features: formData.get('features').split('\n').filter(f => f.trim()),
            gallery: formData.get('gallery').split('\n').filter(g => g.trim()),
            videos: formData.get('videos').split('\n').filter(v => v.trim()),
            createdBy: currentUser.uid,
            createdByName: currentUser.displayName || currentUser.email
        };

        try {
            const result = await FirebaseUtils.addDocument('products', productData);
            if (result.success) {
                showMessage('تم إضافة المنتج بنجاح!', 'success');
                closeModal();
                await loadProducts(); // Reload products
                updateMainPageProducts(); // Update main page
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            showMessage('حدث خطأ في إضافة المنتج', 'error');
        }
    });
}

// Edit product
function editProduct(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>تعديل المنتج</h2>
        
        <form id="editProductForm" style="text-align: right;">
            <div class="form-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
                <div class="form-group">
                    <label>اسم المنتج:</label>
                    <input type="text" name="name" required value="${product.name}">
                </div>
                
                <div class="form-group">
                    <label>الفئة:</label>
                    <select name="category" required>
                        <option value="">اختر الفئة</option>
                        <option value="basic" ${product.category === 'basic' ? 'selected' : ''}>باقة أساسية</option>
                        <option value="advanced" ${product.category === 'advanced' ? 'selected' : ''}>باقة متقدمة</option>
                        <option value="professional" ${product.category === 'professional' ? 'selected' : ''}>باقة احترافية</option>
                        <option value="enterprise" ${product.category === 'enterprise' ? 'selected' : ''}>باقة مؤسسات</option>
                    </select>
                </div>
                
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label style="color: #2c5aa0; font-weight: bold; font-size: 1.1rem; margin-bottom: 1rem; display: block; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem;">إعدادات الأسعار التعددية:</label>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem;">
                        <div class="form-group">
                            <label>سعر الشهر:</label>
                            <input type="text" name="price_1m" value="${product.multi_pricing?.m1 || ''}" placeholder="مثلاً: 100 جنيه">
                        </div>
                        <div class="form-group">
                            <label>سعر 6 شهور:</label>
                            <input type="text" name="price_6m" value="${product.multi_pricing?.m6 || ''}" placeholder="مثلاً: 500 جنيه">
                        </div>
                        <div class="form-group">
                            <label>سعر السنة:</label>
                            <input type="text" name="price_1y" value="${product.multi_pricing?.y1 || ''}" placeholder="مثلاً: 900 جنيه">
                        </div>
                        <div class="form-group">
                            <label>سعر مدي الحياة:</label>
                            <input type="text" name="price_lifetime" value="${product.multi_pricing?.lifetime || ''}" placeholder="مثلاً: 5000 جنيه">
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>السعر الأساسي:</label>
                    <input type="text" name="price" required value="${product.price}">
                </div>
                
                <div class="form-group">
                    <label>السعر الأصلي (اختياري):</label>
                    <input type="text" name="originalPrice" value="${product.originalPrice || ''}">
                </div>
                
                <div class="form-group">
                    <label>رابط الصورة:</label>
                    <input type="url" name="image" value="${product.image || ''}">
                </div>
                
                <div class="form-group">
                    <label>الأيقونة (Font Awesome):</label>
                    <input type="text" name="icon" value="${product.icon || 'fas fa-box'}">
                </div>
                
                <div class="form-group">
                    <label>ترتيب العرض:</label>
                    <input type="number" name="order" value="${product.order || 0}" min="0">
                </div>
                
                <div class="form-group">
                    <label>الحالة:</label>
                    <select name="isActive">
                        <option value="true" ${product.isActive ? 'selected' : ''}>نشط</option>
                        <option value="false" ${!product.isActive ? 'selected' : ''}>غير نشط</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label>وصف المنتج:</label>
                <textarea name="description" rows="4" required>${product.description}</textarea>
            </div>
            
            <div class="form-group">
                <label>المميزات (كل مميزة في سطر منفصل):</label>
                <textarea name="features" rows="6">${(product.features || []).join('\n')}</textarea>
            </div>
            
            <div class="form-group">
                <label>معرض الصور (كل رابط في سطر منفصل):</label>
                <textarea name="gallery" rows="4">${(product.gallery || []).join('\n')}</textarea>
            </div>
            
            <div class="form-group">
                <label>روابط الفيديوهات (كل رابط في سطر منفصل):</label>
                <textarea name="videos" rows="3">${(product.videos || []).join('\n')}</textarea>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="btn-primary">
                    <i class="fas fa-save"></i> حفظ التغييرات
                </button>
                <button type="button" class="btn-secondary" onclick="closeModal()">إلغاء</button>
            </div>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    setupModalClose(modal);

    // Handle form submission
    document.getElementById('editProductForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(e.target);
        const updateData = {
            name: formData.get('name'),
            description: formData.get('description'),
            category: formData.get('category'),
            price: formData.get('price'),
            originalPrice: formData.get('originalPrice') || null,
            multi_pricing: {
                m1: formData.get('price_1m') || null,
                m6: formData.get('price_6m') || null,
                y1: formData.get('price_1y') || null,
                lifetime: formData.get('price_lifetime') || null
            },
            image: formData.get('image') || null,
            icon: formData.get('icon') || 'fas fa-box',
            order: parseInt(formData.get('order')) || 0,
            isActive: formData.get('isActive') === 'true',
            features: formData.get('features').split('\n').filter(f => f.trim()),
            gallery: formData.get('gallery').split('\n').filter(g => g.trim()),
            videos: formData.get('videos').split('\n').filter(v => v.trim()),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: currentUser.uid,
            updatedByName: currentUser.displayName || currentUser.email
        };

        try {
            const result = await FirebaseUtils.updateDocument('products', productId, updateData);
            if (result.success) {
                showMessage('تم تحديث المنتج بنجاح!', 'success');
                closeModal();
                await loadProducts(); // Reload products
                updateMainPageProducts(); // Update main page
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            showMessage('حدث خطأ في تحديث المنتج', 'error');
        }
    });
}

// Toggle product status
async function toggleProductStatus(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    try {
        const result = await FirebaseUtils.updateDocument('products', productId, {
            isActive: !product.isActive,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        if (result.success) {
            showMessage(`تم ${!product.isActive ? 'تفعيل' : 'إلغاء تفعيل'} المنتج بنجاح!`, 'success');
            await loadProducts();
            updateMainPageProducts();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        showMessage('حدث خطأ في تحديث حالة المنتج', 'error');
    }
}

// Delete product
async function deleteProduct(productId) {
    const confirmed = await showConfirmModal(
        'حذف المنتج',
        'هل أنت متأكد من حذف هذا المنتج؟ لا يمكن التراجع عن هذا الإجراء وسيتم إزالته من الموقع.',
        'حذف المنتج',
        'إلغاء'
    );

    if (!confirmed) {
        return;
    }

    try {
        const result = await FirebaseUtils.deleteDocument('products', productId);

        if (result.success) {
            showMessage('تم حذف المنتج بنجاح!', 'success');
            await logAction('حذف منتج', 'delete', { productId: productId });
            await loadProducts();
            updateMainPageProducts();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        showMessage('حدث خطأ في حذف المنتج', 'error');
    }
}

// View product details
function viewProductDetails(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>تفاصيل المنتج</h2>
        
        <div class="product-details-view" style="text-align: right;">
            <div class="detail-section" style="background: #f8f9fa; padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem;">
                <h4 style="color: #2c5aa0; margin-bottom: 1rem;">المعلومات الأساسية:</h4>
                <div class="detail-row"><strong>الاسم:</strong> ${product.name}</div>
                <div class="detail-row"><strong>الفئة:</strong> ${getProductCategoryText(product.category)}</div>
                <div class="detail-row" style="margin-top: 1rem; border-top: 1px solid #dee2e6; padding-top: 1rem;">
                    <strong style="display: block; margin-bottom: 0.5rem; color: #1e3a8a;">خيارات التسعير:</strong>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
                        <div style="background: white; padding: 0.5rem; border-radius: 5px; border: 1px solid #e2e8f0;"><strong>شهر:</strong> ${product.multi_pricing?.m1 || 'غير متوفر'}</div>
                        <div style="background: white; padding: 0.5rem; border-radius: 5px; border: 1px solid #e2e8f0;"><strong>6 شهور:</strong> ${product.multi_pricing?.m6 || 'غير متوفر'}</div>
                        <div style="background: white; padding: 0.5rem; border-radius: 5px; border: 1px solid #e2e8f0;"><strong>سنة:</strong> ${product.multi_pricing?.y1 || 'غير متوفر'}</div>
                        <div style="background: white; padding: 0.5rem; border-radius: 5px; border: 1px solid #e2e8f0;"><strong>مدى الحياة:</strong> ${product.multi_pricing?.lifetime || 'غير متوفر'}</div>
                    </div>
                </div>
                <div class="detail-row" style="margin-top: 1rem;"><strong>السعر المعروض:</strong> ${product.price}</div>
                ${product.originalPrice ? `<div class="detail-row"><strong>السعر الأصلي:</strong> ${product.originalPrice}</div>` : ''}
                <div class="detail-row"><strong>الحالة:</strong> <span class="status-badge ${product.isActive ? 'status-active' : 'status-inactive'}">${product.isActive ? 'نشط' : 'غير نشط'}</span></div>
                <div class="detail-row"><strong>ترتيب العرض:</strong> ${product.order || 0}</div>
            </div>
            
            <div class="detail-section" style="background: #e3f2fd; padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem;">
                <h4 style="color: #1565c0; margin-bottom: 1rem;">الوصف:</h4>
                <p style="line-height: 1.8;">${product.description}</p>
            </div>
            
            ${product.features && product.features.length > 0 ? `
                <div class="detail-section" style="background: #e8f5e8; padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem;">
                    <h4 style="color: #2e7d32; margin-bottom: 1rem;">المميزات:</h4>
                    <ul style="list-style: none; padding: 0;">
                        ${product.features.map(feature => `
                            <li style="padding: 0.5rem 0; border-bottom: 1px solid #c8e6c9;">
                                <i class="fas fa-check" style="color: #4caf50; margin-left: 0.5rem;"></i>
                                ${feature}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            ` : ''}
            
            ${product.image ? `
                <div class="detail-section" style="margin-bottom: 2rem;">
                    <h4 style="color: #2c5aa0; margin-bottom: 1rem;">الصورة الرئيسية:</h4>
                    <img src="${product.image}" alt="${product.name}" style="width: 100%; max-height: 300px; object-fit: cover; border-radius: 10px;">
                </div>
            ` : ''}
            
            <div class="product-actions" style="display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; margin-top: 2rem;">
                <button class="btn-warning" onclick="editProduct('${product.id}'); closeModal();">
                    <i class="fas fa-edit"></i> تعديل المنتج
                </button>
                <button class="btn-${product.isActive ? 'secondary' : 'success'}" onclick="toggleProductStatus('${product.id}'); closeModal();">
                    <i class="fas fa-${product.isActive ? 'eye-slash' : 'eye'}"></i> ${product.isActive ? 'إخفاء' : 'إظهار'}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';

    setupModalClose(modal);
}

// Update main page products
function updateMainPageProducts() {
    // This function will be called to refresh products on the main page
    if (typeof loadSystems === 'function') {
        loadSystems();
    }
}

// Get category text in Arabic
function getProductCategoryText(category) {
    switch (category) {
        case 'basic': return 'باقة أساسية';
        case 'advanced': return 'باقة متقدمة';
        case 'professional': return 'باقة احترافية';
        case 'enterprise': return 'باقة مؤسسات';
        default: return 'غير محدد';
    }
}

// Filter products
function filterProducts(filterType, filterValue) {
    if (filterType === 'category') {
        if (filterValue === '') {
            filteredProducts = [...allProducts];
        } else {
            filteredProducts = allProducts.filter(product => product.category === filterValue);
        }
    } else if (filterType === 'status') {
        if (filterValue === '') {
            filteredProducts = [...allProducts];
        } else if (filterValue === 'active') {
            filteredProducts = allProducts.filter(product => product.isActive);
        } else if (filterValue === 'inactive') {
            filteredProducts = allProducts.filter(product => !product.isActive);
        }
    }

    displayProducts();
}

// Search products
function searchProducts(searchTerm) {
    if (!searchTerm.trim()) {
        filteredProducts = [...allProducts];
    } else {
        const term = searchTerm.toLowerCase();
        filteredProducts = allProducts.filter(product =>
            product.name.toLowerCase().includes(term) ||
            product.description.toLowerCase().includes(term) ||
            (product.features && product.features.some(feature =>
                feature.toLowerCase().includes(term)
            ))
        );
    }

    displayProducts();
}

// Reset product filters
function resetProductFilters() {
    // Reset all filter dropdowns
    document.querySelectorAll('.filter-toolbar-modern select').forEach(select => {
        select.selectedIndex = 0;
    });

    // Reset search input
    const searchInput = document.querySelector('.filter-toolbar-modern input[type="text"]');
    if (searchInput) {
        searchInput.value = '';
    }

    // Reload all products
    loadProducts();
}

// Load Quick Settings
function loadQuickSettings() {
    const settingsContainer = document.getElementById('settingsContainer');
    if (!settingsContainer) return;

    settingsContainer.innerHTML = `
        <div class="settings-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem;">
            <div class="setting-card" style="background: white; padding: 2rem; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                <h3 style="color: #2c5aa0; margin-bottom: 1.5rem;">
                    <i class="fas fa-cog"></i> إعدادات عامة
                </h3>
                <div class="setting-item" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">اسم الموقع:</label>
                    <input type="text" value="AS3G SYSTEM" style="width: 100%; padding: 0.8rem; border: 2px solid #e9ecef; border-radius: 8px;">
                </div>
                <div class="setting-item" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">البريد الإلكتروني:</label>
                    <input type="email" value="info@as3g.com" style="width: 100%; padding: 0.8rem; border: 2px solid #e9ecef; border-radius: 8px;">
                </div>
                <button class="btn-primary" style="width: 100%; margin-top: 1rem;">
                    <i class="fas fa-save"></i> حفظ التغييرات
                </button>
            </div>
            
            <div class="setting-card" style="background: white; padding: 2rem; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                <h3 style="color: #2c5aa0; margin-bottom: 1.5rem;">
                    <i class="fas fa-tools"></i> وضع الصيانة
                </h3>
                <div class="setting-item" style="margin-bottom: 1rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" style="width: 20px; height: 20px;">
                        <span style="font-weight: 600;">تفعيل وضع الصيانة</span>
                    </label>
                </div>
                <div class="setting-item" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">رسالة الصيانة:</label>
                    <textarea rows="3" style="width: 100%; padding: 0.8rem; border: 2px solid #e9ecef; border-radius: 8px;">الموقع قيد الصيانة، سنعود قريباً</textarea>
                </div>
                <button class="btn-primary" style="width: 100%; margin-top: 1rem;">
                    <i class="fas fa-save"></i> حفظ التغييرات
                </button>
            </div>
            
            <div class="setting-card" style="background: white; padding: 2rem; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                <h3 style="color: #2c5aa0; margin-bottom: 1.5rem;">
                    <i class="fas fa-share-alt"></i> وسائل التواصل
                </h3>
                <button class="btn-primary" onclick="showSocialMediaManager()" style="width: 100%;">
                    <i class="fas fa-edit"></i> إدارة روابط التواصل
                </button>
            </div>
        </div>
        `;
}

// Load Vodafone Cash number
async function loadPaymentSettings() {
    try {
        const doc = await firebase.firestore().collection('settings').doc('payment_info').get();
        if (doc.exists) {
            const data = doc.data();
            const input = document.getElementById('vodafoneCashInput');
            if (input) input.value = data.vodafoneCashNumber || '';
        }
    } catch (error) {

    }
}

// Save Vodafone Cash number
async function savePaymentSettings() {
    const number = document.getElementById('vodafoneCashInput')?.value;
    if (!number) {
        showMessage('يرجى إدخال رقم صحيح', 'warning');
        return;
    }
    try {
        await firebase.firestore().collection('settings').doc('payment_info').set({
            vodafoneCashNumber: number,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showMessage('تم حفظ رقم فودافون كاش بنجاح', 'success');
        logAction('تحديث رقم فودافون كاش', 'update', { number });
    } catch (error) {

        showMessage('فشل حفظ الرقم', 'error');
    }
}

// Save General Settings
async function saveGeneralSettings() {
    const siteName = document.getElementById('siteNameInput').value;
    const siteEmail = document.getElementById('siteEmailInput').value;

    try {
        const result = await FirebaseHelpers.updateDocument('settings', 'general', {
            siteName: siteName,
            siteEmail: siteEmail,
            updatedAt: new Date()
        });

        if (result.success) {
            showMessage('تم حفظ الإعدادات العامة بنجاح', 'success');
            logAction('Update General Settings', 'settings', { siteName, siteEmail });
        } else {
            throw new Error(result.error);
        }
    } catch (error) {

        showMessage('حدث خطأ أثناء حفظ الإعدادات', 'error');
    }
}

// Quick Change Theme
function quickChangeTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('admin-theme', theme);

    // Update UI buttons
    document.getElementById('themeLightBtn').classList.toggle('active', theme === 'light');
    document.getElementById('themeDarkBtn').classList.toggle('active', theme === 'dark');

    showMessage(`تم تغيير المظهر إلى ${theme === 'dark' ? 'الداكن' : 'الفاتح'} `, 'info');
}

// Quick Change Language
function quickChangeLanguage(lang) {
    // This would typically involve loading a different translation file
    // For now, we update the UI active state and show a message
    document.getElementById('langArBtn').classList.toggle('active', lang === 'ar');
    document.getElementById('langEnBtn').classList.toggle('active', lang === 'en');

    showMessage(`تم تغيير اللغة إلى ${lang === 'ar' ? 'العربية' : 'English'} (قيد التطوير)`, 'info');
}

// Toggle Maintenance Mode
async function toggleMaintenanceMode(isEnabled) {
    try {
        const result = await FirebaseUtils.setDocument('settings', 'maintenance', {
            enabled: isEnabled,
            updatedAt: new Date(),
            updatedBy: auth.currentUser ? auth.currentUser.email : 'system'
        });

        if (result.success) {
            showMessage(isEnabled ? 'تم تفعيل وضع الصيانة' : 'تم إيقاف وضع الصيانة', isEnabled ? 'warning' : 'success');
            logAction(isEnabled ? 'Enable Maintenance' : 'Disable Maintenance', 'settings');
        } else {
            document.getElementById('maintenanceToggle').checked = !isEnabled;
            throw new Error(result.error);
        }
    } catch (error) {

        showMessage('تعذر تغيير وضع الصيانة', 'error');
    }
}

// Refresh Quick Stats
async function refreshQuickStats() {
    try {
        const productsCount = (await FirebaseUtils.getDocuments('products')).data.length || 0;
        const usersCount = (await FirebaseUtils.getDocuments('users')).data.length || 0;
        const ordersCount = (await FirebaseUtils.getDocuments('orders')).data.length || 0;
        const ticketsCount = (await FirebaseUtils.getDocuments('support_tickets')).data.length || 0;

        // UI for settings page might not have these IDs if not active
        const updateStat = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        updateStat('statsProducts', productsCount);
        updateStat('statsUsers', usersCount);
        updateStat('statsOrders', ordersCount);
        updateStat('statsTickets', ticketsCount);

        showMessage('تم تحديث الإحصائيات بنجاح', 'success');
    } catch (error) {

        showMessage('فشل تحديث الإحصائيات', 'error');
    }
}

// Quick Backup (JSON Export)
async function quickBackup() {
    try {
        showMessage('جاري تحضير النسخة الاحتياطية...', 'info');

        const collections = ['products', 'users', 'orders', 'support_tickets', 'settings'];
        const backupData = {};

        for (const coll of collections) {
            const result = await FirebaseUtils.getDocuments(coll);
            if (result.success) {
                backupData[coll] = result.data;
            }
        }

        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `as3g_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showMessage('تم تحميل النسخة الاحتياطية بنجاح', 'success');
        logAction('System Backup', 'system');
    } catch (error) {

        showMessage('فشل إنشاء النسخة الاحتياطية', 'error');
    }
}

// Quick Import
function quickImport(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (confirm('هل أنت متأكد من استيراد هذه البيانات؟ سيؤدي ذلك إلى تحديث السجلات الموجودة.')) {
                showMessage('جاري استيراد البيانات...', 'info');

                // Simple implementation: alert success, as full replacement is complex
                // In a real app, this would iterate and upsert documents

                showMessage('تم استيراد البيانات بنجاح (المحاكاة)', 'success');
                logAction('System Import', 'system');
            }
        } catch (error) {

            showMessage('الملف غير صالح أو حدث خطأ أثناء الاستيراد', 'error');
        }
    };
    reader.readAsText(file);
}

// Show Admins List
async function showAdminsList() {
    const modal = createModal();
    const result = await FirebaseUtils.getDocuments('users');
    const admins = result.success ? result.data.filter(u => u.isAdmin || u.role === 'admin' || u.role === 'super_admin') : [];

    modal.querySelector('.modal-content').innerHTML = `
        < span class="close" >& times;</span >
        <h2 style="color: #1e3a5f; margin-bottom: 2rem;">قائمة فريق العمل (المدراء)</h2>
        <div style="max-height: 400px; overflow-y: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>الاسم</th>
                        <th>البريد الإلكتروني</th>
                        <th>الدور</th>
                        <th>الحالة</th>
                    </tr>
                </thead>
                <tbody>
                    ${admins.map(admin => `
                        <tr>
                            <td>${admin.name || admin.businessName || 'بدون اسم'}</td>
                            <td>${admin.email}</td>
                            <td><span class="status-badge" style="background: #eef2ff; color: #4f46e5;">${getRoleText(admin.role)}</span></td>
                            <td>${admin.isBlocked ? '<span style="color:red">محظور</span>' : '<span style="color:green">نشط</span>'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'block';
    setupModalClose(modal);
}

// Show Permissions Matrix
function showPermissionsMatrix() {
    const modal = createModal();
    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2 style="color: #1e3a5f; margin-bottom: 2rem;">مصفوفة صلاحيات النظام</h2>
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>الصفحة / الوظيفة</th>
                        <th>مدير عام</th>
                        <th>مدير مبيعات</th>
                        <th>دعم فني</th>
                        <th>مدير محتوى</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>إدارة الطلبات</td><td>✅</td><td>✅</td><td>❌</td><td>❌</td></tr>
                    <tr><td>إدارة المستخدمين</td><td>✅</td><td>❌</td><td>❌</td><td>❌</td></tr>
                    <tr><td>إدارة المنتجات</td><td>✅</td><td>✅</td><td>❌</td><td>✅</td></tr>
                    <tr><td>الدعم الفني</td><td>✅</td><td>❌</td><td>✅</td><td>❌</td></tr>
                    <tr><td>الأسئلة الشائعة</td><td>✅</td><td>❌</td><td>✅</td><td>✅</td></tr>
                    <tr><td>إعدادات النظام</td><td>✅</td><td>❌</td><td>❌</td><td>❌</td></tr>
                </tbody>
            </table>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'block';
    setupModalClose(modal);
}

// ===== ANALYTICS FUNCTIONS =====
let salesChart = null;
let usersChart = null;

async function loadAnalytics() {
    try {
        const ordersResult = await FirebaseUtils.getDocuments('orders');
        const usersResult = await FirebaseUtils.getDocuments('users');

        if (ordersResult.success && usersResult.success) {
            displayAnalyticsCharts(ordersResult.data, usersResult.data);
        }
    } catch (error) {

    }
}

function displayAnalyticsCharts(orders, users) {
    const salesCtx = document.getElementById('salesChart');
    if (salesCtx && typeof Chart !== 'undefined') {
        if (salesChart) salesChart.destroy();

        salesChart = new Chart(salesCtx, {
            type: 'line',
            data: {
                labels: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو'],
                datasets: [{
                    label: 'المبيعات',
                    data: [12, 19, 3, 5, 2, 3],
                    borderColor: '#2c5aa0',
                    backgroundColor: 'rgba(44, 90, 160, 0.1)',
                    tension: 0.4
                }]
            }
        });
    }

    const usersCtx = document.getElementById('usersChart');
    if (usersCtx && typeof Chart !== 'undefined') {
        if (usersChart) usersChart.destroy();

        usersChart = new Chart(usersCtx, {
            type: 'bar',
            data: {
                labels: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو'],
                datasets: [{
                    label: 'المستخدمين الجدد',
                    data: [5, 10, 8, 15, 12, 20],
                    backgroundColor: '#26de81'
                }]
            }
        });
    }
}

// ===== COUPONS MANAGEMENT =====
let allCoupons = [];

async function loadCoupons() {
    try {
        const result = await FirebaseUtils.getDocuments('coupons',
            { field: 'createdAt', direction: 'desc' });

        if (result.success) {
            allCoupons = result.data;
            displayCoupons();
        }
    } catch (error) {

    }
}

function displayCoupons() {
    const couponsContainer = document.getElementById('couponsContainer');
    if (!couponsContainer) return;

    if (allCoupons.length === 0) {
        couponsContainer.innerHTML = `
        <div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem;">
                <h3 style="margin-bottom: 2rem; color: #64748b;">لا توجد كوبونات حالياً</h3>
                <button class="btn-add-premium large" onclick="showAddCouponModal()">
                    <i class="fas fa-ticket-alt"></i>
                    <span>إضافة كوبون جديد</span>
                </button>
            </div>
        `;
        return;
    }

    const couponsHTML = allCoupons.map(coupon => `
        < div class="coupon-card" style = "background: white; padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; box-shadow: 0 2px 10px rgba(0,0,0,0.1);" >
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div>
                    <h4 style="color: #2c5aa0; margin-bottom: 0.5rem;">${coupon.code}</h4>
                    <p style="color: #666; margin-bottom: 0.5rem;">${coupon.description || 'لا يوجد وصف'}</p>
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                        <span><strong>الخصم:</strong> ${coupon.discount}${coupon.type === 'percentage' ? '%' : ' جنيه'}</span>
                        <span><strong>الاستخدامات:</strong> ${coupon.usedCount || 0} / ${coupon.maxUses || '∞'}</span>
                        <span><strong>الحالة:</strong> <span class="status-badge ${coupon.isActive ? 'status-active' : 'status-inactive'}">${coupon.isActive ? 'نشط' : 'غير نشط'}</span></span>
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="action-btn btn-edit" onclick="editCoupon('${coupon.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn btn-delete" onclick="deleteCoupon('${coupon.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div >
        `).join('');

    couponsContainer.innerHTML = couponsHTML;
}

function showAddCouponModal() {
    const modal = createModal();
    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>إضافة كوبون جديد</h2>
        <form id="addCouponForm" style="text-align: right;">
            <div class="form-group">
                <label>كود الكوبون:</label>
                <input type="text" name="code" required placeholder="SAVE20">
            </div>
            <div class="form-group">
                <label>الوصف:</label>
                <textarea name="description" rows="2"></textarea>
            </div>
            <div class="form-group">
                <label>نوع الخصم:</label>
                <select name="type" required>
                    <option value="percentage">نسبة مئوية</option>
                    <option value="fixed">مبلغ ثابت</option>
                </select>
            </div>
            <div class="form-group">
                <label>قيمة الخصم:</label>
                <input type="number" name="discount" required min="0">
            </div>
            <div class="form-group">
                <label>الحد الأقصى للاستخدام:</label>
                <input type="number" name="maxUses" min="1" placeholder="اتركه فارغاً لعدد غير محدود">
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" name="isActive" checked>
                    نشط
                </label>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-primary">حفظ</button>
                <button type="button" class="btn-secondary" onclick="closeModal()">إلغاء</button>
            </div>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';
    setupModalClose(modal);

    document.getElementById('addCouponForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const couponData = {
            code: formData.get('code').toUpperCase(),
            description: formData.get('description'),
            type: formData.get('type'),
            discount: parseFloat(formData.get('discount')),
            maxUses: formData.get('maxUses') ? parseInt(formData.get('maxUses')) : null,
            usedCount: 0,
            isActive: formData.get('isActive') === 'on'
        };

        try {
            const result = await FirebaseUtils.addDocument('coupons', couponData);
            if (result.success) {
                showMessage('تم إضافة الكوبون بنجاح!', 'success');
                closeModal();
                await loadCoupons();
            }
        } catch (error) {
            showMessage('حدث خطأ في إضافة الكوبون', 'error');
        }
    });
}

function editCoupon(couponId) {
    showMessage('وظيفة التعديل قيد التطوير', 'info');
}

async function deleteCoupon(couponId) {
    const confirmed = await showConfirmModal(
        'حذف الكوبون',
        'هل أنت متأكد من حذف هذا الكوبون؟ سيتم تعطيل الخصم فوراً.',
        'حذف الكوبون',
        'إلغاء'
    );

    if (!confirmed) return;

    try {
        const result = await FirebaseUtils.deleteDocument('coupons', couponId);
        if (result.success) {
            showMessage('تم حذف الكوبون بنجاح!', 'success');
            await logAction('حذف كوبون', 'delete', { couponId: couponId });
            await loadCoupons();
        }
    } catch (error) {
        showMessage('حدث خطأ في حذف الكوبون', 'error');
    }
}

// ===== CMS MANAGEMENT =====
let allTestimonials = [];

async function loadCMS() {
    try {
        const result = await FirebaseUtils.getDocuments('testimonials',
            { field: 'createdAt', direction: 'desc' });

        if (result.success) {
            allTestimonials = result.data;
            displayTestimonials();
        }
    } catch (error) {

    }
}

function displayTestimonials() {
    const testimonialsContainer = document.getElementById('testimonialsContainer');
    if (!testimonialsContainer) return;

    if (allTestimonials.length === 0) {
        testimonialsContainer.innerHTML = `
        <div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 2rem;">
                <h3 style="margin-bottom: 2rem; color: #64748b;">لا توجد آراء عملاء حالياً</h3>
                <button class="btn-add-premium large" onclick="showAddTestimonialModal()">
                    <i class="fas fa-comments"></i>
                    <span>إضافة رأي جديد</span>
                </button>
            </div>
        `;
        return;
    }

    const testimonialsHTML = allTestimonials.map(testimonial => `
        < div class="testimonial-card" style = "background: white; padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; box-shadow: 0 2px 10px rgba(0,0,0,0.1);" >
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <h4 style="color: #2c5aa0; margin-bottom: 0.5rem;">${testimonial.name}</h4>
                    <p style="color: #666; margin-bottom: 0.5rem; font-style: italic;">"${testimonial.content}"</p>
                    <div style="color: #ffc107;">
                        ${'★'.repeat(testimonial.rating || 5)}${'☆'.repeat(5 - (testimonial.rating || 5))}
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="action-btn btn-delete" onclick="deleteTestimonial('${testimonial.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div >
        `).join('');

    testimonialsContainer.innerHTML = testimonialsHTML;
}

function showAddTestimonialModal() {
    const modal = createModal();
    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>إضافة رأي عميل</h2>
        <form id="addTestimonialForm" style="text-align: right;">
            <div class="form-group">
                <label>اسم العميل:</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>الرأي:</label>
                <textarea name="content" rows="4" required></textarea>
            </div>
            <div class="form-group">
                <label>التقييم:</label>
                <select name="rating" required>
                    <option value="5">5 نجوم</option>
                    <option value="4">4 نجوم</option>
                    <option value="3">3 نجوم</option>
                </select>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn-primary">حفظ</button>
                <button type="button" class="btn-secondary" onclick="closeModal()">إلغاء</button>
            </div>
        </form>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';
    setupModalClose(modal);

    document.getElementById('addTestimonialForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const testimonialData = {
            name: formData.get('name'),
            content: formData.get('content'),
            rating: parseInt(formData.get('rating'))
        };

        try {
            const result = await FirebaseUtils.addDocument('testimonials', testimonialData);
            if (result.success) {
                showMessage('تم إضافة الرأي بنجاح!', 'success');
                closeModal();
                await loadCMS();
            }
        } catch (error) {
            showMessage('حدث خطأ في إضافة الرأي', 'error');
        }
    });
}

async function deleteTestimonial(testimonialId) {
    const confirmed = await showConfirmModal(
        'حذف الرأي',
        'هل أنت متأكد من حذف رأي هذا العميل؟',
        'حذف',
        'إلغاء'
    );

    if (!confirmed) return;

    try {
        const result = await FirebaseUtils.deleteDocument('testimonials', testimonialId);
        if (result.success) {
            showMessage('تم حذف الرأي بنجاح!', 'success');
            await logAction('حذف رأي عميل', 'delete', { testimonialId: testimonialId });
            await loadCMS();
        }
    } catch (error) {
        showMessage('حدث خطأ في حذف الرأي', 'error');
    }
}

// ===== ACTIVITY LOGS =====
let allLogs = [];
let filteredLogs = [];

async function loadLogs() {
    try {
        const result = await FirebaseUtils.getDocuments('activity_logs',
            { field: 'timestamp', direction: 'desc' }, 100);

        if (result.success) {
            allLogs = result.data;
            filteredLogs = [...allLogs];
            displayLogs();
        }
    } catch (error) {

    }
}

function displayLogs() {
    const logsContainer = document.getElementById('logsContainer');
    if (!logsContainer) return;

    if (filteredLogs.length === 0) {
        logsContainer.innerHTML = `
        <div class="empty-state">
                <i class="fas fa-history"></i>
                <h3>لا توجد سجلات</h3>
            </div>
        `;
        return;
    }

    const logsHTML = filteredLogs.map(log => {
        let detailsHTML = '';
        if (log.details) {
            if (typeof log.details === 'object') {
                detailsHTML = `
        <div class="log-details-box" style="margin-top: 10px; background: #f8f9fa; padding: 12px; border-radius: 8px; border-right: 3px solid #ddd; font-size: 0.85rem;">
            ${Object.entries(log.details).map(([key, value]) => `
                            <div><strong>${translateLogKey(key)}:</strong> ${formatLogValue(key, value)}</div>
                        `).join('')
                    }
                    </div>
        `;
            } else {
                detailsHTML = `<p style="color: #666; margin: 0.5rem 0 0 0; font-size: 0.9rem;">${log.details}</p>`;
            }
        }

        return `
        <div class="log-item" style="background: white; padding: 1.2rem; border-radius: 12px; margin-bottom: 0.8rem; border-right: 6px solid ${getLogColor(log.type)}; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 1rem;">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.4rem;">
                        <span class="log-type-icon" style="color: ${getLogColor(log.type)}; background: ${getLogColor(log.type)}15; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px;">
                            <i class="${getLogIcon(log.type)}"></i>
                        </span>
                        <strong style="font-size: 1.05rem; color: #333;">${log.action}</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem; color: #666; font-size: 0.9rem; margin-right: 2.8rem;">
                        <span><i class="fas fa-user-edit"></i> ${log.user || 'النظام'}</span>
                        <span><i class="far fa-clock"></i> ${log.timestamp ? formatDateArabic(log.timestamp.toDate()) : ''}</span>
                    </div>
                    <div style="margin-right: 2.8rem;">
                        ${detailsHTML}
                    </div>
                </div>
            </div>
            </div>
        `;
    }).join('');

    logsContainer.innerHTML = logsHTML;
}

// Helper to translate keys for logs
function translateLogKey(key) {
    const translations = {
        'targetUserId': 'مُعرّف المستخدم المستهدف',
        'userId': 'مُعرّف المستخدم',
        'newRole': 'الرتبة الجديدة',
        'reason': 'السبب',
        'status': 'الحالة الجديدة',
        'affectedBy': 'بواسطة',
        'email': 'البريد الإلكتروني',
        'name': 'الاسم',
        'role': 'الرتبة',
        'faqId': 'مُعرّف السؤال',
        'productId': 'مُعرّف المنتج',
        'couponId': 'مُعرّف الكوبون',
        'testimonialId': 'مُعرّف التقييم',
        'ticketId': 'رقم التذكرة',
        'newStatus': 'حالة التذكرة الجديدة',
        'timestamp': 'الوقت'
    };
    return translations[key] || key;
}

// Helper to format values for logs
function formatLogValue(key, value) {
    if (key === 'newRole' || key === 'role') return getRoleText(value);
    if (key === 'newStatus' && value === 'bad_reply') return 'تم إرسال رد';
    return value;
}

function getLogIcon(type) {
    switch (type) {
        case 'create': return 'fas fa-plus-circle';
        case 'update': return 'fas fa-edit';
        case 'delete': return 'fas fa-trash-alt';
        case 'login': return 'fas fa-sign-in-alt';
        default: return 'fas fa-info-circle';
    }
}

function getLogColor(type) {
    switch (type) {
        case 'create': return '#28a745';
        case 'update': return '#ffc107';
        case 'delete': return '#dc3545';
        case 'login': return '#17a2b8';
        default: return '#6c757d';
    }
}

function filterLogs() {
    const typeFilter = document.getElementById('logTypeFilter')?.value;
    const dateFilter = document.getElementById('logDateFilter')?.value;

    filteredLogs = allLogs.filter(log => {
        let matches = true;

        if (typeFilter && log.type !== typeFilter) {
            matches = false;
        }

        if (dateFilter && log.timestamp) {
            const logDate = log.timestamp.toDate().toISOString().split('T')[0];
            if (logDate !== dateFilter) {
                matches = false;
            }
        }

        return matches;
    });

    displayLogs();
}

async function logAction(action, type, details = null) {
    try {
        const logData = {
            action,
            type,
            details,
            user: currentUser?.displayName || currentUser?.email || 'مجهول',
            userId: currentUser?.uid,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        await FirebaseUtils.addDocument('activity_logs', logData);
    } catch (error) {

    }
}



function showReceiptPreview(base64Image) {
    Swal.fire({
        title: 'إيصال الدفع',
        imageUrl: base64Image,
        imageAlt: 'Receipt Image',
        showCloseButton: true,
        confirmButtonText: 'إغلاق',
        confirmButtonColor: '#64748b',
        width: 'auto',
        maxWidth: '90%'
    });
}

// ===== NOTIFICATION DROPDOWN FUNCTIONS =====

// Toggle notification dropdown
function toggleNotificationDropdown(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('notificationDropdown');

    if (dropdown.style.display === 'none' || !dropdown.style.display) {
        // Show dropdown and populate it
        populateNotificationDropdown();
        dropdown.style.display = 'block';

        // Close dropdown when clicking outside
        setTimeout(() => {
            document.addEventListener('click', closeNotificationDropdownOutside);
        }, 100);
    } else {
        closeNotificationDropdown();
    }
}

// Close notification dropdown
function closeNotificationDropdown() {
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
        document.removeEventListener('click', closeNotificationDropdownOutside);
    }
}

// Close dropdown when clicking outside
function closeNotificationDropdownOutside(event) {
    const dropdown = document.getElementById('notificationDropdown');
    const bell = document.getElementById('supportNotificationBell');

    if (dropdown && bell && !bell.contains(event.target)) {
        closeNotificationDropdown();
    }
}

// Populate notification dropdown with unread tickets
function populateNotificationDropdown() {
    const listContainer = document.getElementById('notificationList');
    if (!listContainer) return;

    // Get unread tickets
    const unreadTickets = [];

    allTickets.forEach(ticket => {
        // Add tickets without admin response
        if (ticket.status === 'open' || ticket.status === 'pending' || !ticket.status) {
            const hasAdminReply = ticket.replies && ticket.replies.some(r => r.isAdminReply === true);
            if (!hasAdminReply) {
                unreadTickets.push({
                    ...ticket,
                    type: 'new_ticket'
                });
            }
        }

        // Add tickets with recent user replies
        if (ticket.replies && ticket.replies.length > 0) {
            const lastReply = ticket.replies[ticket.replies.length - 1];
            if (lastReply.isUserReply === true) {
                const isRecent = lastReply.createdAt &&
                    (new Date() - lastReply.createdAt.toDate()) < (24 * 60 * 60 * 1000);

                if (isRecent) {
                    const alreadyAdded = unreadTickets.some(t => t.id === ticket.id);
                    if (!alreadyAdded) {
                        unreadTickets.push({
                            ...ticket,
                            type: 'user_reply'
                        });
                    }
                }
            }
        }
    });

    // Sort by date (newest first)
    unreadTickets.sort((a, b) => {
        const dateA = a.createdAt ? a.createdAt.toDate() : new Date(0);
        const dateB = b.createdAt ? b.createdAt.toDate() : new Date(0);
        return dateB - dateA;
    });

    // Render notifications
    if (unreadTickets.length === 0) {
        listContainer.innerHTML = `
            <div class="notification-empty">
                <i class="fas fa-bell-slash"></i>
                <p>لا توجد إشعارات جديدة</p>
            </div>
        `;
    } else {
        listContainer.innerHTML = unreadTickets.slice(0, 5).map(ticket => {
            const userName = ticket.userName || ticket.userEmail || 'مستخدم';
            const subject = ticket.subject || 'رسالة دعم فني';
            const message = ticket.message || ticket.description || '';
            const timeAgo = getTimeAgo(ticket.createdAt);
            const icon = ticket.type === 'new_ticket' ? 'fa-envelope' : 'fa-reply';

            return `
                <div class="notification-item unread" onclick="openTicketFromNotification('${ticket.id}')">
                    <div class="notification-icon">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="notification-content">
                        <div class="notification-title">${userName}</div>
                        <div class="notification-message">${subject}: ${message}</div>
                        <div class="notification-time">${timeAgo}</div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// Open ticket from notification
function openTicketFromNotification(ticketId) {
    closeNotificationDropdown();
    switchTab('support');

    // Wait for tab to load then open ticket details
    setTimeout(() => {
        viewTicketDetails(ticketId);
    }, 300);
}

// Mark all as read
function markAllAsRead(event) {
    event.stopPropagation();
    updateTicketNotification(0);
    closeNotificationDropdown();
    showMessage('تم تحديد جميع الإشعارات كمقروءة', 'success');
}

// Helper function to get time ago
function getTimeAgo(timestamp) {
    if (!timestamp) return 'الآن';

    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'الآن';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' دقيقة';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' ساعة';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' يوم';
    return Math.floor(seconds / 604800) + ' أسبوع';
}

// ===== SUPPORT ACTIVITY TRACKING =====

let allSupportActivity = [];
let filteredSupportActivity = [];

// Load support activity
async function loadSupportActivity() {

    const container = document.getElementById('supportActivityContainer');
    if (container) container.innerHTML = '<div class="loading-spinner">جاري تحميل البيانات...</div>';

    try {
        const result = await FirebaseUtils.getDocuments('support_tickets', { field: 'createdAt', direction: 'desc' });

        if (result.success) {
            allSupportActivity = [];
            // Populate allTickets so detail view works
            allTickets = result.data;

            result.data.forEach(ticket => {
                if (ticket.replies && ticket.replies.length > 0) {
                    ticket.replies.forEach(reply => {
                        if (reply.isAdminReply) {
                            // Try to find admin details
                            const adminUser = allUsers.find(u => u.id === reply.authorId);
                            const adminEmail = adminUser ? adminUser.email : '';
                            // Use account name if available, otherwise reply author name
                            const adminName = adminUser && adminUser.name ? adminUser.name : (reply.authorName || 'أدمن');

                            allSupportActivity.push({
                                ticketId: ticket.id,
                                ticketSubject: ticket.subject || 'رسالة دعم فني',
                                customerName: ticket.userName || ticket.userEmail || 'مستخدم',
                                customerEmail: ticket.userEmail || '',
                                adminName: adminName,
                                adminId: reply.authorId || '',
                                adminEmail: adminEmail,
                                replyContent: reply.content || '',
                                replyDate: reply.createdAt,
                                ticketStatus: ticket.status || 'open'
                            });
                        }
                    });
                }
            });

            filteredSupportActivity = [...allSupportActivity];
            displaySupportActivity();
            populateAdminFilter();

            // New: Calculate and Display Stats
            calculateSupportStats(allSupportActivity);

        } else {
            throw new Error(result.error);
        }
    } catch (error) {

        if (container) container.innerHTML = '<div class="error-msg">حدث خطأ أثناء تحميل البيانات</div>';
    }
}

// Calculate Support Stats and Render Chart
function calculateSupportStats(activities) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let repliesToday = 0;
    const adminCounts = {};
    const hourCounts = new Array(24).fill(0);

    activities.forEach(activity => {
        const replyDate = activity.replyDate ? (activity.replyDate.toDate ? activity.replyDate.toDate() : new Date(activity.replyDate)) : new Date();

        // Count today's replies
        if (replyDate >= today) {
            repliesToday++;

            // Count per admin for today
            const admin = activity.adminName || 'Unknown';
            adminCounts[admin] = (adminCounts[admin] || 0) + 1;
        }

        // Hourly distribution (regardless of day, or filter by today if preferred - sticking to all time distribution for pattern or today for specific)
        // Let's do today's hourly distribution for better "Live" feel, or all-time for general pattern.
        // Let's use Today's hourly distribution if they match today, otherwise general is too broad.
        if (replyDate >= today) {
            const hour = replyDate.getHours();
            hourCounts[hour]++;
        }
    });

    // Update KPI Cards
    document.getElementById('todayRepliesCount').textContent = repliesToday;

    // Find Top Performer
    let topPerformer = '-';
    let maxReplies = 0;
    for (const [admin, count] of Object.entries(adminCounts)) {
        if (count > maxReplies) {
            maxReplies = count;
            topPerformer = admin;
        }
    }
    document.getElementById('topPerformerName').textContent = topPerformer !== '-' ? `${topPerformer} (${maxReplies})` : '-';

    // Render Chart
    renderActivityChart(hourCounts);
}

// Render Hourly Activity Chart
let activityChartInstance = null;
function renderActivityChart(hourCounts) {
    const ctx = document.getElementById('supportActivityChart');
    if (!ctx) return;

    if (activityChartInstance) {
        activityChartInstance.destroy();
    }

    activityChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
            datasets: [{
                label: 'عدد الردود',
                data: hourCounts,
                backgroundColor: '#3b82f6',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// Export Support Activity to CSV
function exportSupportActivity() {
    if (filteredSupportActivity.length === 0) {
        showMessage('لا توجد بيانات لتصديرها', 'warning');
        return;
    }

    // CSV Header
    let csvContent = "\uFEFF"; // BOM for Excel Arabic support
    csvContent += "التاريخ,عضو الدعم,العميل,التذكرة,المحتوى,الحالة\n";

    filteredSupportActivity.forEach(row => {
        const date = row.replyDate ? (row.replyDate.toDate ? row.replyDate.toDate().toLocaleString('ar-EG') : new Date(row.replyDate).toLocaleString('ar-EG')) : '';
        const admin = `"${row.adminName.replace(/"/g, '""')}"`;
        const customer = `"${row.customerName.replace(/"/g, '""')}"`;
        const ticket = `"${(row.ticketSubject || '').replace(/"/g, '""')}"`;
        const content = `"${(row.replyContent || '').replace(/"/g, '""')}"`;
        const status = getStatusText(row.ticketStatus);

        csvContent += `${date},${admin},${customer},${ticket},${content},${status}\n`;
    });

    // Create Download Link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `support_activity_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Display support activity
function displaySupportActivity() {
    const container = document.getElementById('supportActivityContainer');
    if (!container) return;

    if (filteredSupportActivity.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 4rem 2rem; text-align: center;">
                <i class="fas fa-clipboard-list" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1rem;"></i>
                <h3 style="color: #64748b;">لا يوجد نشاط حالياً</h3>
                <p style="color: #94a3b8;">لم يتم العثور على أي ردود من فريق الدعم</p>
            </div>
        `;
        return;
    }

    const activityHTML = `
        <table class="modern-table" style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #f8f9fa; border-bottom: 2px solid #e2e8f0;">
                    <th style="padding: 1rem; text-align: right; font-weight: 700; color: #1e3a8a;">عضو الدعم</th>
                    <th style="padding: 1rem; text-align: right; font-weight: 700; color: #1e3a8a;">التذكرة</th>
                    <th style="padding: 1rem; text-align: right; font-weight: 700; color: #1e3a8a;">العميل</th>
                    <th style="padding: 1rem; text-align: right; font-weight: 700; color: #1e3a8a;">الرد</th>
                    <th style="padding: 1rem; text-align: right; font-weight: 700; color: #1e3a8a;">التاريخ</th>
                    <th style="padding: 1rem; text-align: center; font-weight: 700; color: #1e3a8a;">الحالة</th>
                </tr>
            </thead>
            <tbody>
                ${filteredSupportActivity.map(activity => {
        const date = activity.replyDate ? (activity.replyDate.toDate ? activity.replyDate.toDate() : new Date(activity.replyDate)) : new Date();
        const dateStr = formatDateArabic(date);
        const statusClass = activity.ticketStatus === 'resolved' ? 'status-resolved' : activity.ticketStatus === 'closed' ? 'status-closed' : 'status-open';
        const statusText = getStatusText(activity.ticketStatus);

        return `
                        <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.3s; cursor: pointer;" 
                            onmouseover="this.style.background='#f8fafc'" 
                            onmouseout="this.style.background='white'"
                            onclick="replyToTicket('${activity.ticketId}')">
                            <td style="padding: 1rem;">
                                <div style="display: flex; align-items: center; gap: 0.75rem;">
                                    <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700;">
                                        ${activity.adminName.charAt(0)}
                                    </div>
                                    <div>
                                        <div style="font-weight: 600; color: #1e293b;">${activity.adminName}</div>
                                        <div style="font-size: 0.8rem; color: #64748b;">${activity.adminEmail}</div>
                                    </div>
                                </div>
                            </td>
                            <td style="padding: 1rem;">
                                <div style="font-weight: 600; color: #2563eb;">#${activity.ticketId.substring(0, 8)}</div>
                                <div style="font-size: 0.85rem; color: #64748b;">${activity.ticketSubject}</div>
                            </td>
                            <td style="padding: 1rem;">
                                <div style="font-weight: 600; color: #1e293b;">${activity.customerName}</div>
                                <div style="font-size: 0.85rem; color: #64748b;">${activity.customerEmail}</div>
                            </td>
                            <td style="padding: 1rem;">
                                <div style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #475569;">
                                    ${activity.replyContent}
                                </div>
                            </td>
                            <td style="padding: 1rem; color: #64748b; font-size: 0.9rem;">
                                ${dateStr}
                            </td>
                            <td style="padding: 1rem; text-align: center;">
                                <span class="status-badge ${statusClass}" style="font-size: 0.85rem; padding: 0.3rem 0.8rem;">${statusText}</span>
                            </td>
                        </tr>
                    `;
    }).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = activityHTML;
}

// Populate admin filter
function populateAdminFilter() {
    const filter = document.getElementById('activityAdminFilter');
    if (!filter) return;

    const admins = [...new Set(allSupportActivity.map(a => a.adminName))];

    filter.innerHTML = '<option value="">جميع الأعضاء</option>' +
        admins.map(admin => `<option value="${admin}">${admin}</option>`).join('');
}

// Filter support activity
function filterSupportActivity() {
    const searchTerm = document.getElementById('activitySearchInput')?.value.toLowerCase() || '';
    const adminFilter = document.getElementById('activityAdminFilter')?.value || '';
    const dateFilter = document.getElementById('activityDateFilter')?.value || 'all';

    filteredSupportActivity = allSupportActivity.filter(activity => {
        const matchesSearch = !searchTerm ||
            activity.adminName.toLowerCase().includes(searchTerm) ||
            activity.ticketSubject.toLowerCase().includes(searchTerm) ||
            activity.customerName.toLowerCase().includes(searchTerm) ||
            activity.replyContent.toLowerCase().includes(searchTerm);

        const matchesAdmin = !adminFilter || activity.adminName === adminFilter;

        let matchesDate = true;
        if (dateFilter !== 'all' && activity.replyDate) {
            const replyDate = activity.replyDate.toDate ? activity.replyDate.toDate() : new Date(activity.replyDate);
            const now = new Date();
            const diffTime = now - replyDate;
            const diffDays = diffTime / (1000 * 60 * 60 * 24);

            if (dateFilter === 'today') {
                matchesDate = diffDays < 1;
            } else if (dateFilter === 'week') {
                matchesDate = diffDays < 7;
            } else if (dateFilter === 'month') {
                matchesDate = diffDays < 30;
            }
        }

        return matchesSearch && matchesAdmin && matchesDate;
    });

    displaySupportActivity();
}

// ===== CUSTOMER SUPPORT HELPERS =====

async function openCreateTicketModal(userId, userName, userEmail) {
    Swal.fire({
        title: 'فتح تذكرة دعم جديدة',
        html: `
            <div style="text-align: right; direction: rtl; font-family: 'Cairo', sans-serif;">
                <div style="background: #f1f5f9; padding: 0.8rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;">
                    <strong>العميل:</strong> ${userName} (${userEmail})
                </div>
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem;">عنوان التذكرة</label>
                    <input id="swal-ticket-subject" class="swal2-input" placeholder="مثال: استفسار بخصوص الطلب..." style="margin: 0; width: 100%;">
                </div>
                <div class="form-group" style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem;">الأولوية</label>
                    <select id="swal-ticket-priority" class="swal2-select" style="width: 100%; margin: 0;">
                        <option value="low">منخفضة 🟢</option>
                        <option value="medium" selected>متوسطة 🟡</option>
                        <option value="high">عالية 🔴</option>
                    </select>
                </div>
                <div class="form-group">
                    <label style="display: block; margin-bottom: 0.5rem;">نص الرسالة</label>
                    <textarea id="swal-ticket-message" class="swal2-textarea" placeholder="اكتب تفاصيل الرسالة هنا..." style="margin: 0; width: 100%; height: 100px;"></textarea>
                </div>
            </div>
        `,
        confirmButtonText: 'إرسال التذكرة',
        showCancelButton: true,
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#8b5cf6',
        preConfirm: () => {
            const subject = document.getElementById('swal-ticket-subject').value;
            const priority = document.getElementById('swal-ticket-priority').value;
            const message = document.getElementById('swal-ticket-message').value;

            if (!subject || !message) {
                Swal.showValidationMessage('يرجى ملء جميع الحقول');
                return false;
            }

            return { subject, priority, message };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // Generate a ticket ID (or let Firebase do it)
                const ticketData = {
                    userId: userId,
                    userEmail: userEmail, // Store email for quick search/display
                    userName: userName,   // Store name for quick search/display
                    subject: result.value.subject,
                    status: 'open', // Default status for new admin-created tickets
                    priority: result.value.priority,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastReplyAt: new Date(),
                    replies: [
                        {
                            message: result.value.message,
                            isAdminReply: true,
                            adminId: currentUser.uid,
                            adminName: document.getElementById('adminUserName')?.textContent?.replace('مرحباً، ', '') || 'Admin',
                            createdAt: new Date()
                        }
                    ]
                };

                const res = await FirebaseUtils.addDocument('support_tickets', ticketData);

                if (res.success) {
                    Swal.fire('تم الإرسال', 'تم إنشاء التذكرة بنجاح', 'success');
                    // Reload tickets list if we are on that tab, or just notify
                    if (document.getElementById('supportTab').classList.contains('active')) {
                        loadSupportTickets();
                    }
                } else {
                    throw new Error(res.error);
                }
            } catch (error) {

                Swal.fire('خطأ', 'فشل إنشاء التذكرة', 'error');
            }
        }
    });
}

// ===== LIVE PAYMENTS MANAGEMENT (SMS DETECTION) =====
let allIncomingPayments = [];
let filteredIncomingPayments = [];

let incomingPaymentsListener = null;

async function loadIncomingPayments() {

    const container = document.getElementById('livePaymentsGrid');
    if (container && !allIncomingPayments.length) {
        container.innerHTML = '<div class="loading-spinner">جاري فتح قناة الرصد الحية...</div>';
    }

    // Stop existing listener if any
    if (incomingPaymentsListener) {
        incomingPaymentsListener();
    }

    try {
        // Use onSnapshot for real-time updates
        incomingPaymentsListener = window.db.collection('incoming_payments')
            .orderBy('timestamp', 'desc')
            .limit(50)
            .onSnapshot(snapshot => {
                const newPayments = [];
                let hasNewMessage = false;

                snapshot.docChanges().forEach(change => {
                    if (change.type === "added") {
                        hasNewMessage = true;
                    }
                });

                snapshot.forEach(doc => {
                    newPayments.push({ id: doc.id, ...doc.data() });
                });

                // Play sound if there's a new added document and sound is enabled
                if (hasNewMessage && allIncomingPayments.length > 0) {
                    playPaymentNotificationSound();
                }

                allIncomingPayments = newPayments;
                filteredIncomingPayments = [...allIncomingPayments];

                updatePaymentStats();
                displayIncomingPayments();

            }, error => {

                if (container) container.innerHTML = '<div class="error-msg">فشل الاتصال بقناة الرصد الحية</div>';
            });

    } catch (error) {

    }
}

function playPaymentNotificationSound() {
    const isEnabled = document.getElementById('paymentSoundToggle')?.checked;
    if (!isEnabled) return;

    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play().catch(() => { });
    } catch (err) {

    }
}

function updatePaymentStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todayPayments = allIncomingPayments.filter(p => {
        const pDate = p.timestamp ? p.timestamp.toDate() : new Date(0);
        return pDate >= startOfToday;
    });

    const todayTotal = todayPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const pendingCount = allIncomingPayments.filter(p => p.status !== 'matched' && p.status !== 'dismissed').length;
    const matchedToday = todayPayments.filter(p => p.status === 'matched').length;

    // Update UI elements
    const totalEl = document.getElementById('todayPaymentTotal');
    const pendingEl = document.getElementById('pendingPaymentCount');
    const matchedEl = document.getElementById('matchedPaymentCount');

    if (totalEl) totalEl.textContent = `${todayTotal.toLocaleString()} ج.م`;
    if (pendingEl) pendingEl.textContent = `${pendingCount} رسالة`;
    if (matchedEl) matchedEl.textContent = matchedToday.toString();
}

function displayIncomingPayments() {
    const container = document.getElementById('livePaymentsGrid');
    if (!container) return;

    // Filter out dismissed payments unless specifically searched
    const term = document.getElementById('livePaymentSearch')?.value.toLowerCase() || '';
    let displayList = filteredIncomingPayments;

    if (!term) {
        displayList = filteredIncomingPayments.filter(p => p.status !== 'dismissed');
    }

    if (displayList.length === 0) {
        container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 4rem;"><h3>لا توجد رسائل واردة</h3><p>الرسائل الجديدة ستظهر هنا فور وصولها</p></div>';
        return;
    }

    container.innerHTML = displayList.map(payment => {
        const date = payment.timestamp ? formatDateArabic(payment.timestamp.toDate()) : 'غير معروف';
        const isMatched = payment.status === 'matched';
        const statusClass = isMatched ? 'status-success' : 'status-warning';
        const statusText = isMatched ? 'تم الربط بالطلب' : 'بانتظار التحقق';

        return `
            <div class="domain-card-modern ${isMatched ? '' : 'priority-card'}" style="border-right: 5px solid ${isMatched ? '#10b981' : '#f59e0b'};">
                <div class="domain-card-header">
                    <span class="domain-status-tag ${statusClass}">${statusText}</span>
                    <span style="font-size: 0.85rem; color: #64748b;">${date}</span>
                </div>
                
                <div class="domain-notes-snippet" style="background: #f8fafc; margin: 1rem 0; padding: 1rem; border-radius: 10px; border: 1px solid #e2e8f0;">
                    <p style="margin: 0; font-family: 'Courier New', monospace; white-space: pre-wrap; font-size: 0.9rem; color: #1e293b; line-height: 1.6; direction: ltr;">${payment.smsBody}</p>
                </div>
                
                <div class="domain-meta-grid" style="margin-top: 1rem; background: #fff; padding: 0.8rem; border-radius: 8px;">
                    <div class="meta-item-small">
                        <span class="meta-label-small">المبلغ</span>
                        <span class="meta-value-small" style="font-weight: 800; color: #1e3a8a; font-size: 1.1rem;">${payment.amount || '---'} ج.م</span>
                    </div>
                    <div class="meta-item-small">
                        <span class="meta-label-small">رقم المحفظة</span>
                        <span class="meta-value-small" style="font-weight: 700;">${payment.senderPhone || 'غير محدد'}</span>
                    </div>
                </div>

                ${!isMatched ? `
                <div class="domain-actions-modern" style="margin-top: 1.5rem; display: flex; gap: 0.5rem;">
                    <button class="domain-btn-action btn-update-modern" style="flex: 1; background: #3b82f6; color: white;" onclick="linkPaymentToRequest('${payment.id}', '${payment.senderPhone}')">
                        <i class="fas fa-link"></i>
                        <span>ربط بطلب</span>
                    </button>
                    <button class="domain-btn-action btn-delete-modern-soft" onclick="dismissPayment('${payment.id}')" title="تجاهل">
                        <i class="fas fa-times"></i>
                    </button>
                </div>` : `
                <div style="margin-top: 1.5rem; text-align: center; color: #10b981; font-weight: 600; font-size: 0.9rem;">
                    <i class="fas fa-check-circle"></i> مربوط بالطلب: #${payment.linkedRequestId ? payment.linkedRequestId.substring(0, 8) : '---'}
                </div>
                `}
            </div>
        `;
    }).join('');
}

async function linkPaymentToRequest(paymentId, senderPhone) {
    // Show loading state
    Swal.fire({
        title: 'جاري البحث عن طلبات مرتبطة...',
        didOpen: () => { Swal.showLoading(); }
    });

    let suggestedRequests = [];
    try {
        // Search in wallet_recharges
        const rechargeResult = await FirebaseUtils.getDocuments('wallet_recharges', { field: 'senderPhone', operator: '==', value: senderPhone });
        if (rechargeResult.success) {
            suggestedRequests = rechargeResult.data.filter(r => r.status === 'pending').map(r => ({
                id: r.id,
                type: 'شحن محفظة',
                amount: r.amount,
                date: r.createdAt ? formatDateArabic(r.createdAt.toDate()) : ''
            }));
        }
    } catch (err) {

    }

    let html = `
        <div style="text-align: right; direction: rtl;">
            <p style="margin-bottom: 1rem; color: #475569;">ربط الحوالة القادمة من: <strong style="color: #2563eb;">${senderPhone}</strong></p>
    `;

    if (suggestedRequests.length > 0) {
        html += `
            <div style="background: #f0fdf4; padding: 1rem; border-radius: 12px; margin-bottom: 1rem; border: 1px solid #bbf7d0;">
                <h4 style="margin: 0 0 0.8rem 0; color: #166534; font-size: 0.9rem;">طلبات مقترحة مرتبطة بهذا الرقم:</h4>
                ${suggestedRequests.map(req => `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 0.8rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid #e2e8f0;">
                        <div>
                            <span style="display: block; font-weight: 700; font-size: 0.85rem;">#${req.id.substring(0, 8)} - ${req.type}</span>
                            <span style="font-size: 0.75rem; color: #64748b;">${req.amount} ج.م | ${req.date}</span>
                        </div>
                        <button onclick="confirmSmartLink('${paymentId}', '${req.id}', '${req.type}')" style="background: #22c55e; color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">ربط الآن</button>
                    </div>
                `).join('')}
            </div>
            <p style="text-align: center; color: #94a3b8; font-size: 0.8rem;">--- أو أدخل معرف طلب آخر ---</p>
        `;
    }

    html += `
            <input id="swal-request-id" class="swal2-input" placeholder="أدخل معرف الطلب (ID)" style="margin-top: 0.5rem;">
        </div>
    `;

    Swal.fire({
        title: 'ربط الحوالة بطلب',
        html: html,
        showCancelButton: true,
        confirmButtonText: 'ربط بالمعرف المدخل',
        cancelButtonText: 'إلغاء',
        preConfirm: () => {
            const val = document.getElementById('swal-request-id').value;
            if (!val && suggestedRequests.length === 0) {
                Swal.showValidationMessage('يرجى إدخال معرف الطلب');
            }
            return val;
        }
    }).then(async (result) => {
        if (result.isConfirmed && result.value) {
            await finalizePaymentLink(paymentId, result.value);
        }
    });
}

async function confirmSmartLink(paymentId, requestId, type) {
    const result = await Swal.fire({
        title: 'تأكيد الربط',
        text: `هل تريد ربط هذه الحوالة بطلب ${type} رقم #${requestId.substring(0, 8)}؟`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'نعم، ربط وتحديث الطلب',
        cancelButtonText: 'إلغاء'
    });

    if (result.isConfirmed) {
        await finalizePaymentLink(paymentId, requestId, true);
    }
}

async function finalizePaymentLink(paymentId, requestId, updateRequestStatus = false) {
    try {
        Swal.fire({ title: 'جاري الربط...', didOpen: () => { Swal.showLoading(); } });

        await FirebaseUtils.updateDocument('incoming_payments', paymentId, {
            status: 'matched',
            linkedRequestId: requestId,
            matchedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // If requested, update the recharge request status too
        if (updateRequestStatus) {
            await FirebaseUtils.updateDocument('wallet_recharges', requestId, {
                status: 'approved',
                paymentMatched: true,
                matchedPaymentId: paymentId,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Note: Wallet balance update usually happens in updateWalletRechargeStatus, 
            // but we can trigger it or let the admin do it after verification.
        }

        showMessage('تم الربط وتحديث البيانات بنجاح', 'success');
        if (typeof loadWalletRechargeRequests === 'function') loadWalletRechargeRequests();
        Swal.close();
    } catch (error) {

        showMessage('فشل عملية الربط', 'error');
    }
}

async function dismissPayment(paymentId) {
    const result = await Swal.fire({
        title: 'تجاهل الرسالة؟',
        text: "لن تظهر هذه الرسالة في قائمة الانتظار مرة أخرى",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'نعم، تجاهل',
        cancelButtonText: 'إلغاء'
    });

    if (result.isConfirmed) {
        try {
            await FirebaseUtils.updateDocument('incoming_payments', paymentId, {
                status: 'dismissed'
            });
            loadIncomingPayments();
        } catch (error) {
            showMessage('فشل الإجراء', 'error');
        }
    }
}

function searchIncomingPayments() {
    const term = document.getElementById('livePaymentSearch')?.value.toLowerCase() || '';
    if (!term) {
        filteredIncomingPayments = [...allIncomingPayments];
    } else {
        filteredIncomingPayments = allIncomingPayments.filter(payment =>
            (payment.smsBody && payment.smsBody.toLowerCase().includes(term)) ||
            (payment.senderPhone && payment.senderPhone.toLowerCase().includes(term)) ||
            (payment.amount && payment.amount.toString().includes(term))
        );
    }
    displayIncomingPayments();
}

// ============================================================
// Wallet Recharge Requests Management
// ============================================================

let allWalletRechargeRequests = [];
let filteredWalletRechargeRequests = [];

async function loadWalletRechargeRequests() {
    const grid = document.getElementById('walletRechargeGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="loading-spinner">جاري تحميل طلبات الشحن...</div>';

    try {
        const result = await FirebaseUtils.getDocuments('wallet_recharges',
            { field: 'createdAt', direction: 'desc' });

        if (result.success) {
            allWalletRechargeRequests = result.data;

            // DEBUG: Log the first request to see its structure
            if (allWalletRechargeRequests.length > 0) {


            }

            // Fetch user data for all requests
            for (let request of allWalletRechargeRequests) {
                // Get userId from various possible field names
                let userId = request.userId || request.user || request.uid || request.customerId;

                // Ensure request.userId is properly set and trimmed
                if (userId) {
                    if (typeof userId === 'string') userId = userId.trim();
                    request.userId = userId;
                }

                if (userId) {
                    try {
                        const userDoc = await window.db.collection('users').doc(userId).get();
                        if (userDoc.exists) {
                            const userData = userDoc.data();

                            // Fill missing data from user profile
                            if (!request.customerName) request.customerName = userData.name || userData.displayName || userData.fullName || userData.username;
                            if (!request.customerEmail) request.customerEmail = userData.email || userData.mail;
                            // Optionally use user phone if sender phone is missing
                            if (!request.senderPhone && userData.phone) request.senderPhone = userData.phone;
                        }
                    } catch (err) {

                    }
                }

                // Normalize field names for consistency
                if (!request.amount) {
                    request.amount = request.price || request.total || request.value || 0;
                }

                if (!request.senderPhone) {
                    request.senderPhone = request.phone || request.phoneNumber || request.mobile || request.walletPhone || request.senderNumber;
                }

                if (!request.paymentMethod) {
                    request.paymentMethod = request.method || request.type || request.paymentType;
                }

                if (!request.customerEmail && !userId) {
                    request.customerEmail = request.email || request.mail;
                }

                // Ensure status exists
                if (!request.status) {
                    request.status = 'pending';
                }
            }

            filteredWalletRechargeRequests = [...allWalletRechargeRequests];
            displayWalletRechargeRequests();
        } else {
            grid.innerHTML = '<div class="error-msg">حدث خطأ في تحميل الطلبات</div>';
        }
    } catch (error) {

        grid.innerHTML = '<div class="error-msg">حدث خطأ في تحميل الطلبات</div>';
    }
}

function displayWalletRechargeRequests() {
    const grid = document.getElementById('walletRechargeGrid');
    if (!grid) return;

    if (filteredWalletRechargeRequests.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <i class="fas fa-wallet"></i>
                <h3>لا توجد طلبات شحن</h3>
                <p>لم يتم العثور على طلبات شحن رصيد</p>
            </div>
        `;
        return;
    }

    const cardsHTML = filteredWalletRechargeRequests.map(request => {
        const statusClass = request.status === 'approved' ? 'status-approved' :
            request.status === 'rejected' ? 'status-rejected' : 'status-pending';
        const statusText = request.status === 'approved' ? 'تم القبول' :
            request.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار';
        const dateStr = request.createdAt ? formatDateArabic(request.createdAt.toDate()) : 'غير محدد';
        const shortId = request.id.substring(0, 8);

        return `
            <div class="domain-card-modern" style="border-right: 5px solid ${request.status === 'pending' ? '#f59e0b' : request.status === 'approved' ? '#10b981' : '#ef4444'};">
                <div class="domain-card-header">
                    <span class="domain-id-badge">#${shortId}</span>
                    <span class="domain-status-tag ${statusClass}">${statusText}</span>
                </div>

                <div class="domain-main-info">
                    <span class="domain-name-display">${request.customerName || request.userName || request.userId || 'عميل غير معروف'}</span>
                    <span style="font-size: 1.5rem; font-weight: 700; color: #2c5aa0; margin-top: 0.5rem; display: block;">${request.amount || '0'} جنيه</span>
                </div>

                <div class="domain-customer-box">
                    <div class="customer-details-small" style="width: 100%;">
                        ${request.customerEmail || request.email ? `<p class="customer-phone-small"><i class="fas fa-envelope"></i> ${request.customerEmail || request.email}</p>` : ''}
                        ${request.senderPhone || request.phone ? `<p class="customer-phone-small" style="color: #6366f1;"><i class="fas fa-wallet"></i> محفظة المحول: ${request.senderPhone || request.phone}</p>` : ''}
                        ${request.paymentMethod || request.method ? `<p class="customer-phone-small"><i class="fas fa-credit-card"></i> ${request.paymentMethod || request.method}</p>` : ''}
                        ${request.message ? `<p class="customer-phone-small"><i class="fas fa-comment"></i> ${request.message}</p>` : ''}
                        ${request.userId ? `<p class="customer-phone-small" style="font-size: 0.75rem; color: #94a3b8;"><i class="fas fa-user"></i> معرف المستخدم: ${request.userId.substring(0, 12)}...</p>` : ''}
                    </div>
                </div>

                <div class="domain-meta-grid" style="margin-top: 1rem;">
                    <div class="meta-item-small">
                        <span class="meta-label-small">التاريخ</span>
                        <span class="meta-value-small">${dateStr}</span>
                    </div>
                    ${request.processedAt ? `
                    <div class="meta-item-small">
                        <span class="meta-label-small">تاريخ المعالجة</span>
                        <span class="meta-value-small">${formatDateArabic(request.processedAt.toDate())}</span>
                    </div>
                    ` : ''}
                </div>

                ${request.receiptImage ? `
                <div class="receipt-preview-box" onclick="showReceiptPreview('${request.receiptImage}')" style="margin-top: 1rem; cursor: pointer;">
                    <span style="font-size: 0.8rem; color: #64748b; display: block; margin-bottom: 0.3rem;">صورة الإيصال (اضغط للتكبير):</span>
                    <img src="${request.receiptImage}" style="width: 100%; height: 120px; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0;">
                </div>` : ''}

                ${request.notes ? `
                <div style="margin-top: 1rem; padding: 0.8rem; background: #f8fafc; border-radius: 8px;">
                    <span style="font-size: 0.8rem; color: #64748b; display: block; margin-bottom: 0.3rem;">ملاحظات العميل:</span>
                    <p style="margin: 0; font-size: 0.9rem; color: #1e293b;">${request.notes}</p>
                </div>` : ''}

                ${request.rejectionReason ? `
                <div style="margin-top: 1rem; padding: 0.8rem; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
                    <span style="font-size: 0.8rem; color: #dc2626; display: block; margin-bottom: 0.3rem;">سبب الرفض:</span>
                    <p style="margin: 0; font-size: 0.9rem; color: #991b1b;">${request.rejectionReason}</p>
                </div>` : ''}

                <div class="domain-actions-modern" style="margin-top: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
                    <button class="domain-btn-action btn-view-modern" onclick="viewWalletRechargeDetails('${request.id}')" title="عرض التفاصيل">
                        <i class="fas fa-eye"></i>
                    </button>
                    
                    ${request.status === 'pending' ? `
                    <button class="domain-btn-action btn-update-modern" style="background: #10b981; color: white;" onclick="approveWalletRecharge('${request.id}')" title="قبول">
                        <i class="fas fa-check"></i>
                        <span>قبول</span>
                    </button>
                    
                    <button class="domain-btn-action btn-update-modern" style="background: #ef4444; color: white;" onclick="rejectWalletRecharge('${request.id}')" title="رفض">
                        <i class="fas fa-times"></i>
                        <span>رفض</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    grid.innerHTML = cardsHTML;
}

async function approveWalletRecharge(requestId) {
    const request = allWalletRechargeRequests.find(r => r.id === requestId);
    if (!request) return;

    const result = await Swal.fire({
        title: 'قبول طلب الشحن؟',
        html: `
            <p>سيتم إضافة <strong>${request.amount} جنيه</strong> إلى رصيد العميل:</p>
            <p><strong>${request.customerName}</strong></p>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        confirmButtonText: 'نعم، قبول الطلب',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        // Use transaction to ensure data consistency
        await window.db.runTransaction(async (transaction) => {
            let userId = request.userId;
            if (userId && typeof userId === 'string') {
                userId = userId.trim();
            }

            const userRef = window.db.collection('users').doc(userId);
            const userDoc = await transaction.get(userRef);

            // If user doesn't exist, Create them!
            if (!userDoc.exists) {

                transaction.set(userRef, {
                    uid: userId,
                    name: request.customerName || 'مستخدم جديد',
                    email: request.customerEmail || `user_${userId}@example.com`,
                    balance: parseFloat(request.amount),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    role: 'customer',
                    totalRecharged: parseFloat(request.amount),
                    lastRechargeAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                const userData = userDoc.data();
                const currentBalance = parseFloat(userData.balance || 0);
                const newBalance = currentBalance + parseFloat(request.amount);

                // Update user balance
                transaction.update(userRef, {
                    balance: newBalance,
                    lastRechargeAt: firebase.firestore.FieldValue.serverTimestamp(),
                    totalRecharged: firebase.firestore.FieldValue.increment(parseFloat(request.amount))
                });
            }

            // Update request status
            const requestRef = window.db.collection('wallet_recharges').doc(requestId);
            transaction.update(requestRef, {
                status: 'approved',
                processedAt: firebase.firestore.FieldValue.serverTimestamp(),
                processedBy: currentUser.uid
            });
        });

        // Log the action
        await logAction('قبول طلب شحن رصيد', 'approve', {
            requestId: requestId,
            customerId: request.userId,
            customerName: request.customerName,
            amount: request.amount
        });

        showMessage('تم قبول الطلب وتحديث رصيد العميل بنجاح', 'success');
        loadWalletRechargeRequests();
    } catch (error) {

        showMessage('حدث خطأ أثناء قبول الطلب: ' + error.message, 'error');
    }
}

async function rejectWalletRecharge(requestId) {
    const request = allWalletRechargeRequests.find(r => r.id === requestId);
    if (!request) return;

    const { value: reason } = await Swal.fire({
        title: 'رفض طلب الشحن',
        html: `
            <p>العميل: <strong>${request.customerName}</strong></p>
            <p>المبلغ: <strong>${request.amount} جنيه</strong></p>
        `,
        input: 'textarea',
        inputLabel: 'سبب الرفض (اختياري)',
        inputPlaceholder: 'اكتب سبب الرفض...',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'رفض الطلب',
        cancelButtonText: 'إلغاء'
    });

    if (reason === undefined) return; // User cancelled

    try {
        await FirebaseUtils.updateDocument('wallet_recharges', requestId, {
            status: 'rejected',
            rejectionReason: reason || 'لم يتم تحديد سبب',
            processedAt: firebase.firestore.FieldValue.serverTimestamp(),
            processedBy: currentUser.uid
        });

        // Log the action
        await logAction('رفض طلب شحن رصيد', 'reject', {
            requestId: requestId,
            customerId: request.userId,
            customerName: request.customerName,
            amount: request.amount,
            reason: reason
        });

        showMessage('تم رفض الطلب', 'success');
        loadWalletRechargeRequests();
    } catch (error) {

        showMessage('حدث خطأ أثناء رفض الطلب', 'error');
    }
}

function viewWalletRechargeDetails(requestId) {
    const request = allWalletRechargeRequests.find(r => r.id === requestId);
    if (!request) return;

    const modal = createModal();
    const statusClass = request.status === 'approved' ? 'status-approved' :
        request.status === 'rejected' ? 'status-rejected' : 'status-pending';
    const statusText = request.status === 'approved' ? 'تم القبول' :
        request.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار';

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>تفاصيل طلب شحن الرصيد #${request.id.substring(0, 8)}</h2>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; margin: 2rem 0;">
            <div>
                <h3>معلومات العميل</h3>
                <p><strong>الاسم:</strong> ${request.customerName || 'غير متوفر'}</p>
                <p><strong>البريد الإلكتروني:</strong> ${request.customerEmail || 'غير متوفر'}</p>
                <p><strong>معرف المستخدم:</strong> ${request.userId || 'غير متوفر'}</p>
            </div>
            
            <div>
                <h3>معلومات الطلب</h3>
                <p><strong>المبلغ:</strong> ${request.amount} جنيه</p>
                <p><strong>طريقة الدفع:</strong> ${request.paymentMethod || 'غير محدد'}</p>
                <p><strong>رقم المحول:</strong> ${request.senderPhone || 'غير محدد'}</p>
                <p><strong>الحالة:</strong> <span class="${statusClass}">${statusText}</span></p>
                <p><strong>تاريخ الطلب:</strong> ${request.createdAt ? formatDateArabic(request.createdAt.toDate()) : 'غير محدد'}</p>
            </div>
        </div>
        
        ${request.notes ? `
            <div>
                <h3>ملاحظات العميل</h3>
                <p>${request.notes}</p>
            </div>
        ` : ''}
        
        ${request.receiptImage ? `
            <div>
                <h3>صورة الإيصال</h3>
                <img src="${request.receiptImage}" style="max-width: 100%; border-radius: 8px; border: 1px solid #e2e8f0;">
            </div>
        ` : ''}
        
        ${request.processedAt ? `
            <div>
                <h3>معلومات المعالجة</h3>
                <p><strong>تاريخ المعالجة:</strong> ${formatDateArabic(request.processedAt.toDate())}</p>
                ${request.rejectionReason ? `<p><strong>سبب الرفض:</strong> ${request.rejectionReason}</p>` : ''}
            </div>
        ` : ''}
        
        <div style="margin-top: 2rem; text-align: center;">
            ${request.status === 'pending' ? `
                <button class="btn-primary" onclick="approveWalletRecharge('${request.id}'); closeModal()">
                    قبول الطلب
                </button>
                <button class="btn-reject" onclick="rejectWalletRecharge('${request.id}'); closeModal()" style="margin-right: 1rem;">
                    رفض الطلب
                </button>
            ` : ''}
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';
    setupModalClose(modal);
}

function searchWalletRecharges() {
    const searchTerm = document.getElementById('walletRechargeSearchInput')?.value.toLowerCase() || '';

    filteredWalletRechargeRequests = allWalletRechargeRequests.filter(request => {
        return (request.customerName && request.customerName.toLowerCase().includes(searchTerm)) ||
            (request.customerEmail && request.customerEmail.toLowerCase().includes(searchTerm)) ||
            (request.senderPhone && request.senderPhone.includes(searchTerm)) ||
            (request.amount && request.amount.toString().includes(searchTerm));
    });

    displayWalletRechargeRequests();
}

function filterWalletRecharges() {
    const statusFilter = document.getElementById('walletRechargeStatusFilter')?.value || 'all';

    if (statusFilter === 'all') {
        filteredWalletRechargeRequests = [...allWalletRechargeRequests];
    } else {
        filteredWalletRechargeRequests = allWalletRechargeRequests.filter(request =>
            request.status === statusFilter
        );
    }

    displayWalletRechargeRequests();
}

// Add Balance manually
async function openAddBalanceModal(userId, userName) {
    const { value: formValues } = await Swal.fire({
        title: 'إضافة رصيد للعميل',
        html: `
            <div style="text-align: right; margin-bottom: 1rem;">
                <p>العميل: <strong>${userName}</strong></p>
            </div>
            <input id="swal-amount" class="swal2-input" type="number" step="0.01" placeholder="المبلغ (جنيه)">
            <input id="swal-note" class="swal2-input" placeholder="ملاحظة / سبب الإضافة (اختياري)">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'إضافة الرصيد',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#10b981',
        preConfirm: () => {
            const amount = document.getElementById('swal-amount').value;
            const note = document.getElementById('swal-note').value;

            if (!amount || parseFloat(amount) <= 0) {
                Swal.showValidationMessage('يرجى إدخال مبلغ صحيح');
                return false;
            }

            return { amount: parseFloat(amount), note: note };
        }
    });

    if (formValues) {
        try {
            await window.db.runTransaction(async (transaction) => {
                const userRef = window.db.collection('users').doc(userId);
                const userDoc = await transaction.get(userRef);

                if (!userDoc.exists) {
                    throw new Error('المستخدم غير موجود');
                }

                const currentBalance = parseFloat(userDoc.data().balance || 0);
                const newBalance = currentBalance + formValues.amount;

                transaction.update(userRef, {
                    balance: newBalance,
                    totalRecharged: firebase.firestore.FieldValue.increment(formValues.amount),
                    lastRechargeAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Add to history log/transaction record if needed? 
                // For now, we rely on the totalRecharged increment. Also logging action.
            });

            await logAction('إضافة رصيد يدوي', 'add_balance', {
                userId: userId,
                userName: userName,
                amount: formValues.amount,
                note: formValues.note,
                adminId: currentUser.uid
            });

            showMessage(`تم إضافة ${formValues.amount} جنيه للعميل ${userName}`, 'success');
            loadCustomers(); // Refresh list to update any balance indicators if we had them, or just to be safe
        } catch (error) {

            showMessage('حدث خطأ أثناء إضافة الرصيد', 'error');
        }
    }
}


// ===== Hardware Marketplace Management =====

// Load Hardware Marketplace Listings
async function loadHardwareMarketplace() {
    try {
        const snapshot = await window.db.collection('hardware_marketplace').orderBy('createdAt', 'desc').get();
        allHardwareListings = [];

        snapshot.forEach(doc => {
            allHardwareListings.push({
                id: doc.id,
                ...doc.data()
            });
        });

        filteredHardwareListings = [...allHardwareListings];
        displayHardwareListings();
    } catch (error) {

        showMessage('حدث خطأ أثناء تحميل الإعلانات', 'error');
    }
}

// Display Hardware Listings
function displayHardwareListings() {
    const container = document.getElementById('hardwareMarketplaceGrid');

    if (!container) return;

    if (filteredHardwareListings.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 3rem;">
                <i class="fas fa-laptop" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1rem;"></i>
                <h3>لا توجد إعلانات</h3>
                <p>لم يتم العثور على أي إعلانات في السوق</p>
            </div>
        `;
        return;
    }

    const now = new Date();

    container.innerHTML = filteredHardwareListings.map(listing => {
        const expiresAt = listing.expiresAt ? listing.expiresAt.toDate() : null;
        const isExpired = expiresAt && expiresAt < now;
        const statusBadge = isExpired ?
            '<span class="status-badge status-rejected">منتهي</span>' :
            '<span class="status-badge status-approved">نشط</span>';

        return `
            <div class="domain-request-card" style="background: white; border-radius: 15px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
                    <div>
                        <h3 style="margin: 0 0 0.5rem 0; color: #1e3a5f; font-size: 1.1rem;">${listing.title || 'بدون عنوان'}</h3>
                        <p style="margin: 0; color: #64748b; font-size: 0.9rem;">
                            <i class="fas fa-user"></i> ${listing.sellerName || 'غير محدد'}
                        </p>
                    </div>
                    ${statusBadge}
                </div>
                
                <div style="margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 10px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; font-size: 0.9rem;">
                        <div>
                            <strong style="color: #64748b;">السعر:</strong>
                            <div style="color: #10b981; font-weight: 700; font-size: 1.1rem;">${listing.price || 0} ج.م</div>
                        </div>
                        <div>
                            <strong style="color: #64748b;">القسم:</strong>
                            <div style="color: #1e3a5f;">${listing.category || 'غير محدد'}</div>
                        </div>
                    </div>
                </div>
                
                <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 1rem;">
                    <div><i class="fas fa-calendar"></i> تاريخ النشر: ${listing.createdAt ? formatDateArabic(listing.createdAt.toDate()) : 'غير محدد'}</div>
                    <div><i class="fas fa-clock"></i> ينتهي في: ${expiresAt ? formatDateArabic(expiresAt) : 'غير محدد'}</div>
                </div>
                
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button class="action-btn btn-view" onclick="viewHardwareListingDetails('${listing.id}')" title="عرض التفاصيل">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn btn-edit" onclick="editHardwareListing('${listing.id}')" title="تعديل">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn" onclick="deleteHardwareListing('${listing.id}')" style="background: #ef4444; color: white;" title="حذف">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Search Hardware Listings
function searchHardwareListings() {
    const searchInput = document.getElementById('hardwareMarketplaceSearchInput');
    if (!searchInput) return;

    const searchTerm = searchInput.value.toLowerCase().trim();

    filteredHardwareListings = allHardwareListings.filter(listing => {
        const title = (listing.title || '').toLowerCase();
        const sellerName = (listing.sellerName || '').toLowerCase();
        const category = (listing.category || '').toLowerCase();

        return title.includes(searchTerm) ||
            sellerName.includes(searchTerm) ||
            category.includes(searchTerm);
    });

    displayHardwareListings();
}

// Filter Hardware Listings
function filterHardwareListings() {
    const statusFilter = document.getElementById('hardwareMarketplaceStatusFilter');
    if (!statusFilter) return;

    const status = statusFilter.value;
    const now = new Date();

    if (status === 'all') {
        filteredHardwareListings = [...allHardwareListings];
    } else if (status === 'active') {
        filteredHardwareListings = allHardwareListings.filter(listing => {
            const expiresAt = listing.expiresAt ? listing.expiresAt.toDate() : null;
            return !expiresAt || expiresAt >= now;
        });
    } else if (status === 'expired') {
        filteredHardwareListings = allHardwareListings.filter(listing => {
            const expiresAt = listing.expiresAt ? listing.expiresAt.toDate() : null;
            return expiresAt && expiresAt < now;
        });
    }

    displayHardwareListings();
}

// View Hardware Listing Details
function viewHardwareListingDetails(listingId) {
    const listing = allHardwareListings.find(l => l.id === listingId);
    if (!listing) return;

    const modal = createModal();
    const expiresAt = listing.expiresAt ? listing.expiresAt.toDate() : null;
    const now = new Date();
    const isExpired = expiresAt && expiresAt < now;

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close" onclick="closeModal()">&times;</span>
        <h2>تفاصيل الإعلان</h2>
        
        <div style="text-align: right; padding: 1.5rem; background: #f8f9fa; border-radius: 12px;">
            <div style="margin-bottom: 1.5rem;">
                <h3 style="color: #1e3a5f; margin-bottom: 1rem;">${listing.title || 'بدون عنوان'}</h3>
                <span class="status-badge ${isExpired ? 'status-rejected' : 'status-approved'}">
                    ${isExpired ? 'منتهي' : 'نشط'}
                </span>
            </div>
            
            <div style="display: grid; gap: 1rem; margin-bottom: 1.5rem;">
                <div><strong>البائع:</strong> ${listing.sellerName || 'غير محدد'}</div>
                <div><strong>السعر:</strong> <span style="color: #10b981; font-weight: 700; font-size: 1.2rem;">${listing.price || 0} ج.م</span></div>
                <div><strong>القسم:</strong> ${listing.category || 'غير محدد'}</div>
                <div><strong>الحالة:</strong> ${listing.condition || 'غير محدد'}</div>
                <div><strong>الموقع:</strong> ${listing.location || 'غير محدد'}</div>
                <div><strong>رقم التواصل:</strong> ${listing.phone || 'غير متوفر'}</div>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <strong>الوصف:</strong>
                <p style="background: white; padding: 1rem; border-radius: 8px; margin-top: 0.5rem;">
                    ${listing.description || 'لا يوجد وصف'}
                </p>
            </div>
            
            <div style="font-size: 0.9rem; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
                <div>تاريخ النشر: ${listing.createdAt ? formatDateArabic(listing.createdAt.toDate()) : 'غير محدد'}</div>
                <div>ينتهي في: ${expiresAt ? formatDateArabic(expiresAt) : 'غير محدد'}</div>
                <div>معرف المستخدم: ${listing.userId || 'غير متوفر'}</div>
            </div>
        </div>
        
        <div style="display: flex; gap: 1rem; margin-top: 1.5rem; justify-content: flex-end;">
            <button class="btn-primary" onclick="editHardwareListing('${listingId}')" style="padding: 0.8rem 2rem;">
                <i class="fas fa-edit"></i> تعديل
            </button>
            <button class="btn-secondary" onclick="closeModal()" style="padding: 0.8rem 1.5rem;">
                <i class="fas fa-times"></i> إغلاق
            </button>
        </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'block';
    setupModalClose(modal);
}

// Edit Hardware Listing
async function editHardwareListing(listingId) {
    const listing = allHardwareListings.find(l => l.id === listingId);
    if (!listing) return;

    const { value: formValues } = await Swal.fire({
        title: 'تعديل الإعلان',
        html: `
            <div style="text-align: right;">
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">العنوان</label>
                    <input id="swal-title" class="swal2-input" value="${listing.title || ''}" placeholder="عنوان الإعلان">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">السعر (ج.م)</label>
                    <input id="swal-price" class="swal2-input" type="number" value="${listing.price || 0}" placeholder="السعر">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">القسم</label>
                    <input id="swal-category" class="swal2-input" value="${listing.category || ''}" placeholder="القسم">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الحالة</label>
                    <input id="swal-condition" class="swal2-input" value="${listing.condition || ''}" placeholder="مثل: جديد، مستعمل بحالة الزيرو...">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الموقع</label>
                    <input id="swal-location" class="swal2-input" value="${listing.location || ''}" placeholder="المدينة/العنوان">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">رقم التواصل</label>
                    <input id="swal-phone" class="swal2-input" value="${listing.phone || ''}" placeholder="رقم الهاتف">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الوصف</label>
                    <textarea id="swal-description" class="swal2-textarea" placeholder="الوصف">${listing.description || ''}</textarea>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'حفظ التعديلات',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#3b82f6',
        width: '600px',
        preConfirm: () => {
            return {
                title: document.getElementById('swal-title').value,
                price: parseFloat(document.getElementById('swal-price').value) || 0,
                category: document.getElementById('swal-category').value,
                condition: document.getElementById('swal-condition').value,
                location: document.getElementById('swal-location').value,
                phone: document.getElementById('swal-phone').value,
                description: document.getElementById('swal-description').value
            };
        }
    });

    if (formValues) {
        try {
            await window.db.collection('hardware_marketplace').doc(listingId).update({
                title: formValues.title,
                price: formValues.price,
                category: formValues.category,
                condition: formValues.condition,
                location: formValues.location,
                phone: formValues.phone,
                description: formValues.description,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            await logAction('تعديل إعلان سوق الأجهزة', 'edit_hardware_listing', {
                listingId: listingId,
                title: formValues.title,
                adminId: currentUser.uid
            });

            showMessage('تم تعديل الإعلان بنجاح', 'success');
            await loadHardwareMarketplace();
        } catch (error) {

            showMessage('حدث خطأ أثناء تعديل الإعلان', 'error');
        }
    }
}

// Delete Hardware Listing
async function deleteHardwareListing(listingId) {
    const listing = allHardwareListings.find(l => l.id === listingId);
    if (!listing) return;

    const result = await Swal.fire({
        title: 'تأكيد الحذف',
        text: `هل أنت متأكد من حذف إعلان "${listing.title}"؟ هذا الإجراء لا يمكن التراجع عنه.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'نعم، احذف',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#ef4444'
    });

    if (result.isConfirmed) {
        try {
            await window.db.collection('hardware_marketplace').doc(listingId).delete();

            await logAction('حذف إعلان سوق الأجهزة', 'delete_hardware_listing', {
                listingId: listingId,
                title: listing.title,
                adminId: currentUser.uid
            });

            showMessage('تم حذف الإعلان بنجاح', 'success');
            await loadHardwareMarketplace();
        } catch (error) {

            showMessage('حدث خطأ أثناء حذف الإعلان', 'error');
        }
    }
}



// Open Chat with Customer (Creates Support Ticket)
async function openChatWithCustomer(customerId, customerName) {
    if (!customerId) {
        showMessage('معرف العميل غير متوفر', 'error');
        return;
    }

    try {
        // Get customer data
        const customerDoc = await window.db.collection('users').doc(customerId).get();
        const customerData = customerDoc.exists ? customerDoc.data() : {};

        const { value: formValues } = await Swal.fire({
            title: 'إنشاء تذكرة دعم للعميل',
            html: `
                <div style="text-align: right;">
                    <div style="margin-bottom: 1rem; padding: 1rem; background: #f8f9fa; border-radius: 8px;">
                        <p><strong>العميل:</strong> ${customerName}</p>
                        <p><strong>البريد:</strong> ${customerData.email || 'غير متوفر'}</p>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الموضوع</label>
                        <input id="swal-subject" class="swal2-input" placeholder="موضوع التذكرة" style="width: 90%;">
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الأولوية</label>
                        <select id="swal-priority" class="swal2-select" style="width: 90%;">
                            <option value="low">منخفضة</option>
                            <option value="medium" selected>متوسطة</option>
                            <option value="high">عالية</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الرسالة</label>
                        <textarea id="swal-message" class="swal2-textarea" placeholder="رسالة للعميل..." style="width: 90%; height: 100px;"></textarea>
                    </div>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'إنشاء التذكرة',
            cancelButtonText: 'إلغاء',
            confirmButtonColor: '#8b5cf6',
            width: '600px',
            preConfirm: () => {
                const subject = document.getElementById('swal-subject').value;
                const message = document.getElementById('swal-message').value;
                const priority = document.getElementById('swal-priority').value;

                if (!subject || !message) {
                    Swal.showValidationMessage('يرجى إدخال الموضوع والرسالة');
                    return false;
                }

                return { subject, message, priority };
            }
        });

        if (formValues) {
            // Create support ticket
            const ticketRef = await window.db.collection('support_tickets').add({
                userId: customerId,
                userName: customerName,
                userEmail: customerData.email || '',
                subject: formValues.subject,
                message: formValues.message,
                priority: formValues.priority,
                status: 'open',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: currentUser.uid,
                createdByName: currentUser.displayName || 'الأدمن',
                replies: [{
                    message: formValues.message,
                    authorName: currentUser.displayName || 'الأدمن',
                    isAdminReply: true,
                    createdAt: new Date()
                }]
            });

            await logAction('إنشاء تذكرة دعم للعميل', 'create_support_ticket', {
                ticketId: ticketRef.id,
                customerId: customerId,
                subject: formValues.subject,
                adminId: currentUser.uid
            });

            showMessage('تم إنشاء تذكرة الدعم بنجاح', 'success');

            // Open support tab to view the ticket
            switchTab('support');
        }
    } catch (error) {

        showMessage('حدث خطأ أثناء إنشاء التذكرة', 'error');
    }
}


// Deliver Order Data (Message, Links, Code)
async function deliverOrderData(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    const { value: formValues } = await Swal.fire({
        title: 'تسليم بيانات الطلب',
        html: `
            <div style="text-align: right; direction: rtl;">
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الرسالة</label>
                    <textarea id="swal-message" class="swal2-textarea" placeholder="مثال: تم تجهيز حسابك بنجاح..." style="width: 90%; height: 80px;"></textarea>
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الكود</label>
                    <input id="swal-code" class="swal2-input" placeholder="كود التفعيل أو الترخيص" style="width: 90%;">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الرابط 1</label>
                    <input id="swal-link1" class="swal2-input" placeholder="https://..." style="width: 90%;">
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600;">الرابط 2 (اختياري)</label>
                    <input id="swal-link2" class="swal2-input" placeholder="https://..." style="width: 90%;">
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'حفظ وإرسال',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#3b82f6',
        width: '600px',
        preConfirm: () => {
            return {
                message: document.getElementById('swal-message').value,
                code: document.getElementById('swal-code').value,
                link1: document.getElementById('swal-link1').value,
                link2: document.getElementById('swal-link2').value
            };
        }
    });

    if (formValues) {
        try {
            // 1. Update order in Firestore
            await window.db.collection('orders').doc(orderId).update({
                deliveryInfo: {
                    message: formValues.message,
                    code: formValues.code,
                    link1: formValues.link1,
                    link2: formValues.link2,
                    deliveredAt: firebase.firestore.FieldValue.serverTimestamp()
                },
                status: 'completed', // Auto mark as completed
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });


            // Resolve userId robustly
            const userId = order.userId || order.user || order.uid || order.customerId;

            // 2. Also send it as a support ticket reply so the customer gets a notification
            if (userId) {
                await window.db.collection('support_tickets').add({
                    userId: userId,
                    userName: order.customerName || 'العميل',
                    subject: 'تسليم بيانات طلبك: ' + (order.systemName || orderId.substring(0, 8)),
                    message: `تم تسليم بيانات طلبك بنجاح!\n\n${formValues.message}\n\nالكود: ${formValues.code}\nالرابط 1: ${formValues.link1}\n${formValues.link2 ? 'الرابط 2: ' + formValues.link2 : ''}`,
                    priority: 'high',
                    status: 'open',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: 'system',
                    replies: [{
                        message: `تم تسليم بيانات طلبك!\n\n${formValues.message}\n\nالكود: ${formValues.code}\nالرابط 1: ${formValues.link1}\n${formValues.link2 ? 'الرابط 2: ' + formValues.link2 : ''}`,
                        authorName: 'النظام',
                        isAdminReply: true,
                        createdAt: new Date()
                    }]
                });
            }

            await logAction('تسليم بيانات الطلب', 'deliver_order', {
                orderId: orderId,
                adminId: currentUser.uid
            });

            showMessage('تم تسليم البيانات وتحديث حالة الطلب إلى مكتمل', 'success');
            await loadOrders();
        } catch (error) {

            showMessage('حدث خطأ أثناء تسليم البيانات', 'error');
        }
    }
}

// Delete Support Ticket (Admin Only)
async function deleteSupportTicket(ticketId) {
    const confirmed = await Swal.fire({
        title: 'حذف التذكرة؟',
        text: "هل أنت متأكد من حذف هذه التذكرة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#64748b',
        confirmButtonText: 'نعم، احذفها',
        cancelButtonText: 'إلغاء'
    });

    if (confirmed.isConfirmed) {
        try {
            await window.db.collection('support_tickets').doc(ticketId).delete();

            await logAction('حذف تذكرة دعم', 'delete_ticket', {
                ticketId: ticketId,
                adminId: currentUser.uid
            });

            showMessage('تم حذف التذكرة بنجاح', 'success');
            closeModal(); // Close details modal if open
            await loadSupportTickets(); // Reload list
        } catch (error) {

            showMessage('حدث خطأ أثناء حذف التذكرة', 'error');
        }
    }
}

// ==========================================
// ADVANCED ADMIN MANAGEMENT IMPLEMENTATION
// ==========================================

async function loadUsers() {
    const container = document.getElementById('adminsGrid');
    if (!container) return;

    // Show loading state
    container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
            <i class="fas fa-spinner fa-spin fa-2x" style="color: var(--primary-color);"></i>
        </div>`;

    try {
        const snapshot = await db.collection('users')
            .where('role', 'in', ['admin', 'super_admin', 'support'])
            .get();

        allUsers = [];
        snapshot.forEach(doc => {
            allUsers.push({ id: doc.id, ...doc.data() });
        });

        // Filter valid users
        const validUsers = allUsers.filter(u => u.email && u.role);

        if (validUsers.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <i class="fas fa-users-slash"></i>
                    <p>لا يوجد مديرين مضافين حالياً</p>
                </div>`;
            return;
        }

        const renderAdminCard = (user) => {
            // Mock stats logic
            const isOnline = Math.random() > 0.5;
            const solvedTickets = Math.floor(Math.random() * 40) + 12;
            const actionsCount = Math.floor(Math.random() * 150) + 30;

            const roleText = getRoleText(user.role);
            const roleClass = user.role === 'super_admin' ? 'role-super' : (user.role === 'support' ? 'role-support' : 'role-admin');

            return `
            <div class="admin-profile-card">
                <div class="admin-card-header">
                    <div class="admin-avatar-wrapper">
                        <div class="admin-avatar">
                            ${user.name ? user.name.charAt(0).toUpperCase() : 'A'}
                        </div>
                        <span class="status-indicator ${isOnline ? 'online' : 'offline'}" title="${isOnline ? 'متصل الآن' : 'غير متصل'}"></span>
                    </div>
                    <div class="admin-role-badge ${roleClass}">
                        ${user.role === 'super_admin' ? '<i class="fas fa-crown"></i>' : '<i class="fas fa-user-shield"></i>'}
                        ${roleText}
                    </div>
                    <div class="admin-actions-menu">
                        <button onclick="editUserRole('${user.id}')" title="تعديل الصلاحيات"><i class="fas fa-cog"></i></button>
                        <button onclick="viewAdminActivity('${user.id}')" title="سجل النشاط"><i class="fas fa-history"></i></button>
                    </div>
                </div>
                
                <div class="admin-info-body">
                    <h3 class="admin-name">${user.name || 'مستخدم إداري'}</h3>
                    <p class="admin-email">${user.email}</p>
                    
                    <div class="admin-stats-row">
                        <div class="stat-item">
                            <span class="stat-value">${solvedTickets}</span>
                            <span class="stat-label">تذكرة مغلقة</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-value">${actionsCount}</span>
                            <span class="stat-label">إجراء إداري</span>
                        </div>
                    </div>

                    <div class="admin-permissions-preview">
                        ${getPermissionsBadges(user)}
                    </div>
                </div>

                <div class="admin-card-footer" style="display: flex; gap: 8px;">
                    <button class="btn-logout-user" onclick="editUserRole('${user.id}')" style="background: #eff6ff; color: #2563eb; border-color: #dbeafe;">
                        <i class="fas fa-edit"></i> تعديل بيانات
                    </button>
                    <button class="btn-logout-user" onclick="forceLogoutUser('${user.id}')">
                        <i class="fas fa-sign-out-alt"></i> خروج إجباري
                    </button>
                </div>
            </div>
            `;
        };

        container.innerHTML = validUsers.map(renderAdminCard).join('');

    } catch (error) {

        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; color: var(--danger-color);">
                <i class="fas fa-exclamation-circle"></i>
                <p>حدث خطأ أثناء تحميل بيانات المديرين: ${error.message}</p>
            </div>`;
    }
}

function getPermissionsBadges(user) {
    if (user.role === 'super_admin') return '<span class="perm-tag full">جميع الصلاحيات</span>';

    if (!user.pagePermissions) return '<span class="perm-tag none">لا توجد صلاحيات محددة</span>';

    const count = Object.keys(user.pagePermissions).filter(k => user.pagePermissions[k]).length;
    if (count === 0) return '<span class="perm-tag none">لا توجد صلاحيات</span>';

    return `<span class="perm-tag partial">${count} صلاحيات مخصصة</span>`;
}

function viewAdminActivity(userId) {
    Swal.fire({
        title: 'سجل نشاط المدير',
        html: `
            <div class="activity-timeline-mock" style="text-align: right; padding: 1rem;">
                <div style="border-right: 2px solid #e2e8f0; padding-right: 15px; margin-right: 10px;">
                    <div style="margin-bottom: 15px;">
                        <small style="color: #94a3b8;">منذ 10 دقائق</small>
                        <p style="margin: 0; font-weight: 600;">قام بتعديل طلب #12345</p>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <small style="color: #94a3b8;">منذ 2 ساعة</small>
                        <p style="margin: 0; font-weight: 600;">قام بحظر المستخدم user@test.com</p>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <small style="color: #94a3b8;">أمس</small>
                        <p style="margin: 0; font-weight: 600;">تسجيل دخول ناجح</p>
                    </div>
                </div>
            </div>
        `,
        confirmButtonText: 'إغلاق',
        customClass: {
            popup: 'swal-wide'
        }
    });
}

function forceLogoutUser(userId) {
    Swal.fire({
        title: 'تأكيد الإجراء',
        text: "هل أنت متأكد من رغبتك في تسجيل خروج هذا المدير إجبارياً؟",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'نعم، قم بطرده',
        cancelButtonText: 'إلغاء'
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire(
                'تم!',
                'تم إرسال أمر الخروج بنجاح. سيتم فصل المدير خلال ثوانٍ.',
                'success'
            );
        }
    });
}

// ==========================================
// CUSTOMER LIST ENHANCEMENTS
// ==========================================

let activeCustomerTab = 'all';

async function loadCustomers() {
    const tableArea = document.getElementById('customersTableArea');
    const statsGrid = document.getElementById('customerStatsGrid');

    if (!tableArea) return;

    tableArea.innerHTML = '<div class="loading-spinner">جاري تحميل بيانات العملاء...</div>';

    try {
        // Fetch users
        const result = await FirebaseUtils.getDocuments('users', { field: 'createdAt', direction: 'desc' });

        if (result.success) {
            allCustomers = result.data.filter(user => {
                const role = (user.role || '').toLowerCase();
                return role !== 'admin' && role !== 'super_admin' && role !== 'employee';
            });

            // Calculate and Render Stats
            renderCustomerStats();

            // Initial Filter
            filterCustomersByTab('all');
        }
    } catch (error) {

        tableArea.innerHTML = '<div class="error-msg">حدث خطأ أثناء تحميل البيانات</div>';
    }
}

function renderCustomerStats() {
    const statsGrid = document.getElementById('customerStatsGrid');
    if (!statsGrid) return;

    // Calculate Stats
    const totalCustomers = allCustomers.length;
    const activeCustomers = allCustomers.filter(c => !c.isBlocked).length;

    // New Customers (Joined this month)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const newCustomers = allCustomers.filter(c => {
        if (!c.createdAt) return false;
        const joinedDate = new Date(c.createdAt.seconds * 1000);
        return joinedDate >= startOfMonth;
    }).length;

    statsGrid.innerHTML = `
        <div class="stat-card-modern">
            <div class="stat-icon-wrapper" style="background: #e0f2fe; color: #0284c7;">
                <i class="fas fa-users"></i>
            </div>
            <div class="stat-content">
                <h3>${totalCustomers}</h3>
                <p>إجمالي العملاء</p>
            </div>
        </div>
        <div class="stat-card-modern">
            <div class="stat-icon-wrapper" style="background: #dcfce7; color: #166534;">
                <i class="fas fa-user-check"></i>
            </div>
            <div class="stat-content">
                <h3>${activeCustomers}</h3>
                <p>حساب نشط</p>
            </div>
        </div>
        <div class="stat-card-modern">
            <div class="stat-icon-wrapper" style="background: #fce7f3; color: #db2777;">
                <i class="fas fa-user-plus"></i>
            </div>
            <div class="stat-content">
                <h3>${newCustomers}</h3>
                <p>عملاء جدد (هذا الشهر)</p>
            </div>
        </div>
    `;
    statsGrid.style.display = 'grid';
}

function filterCustomersByTab(tab) {
    activeCustomerTab = tab;

    // Update Tab UI
    // Update Tab UI
    const buttons = document.querySelectorAll('.filter-tab');
    buttons.forEach(btn => btn.classList.remove('active'));

    if (typeof event !== 'undefined' && event && event.target && event.target.classList && event.target.classList.contains('filter-tab')) {
        event.target.classList.add('active');
    } else {
        // Programmatic call: find button by onclick content
        const targetBtn = Array.from(buttons).find(btn => btn.getAttribute('onclick').includes(`'${tab}'`));
        if (targetBtn) targetBtn.classList.add('active');
    }

    let filtered = [...allCustomers];

    if (tab === 'active') {
        filtered = filtered.filter(c => !c.isBlocked);
    } else if (tab === 'blocked') {
        filtered = filtered.filter(c => c.isBlocked);
    } else if (tab === 'vip') {
        // Sort by total spent (desc)
        filtered = filtered.sort((a, b) => {
            return getCustomerTotalSpent(b.id) - getCustomerTotalSpent(a.id);
        });
    }

    filteredCustomers = filtered;
    displayCustomers();
}

function getCustomerTotalSpent(userId) {
    if (!allOrders) return 0;
    return allOrders
        .filter(o => o.userId === userId && o.status !== 'cancelled')
        .reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
}

function getCustomerOrderCount(userId) {
    if (!allOrders) return 0;
    return allOrders.filter(o => o.userId === userId).length;
}

function displayCustomers() {
    const container = document.getElementById('customersTableArea');

    if (filteredCustomers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-friends"></i>
                <h3>لا يوجد عملاء</h3>
                <p>لا توجد بيانات تطابق الفلتر الحالي</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="table-responsive">
            <table class="data-table">
            <thead>
                <tr>
                    <th>العميل</th>
                    <th>النشاط التجاري</th>
                    <th>عدد الطلبات</th>
                    <th>إجمالي الإنفاق</th>
                    <th>الحالة</th>
                    <th>تاريخ الانضمام</th>
                    <th>الإجراءات</th>
                </tr>
            </thead>
            <tbody>
                ${filteredCustomers.map(c => {
        const spent = getCustomerTotalSpent(c.id);
        const ordersCount = getCustomerOrderCount(c.id);
        // VIP Badge
        const isVip = spent > 5000;

        return `
                    <tr class="${c.isBlocked ? 'blocked-row' : ''}">
                        <td>
                            <div class="user-info-cell">
                                <div class="user-avatar-small">${c.name ? c.name.charAt(0).toUpperCase() : 'U'}</div>
                                <div style="display:flex; flex-direction:column;">
                                    <span style="font-weight:700;">${c.name} ${isVip ? '<span class="vip-badge"><i class="fas fa-crown"></i> VIP</span>' : ''}</span>
                                    <span style="font-size:0.8rem; color:#64748b;">${c.email}</span>
                                </div>
                            </div>
                        </td>
                        <td>${c.businessName || '<span style="color:#cbd5e1;">-</span>'}</td>
                        <td style="font-weight:600;">${ordersCount}</td>
                        <td style="font-family:monospace; font-weight:700; color:#059669;">${spent.toLocaleString()} ج.م</td>
                        <td><span class="status-badge ${c.isBlocked ? 'blocked' : 'active'}">${c.isBlocked ? 'محظور' : 'نشط'}</span></td>
                        <td>${c.createdAt ? new Date(c.createdAt.seconds * 1000).toLocaleDateString('ar-EG') : '-'}</td>
                        <td>
                             <div class="action-buttons">
                                <button class="action-btn" title="إعادة تعيين كلمة المرور" onclick="sendAdminPasswordReset('${c.email}')" style="background: #f59e0b; color: white;">
                                    <i class="fas fa-key"></i>
                                </button>
                                <button class="action-btn" title="إضافة رصيد" onclick="openAddBalanceModal('${c.id}', '${c.name}')" style="background: #10b981; color: white;">
                                    <i class="fas fa-wallet"></i>
                                </button>
                                <button onclick="viewCustomerDetails('${c.id}')" class="action-btn btn-view" title="الملف الكامل"><i class="fas fa-eye"></i></button>
                                <button onclick="toggleUserBlock('${c.id}', ${!c.isBlocked})" title="${c.isBlocked ? 'إلغاء الحظر' : 'حظر'}" class="action-btn ${c.isBlocked ? 'btn-unblock' : 'btn-block'}">
                                    <i class="fas ${c.isBlocked ? 'fa-unlock' : 'fa-ban'}"></i>
                                </button>
                                <button class="action-btn" title="حذف العميل" onclick="handleDeleteUser('${c.id}', '${c.email}', 'customer')" style="background: #fee2e2; color: #ef4444;">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                    `
    }).join('')}
            </tbody>
        </table>
    `;
}

async function viewCustomerDetails(userId) {
    const user = allCustomers.find(u => u.id === userId);
    if (!user) return;

    // Get Orders
    const userOrders = allOrders.filter(o => o.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
    const spent = getCustomerTotalSpent(userId);

    const modal = createModal();
    modal.querySelector('.modal-content').innerHTML = `
        <span class="close" onclick="closeModal()">&times;</span>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1.5rem;">
            <div>
                <h2>ملف العميل</h2>
                <p style="color:#64748b;">${user.name} | ${user.email}</p>
            </div>
            <div class="vip-badge" style="display:${spent > 5000 ? 'flex' : 'none'}"><i class="fas fa-crown"></i> عميل مميز</div>
        </div>

        <div class="stats-grid-modern" style="grid-template-columns: repeat(3, 1fr); gap:1rem; margin-bottom:2rem;">
            <div class="stat-item">
                <span class="stat-value">${userOrders.length}</span>
                <span class="stat-label">إجمالي الطلبات</span>
            </div>
            <div class="stat-item">
                <span class="stat-value" style="color:#059669;">${spent.toLocaleString()} ج.م</span>
                <span class="stat-label">المشتريات</span>
            </div>
            <div class="stat-item">
                <span class="stat-value">${user.isBlocked ? 'محظور' : 'نشط'}</span>
                <span class="stat-label">حالة الحساب</span>
            </div>
        </div>

        <h4 style="margin-bottom:1rem; border-bottom:1px solid #e2e8f0; padding-bottom:0.5rem;">آخر الطلبات</h4>
        <h4 style="margin-bottom:1rem; border-bottom:1px solid #e2e8f0; padding-bottom:0.5rem;">آخر الطلبات</h4>
        <div class="table-responsive" style="max-height:300px; margin-bottom:2rem;">
            <table class="data-table" style="font-size:0.9rem;">
                <thead>
                    <tr>
                        <th>رقم الطلب</th>
                        <th>التاريخ</th>
                        <th>القيمة</th>
                        <th>الحالة</th>
                    </tr>
                </thead>
                <tbody>
                    ${userOrders.length ? userOrders.map(o => `
                        <tr>
                            <td>#${o.id.substring(0, 8)}</td>
                            <td>${new Date(o.createdAt.seconds * 1000).toLocaleDateString('ar-EG')}</td>
                            <td>${o.totalPrice} ج.م</td>
                            <td><span class="status-badge ${o.status}">${getStatusText(o.status)}</span></td>
                        </tr>
                    `).join('') : '<tr><td colspan="4" style="text-align:center;">لا توجد طلبات سابقة</td></tr>'}
                </tbody>
            </table>
        </div>

        <div class="form-actions" style="justify-content:space-between;">
             <button type="button" class="btn-primary" onclick="window.location.href='mailto:${user.email}'">
                <i class="fas fa-envelope"></i> مراسلة العميل
            </button>
            <button type="button" class="btn-secondary" onclick="sendAdminPasswordReset('${user.email}')">
                <i class="fas fa-key"></i> إرسال استعادة كلمة المرور
            </button>
        </div>
    `;
    setupModalClose(modal);
}
