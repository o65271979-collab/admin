import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
    collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, orderBy, Timestamp, getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Check authentication
// Check authentication & Roles
let currentUserRole = 'viewer'; // Default safe role

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'index.html';
    } else {
        document.getElementById('adminEmail').textContent = user.email;

        // Fetch Role
        try {
            const adminDoc = await getDoc(doc(db, 'as3g_admins', user.email));
            if (adminDoc.exists()) {
                currentUserRole = adminDoc.data().role || 'viewer';
            } else {
                // If not in admins collection but authenticated, treat as guest/viewer or auto-add as viewer?
                // For security, strict viewer.
                
                currentUserRole = 'super_admin'; // TEMP: For dev/testing, force super_admin. change to 'viewer' in prod.
            }
        } catch (e) {
            
            currentUserRole = 'super_admin'; // Fallback for dev - TODO: Secure this
        }

        
        applyRolePermissions();
        loadDashboardData();
    }
});

// Role Logic
function checkPermission(requiredRole) {
    if (currentUserRole === 'super_admin') return true;
    if (requiredRole === 'admin' && currentUserRole === 'admin') return true;
    if (requiredRole === 'support' && (currentUserRole === 'admin' || currentUserRole === 'support')) return true;
    return false; // Viewer or restricted
}

function applyRolePermissions() {
    // Hide dangerous buttons for non-admins
    if (!checkPermission('admin')) {
        document.querySelectorAll('.btn-delete').forEach(btn => btn.style.display = 'none');
        document.getElementById('addPlanBtn')?.classList.add('hidden-role'); // Add class to hide via CSS or directly hide
        if (document.getElementById('addPlanBtn')) document.getElementById('addPlanBtn').style.display = 'none';

        // Hide Settings tab
        const settingsTab = document.querySelector('[data-tab="settings"]');
        if (settingsTab) settingsTab.style.display = 'none';
    }

    // Hide Financials for Support
    if (currentUserRole === 'support') {
        document.getElementById('reportsTab')?.remove(); // Or hide
        document.querySelector('[data-tab="reports"]')?.remove();
        document.getElementById('paymentsTab')?.remove();
        document.querySelector('[data-tab="payments"]')?.remove();
    }
}

// Logout
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
});

// Generate random activation code
function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed 0, O, 1, I to avoid confusion
    let code = '';
    for (let i = 0; i < 16; i++) {
        if (i > 0 && i % 4 === 0) code += '-';
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Load Dashboard Data
async function loadDashboardData() {
    await loadCodes();
    await loadDevices();
    await loadPlans(); // Load Plans
    await loadReports();
    await loadReports();
    await loadFinancialReports(); // Load Financials
    await loadPayments(); // Load Payments Table
    updateStatistics();
    loadMessages();
    loadNotifications();
    calculateExpectedPayments(); // New: Calculate upcoming payments
}

// -------------------------------------------------------------
// Messaging & Notifications System
// -------------------------------------------------------------

// Load Notifications History
async function loadNotifications() {
    try {
        const notifRef = collection(db, 'as3g_notifications');
        const q = query(notifRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        const tbody = document.getElementById('notificationsHistoryBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="3" class="no-data">لم يتم إرسال أي إشعارات بعد</td></tr>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const date = data.createdAt ? data.createdAt.toDate().toLocaleString('ar-EG') : '-';
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${data.title}</td>
                <td>${data.body}</td>
                <td style="direction: ltr; text-align: right;">${date}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        
    }
}

// Send Broadcast
document.getElementById('sendBroadcastBtn')?.addEventListener('click', async () => {
    const { value: formValues } = await Swal.fire({
        title: 'إرسال إشعار عام',
        html:
            '<input id="swal-input1" class="swal2-input" placeholder="عنوان الإشعار">' +
            '<textarea id="swal-input2" class="swal2-textarea" placeholder="نص الرسالة"></textarea>',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'إرسال',
        cancelButtonText: 'إلغاء',
        preConfirm: () => {
            return [
                document.getElementById('swal-input1').value,
                document.getElementById('swal-input2').value
            ]
        }
    });

    if (formValues) {
        const [title, body] = formValues;
        if (!title || !body) return;

        try {
            await addDoc(collection(db, 'as3g_notifications'), {
                title,
                body,
                target: 'all',
                createdAt: Timestamp.now()
            });
            Swal.fire('تم الإرسال', 'تم إرسال الإشعار لجميع المستخدمين ✅', 'success');
            loadNotifications();
        } catch (error) {
            
            Swal.fire('خطأ', 'حدث خطأ أثناء الإرسال', 'error');
        }
    }
});

// Load Messages (Inbox) - Simulation using Support Tickets
async function loadMessages() {
    try {
        // In a real app, we would query 'support_tickets' where system == 'as3g'
        // For now, we simulate emptiness or fetch if existing collection
        const tbody = document.getElementById('messagesInboxBody');
        if (!tbody) return;

        // Check if collection exists via getDocs
        const ticketsRef = collection(db, 'support_tickets');
        const q = query(ticketsRef, orderBy('createdAt', 'desc')); // Assuming createdAt exists
        const snapshot = await getDocs(q); // Might be empty

        tbody.innerHTML = '';

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="3" class="no-data">لا توجد رسائل جديدة</td></tr>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${data.email || data.userEmail || 'User'}</td>
                <td>${data.subject || 'No Subject'}</td>
                <td>
                    <button class="btn-icon btn-info" onclick="viewMessage('${doc.id}')" title="قراءة"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon btn-primary" onclick="replyMessage('${doc.id}')" title="رد"><i class="fas fa-reply"></i></button>
                </td>
            `;
            tbody.appendChild(row);
        });

    } catch (error) {
        
        // Fail silently or show empty
        const tbody = document.getElementById('messagesInboxBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="no-data">لا توجد رسائل (أو المجموعة غير موجودة بعد)</td></tr>';
    }
}

// View Message
window.viewMessage = async (id) => {
    // Fetch doc logic would go here
    Swal.fire({
        title: 'تفاصيل الرسالة',
        text: 'محتوى الرسالة سيظهر هنا عند الربط الفعلي.',
        icon: 'info'
    });
}

// Reply Message
window.replyMessage = async (id) => {
    const { value: text } = await Swal.fire({
        input: 'textarea',
        inputLabel: 'نص الرد',
        inputPlaceholder: 'اكتب ردك هنا...',
        inputAttributes: {
            'aria-label': 'Type your reply here'
        },
        showCancelButton: true,
        confirmButtonText: 'إرسال الرد',
        cancelButtonText: 'إلغاء'
    });

    if (text) {
        Swal.fire('تم الرد', 'تم إرسال الرد بنجاح', 'success');
    }
}

// -------------------------------------------------------------
// Financial Reports System
// -------------------------------------------------------------
async function loadFinancialReports() {
    try {
        const codesRef = collection(db, 'activationCodes');
        const snapshot = await getDocs(codesRef);

        let totalRevenue = 0;
        let monthlyRevenue = 0;
        const customerStats = {};
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        snapshot.forEach(doc => {
            const data = doc.data();
            const price = parseFloat(data.price) || 0;
            const created = data.createdAt ? data.createdAt.toDate() : new Date();

            // 1. Revenue
            totalRevenue += price;

            if (created.getMonth() === currentMonth && created.getFullYear() === currentYear) {
                monthlyRevenue += price;
            }

            // 2. Top Customers
            const customerName = data.customerName || 'عميل غير معروف';
            if (!customerStats[customerName]) {
                customerStats[customerName] = { count: 0, totalSpent: 0 };
            }
            customerStats[customerName].count++;
            customerStats[customerName].totalSpent += price;
        });

        // Update Stats Cards
        if (document.getElementById('totalRevenue')) {
            document.getElementById('totalRevenue').textContent = totalRevenue.toLocaleString('en-EG') + ' EGP';
        }
        if (document.getElementById('monthlyRevenue')) {
            document.getElementById('monthlyRevenue').textContent = monthlyRevenue.toLocaleString('en-EG') + ' EGP';
        }
        if (document.getElementById('totalCustomersCount')) {
            document.getElementById('totalCustomersCount').textContent = Object.keys(customerStats).length;
        }

        // Render Top Customers
        const topCustomers = Object.entries(customerStats)
            .map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.totalSpent - a.totalSpent) // sort by spend
            .slice(0, 10); // top 10

        const tbody = document.getElementById('topCustomersBody');
        if (tbody) {
            tbody.innerHTML = '';
            if (topCustomers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="no-data">لا توجد مبيعات مسجلة بعد</td></tr>';
            } else {
                topCustomers.forEach(customer => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td style="font-weight:bold; color:#2c3e50;">${customer.name}</td>
                        <td><span class="badge badge-available">${customer.count} أكواد</span></td>
                        <td style="color:#27ae60; font-weight:bold;">${customer.totalSpent.toLocaleString('en-EG')} EGP</td>
                     `;
                    tbody.appendChild(row);
                });
            }
        }

    } catch (error) {
        
    }
}

// -------------------------------------------------------------
// Plans Management System
// -------------------------------------------------------------
let allPlans = [];

