const socket = io();

// Screens
const loginScreen = document.getElementById('login-screen');
const roomListScreen = document.getElementById('room-list-screen');
const chatScreen = document.getElementById('chat-screen');

// Elements
const usernameInput = document.getElementById('username-input');
const avatarPreview = document.getElementById('avatar-preview');
const profilePicUpload = document.getElementById('profile-pic-upload');
const roomsUl = document.getElementById('rooms-ul');
const currentRoomName = document.getElementById('current-room-name');
const currentRoomLogo = document.getElementById('current-room-logo');
const groupPicUpload = document.getElementById('group-pic-upload');
const messages = document.getElementById('messages');
const input = document.getElementById('the-chat-box');
const sendMicBtn = document.getElementById('send-mic-btn');
const attachBtn = document.getElementById('attach-btn');
const imageUpload = document.getElementById('image-upload');
const replyPreviewContainer = document.getElementById('reply-preview-container');

// Modals
const createRoomModal = document.getElementById('create-room-modal');
const passwordModal = document.getElementById('password-modal');
const msgOptionsModal = document.getElementById('message-options-modal');

let currentUser = { name: '', avatar: '' };
let activeRoomId = null;
let replyingTo = null;
let selectedMsgId = null; // For long press

// --- PROFILE PIC UPLOAD ---
profilePicUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => { currentUser.avatar = e.target.result; avatarPreview.src = e.target.result; };
        reader.readAsDataURL(this.files[0]);
    }
});

// --- LOGIN ---
document.getElementById('login-btn').addEventListener('click', () => {
    currentUser.name = usernameInput.value.trim();
    if (!currentUser.name) return alert('Enter a name');
    if (!currentUser.avatar) currentUser.avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.name}`;
    
    loginScreen.classList.add('hidden');
    roomListScreen.classList.remove('hidden');
});

// --- ROOMS LIST ---
socket.on('room list', (rooms) => {
    roomsUl.innerHTML = '';
    rooms.forEach(room => {
        const li = document.createElement('li');
        li.className = 'room-item';
        const logoUrl = room.logo || `https://api.dicebear.com/7.x/shapes/svg?seed=${room.id}`;
        li.innerHTML = `
            <img src="${logoUrl}">
            <div class="room-info">
                <span class="room-name">${room.name}</span>
                <span class="room-status">${room.isPrivate ? '🔒 Private' : '🌐 Public'}</span>
            </div>
        `;
        li.onclick = () => joinRoomPrompt(room);
        roomsUl.appendChild(li);
    });
});

document.getElementById('show-create-room-btn').onclick = () => createRoomModal.classList.remove('hidden');
document.getElementById('new-room-private').onchange = (e) => document.getElementById('new-room-pass').classList.toggle('hidden', !e.target.checked);

document.getElementById('create-room-submit').onclick = () => {
    const name = document.getElementById('new-room-name').value;
    const isPrivate = document.getElementById('new-room-private').checked;
    const password = document.getElementById('new-room-pass').value;
    if(name) { socket.emit('create room', { name, isPrivate, password }); createRoomModal.classList.add('hidden'); }
};

let pendingJoinRoom = null;
function joinRoomPrompt(room) {
    if(room.isPrivate) {
        pendingJoinRoom = room;
        passwordModal.classList.remove('hidden');
    } else {
        joinRoom(room.id, '');
    }
}
document.getElementById('join-room-submit').onclick = () => {
    joinRoom(pendingJoinRoom.id, document.getElementById('join-room-pass').value);
    passwordModal.classList.add('hidden');
};

function joinRoom(roomId, password) {
    socket.emit('join room', { roomId, password, user: currentUser });
}

socket.on('join error', (msg) => alert(msg));
socket.on('chat history', (data) => {
    roomListScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    activeRoomId = data.room.id;
    updateGroupHeader(data.room);
    messages.innerHTML = '';
    data.history.forEach(msg => displayMessage(msg, true));
});

// --- GROUP HEADER ---
document.getElementById('back-btn').onclick = (e) => { e.stopPropagation(); chatScreen.classList.add('hidden'); roomListScreen.classList.remove('hidden'); activeRoomId = null; };
function updateGroupHeader(room) {
    currentRoomName.textContent = room.name;
    currentRoomLogo.src = room.logo || `https://api.dicebear.com/7.x/shapes/svg?seed=${room.id}`;
}
socket.on('group info updated', updateGroupHeader);

groupPicUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => socket.emit('update group info', { roomId: activeRoomId, logo: e.target.result });
        reader.readAsDataURL(this.files[0]);
    }
});

// --- CHAT LOGIC ---
input.addEventListener('input', () => {
    sendMicBtn.innerHTML = input.value.trim() ? '➤' : '🎤';
});

function sendMessage() {
    const text = input.value.trim();
    if (text) {
        socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), replyTo: replyingTo });
        input.value = ''; sendMicBtn.innerHTML = '🎤';
        replyingTo = null; replyPreviewContainer.classList.add('hidden');
    }
}
sendMicBtn.addEventListener('click', sendMessage);
input.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } });

