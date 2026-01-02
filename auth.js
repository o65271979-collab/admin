// Authentication JavaScript
document.addEventListener('DOMContentLoaded', function () {
    // Check if user is already logged in
    auth.onAuthStateChanged((user) => {
        if (user) {
            // Redirect to account page if already logged in
            window.location.href = 'account.html';
        }
    });

    // Handle login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Handle register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
});

// Switch between login and register tabs
function switchTab(tab) {
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = document.querySelectorAll('.auth-form');

    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => f.classList.remove('active'));

    document.querySelector(`[onclick="switchTab('${tab}')"]`).classList.add('active');
    document.getElementById(`${tab}Form`).classList.add('active');
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();

    const form = e.target;
    const submitBtn = form.querySelector('.btn-submit');
    const btnText = submitBtn.querySelector('.btn-text');
    const loading = submitBtn.querySelector('.loading');

    // Show loading state
    btnText.style.display = 'none';
    loading.style.display = 'inline-block';
    submitBtn.disabled = true;

    const formData = new FormData(form);
    const email = formData.get('email');
    const password = formData.get('password');

    try {
        const result = await FirebaseUtils.signInWithEmail(email, password);

        if (result.success) {
            showMessage('تم تسجيل الدخول بنجاح!', 'success');
            // Redirect to account page
            setTimeout(() => {
                window.location.href = 'account.html';
            }, 1000);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'حدث خطأ في تسجيل الدخول';

        // Handle specific Firebase errors
        if (result && result.error === 'blocked_account') {
            errorMessage = 'عذراً، هذا الحساب محظور حالياً. يرجى التواصل مع الدعم الفني لمزيد من التفاصيل.';
        } else if (error.message.includes('user-not-found')) {
            errorMessage = 'البريد الإلكتروني غير مسجل';
        } else if (error.message.includes('wrong-password')) {
            errorMessage = 'كلمة المرور غير صحيحة';
        } else if (error.message.includes('invalid-email')) {
            errorMessage = 'البريد الإلكتروني غير صالح';
        } else if (error.message.includes('too-many-requests')) {
            errorMessage = 'تم تجاوز عدد المحاولات المسموح. يرجى المحاولة لاحقاً';
        }

        showMessage(errorMessage, 'error');
    } finally {
        // Reset button state
        btnText.style.display = 'inline';
        loading.style.display = 'none';
        submitBtn.disabled = false;
    }
}

// Handle registration
async function handleRegister(e) {
    e.preventDefault();

    const form = e.target;
    const submitBtn = form.querySelector('.btn-submit');
    const btnText = submitBtn.querySelector('.btn-text');
    const loading = submitBtn.querySelector('.loading');

    // Show loading state
    btnText.style.display = 'none';
    loading.style.display = 'inline-block';
    submitBtn.disabled = true;

    const formData = new FormData(form);
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');

    // Validate password confirmation
    if (password !== confirmPassword) {
        showMessage('كلمة المرور وتأكيد كلمة المرور غير متطابقين', 'error');
        btnText.style.display = 'inline';
        loading.style.display = 'none';
        submitBtn.disabled = false;
        return;
    }

    const userData = {
        name: formData.get('name'),
        businessName: formData.get('businessName'),
        phone: formData.get('phone'),
        address: formData.get('address'),
        role: 'customer'
    };

    const email = formData.get('email');

    try {
        const result = await FirebaseUtils.signUpWithEmail(email, password, userData);

        if (result.success) {
            showMessage('تم إنشاء الحساب بنجاح!', 'success');
            // Redirect to account page
            setTimeout(() => {
                window.location.href = 'account.html';
            }, 1000);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Registration error:', error);
        let errorMessage = 'حدث خطأ في إنشاء الحساب';

        // Handle specific Firebase errors
        if (error.message.includes('email-already-in-use')) {
            errorMessage = 'البريد الإلكتروني مستخدم بالفعل';
        } else if (error.message.includes('weak-password')) {
            errorMessage = 'كلمة المرور ضعيفة. يجب أن تكون 6 أحرف على الأقل';
        } else if (error.message.includes('invalid-email')) {
            errorMessage = 'البريد الإلكتروني غير صالح';
        }

        showMessage(errorMessage, 'error');
    } finally {
        // Reset button state
        btnText.style.display = 'inline';
        loading.style.display = 'none';
        submitBtn.disabled = false;
    }
}

// Show forgot password modal
function showForgotPassword() {
    const modal = createModal();

    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>استعادة كلمة المرور</h2>
        <p style="color: #666; margin-bottom: 2rem;">أدخل بريدك الإلكتروني وسنرسل لك رابط لإعادة تعيين كلمة المرور</p>
        
        <form id="forgotPasswordForm">
            <div class="form-group">
                <label for="resetEmail">البريد الإلكتروني</label>
                <input type="email" id="resetEmail" name="email" required>
            </div>
            
            <button type="submit" class="btn-submit">
                <span class="btn-text">إرسال رابط الاستعادة</span>
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

    // Handle forgot password form
    const forgotForm = document.getElementById('forgotPasswordForm');
    forgotForm.onsubmit = async (e) => {
        e.preventDefault();

        const submitBtn = forgotForm.querySelector('.btn-submit');
        const btnText = submitBtn.querySelector('.btn-text');
        const loading = submitBtn.querySelector('.loading');

        btnText.style.display = 'none';
        loading.style.display = 'inline-block';
        submitBtn.disabled = true;

        const formData = new FormData(forgotForm);
        const email = formData.get('email');

        try {
            await auth.sendPasswordResetEmail(email);
            showMessage('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني', 'success');
            document.body.removeChild(modal);
        } catch (error) {
            console.error('Password reset error:', error);
            let errorMessage = 'حدث خطأ في إرسال رابط الاستعادة';

            if (error.message.includes('user-not-found')) {
                errorMessage = 'البريد الإلكتروني غير مسجل';
            } else if (error.message.includes('invalid-email')) {
                errorMessage = 'البريد الإلكتروني غير صالح';
            }

            showMessage(errorMessage, 'error');
        } finally {
            btnText.style.display = 'inline';
            loading.style.display = 'none';
            submitBtn.disabled = false;
        }
    };
}

// Create modal element (reuse from main.js)
function createModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <!-- Content will be added dynamically -->
        </div>
    `;
    return modal;
}

// Show message to user (reuse from main.js)
function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;

    // Insert at the top of the page
    document.body.insertBefore(messageDiv, document.body.firstChild);

    // Remove after 5 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
        }
    }, 5000);
}
