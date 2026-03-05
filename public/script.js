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

const settingsUsername = document.getElementById('settings-username');
const settingsAbout = document.getElementById('settings-about');
const settingsAvatarPreview = document.getElementById('settings-avatar-preview');

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

let currentUser = { name: '', avatar: '', about: 'Hey there! I am using Chit Chat.' };
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

document.getElementById('settings-btn').onclick = () => { roomListScreen.classList.add('hidden'); profileScreen.classList.remove('hidden'); };
document.getElementById('close-profile-btn').onclick = () => { profileScreen.classList.add('hidden'); roomListScreen.classList.remove('hidden'); };

document.getElementById('save-profile-btn').onclick = () => {
    if(settingsUsername.value.trim()) currentUser.name = settingsUsername.value.trim();
    if(settingsAbout.value.trim()) currentUser.about = settingsAbout.value.trim();
    socket.emit('update profile', currentUser);
    profileScreen.classList.add('hidden'); roomListScreen.classList.remove('hidden');
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
