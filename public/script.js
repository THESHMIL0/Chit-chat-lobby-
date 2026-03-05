const socket = io();

// 🌟 ALWAYS sanitize text to prevent hackers!
function escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

const loginScreen = document.getElementById('login-screen');
const roomListScreen = document.getElementById('room-list-screen');
const chatScreen = document.getElementById('chat-screen');
const profileScreen = document.getElementById('profile-screen');

const usernameInput = document.getElementById('username-input');
const avatarPreview = document.getElementById('avatar-preview');
const profilePicUpload = document.getElementById('profile-pic-upload');
const roomsUl = document.getElementById('rooms-ul');
const currentRoomName = document.getElementById('current-room-name');
const currentRoomLogo = document.getElementById('current-room-logo');
const onlineUsersText = document.getElementById('online-users-text');
const groupPicUpload = document.getElementById('group-pic-upload');
const messages = document.getElementById('messages');
const input = document.getElementById('the-chat-box');
const sendMicBtn = document.getElementById('send-mic-btn');
const attachBtn = document.getElementById('attach-btn');
const imageUpload = document.getElementById('image-upload');
const replyPreviewContainer = document.getElementById('reply-preview-container');
const ghostBtn = document.getElementById('ghost-btn'); 

// 🌟 POLL ELEMENTS
const pollBtn = document.getElementById('poll-btn');
const createPollModal = document.getElementById('create-poll-modal');
const addPollOptBtn = document.getElementById('add-poll-opt-btn');
const sendPollBtn = document.getElementById('send-poll-btn');
const pollQuestion = document.getElementById('poll-question');
const pollOptionsContainer = document.getElementById('poll-options-container');

const settingsUsername = document.getElementById('settings-username');
const settingsAbout = document.getElementById('settings-about');
const settingsAvatarPreview = document.getElementById('settings-avatar-preview');
const settingsBubbleColor = document.getElementById('settings-bubble-color');

const createRoomModal = document.getElementById('create-room-modal');
const passwordModal = document.getElementById('password-modal');
const msgOptionsModal = document.getElementById('message-options-modal');
const viewProfileModal = document.getElementById('view-profile-modal');
const groupInfoModal = document.getElementById('group-info-modal');
const headerClickArea = document.getElementById('header-click-area');
const infoRoomLogo = document.getElementById('info-room-logo');
const infoRoomName = document.getElementById('info-room-name');
const chatSearchContainer = document.getElementById('chat-search-container');
const chatSearchInput = document.getElementById('chat-search-input');
const wallpaperUpload = document.getElementById('wallpaper-upload');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');

let currentUser = { name: '', avatar: '', about: 'Hey there! I am using Chit Chat.', color: '#dcf8c6' }; 
let activeRoomId = null;
let currentRoomPassword = ''; 
let replyingTo = null;
let selectedMsgId = null; 

let editingMsgId = null;
let isGhostMode = false;
let unreadCounts = {}; 
let globalRoomList = [];

let typingTimeout;
let currentlyTyping = new Set();
let baseOnlineText = "Tap to change info";

if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
}

function closeLightbox() { lightbox.classList.add('hidden'); lightboxImg.src = ''; }
lightbox.addEventListener('click', closeLightbox);
lightbox.addEventListener('touchstart', closeLightbox, { passive: true });

profilePicUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => { currentUser.avatar = e.target.result; avatarPreview.src = e.target.result; settingsAvatarPreview.src = e.target.result; };
        reader.readAsDataURL(this.files[0]);
    }
});