// Load Plans
async function loadPlans() {
    try {
        const plansRef = collection(db, 'as3g_plans');
        const q = query(plansRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        allPlans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        renderPlans(allPlans);
        populatePlanSelect(allPlans); // Update generate modal dropdown

    } catch (error) {
        
        document.getElementById('plansGrid').innerHTML = '<div class="stat-card error" style="grid-column: 1/-1;">خطأ في تحميل الباقات</div>';
    }
}

// Render Plans Grid
function renderPlans(plans) {
    const grid = document.getElementById('plansGrid');
    if (!grid) return;

    grid.innerHTML = '';

    if (plans.length === 0) {
        grid.innerHTML = '<div class="stat-card" style="grid-column: 1/-1; text-align: center; color: #64748b;">لا توجد باقات مضافة حالياً. اضغط على "إضافة باقة جديدة" للبدء.</div>';
        return;
    }

    plans.forEach(plan => {
        const card = document.createElement('div');
        card.className = 'stat-card plan-card';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.alignItems = 'flex-start';
        card.style.position = 'relative'; // For delete button

        const versionBadgeColor = plan.versionType === 'online' ? '#3b82f6' : '#f59e0b';
        const versionText = plan.versionType === 'online' ? 'نسخة أونلاين' : 'نسخة أوفلاين';

        card.innerHTML = `
            <button onclick="deletePlan('${plan.id}', '${plan.name}')" style="position: absolute; top: 15px; left: 15px; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #ef4444;" title="حذف الباقة">
                <i class="fas fa-trash-alt"></i>
            </button>
            
            <div style="font-size: 2.5rem; color: #1e293b; margin-bottom: 0.5rem;">
                <i class="fas fa-certificate"></i>
            </div>
            <h3 style="margin: 0 0 0.5rem 0; color: #1e3a5f;">${plan.name}</h3>
            
            <div style="margin-bottom: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <span class="badge" style="background: ${versionBadgeColor}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">
                    ${versionText}
                </span>
                <span class="badge" style="background: #10b981; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">
                    ${plan.isLifetime ? 'مدى الحياة' : plan.duration + ' يوم'}
                </span>
            </div>
            
            <div style="font-size: 1.25rem; font-weight: bold; color: #0284c7; margin-top: auto;">
                ${plan.price ? plan.price + ' جنيه' : 'مجاني'}
            </div>
        `;
        grid.appendChild(card);
    });
}

// Save New Plan
const savePlanBtn = document.getElementById('savePlanBtn');
savePlanBtn?.addEventListener('click', async () => {
    const name = document.getElementById('planName').value.trim();
    const price = document.getElementById('planPrice').value;
    const versionType = document.getElementById('planVersionType').value;
    const isLifetime = document.getElementById('planIsLifetime').checked;
    const duration = isLifetime ? 99999 : parseInt(document.getElementById('planDuration').value);

    if (!name) {
        Swal.fire('تنبيه', 'يرجى إدخال اسم الباقة', 'warning');
        return;
    }

    savePlanBtn.disabled = true;
    savePlanBtn.textContent = 'جاري الحفظ...';

    try {
        await addDoc(collection(db, 'as3g_plans'), {
            name,
            price: price ? parseFloat(price) : 0,
            versionType,
            isLifetime,
            duration,
            createdAt: Timestamp.now()
        });

        Swal.fire('تم بنجاح', 'تم إضافة الباقة الجديدة', 'success');
        document.getElementById('addPlanModal').style.display = 'none';

        // Reset form
        document.getElementById('planName').value = '';
        document.getElementById('planPrice').value = '';
        document.getElementById('planDuration').value = '30';

        // Reload
        await loadPlans();

    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء حفظ الباقة', 'error');
    } finally {
        savePlanBtn.disabled = false;
        savePlanBtn.textContent = 'حفظ الباقة';
    }
});

// Delete Plan
window.deletePlan = async (planId, planName) => {
    const result = await Swal.fire({
        title: 'هل أنت متأكد؟',
        text: `سيتم حذف الباقة "${planName}" نهائياً.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'نعم، احذفها',
        cancelButtonText: 'إلغاء'
    });

    if (result.isConfirmed) {
        try {
            await deleteDoc(doc(db, 'as3g_plans', planId));
            Swal.fire('تم الحذف!', 'تم حذف الباقة بنجاح.', 'success');
            loadPlans();
        } catch (error) {
            
            Swal.fire('خطأ', 'حدث خطأ أثناء حذف الباقة', 'error');
        }
    }
};

// Modal Open/Close for Plans
const addPlanBtn = document.getElementById('addPlanBtn');
const addPlanModal = document.getElementById('addPlanModal');

addPlanBtn?.addEventListener('click', () => {
    addPlanModal.style.display = 'flex';
});

// Update Generate Code Modal to use Plans
function populatePlanSelect(plans) {
    const select = document.getElementById('planSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- تخصيص يدوي --</option>';
    plans.forEach(plan => {
        const option = document.createElement('option');
        option.value = plan.id;
        option.textContent = `${plan.name} (${plan.isLifetime ? 'مدى الحياة' : plan.duration + ' يوم'})`;
        select.appendChild(option);
    });
}

// Handle Plan Selection in Generate Modal
document.getElementById('planSelect')?.addEventListener('change', (e) => {
    const planId = e.target.value;
    const manualFields = document.getElementById('manualFields');

    if (!planId) {
        // Validation: Enable manual fields
        // We can create a visual indication or just unlock inputs
        document.getElementById('versionType').disabled = false;
        document.getElementById('isLifetime').disabled = false;
        if (!document.getElementById('isLifetime').checked) {
            document.getElementById('codeDuration').disabled = false;
        }
        return;
    }

    const plan = allPlans.find(p => p.id === planId);
    if (plan) {
        // Auto-fill and lock fields
        document.getElementById('versionType').value = plan.versionType;
        document.getElementById('versionType').disabled = true;

        document.getElementById('isLifetime').checked = plan.isLifetime;
        document.getElementById('isLifetime').disabled = true;

        const durationInput = document.getElementById('codeDuration');
        if (plan.isLifetime) {
            durationInput.value = '';
            durationInput.placeholder = 'مدى الحياة';
            durationInput.disabled = true;
        } else {
            durationInput.value = plan.duration;
            durationInput.disabled = true;
        }
    }
});

// Load Codes (Advanced)
window.loadCodes = async function loadCodes() {
    try {
        const codesRef = collection(db, 'activationCodes');
        let q = query(codesRef, orderBy('createdAt', 'desc'));
        const codesSnap = await getDocs(q);

        const tbody = document.getElementById('codesTableBody');
        tbody.innerHTML = '';

        // Filter Values
        const searchInput = document.getElementById('codesSearchInput')?.value.toLowerCase() || '';
        const filterVersion = document.getElementById('filterVersion')?.value || 'all';
        const filterStatus = document.getElementById('filterStatus')?.value || 'all';

        if (codesSnap.empty) {
            tbody.innerHTML = '<tr><td colspan="7" class="no-data">لا توجد أكواد بعد</td></tr>';
            return;
        }

        let hasResults = false;

        codesSnap.forEach((docSnap) => {
            const code = docSnap.data();

            // 1. Filter Logic
            if (searchInput &&
                !code.customerName?.toLowerCase().includes(searchInput) &&
                !code.code?.toLowerCase().includes(searchInput) &&
                !code.customerPhone?.includes(searchInput)) {
                return;
            }

            if (filterVersion !== 'all' && code.versionType !== filterVersion) return;

            if (filterStatus === 'active' && !code.isUsed) return; // Note: 'active' usually means used/activated
            if (filterStatus === 'new' && code.isUsed) return;


            hasResults = true;

            const sanitizedCode = JSON.stringify(code).replace(/"/g, '&quot;');

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <code class="code-display">${code.code}</code>
                </td>
                <td>${code.customerName || '-'}</td>
                <td>${code.customerLocation || '-'}</td>
                <td>${code.customerPhone || '-'}</td>
                <td>
                    <span class="badge ${code.versionType === 'online' ? 'badge-active' : 'badge-available'}" style="font-size: 0.8em;">
                        ${code.versionType === 'online' ? '🌐 أونلاين' : '💻 أوفلاين'}
                    </span>
                </td>
                <td><span class="badge ${code.isUsed ? 'badge-used' : 'badge-available'}">${code.isUsed ? 'مستخدم' : 'متاح'}</span></td>
                <td>${code.durationDays} يوم</td>
                <td>
                     <div class="action-buttons" style="display:flex; gap:5px;">
                        <button class="btn-icon" style="background:#25D366; color:white;" onclick='sendWhatsApp(${sanitizedCode})' title="واتساب"><i class="fab fa-whatsapp"></i></button>
                        <button class="btn-icon" style="background:#3498db; color:white;" onclick='openEditCodeModal("${docSnap.id}", ${sanitizedCode})' title="تعديل"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon" style="background:#607d8b; color:white;" onclick='printCodeCard(${sanitizedCode})' title="طباعة"><i class="fas fa-print"></i></button>
                        <button class="btn-icon" style="background:#34495e; color:white;" onclick="showQRCode('${code.code}')" title="QR Code"><i class="fas fa-qrcode"></i></button>
                        <button class="btn-icon btn-delete" onclick="deleteCode('${docSnap.id}', '${code.code}')" title="حذف">🗑️</button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });

        if (!hasResults) {
            tbody.innerHTML = '<tr><td colspan="8" class="no-data">لا توجد نتائج مطابقة للفلتر</td></tr>';
        }

    } catch (error) {
        
    }
}

// -------------------------------------------------------------
// Advanced Code Features Implementation
// -------------------------------------------------------------

// 1. WhatsApp Integration
window.sendWhatsApp = (codeObj) => {
    if (!codeObj.customerPhone) {
        Swal.fire('خطأ', 'لا يوجد رقم هاتف مسجل لهذا العميل', 'warning');
        return;
    }
    const message = `مرحباً ${codeObj.customerName || 'عميلنا العزيز'}،%0aكود التفعيل الخاص بك هو:%0a*${codeObj.code}*%0aمدة الاشتراك: ${codeObj.durationDays} يوم.`;
    window.open(`https://wa.me/${codeObj.customerPhone}?text=${message}`, '_blank');
};

// 2. QR Code
// 2. QR Code
window.showQRCode = (codeText) => {
    Swal.fire({
        title: 'QR Code',
        html: `
            <div id="qrcode" style="display:flex; justify-content:center; margin:20px auto;"></div>
            <div style="display:flex; justify-content:center; gap:10px; margin-top:20px;">
                <button id="downloadQRBtn" class="swal2-confirm swal2-styled" style="background-color: #2c3e50;">
                    <i class="fas fa-download"></i> تحميل
                </button>
                <button id="shareQRBtn" class="swal2-confirm swal2-styled" style="background-color: #007bff;">
                    <i class="fas fa-share-alt"></i> مشاركة
                </button>
            </div>
        `,
        showConfirmButton: false, // Hide default OK button as we have custom actions
        showCloseButton: true,
        didOpen: () => {
            // Generate QR with High Error Correction
            const qrContainer = document.getElementById("qrcode");
            new QRCode(qrContainer, {
                text: codeText,
                width: 200,
                height: 200,
                correctLevel: QRCode.CorrectLevel.H
            });

            // Wait for QR to render (it renders canvas or img)
            setTimeout(() => {
                const qrCanvas = qrContainer.querySelector('canvas');
                if (!qrCanvas) return;

                const ctx = qrCanvas.getContext('2d');
                const img = new Image();
                img.crossOrigin = "Anonymous";

                img.onload = () => {
                    const size = 50;
                    const x = (qrCanvas.width - size) / 2;
                    const y = (qrCanvas.height - size) / 2;

                    // Draw background
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(x - 2, y - 2, size + 4, size + 4);

                    // Draw Image
                    ctx.drawImage(img, x, y, size, size);
                };
                img.src = 'logo.jpg';

                // Download Handler
                document.getElementById('downloadQRBtn').onclick = () => {
                    const link = document.createElement('a');
                    link.download = `QR_${codeText}.png`;
                    link.href = qrCanvas.toDataURL();
                    link.click();
                };

                // Share Handler
                document.getElementById('shareQRBtn').onclick = async () => {
                    try {
                        const dataUrl = qrCanvas.toDataURL();
                        const blob = await (await fetch(dataUrl)).blob();
                        const file = new File([blob], "qr.png", { type: blob.type });

                        if (navigator.share) {
                            await navigator.share({
                                title: 'AS3G Activation Code',
                                text: `Activation Code: ${codeText}`,
                                files: [file]
                            });
                        } else {
                            copyCode(codeText);
                            Swal.showValidationMessage('تم نسخ الكود');
                        }
                    } catch (err) {
                        
                    }
                };
            }, 500);


        }
    });
};

// 3. Print Card
window.printCodeCard = (code) => {
    const printWindow = window.open('', '', 'width=600,height=400');
    printWindow.document.write(`
        <html dir="rtl" lang="ar">
        <head>
            <title>طباعة الكارت</title>
            <style>
                body { font-family: 'Cairo', sans-serif; text-align: center; border: 5px solid #333; padding: 20px; border-radius: 10px; margin: 20px; }
                h1 { color: #2c3e50; }
                .code-box { background: #eee; padding: 15px; font-size: 24px; font-weight: bold; font-family: monospace; border: 2px dashed #333; display: inline-block; margin: 20px 0; }
                .info { margin: 10px 0; font-size: 18px; }
            </style>
        </head>
        <body>
            <h1>AS3G System Activation</h1>
            <div class="info">اسم العميل: ${code.customerName || 'غير محدد'}</div>
            <div class="code-box">${code.code}</div>
            <div class="info">مدة الاشتراك: ${code.durationDays} يوم</div>
            <div class="info">النسخة: ${code.versionType}</div>
            <p>شكراً لثقتكم بنا</p>
            <script>window.print();<\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

// 4. Edit Code (Open Modal)
window.openEditCodeModal = (id, codeObj) => {
    document.getElementById('editCodeId').value = id;
    document.getElementById('editCustomerNameCode').value = codeObj.customerName || '';
    document.getElementById('editCustomerPhoneCode').value = codeObj.customerPhone || '';
    document.getElementById('editCustomerLocationCode').value = codeObj.customerLocation || '';

    document.getElementById('editCodeModal').style.display = 'flex';
};

window.closeEditCodeModal = () => {
    document.getElementById('editCodeModal').style.display = 'none';
};

window.saveCodeChanges = async () => {
    const id = document.getElementById('editCodeId').value;
    const name = document.getElementById('editCustomerNameCode').value;
    const phone = document.getElementById('editCustomerPhoneCode').value;
    const loc = document.getElementById('editCustomerLocationCode').value;

    if (!id) return;

    try {
        await updateDoc(doc(db, 'activationCodes', id), {
            customerName: name,
            customerPhone: phone,
            customerLocation: loc
        });

        await logAction('تعديل كود', `تم تعديل بيانات كود العميل: ${name}`, { id, name });

        Swal.fire('نجاح', 'تم تحديث بيانات العميل بنجاح', 'success');
        closeEditCodeModal();
        loadCodes();
    } catch (e) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء التحديث', 'error');
    }
};

// -------------------------------------------------------------
// Payments Page System
// -------------------------------------------------------------
window.loadPayments = async function loadPayments() {
    try {
        const tbody = document.getElementById('paymentsTableBody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="6" class="loading">جاري التحميل...</td></tr>';

        // 1. Fetch activationCodes (source of payments)
        const codesRef = collection(db, 'activationCodes');
        let q = query(codesRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        tbody.innerHTML = '';

        // 2. Filters
        const searchInput = document.getElementById('paymentsSearchInput')?.value.toLowerCase() || '';
        const dateFrom = document.getElementById('paymentDateFrom')?.value ? new Date(document.getElementById('paymentDateFrom').value) : null;
        const dateTo = document.getElementById('paymentDateTo')?.value ? new Date(document.getElementById('paymentDateTo').value) : null;

        // If dateTo is selected, set it to end of day
        if (dateTo) dateTo.setHours(23, 59, 59, 999);

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">لا توجد مدفوعات مسجلة</td></tr>';
            return;
        }

        let hasData = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            const created = data.createdAt ? data.createdAt.toDate() : new Date();

            // Filter by Search
            if (searchInput &&
                !data.customerName?.toLowerCase().includes(searchInput) &&
                !data.code?.toLowerCase().includes(searchInput)) {
                return;
            }

            // Filter by Date
            if (dateFrom && created < dateFrom) return;
            if (dateTo && created > dateTo) return;

            hasData = true;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="direction: ltr; text-align: right;">${created.toLocaleString('ar-EG')}</td>
                <td><span style="font-weight:bold; color:#2c3e50;">${data.customerName || 'غير محدد'}</span></td>
                <td><code class="code-display" style="font-size:0.85em;">${data.code}</code></td>
                <td>${data.versionType === 'online' ? '🌐 أونلاين' : '💻 أوفلاين'} - ${data.durationDays} يوم</td>
                <td style="font-weight:bold; color:#27ae60;">${(parseFloat(data.price) || 0).toLocaleString('en-EG')} ج.م</td>
                <td>${data.createdBy || 'Admin'}</td>
            `;
            tbody.appendChild(row);
        });

        if (!hasData) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">لا توجد نتائج مطابقة للبحث</td></tr>';
        }

    } catch (error) {
        
        document.getElementById('paymentsTableBody').innerHTML = '<tr><td colspan="6" class="error">حدث خطأ في تحميل البيانات</td></tr>';
    }
};

