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

// 🌟 NEW: Reply UI Elements
const replyPreviewContainer = document.getElementById('reply-preview-container');
const replyPreviewText = document.getElementById('reply-preview-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');

const notifySound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');

let username = "";
let userColor = "";
let avatarUrl = "";
let replyingTo = null; // 🌟 NEW: Variable to hold the message we are replying to

// Dark Mode
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    themeToggle.textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
});

// Emojis
emojiBtn.addEventListener('click', () => { emojiPicker.classList.toggle('hidden'); });
emojiPicker.addEventListener('emoji-click', event => {
    input.value += event.detail.unicode; 
    emojiPicker.classList.add('hidden'); 
    input.focus(); 
});

// 🌟 NEW: Listen for clicks on messages to trigger a Reply
messages.addEventListener('click', (e) => {
    // Find the closest li element that was clicked
    const li = e.target.closest('li');
    // Ignore system messages or clicks outside a message
    if (!li || li.classList.contains('system-message')) return;

    // Grab the sender's name and text from the clicked message
    const sender = li.querySelector('.sender-name').textContent;
    const text = li.querySelector('.message-text').innerText; 

    // Set our variable and show the preview box!
    replyingTo = { user: sender, text: text };
    replyPreviewText.innerHTML = `<strong>Replying to ${escapeHTML(sender)}</strong><br>${escapeHTML(text).substring(0, 40)}...`;
    replyPreviewContainer.classList.remove('hidden');
    input.focus(); // Snap the cursor back to the text box
});

// 🌟 NEW: Cancel a reply
cancelReplyBtn.addEventListener('click', () => {
    replyingTo = null;
    replyPreviewContainer.classList.add('hidden');
});

// Login
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

// Typing indicators
let typingTimeout;
input.addEventListener('input', () => {
    socket.emit('typing', { user: username, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { user: username, isTyping: false });
    }, 1500);
});

// Sending Messages
chatForm.addEventListener('submit', (e) => {
    e.preventDefault(); 
    const messageText = input.value.trim();
    
    if (messageText) {
        if (messageText === '/clear') {
            messages.innerHTML = ''; input.value = ''; return;
        }

        socket.emit('chat message', {
            user: username,
            text: messageText,
            color: userColor, 
            avatar: avatarUrl, 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            replyTo: replyingTo // 🌟 NEW: Attach the reply data if it exists!
        });
        
        input.value = ''; 
        socket.emit('typing', { user: username, isTyping: false }); 
        emojiPicker.classList.add('hidden'); 
        
        // 🌟 NEW: Clear the reply state after sending
        replyingTo = null;
        replyPreviewContainer.classList.add('hidden');
    }
});

socket.on('user list', (users) => { userListSpan.textContent = users.join(', '); });
socket.on('typing', (data) => { typingIndicator.textContent = data.isTyping ? `${data.user} is typing...` : ''; });

function displayMessage(data, isHistory = false) {
    const item = document.createElement('li');
    
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
    
    let safeText = escapeHTML(data.text);
    const imageRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/gi;
    safeText = safeText.replace(imageRegex, '<img src="$1" class="chat-image" alt="Shared image">');
    
    // 🌟 NEW: If this message is a reply, build the HTML for the mini-preview block
    let replyHTML = '';
    if (data.replyTo) {
        replyHTML = `
            <div class="replied-to">
                <div class="replied-to-user">${escapeHTML(data.replyTo.user)}</div>
                <div class="replied-to-text">${escapeHTML(data.replyTo.text).substring(0, 40)}${data.replyTo.text.length > 40 ? '...' : ''}</div>
            </div>
        `;
    }
    
    // 🌟 UPDATED: Inject the replyHTML right above the main text
    item.innerHTML = `
        <img src="${data.avatar}" class="avatar" alt="avatar">
        <div class="message-content">
            <span class="sender-name" style="color: ${data.color}">${isMe ? 'You' : escapeHTML(data.user)}</span>
            ${replyHTML}
            <span class="message-text">${safeText}</span>
            <span class="timestamp">${data.time}</span>
        </div>
    `;
    
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight; 
}

socket.on('chat history', (historyArray) => { historyArray.forEach(msg => displayMessage(msg, true)); });
socket.on('chat message', (data) => { displayMessage(data, false); });