document.getElementById('login-btn').addEventListener('click', () => {
    currentUser.name = usernameInput.value.trim();
    if (!currentUser.name) return alert('Enter a name');
    if (!currentUser.avatar) {
        currentUser.avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.name}`;
        settingsAvatarPreview.src = currentUser.avatar;
    }
    settingsUsername.value = currentUser.name;
    loginScreen.classList.add('hidden');
    roomListScreen.classList.remove('hidden');
    
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
});

// 🌟 FIX: ANDROID BACK BUTTON SUPPORT (HISTORY API)
document.getElementById('settings-btn').onclick = () => { 
    history.pushState({screen: 'profile'}, '', '#profile');
    roomListScreen.classList.add('hidden'); 
    profileScreen.classList.remove('hidden'); 
};

document.getElementById('close-profile-btn').onclick = () => { history.back(); };
document.getElementById('back-btn').onclick = (e) => { e.stopPropagation(); history.back(); };

window.addEventListener('popstate', (e) => {
    if (activeRoomId) {
        chatScreen.classList.add('hidden');
        roomListScreen.classList.remove('hidden');
        socket.emit('leave room');
        activeRoomId = null;
        isGhostMode = false;
        ghostBtn.classList.remove('active');
        currentlyTyping.clear();
    } else if (!profileScreen.classList.contains('hidden')) {
        profileScreen.classList.add('hidden');
        roomListScreen.classList.remove('hidden');
    }
});

document.getElementById('save-profile-btn').onclick = () => {
    if(settingsUsername.value.trim()) currentUser.name = settingsUsername.value.trim();
    if(settingsAbout.value.trim()) currentUser.about = settingsAbout.value.trim();
    currentUser.color = settingsBubbleColor.value; 
    socket.emit('update profile', currentUser);
    history.back(); // Use native back to close profile safely!
};

function renderRoomList() {
    roomsUl.innerHTML = '';
    globalRoomList.forEach(room => {
        const li = document.createElement('li');
        li.className = 'room-item';
        const logoUrl = room.logo || `https://api.dicebear.com/7.x/shapes/svg?seed=${room.id}`;
        const unreadCount = unreadCounts[room.id] || 0;
        const badgeHTML = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';

        li.innerHTML = `
            <img src="${escapeHTML(logoUrl)}">
            <div class="room-info">
                <span class="room-name">${escapeHTML(room.name)}</span>
                <span class="room-status">${room.isPrivate ? '🔒 Private' : '🌐 Public'}</span>
            </div>
            ${badgeHTML}
        `;
        li.onclick = () => joinRoomPrompt(room);
        roomsUl.appendChild(li);
    });
}

socket.on('room list', (rooms) => { globalRoomList = rooms; renderRoomList(); });

socket.on('global room alert', (roomId) => {
    if (activeRoomId !== roomId) { unreadCounts[roomId] = (unreadCounts[roomId] || 0) + 1; renderRoomList(); }
});

document.getElementById('show-create-room-btn').onclick = () => createRoomModal.classList.remove('hidden');
document.getElementById('new-room-private').onchange = (e) => document.getElementById('password-input-container').classList.toggle('hidden', !e.target.checked);

document.getElementById('create-room-submit').onclick = () => {
    const name = document.getElementById('new-room-name').value;
    const isPrivate = document.getElementById('new-room-private').checked;
    const password = document.getElementById('new-room-pass').value;
    if(name) { socket.emit('create room', { name, isPrivate, password }); createRoomModal.classList.add('hidden'); }
};

let pendingJoinRoom = null;
function joinRoomPrompt(room) {
    if(room.isPrivate) {
        pendingJoinRoom = room; document.getElementById('join-room-pass').value = ''; passwordModal.classList.remove('hidden');
    } else { currentRoomPassword = ''; joinRoom(room.id, '', false); }
}
document.getElementById('join-room-submit').onclick = () => {
    currentRoomPassword = document.getElementById('join-room-pass').value; joinRoom(pendingJoinRoom.id, currentRoomPassword, false); passwordModal.classList.add('hidden');
};