// Images
attachBtn.onclick = () => imageUpload.click();
imageUpload.addEventListener('change', function() {
    if (this.files[0]) {
        const reader = new FileReader(); reader.onload = (e) => {
            const img = new Image(); img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas'); let w = img.width, h = img.height;
                if(w > 600) { h *= 600/w; w = 600; } canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                socket.emit('chat message', { user: currentUser.name, avatar: currentUser.avatar, text: '', uploadedImage: canvas.toDataURL('image/jpeg', 0.8), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
                imageUpload.value = '';
            };
        }; reader.readAsDataURL(this.files[0]);
    }
});

// --- LONG PRESS & GESTURES ---
let pressTimer;
messages.addEventListener('touchstart', (e) => {
    const li = e.target.closest('li.my-message, li.other-message');
    if (!li) return;
    pressTimer = setTimeout(() => {
        selectedMsgId = li.id.replace('msg-', '');
        msgOptionsModal.classList.remove('hidden');
    }, 500); // 500ms for long press
}, { passive: true });
messages.addEventListener('touchend', () => clearTimeout(pressTimer));
messages.addEventListener('touchmove', () => clearTimeout(pressTimer));

document.getElementById('opt-cancel').onclick = () => msgOptionsModal.classList.add('hidden');
document.getElementById('opt-delete').onclick = () => { socket.emit('delete message', selectedMsgId); msgOptionsModal.classList.add('hidden'); };
document.getElementById('opt-like').onclick = () => { socket.emit('like message', selectedMsgId); msgOptionsModal.classList.add('hidden'); };
document.getElementById('opt-pin').onclick = () => { 
    const li = document.getElementById(`msg-${selectedMsgId}`);
    socket.emit('pin message', { msg: { user: li.dataset.sender, text: li.querySelector('.message-text')?.innerText || 'Attachment' }});
    msgOptionsModal.classList.add('hidden'); 
};
document.getElementById('opt-reply').onclick = () => {
    const li = document.getElementById(`msg-${selectedMsgId}`);
    replyingTo = { user: li.dataset.sender, text: li.querySelector('.message-text')?.innerText || 'Attachment' };
    document.getElementById('reply-preview-text').innerHTML = `<b>${replyingTo.user}</b><br>${replyingTo.text.substring(0,30)}`;
    replyPreviewContainer.classList.remove('hidden'); input.focus();
    msgOptionsModal.classList.add('hidden');
};
document.getElementById('cancel-reply-btn').onclick = () => { replyingTo = null; replyPreviewContainer.classList.add('hidden'); }

socket.on('chat message', (data) => displayMessage(data, false));
socket.on('update likes', (data) => { const l = document.getElementById(`like-count-${data.id}`); if(l) l.textContent = data.likes > 0 ? data.likes : ''; });
socket.on('message deleted', (id) => { const el = document.getElementById(`msg-${id}`); if(el) el.querySelector('.message-text').innerHTML = '<i style="color:#8696a0">🚫 Message deleted</i>'; });

function displayMessage(data, isHistory) {
    const li = document.createElement('li'); li.id = `msg-${data.id}`; li.dataset.sender = data.user;
    if (data.type === 'system') { li.className = 'system-message'; li.textContent = data.text; messages.appendChild(li); messages.scrollTop = messages.scrollHeight; return; }

    const isMe = data.user === currentUser.name;
    const lastMsg = messages.lastElementChild;
    const isStacked = (lastMsg && !lastMsg.classList.contains('system-message') && lastMsg.dataset.sender === data.user);

    li.className = isMe ? 'my-message' : 'other-message';
    if(isStacked) li.classList.add('stacked');

    let content = data.uploadedImage ? `<img src="${data.uploadedImage}" class="chat-image">` : `<span class="message-text">${data.text}</span>`;
    let reply = data.replyTo ? `<div class="replied-to"><div class="replied-to-user">${data.replyTo.user}</div>${data.replyTo.text.substring(0,30)}</div>` : '';
    let ticks = isMe ? `<span class="ticks delivered">✔✔</span>` : '';

    li.innerHTML = `
        ${!isMe && !isStacked ? `<img src="${data.avatar}" class="avatar-small">` : ''}
        ${!isStacked ? `<span class="sender-name" style="color:${isMe ? '#00a884' : '#ea005e'}">${isMe ? 'You' : data.user}</span>` : ''}
        ${reply}
        ${content}
        <div class="meta-row">
            <span class="likes-badge" id="like-count-${data.id}">${data.likes > 0 ? '❤️ ' + data.likes : ''}</span>
            <span>${data.time}</span>
            ${ticks}
        </div>
    `;
    messages.appendChild(li); messages.scrollTop = messages.scrollHeight;
}

// Lightbox & Theme
document.getElementById('messages').addEventListener('click', (e) => { if(e.target.classList.contains('chat-image')) { document.getElementById('lightbox-img').src = e.target.src; document.getElementById('lightbox').classList.remove('hidden'); } });
document.getElementById('theme-toggle').onclick = () => document.body.classList.toggle('dark-mode');
