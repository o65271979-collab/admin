// إعدادات النظام
let systemSettings = {
    language: 'ar',
    theme: 'light',
    notifications: true,
    sounds: false,
    twoFactor: false,
    auditLog: true,
    sessionTimeout: 60,
    caching: true,
    compression: true,
    autoRefresh: true,
    autoBackup: true,
    dataSync: false,
    dataCleanup: 90,
    security: {
        ipWhitelistEnabled: false,
        allowedIps: [],
        passwordRotationEnabled: false,
        passwordRotationDays: 90,
        deviceVerificationEnabled: false
    }
};

// تهيئة الصفحة
document.addEventListener('DOMContentLoaded', function () {
    window.firebaseReady(initializeSettings);
});

async function initializeSettings() {
    // فحص صلاحيات المدير
    FirebaseHelpers.waitForAuth(async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }

        const hasPermission = await window.AdminPermissions.checkPermission(user.uid, 'settings', 'view');
        if (!hasPermission) {
            return;
        }

        await loadSettings();
        applyCurrentTheme();
    });
}

// تحميل الإعدادات من Firebase
async function loadSettings() {
    try {
        const settingsDoc = await window.db.collection('settings').doc('system').get();

        if (settingsDoc.exists) {
            systemSettings = { ...systemSettings, ...settingsDoc.data() };
        }

        updateUIFromSettings();
    } catch (error) {
        
    }
}

// تحديث الواجهة من الإعدادات
function updateUIFromSettings() {
    // تحديث اللغة
    document.getElementById('langArBtn')?.classList.toggle('active', systemSettings.language === 'ar');
    document.getElementById('langEnBtn')?.classList.toggle('active', systemSettings.language === 'en');

    // تحديث المظهر
    document.getElementById('themeLightBtn')?.classList.toggle('active', systemSettings.theme === 'light');
    document.getElementById('themeDarkBtn')?.classList.toggle('active', systemSettings.theme === 'dark');

    // تحديث وضع الصيانة
    const maintenanceToggle = document.getElementById('maintenanceToggle');
    if (maintenanceToggle) {
        // Maintenance mode is usually stored in 'maintenance' doc, but for now we sync if present in systemSettings
        // Note: admin.js handles maintenance via 'settings/maintenance' doc, while settings.js uses 'settings/system'.
        // We should respect admin.js logic or sync them. For now, let's just avoid breaking if key exists.
    }

    // Update other simple toggles if they match IDs or specific attributes
    // (Removed generic onclick loop as it targeted deleted elements)

    // Update Security UI
    if (systemSettings.security) {
        // IP Whitelist Toggle
        const ipToggle = document.getElementById('ipWhitelistToggle');
        if (ipToggle) {
            ipToggle.checked = systemSettings.security.ipWhitelistEnabled;
            const section = document.getElementById('ipWhitelistSection');
            if (section) section.style.display = systemSettings.security.ipWhitelistEnabled ? 'block' : 'none';
            if (systemSettings.security.ipWhitelistEnabled) renderIpList();
        }

        // Password Rotation Toggle
        const passwordToggle = document.getElementById('passwordRotationToggle');
        if (passwordToggle) {
            passwordToggle.checked = systemSettings.security.passwordRotationEnabled;
            const section = document.getElementById('passwordRotationSection');
            if (section) section.style.display = systemSettings.security.passwordRotationEnabled ? 'block' : 'none';

            const daysInput = document.getElementById('passwordRotationDays');
            if (daysInput) daysInput.value = systemSettings.security.passwordRotationDays || 90;
        }

        // Device Verification Toggle
        const deviceToggle = document.getElementById('deviceVerificationToggle');
        if (deviceToggle) {
            deviceToggle.checked = systemSettings.security.deviceVerificationEnabled;
        }
    }
}