function joinRoom(roomId, password, isReconnect) { socket.emit('join room', { roomId, password, user: currentUser, isReconnect }); }
socket.on('connect', () => { if (currentUser.name && activeRoomId) joinRoom(activeRoomId, currentRoomPassword, true); });
socket.on('join error', (msg) => alert(msg));
socket.on('chat history', (data) => {
    // 🌟 FIX: ANDROID BACK BUTTON SUPPORT (HISTORY API)
    history.pushState({screen: 'chat', roomId: data.room.id}, '', '#chat');
    
    roomListScreen.classList.add('hidden'); chatScreen.classList.remove('hidden');
    activeRoomId = data.room.id; unreadCounts[activeRoomId] = 0; renderRoomList();
    updateGroupHeader(data.room);
    
    const savedWallpaper = localStorage.getItem('wallpaper_' + activeRoomId);
    if (savedWallpaper) chatScreen.style.backgroundImage = `url(${savedWallpaper})`;
    else chatScreen.style.backgroundImage = `url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')`;

    messages.innerHTML = '';
    data.history.forEach(msg => displayMessage(msg, true));

    socket.emit('mark read');
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeRoomId) {
        socket.emit('mark read');
    }
});

function updateHeaderSubtitle() {
    if (currentlyTyping.size > 0) {
        const typers = Array.from(currentlyTyping).join(', ');
        onlineUsersText.textContent = `${typers} is typing...`;
        onlineUsersText.classList.add('typing-text-active');
    } else {
        onlineUsersText.textContent = baseOnlineText;
        onlineUsersText.classList.remove('typing-text-active');
    }
}

socket.on('room users', (usersList) => {
    if (usersList.length <= 1) { baseOnlineText = "Only you are here";
    } else { const others = usersList.filter(u => u !== currentUser.name); baseOnlineText = "Online: You, " + others.join(', '); }
    updateHeaderSubtitle();
});

socket.on('user typing', (data) => {
    if (data.isTyping) currentlyTyping.add(data.name); else currentlyTyping.delete(data.name);
    updateHeaderSubtitle();
});

// Modals closing logic
[createRoomModal, passwordModal, msgOptionsModal, viewProfileModal, groupInfoModal, createPollModal].forEach(modal => {
    modal.addEventListener('click', (e) => { if(e.target === modal) modal.classList.add('hidden'); });
});

function updateGroupHeader(room) {
    currentRoomName.textContent = room.name; 
    currentRoomLogo.src = room.logo || `https://api.dicebear.com/7.x/shapes/svg?seed=${room.id}`;
}
socket.on('group info updated', updateGroupHeader);

headerClickArea.onclick = () => {
    infoRoomLogo.src = currentRoomLogo.src;
    infoRoomName.value = currentRoomName.textContent;
    groupInfoModal.classList.remove('hidden');
};

document.getElementById('save-group-info-btn').onclick = () => {
    const newName = infoRoomName.value.trim();
    if(newName) {
        socket.emit('update group info', { roomId: activeRoomId, name: newName });
        groupInfoModal.classList.add('hidden');
    }
};

groupPicUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const reader = new FileReader(); 
        reader.onload = (e) => {
            infoRoomLogo.src = e.target.result;
            socket.emit('update group info', { roomId: activeRoomId, logo: e.target.result }); 
        };
        reader.readAsDataURL(this.files[0]);
    }
});

// Custom Wallpaper Logic
document.getElementById('btn-change-wallpaper').onclick = () => wallpaperUpload.click();
wallpaperUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            localStorage.setItem('wallpaper_' + activeRoomId, e.target.result);
            chatScreen.style.backgroundImage = `url(${e.target.result})`;
            groupInfoModal.classList.add('hidden');
        };
        reader.readAsDataURL(this.files[0]);
    }
});

document.getElementById('btn-reset-wallpaper').onclick = () => {
    localStorage.removeItem('wallpaper_' + activeRoomId);
    chatScreen.style.backgroundImage = `url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')`;
    groupInfoModal.classList.add('hidden');
};

