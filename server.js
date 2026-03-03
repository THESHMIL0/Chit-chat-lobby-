const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const activeUsers = {};
const messageHistory = [];
const MAX_HISTORY = 50; 

io.on('connection', (socket) => {
    
    socket.on('new user', (username) => {
        activeUsers[socket.id] = username;
        io.emit('user list', Object.values(activeUsers));
        
        socket.emit('chat history', messageHistory);

        // 🌟 NEW: Create and send a Join system message
        const sysMsg = { type: 'system', text: `🚀 ${username} joined the lobby` };
        messageHistory.push(sysMsg);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.emit('chat message', sysMsg); 
    });

    socket.on('chat message', (data) => {
        // 🌟 NEW: Tag standard messages as 'chat'
        data.type = 'chat'; 
        messageHistory.push(data);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.emit('chat message', data);
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    socket.on('disconnect', () => {
        const username = activeUsers[socket.id];
        if (username) {
            // 🌟 NEW: Create and send a Leave system message
            const sysMsg = { type: 'system', text: `🚪 ${username} left the lobby` };
            messageHistory.push(sysMsg);
            if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
            
            delete activeUsers[socket.id];
            io.emit('user list', Object.values(activeUsers));
            io.emit('chat message', sysMsg);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
