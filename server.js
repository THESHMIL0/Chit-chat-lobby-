const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./chat.db');
let messageHistory = [];
let pinnedMessage = null; // 🌟 NEW: Track the pinned message

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, timestamp INTEGER, data TEXT)`);
    db.all("SELECT data FROM history ORDER BY timestamp ASC LIMIT 50", (err, rows) => {
        if (!err && rows) {
            messageHistory = rows.map(row => JSON.parse(row.data));
            console.log(`Loaded ${messageHistory.length} messages.`);
        }
    });
});

function insertMessage(msg) {
    messageHistory.push(msg);
    if (messageHistory.length > 50) messageHistory.shift(); 
    db.run("INSERT INTO history (id, timestamp, data) VALUES (?, ?, ?)", [msg.id, Date.now(), JSON.stringify(msg)]);
}

function updateMessageInDB(msg) {
    db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), msg.id]);
}

const activeUsersById = {}; const activeUsersByName = {}; 

io.on('connection', (socket) => {
    socket.on('new user', (username) => {
        activeUsersById[socket.id] = username;
        activeUsersByName[username] = socket.id; 
        io.emit('user list', Object.values(activeUsersById));
        socket.emit('chat history', messageHistory);
        
        // 🌟 NEW: Send the pinned message to the new user
        if (pinnedMessage) socket.emit('pinned updated', pinnedMessage);

        const sysMsg = { id: Date.now().toString(), type: 'system', text: `🚀 ${username} joined the lobby` };
        insertMessage(sysMsg);
        io.emit('chat message', sysMsg); 
    });

    socket.on('chat message', (data) => {
        data.id = Date.now().toString() + Math.floor(Math.random() * 1000); 
        data.type = 'chat'; data.likes = 0; data.status = 'delivered'; 
        insertMessage(data); io.emit('chat message', data);
    });

    // 🌟 NEW: Handle Pinning
    socket.on('pin message', (msgData) => {
        pinnedMessage = msgData;
        io.emit('pinned updated', pinnedMessage);
    });
    
    socket.on('unpin message', () => {
        pinnedMessage = null;
        io.emit('pinned updated', null);
    });

    socket.on('delete message', (msgId) => {
        const msgIndex = messageHistory.findIndex(m => m.id === msgId);
        if (msgIndex !== -1) messageHistory.splice(msgIndex, 1);
        db.run("DELETE FROM history WHERE id = ?", [msgId]);
        io.emit('message deleted', msgId);
        // Unpin if the pinned message gets deleted
        if (pinnedMessage && pinnedMessage.id === msgId) {
            pinnedMessage = null;
            io.emit('pinned updated', null);
        }
    });

    socket.on('mark read', () => {
        let updated = false;
        messageHistory.forEach(msg => {
            if (msg.user !== activeUsersById[socket.id] && msg.status === 'delivered') {
                msg.status = 'read'; updateMessageInDB(msg); updated = true;
            }
        });
        if (updated) io.emit('messages read'); 
    });

    socket.on('private message', (data) => {
        data.id = Date.now().toString() + Math.floor(Math.random() * 1000);
        data.type = 'private'; data.likes = 0; data.status = 'delivered';
        const targetSocketId = activeUsersByName[data.toUser];
        if (targetSocketId) {
            io.to(targetSocketId).emit('chat message', data); socket.emit('chat message', data); 
        } else {
            socket.emit('chat message', { id: Date.now().toString(), type: 'system', text: `❌ User ${data.toUser} is offline.` });
        }
    });

    socket.on('like message', (msgId) => {
        const msg = messageHistory.find(m => m.id === msgId);
        if (msg) { msg.likes += 1; updateMessageInDB(msg); io.emit('update likes', { id: msgId, likes: msg.likes }); }
    });

    socket.on('typing', (data) => { socket.broadcast.emit('typing', data); });

    socket.on('disconnect', () => {
        const username = activeUsersById[socket.id];
        if (username) {
            const sysMsg = { id: Date.now().toString(), type: 'system', text: `🚪 ${username} left the lobby` };
            insertMessage(sysMsg);
            delete activeUsersById[socket.id]; delete activeUsersByName[username];
            io.emit('user list', Object.values(activeUsersById)); io.emit('chat message', sysMsg);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server is running on port ${PORT}`); });
