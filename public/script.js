const socket = io();

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const userListSpan = document.getElementById('user-list');
const typingIndicator = document.getElementById('typing-indicator');
const clearBtn = document.getElementById('clear-btn'); 

let username = prompt("Welcome to Chit Chat Lobby! What is your name?");
if (!username) username = "Anonymous";

socket.emit('new user', username);

// 🌟 NEW: Clear Chat Logic
clearBtn.addEventListener('click', () => {
    messages.innerHTML = ''; // This clears all messages from your screen
});

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
    if (input.value) {
        socket.emit('chat message', {
            user: username,
            text: input.value,
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
