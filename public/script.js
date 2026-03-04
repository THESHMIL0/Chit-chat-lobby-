const socket = io();

const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');

const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
// 🌟 THE FIX: Re-linked to our new text box ID to escape Chrome Autofill
const input = document.getElementById('chat-msg-box');
const messages = document.getElementById('messages');
const userListSpan = document.getElementById('user-list');
const typingIndicator = document.getElementById('typing-indicator');
const typingUserSpan = document.getElementById('typing-user');
const clearBtn = document.getElementById('clear-btn');
const themeToggle = document.getElementById('theme-toggle');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const micBtn = document.getElementById('mic-btn'); 
const attachBtn = document.getElementById('attach-btn'); 
const imageUpload = document.getElementById('image-upload'); 
const replyPreviewContainer = document.getElementById('reply-preview-container');
const replyPreviewText = document.getElementById('reply-preview-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');
const searchInput = document.getElementById('search-input'); 
const pinnedBanner = document.getElementById('pinned-banner'); 
const pinnedUser = document.getElementById('pinned-user'); 
const pinnedText = document.getElementById('pinned-text'); 
const unpinBtn = document.getElementById('unpin-btn'); 

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');

const notifySound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');

let username = ""; let userColor = ""; let avatarUrl = ""; let replyingTo = null; 

lightbox.addEventListener('click', () => lightbox.classList.add('hidden'));

searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    Array.from(messages.children).forEach(msg => {
        if (msg.classList.contains('system-message')) return;
        const text = msg.querySelector('.message-text')?.innerText.toLowerCase() || "";
        const sender = msg.getAttribute('data-sender')?.toLowerCase() || "";
        if (text.includes(searchTerm) || sender.includes(searchTerm)) msg.style.display = 'flex';
        else msg.style.display = 'none';
    });
});

unpinBtn.addEventListener('click', () => socket.emit('unpin message'));

socket.on('pinned updated', (pinnedMsg) => {
    if (pinnedMsg) {
        pinnedUser.textContent = pinnedMsg.user;
        pinnedText.textContent = pinnedMsg.text;
        pinnedBanner.classList.remove('hidden');
    } else {
        pinnedBanner.classList.add('hidden');
    }
});

attachBtn.addEventListener('click', () => imageUpload.click());
imageUpload.addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image(); img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width; let height = img.height; const MAX_WIDTH = 600; 
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
                socket.emit('chat message', {
                    user: username, text: '', uploadedImage: canvas.toDataURL('image/jpeg', 0.8), color: userColor, avatar: avatarUrl,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), replyTo: replyingTo
                });
                replyingTo = null; replyPreviewContainer.classList.add('hidden'); emojiPicker.classList.add('hidden');
                imageUpload.value = ''; 
            };
        };
    }
});

let mediaRecorder; let audioChunks = [];
navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
    mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); audioChunks = [];
        const reader = new FileReader(); reader.readAsDataURL(audioBlob); 
        reader.onloadend = () => {
            socket.emit('chat message', {
                user: username, text: '', audio: reader.result, color: userColor, avatar: avatarUrl,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), replyTo: replyingTo
            });
            replyingTo = null; replyPreviewContainer.classList.add('hidden');
        };
    };
}).catch(() => console.log("Mic access denied"));

function startRecording(e) { e.preventDefault(); if (mediaRecorder && mediaRecorder.state === 'inactive') { mediaRecorder.start(); micBtn.classList.add('mic-recording'); } }
function stopRecording(e) { e.preventDefault(); if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); micBtn.classList.remove('mic-recording'); } }

micBtn.addEventListener('mousedown', startRecording); micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('mouseleave', stopRecording); micBtn.addEventListener('touchstart', startRecording);
micBtn.addEventListener('touchend', stopRecording);

window.addEventListener('focus', () => { if (username) socket.emit('mark read'); });

socket.on('messages read', () => {
    document.querySelectorAll('.ticks.delivered').forEach(el => { el.classList.remove('delivered'); el.classList.add('read'); });
});