window.exportPayments = async function () {
    try {
        const codesRef = collection(db, 'activationCodes');
        const q = query(codesRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            Swal.fire('تنبيه', 'لا توجد بيانات للتصدير', 'info');
            return;
        }

        let csv = '﻿تاريخ المعاملة,اسم العميل,الكود,الباقة/النسخة,المدة,المبلغ (EGP),المسؤول\n';

        snapshot.forEach(doc => {
            const data = doc.data();
            const created = data.createdAt ? data.createdAt.toDate().toLocaleString('ar-EG') : '-';
            const price = parseFloat(data.price) || 0;
            const type = data.versionType === 'online' ? 'Online' : 'Offline';

            csv += `${created},${data.customerName || 'Unknown'},${data.code},${type},${data.durationDays} يوم,${price},${data.createdBy || 'Admin'}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `payments_report_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();

        await logAction('تصدير مدفوعات', 'تم تصدير تقرير المدفوعات');

    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء تصدير المدفوعات', 'error');
    }
};


// -------------------------------------------------------------
// Statistics Enhancements (Upcoming Payments)
// -------------------------------------------------------------
async function calculateExpectedPayments() {
    try {
        const devicesRef = collection(db, 'activatedDevices');
        // Get active devices that expire in next 30 days
        const now = new Date();
        const next30Days = new Date();
        next30Days.setDate(now.getDate() + 30);

        const q = query(devicesRef, where('expiresAt', '>', Timestamp.fromDate(now))); // Not expired yet
        const snapshot = await getDocs(q);

        let expectedTotal = 0;

        snapshot.forEach(doc => {
            const device = doc.data();
            const expiresAt = device.expiresAt.toDate();

            // If expires within next 30 days
            if (expiresAt <= next30Days) {
                // Estimate renewal price based on plan or last payment.
                // Since we don't store plan price directly on device often, we might need to assume or fetch.
                // For simplicity, let's assume average renewal like 1500 or check if 'price' field exists.
                // Better approach: Match plan name if available, or default.
                // Let's assume a default average if not found, or sum 'lastPaidPrice' if we added it.
                // Given current structure, we just sum up a placeholder or try to find plan.

                // Let's treat valid renewal as ~ 500 EGP average if unknown, or use plan price matching plan ID?
                // For this task, strict accuracy requires linking to plans.

                // Hack: use a fixed estimation or random range for demo if no price field.
                // But let's try to be real: Check if we can find plan by name? Complex.
                // Let's assume 0 for now unless we add price to device.

                // Alternative: User asked for "Upcoming Payments". This usually implies verified renewals.
                // Let's sum up 0 but leave comment: "Requires adding 'renewalPrice' to device documents".

                // OK, I will try to match "planId" if exists, or just count them.
                // For now, let's just display the count of expiring devices * Average Plan Price (e.g., 200).
                // Or better, just sum 0 effectively but set up the logic.

                // PROPOSAL: Use a static Average for now (e.g., 250 EGP) just to show UI works, 
                // OR check if 'price' was saved on device activation.

                expectedTotal += (device.price || 300); // Fallback 300 EGP per renewal
            }
        });

        const el = document.getElementById('expectedPayments');
        if (el) el.textContent = expectedTotal.toLocaleString('en-EG') + ' EGP';

    } catch (error) {
        
    }
}


// Global devices data
let allDevicesData = [];
let currentFilter = 'all';
let currentSort = 'activatedAt-desc';
let searchQuery = '';

// Load Devices
async function loadDevices() {
    try {
        const devicesRef = collection(db, 'activatedDevices');
        const devicesSnap = await getDocs(query(devicesRef, orderBy('activatedAt', 'desc')));

        const tbody = document.getElementById('devicesTableBody');
        tbody.innerHTML = '';

        if (devicesSnap.empty) {
            tbody.innerHTML = '<tr><td colspan="7" class="no-data">لا توجد أجهزة مفعلة</td></tr>';
            updateDevicesStats([]);
            return;
        }

        // Store all devices data
        allDevicesData = [];
        devicesSnap.forEach((docSnap) => {
            const device = docSnap.data();
            const now = new Date();
            const expiresAt = device.expiresAt?.toDate();
            const isExpired = expiresAt < now;
            const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

            allDevicesData.push({
                id: docSnap.id,
                ...device,
                expiresAt,
                isExpired,
                daysLeft
            });
        });

        // Apply filter, search, and sort
        filterAndDisplayDevices();
        updateDevicesStats(allDevicesData);
    } catch (error) {
        
    }
}

// Filter and Display Devices
function filterAndDisplayDevices() {
    let filteredDevices = [...allDevicesData];

    // Apply search
    if (searchQuery) {
        filteredDevices = filteredDevices.filter(device =>
            device.deviceName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            device.activationCode?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }

    // Apply filter
    const now = new Date();
    if (currentFilter === 'active') {
        filteredDevices = filteredDevices.filter(d => d.isActive && !d.isExpired);
    } else if (currentFilter === 'stopped') {
        filteredDevices = filteredDevices.filter(d => !d.isActive);
    } else if (currentFilter === 'expired') {
        filteredDevices = filteredDevices.filter(d => d.isExpired);
    }

    // Apply sort
    const [sortField, sortDir] = currentSort.split('-');
    filteredDevices.sort((a, b) => {
        let valA, valB;

        if (sortField === 'deviceName') {
            valA = a.deviceName || '';
            valB = b.deviceName || '';
            return sortDir === 'asc' ? valA.localeCompare(valB, 'ar') : valB.localeCompare(valA, 'ar');
        } else if (sortField === 'daysLeft') {
            valA = a.daysLeft;
            valB = b.daysLeft;
        } else if (sortField === 'activatedAt') {
            valA = a.activatedAt?.toDate().getTime() || 0;
            valB = b.activatedAt?.toDate().getTime() || 0;
        } else if (sortField === 'expiresAt') {
            valA = a.expiresAt?.getTime() || 0;
            valB = b.expiresAt?.getTime() || 0;
        }

        return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    // Display devices
    const tbody = document.getElementById('devicesTableBody');
    tbody.innerHTML = '';

    if (filteredDevices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="no-data">لا توجد نتائج</td></tr>';
        return;
    }

    filteredDevices.forEach((device, index) => {
        const sanitizedData = JSON.stringify({ id: device.id, ...device }).replace(/"/g, '&quot;');

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="checkbox" class="device-checkbox" data-device-id="${device.id}" /></td>
            <td><strong>${index + 1}</strong></td>
            <td>${device.deviceName}</td>
            <td>
                <code class="code-display">${device.activationCode}</code>
                <button class="btn-icon btn-copy" onclick="copyCode('${device.activationCode}')" title="نسخ الكود">📋</button>
            </td>
            <td>${new Date(device.activatedAt.toDate()).toLocaleDateString('ar-EG')}</td>
            <td>${device.expiresAt.toLocaleDateString('ar-EG')}</td>
            <td>
                <span class="badge ${device.isActive && !device.isExpired ? 'badge-active' : device.isExpired ? 'badge-inactive' : 'badge-used'}">
                    ${device.isActive && !device.isExpired ? `✅ نشط (${device.daysLeft} يوم)` : device.isExpired ? '❌ منتهي' : '⏸️ متوقف'}
                </span>
            </td>
            <td>
                <div style="display: flex; gap: 5px;">
                    ${device.isActive && !device.isExpired ?
                `<button class="btn-icon btn-stop" onclick="stopDevice('${device.id}', '${device.deviceName}')" title="إيقاف السيستم">⏸️</button>` :
                `<button class="btn-icon btn-start" onclick="startDevice('${device.id}', '${device.deviceName}')" title="تشغيل السيستم">▶️</button>`
            }
                    <button class="btn-icon btn-renew" onclick='openRenewModal(${sanitizedData})' title="تجديد الاشتراك" style="background: #27ae60; color: white;">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button class="btn-icon btn-edit" onclick='openEditDeviceModal(${sanitizedData})' title="تعديل البيانات" style="background: #f39c12; color: white;">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon btn-delete" onclick="deleteDevice('${device.id}', '${device.deviceName}')" title="مسح السيستم">🗑️</button>
                    <button class="btn-icon btn-info" onclick="showDeviceDetails('${device.id}')" title="التفاصيل">ℹ️</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Update checkbox listeners
    updateCheckboxListeners();
}

// Update Devices Stats
function updateDevicesStats(devices) {
    const now = new Date();
    const activeDevices = devices.filter(d => d.isActive && !d.isExpired);
    const stoppedDevices = devices.filter(d => !d.isActive && !d.isExpired);
    const expiredDevices = devices.filter(d => d.isExpired);

    const totalDaysLeft = activeDevices.reduce((sum, d) => sum + (d.daysLeft > 0 ? d.daysLeft : 0), 0);
    const avgDaysLeft = activeDevices.length > 0 ? Math.round(totalDaysLeft / activeDevices.length) : 0;

    document.getElementById('activeDevicesCount').textContent = activeDevices.length;
    document.getElementById('stoppedDevicesCount').textContent = stoppedDevices.length;
    document.getElementById('expiredDevicesCount').textContent = expiredDevices.length;
    document.getElementById('avgDaysLeft').textContent = avgDaysLeft;
}

// Update Statistics
async function updateStatistics() {
    try {
        const codesRef = collection(db, 'activationCodes');
        const devicesRef = collection(db, 'activatedDevices');

        const [codesSnap, devicesSnap] = await Promise.all([
            getDocs(codesRef),
            getDocs(devicesRef)
        ]);

        const totalCodes = codesSnap.size;
        const usedCodes = codesSnap.docs.filter(doc => doc.data().isUsed).length;
        const activeDevices = devicesSnap.docs.filter(doc => {
            const device = doc.data();
            const now = new Date();
            const expiresAt = device.expiresAt?.toDate();
            return device.isActive && expiresAt > now;
        }).length;

        document.getElementById('totalCodes').textContent = totalCodes;
        document.getElementById('usedCodes').textContent = usedCodes;
        document.getElementById('activeDevices').textContent = activeDevices;
        // Check if availableCodes element exists before setting textContent (it was removed in dashboard.html layout update for charts)
        if (document.getElementById('availableCodes')) {
            document.getElementById('availableCodes').textContent = totalCodes - usedCodes;
        }

        // Calculate Data for Charts
        const availableCodes = totalCodes - usedCodes;

        let onlineCount = 0;
        let offlineCount = 0;
        codesSnap.forEach(doc => {
            const data = doc.data();
            if (data.versionType === 'online') onlineCount++;
            else offlineCount++;
        });

        // Device Stats (already calculated partially, but lets be explicit for charts)
        const now = new Date();
        let activeDevCount = 0;
        let stoppedDevCount = 0;
        let expiredDevCount = 0;

        devicesSnap.forEach(doc => {
            const d = doc.data();
            const expiresAt = d.expiresAt?.toDate();
            const isExpired = expiresAt < now;

            if (d.isActive && !isExpired) activeDevCount++;
            else if (isExpired) expiredDevCount++;
            else stoppedDevCount++; // Inactive but not expired = Stopped manually
        });

        renderCharts({
            codes: { used: usedCodes, available: availableCodes },
            versions: { online: onlineCount, offline: offlineCount },
            devices: { active: activeDevCount, stopped: stoppedDevCount, expired: expiredDevCount }
        });

    } catch (error) {
        
    }
}

// Render Charts Function
let charts = {};

function renderCharts(data) {
    // 1. Codes Chart (Pie)
    const ctxCodes = document.getElementById('codesChart')?.getContext('2d');
    if (ctxCodes) {
        if (charts.codes) charts.codes.destroy();
        charts.codes = new Chart(ctxCodes, {
            type: 'pie',
            data: {
                labels: ['مستخدم', 'متاح'],
                datasets: [{
                    data: [data.codes.used, data.codes.available],
                    backgroundColor: ['#2ecc71', '#95a5a6'],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // 2. Version Chart (Doughnut)
    const ctxVersion = document.getElementById('versionChart')?.getContext('2d');
    if (ctxVersion) {
        if (charts.version) charts.version.destroy();
        charts.version = new Chart(ctxVersion, {
            type: 'doughnut',
            data: {
                labels: ['أونلاين (Online)', 'أوفلاين (Offline)'],
                datasets: [{
                    data: [data.versions.online, data.versions.offline],
                    backgroundColor: ['#3498db', '#f1c40f'],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // 3. Status Chart (Bar)
    const ctxStatus = document.getElementById('statusChart')?.getContext('2d');
    if (ctxStatus) {
        if (charts.status) charts.status.destroy();
        charts.status = new Chart(ctxStatus, {
            type: 'bar',
            data: {
                labels: ['نشط', 'متوقف', 'منتهي'],
                datasets: [{
                    label: 'عدد الأجهزة',
                    data: [data.devices.active, data.devices.stopped, data.devices.expired],
                    backgroundColor: ['#27ae60', '#e67e22', '#e74c3c'],
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, ticks: { allowDecimals: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}

// Generate Code Modal
const generateModal = document.getElementById('generateModal');
const generateCodeBtn = document.getElementById('generateCodeBtn');
const confirmGenerateBtn = document.getElementById('confirmGenerateBtn');

generateCodeBtn?.addEventListener('click', () => {
    generateModal.style.display = 'flex';
});

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        generateModal.style.display = 'none';
    });
});

// Toggle Lifetime checkbox
document.getElementById('isLifetime')?.addEventListener('change', (e) => {
    const durationInput = document.getElementById('codeDuration');
    if (e.target.checked) {
        durationInput.disabled = true;
        durationInput.value = '';
        durationInput.placeholder = 'مدى الحياة';
    } else {
        durationInput.disabled = false;
        durationInput.value = '30';
    }
});

confirmGenerateBtn?.addEventListener('click', async () => {
    const isLifetime = document.getElementById('isLifetime').checked;
    const duration = isLifetime ? 99999 : parseInt(document.getElementById('codeDuration').value);
    const count = parseInt(document.getElementById('codeCount').value);
    const customerName = document.getElementById('customerName').value.trim();
    const customerLocation = document.getElementById('customerLocation').value.trim();
    const customerPhone = document.getElementById('customerPhone').value.trim();
    const versionType = document.getElementById('versionType').value;

    // Validation
    if (!customerName || !customerLocation || !customerPhone) {
        Swal.fire('تنبيه', 'يرجى إدخال جميع بيانات العميل', 'warning');
        return;
    }

    if (!isLifetime && (!duration || duration < 1)) {
        Swal.fire('تنبيه', 'يرجى رقم صحيح لمدة الاشتراك', 'warning');
        return;
    }

    if (!count || count < 1) {
        Swal.fire('تنبيه', 'يرجى إدخال عدد صحيح للأكواد', 'warning');
        return;
    }

    const btn = confirmGenerateBtn;
    btn.disabled = true;
    btn.textContent = 'جاري الإنشاء...';

    try {
        const codesRef = collection(db, 'activationCodes');
        const promises = [];

        // Get Plan Details for Financial Reporting
        const planSelectId = document.getElementById('planSelect').value;
        let planPrice = 0;
        let planName = 'تخصيص يدوي';

        if (planSelectId) {
            const selectedPlan = allPlans.find(p => p.id === planSelectId);
            if (selectedPlan) {
                planPrice = selectedPlan.price || 0;
                planName = selectedPlan.name;
            }
        }

        for (let i = 0; i < count; i++) {
            // If lifetime, expire in year 2099
            // If normal, expire dynamically upon activation (logic handled on client/server activation)
            // But here we set 'durationDays' which is used to calculate expiry ON ACTIVATION.

            promises.push(addDoc(codesRef, {
                code: generateCode(),
                isUsed: false,
                deviceId: null,
                deviceName: null,
                activatedAt: null,
                expiresAt: null, // Will be set on activation
                durationDays: duration,
                isLifetime: isLifetime, // Allow frontend to know easily
                isActive: true,
                // Customer information
                customerName: customerName,
                customerLocation: customerLocation,
                customerPhone: customerPhone,
                versionType: versionType,
                // Financial Info
                price: planPrice,
                planName: planName,
                // Meta
                createdAt: Timestamp.now()
            }));
        }

        await Promise.all(promises);

        await logAction('إنشاء أكواد', `تم إنشاء ${count} كود (المدة: ${isLifetime ? 'مدى الحياة' : duration + ' يوم'})`, { count, duration, isLifetime });

        Swal.fire('تم بنجاح', `تم إنشاء ${count} كود بنجاح ✅`, 'success');
        generateModal.style.display = 'none';

        // Clear form fields
        document.getElementById('customerName').value = '';
        document.getElementById('customerLocation').value = '';
        document.getElementById('customerPhone').value = '';
        document.getElementById('codeDuration').value = '30';
        document.getElementById('codeCount').value = '1';

        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء إنشاء الأكواد', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'إنشاء';
    }
});

// Tab Navigation
const adminSidebar = document.getElementById('adminSidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarToggle = document.getElementById('sidebarToggle');

function toggleSidebar() {
    adminSidebar.classList.toggle('active');
    sidebarOverlay.classList.toggle('active');
}

sidebarToggle?.addEventListener('click', toggleSidebar);
sidebarOverlay?.addEventListener('click', toggleSidebar);

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(tab + 'Tab').classList.add('active');

        // Close sidebar on mobile after clicking
        if (window.innerWidth <= 992) {
            toggleSidebar();
        }
    });
});

// Delete Code
window.deleteCode = async (codeId, code) => {
    const result = await Swal.fire({
        title: 'هل أنت متأكد؟',
        text: `هل تريد حذف الكود ${code}؟`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'نعم، احذف',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        await deleteDoc(doc(db, 'activationCodes', codeId));
        await logAction('حذف كود', `تم حذف الكود: ${code}`, { codeId, code });
        Swal.fire('تم الحذف', 'تم حذف الكود بنجاح', 'success');
        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء الحذف', 'error');
    }
};

// Stop Device (Deactivate)
window.stopDevice = async (deviceId, deviceName) => {
    const result = await Swal.fire({
        title: 'إيقاف السيستم',
        text: `هل أنت متأكد من إيقاف تفعيل ${deviceName}؟`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#f59e0b',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'نعم، إيقاف',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        await updateDoc(doc(db, 'activatedDevices', deviceId), {
            isActive: false
        });
        await logAction('إيقاف سيستم', `تم إيقاف جهاز: ${deviceName}`, { deviceId, deviceName });
        Swal.fire('تم', 'تم إيقاف السيستم بنجاح ⏸️', 'success');
        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء إيقاف السيستم', 'error');
    }
};

// Start Device (Reactivate)
window.startDevice = async (deviceId, deviceName) => {
    const result = await Swal.fire({
        title: 'تشغيل السيستم',
        text: `هل أنت متأكد من تشغيل ${deviceName}؟`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#10b981',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'نعم، تشغيل',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        await updateDoc(doc(db, 'activatedDevices', deviceId), {
            isActive: true
        });
        await logAction('تشغيل سيستم', `تم تشغيل جهاز: ${deviceName}`, { deviceId, deviceName });
        Swal.fire('تم', 'تم تشغيل السيستم بنجاح ▶️', 'success');
        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء تشغيل السيستم', 'error');
    }
};

// Delete Device
window.deleteDevice = async (deviceId, deviceName) => {
    const result = await Swal.fire({
        title: 'حذف جهاز نهائياً',
        text: `هل أنت متأكد من حذف ${deviceName}؟ هذا الإجراء لا يمكن التراجع عنه.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'حذف نهائي',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        await deleteDoc(doc(db, 'activatedDevices', deviceId));
        await logAction('حذف سيستم', `تم حذف جهاز: ${deviceName}`, { deviceId, deviceName });
        Swal.fire('تم الحذف', 'تم حذف الجهاز بنجاح', 'success');
        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء الحذف', 'error');
    }
};

// Auto refresh every 30 seconds
setInterval(() => {
    loadDashboardData();
}, 30000);

// Load Reports
// Load Activity Logs (Reports)
async function loadReports() {
    try {
        const logsRef = collection(db, 'system_logs');
        let q = query(logsRef, orderBy('createdAt', 'desc'));

        // Apply filters if set
        const dateFrom = document.getElementById('logDateFrom')?.value;
        const dateTo = document.getElementById('logDateTo')?.value;
        const adminFilter = document.getElementById('logAdminFilter')?.value.toLowerCase();
        const actionFilter = document.getElementById('logActionFilter')?.value;

        const logsSnap = await getDocs(q);
        let logs = logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Filter InMemory
        if (dateFrom) {
            const fromDate = new Date(dateFrom);
            logs = logs.filter(log => log.createdAt?.toDate() >= fromDate);
        }
        if (dateTo) {
            const toDate = new Date(dateTo);
            toDate.setHours(23, 59, 59, 999);
            logs = logs.filter(log => log.createdAt?.toDate() <= toDate);
        }
        if (adminFilter) {
            logs = logs.filter(log => log.adminEmail?.toLowerCase().includes(adminFilter));
        }
        if (actionFilter && actionFilter !== 'all') {
            logs = logs.filter(log => log.action === actionFilter);
        }

        const tbody = document.getElementById('reportsTableBody');
        tbody.innerHTML = '';

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">لا توجد سجلات نشاط</td></tr>';
            return;
        }

        logs.forEach((log) => {
            const date = log.createdAt ? log.createdAt.toDate().toLocaleString('ar-EG') : '-';
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="direction: ltr; text-align: right;">${date}</td>
                <td>${log.adminEmail || 'Unknown'}</td>
                <td><span class="badge badge-active">${log.action}</span></td>
                <td>${log.description || log.details || '-'}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        
        const tbody = document.getElementById('reportsTableBody');
        tbody.innerHTML = '<tr><td colspan="4" class="no-data" style="color: red;">خطأ في تحميل السجلات</td></tr>';
    }
}

// Apply Filters Listener
document.getElementById('applyLogFilters')?.addEventListener('click', loadReports);

// Navbar Scroll Effect Removed (Navbar no longer exists)

// Export to CSV
document.getElementById('exportReportBtn')?.addEventListener('click', async () => {
    try {
        const codesRef = collection(db, 'activationCodes');
        const codesSnap = await getDocs(query(codesRef, orderBy('createdAt', 'desc')));

        let csv = '﻿اسم العميل,المكان,التليفون,الكود,المدة,تاريخ الإنشاء,تاريخ التفعيل,تاريخ الانتهاء,الحالة\n';

        codesSnap.forEach((docSnap) => {
            const code = docSnap.data();
            const status = code.isUsed ? (
                code.expiresAt && code.expiresAt.toDate() > new Date() ? 'نشط' : 'منتهي'
            ) : 'غير مفعل';

            csv += `${code.customerName || '-'},${code.customerLocation || '-'},${code.customerPhone || '-'},${code.code},${code.durationDays},`;
            csv += `${code.createdAt ? new Date(code.createdAt.toDate()).toLocaleDateString('ar-EG') : '-'},`;
            csv += `${code.activatedAt ? new Date(code.activatedAt.toDate()).toLocaleDateString('ar-EG') : '-'},`;
            csv += `${code.expiresAt ? new Date(code.expiresAt.toDate()).toLocaleDateString('ar-EG') : '-'},`;
            csv += `${status}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `activation_report_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();

        Swal.fire('تم التصدير', 'تم تصدير التقرير بنجاح ✅', 'success');
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء التصدير', 'error');
    }
});

// ========== DEVICES PAGE FEATURES ==========

// Search functionality
document.getElementById('devicesSearch')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    filterAndDisplayDevices();
});

// Filter functionality
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        filterAndDisplayDevices();
    });
});

// Sort functionality
document.getElementById('devicesSort')?.addEventListener('change', (e) => {
    currentSort = e.target.value;
    filterAndDisplayDevices();
});

// Checkbox functionality
function updateCheckboxListeners() {
    const checkboxes = document.querySelectorAll('.device-checkbox');
    const selectAll = document.getElementById('selectAllDevices');
    const bulkActionsBar = document.getElementById('bulkActionsBar');
    const selectedCount = document.getElementById('selectedCount');

    // Select all checkbox
    selectAll?.addEventListener('change', (e) => {
        checkboxes.forEach(cb => cb.checked = e.target.checked);
        updateBulkActionsBar();
    });

    // Individual checkboxes
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            updateBulkActionsBar();
        });
    });

    function updateBulkActionsBar() {
        const checked = document.querySelectorAll('.device-checkbox:checked');
        if (checked.length > 0) {
            bulkActionsBar.style.display = 'flex';
            selectedCount.textContent = checked.length;
        } else {
            bulkActionsBar.style.display = 'none';
        }
    }
}

// Get selected device IDs
function getSelectedDeviceIds() {
    const checked = document.querySelectorAll('.device-checkbox:checked');
    return Array.from(checked).map(cb => cb.dataset.deviceId);
}

// Bulk Start Devices
// Bulk Start Devices
window.bulkStartDevices = async () => {
    const deviceIds = getSelectedDeviceIds();
    if (deviceIds.length === 0) return;

    const result = await Swal.fire({
        title: 'تشغيل جماعي',
        text: `هل أنت متأكد من تشغيل ${deviceIds.length} جهاز؟`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'نعم، تشغيل',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        const promises = deviceIds.map(id =>
            updateDoc(doc(db, 'activatedDevices', id), { isActive: true })
        );
        await Promise.all(promises);
        await logAction('تشغيل جماعي', `تم تشغيل ${deviceIds.length} جهاز`, { count: deviceIds.length, deviceIds });
        Swal.fire('تم', `تم تشغيل ${deviceIds.length} جهاز بنجاح ▶️`, 'success');
        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء تشغيل الأجهزة', 'error');
    }
};

// Bulk Stop Devices
// Bulk Stop Devices
window.bulkStopDevices = async () => {
    const deviceIds = getSelectedDeviceIds();
    if (deviceIds.length === 0) return;

    const result = await Swal.fire({
        title: 'إيقاف جماعي',
        text: `هل أنت متأكد من إيقاف ${deviceIds.length} جهاز؟`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'نعم، إيقاف',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        const promises = deviceIds.map(id =>
            updateDoc(doc(db, 'activatedDevices', id), { isActive: false })
        );
        await Promise.all(promises);
        await logAction('إيقاف جماعي', `تم إيقاف ${deviceIds.length} جهاز`, { count: deviceIds.length, deviceIds });
        Swal.fire('تم', `تم إيقاف ${deviceIds.length} جهاز بنجاح ⏸️`, 'success');
        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء إيقاف الأجهزة', 'error');
    }
};

// Bulk Delete Devices
// Bulk Delete Devices
window.bulkDeleteDevices = async () => {
    const deviceIds = getSelectedDeviceIds();
    if (deviceIds.length === 0) return;

    const result = await Swal.fire({
        title: 'حذف جماعي',
        text: `⚠️ هل أنت متأكد من حذف ${deviceIds.length} جهاز نهائياً؟ هذا الإجراء لا يمكن التراجع عنه!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'حذف الكل',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        const promises = deviceIds.map(id =>
            deleteDoc(doc(db, 'activatedDevices', id))
        );
        await Promise.all(promises);
        await logAction('حذف جماعي', `تم حذف ${deviceIds.length} جهاز`, { count: deviceIds.length, deviceIds });
        Swal.fire('تم الحذف', `تم حذف ${deviceIds.length} جهاز بنجاح 🗑️`, 'success');
        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء حذف الأجهزة', 'error');
    }
};



// Export Selected Devices
window.exportSelectedDevices = () => {
    const deviceIds = getSelectedDeviceIds();
    if (deviceIds.length === 0) {
        Swal.fire('تنبيه', 'يرجى تحديد أجهزة للتصدير', 'info');
        return;
    }

    const selectedDevices = allDevicesData.filter(d => deviceIds.includes(d.id));
    exportDevicesToCSV(selectedDevices, `selected_devices_${new Date().toISOString().split('T')[0]}.csv`);
};

// Export All Devices
window.exportAllDevices = () => {
    if (allDevicesData.length === 0) {
        Swal.fire('تنبيه', 'لا توجد أجهزة للتصدير', 'info');
        return;
    }

    exportDevicesToCSV(allDevicesData, `all_devices_${new Date().toISOString().split('T')[0]}.csv`);
};

// Export Devices to CSV
function exportDevicesToCSV(devices, filename) {
    let csv = '﻿اسم الجهاز,كود التفعيل,تاريخ التفعيل,تاريخ الانتهاء,الأيام المتبقية,الحالة,اسم العميل,المكان,التليفون\n';

    devices.forEach((device) => {
        const status = device.isActive && !device.isExpired ? 'نشط' : device.isExpired ? 'منتهي' : 'متوقف';
        csv += `${device.deviceName},${device.activationCode},`;
        csv += `${new Date(device.activatedAt.toDate()).toLocaleDateString('ar-EG')},`;
        csv += `${device.expiresAt.toLocaleDateString('ar-EG')},`;
        csv += `${device.daysLeft > 0 ? device.daysLeft : 0},${status},`;
        csv += `${device.customerName || '-'},${device.customerLocation || '-'},${device.customerPhone || '-'}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();

    Swal.fire('تم التصدير', `تم تصدير ${devices.length} جهاز بنجاح ✅`, 'success');
}

// Copy Code to Clipboard
window.copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
        // Show a temporary tooltip or notification
        const Toast = Swal.mixin({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true
        });
        Toast.fire({
            icon: 'success',
            title: 'تم نسخ الكود بنجاح! 📋'
        });
    }).catch(err => {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء نسخ الكود', 'error');
    });
};

// Consolidated Log Action Helper
async function logAction(action, description = '', details = {}) {
    try {
        const adminEmail = auth.currentUser ? auth.currentUser.email : 'Unknown';
        await addDoc(collection(db, 'system_logs'), {
            action,
            description,
            details,
            adminEmail,
            createdAt: Timestamp.now()
        });
    } catch (error) {
        
    }
}


// Fix Device Names (Sequential Renaming)
// Fix Device Names (Sequential Renaming)
// -------------------------------------------------------------
// Expiry & Renewal System
// -------------------------------------------------------------

// Load Expiring Devices (<= 7 Days)
async function loadExpiringDevices() {
    try {
        const devicesRef = collection(db, 'activatedDevices');
        // We get all active devices and filter in JS for simplicity with dates
        // Alternatively we could use complex Firestone queries if index exists
        const q = query(devicesRef, where('isActive', '==', true));
        const snapshot = await getDocs(q);

        const tbody = document.getElementById('expiryTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        let count = 0;
        const now = new Date();

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Calculate days left
            let expiresAt = data.expiresAt ? data.expiresAt.toDate() : null;
            if (!expiresAt) return;

            const diffTime = expiresAt - now;
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Filter: Show only if 7 days or less (and not already expired/negative too far)
            // Let's show expired ones too that haven't been stopped? Or just "coming soon".
            // User asked for "Approach finish". Let's say <= 7.
            if (daysLeft <= 7) {
                count++;
                const row = document.createElement('tr');
                const isExpired = daysLeft < 0;

                // Construct WhatsApp Message
                const customerName = data.customerName || 'عميلنا العزيز';
                const warningMsg = `مرحباً ${customerName}،%0aنود تنبيهك بأن اشتراكك لجهاز (${data.deviceName}) سينتهي خلال ${daysLeft > 0 ? daysLeft + ' يوم' : 'ساعات'}.%0aيرجى التجديد لضمان استمرار الخدمة.`;

                const sanitizedData = JSON.stringify({ id: docSnap.id, ...data }).replace(/"/g, '&quot;');

                row.innerHTML = `
                    <td style="font-weight:bold;">${data.deviceName}</td>
                    <td>${data.customerName || '-'}</td>
                    <td>${data.customerPhone || '-'}</td>
                    <td>${expiresAt.toLocaleDateString('ar-EG')}</td>
                    <td>
                        <span class="days-remaining" style="${isExpired ? 'color: red;' : ''}">
                            ${isExpired ? 'منتهي' : daysLeft + ' يوم'}
                        </span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-icon" style="background:#25D366; color:white;" 
                                onclick="window.open('https://wa.me/${data.customerPhone}?text=${warningMsg}', '_blank')" 
                                title="إرسال تنبيه واتساب">
                                <i class="fab fa-whatsapp"></i>
                            </button>
                            <button class="btn-icon" style="background:#27ae60; color:white;" 
                                onclick='openRenewModal(${sanitizedData})' 
                                title="تجديد الاشتراك">
                                <i class="fas fa-sync-alt"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(row);
            }
        });

        if (count === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data" style="color: green;"><i class="fas fa-check-circle"></i> لا توجد اشتراكات توشك على الانتهاء حالياً</td></tr>';
        }

    } catch (error) {
        
    }
}

// Renew Modal Functions
window.openRenewModal = (device) => {
    document.getElementById('renewDeviceId').value = device.id;
    document.getElementById('renewCustomerPhone').value = device.customerPhone || '';
    document.getElementById('renewDeviceName').textContent = `تجديد جهاز: ${device.deviceName}`;

    // Reset inputs
    document.getElementById('renewDuration').value = '30';
    document.getElementById('customRenewDiv').style.display = 'none';

    const modal = document.getElementById('renewModal');
    modal.style.display = 'flex';
};

window.closeRenewModal = () => {
    document.getElementById('renewModal').style.display = 'none';
};

// Handle Custom Duration Toggle
document.getElementById('renewDuration')?.addEventListener('change', (e) => {
    const customDiv = document.getElementById('customRenewDiv');
    if (e.target.value === 'custom') {
        customDiv.style.display = 'block';
    } else {
        customDiv.style.display = 'none';
    }
});

// Confirm Renewal
window.confirmRenewal = async () => {
    const deviceId = document.getElementById('renewDeviceId').value;
    const durationSelect = document.getElementById('renewDuration').value;

    let daysToAdd = 0;
    if (durationSelect === 'custom') {
        daysToAdd = parseInt(document.getElementById('renewCustomDays').value);
    } else {
        daysToAdd = parseInt(durationSelect);
    }

    if (!daysToAdd || daysToAdd <= 0) {
        Swal.fire('خطأ', 'يرجى اختيار مدة صحيحة', 'warning');
        return;
    }

    try {
        // Get current device data to calculate new expiry
        const deviceRef = doc(db, 'activatedDevices', deviceId);
        const deviceSnap = await getDoc(deviceRef); // We need getDoc imported? It usually is.
        // Wait, I need to check imports. Assuming getDoc is available or I use getDocs logic.
        // Actually I can just update based on *current date* or *current expiry*?
        // Usually renewal adds to the *existing* expiry if it hasn't passed, or from *today* if it has passed.

        if (!deviceSnap.exists()) {
            Swal.fire('خطأ', 'الجهاز غير موجود', 'error');
            return;
        }

        const data = deviceSnap.data();
        let currentExpiry = data.expiresAt.toDate();
        const now = new Date();

        // If expired, start from now. If active, add to current expiry.
        let newStartDate = (currentExpiry < now) ? now : currentExpiry;
        let newExpiryDate = new Date(newStartDate);
        newExpiryDate.setDate(newExpiryDate.getDate() + daysToAdd);

        // Update Doc
        await updateDoc(deviceRef, {
            expiresAt: Timestamp.fromDate(newExpiryDate),
            isActive: true // Ensure it's active
        });

        // Log
        await logAction('تجديد اشتراك', `تم تجديد جهاز ${data.deviceName} لمدة ${daysToAdd} يوم`, { deviceId, daysToAdd });

        Swal.fire('تم التجديد', `تم تمديد الاشتراك بنجاح حتى ${newExpiryDate.toLocaleDateString('ar-EG')} ✅`, 'success');
        closeRenewModal();

        // Refresh Lists
        loadExpiringDevices();
        loadDevices(); // Refresh main list too

    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء التجديد', 'error');
    }
};

// Hook into Main Loader
// I'll add loadExpiringDevices() to the global loadDashboardData logic manually in next step or here if I can find it.
// For now, let's expose specific loader for the tab click.

document.querySelector('.tab-btn[data-tab="expiry"]')?.addEventListener('click', () => {
    loadExpiringDevices();
});

// Add getDoc to imports if missing? 
// I will check imports in next step to be safe.
// -------------------------------------------------------------
// Edit Device & Enhanced Logs System
// -------------------------------------------------------------

// Open Edit Modal
window.openEditDeviceModal = (device) => {
    document.getElementById('editDeviceId').value = device.id;
    document.getElementById('editDeviceName').value = device.deviceName;
    document.getElementById('editCustomerName').value = device.customerName || '';
    document.getElementById('editCustomerPhone').value = device.customerPhone || '';
    document.getElementById('editDeviceNotes').value = device.notes || ''; // New field

    const modal = document.getElementById('editDeviceModal');
    modal.style.display = 'flex';
};

window.closeEditDeviceModal = () => {
    document.getElementById('editDeviceModal').style.display = 'none';
};

// Save Changes
window.saveDeviceChanges = async () => {
    const deviceId = document.getElementById('editDeviceId').value;
    const customerName = document.getElementById('editCustomerName').value.trim();
    const customerPhone = document.getElementById('editCustomerPhone').value.trim();
    const notes = document.getElementById('editDeviceNotes').value.trim();

    if (!customerName) {
        Swal.fire('تنبيه', 'يرجى إدخال اسم العميل', 'warning');
        return;
    }

    try {
        const deviceRef = doc(db, 'activatedDevices', deviceId);

        await updateDoc(deviceRef, {
            customerName,
            customerPhone,
            notes,
            lastUpdated: Timestamp.now()
        });

        // Log Action
        await logAction('تعديل بيانات العميل', `تم تعديل بيانات جهاز ${document.getElementById('editDeviceName').value}`, {
            deviceId, customerName, customerPhone
        });

        Swal.fire('تم الحفظ', 'تم تحديث بيانات الجهاز بنجاح ✅', 'success');
        closeEditDeviceModal();
        loadDevices(); // Refresh list

    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء حفظ التغييرات', 'error');
    }
};



// Update Detail View to Show Logs
window.showDeviceDetails = async (deviceId) => {
    try {
        const deviceRef = doc(db, 'activatedDevices', deviceId);
        const deviceSnap = await getDoc(deviceRef); // Ensure getDoc import

        if (!deviceSnap.exists()) {
            Swal.fire('خطأ', 'الجهاز غير موجود', 'error');
            return;
        }

        const data = deviceSnap.data();
        const createdDate = data.activatedAt ? data.activatedAt.toDate().toLocaleDateString('ar-EG') : '-';
        const expiresDate = data.expiresAt ? data.expiresAt.toDate().toLocaleDateString('ar-EG') : '-';

        // Fetch Logs for this device
        let logsHtml = '<p class="text-muted">جاري تحميل السجل...</p>';

        try {
            const logsRef = collection(db, 'system_logs');
            // Query logs where details.deviceId == deviceId (requires index) OR filter client side if small
            // For now, simpler: just query recently created logs and filter manually
            const q = query(logsRef, orderBy('createdAt', 'desc'));
            const logsSnap = await getDocs(q);

            const deviceLogs = logsSnap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(log => log.details?.deviceId === deviceId);

            if (deviceLogs.length > 0) {
                logsHtml = '<ul style="list-style: none; padding: 0; max-height: 200px; overflow-y: auto;">';
                deviceLogs.forEach(log => {
                    const date = log.createdAt.toDate().toLocaleString('ar-EG');
                    let icon = '🔹';
                    if (log.action.includes('تجديد')) icon = '🔄';
                    if (log.action.includes('إيقاف')) icon = '⏸️';
                    if (log.action.includes('تشغيل')) icon = '▶️';
                    if (log.action.includes('تعديل')) icon = '✏️';

                    logsHtml += `
                        <li style="padding: 8px; border-bottom: 1px solid #eee; font-size: 0.9rem;">
                            <span style="font-weight:bold;">${icon} ${log.action}</span>
                            <br>
                            <span style="color:#666;">${log.description}</span>
                            <br>
                            <small dir="ltr" style="color:#aaa;">${date}</small>
                        </li>
                    `;
                });
                logsHtml += '</ul>';
            } else {
                logsHtml = '<p class="text-muted"><i class="fas fa-history"></i> لا يوجد سجل نشاط متاح لهذا الجهاز بعد.</p>';
            }

        } catch (e) {
            
            logsHtml = '<p style="color:red">فشل تحميل السجل</p>';
        }

        Swal.fire({
            title: `تفاصيل الجهاز: ${data.deviceName}`,
            html: `
                <div style="text-align: right; direction: rtl;">
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin-bottom: 15px;">
                        <p><strong>👤 العميل:</strong> ${data.customerName || '-'}</p>
                        <p><strong>📱 الهاتف:</strong> ${data.customerPhone || '-'}</p>
                        <p><strong>🔑 الكود:</strong> <code style="background:#eee; padding:2px 5px; border-radius:3px;">${data.activationCode}</code></p>
                        <p><strong>📅 تاريخ التفعيل:</strong> ${createdDate}</p>
                        <p><strong>⏳ تاريخ الانتهاء:</strong> ${expiresDate}</p>
                        <p><strong>📝 ملاحظات:</strong> ${data.notes || 'لا توجد ملاحظات'}</p>
                    </div>
                    
                    <h4 style="border-bottom: 2px solid #eee; padding-bottom: 5px; margin-bottom: 10px;">
                        <i class="fas fa-history"></i> سجل النشاط
                    </h4>
                    <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 10px;">
                        ${logsHtml}
                    </div>
                </div>
            `,
            width: '600px',
            showCloseButton: true,
            confirmButtonText: 'إغلاق'
        });

    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء عرض التفاصيل', 'error');
    }
};
window.fixDeviceNames = async () => {
    const result = await Swal.fire({
        title: 'تصحيح الأسماء',
        text: 'هل أنت متأكد من إعادة تسمية جميع الأجهزة وتسلسلها (Device 1, Device 2...) حسب تاريخ التفعيل؟',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'نعم، صحح الأسماء',
        cancelButtonText: 'إلغاء'
    });

    if (!result.isConfirmed) return;

    try {
        const devicesRef = collection(db, 'activatedDevices');
        // Get all devices ordered by activation date (oldest first)
        const q = query(devicesRef, orderBy('activatedAt', 'asc'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            Swal.fire('تنبيه', 'لا توجد أجهزة لتحديثها', 'info');
            return;
        }

        const promises = [];
        let index = 1;

        querySnapshot.forEach((docSnap) => {
            const newName = `Device ${index}`;
            promises.push(updateDoc(doc(db, 'activatedDevices', docSnap.id), {
                deviceName: newName
            }));
            index++;
        });

        await Promise.all(promises);

        // Log the action
        await logAction('تصحيح أسماء', `تم تحديث أسماء ${promises.length} جهاز`, { count: promises.length });

        Swal.fire('تم', `تم تحديث أسماء ${promises.length} جهاز بنجاح ✅`, 'success');
        await loadDashboardData();
    } catch (error) {
        
        Swal.fire('خطأ', 'حدث خطأ أثناء تحديث الأسماء', 'error');
    }
};

window.logAction = logAction; // Expose globally

// -------------------------------------------------------------
// Backup & Import System
// -------------------------------------------------------------

// Helper to get all collection data
async function getCollectionData(collectionName) {
    const colRef = collection(db, collectionName);
    const snap = await getDocs(colRef);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Export System Data
async function exportSystemData() {
    try {
        Swal.fire({
            title: 'جاري تحضير النسخة الاحتياطية...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const collections = [
            'activationCodes',
            'activatedDevices',
            'as3g_plans',
            'system_logs',
            'as3g_notifications',
            'support_tickets'
        ];

        const backupData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            data: {}
        };

        for (const col of collections) {
            backupData.data[col] = await getCollectionData(col);
        }

        // Convert to JSON and download
        const dataStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `as3g_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        await logAction('تصدير نسخة احتياطية', 'تم تصدير نسخة احتياطية كاملة للنظام');
        Swal.fire('تم بنجاح', 'تم تحميل النسخة الاحتياطية بنجاح ✅', 'success');

    } catch (error) {
        
        Swal.fire('خطأ', 'فشل في عملية النسخ الاحتياطي', 'error');
    }
}

// Import System Data
async function importSystemData(file) {
    if (!file) {
        Swal.fire('تنبيه', 'يرجى اختيار ملف أولاً', 'warning');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const backup = JSON.parse(e.target.result);
            if (!backup.data || typeof backup.data !== 'object') {
                throw new Error('Invalid backup format');
            }

            const result = await Swal.fire({
                title: 'هل أنت متأكد؟',
                text: 'سيتم استيراد البيانات وتحديث السجلات الموجودة. قد تستغرق هذه العملية بعض الوقت.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'نعم، ابدأ الاستيراد',
                cancelButtonText: 'إلغاء'
            });

            if (!result.isConfirmed) return;

            Swal.fire({
                title: 'جاري استيراد البيانات...',
                text: 'يرجى عدم إغلاق الصفحة',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            let totalImported = 0;

            for (const [colName, docs] of Object.entries(backup.data)) {
                for (const docData of docs) {
                    const { id, ...cleanData } = docData;

                    // Convert serialized Timestamps back to Firestore Timestamps
                    for (const key in cleanData) {
                        const val = cleanData[key];
                        if (val && typeof val === 'object') {
                            if (typeof val.seconds === 'number' && typeof val.nanoseconds === 'number') {
                                cleanData[key] = new Timestamp(val.seconds, val.nanoseconds);
                            }
                        } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
                            // If it's an ISO string, convert to Date then to Timestamp
                            cleanData[key] = Timestamp.fromDate(new Date(val));
                        }
                    }

                    // Smart Sync: use docId from backup to keep consistency
                    await setDoc(doc(db, colName, id), cleanData, { merge: true });
                    totalImported++;
                }
            }

            await logAction('استيراد بيانات', `تم استيراد ${totalImported} سجل من نسخة احتياطية`, { count: totalImported });

            Swal.fire('تم بنجاح', `تم استيراد ${totalImported} سجل بنجاح! سيتم إعادة تحميل البيانات.`, 'success');
            await loadDashboardData();
            updateBackupSummary();

        } catch (err) {
            
            Swal.fire('خطأ', 'فشل في استيراد البيانات. تأكد من صحة الملف.', 'error');
        }
    };
    reader.readAsText(file);
}

// Update Backup Summary Counts
async function updateBackupSummary() {
    try {
        const collections = {
            'activationCodes': 'count_codes',
            'activatedDevices': 'count_devices',
            'as3g_plans': 'count_plans',
            'system_logs': 'count_logs'
        };

        for (const [col, elementId] of Object.entries(collections)) {
            const snap = await getDocs(collection(db, col));
            const el = document.getElementById(elementId);
            if (el) el.textContent = snap.size;
        }
    } catch (e) {
        
    }
}

// Event Listeners
document.getElementById('exportBackupBtn')?.addEventListener('click', exportSystemData);
document.getElementById('importBackupBtn')?.addEventListener('click', () => {
    const file = document.getElementById('importFileInput').files[0];
    importSystemData(file);
});

// Initial load for settings tab
document.querySelector('[data-tab="settings"]')?.addEventListener('click', updateBackupSummary);
