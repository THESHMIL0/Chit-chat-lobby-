const socket = io();

const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');

const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const userListSpan = document.getElementById('user-list');
const typingIndicator = document.getElementById('typing-indicator');
const clearBtn = document.getElementById('clear-btn');
const themeToggle = document.getElementById('theme-toggle');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const micBtn = document.getElementById('mic-btn'); // 🌟 NEW: Mic button
const replyPreviewContainer = document.getElementById('reply-preview-container');
const replyPreviewText = document.getElementById('reply-preview-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');
const notifySound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');

let username = "";
let userColor = "";
let avatarUrl = "";
let replyingTo = null; 

// 🌟 NEW: Voice Recorder Setup
let mediaRecorder;
let audioChunks = [];

// Try to get microphone permission as soon as the app loads
navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
    
    mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob); // Convert to base64 string to send over socket
        reader.onloadend = () => {
            socket.emit('chat message', {
                user: username,
                text: '', // Audio messages have no text
                audio: reader.result, // Send the audio data
                color: userColor, avatar: avatarUrl,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                replyTo: replyingTo
            });
            replyingTo = null;
            replyPreviewContainer.classList.add('hidden');
        };
    };
}).catch(err => console.log("Mic access denied or missing:", err));

// 🌟 NEW: Record when button is held down (supports touch screens too!)
function startRecording(e) { e.preventDefault(); if (mediaRecorder && mediaRecorder.state === 'inactive') { mediaRecorder.start(); micBtn.classList.add('mic-recording'); } }
function stopRecording(e) { e.preventDefault(); if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); micBtn.classList.remove('mic-recording'); } }

micBtn.addEventListener('mousedown', startRecording);
micBtn.addEventListener('mouseup', stopRecording);
micBtn.addEventListener('mouseleave', stopRecording); // Stop if they drag mouse off
micBtn.addEventListener('touchstart', startRecording);
micBtn.addEventListener('touchend', stopRecording);

themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    themeToggle.textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
});

emojiBtn.addEventListener('click', () => { emojiPicker.classList.toggle('hidden'); });
emojiPicker.addEventListener('emoji-click', event => {
    input.value += event.detail.unicode; 
    emojiPicker.classList.add('hidden'); input.focus(); 
});

// Handling Clicks on Messages (Replies AND Likes)
messages.addEventListener('click', (e) => {
    // 🌟 NEW: Check if they clicked the Like button first!
    if (e.target.closest('.like-btn')) {
        const msgId = e.target.closest('.like-btn').dataset.id;
        socket.emit('like message', msgId);
        return; // Stop here so it doesn't trigger a reply
    }

    const li = e.target.closest('li');
    if (!li || li.classList.contains('system-message')) return;

    const sender = li.querySelector('.sender-name').textContent;
    // Don't grab text from audio messages
    const textElement = li.querySelector('.message-text');
    const text = textElement ? textElement.innerText : "🎙️ Voice Message"; 

    replyingTo = { user: sender, text: text };
    replyPreviewText.innerHTML = `<strong>Replying to ${escapeHTML(sender)}</strong><br>${escapeHTML(text).substring(0, 40)}...`;
    replyPreviewContainer.classList.remove('hidden');
    input.focus(); 
});

cancelReplyBtn.addEventListener('click', () => {
    replyingTo = null;
    replyPreviewContainer.classList.add('hidden');
});

loginForm.addEventListener('submit', (e) => {
    e.preventDefault(); 
    username = usernameInput.value.trim();
    if (username) {
        userColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
        
        loginScreen.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
        socket.emit('new user', username);
    }
});

clearBtn.addEventListener('click', () => { messages.innerHTML = ''; });

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