// Search Chat Logic
document.getElementById('btn-open-search').onclick = () => {
    groupInfoModal.classList.add('hidden');
    chatSearchContainer.classList.remove('hidden');
    chatSearchInput.focus();
};

document.getElementById('close-search-btn').onclick = () => {
    chatSearchContainer.classList.add('hidden');
    chatSearchInput.value = '';
    document.querySelectorAll('#messages li').forEach(li => {
        li.style.display = 'flex';
        const txtNode = li.querySelector('.message-text');
        if(txtNode) txtNode.innerHTML = txtNode.innerHTML.replace(/<span class="highlight">(.*?)<\/span>/g, '$1');
    });
};

chatSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const allMsgs = document.querySelectorAll('#messages li');
    
    allMsgs.forEach(li => {
        if(li.classList.contains('system-message')) { li.style.display = query ? 'none' : 'flex'; return; }
        const textNode = li.querySelector('.message-text');
        if(!textNode) return; 
        
        let rawText = textNode.textContent.replace('(edited)', '').trim();
        if (query === '') {
            li.style.display = 'flex';
            textNode.innerHTML = escapeHTML(rawText) + (li.innerHTML.includes('(edited)') ? `<span class="edited-tag">(edited)</span>` : '');
        } else if (rawText.toLowerCase().includes(query)) {
            li.style.display = 'flex';
            const regex = new RegExp(`(${query})`, "gi");
            const highlighted = escapeHTML(rawText).replace(regex, `<span class="highlight">$1</span>`);
            textNode.innerHTML = highlighted + (li.innerHTML.includes('(edited)') ? `<span class="edited-tag">(edited)</span>` : '');
        } else {
            li.style.display = 'none';
        }
    });
});

ghostBtn.onclick = () => { isGhostMode = !isGhostMode; ghostBtn.classList.toggle('active', isGhostMode); };

// 🌟 NEW: Poll Creation Logic
pollBtn.onclick = () => createPollModal.classList.remove('hidden');
addPollOptBtn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'premium-input poll-opt-input'; input.placeholder = 'Another Option'; input.style.marginBottom = '0';
    pollOptionsContainer.appendChild(input);
};

sendPollBtn.onclick = () => {
    const q = pollQuestion.value.trim();
    const opts = Array.from(document.querySelectorAll('.poll-opt-input')).map(i => i.value.trim()).filter(v => v);
    if(q && opts.length >= 2) {
        const pollData = { question: q, options: opts.map(o => ({ text: o, votes: [] })) };
        socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, color: currentUser.color, text: '', poll: pollData, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isGhost: isGhostMode });
        createPollModal.classList.add('hidden');
        pollQuestion.value = '';
        pollOptionsContainer.innerHTML = '<input type="text" class="premium-input poll-opt-input" placeholder="Option 1" style="margin-bottom:0;"><input type="text" class="premium-input poll-opt-input" placeholder="Option 2" style="margin-bottom:0;">';
    } else { alert('Enter a question and at least 2 options!'); }
};

input.addEventListener('input', () => { 
    if(editingMsgId) sendMicBtn.innerHTML = '✔'; else sendMicBtn.innerHTML = input.value.trim() ? '➤' : '🎤'; 
    socket.emit('typing', true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing', false), 1500); 
});

function sendMessage() {
    const text = input.value.trim();
    if (text) {
        socket.emit('typing', false); 
        if (editingMsgId) { socket.emit('edit message', { msgId: editingMsgId, newText: text }); editingMsgId = null;
        } else { socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, about: currentUser.about, color: currentUser.color, text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), replyTo: replyingTo, isGhost: isGhostMode }); }
        input.value = ''; sendMicBtn.innerHTML = '🎤'; replyingTo = null; replyPreviewContainer.classList.add('hidden');
    }
}

input.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } });

