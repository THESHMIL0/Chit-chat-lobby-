const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// ✅ FIX: fetch support for all Node versions (From your AI analysis!)
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const server = http.createServer(app);

const io = new Server(server, { 
    maxHttpBufferSize: 1e8,
    cors: { origin: "*", methods: ["GET", "POST"] }
}); 

app.use(express.static(path.join(__dirname, 'public')));
const db = new sqlite3.Database('./chat.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, logo TEXT, isPrivate INTEGER, password TEXT, pinnedMessage TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, roomId TEXT, timestamp INTEGER, data TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, avatar TEXT, about TEXT, isOnline INTEGER, lastSeen INTEGER, bubbleColor TEXT)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_history_roomId_time ON history(roomId, timestamp)`);
    
    db.get(`SELECT id FROM rooms WHERE id = 'lobby'`, (err, row) => {
        if (!row) db.run(`INSERT INTO rooms VALUES ('lobby', 'Lobby 😸', '', 0, '', NULL)`);
    });
    db.get(`SELECT id FROM rooms WHERE id = 'ai_lounge'`, (err, row) => {
        if (!row) db.run(`INSERT INTO rooms VALUES ('ai_lounge', '🤖 AI Lounge', 'https://api.dicebear.com/7.x/bottts/svg?seed=ChitChatBot&backgroundColor=00a884', 0, '', NULL)`);
    });
});

const activeUsersById = {}; 

function getUsersInRoom(roomId) { return Object.values(activeUsersById).filter(u => u.roomId === roomId).map(u => u.name); }
function broadcastRooms(targetSocket = io) { db.all(`SELECT id, name, logo, isPrivate FROM rooms`, (err, rows) => { if (rows) targetSocket.emit('room list', rows); }); }

// ✅ Faster + safer preview
async function fetchLinkPreview(url) {
    try {
        const res = await fetch(url, { timeout: 2000 });
        const text = await res.text();
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) return { title: titleMatch[1].trim(), url };
    } catch (e) {} return null;
}

// ✅ AI bot
async function askSmartBot(prompt) {
    const apiKey = process.env.GEMINI_API_KEY; 
    if (!apiKey) return "Missing API key 😿";
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt + " (short reply, emojis)" }] }] })
        });
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Error 🤖";
    } catch { return "Bot error 😵"; }
}

