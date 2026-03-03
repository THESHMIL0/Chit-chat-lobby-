const socket = io();

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const userListSpan = document.getElementById('user-list');
const typingIndicator = document.getElementById('typing-indicator');
const installBtn = document.getElementById('install-btn');

let username = prompt("Welcome to Chit Chat Lobby! What is your name?");
if (!username) username = "Anonymous";

// 🌟 NEW: Tell the server we joined
socket.emit('new user', username);

// 🌟 NEW: PWA Install Logic for Android
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'block'; // Show the button!
});

installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installBtn.style.display = 'none';
        }
        deferredPrompt = null;
    }
});

// 🌟 NEW: Detect when we are typing
let typingTimeout;
input.addEventListener('input', () => {
    socket.emit('typing', { user: username, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { user: username, isTyping: false });
    }, 1500); // Stop typing after 1.5 seconds of no keys
});

form.addEventListener('submit', (e) => {
    e.preventDefault(); 
    if (input.value) {
        socket.emit('chat message', {
            user: username,
            text: input.value,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) // 🌟 NEW: Add Timestamp
        });
        input.value = ''; 
        socket.emit('typing', { user: username, isTyping: false }); // Stop typing indicator
    }
});

// 🌟 NEW: Update User List
socket.on('user list', (users) => {
    userListSpan.textContent = users.join(', ');
});

// 🌟 NEW: Show Typing Indicator
socket.on('typing', (data) => {
    if (data.isTyping) {
        typingIndicator.textContent = `${data.user} is typing...`;
    } else {
        typingIndicator.textContent = '';
    }
});

// Handle incoming messages
socket.on('chat message', (data) => {
    const item = document.createElement('li');
    
    // Add Timestamp logic to the HTML
    if (data.user === username) {
        item.classList.add('my-message');
        item.innerHTML = `<span class="sender-name">You</span> ${data.text} <span class="timestamp">${data.time}</span>`;
    } else {
        item.classList.add('other-message');
        item.innerHTML = `<span class="sender-name">${data.user}</span> ${data.text} <span class="timestamp">${data.time}</span>`;
    }
    
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight; 
});