// Video & Image Engine
attachBtn.onclick = () => imageUpload.click();
imageUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const file = this.files[0];
        const reader = new FileReader(); 
        reader.onload = (e) => {
            const fileData = e.target.result;
            if (file.type.startsWith('video/')) {
                if (file.size > 20 * 1024 * 1024) return alert('Video is too large! Limit is 20MB.');
                socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, about: currentUser.about, color: currentUser.color, text: '', uploadedImage: fileData, isVideo: true, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isGhost: isGhostMode });
                imageUpload.value = '';
            } else if (file.type === 'image/gif') {
                socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, about: currentUser.about, color: currentUser.color, text: '', uploadedImage: fileData, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isGhost: isGhostMode });
                imageUpload.value = '';
            } else {
                const img = new Image(); img.src = fileData;
                img.onload = () => {
                    const canvas = document.createElement('canvas'); let w = img.width, h = img.height;
                    if(w > 600) { h *= 600/w; w = 600; } canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, about: currentUser.about, color: currentUser.color, text: '', uploadedImage: canvas.toDataURL('image/jpeg', 0.8), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isGhost: isGhostMode });
                    imageUpload.value = '';
                };
            }
        }; 
        reader.readAsDataURL(file);
    }
});
let pressTimer;
messages.addEventListener('touchstart', (e) => {
    if (e.target.closest('.poll-card') || e.target.classList.contains('chat-image') || e.target.classList.contains('chat-video') || e.target.classList.contains('chat-audio') || e.target.classList.contains('avatar-small')) return;
    const li = e.target.closest('li.my-message, li.other-message');
    if (!li) return;
    pressTimer = setTimeout(() => {
        selectedMsgId = li.id.replace('msg-', '');
        if (li.classList.contains('my-message') && li.querySelector('.message-text')) document.getElementById('opt-edit').classList.remove('hidden');
        else document.getElementById('opt-edit').classList.add('hidden');
        msgOptionsModal.classList.remove('hidden');
    }, 500); 
}, { passive: true });
messages.addEventListener('touchend', () => clearTimeout(pressTimer));
messages.addEventListener('touchmove', () => clearTimeout(pressTimer));

// 🌟 Swipe to Reply Gesture Engine
let touchStartX = 0;
let touchCurrentX = 0;
let swipedElement = null;

messages.addEventListener('touchstart', (e) => {
    if (e.target.closest('.poll-card') || e.target.classList.contains('chat-image') || e.target.classList.contains('chat-video') || e.target.classList.contains('chat-audio')) return;
    const li = e.target.closest('li.my-message, li.other-message');
    if (!li) return;
    touchStartX = e.touches[0].clientX;
    swipedElement = li;
    swipedElement.style.transition = 'none';
}, { passive: true });

messages.addEventListener('touchmove', (e) => {
    if (!swipedElement) return;
    touchCurrentX = e.touches[0].clientX;
    const diffX = touchCurrentX - touchStartX;
    if (diffX > 10 && diffX < 80) swipedElement.style.transform = `translateX(${diffX}px)`; 
}, { passive: true });

messages.addEventListener('touchend', () => {
    if (!swipedElement) return;
    const diffX = touchCurrentX - touchStartX;
    swipedElement.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
    swipedElement.style.transform = `translateX(0px)`;
    
    if (diffX > 50) { 
        if (navigator.vibrate) navigator.vibrate(50);
        const li = swipedElement;
        selectedMsgId = li.id.replace('msg-', '');
        replyingTo = { user: li.dataset.sender, text: li.querySelector('.message-text')?.innerText || (li.querySelector('.poll-question') ? '📊 Poll' : (li.querySelector('.chat-audio') ? '🎤 Voice Note' : 'Attachment')) };
        document.getElementById('reply-preview-text').innerHTML = `<b style="color: #00a884; font-size: 13px;">${escapeHTML(replyingTo.user)}</b><br><span style="color: #54656f; font-size: 13px;">${escapeHTML(replyingTo.text).substring(0,40)}...</span>`;
        replyPreviewContainer.classList.remove('hidden'); input.focus();
    }
    swipedElement = null; touchStartX = 0; touchCurrentX = 0;
});

