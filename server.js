const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // Allow larger images

app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./chat.db');

// In-memory room storage (defaults to one Lobby)
let rooms = {
    'lobby': { id: 'lobby', name: 'Lobby 😸', logo: '', isPrivate: false, password: '', pinnedMessage: null }
};

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, roomId TEXT, timestamp INTEGER, data TEXT)`);
});

const activeUsersById = {}; 

io.on('connection', (socket) => {
    
    // Send room list on connect
    socket.emit('room list', Object.values(rooms).map(r => ({ id: r.id, name: r.name, logo: r.logo, isPrivate: r.isPrivate })));

    socket.on('create room', (data) => {
        const roomId = 'room_' + Date.now();
        rooms[roomId] = { id: roomId, name: data.name, logo: '', isPrivate: data.isPrivate, password: data.password, pinnedMessage: null };
        io.emit('room list', Object.values(rooms).map(r => ({ id: r.id, name: r.name, logo: r.logo, isPrivate: r.isPrivate })));
    });

    socket.on('join room', (data) => {
        const room = rooms[data.roomId];
        if (!room) return socket.emit('error', 'Room not found');
        if (room.isPrivate && room.password !== data.password) return socket.emit('join error', 'Incorrect Password');

        // Leave previous rooms
        Array.from(socket.rooms).forEach(r => { if(r !== socket.id) socket.leave(r); });
        
        socket.join(room.id);
        const user = data.user;
        activeUsersById[socket.id] = { ...user, roomId: room.id };

        // Load history for this room
        db.all("SELECT data FROM history WHERE roomId = ? ORDER BY timestamp ASC LIMIT 50", [room.id], (err, rows) => {
            const history = rows ? rows.map(row => JSON.parse(row.data)) : [];
            socket.emit('chat history', { room: room, history: history });
            
            const sysMsg = { id: Date.now().toString(), type: 'system', text: `🚀 ${user.name} joined the group` };
            db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [sysMsg.id, room.id, Date.now(), JSON.stringify(sysMsg)]);
            io.to(room.id).emit('chat message', sysMsg);
        });
    });

    socket.on('update group info', (data) => {
        if(rooms[data.roomId]) {
            if (data.name) rooms[data.roomId].name = data.name;
            if (data.logo) rooms[data.roomId].logo = data.logo;
            io.emit('room list', Object.values(rooms).map(r => ({ id: r.id, name: r.name, logo: r.logo, isPrivate: r.isPrivate })));
            io.to(data.roomId).emit('group info updated', rooms[data.roomId]);
        }
    });

    socket.on('chat message', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return;
        data.id = Date.now().toString() + Math.floor(Math.random() * 1000); 
        data.type = 'chat'; data.likes = 0; data.status = 'delivered';
        
        db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [data.id, roomId, Date.now(), JSON.stringify(data)]);
        io.to(roomId).emit('chat message', data);
    });

    socket.on('like message', (msgId) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return;
        db.get("SELECT data FROM history WHERE id = ?", [msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data);
                msg.likes += 1;
                db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), msgId]);
                io.to(roomId).emit('update likes', { id: msgId, likes: msg.likes });
            }
        });
    });

    socket.on('delete message', (msgId) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return;
        db.run("DELETE FROM history WHERE id = ?", [msgId]);
        io.to(roomId).emit('message deleted', msgId);
    });

    socket.on('pin message', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return;
        rooms[roomId].pinnedMessage = data.msg;
        io.to(roomId).emit('pinned updated', data.msg);
    });

    socket.on('unpin message', () => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return;
        rooms[roomId].pinnedMessage = null;
        io.to(roomId).emit('pinned updated', null);
    });

    socket.on('mark read', () => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(roomId) io.to(roomId).emit('messages read'); // Simplification for performance
    });

    socket.on('disconnect', () => {
        const userData = activeUsersById[socket.id];
        if (userData && userData.roomId) {
            const sysMsg = { id: Date.now().toString(), type: 'system', text: `🚪 ${userData.name} left` };
            db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [sysMsg.id, userData.roomId, Date.now(), JSON.stringify(sysMsg)]);
            io.to(userData.roomId).emit('chat message', sysMsg);
            delete activeUsersById[socket.id];
        }
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server running!'));
