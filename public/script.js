const socket = io();

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
const onlineUsersText = document.getElementById('online-users-text'); // 🌟 NEW
const groupPicUpload = document.getElementById('group-pic-upload');
const messages = document.getElementById('messages');
const input = document.getElementById('the-chat-box');
const sendMicBtn = document.getElementById('send-mic-btn');
const attachBtn = document.getElementById('attach-btn');
const imageUpload = document.getElementById('image-upload');
const replyPreviewContainer = document.getElementById('reply-preview-container');
const ghostBtn = document.getElementById('ghost-btn'); // 🌟 NEW

const settingsUsername = document.getElementById('settings-username');
const settingsAbout = document.getElementById('settings-about');
const settingsAvatarPreview = document.getElementById('settings-avatar-preview');

const createRoomModal = document.getElementById('create-room-modal');
const passwordModal = document.getElementById('password-modal');
const msgOptionsModal = document.getElementById('message-options-modal');
const viewProfileModal = document.getElementById('view-profile-modal');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');

let currentUser = { name: '', avatar: '', about: 'Hey there! I am using Chit Chat.' };
let activeRoomId = null;
let currentRoomPassword = ''; 
let replyingTo = null;
let selectedMsgId = null; 

// 🌟 NEW STATES: Edit Mode, Ghost Mode, and Unread Counts
let editingMsgId = null;
let isGhostMode = false;
let unreadCounts = {}; 
let globalRoomList = [];

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
});

document.getElementById('settings-btn').onclick = () => { roomListScreen.classList.add('hidden'); profileScreen.classList.remove('hidden'); };
document.getElementById('close-profile-btn').onclick = () => { profileScreen.classList.add('hidden'); roomListScreen.classList.remove('hidden'); };
document.getElementById('save-profile-btn').onclick = () => {
    if(settingsUsername.value.trim()) currentUser.name = settingsUsername.value.trim();
    if(settingsAbout.value.trim()) currentUser.about = settingsAbout.value.trim();
    profileScreen.classList.add('hidden'); roomListScreen.classList.remove('hidden');
};

// 🌟 NEW: Render Room List with Unread Badges
function renderRoomList() {
    roomsUl.innerHTML = '';
    globalRoomList.forEach(room => {
        const li = document.createElement('li');
        li.className = 'room-item';
        const logoUrl = room.logo || `https://api.dicebear.com/7.x/shapes/svg?seed=${room.id}`;
        
        // Show badge if count > 0
        const unreadCount = unreadCounts[room.id] || 0;
        const badgeHTML = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';

        li.innerHTML = `
            <img src="${logoUrl}">
            <div class="room-info">
                <span class="room-name">${room.name}</span>
                <span class="room-status">${room.isPrivate ? '🔒 Private' : '🌐 Public'}</span>
            </div>
            ${badgeHTML}
        `;
        li.onclick = () => joinRoomPrompt(room);
        roomsUl.appendChild(li);
    });
}

socket.on('room list', (rooms) => { globalRoomList = rooms; renderRoomList(); });

// 🌟 NEW: Listen for Global Alerts and increase unread count!
socket.on('global room alert', (roomId) => {
    if (activeRoomId !== roomId) {
        unreadCounts[roomId] = (unreadCounts[roomId] || 0) + 1;
        renderRoomList(); // Update UI
    }
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

function joinRoom(roomId, password, isReconnect) {
    socket.emit('join room', { roomId, password, user: currentUser, isReconnect });
}

socket.on('connect', () => { if (currentUser.name && activeRoomId) joinRoom(activeRoomId, currentRoomPassword, true); });
socket.on('join error', (msg) => alert(msg));

socket.on('chat history', (data) => {
    roomListScreen.classList.add('hidden'); chatScreen.classList.remove('hidden');
    activeRoomId = data.room.id;
    
    // Clear unread badge for this room!
    unreadCounts[activeRoomId] = 0; 
    renderRoomList();

    updateGroupHeader(data.room);
    messages.innerHTML = '';
    data.history.forEach(msg => displayMessage(msg, true));
});

// 🌟 NEW: Live Online Status Updater
socket.on('room users', (usersList) => {
    if (usersList.length <= 1) {
        onlineUsersText.textContent = "Only you are here";
    } else {
        // Remove yourself from list, add "You" to start
        const others = usersList.filter(u => u !== currentUser.name);
        onlineUsersText.textContent = "Online: You, " + others.join(', ');
    }
});

createRoomModal.addEventListener('click', (e) => { if(e.target === createRoomModal) createRoomModal.classList.add('hidden'); });
passwordModal.addEventListener('click', (e) => { if(e.target === passwordModal) passwordModal.classList.add('hidden'); });
msgOptionsModal.addEventListener('click', (e) => { if(e.target === msgOptionsModal) msgOptionsModal.classList.add('hidden'); });
viewProfileModal.addEventListener('click', (e) => { if(e.target === viewProfileModal) viewProfileModal.classList.add('hidden'); });

document.getElementById('back-btn').onclick = (e) => { 
    e.stopPropagation(); chatScreen.classList.add('hidden'); roomListScreen.classList.remove('hidden'); 
    activeRoomId = null; isGhostMode = false; ghostBtn.classList.remove('active'); 
};

function updateGroupHeader(room) {
    currentRoomName.textContent = room.name;
    currentRoomLogo.src = room.logo || `https://api.dicebear.com/7.x/shapes/svg?seed=${room.id}`;
}
socket.on('group info updated', updateGroupHeader);

groupPicUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const reader = new FileReader(); reader.onload = (e) => socket.emit('update group info', { roomId: activeRoomId, logo: e.target.result }); reader.readAsDataURL(this.files[0]);
    }
});