document.getElementById('opt-delete').onclick = () => { socket.emit('delete message', selectedMsgId); msgOptionsModal.classList.add('hidden'); };
document.getElementById('opt-like').onclick = () => { socket.emit('like message', selectedMsgId); msgOptionsModal.classList.add('hidden'); };
document.getElementById('opt-pin').onclick = () => { 
    const li = document.getElementById(`msg-${selectedMsgId}`); socket.emit('pin message', { msg: { user: li.dataset.sender, text: li.querySelector('.message-text')?.innerText || 'Attachment' }}); msgOptionsModal.classList.add('hidden'); 
};
document.getElementById('opt-edit').onclick = () => {
    const li = document.getElementById(`msg-${selectedMsgId}`);
    const currentText = li.querySelector('.message-text').innerText.replace('(edited)', '').trim();
    input.value = currentText; editingMsgId = selectedMsgId; sendMicBtn.innerHTML = '✔'; input.focus(); msgOptionsModal.classList.add('hidden');
};
document.getElementById('opt-reply').onclick = () => {
    const li = document.getElementById(`msg-${selectedMsgId}`); replyingTo = { user: li.dataset.sender, text: li.querySelector('.message-text')?.innerText || 'Attachment' };
    document.getElementById('reply-preview-text').innerHTML = `<b style="color: #00a884; font-size: 13px;">${escapeHTML(replyingTo.user)}</b><br><span style="color: #54656f; font-size: 13px;">${escapeHTML(replyingTo.text).substring(0,40)}...</span>`;
    replyPreviewContainer.classList.remove('hidden'); input.focus(); msgOptionsModal.classList.add('hidden');
};
document.getElementById('cancel-reply-btn').onclick = () => { replyingTo = null; replyPreviewContainer.classList.add('hidden'); }
document.getElementById('unpin-btn').onclick = () => socket.emit('unpin message');

socket.on('pinned updated', (pinnedMsg) => {
    const pinnedBanner = document.getElementById('pinned-banner');
    if (pinnedMsg) { document.getElementById('pinned-user').textContent = pinnedMsg.user; document.getElementById('pinned-text').textContent = pinnedMsg.text; pinnedBanner.classList.remove('hidden');
    } else { pinnedBanner.classList.add('hidden'); }
});

socket.on('chat message', (data) => {
    if (data.roomId && data.roomId !== activeRoomId) return;
    displayMessage(data, false);
    
    if (data.user !== currentUser.name && document.hidden) {
        if ("Notification" in window && Notification.permission === "granted") {
            const notif = new Notification(data.user + " in " + currentRoomName.textContent, {
                body: data.text || (data.isAudio ? "🎤 Sent a voice note" : (data.isVideo ? "🎥 Sent a video" : (data.poll ? "📊 Sent a poll" : "📸 Sent an image"))),
                icon: data.avatar, badge: data.avatar, vibrate: [200, 100, 200]
            });
            notif.onclick = () => { window.focus(); notif.close(); };
        }
    }
    if (!document.hidden && activeRoomId && data.user !== currentUser.name) socket.emit('mark read');
});

socket.on('poll updated', (updatedMsg) => {
    if (updatedMsg.roomId && updatedMsg.roomId !== activeRoomId) return;
    const li = document.getElementById(`msg-${updatedMsg.id}`);
    if (li) {
        const isMe = updatedMsg.user === currentUser.name;
        const isStacked = li.classList.contains('stacked');
        li.innerHTML = getMessageInnerHTML(updatedMsg, isMe, isStacked);
    }
});

socket.on('messages read', () => {
    document.querySelectorAll('.ticks.delivered').forEach(el => { el.classList.remove('delivered'); el.classList.add('read'); });
});

