// نظام صلاحيات المدير
class AdminPermissions {
    constructor() {
        this.permissions = {
            // صلاحيات لوحة التحكم
            dashboard: { view: true },

            // صلاحيات إدارة المنتجات
            products: {
                view: true,
                add: true,
                edit: true,
                delete: true
            },
            // صلاحيات قائمة العملاء
            customers: {
                view: true,
                block: true,
                delete: true
            },
            // صلاحيات إدارة المستخدمين
            users: {
                view: true,
                add: true,
                edit: true,
                delete: true,
                permissions: true
            },
            // صلاحيات الدعم الفني
            support: {
                view: true,
                reply: true,
                close: true,
                delete: true
            },
            // صلاحيات الطلبات
            orders: {
                view: true,
                edit: true,
                delete: true,
                reports: true
            },
            faq: {
                view: true,
                add: true,
                edit: true,
                delete: true
            },

            // صلاحيات الإعدادات
            settings: {
                view: true,
                edit: true,
                backup: true,
                import: true,
                system: true
            },
            // صلاحيات التقارير والإحصائيات
            analytics: {
                view: true,
                export: true,
                advanced: true
            },
            // الكوبونات
            coupons: {
                view: true,
                add: true,
                edit: true,
                delete: true
            },
            // إدارة المحتوى
            cms: {
                view: true,
                add: true,
                edit: true,
                delete: true
            },
            // سجلات النشاط
            logs: {
                view: true
            },
            // نظام AS3G
            as3g: {
                view: true
            },

            // نشاط الدعم
            support_activity: {
                view: true
            },
            // طلبات شحن الرصيد
            wallet_recharge: {
                view: true,
                approve: true,
                reject: true
            },
            // سوق الأجهزة المستعملة
            hardware_marketplace: {
                view: true,
                add: true,
                edit: true,
                delete: true
            },
            // المدفوعات الحية
            live_payments: {
                view: true,
                export: true
            },
            // التقارير والمبيعات
            reports: {
                view: true,
                export: true
            }
        };

        this.adminRoles = {
            'super_admin': {
                name: 'مدير عام',
                permissions: 'all'
            },
            'admin': {
                name: 'مدير',
                permissions: 'all'
            },
            'products_manager': {
                name: 'مدير المنتجات',
                permissions: {
                    dashboard: { view: true },
                    products: 'all',
                    coupons: 'all',
                    analytics: { view: true }
                }
            },
            'support_manager': {
                name: 'مدير الدعم الفني',
                permissions: {
                    dashboard: { view: true },
                    support: 'all',
                    users: { view: true },
                    faq: ['view', 'add', 'edit', 'delete']
                }
            },
            'orders_manager': {
                name: 'مدير الطلبات',
                permissions: {
                    dashboard: { view: true },
                    orders: 'all',
                    users: { view: true },
                    analytics: { view: true, export: true }
                }
            },
            'content_manager': {
                name: 'مدير المحتوى',
                permissions: {
                    dashboard: { view: true },
                    cms: 'all',
                    faq: ['view', 'manage'],
                    reports: ['view', 'export'],
                    settings: ['view', 'edit']
                }
            }
        };
    }