// 🌟 NEW: Ghost Toggle Logic
ghostBtn.onclick = () => {
    isGhostMode = !isGhostMode;
    ghostBtn.classList.toggle('active', isGhostMode);
};

input.addEventListener('input', () => {
    if(editingMsgId) sendMicBtn.innerHTML = '✔';
    else sendMicBtn.innerHTML = input.value.trim() ? '➤' : '🎤';
});

function sendMessage() {
    const text = input.value.trim();
    if (text) {
        // 🌟 NEW: Edit Message routing
        if (editingMsgId) {
            socket.emit('edit message', { msgId: editingMsgId, newText: text });
            editingMsgId = null;
        } else {
            socket.emit('chat message', { 
                user: currentUser.name, avatar: currentUser.avatar, about: currentUser.about, 
                text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
                replyTo: replyingTo, isGhost: isGhostMode 
            });
        }
        input.value = ''; sendMicBtn.innerHTML = '🎤';
        replyingTo = null; replyPreviewContainer.classList.add('hidden');
    }
}
sendMicBtn.addEventListener('click', sendMessage);
input.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } });

attachBtn.onclick = () => imageUpload.click();
imageUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const reader = new FileReader(); reader.onload = (e) => {
            const img = new Image(); img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas'); let w = img.width, h = img.height;
                if(w > 600) { h *= 600/w; w = 600; } canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, about: currentUser.about, text: '', uploadedImage: canvas.toDataURL('image/jpeg', 0.8), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isGhost: isGhostMode });
                imageUpload.value = '';
            };
        }; reader.readAsDataURL(this.files[0]);
    }
});

let pressTimer;
messages.addEventListener('touchstart', (e) => {
    if (e.target.classList.contains('chat-image') || e.target.classList.contains('avatar-small')) return;
    const li = e.target.closest('li.my-message, li.other-message');
    if (!li) return;
    pressTimer = setTimeout(() => {
        selectedMsgId = li.id.replace('msg-', '');
        // 🌟 NEW: Only show Edit button if it's YOUR message and not an image!
        if (li.classList.contains('my-message') && li.querySelector('.message-text')) {
            document.getElementById('opt-edit').classList.remove('hidden');
        } else {
            document.getElementById('opt-edit').classList.add('hidden');
        }
        msgOptionsModal.classList.remove('hidden');
    }, 500); 
}, { passive: true });
messages.addEventListener('touchend', () => clearTimeout(pressTimer));
messages.addEventListener('touchmove', () => clearTimeout(pressTimer));

