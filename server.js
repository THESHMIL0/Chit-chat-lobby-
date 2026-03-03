const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 🌟 NEW: Object to keep track of active users
const activeUsers = {};

io.on('connection', (socket) => {
    // 🌟 NEW: When a user joins, save their name and broadcast the updated list
    socket.on('new user', (username) => {
        activeUsers[socket.id] = username;
        io.emit('user list', Object.values(activeUsers));
    });

    socket.on('chat message', (data) => {
        io.emit('chat message', data);
    });

    // 🌟 NEW: Broadcast when someone is typing
    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    // 🌟 NEW: When someone leaves, remove them and update the list
    socket.on('disconnect', () => {
        delete activeUsers[socket.id];
        io.emit('user list', Object.values(activeUsers));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