themeToggle.addEventListener('click', () => { document.body.classList.toggle('dark-mode'); themeToggle.textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙'; });
emojiBtn.addEventListener('click', () => { emojiPicker.classList.toggle('hidden'); });
emojiPicker.addEventListener('emoji-click', event => { input.value += event.detail.unicode; emojiPicker.classList.add('hidden'); input.focus(); });

// Touch Gestures: Swipe and Double Tap
let touchStartX = 0; let touchStartY = 0; let touchElem = null; let lastTapTime = 0;

messages.addEventListener('touchstart', (e) => {
    const li = e.target.closest('li.my-message, li.other-message');
    if (!li) return;
    touchStartX = e.changedTouches[0].screenX; touchStartY = e.changedTouches[0].screenY;
    touchElem = li; li.style.transition = 'none'; 
}, { passive: true });

messages.addEventListener('touchmove', (e) => {
    if (!touchElem) return;
    const touchX = e.changedTouches[0].screenX; const touchY = e.changedTouches[0].screenY;
    const deltaX = touchX - touchStartX; const deltaY = Math.abs(touchY - touchStartY);

    if (deltaX > 0 && deltaX > deltaY) {
        if (e.cancelable) e.preventDefault(); 
        touchElem.style.transform = `translateX(${Math.min(deltaX, 80)}px)`;
    }
}, { passive: false });

messages.addEventListener('touchend', (e) => {
    if (!touchElem) return;
    const touchX = e.changedTouches[0].screenX;
    const deltaX = touchX - touchStartX;

    touchElem.style.transition = 'transform 0.3s ease-out';
    touchElem.style.transform = 'translateX(0)';

    // Swipe Right to Reply
    if (deltaX > 50) {
        const sender = touchElem.getAttribute('data-sender');
        const textElement = touchElem.querySelector('.message-text');
        const text = textElement ? textElement.innerText : (touchElem.querySelector('.chat-audio') ? "🎙️ Voice Message" : "🖼️ Image"); 
        replyingTo = { user: sender, text: text };
        replyPreviewText.innerHTML = `<strong>Replying to ${escapeHTML(sender)}</strong><br>${escapeHTML(text).substring(0, 40)}...`;
        replyPreviewContainer.classList.remove('hidden'); input.focus(); 
    }

    // Double Tap to Like
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;
    if (tapLength < 300 && tapLength > 0) {
        const msgId = touchElem.id.replace('msg-', '');
        socket.emit('like message', msgId);
    }
    lastTapTime = currentTime; touchElem = null;
});

messages.addEventListener('click', (e) => {
    if (e.target.classList.contains('chat-image')) {
        lightboxImg.src = e.target.src; lightbox.classList.remove('hidden'); return;
    }
    if (e.target.closest('.msg-delete-btn')) {
        if (confirm("Delete this message for everyone?")) socket.emit('delete message', e.target.closest('.msg-delete-btn').dataset.id);
        return; 
    }
    if (e.target.closest('.msg-pin-btn')) {
        const li = e.target.closest('li');
        const sender = li.getAttribute('data-sender');
        const text = li.querySelector('.message-text') ? li.querySelector('.message-text').innerText : "Attachment";
        socket.emit('pin message', { id: e.target.closest('.msg-pin-btn').dataset.id, user: sender, text: text });
        return;
    }
    if (e.target.closest('.like-btn')) { socket.emit('like message', e.target.closest('.like-btn').dataset.id); return; }
});

cancelReplyBtn.addEventListener('click', () => { replyingTo = null; replyPreviewContainer.classList.add('hidden'); });

loginForm.addEventListener('submit', (e) => {
    e.preventDefault(); 
    username = usernameInput.value.trim();
    if (username) {
        userColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
        loginScreen.classList.add('hidden'); chatContainer.classList.remove('hidden');
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
        socket.emit('new user', username);
        setTimeout(() => socket.emit('mark read'), 500); 
        
        if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }
});

clearBtn.addEventListener('click', () => { if (confirm("Clear local screen?")) messages.innerHTML = ''; });
function escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

let typingTimeout;
input.addEventListener('input', () => {
    socket.emit('typing', { user: username, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { socket.emit('typing', { user: username, isTyping: false }); }, 1500);
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault(); const messageText = input.value.trim();
    if (messageText) {
        if (messageText === '/clear') { messages.innerHTML = ''; input.value = ''; return; }
        if (messageText.startsWith('/msg ')) {
            const parts = messageText.split(' ');
            if (parts.length > 2) {
                socket.emit('private message', { user: username, toUser: parts[1], text: parts.slice(2).join(' '), color: userColor, avatar: avatarUrl, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), replyTo: replyingTo });
                input.value = ''; socket.emit('typing', { user: username, isTyping: false }); replyingTo = null; replyPreviewContainer.classList.add('hidden'); emojiPicker.classList.add('hidden'); return;
            }
        }
        socket.emit('chat message', { user: username, text: messageText, color: userColor, avatar: avatarUrl, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), replyTo: replyingTo });
        input.value = ''; socket.emit('typing', { user: username, isTyping: false }); replyingTo = null; replyPreviewContainer.classList.add('hidden'); emojiPicker.classList.add('hidden'); 
    }
});

socket.on('user list', (users) => { userListSpan.textContent = users.join(', '); });

socket.on('typing', (data) => { 
    if (data.isTyping) {
        typingIndicator.classList.remove('hidden');
        typingUserSpan.textContent = `${data.user} is typing...`;
        messages.scrollTop = messages.scrollHeight;
    } else {
        typingIndicator.classList.add('hidden');
    }
});

socket.on('update likes', (data) => { const likeSpan = document.getElementById(`like-count-${data.id}`); if (likeSpan) likeSpan.textContent = data.likes > 0 ? data.likes : ''; });

socket.on('message deleted', (msgId) => {
    const item = document.getElementById(`msg-${msgId}`);
    if (item) {
        const contentArea = item.querySelector('.message-text, .chat-image, .chat-audio');
        if (contentArea) { const deletedNotice = document.createElement('span'); deletedNotice.className = 'deleted-text'; deletedNotice.innerHTML = '🚫 This message was deleted'; contentArea.replaceWith(deletedNotice); }
        const delBtn = item.querySelector('.msg-delete-btn'); if (delBtn) delBtn.remove();
        const pinBtn = item.querySelector('.msg-pin-btn'); if (pinBtn) pinBtn.remove();
        const replyBlock = item.querySelector('.replied-to'); if (replyBlock) replyBlock.remove();
    }
});

function displayMessage(data, isHistory = false) {
    const item = document.createElement('li'); item.id = `msg-${data.id}`; 
    item.setAttribute('data-sender', data.user); 
    
    if (data.type === 'system') { item.classList.add('system-message'); item.textContent = data.text; messages.appendChild(item); messages.scrollTop = messages.scrollHeight; return; }

    const isMe = data.user === username;
    
    if (!isMe && !isHistory) {
        notifySound.play().catch(() => {});
        if (!document.hasFocus() && "Notification" in window && Notification.permission === "granted") {
            try {
                if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                    navigator.serviceWorker.ready.then(function(reg) { reg.showNotification(`New message from ${data.user}`, { body: data.text || "Sent an attachment" }); }).catch(() => {});
                } else { new Notification(`New message from ${data.user}`, { body: data.text || "Sent an attachment" }); }
            } catch (err) { console.log("Silent notification failure"); }
        }
    }

    const lastMessage = messages.lastElementChild;
    let isStacked = false;
    if (lastMessage && !lastMessage.classList.contains('system-message')) {
        const lastSenderName = lastMessage.getAttribute('data-sender');
        // 🌟 THE FIX: Now perfectly checks the sender name to merge bubbles!
        if (lastSenderName === data.user && lastMessage.classList.contains('my-message') === isMe) {
            isStacked = true;
        }
    }

    item.classList.add(isMe ? 'my-message' : 'other-message');
    if (isStacked) item.classList.add('stacked'); 
    if (data.type === 'private') item.classList.add('private-message');
    
    let contentHTML = '';
    if (data.uploadedImage) { contentHTML = `<img src="${data.uploadedImage}" class="chat-image" alt="Uploaded image">`; } 
    else if (data.audio) { contentHTML = `<audio controls src="${data.audio}" class="chat-audio"></audio>`; } 
    else {
        let safeText = escapeHTML(data.text);
        safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); safeText = safeText.replace(/\*(.*?)\*/g, '<em>$1</em>'); 
        const imageRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/gi; safeText = safeText.replace(imageRegex, '<img src="$1" class="chat-image" alt="Shared image">');
        contentHTML = `<span class="message-text">${safeText}</span>`;
    }
    
    let replyHTML = ''; if (data.replyTo) { replyHTML = `<div class="replied-to"><div class="replied-to-user">${escapeHTML(data.replyTo.user)}</div><div class="replied-to-text">${escapeHTML(data.replyTo.text).substring(0, 40)}...</div></div>`; }

    let ticksHTML = ''; let deleteBtnHTML = ''; 
    let pinBtnHTML = `<button class="msg-pin-btn" data-id="${data.id}">📌</button>`;
    
    if (isMe && data.type !== 'private') {
        const tickClass = data.status === 'read' ? 'read' : 'delivered';
        ticksHTML = `<span class="ticks ${tickClass}">✔✔</span>`;
        deleteBtnHTML = `<button class="msg-delete-btn" data-id="${data.id}">🗑️</button>`;
    }
    
    item.innerHTML = `
        <img src="${data.avatar}" class="avatar" alt="avatar">
        <div class="message-content">
            <span class="sender-name" style="color: ${data.color}">
                ${isMe ? 'You' : escapeHTML(data.user)} ${data.type === 'private' ? ' 🤫 (Whisper)' : ''}
            </span>
            ${replyHTML}
            ${contentHTML}
            <span class="timestamp">
                ${data.time} 
                <button class="like-btn" data-id="${data.id}">❤️ <span id="like-count-${data.id}">${data.likes > 0 ? data.likes : ''}</span></button>
                ${pinBtnHTML}
                ${deleteBtnHTML}
                ${ticksHTML}
            </span>
        </div>
    `;
    
    messages.appendChild(item); messages.scrollTop = messages.scrollHeight; 
}

socket.on('chat history', (historyArray) => { historyArray.forEach(msg => displayMessage(msg, true)); });
socket.on('chat message', (data) => { displayMessage(data, false); if (document.hasFocus()) socket.emit('mark read'); });
