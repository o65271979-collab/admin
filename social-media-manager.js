// Social Media Links Manager
let socialMediaLinks = {
    facebook: '',
    twitter: '',
    instagram: '',
    linkedin: '',
    youtube: '',
    whatsapp: '',
    telegram: ''
};

// Load social media links from Firebase
async function loadSocialMediaLinks() {
    try {
        const result = await FirebaseUtils.getDocument('settings', 'social_media');
        if (result.success && result.data) {
            socialMediaLinks = { ...socialMediaLinks, ...result.data };
            updateSocialMediaDisplay();
        }
    } catch (error) {
        console.error('Error loading social media links:', error);
    }
}

// Update social media links display in footer
function updateSocialMediaDisplay() {
    const socialContainer = document.querySelector('.social-links');
    if (!socialContainer) return;
    
    const socialHTML = Object.entries(socialMediaLinks)
        .filter(([platform, url]) => url && url.trim())
        .map(([platform, url]) => {
            const icon = getSocialIcon(platform);
            const name = getSocialName(platform);
            return `
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="social-link" title="${name}">
                    <i class="${icon}"></i>
                </a>
            `;
        }).join('');
    
    socialContainer.innerHTML = socialHTML;
}

// Get social media icon class
function getSocialIcon(platform) {
    const icons = {
        facebook: 'fab fa-facebook-f',
        twitter: 'fab fa-twitter',
        instagram: 'fab fa-instagram',
        linkedin: 'fab fa-linkedin-in',
        youtube: 'fab fa-youtube',
        whatsapp: 'fab fa-whatsapp',
        telegram: 'fab fa-telegram-plane'
    };
    return icons[platform] || 'fas fa-link';
}

// Get social media platform name
function getSocialName(platform) {
    const names = {
        facebook: 'فيسبوك',
        twitter: 'تويتر',
        instagram: 'إنستغرام',
        linkedin: 'لينكد إن',
        youtube: 'يوتيوب',
        whatsapp: 'واتساب',
        telegram: 'تليجرام'
    };
    return names[platform] || platform;
}

