const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// ✅ FIX: fetch support for all Node versions
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

function getUsersInRoom(roomId) {
    return Object.values(activeUsersById)
        .filter(u => u.roomId === roomId)
        .map(u => u.name);
}

function broadcastRooms(targetSocket = io) {
    db.all(`SELECT id, name, logo, isPrivate FROM rooms`, (err, rows) => {
        if (rows) targetSocket.emit('room list', rows);
    });
}

// ✅ faster + safer preview
async function fetchLinkPreview(url) {
    try {
        const res = await fetch(url, { timeout: 2000 });
        const text = await res.text();
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) return { title: titleMatch[1].trim(), url };
    } catch (e) {}
    return null;
}

// ✅ AI bot
async function askSmartBot(prompt) {
    const apiKey = process.env.GEMINI_API_KEY; 
    if (!apiKey) return "Missing API key 😿";

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt + " (short reply, emojis)" }] }]
            })
        });

        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || "Error 🤖";
    } catch {
        return "Bot error 😵";
    }
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
            if (room.isPrivate && room.password !== data.password) 
                return socket.emit('join error', 'Wrong password');

            socket.rooms.forEach(r => r !== socket.id && socket.leave(r));

            socket.join(room.id);

            activeUsersById[socket.id] = { ...data.user, roomId: room.id };

            db.all("SELECT data FROM history WHERE roomId = ? ORDER BY timestamp ASC LIMIT 50",
                [room.id],
                (err, rows) => {
                    const history = rows?.map(r => JSON.parse(r.data)) || [];
                    socket.emit('chat history', { room, history });
                }
            );

            io.to(room.id).emit('room users', getUsersInRoom(room.id));
        });
    });

    socket.on('chat message', async (data) => {
        const user = activeUsersById[socket.id];
        if (!user) return;

        const roomId = user.roomId;

        data.id = Date.now() + "_" + Math.random();
        data.roomId = roomId;
        data.type = 'chat';
        data.reactions = {};
        data.status = 'delivered';

        // link preview
        if (data.text) {
            const urls = data.text.match(/https?:\/\/\S+/);
            if (urls) {
                const preview = await fetchLinkPreview(urls[0]);
                if (preview) data.linkPreview = preview;
            }
        }

        // save
        if (!data.isGhost) {
            db.run("INSERT INTO history VALUES (?, ?, ?, ?)",
                [data.id, roomId, Date.now(), JSON.stringify(data)]);
        }

        io.to(roomId).emit('chat message', data);

        // 🤖 bot
        if (data.text?.includes('@bot') || roomId === 'ai_lounge') {
            const reply = await askSmartBot(data.text || "hello");
            const botMsg = {
                id: Date.now() + "_bot",
                user: '🤖 Bot',
                text: reply,
                roomId,
                type: 'chat',
                reactions: {},
                status: 'delivered',
                time: new Date().toLocaleTimeString()
            };

            db.run("INSERT INTO history VALUES (?, ?, ?, ?)",
                [botMsg.id, roomId, Date.now(), JSON.stringify(botMsg)]);

            io.to(roomId).emit('chat message', botMsg);
        }
    });

    // ✅ FIXED delete (owner only)
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

    // ✅ optimized read
    socket.on('mark read', () => {
        const user = activeUsersById[socket.id];
        if (!user) return;

        db.all(
            "SELECT id, data FROM history WHERE roomId = ? AND data LIKE '%\"status\":\"delivered\"%'",
            [user.roomId],
            (err, rows) => {
                rows?.forEach(row => {
                    const msg = JSON.parse(row.data);
                    if (msg.user !== user.name) {
                        msg.status = 'read';
                        db.run("UPDATE history SET data = ? WHERE id = ?",
                            [JSON.stringify(msg), row.id]);
                    }
                });
            }
        );

        socket.to(user.roomId).emit('messages read');
    });

    socket.on('disconnect', () => {
        delete activeUsersById[socket.id];
    });
});

server.listen(process.env.PORT || 3000, () =>
    console.log('🚀 Server running')
);