socket.on('update likes', (data) => { const l = document.getElementById(`like-count-${data.id}`); if(l) l.textContent = data.likes > 0 ? data.likes : ''; });
socket.on('message deleted', (id) => { const el = document.getElementById(`msg-${id}`); if(el) el.querySelector('.message-text').innerHTML = '<i style="color:#8696a0">🚫 Message deleted</i>'; });

socket.on('message edited', (data) => {
    const el = document.getElementById(`msg-${data.id}`);
    if (el) { const textNode = el.querySelector('.message-text'); textNode.innerHTML = escapeHTML(data.newText) + `<span class="edited-tag">(edited)</span>`; }
});

// 🌟 HTML Generator for Messages (Updated for Polls & Audio!)
function getMessageInnerHTML(data, isMe, isStacked) {
    let contentText = escapeHTML(data.text);
    if(data.isEdited) contentText += `<span class="edited-tag">(edited)</span>`;
    
    let content = '';
    // 1. Check for Polls
    if (data.poll) {
        let totalVotes = data.poll.options.reduce((sum, opt) => sum + opt.votes.length, 0);
        let pollOptsHTML = data.poll.options.map((opt, idx) => {
            let percent = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0;
            let hasVoted = opt.votes.includes(currentUser.name);
            return `<button class="poll-option-btn" data-msgid="${data.id}" data-optidx="${idx}">
                <div class="poll-bar" style="width: ${percent}%;"></div>
                <div class="poll-text-row"><span>${hasVoted ? '✅ ' : ''}${escapeHTML(opt.text)}</span><span>${percent}%</span></div>
            </button>`;
        }).join('');
        content = `<div class="poll-card"><div class="poll-question">📊 ${escapeHTML(data.poll.question)}</div>${pollOptsHTML}</div>`;
    } 
    // 2. Check for Audio/Images/Videos
    else if (data.uploadedImage) {
        if (data.isAudio) content = `<audio src="${data.uploadedImage}" class="chat-audio" controls></audio>`;
        else if (data.isVideo) content = `<video src="${data.uploadedImage}" class="chat-video" controls playsinline></video>`;
        else content = `<img src="${data.uploadedImage}" class="chat-image">`;
    } 
    // 3. Regular Text
    else {
        content = `<span class="message-text">${contentText}</span>`;
    }

    if (data.linkPreview) {
        content += `<a href="${escapeHTML(data.linkPreview.url)}" target="_blank" class="link-preview-card">
            ${data.linkPreview.img ? `<img src="${escapeHTML(data.linkPreview.img)}" class="link-preview-img" style="display:block;">` : ''}
            <div class="link-preview-content">
                <div class="link-preview-title">${escapeHTML(data.linkPreview.title)}</div>
                ${data.linkPreview.desc ? `<div class="link-preview-desc">${escapeHTML(data.linkPreview.desc)}</div>` : ''}
            </div>
        </a>`;
    }
    
    let replyHTML = ''; 
    if (data.replyTo) { replyHTML = `<div class="replied-to"><div class="replied-to-user">${escapeHTML(data.replyTo.user)}</div><div class="replied-to-text">${escapeHTML(data.replyTo.text).substring(0, 60)}</div></div>`; }
    
    let tickClass = data.status === 'read' ? 'read' : 'delivered';
    let ticks = isMe ? `<span class="ticks ${tickClass}">✔✔</span>` : '';
    let ghostIcon = data.isGhost ? '⏱️ ' : '';

    return `
        ${!isMe && !isStacked ? `<img src="${data.avatar}" class="avatar-small" data-name="${data.user}">` : ''}
        ${!isStacked ? `<span class="sender-name" style="color:${isMe ? '#00a884' : '#ea005e'}">${isMe ? 'You' : data.user}</span>` : ''}
        ${replyHTML}
        ${content}
        <div class="meta-row">
            <span class="likes-badge" id="like-count-${data.id}">${data.likes > 0 ? '❤️ ' + data.likes : ''}</span>
            <span>${ghostIcon}${data.time}</span>
            ${ticks}
        </div>
    `;
}