// Show social media management modal (for admin)
function showSocialMediaManager() {
    const modal = createModal();
    
    modal.querySelector('.modal-content').innerHTML = `
        <span class="close">&times;</span>
        <h2>إدارة روابط وسائل التواصل الاجتماعي</h2>
        
        <form id="socialMediaForm" style="text-align: right;">
            <div class="social-media-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin: 2rem 0;">
                
                <div class="form-group">
                    <label><i class="fab fa-facebook-f" style="color: #1877f2;"></i> فيسبوك:</label>
                    <input type="url" name="facebook" value="${socialMediaLinks.facebook || ''}" placeholder="https://facebook.com/yourpage">
                </div>
                
                <div class="form-group">
                    <label><i class="fab fa-twitter" style="color: #1da1f2;"></i> تويتر:</label>
                    <input type="url" name="twitter" value="${socialMediaLinks.twitter || ''}" placeholder="https://twitter.com/youraccount">
                </div>
                
                <div class="form-group">
                    <label><i class="fab fa-instagram" style="color: #e4405f;"></i> إنستغرام:</label>
                    <input type="url" name="instagram" value="${socialMediaLinks.instagram || ''}" placeholder="https://instagram.com/youraccount">
                </div>
                
                <div class="form-group">
                    <label><i class="fab fa-linkedin-in" style="color: #0077b5;"></i> لينكد إن:</label>
                    <input type="url" name="linkedin" value="${socialMediaLinks.linkedin || ''}" placeholder="https://linkedin.com/company/yourcompany">
                </div>
                
                <div class="form-group">
                    <label><i class="fab fa-youtube" style="color: #ff0000;"></i> يوتيوب:</label>
                    <input type="url" name="youtube" value="${socialMediaLinks.youtube || ''}" placeholder="https://youtube.com/c/yourchannel">
                </div>
                
                <div class="form-group">
                    <label><i class="fab fa-whatsapp" style="color: #25d366;"></i> واتساب:</label>
                    <input type="url" name="whatsapp" value="${socialMediaLinks.whatsapp || ''}" placeholder="https://wa.me/201234567890">
                </div>
                
                <div class="form-group">
                    <label><i class="fab fa-telegram-plane" style="color: #0088cc;"></i> تليجرام:</label>
                    <input type="url" name="telegram" value="${socialMediaLinks.telegram || ''}" placeholder="https://t.me/yourchannel">
                </div>
            </div>
            
            <div class="preview-section" style="background: #f8f9fa; padding: 1.5rem; border-radius: 10px; margin: 2rem 0;">
                <h4 style="color: #2c5aa0; margin-bottom: 1rem;">معاينة الروابط:</h4>
                <div class="social-preview" id="socialPreview">
                    <!-- Preview will be updated here -->
                </div>
            </div>
            
            <div class="form-actions">
                <button type="submit" class="btn-primary">
                    <i class="fas fa-save"></i> حفظ الروابط
                </button>
                <button type="button" class="btn-secondary" onclick="closeModal()">إلغاء</button>
            </div>
        </form>
    `;
    
    document.body.appendChild(modal);
    modal.style.display = 'block';
    
    setupModalClose(modal);
    updateSocialPreview();
    
    // Add input event listeners for live preview
    const inputs = modal.querySelectorAll('input[type="url"]');
    inputs.forEach(input => {
        input.addEventListener('input', updateSocialPreview);
    });
    
    // Handle form submission
    document.getElementById('socialMediaForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const newLinks = {};
        
        // Collect all form data
        for (const [key, value] of formData.entries()) {
            newLinks[key] = value.trim();
        }
        
        try {
            const result = await FirebaseUtils.updateDocument('settings', 'social_media', newLinks);
            
            if (result.success) {
                socialMediaLinks = { ...socialMediaLinks, ...newLinks };
                updateSocialMediaDisplay();
                showMessage('تم حفظ روابط وسائل التواصل بنجاح!', 'success');
                closeModal();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            // If document doesn't exist, create it
            try {
                const createResult = await FirebaseUtils.addDocument('settings', newLinks);
                if (createResult.success) {
                    // Update the document ID to 'social_media'
                    await FirebaseUtils.updateDocument('settings', createResult.id, { id: 'social_media' });
                    socialMediaLinks = { ...socialMediaLinks, ...newLinks };
                    updateSocialMediaDisplay();
                    showMessage('تم حفظ روابط وسائل التواصل بنجاح!', 'success');
                    closeModal();
                } else {
                    throw new Error(createResult.error);
                }
            } catch (createError) {
                showMessage('حدث خطأ في حفظ الروابط', 'error');
            }
        }
    });
}

// Update social media preview
function updateSocialPreview() {
    const previewContainer = document.getElementById('socialPreview');
    if (!previewContainer) return;
    
    const form = document.getElementById('socialMediaForm');
    const formData = new FormData(form);
    const tempLinks = {};
    
    for (const [key, value] of formData.entries()) {
        tempLinks[key] = value.trim();
    }
    
    const previewHTML = Object.entries(tempLinks)
        .filter(([platform, url]) => url)
        .map(([platform, url]) => {
            const icon = getSocialIcon(platform);
            const name = getSocialName(platform);
            return `
                <a href="${url}" target="_blank" class="social-link-preview" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; background: white; border-radius: 8px; text-decoration: none; color: #333; margin: 0.25rem; border: 1px solid #ddd;">
                    <i class="${icon}"></i>
                    <span>${name}</span>
                </a>
            `;
        }).join('');
    
    previewContainer.innerHTML = previewHTML || '<p style="color: #666; text-align: center;">لا توجد روابط للمعاينة</p>';
}

// Initialize social media on page load
document.addEventListener('DOMContentLoaded', function() {
    loadSocialMediaLinks();
});

// Export functions for use in admin panel
if (typeof window !== 'undefined') {
    window.showSocialMediaManager = showSocialMediaManager;
    window.loadSocialMediaLinks = loadSocialMediaLinks;
}
