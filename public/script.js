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

let username = "";
let userColor = "";
let avatarUrl = "";

// Handle the Login Form submission
loginForm.addEventListener('submit', (e) => {
    e.preventDefault(); // Stop the page from refreshing
    username = usernameInput.value.trim();
    
    if (username) {
        // Generate color and avatar
        userColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;
        
        // Hide login, show chat
        loginScreen.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        
        // Tell the server we joined
        socket.emit('new user', username);
    }
});

// Clear button logic
clearBtn.addEventListener('click', () => {
    messages.innerHTML = ''; 
});

// Security function to prevent malicious code
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
        // Slash Commands
        if (messageText === '/clear') {
            messages.innerHTML = ''; 
            input.value = '';
            return;
        } else if (messageText === '/help') {
            alert("Available commands:\n/clear - Clears your screen");
            input.value = '';
            return;
        }

        // Send the message to the server
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

// Server events for Users and Typing
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

// 🌟 NEW: A reusable function to draw messages on the screen
function displayMessage(data) {
    const item = document.createElement('li');
    
    const isMe = data.user === username;
    item.classList.add(isMe ? 'my-message' : 'other-message');
    
    item.innerHTML = `
        <img src="${data.avatar}" class="avatar" alt="avatar">
        <div class="message-content">
            <span class="sender-name" style="color: ${data.color}">${isMe ? 'You' : escapeHTML(data.user)}</span>
            <span class="message-text">${escapeHTML(data.text)}</span>
            <span class="timestamp">${data.time}</span>
        </div>
    `;
    
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight; 
}

// 🌟 NEW: Listen for the history when you first log in
socket.on('chat history', (historyArray) => {
    historyArray.forEach(messageData => {
        displayMessage(messageData); // Draw each old message
    });
});

// 🌟 UPDATED: Listen for new incoming messages
socket.on('chat message', (data) => {
    displayMessage(data); // Draw the new message
});
