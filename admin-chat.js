document.addEventListener('DOMContentLoaded', async function () {
    // Wait for auth to be ready
    if (window.auth) {
        window.auth.onAuthStateChanged(user => {
            if (user) {
                window.db.collection('users').doc(user.uid).get().then(doc => {
                    if (doc.exists) {
                        const userData = doc.data();
                        const fullUser = { uid: user.uid, ...userData };
                        initChatWidget(fullUser);
                        startPresenceSystem(fullUser);
                    }
                });
            }
        });
    }
});

let chatUnsubscribe = null;
let currentChatId = null;
let currentChatUser = null;
let presenceInterval = null;
let globalUnreadCount = 0;

function startPresenceSystem(user) {
    const userRef = window.db.collection('users').doc(user.uid);
    userRef.set({ isOnline: true, lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    presenceInterval = setInterval(() => {
        userRef.set({ isOnline: true, lastSeen: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }, 120000);
}

async function initChatWidget(currentUser) {
    const startButton = document.getElementById('chatWidgetBtn');
    const chatWindow = document.getElementById('chatWidgetWindow');
    const closeButton = document.getElementById('closeChatBtn');
    const sendButton = document.getElementById('sendMessageBtn');
    const messageInput = document.getElementById('chatMessageInput');
    const messagesContainer = document.getElementById('chatMessages');
    const chatHeaderTitle = document.querySelector('.chat-header-info h4');
    const chatHeaderStatus = document.querySelector('.chat-header-info p');
    const notificationBadge = document.getElementById('chatNotificationBadge');

    const audio = new Audio('notification.mp3');

    let backBtn = document.getElementById('chatBackBtn');
    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.id = 'chatBackBtn';
        backBtn.className = 'chat-back-btn';
        backBtn.innerHTML = '<i class="fas fa-arrow-right"></i>';
        backBtn.style.display = 'none';
        document.querySelector('.chat-header').prepend(backBtn);
    }

    if (!startButton || !chatWindow) return;

    startButton.addEventListener('click', () => {
        chatWindow.classList.toggle('active');
        startButton.classList.toggle('active');
        document.body.classList.toggle('chat-active'); // للتعتيم الخلفي في الموبايل

        if (chatWindow.classList.contains('active')) {
            loadContactsView();
        }
    });

    closeButton.addEventListener('click', () => {
        chatWindow.classList.remove('active');
        startButton.classList.remove('active');
        document.body.classList.remove('chat-active');
    });

    backBtn.addEventListener('click', () => {
        loadContactsView();
    });

    // Send Message
    async function sendMessage() {
        const text = messageInput.value.trim();
        if (!text || !currentChatId) return;

        try {
            messageInput.value = '';

            await window.db.collection('chats').doc(currentChatId).collection('messages').add({
                text: text,
                senderId: currentUser.uid,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                read: false
            });

            // Increment unread count for the OTHER person
            // And reset MINE
            const updates = {
                lastMessage: text,
                lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
                participants: [currentUser.uid, currentChatUser.id]
            };

            // Increment logic for the recipient
            // Since field names in Firestore update can be dynamic paths:
            updates[`unread_${currentChatUser.id}`] = firebase.firestore.FieldValue.increment(1);
            updates[`unread_${currentUser.uid}`] = 0; // Reset my unread count just in case

            await window.db.collection('chats').doc(currentChatId).set(updates, { merge: true });

        } catch (error) {

        }
    }

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    function updateNotificationBadge(count) {
        if (count > 0) {
            notificationBadge.textContent = count > 99 ? '99+' : count;
            notificationBadge.style.display = 'flex';
        } else {
            notificationBadge.style.display = 'none';
        }
    }

    function playNotificationSound() {
        audio.play().catch(() => { });
    }

    // --- Contacts View ---
    let contactsUnsubscribe = null;
    let chatsMetadataUnsubscribe = null;

    function loadContactsView() {
        currentChatId = null;
        currentChatUser = null;
        if (chatUnsubscribe) chatUnsubscribe();

        backBtn.style.display = 'none';
        chatHeaderTitle.textContent = 'المحادثات';
        chatHeaderStatus.innerHTML = '<span class="status-dot"></span> المتواجدون';
        document.querySelector('.chat-footer').style.display = 'none';
        messagesContainer.innerHTML = '<div class="loading-spinner">جاري التحميل...</div>';
        messagesContainer.classList.add('contacts-mode');

        const myRole = currentUser.role;
        let targetRoles = (myRole === 'super_admin')
            ? ['super_admin', 'admin', 'support', 'editor']
            : ['super_admin'];

        // 1. Listen to Users
        contactsUnsubscribe = window.db.collection('users')
            .where('role', 'in', targetRoles)
            .onSnapshot(snapshot => {
                const admins = [];
                snapshot.forEach(doc => {
                    if (doc.id !== currentUser.uid) {
                        admins.push({ id: doc.id, ...doc.data() });
                    }
                });
                renderContacts(admins);

                // 2. Determine unread counts AFTER rendering contacts
                subscribeToChatMetadata();

            }, error => {
                messagesContainer.innerHTML = '<p class="error-text">حدث خطأ في تحميل جهات الاتصال</p>';
            });
    }

    function renderContacts(admins) {
        if (admins.length === 0) {
            messagesContainer.innerHTML = '<p class="empty-text">لا يوجد جهات اتصال.</p>';
            return;
        }

        let html = '<div class="contacts-list">';
        admins.forEach(admin => {
            const roleName = getRoleName(admin.role);
            const isOnline = isUserOnline(admin);
            const statusClass = isOnline ? 'online' : '';

            // Note: Added a placeholder for the unread badge
            html += `
                <div class="contact-item" data-id="${admin.id}" id="contact-${admin.id}">
                    <div class="contact-avatar">
                        <i class="fas fa-user-shield"></i>
                    </div>
                    <div class="contact-info">
                        <h4>${admin.name || 'مستخدم إداري'}</h4>
                        <p>${roleName}</p>
                    </div>
                    <div class="contact-meta">
                        <span class="unread-count" id="unread-${admin.id}" style="display:none">0</span>
                        <div class="contact-status ${statusClass}"></div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        messagesContainer.innerHTML = html;

        document.querySelectorAll('.contact-item').forEach(item => {
            item.addEventListener('click', () => {
                if (contactsUnsubscribe) contactsUnsubscribe();
                if (chatsMetadataUnsubscribe) chatsMetadataUnsubscribe();
                const adminId = item.getAttribute('data-id');
                const adminData = admins.find(a => a.id === adminId);
                openChat(adminData);
            });
        });
    }

    function subscribeToChatMetadata() {
        if (chatsMetadataUnsubscribe) chatsMetadataUnsubscribe();

        // Listen to all chats where I am a participant
        chatsMetadataUnsubscribe = window.db.collection('chats')
            .where('participants', 'array-contains', currentUser.uid)
            .onSnapshot(snapshot => {
                let totalUnread = 0;

                snapshot.docChanges().forEach(change => {
                    const data = change.doc.data();
                    // Identify the other user in this chat
                    const otherUserId = data.participants.find(p => p !== currentUser.uid);

                    if (otherUserId) {
                        const myUnread = data[`unread_${currentUser.uid}`] || 0;

                        // Update UIBadge in List
                        const badgeEl = document.getElementById(`unread-${otherUserId}`);
                        if (badgeEl) {
                            badgeEl.textContent = myUnread;
                            badgeEl.style.display = myUnread > 0 ? 'inline-flex' : 'none';
                        }

                        totalUnread += myUnread;

                        // Sound logic
                        if (change.type === 'modified' && myUnread > 0) {
                            // Only play if the change *increased* unread count (technically simplification)
                            // Or just play on any new message modification that has unread > 0
                            // Simple throttle could be added
                            if (data.lastMessageTime &&
                                (!currentChatId || currentChatId !== change.doc.id)) {
                                playNotificationSound();
                            }
                        }
                    }
                });

                // If it's the initial load, we might simply calculate total
                // Re-calculating total from scratch on snapshot is safer for global badge
                totalUnread = 0;
                snapshot.forEach(doc => {
                    const d = doc.data();
                    totalUnread += (d[`unread_${currentUser.uid}`] || 0);
                });
                updateNotificationBadge(totalUnread);
            });
    }

    async function openChat(otherUser) {
        currentChatUser = otherUser;
        const chatId = getChatId(currentUser.uid, otherUser.id);
        currentChatId = chatId;
        const isOnline = isUserOnline(otherUser);

        backBtn.style.display = 'block';
        chatHeaderTitle.textContent = otherUser.name || 'مستخدم';
        chatHeaderStatus.innerHTML = `<span class="status-dot ${isOnline ? '' : 'offline'}" style="background: ${isOnline ? '#4ade80' : '#cbd5e1'}"></span> ${isOnline ? 'متصل الآن' : 'غير متصل'}`;

        document.querySelector('.chat-footer').style.display = 'flex';
        messagesContainer.innerHTML = '<div class="loading-spinner">جاري تحميل المحادثة...</div>';
        messagesContainer.classList.remove('contacts-mode');

        // Reset my unread count for this chat
        window.db.collection('chats').doc(chatId).set({
            [`unread_${currentUser.uid}`]: 0
        }, { merge: true });

        chatUnsubscribe = window.db.collection('chats').doc(chatId).collection('messages')
            .orderBy('createdAt', 'asc')
            .onSnapshot(snapshot => {
                messagesContainer.innerHTML = '';
                if (snapshot.empty) {
                    messagesContainer.innerHTML = '<p class="empty-chat">ابدأ المحادثة الآن...</p>';
                } else {
                    snapshot.forEach(doc => {
                        const msg = doc.data();
                        addMessageToUI(msg.text, msg.senderId === currentUser.uid ? 'user' : 'support', msg.createdAt);
                    });
                    scrollToBottom();
                }
            });
    }

    function addMessageToUI(text, type, timestamp) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}-message`;
        let timeStr = '...';
        if (timestamp) timeStr = timestamp.toDate().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

        messageDiv.innerHTML = `<div class="message-content">${text}</div><div class="message-time">${timeStr}</div>`;
        messagesContainer.appendChild(messageDiv);
    }

    function scrollToBottom() {
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function getChatId(uid1, uid2) {
        return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
    }

    function getRoleName(role) {
        const roles = { 'super_admin': 'المدير العام', 'admin': 'مشرف النظام', 'support': 'الدعم الفني', 'editor': 'محموعة التحرير' };
        return roles[role] || 'عضو إداري';
    }

    function isUserOnline(user) {
        if (!user.isOnline || !user.lastSeen) return false;
        const diff = (new Date() - user.lastSeen.toDate()) / 1000 / 60;
        return diff < 5;
    }
}