    // فحص صلاحية معينة للمدير (Synchronous version for UI/Checks)
    can(section, action, userData) {
        if (!userData) return false;

        const role = userData.role;
        // المستخدم العادي ليس له صلاحيات
        if (!role || role === 'user') {
            return false;
        }

        // المدير العام له جميع الصلاحيات
        if (role === 'super_admin') {
            return true;
        }

        // البحث عن الدور
        const roleData = this.adminRoles[role];

        // First Check: Legacy/UI "Page Permissions" (overrides role defaults)
        if (userData.pagePermissions && userData.pagePermissions[section] !== undefined) {
            // If explicitly set to false, deny access
            if (userData.pagePermissions[section] === false) {
                return false;
            }
            // If explicitly set to true AND the action is 'view', grant access
            if (userData.pagePermissions[section] === true && action === 'view') {
                return true;
            }
        }

        // فحص الصلاحيات المخصصة (Custom Permissions override role permissions)
        if (userData.customPermissions) {
            const customPerms = userData.customPermissions[section];
            if (customPerms && customPerms[action] !== undefined) {
                return customPerms[action];
            }
        }

        if (!roleData) {
            // Fallback for custom roles or just 'admin' if not defined in roles list
            if (role === 'admin') return true;
            return false;
        }

        // فحص صلاحيات الدور الأساسي
        const perms = roleData.permissions;
        if (perms === 'all') {
            return true;
        }

        // Check specific section permissions
        if (perms[section]) {
            if (perms[section] === 'all') {
                return true;
            }
            // If permissions are an array (e.g., ['view', 'edit']), check if action is in array
            if (Array.isArray(perms[section])) {
                return perms[section].includes(action);
            }
            // If permissions are an object (e.g., { view: true }), check action property
            return perms[section][action] || false;
        }

        return false;
    }

    // فحص صلاحية معينة للمدير
    async checkPermission(userId, section, action) {
        try {
            const userDoc = await firebase.firestore().collection('users').doc(userId).get();

            if (!userDoc.exists) {
                return false;
            }

            const userData = userDoc.data();
            const role = userData.role;

            // المستخدم العادي ليس له صلاحيات
            if (!role || role === 'user') {
                return false;
            }

            // المدير العام له جميع الصلاحيات
            if (role === 'super_admin') {
                return true;
            }

            // البحث عن الدور
            const roleData = this.adminRoles[role];
            if (!roleData) {
                // Fallback for custom roles or just 'admin' if not defined in roles list
                if (role === 'admin') return true;
                return false;
            }

            // First Check: Legacy/UI "Page Permissions" (overrides role defaults)
            // This comes from the "Edit User Role" modal checkboxes
            if (userData.pagePermissions && userData.pagePermissions[section] !== undefined) {
                // If explicitly set to false, deny access
                if (userData.pagePermissions[section] === false) {
                    return false;
                }
                // If explicitly set to true AND the action is 'view', grant access
                if (userData.pagePermissions[section] === true && action === 'view') {
                    return true;
                }
                // For other actions (edit, delete), we might still fall back to role or customPermissions
                // But generally, if the page is enabled, we assume basic view access.
            }

            // فحص الصلاحيات المخصصة (Custom Permissions override role permissions)
            if (userData.customPermissions) {
                const customPerms = userData.customPermissions[section];
                if (customPerms && customPerms[action] !== undefined) {
                    return customPerms[action];
                }
            }

            // فحص صلاحيات الدور الأساسي
            const perms = roleData.permissions;
            if (perms === 'all') {
                return true;
            }

            // Check specific section permissions
            if (perms[section]) {
                if (perms[section] === 'all') {
                    return true;
                }
                // If permissions are an array (e.g., ['view', 'edit']), check if action is in array
                if (Array.isArray(perms[section])) {
                    return perms[section].includes(action);
                }
                // If permissions are an object (e.g., { view: true }), check action property
                return perms[section][action] || false;
            }

            return false;
        } catch (error) {
            console.error('خطأ في فحص الصلاحيات:', error);
            return false;
        }
    }

