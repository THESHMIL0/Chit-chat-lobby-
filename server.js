const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const activeUsers = {};
// 🌟 NEW: Create a list to hold recent messages
const messageHistory = [];
const MAX_HISTORY = 50; // We will only keep the last 50 messages so the server doesn't get overloaded

io.on('connection', (socket) => {
    
    socket.on('new user', (username) => {
        activeUsers[socket.id] = username;
        io.emit('user list', Object.values(activeUsers));
        
        // 🌟 NEW: When someone joins, send THEM (and only them) the message history
        socket.emit('chat history', messageHistory);
    });

    socket.on('chat message', (data) => {
        // 🌟 NEW: Save the new message into our history array
        messageHistory.push(data);
        
        // If we have more than 50 messages, remove the oldest one
        if (messageHistory.length > MAX_HISTORY) {
            messageHistory.shift(); 
        }
        
        io.emit('chat message', data);
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    socket.on('disconnect', () => {
        delete activeUsers[socket.id];
        io.emit('user list', Object.values(activeUsers));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
