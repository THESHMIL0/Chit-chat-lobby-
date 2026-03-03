const socket = io();

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

let username = prompt("Welcome to Chit Chat Lobby! What is your name?");
if (!username) {
    username = "Anonymous";
}

form.addEventListener('submit', (e) => {
    e.preventDefault(); 
    if (input.value) {
        socket.emit('chat message', {
            user: username,
            text: input.value
        });
        input.value = ''; 
    }
});

// 🌟 UPGRADED: Handle incoming messages smartly 🌟
socket.on('chat message', (data) => {
    const item = document.createElement('li');
    
    // Check if the message was sent by us
    if (data.user === username) {
        item.classList.add('my-message');
        item.innerHTML = `<span class="sender-name">You</span> ${data.text}`;
    } else {
        // If it was sent by someone else
        item.classList.add('other-message');
        item.innerHTML = `<span class="sender-name">${data.user}</span> ${data.text}`;
    }
    
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight; 
});