    // إخفاء/إظهار عناصر الواجهة حسب الصلاحيات
    async applyUIPermissions(userId) {
        const menuItems = {
            'dashboard': { selector: '.menu-item[onclick*="dashboard"]', section: 'dashboard', action: 'view' },
            'orders': { selector: '.menu-item[onclick*="orders"]', section: 'orders', action: 'view' },
            'customers': { selector: '.menu-item[onclick*="customers"]', section: 'customers', action: 'view' },
            'users': { selector: '.menu-item[onclick*="users"]', section: 'users', action: 'view' },
            'support': { selector: '.menu-item[onclick*="support"]', section: 'support', action: 'view' },

            'products': { selector: '.menu-item[onclick*="products"]', section: 'products', action: 'view' },
            'reports': { selector: '.menu-item[onclick*="reports"]', section: 'reports', action: 'view' },
            'faq': { selector: '.menu-item[onclick*="faq"]', section: 'faq', action: 'view' },
            'settings': { selector: '.menu-item[onclick*="settings"]', section: 'settings', action: 'view' },
            'logs': { selector: '.menu-item[onclick*="logs"]', section: 'logs', action: 'view' },

            'support_activity': { selector: '.menu-item[onclick*="support_activity"]', section: 'support_activity', action: 'view' },
            'as3g': { selector: 'a.menu-item[href*="as3g"]', section: 'as3g', action: 'view' },
            'live_payments': { selector: '.menu-item[onclick*="live_payments"]', section: 'live_payments', action: 'view' },
            'wallet_recharge': { selector: '.menu-item[onclick*="wallet_recharge"]', section: 'wallet_recharge', action: 'view' },
            'hardware_marketplace': { selector: '.menu-item[onclick*="hardware_marketplace"]', section: 'hardware_marketplace', action: 'view' },
            'reports': { selector: '.menu-item[onclick*="reports"]', section: 'reports', action: 'view' }
        };

        for (const [key, item] of Object.entries(menuItems)) {
            const hasPermission = await this.checkPermission(userId, item.section, item.action);
            const elements = document.querySelectorAll(item.selector);

            elements.forEach(element => {
                if (hasPermission) {
                    element.style.display = 'flex'; // Assuming flex for menu items
                } else {
                    element.style.setProperty('display', 'none', 'important');
                }
            });
        }
    }