io.on('connection', (socket) => {
    broadcastRooms(socket);

    socket.on('create room', (data) => {
        const roomId = 'room_' + Date.now();
        db.run(`INSERT INTO rooms VALUES (?, ?, ?, ?, ?, NULL)`, 
            [roomId, data.name, '', data.isPrivate ? 1 : 0, data.password], 
            () => broadcastRooms()
        );
    });

    socket.on('join room', (data) => {
        db.get(`SELECT * FROM rooms WHERE id = ?`, [data.roomId], (err, room) => {
            if (!room) return socket.emit('error', 'Room not found');
            if (room.isPrivate && room.password !== data.password) return socket.emit('join error', 'Wrong password');

            socket.rooms.forEach(r => r !== socket.id && socket.leave(r));
            socket.join(room.id);
            activeUsersById[socket.id] = { ...data.user, roomId: room.id };

            db.run("INSERT OR REPLACE INTO users (name, avatar, about, isOnline, lastSeen, bubbleColor) VALUES (?, ?, ?, ?, ?, ?)", [data.user.name, data.user.avatar, data.user.about, 1, Date.now(), data.user.color || '#dcf8c6']);

            db.all("SELECT data FROM history WHERE roomId = ? ORDER BY timestamp ASC LIMIT 50", [room.id], (err, rows) => {
                const history = rows?.map(r => JSON.parse(r.data)) || [];
                socket.emit('chat history', { room: { id: room.id, name: room.name, logo: room.logo, isPrivate: room.isPrivate === 1 }, history });
                socket.emit('pinned updated', room.pinnedMessage ? JSON.parse(room.pinnedMessage) : null);
            });
            io.to(room.id).emit('room users', getUsersInRoom(room.id));
        });
    });

    socket.on('leave room', () => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if (roomId) {
            socket.leave(roomId); delete activeUsersById[socket.id].roomId;
            io.to(roomId).emit('room users', getUsersInRoom(roomId));
        }
    });

    // 🌟 RESTORED: Profile & Group Updates
    socket.on('update profile', (user) => {
        if(activeUsersById[socket.id]) { activeUsersById[socket.id].name = user.name; activeUsersById[socket.id].avatar = user.avatar; activeUsersById[socket.id].about = user.about; }
        db.run("INSERT OR REPLACE INTO users (name, avatar, about, isOnline, lastSeen, bubbleColor) VALUES (?, ?, ?, ?, ?, ?)", [user.name, user.avatar, user.about, 1, Date.now(), user.color || '#dcf8c6']);
    });
    socket.on('get user info', (username) => { db.get("SELECT * FROM users WHERE name = ?", [username], (err, row) => { if (row) socket.emit('user info result', row); }); });
    socket.on('update group info', (data) => {
        const updates = []; const params = [];
        if (data.name) { updates.push("name = ?"); params.push(data.name); }
        if (data.logo) { updates.push("logo = ?"); params.push(data.logo); }
        if (updates.length > 0) {
            params.push(data.roomId);
            db.run(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`, params, (err) => {
                if (!err) { broadcastRooms(); db.get(`SELECT * FROM rooms WHERE id = ?`, [data.roomId], (err, room) => { if (room) io.to(data.roomId).emit('group info updated', { id: room.id, name: room.name, logo: room.logo }); }); }
            });
        }
    });

    socket.on('chat message', async (data) => {
        const user = activeUsersById[socket.id];
        if (!user) return;
        const roomId = user.roomId;
        data.id = Date.now() + "_" + Math.random();
        data.roomId = roomId; data.type = 'chat'; data.reactions = {}; data.status = 'delivered';

        if (data.text) {
            const urls = data.text.match(/https?:\/\/\S+/);
            if (urls) { const preview = await fetchLinkPreview(urls[0]); if (preview) data.linkPreview = preview; }
        }
        if (!data.isGhost) db.run("INSERT INTO history VALUES (?, ?, ?, ?)", [data.id, roomId, Date.now(), JSON.stringify(data)]);
        
        io.to(roomId).emit('chat message', data);
        socket.broadcast.emit('global room alert', roomId);

        if (data.text?.includes('@bot') || roomId === 'ai_lounge') {
            socket.to(roomId).emit('user typing', { name: '🤖 Bot', isTyping: true });
            const reply = await askSmartBot(data.text || "hello");
            const botMsg = { id: Date.now() + "_bot", user: '🤖 Bot', text: reply, roomId, type: 'chat', reactions: {}, status: 'delivered', time: new Date().toLocaleTimeString(), color: '#00a884', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=ChitChatBot&backgroundColor=00a884' };
            io.to(roomId).emit('user typing', { name: '🤖 Bot', isTyping: false });
            db.run("INSERT INTO history VALUES (?, ?, ?, ?)", [botMsg.id, roomId, Date.now(), JSON.stringify(botMsg)]);
            io.to(roomId).emit('chat message', botMsg);
        }
    });

    // 🌟 RESTORED: Polls, Reactions, Edits, and Pins!
    socket.on('vote poll', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId; const voterName = activeUsersById[socket.id]?.name;
        if(!roomId || !voterName) return;
        db.get("SELECT data FROM history WHERE id = ?", [data.msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data);
                if (msg.poll) {
                    msg.poll.options.forEach(opt => { const index = opt.votes.indexOf(voterName); if (index > -1) opt.votes.splice(index, 1); });
                    msg.poll.options[data.optionIndex].votes.push(voterName);
                    db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                    io.to(roomId).emit('poll updated', msg);
                }
            }
        });
    });
    socket.on('react message', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId; const playerName = activeUsersById[socket.id]?.name;
        if(!roomId || !playerName) return;
        db.get("SELECT data FROM history WHERE id = ?", [data.msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data); msg.reactions = msg.reactions || {};
                for (let e in msg.reactions) { msg.reactions[e] = msg.reactions[e].filter(name => name !== playerName); if (msg.reactions[e].length === 0) delete msg.reactions[e]; }
                msg.reactions[data.emoji] = msg.reactions[data.emoji] || []; msg.reactions[data.emoji].push(playerName);
                db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                io.to(roomId).emit('update reactions', { id: data.msgId, reactions: msg.reactions });
            }
        });
    });
    socket.on('edit message', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId; if(!roomId) return;
        db.get("SELECT data FROM history WHERE id = ?", [data.msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data);
                if (msg.user === activeUsersById[socket.id].name) {
                    msg.text = data.newText; msg.isEdited = true;
                    db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                    io.to(roomId).emit('message edited', { id: data.msgId, newText: data.newText });
                }
            }
        });
    });
    socket.on('typing', (isTyping) => { const roomId = activeUsersById[socket.id]?.roomId; if(roomId) socket.to(roomId).emit('user typing', { name: activeUsersById[socket.id].name, isTyping }); });
    socket.on('pin message', (data) => { const roomId = activeUsersById[socket.id]?.roomId; if(!roomId) return; db.run(`UPDATE rooms SET pinnedMessage = ? WHERE id = ?`, [JSON.stringify(data.msg), roomId], () => { io.to(roomId).emit('pinned updated', data.msg); }); });
    socket.on('unpin message', () => { const roomId = activeUsersById[socket.id]?.roomId; if(!roomId) return; db.run(`UPDATE rooms SET pinnedMessage = NULL WHERE id = ?`, [roomId], () => { io.to(roomId).emit('pinned updated', null); }); });

    // ✅ FIXED: delete (owner only)
    socket.on('delete message', (msgId) => {
        const user = activeUsersById[socket.id];
        if (!user) return;
        db.get("SELECT data FROM history WHERE id = ?", [msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data);
                if (msg.user === user.name) {
                    db.run("DELETE FROM history WHERE id = ?", [msgId]);
                    io.to(user.roomId).emit('message deleted', msgId);
                }
            }
        });
    });

    // ✅ OPTIMIZED: read receipts
    socket.on('mark read', () => {
        const user = activeUsersById[socket.id];
        if (!user) return;
        db.all("SELECT id, data FROM history WHERE roomId = ? AND data LIKE '%\"status\":\"delivered\"%'", [user.roomId], (err, rows) => {
            rows?.forEach(row => {
                const msg = JSON.parse(row.data);
                if (msg.user !== user.name) {
                    msg.status = 'read';
                    db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), row.id]);
                }
            });
        });
        socket.to(user.roomId).emit('messages read');
    });

    socket.on('disconnect', () => {
        const userData = activeUsersById[socket.id];
        if (userData) {
            db.run(`UPDATE users SET isOnline = 0, lastSeen = ? WHERE name = ?`, [Date.now(), userData.name]);
            if (userData.roomId) {
                io.to(userData.roomId).emit('room users', getUsersInRoom(userData.roomId));
                io.to(userData.roomId).emit('user typing', { name: userData.name, isTyping: false });
            }
        }
        delete activeUsersById[socket.id];
    });
});

server.listen(process.env.PORT || 3000, () => console.log('🚀 Server running'));