let typingTimeout;
input.addEventListener('input', () => {
    socket.emit('typing', { user: username, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { user: username, isTyping: false });
    }, 1500);
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault(); 
    const messageText = input.value.trim();
    
    if (messageText) {
        if (messageText === '/clear') { messages.innerHTML = ''; input.value = ''; return; }

        // 🌟 NEW: Check for Private Whispers! (/msg Username Hello)
        if (messageText.startsWith('/msg ')) {
            const parts = messageText.split(' ');
            if (parts.length > 2) {
                const targetUser = parts[1];
                const actualMsg = parts.slice(2).join(' '); // Rejoin the rest of the text
                
                socket.emit('private message', {
                    user: username,
                    toUser: targetUser,
                    text: actualMsg,
                    color: userColor, avatar: avatarUrl,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    replyTo: replyingTo
                });
                
                input.value = ''; socket.emit('typing', { user: username, isTyping: false }); 
                replyingTo = null; replyPreviewContainer.classList.add('hidden'); emojiPicker.classList.add('hidden');
                return; // Stop normal message flow
            }
        }

        socket.emit('chat message', {
            user: username,
            text: messageText,
            color: userColor, avatar: avatarUrl, 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            replyTo: replyingTo 
        });
        
        input.value = ''; socket.emit('typing', { user: username, isTyping: false }); 
        replyingTo = null; replyPreviewContainer.classList.add('hidden'); emojiPicker.classList.add('hidden'); 
    }
});

socket.on('user list', (users) => { userListSpan.textContent = users.join(', '); });
socket.on('typing', (data) => { typingIndicator.textContent = data.isTyping ? `${data.user} is typing...` : ''; });

// 🌟 NEW: Listen for Like Updates
socket.on('update likes', (data) => {
    const likeSpan = document.getElementById(`like-count-${data.id}`);
    if (likeSpan) {
        likeSpan.textContent = data.likes > 0 ? data.likes : '';
    }
});

function displayMessage(data, isHistory = false) {
    const item = document.createElement('li');
    item.id = `msg-${data.id}`; // Give the HTML element the unique ID
    
    if (data.type === 'system') {
        item.classList.add('system-message');
        item.textContent = data.text;
        messages.appendChild(item);
        messages.scrollTop = messages.scrollHeight;
        return; 
    }

    const isMe = data.user === username;
    if (!isMe && !isHistory) notifySound.play().catch(() => {});

    item.classList.add(isMe ? 'my-message' : 'other-message');
    // Add private style if it was a whisper
    if (data.type === 'private') item.classList.add('private-message');
    
    // 🌟 NEW: Handle Markdown and Audio!
    let contentHTML = '';
    
    if (data.audio) {
        contentHTML = `<audio controls src="${data.audio}" class="chat-audio"></audio>`;
    } else {
        let safeText = escapeHTML(data.text);
        
        // Markdown Replacements
        safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
        safeText = safeText.replace(/\*(.*?)\*/g, '<em>$1</em>'); // Italic
        
        const imageRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/gi;
        safeText = safeText.replace(imageRegex, '<img src="$1" class="chat-image" alt="Shared image">');
        contentHTML = `<span class="message-text">${safeText}</span>`;
    }
    
    let replyHTML = '';
    if (data.replyTo) {
        replyHTML = `<div class="replied-to"><div class="replied-to-user">${escapeHTML(data.replyTo.user)}</div><div class="replied-to-text">${escapeHTML(data.replyTo.text).substring(0, 40)}...</div></div>`;
    }
    
    // Assemble everything, including the little Like button next to the timestamp
    item.innerHTML = `
        <img src="${data.avatar}" class="avatar" alt="avatar">
        <div class="message-content">
            <span class="sender-name" style="color: ${data.color}">
                ${isMe ? 'You' : escapeHTML(data.user)} 
                ${data.type === 'private' ? ' 🤫 (Whisper)' : ''}
            </span>
            ${replyHTML}
            ${contentHTML}
            <span class="timestamp">
                ${data.time} 
                <button class="like-btn" data-id="${data.id}">❤️ <span id="like-count-${data.id}">${data.likes > 0 ? data.likes : ''}</span></button>
            </span>
        </div>
    `;
    
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight; 
}

socket.on('chat history', (historyArray) => { historyArray.forEach(msg => displayMessage(msg, true)); });
socket.on('chat message', (data) => { displayMessage(data, false); });
