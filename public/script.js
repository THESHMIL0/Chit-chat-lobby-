const socket = io();

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const userListSpan = document.getElementById('user-list');
const typingIndicator = document.getElementById('typing-indicator');

let username = prompt("Welcome to Chit Chat Lobby! What is your name?");
if (!username) username = "Anonymous";

// 🌟 NEW: Generate a unique color and avatar based on the username
const userColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

socket.emit('new user', username);

// Detect typing
let typingTimeout;
input.addEventListener('input', () => {
    socket.emit('typing', { user: username, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { user: username, isTyping: false });
    }, 1500);
});

form.addEventListener('submit', (e) => {
    e.preventDefault(); 
    const messageText = input.value.trim();
    
    if (messageText) {
        // 🌟 NEW: Slash Commands
        if (messageText === '/clear') {
            messages.innerHTML = ''; // Clears local chat
            input.value = '';
            return;
        } else if (messageText === '/help') {
            alert("Available commands:\n/clear - Clears your screen");
            input.value = '';
            return;
        }

        // Normal message sending
        socket.emit('chat message', {
            user: username,
            text: messageText,
            color: userColor, // Send our color
            avatar: avatarUrl, // Send our avatar
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        });
        
        input.value = ''; 
        socket.emit('typing', { user: username, isTyping: false }); 
    }
});

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

socket.on('chat message', (data) => {
    const item = document.createElement('li');
    
    // 🌟 UPDATED: Injecting Avatars and Custom Colors
    const isMe = data.user === username;
    item.classList.add(isMe ? 'my-message' : 'other-message');
    
    item.innerHTML = `
        <img src="${data.avatar}" class="avatar" alt="avatar">
        <div class="message-content">
            <span class="sender-name" style="color: ${data.color}">${isMe ? 'You' : data.user}</span>
            <span>${data.text}</span>
            <span class="timestamp">${data.time}</span>
        </div>
    `;
    
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight; 
});
