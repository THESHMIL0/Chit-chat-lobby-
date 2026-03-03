// Connect to the Socket.io server
const socket = io();

// Get elements from our HTML
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

// Ask the user for their name when they open the app
let username = prompt("Welcome to Chit Chat Lobby! What is your name?");
if (!username) {
    username = "Anonymous";
}

// What happens when the user clicks 'Send'
form.addEventListener('submit', (e) => {
    e.preventDefault(); // Prevents the page from refreshing
    if (input.value) {
        // Send the message and username to the server
        socket.emit('chat message', {
            user: username,
            text: input.value
        });
        input.value = ''; // Clear the input box after sending
    }
});

// What happens when we receive a message from the server
socket.on('chat message', (data) => {
    const item = document.createElement('li');
    // Format the message like "Username: Hello!"
    item.textContent = `${data.user}: ${data.text}`;
    messages.appendChild(item);
    
    // Auto-scroll to the newest message
    messages.scrollTop = messages.scrollHeight; 
});
