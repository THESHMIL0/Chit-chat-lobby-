// Import the tools we need
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Setup the server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Tell the server to serve our frontend files from the "public" folder (we will make this later)
app.use(express.static(path.join(__dirname, 'public')));

// Listen for users connecting to our app
io.on('connection', (socket) => {
    console.log('A user connected!');

    // When this user sends a message, broadcast it to everyone else
    socket.on('chat message', (data) => {
        io.emit('chat message', data);
    });

    // When the user leaves
    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

// Start the server on a port assigned by Render, or 3000 if testing locally
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
