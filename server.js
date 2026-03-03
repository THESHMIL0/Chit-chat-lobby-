const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const activeUsersById = {}; // Maps socket.id to username
const activeUsersByName = {}; // Maps username to socket.id (for Whispers)
const messageHistory = [];
const MAX_HISTORY = 50; 

io.on('connection', (socket) => {
    
    socket.on('new user', (username) => {
        activeUsersById[socket.id] = username;
        activeUsersByName[username] = socket.id; // Save for private messages
        io.emit('user list', Object.values(activeUsersById));
        socket.emit('chat history', messageHistory);

        const sysMsg = { id: Date.now().toString(), type: 'system', text: `🚀 ${username} joined the lobby` };
        messageHistory.push(sysMsg);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.emit('chat message', sysMsg); 
    });

    // Handle normal messages
    socket.on('chat message', (data) => {
        data.id = Date.now().toString() + Math.floor(Math.random() * 1000); // Give it a unique ID
        data.type = 'chat'; 
        data.likes = 0; // Start with 0 likes
        
        messageHistory.push(data);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.emit('chat message', data);
    });

    // 🌟 NEW: Handle Private Whispers
    socket.on('private message', (data) => {
        data.id = Date.now().toString() + Math.floor(Math.random() * 1000);
        data.type = 'private';
        data.likes = 0;
        
        const targetSocketId = activeUsersByName[data.toUser];
        if (targetSocketId) {
            io.to(targetSocketId).emit('chat message', data); // Send to receiver
            socket.emit('chat message', data); // Send copy to sender
        } else {
            socket.emit('chat message', { type: 'system', text: `❌ User ${data.toUser} is not online.` });
        }
    });

    // 🌟 NEW: Handle Message Likes
    socket.on('like message', (msgId) => {
        const msg = messageHistory.find(m => m.id === msgId);
        if (msg) {
            msg.likes += 1;
            io.emit('update likes', { id: msgId, likes: msg.likes });
        }
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    socket.on('disconnect', () => {
        const username = activeUsersById[socket.id];
        if (username) {
            const sysMsg = { id: Date.now().toString(), type: 'system', text: `🚪 ${username} left the lobby` };
            messageHistory.push(sysMsg);
            if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
            
            delete activeUsersById[socket.id];
            delete activeUsersByName[username];
            io.emit('user list', Object.values(activeUsersById));
            io.emit('chat message', sysMsg);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