    // إنشاء واجهة إدارة الصلاحيات
    createPermissionsUI(userId, targetUserId) {
        return `
            <div class="permissions-manager" style="margin-top: 1rem; border-top: 1px solid #eee; padding-top: 1rem;">
                <h3 style="color: #2c5aa0; margin-bottom: 1rem;">صلاحيات الوصول المخصصة</h3>
                <p style="color: #666; font-size: 0.9rem; margin-bottom: 1rem;">
                    حدد الصفحات التي يمكن لهذا المستخدم الوصول إليها. إذا تركتها فارغة، سيتم تطبيق صلاحيات الدور الافتراضية.
                </p>
                
                <div class="role-selector" style="margin-bottom: 1rem;">
                    <label style="font-weight: bold; margin-left: 0.5rem;">الدور:</label>
                    <select id="adminRoleSelector" onchange="window.AdminPermissions.updateRolePermissionsUI()" style="padding: 0.5rem; border-radius: 5px; border: 1px solid #ddd;">
                        ${Object.entries(this.adminRoles).map(([key, role]) =>
            `<option value="${key}">${role.name}</option>`
        ).join('')}
                    </select>
                </div>
                
                <div class="permissions-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; max-height: 300px; overflow-y: auto; padding: 0.5rem; background: #f8f9fa; border-radius: 8px;">
                    ${Object.entries(this.permissions).map(([section, actions]) => `
                        <div class="permission-section" style="background: white; padding: 0.8rem; border-radius: 5px; border: 1px solid #eee;">
                            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #1565c0;">
                                <label style="cursor: pointer; display: flex; align-items: center;">
                                    <input type="checkbox" onchange="window.AdminPermissions.toggleSection('${section}', this.checked)" style="margin-left: 0.5rem;">
                                    ${this.getSectionName(section)}
                                </label>
                            </h4>
                            <div class="section-actions" id="actions_${section}">
                                ${Object.keys(actions).map(action => `
                                    <label class="permission-item" style="display: block; font-size: 0.8rem; margin-bottom: 0.3rem; color: #555; cursor: pointer;">
                                        <input type="checkbox" 
                                               id="perm_${section}_${action}"
                                               class="perm-checkbox"
                                               data-section="${section}"
                                               data-action="${action}">
                                        <span style="margin-right: 0.3rem;">${this.getActionName(action)}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    toggleSection(section, checked) {
        document.querySelectorAll(`[id^="perm_${section}_"]`).forEach(input => {
            input.checked = checked;
        });
    }

    // Update the checkboxes based on selected role
    updateRolePermissionsUI() {
        const role = document.getElementById('adminRoleSelector').value;
        const roleData = this.adminRoles[role];

        if (!roleData) return;

        // Reset all first
        document.querySelectorAll('.perm-checkbox').forEach(cb => cb.checked = false);

        if (roleData.permissions === 'all') {
            document.querySelectorAll('.perm-checkbox').forEach(cb => cb.checked = true);
        } else if (roleData.permissions) {
            Object.entries(roleData.permissions).forEach(([section, actions]) => {
                if (actions === 'all') {
                    document.querySelectorAll(`[id^="perm_${section}_"]`).forEach(cb => cb.checked = true);
                } else if (Array.isArray(actions)) { // Handle array of actions
                    actions.forEach(action => {
                        const cb = document.getElementById(`perm_${section}_${action}`);
                        if (cb) cb.checked = true;
                    });
                }
                else if (typeof actions === 'object') {
                    Object.keys(actions).forEach(action => {
                        const cb = document.getElementById(`perm_${section}_${action}`);
                        if (cb) cb.checked = true;
                    });
                }
            });
        }
    }

    getSectionName(section) {
        const names = {
            dashboard: 'الرئيسية',
            orders: 'الطلبات',
            customers: 'قائمة العملاء',
            users: 'المستخدمين',
            support: 'الدعم الفني',

            products: 'إدارة المنتجات',
            reports: 'التقارير والإحصائيات',
            faq: 'الأسئلة الشائعة',
            settings: 'الإعدادات',
            logs: 'سجلات النشاط',

            support_activity: 'نشاط الدعم الفني',
            as3g: 'نظام AS3G',
            live_payments: 'المدفوعات الحية',
            wallet_recharge: 'طلبات شحن الرصيد',
            hardware_marketplace: 'سوق الأجهزة المستعملة',
            reports: 'التقارير والمبيعات'
        };
        return names[section] || section;
    }

    getActionName(action) {
        const names = {
            view: 'عرض الصفحة',
            add: 'إضافة',
            edit: 'تعديل',
            delete: 'حذف',
            reply: 'الرد',
            close: 'إغلاق',
            permissions: 'الصلاحيات',
            backup: 'نسخ احتياطي',
            import: 'استيراد',
            export: 'تصدير',
            system: 'إعدادات النظام',
            reports: 'التقارير',
            advanced: 'متقدم'
        };
        return names[action] || action;
    }
}

// إنشاء مثيل عام
window.AdminPermissions = new AdminPermissions();

async function saveAdminPermissions(userId) {
    const role = document.getElementById('adminRoleSelector').value;
    const customPermissions = {};

    // جمع الصلاحيات المخصصة
    Object.keys(window.AdminPermissions.permissions).forEach(section => {
        customPermissions[section] = {};
        Object.keys(window.AdminPermissions.permissions[section]).forEach(action => {
            const input = document.getElementById(`perm_${section}_${action}`);
            if (input) {
                customPermissions[section][action] = input.checked;
            }
        });
    });

    try {
        await firebase.firestore().collection('users').doc(userId).update({
            role: role,
            isAdmin: role === 'admin' || role === 'super_admin' || role.includes('manager'),
            customPermissions: customPermissions,
            permissionsUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        showMessage('تم حفظ الصلاحيات بنجاح', 'success');
        closeModal();
    } catch (error) {
        console.error('خطأ في حفظ الصلاحيات:', error);
        showMessage('خطأ في حفظ الصلاحيات', 'error');
    }
}

function resetToRoleDefaults() {
    window.AdminPermissions.updateRolePermissionsUI();
}
