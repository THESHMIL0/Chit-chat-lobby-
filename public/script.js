const socket = io();

// Get elements for login and chat
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

// 🌟 NEW: Load our notification sound (a nice gentle pop!)
const notifySound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');

let username = "";
let userColor = "";
let avatarUrl = "";

// Handle the Login Form submission
loginForm.addEventListener('submit', (e) => {
    e.preventDefault(); 
    username = usernameInput.value.trim();
    
    if (username) {
        userColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
        
        loginScreen.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        
        socket.emit('new user', username);
    }
});

// Clear button logic
clearBtn.addEventListener('click', () => {
    messages.innerHTML = ''; 
});

// Security function
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Detect typing
let typingTimeout;
input.addEventListener('input', () => {
    socket.emit('typing', { user: username, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { user: username, isTyping: false });
    }, 1500);
});

// Handle sending messages
chatForm.addEventListener('submit', (e) => {
    e.preventDefault(); 
    const messageText = input.value.trim();
    
    if (messageText) {
        if (messageText === '/clear') {
            messages.innerHTML = ''; 
            input.value = '';
            return;
        } else if (messageText === '/help') {
            alert("Available commands:\n/clear - Clears your screen");
            input.value = '';
            return;
        }

        socket.emit('chat message', {
            user: username,
            text: messageText,
            color: userColor, 
            avatar: avatarUrl, 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
        
        input.value = ''; 
        socket.emit('typing', { user: username, isTyping: false }); 
    }
});

// Server events
socket.on('user list', (users) => {
    userListSpan.textContent = users.join(', ');
});

socket.on('typing', (data) => {
    if (data.isTyping) {
        typingIndicator.textContent = `${data.user} is typing...`;
    } else {
        typingIndicator.textContent = '';
    }
});

// 🌟 UPDATED: Added "isHistory" so we know if the message is old or new
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
    
    // 🌟 NEW: If the message isn't yours, isn't old history, and isn't a system message, play the sound!
    if (!isMe && !isHistory) {
        // .catch() prevents console errors if the browser is being overly strict
        notifySound.play().catch(err => console.log("Sound blocked by browser:", err));
    }

    item.classList.add(isMe ? 'my-message' : 'other-message');
    
    let safeText = escapeHTML(data.text);
    const imageRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/gi;
    safeText = safeText.replace(imageRegex, '<img src="$1" class="chat-image" alt="Shared image">');
    
    item.innerHTML = `
        <img src="${data.avatar}" class="avatar" alt="avatar">
        <div class="message-content">
            <span class="sender-name" style="color: ${data.color}">${isMe ? 'You' : escapeHTML(data.user)}</span>
            <span class="message-text">${safeText}</span>
            <span class="timestamp">${data.time}</span>
        </div>
    `;
    
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight; 
}

// Listen for chat history
socket.on('chat history', (historyArray) => {
    historyArray.forEach(messageData => {
        // 🌟 Pass "true" so the sound doesn't play for old messages
        displayMessage(messageData, true); 
    });
});

// Listen for new messages
socket.on('chat message', (data) => {
    // 🌟 Pass "false" because this is a brand new message, so the sound CAN play!
    displayMessage(data, false); 
});