// تغيير اللغة
function changeLanguage(lang) {
    systemSettings.language = lang;

    document.querySelectorAll('.lang-option').forEach(option => {
        option.classList.remove('active');
    });
    document.querySelector(`[onclick="changeLanguage('${lang}')"]`).classList.add('active');

    // تطبيق اللغة
    if (lang === 'en') {
        document.documentElement.setAttribute('dir', 'ltr');
        document.documentElement.setAttribute('lang', 'en');
    } else {
        document.documentElement.setAttribute('dir', 'rtl');
        document.documentElement.setAttribute('lang', 'ar');
    }

    updateSetting('language', lang);
}

// تغيير المظهر
function changeTheme(theme) {
    systemSettings.theme = theme;
    applyTheme(theme);
    updateSetting('theme', theme);
}

// تطبيق المظهر
function applyTheme(theme) {
    if (typeof window.quickChangeTheme === 'function') {
        window.quickChangeTheme(theme);
    } else {
        // Fallback if admin.js is not loaded yet
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('admin-theme', theme);
    }
}

// تطبيق المظهر الحالي
function applyCurrentTheme() {
    applyTheme(systemSettings.theme);
}

// تبديل إعداد
function toggleSetting(element, settingName) {
    element.classList.toggle('active');
    systemSettings[settingName] = element.classList.contains('active');
    updateSetting(settingName, systemSettings[settingName]);
}