document.getElementById('opt-delete').onclick = () => { socket.emit('delete message', selectedMsgId); msgOptionsModal.classList.add('hidden'); };
document.getElementById('opt-like').onclick = () => { socket.emit('like message', selectedMsgId); msgOptionsModal.classList.add('hidden'); };
document.getElementById('opt-pin').onclick = () => { 
    const li = document.getElementById(`msg-${selectedMsgId}`); socket.emit('pin message', { msg: { user: li.dataset.sender, text: li.querySelector('.message-text')?.innerText || 'Attachment' }}); msgOptionsModal.classList.add('hidden'); 
};
// 🌟 NEW: Edit Message Click Handler
document.getElementById('opt-edit').onclick = () => {
    const li = document.getElementById(`msg-${selectedMsgId}`);
    const currentText = li.querySelector('.message-text').innerText.replace('(edited)', '').trim();
    input.value = currentText;
    editingMsgId = selectedMsgId;
    sendMicBtn.innerHTML = '✔'; // Change button to a checkmark
    input.focus();
    msgOptionsModal.classList.add('hidden');
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

socket.on('chat message', (data) => displayMessage(data, false));
socket.on('update likes', (data) => { const l = document.getElementById(`like-count-${data.id}`); if(l) l.textContent = data.likes > 0 ? data.likes : ''; });
socket.on('message deleted', (id) => { const el = document.getElementById(`msg-${id}`); if(el) el.querySelector('.message-text').innerHTML = '<i style="color:#8696a0">🚫 Message deleted</i>'; });

// 🌟 NEW: Listen for Edited Messages and update DOM directly
socket.on('message edited', (data) => {
    const el = document.getElementById(`msg-${data.id}`);
    if (el) {
        const textNode = el.querySelector('.message-text');
        textNode.innerHTML = escapeHTML(data.newText) + `<span class="edited-tag">(edited)</span>`;
    }
});

function escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

function displayMessage(data, isHistory) {
    const li = document.createElement('li'); li.id = `msg-${data.id}`; li.dataset.sender = data.user;
    if (data.type === 'system') { li.className = 'system-message'; li.textContent = data.text; messages.appendChild(li); messages.scrollTop = messages.scrollHeight; return; }

    const isMe = data.user === currentUser.name;
    const lastMsg = messages.lastElementChild;
    const isStacked = (lastMsg && !lastMsg.classList.contains('system-message') && lastMsg.dataset.sender === data.user);

    li.className = isMe ? 'my-message' : 'other-message';
    if(isStacked) li.classList.add('stacked');
    
    // 🌟 NEW: Add Ghost Class if it's disappearing!
    if(data.isGhost) li.classList.add('ghost-message');

    let contentText = escapeHTML(data.text);
    if(data.isEdited) contentText += `<span class="edited-tag">(edited)</span>`;
    let content = data.uploadedImage ? `<img src="${data.uploadedImage}" class="chat-image">` : `<span class="message-text">${contentText}</span>`;
    
    let replyHTML = ''; 
    if (data.replyTo) { 
        replyHTML = `<div class="replied-to"><div class="replied-to-user">${escapeHTML(data.replyTo.user)}</div><div class="replied-to-text">${escapeHTML(data.replyTo.text).substring(0, 60)}</div></div>`; 
    }
    let ticks = isMe ? `<span class="ticks delivered">✔✔</span>` : '';
    // 🌟 NEW: Show stopwatch if it's a ghost message
    let ghostIcon = data.isGhost ? '⏱️ ' : '';

    li.innerHTML = `
        ${!isMe && !isStacked ? `<img src="${data.avatar}" class="avatar-small" data-name="${data.user}" data-about="${data.about || 'Hey there! I am using Chit Chat.'}">` : ''}
        ${!isStacked ? `<span class="sender-name" style="color:${isMe ? '#00a884' : '#ea005e'}">${isMe ? 'You' : data.user}</span>` : ''}
        ${replyHTML}
        ${content}
        <div class="meta-row">
            <span class="likes-badge" id="like-count-${data.id}">${data.likes > 0 ? '❤️ ' + data.likes : ''}</span>
            <span>${ghostIcon}${data.time}</span>
            ${ticks}
        </div>
    `;
    messages.appendChild(li); messages.scrollTop = messages.scrollHeight;

    // 🌟 NEW: Ghost Mode Destruction Timer (10 Seconds)
    if (data.isGhost && !isHistory) {
        setTimeout(() => {
            if (li) li.remove(); // Evaporate from screen
            if (isMe) socket.emit('delete message', data.id); // Ensure everyone else deletes it too
        }, 10000);
    }
}

document.getElementById('messages').addEventListener('click', (e) => { 
    if(e.target.classList.contains('chat-image')) { document.getElementById('lightbox-img').src = e.target.src; document.getElementById('lightbox').classList.remove('hidden'); } 
    if(e.target.classList.contains('avatar-small')) {
        document.getElementById('view-profile-avatar').src = e.target.src; document.getElementById('view-profile-name').textContent = e.target.dataset.name; document.getElementById('view-profile-about').textContent = e.target.dataset.about; viewProfileModal.classList.remove('hidden');
    }
});

document.getElementById('theme-toggle').onclick = () => document.body.classList.toggle('dark-mode');