function displayMessage(data, isHistory) {
    const li = document.createElement('li'); li.id = `msg-${data.id}`; li.dataset.sender = data.user;
    if (data.type === 'system') { li.className = 'system-message'; li.textContent = data.text; messages.appendChild(li); messages.scrollTop = messages.scrollHeight; return; }

    const isMe = data.user === currentUser.name;
    const lastMsg = messages.lastElementChild;
    const isStacked = (lastMsg && !lastMsg.classList.contains('system-message') && lastMsg.dataset.sender === data.user);

    li.className = isMe ? 'my-message' : 'other-message';
    if(isStacked) li.classList.add('stacked');
    if(data.isGhost) li.classList.add('ghost-message');
    if (data.color) li.style.setProperty('--bubble-color', data.color);

    li.innerHTML = getMessageInnerHTML(data, isMe, isStacked);
    messages.appendChild(li); messages.scrollTop = messages.scrollHeight;

    if (data.isGhost && !isHistory) {
        setTimeout(() => { if (li) li.remove(); if (isMe) socket.emit('delete message', data.id); }, 10000);
    }
}

// 🌟 Poll Voting & Image Lightbox Logic
document.getElementById('messages').addEventListener('click', (e) => { 
    const pollOpt = e.target.closest('.poll-option-btn');
    if (pollOpt) {
        socket.emit('vote poll', { msgId: pollOpt.dataset.msgid, optionIndex: parseInt(pollOpt.dataset.optidx) });
        return;
    }

    if(e.target.classList.contains('chat-image')) { document.getElementById('lightbox-img').src = e.target.src; document.getElementById('lightbox').classList.remove('hidden'); } 
    if(e.target.classList.contains('avatar-small')) {
        const friendName = e.target.dataset.name;
        if (friendName === '🤖 Bot') return;
        socket.emit('get user info', friendName);
    }
});

document.getElementById('theme-toggle').onclick = () => document.body.classList.toggle('dark-mode');

// 🎤 THE BRAND NEW VOICE NOTE ENGINE
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

async function startRecording(e) {
    // If there is text in the box, act as a Send button instead!
    if (input.value.trim()) { sendMessage(); return; } 
    
    // 🌟 Safely stop the phone from opening the "Copy" menu!
    if (e.cancelable) e.preventDefault(); 
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            const reader = new FileReader();
            reader.onload = (event) => {
                socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, color: currentUser.color, text: '', uploadedImage: event.target.result, isAudio: true, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isGhost: isGhostMode });
            };
            reader.readAsDataURL(audioBlob);
            audioChunks = [];
            stream.getTracks().forEach(track => track.stop()); // Turn off the mic
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        // 🌟 AMAZING VISUAL FEEDBACK
        sendMicBtn.classList.add('recording-pulse');
        input.placeholder = "🔴 Recording... (Release to send)";
        input.disabled = true; // Locks the keyboard from popping up
        
    } catch(err) {
        alert("Please allow Microphone access to send Voice Notes! 🎤");
    }
}

function stopRecording() {
    if (isRecording && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        isRecording = false;
        
        // 🌟 REVERT VISUAL FEEDBACK
        sendMicBtn.classList.remove('recording-pulse');
        input.placeholder = "Message";
        input.disabled = false;
    }
}

// Mouse events (Desktop)
sendMicBtn.addEventListener('mousedown', startRecording);
window.addEventListener('mouseup', stopRecording);

// Touch events (Mobile - Completely bulletproofed!)
sendMicBtn.addEventListener('touchstart', startRecording, { passive: false });
sendMicBtn.addEventListener('touchend', stopRecording);
sendMicBtn.addEventListener('touchcancel', stopRecording); // If your thumb slides off

// Hardcore block for the mobile long-press menu
sendMicBtn.addEventListener('contextmenu', e => e.preventDefault());