// تحديث إعداد
async function updateSetting(key, value) {
    systemSettings[key] = value;

    try {
        await window.db.collection('settings').doc('system').set({
            [key]: value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        
    } catch (error) {
        
    }
}

// حفظ جميع الإعدادات
async function saveAllSettings() {
    try {
        await window.db.collection('settings').doc('system').set({
            ...systemSettings,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showMessage('تم حفظ جميع الإعدادات بنجاح', 'success');
    } catch (error) {
        
        showMessage('خطأ في حفظ الإعدادات', 'error');
    }
}

// إعادة تعيين للافتراضي
async function resetToDefaults() {
    if (confirm('هل أنت متأكد من إعادة تعيين جميع الإعدادات للافتراضي؟')) {
        systemSettings = {
            language: 'ar',
            theme: 'light',
            notifications: true,
            sounds: false,
            twoFactor: false,
            auditLog: true,
            sessionTimeout: 60,
            caching: true,
            compression: true,
            autoRefresh: true,
            autoBackup: true,
            dataSync: false,
            dataCleanup: 90
        };

        await saveAllSettings();
        updateUIFromSettings();
        applyCurrentTheme();

        showMessage('تم إعادة تعيين الإعدادات للافتراضي', 'success');
    }
}

// === وظائف النسخ الاحتياطي ===

// إنشاء نسخة احتياطية
async function createBackup() {
    showProgress(0);
    showMessage('جاري إنشاء النسخة الاحتياطية...', 'warning');

    try {
        const collections = ['users', 'products', 'orders', 'support_tickets', 'settings', 'admins'];
        const backupData = {
            timestamp: new Date().toISOString(),
            version: '1.0',
            data: {}
        };

        let progress = 0;
        const increment = 100 / collections.length;

        for (const collection of collections) {
            const snapshot = await window.db.collection(collection).get();
            backupData.data[collection] = [];

            snapshot.forEach(doc => {
                backupData.data[collection].push({
                    id: doc.id,
                    ...doc.data()
                });
            });

            progress += increment;
            showProgress(progress);
        }

        // حفظ النسخة الاحتياطية
        const backupId = `backup_${Date.now()}`;
        await window.db.collection('backups').doc(backupId).set(backupData);

        // تنزيل النسخة الاحتياطية
        downloadBackup(backupData, backupId);

        showProgress(100);
        showMessage('تم إنشاء النسخة الاحتياطية بنجاح', 'success');

        setTimeout(() => {
            hideProgress();
        }, 2000);

    } catch (error) {
        
        showMessage('خطأ في إنشاء النسخة الاحتياطية', 'error');
        hideProgress();
    }
}

// تنزيل النسخة الاحتياطية
function downloadBackup(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// استيراد البيانات
function handleFileImport(input) {
    const file = input.files[0];
    if (!file) return;

    if (confirm('هل أنت متأكد من استيراد البيانات؟ سيتم استبدال البيانات الحالية.')) {
        const reader = new FileReader();
        reader.onload = async function (e) {
            try {
                const data = JSON.parse(e.target.result);
                await importBackupData(data);
            } catch (error) {
                
                showMessage('خطأ في قراءة الملف', 'error');
            }
        };
        reader.readAsText(file);
    }

    input.value = '';
}

// استيراد بيانات النسخة الاحتياطية
async function importBackupData(backupData) {
    showProgress(0);
    showMessage('جاري استيراد البيانات...', 'warning');

    try {
        const collections = Object.keys(backupData.data);
        let progress = 0;
        const increment = 100 / collections.length;

        for (const collectionName of collections) {
            const items = backupData.data[collectionName];

            for (const item of items) {
                const { id, ...data } = item;
                await window.db.collection(collectionName).doc(id).set(data);
            }

            progress += increment;
            showProgress(progress);
        }

        showProgress(100);
        showMessage('تم استيراد البيانات بنجاح', 'success');

        setTimeout(() => {
            hideProgress();
            location.reload();
        }, 2000);

    } catch (error) {
        
        showMessage('خطأ في استيراد البيانات', 'error');
        hideProgress();
    }
}

// تصدير البيانات
async function exportData() {
    try {
        const collections = ['products', 'users', 'orders', 'support_tickets'];
        const exportData = {};

        for (const collection of collections) {
            const snapshot = await window.db.collection(collection).get();
            exportData[collection] = [];

            snapshot.forEach(doc => {
                exportData[collection].push({
                    id: doc.id,
                    ...doc.data()
                });
            });
        }

        downloadBackup(exportData, `export_${Date.now()}`);
        showMessage('تم تصدير البيانات بنجاح', 'success');

    } catch (error) {
        
        showMessage('خطأ في تصدير البيانات', 'error');
    }
}

// عرض سجل النسخ الاحتياطية
async function viewBackupHistory() {
    try {
        const snapshot = await window.db.collection('backups')
            .orderBy('timestamp', 'desc')
            .limit(10)
            .get();

        let historyHTML = '<h3>سجل النسخ الاحتياطية</h3><ul>';

        snapshot.forEach(doc => {
            const data = doc.data();
            const date = new Date(data.timestamp).toLocaleString('ar-SA');
            historyHTML += `
                <li>
                    <strong>${doc.id}</strong> - ${date}
                    <button onclick="restoreSpecificBackup('${doc.id}')" class="btn-sm">استعادة</button>
                </li>
            `;
        });

        historyHTML += '</ul>';

        showModal('سجل النسخ الاحتياطية', historyHTML);

    } catch (error) {
        
        showMessage('خطأ في عرض سجل النسخ الاحتياطية', 'error');
    }
}

// استعادة من نسخة احتياطية محددة
async function restoreSpecificBackup(backupId) {
    if (confirm('هل أنت متأكد من استعادة هذه النسخة الاحتياطية؟')) {
        try {
            const backupDoc = await window.db.collection('backups').doc(backupId).get();

            if (backupDoc.exists) {
                await importBackupData(backupDoc.data());
            } else {
                showMessage('النسخة الاحتياطية غير موجودة', 'error');
            }
        } catch (error) {
            
            showMessage('خطأ في استعادة النسخة الاحتياطية', 'error');
        }
    }
}

// استعادة من نسخة احتياطية
function restoreFromBackup() {
    document.getElementById('importFile').click();
}

// تنظيف النسخ القديمة
async function cleanupOldBackups() {
    if (confirm('هل تريد حذف النسخ الاحتياطية الأقدم من 30 يوم؟')) {
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const snapshot = await window.db.collection('backups')
                .where('timestamp', '<', thirtyDaysAgo.toISOString())
                .get();

            let deletedCount = 0;
            const batch = window.db.batch();

            snapshot.forEach(doc => {
                batch.delete(doc.ref);
                deletedCount++;
            });

            await batch.commit();

            showMessage(`تم حذف ${deletedCount} نسخة احتياطية قديمة`, 'success');

        } catch (error) {
            
            showMessage('خطأ في تنظيف النسخ الاحتياطية', 'error');
        }
    }
}

// === إعدادات الأمان المتقدمة ===

function toggleSecuritySetting(element, settingName) {
    // element is now the checkbox input
    const isChecked = element.checked;

    // Ensure nested object exists
    if (!systemSettings.security) {
        systemSettings.security = {
            ipWhitelistEnabled: false,
            allowedIps: [],
            passwordRotationEnabled: false,
            passwordRotationDays: 90,
            deviceVerificationEnabled: false
        };
    }

    systemSettings.security[settingName] = isChecked;

    // Show/Hide sections
    if (settingName === 'ipWhitelistEnabled') {
        const section = document.getElementById('ipWhitelistSection');
        if (section) section.style.display = isChecked ? 'block' : 'none';
        if (isChecked) renderIpList();
    }
    if (settingName === 'passwordRotationEnabled') {
        const section = document.getElementById('passwordRotationSection');
        if (section) section.style.display = isChecked ? 'block' : 'none';
    }

    saveSecuritySettings();
}

async function updateSecuritySetting(key, value) {
    if (!systemSettings.security) systemSettings.security = {};
    systemSettings.security[key] = value;
    await saveSecuritySettings();
}

async function saveSecuritySettings() {
    try {
        await window.db.collection('settings').doc('system').set({
            security: systemSettings.security
        }, { merge: true }); // Merge to avoid overwriting other settings
        
    } catch (error) {
        
        showMessage('خطأ في حفظ إعدادات الأمان', 'error');
    }
}

// IP Whitelist Management
function renderIpList() {
    const list = document.getElementById('ipList');
    if (!list) return;

    const ips = systemSettings.security?.allowedIps || [];

    list.innerHTML = ips.map(ip => `
        <div class="badge" style="background: white; border: 1px solid #ddd; color: #333; padding: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>${ip}</span>
            <i class="fas fa-times" style="color: #dc3545; cursor: pointer;" onclick="removeIpFromWhitelist('${ip}')"></i>
        </div>
    `).join('');
}

async function addIpToWhitelist() {
    const input = document.getElementById('newIpInput');
    const ip = input.value.trim();

    if (!ip) return;

    // Basic IP Validation regex
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(ip)) {
        showMessage('صيغة IP غير صحيحة', 'error');
        return;
    }

    if (!systemSettings.security.allowedIps) systemSettings.security.allowedIps = [];

    if (systemSettings.security.allowedIps.includes(ip)) {
        showMessage('هذا العنوان موجود بالفعل', 'warning');
        return;
    }

    systemSettings.security.allowedIps.push(ip);
    input.value = '';
    renderIpList();
    await saveSecuritySettings();
}

async function removeIpFromWhitelist(ip) {
    if (!confirm(`هل أنت متأكد من حذف ${ip} من القائمة البيضاء؟`)) return;

    systemSettings.security.allowedIps = systemSettings.security.allowedIps.filter(i => i !== ip);
    renderIpList();
    await saveSecuritySettings();
}

// Get current IP using external service
async function addCurrentIp() {
    const btn = document.querySelector('[onclick="addCurrentIp()"]');
    const originalIcon = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();

        document.getElementById('newIpInput').value = data.ip;
        addIpToWhitelist();

    } catch (error) {
        
        showMessage('تعذر تحديد عنوان IP الحالي تلقائياً', 'error');
    } finally {
        btn.innerHTML = originalIcon;
        btn.disabled = false;
    }
}

// === وظائف مساعدة للواجهة ===

// عرض شريط التقدم
function showProgress(percentage) {
    const progressBar = document.getElementById('backupProgress');
    const progressFill = document.getElementById('progressFill');

    progressBar.style.display = 'block';
    progressFill.style.width = percentage + '%';
}

// إخفاء شريط التقدم
function hideProgress() {
    document.getElementById('backupProgress').style.display = 'none';
}

// عرض رسالة الحالة
function showMessage(message, type) {
    const messageDiv = document.getElementById('statusMessage');
    messageDiv.textContent = message;
    messageDiv.className = `status-message status-${type}`;
    messageDiv.style.display = 'block';

    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}

// عرض نافذة منبثقة
function showModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}
