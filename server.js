const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // Allows up to 100MB videos!

app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database('./chat.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, logo TEXT, isPrivate INTEGER, password TEXT, pinnedMessage TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, roomId TEXT, timestamp INTEGER, data TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, avatar TEXT, about TEXT, isOnline INTEGER, lastSeen INTEGER)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_history_roomId_time ON history(roomId, timestamp)`);
    
    db.get(`SELECT id FROM rooms WHERE id = 'lobby'`, (err, row) => {
        if (!row) db.run(`INSERT INTO rooms (id, name, logo, isPrivate, password) VALUES ('lobby', 'Lobby 😸', '', 0, '')`);
    });

    db.get(`SELECT id FROM rooms WHERE id = 'ai_lounge'`, (err, row) => {
        if (!row) db.run(`INSERT INTO rooms (id, name, logo, isPrivate, password) VALUES ('ai_lounge', '🤖 AI Lounge', 'https://api.dicebear.com/7.x/bottts/svg?seed=ChitChatBot&backgroundColor=00a884', 0, '')`);
    });
});

const activeUsersById = {}; 

function getUsersInRoom(roomId) {
    return Object.values(activeUsersById).filter(u => u.roomId === roomId).map(u => u.name);
}

function broadcastRooms(targetSocket = io) {
    db.all(`SELECT id, name, logo, isPrivate FROM rooms`, (err, rows) => {
        if (rows) targetSocket.emit('room list', rows);
    });
}

// 🌟 THE SUPER-BRAIN AI BOT (Now using Gemini 2.5 Flash!)
async function askSmartBot(prompt) {
    // 🛡️ SECURE: Grabbing the key from Render's vault! No hardcoded keys!
    const apiKey = process.env.GEMINI_API_KEY; 

    if (!apiKey) {
        return "My boss forgot to put my API key in Render's Environment Variables! 😿";
    }

    try {
        const finalPrompt = prompt + " (Keep your response conversational, under 3 sentences, and use emojis. Act like a helpful chat friend.)";
        
        // 👇 FIX: Using the brand new gemini-2.5-flash model! 👇
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: finalPrompt }] }],
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });
        const data = await res.json();
        
        if (data.error) {
            console.error("🤖 BOT ERROR:", data.error.message);
            return "My AI brain is having a connection issue... check Render logs! 🔌";
        }

        return data.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error("🤖 FETCH ERROR:", e);
        return "My brain is a little fuzzy right now... try asking again! 😵‍💫";
    }
}

io.on('connection', (socket) => {
    
    broadcastRooms(socket);

    socket.on('create room', (data) => {
        const roomId = 'room_' + Date.now();
        const isPrivateInt = data.isPrivate ? 1 : 0;
        db.run(`INSERT INTO rooms (id, name, logo, isPrivate, password) VALUES (?, ?, ?, ?, ?)`, 
            [roomId, data.name, '', isPrivateInt, data.password], 
            (err) => { if (!err) broadcastRooms(); }
        );
    });

    socket.on('join room', (data) => {
        db.get(`SELECT * FROM rooms WHERE id = ?`, [data.roomId], (err, room) => {
            if (!room) return socket.emit('error', 'Room not found');
            if (room.isPrivate === 1 && room.password !== data.password) return socket.emit('join error', 'Incorrect Password');

            const oldRoomId = activeUsersById[socket.id]?.roomId;
            Array.from(socket.rooms).forEach(r => { if(r !== socket.id) socket.leave(r); });
            if (oldRoomId) io.to(oldRoomId).emit('room users', getUsersInRoom(oldRoomId)); 

            socket.join(room.id);
            activeUsersById[socket.id] = { ...data.user, roomId: room.id };

            db.run("INSERT OR REPLACE INTO users (name, avatar, about, isOnline, lastSeen) VALUES (?, ?, ?, ?, ?)", 
                [data.user.name, data.user.avatar, data.user.about, 1, Date.now()]);

            db.all("SELECT data FROM history WHERE roomId = ? ORDER BY timestamp ASC LIMIT 50", [room.id], (err, rows) => {
                const history = rows ? rows.map(row => JSON.parse(row.data)) : [];
                const clientRoom = { id: room.id, name: room.name, logo: room.logo, isPrivate: room.isPrivate === 1 };
                
                socket.emit('chat history', { room: clientRoom, history: history });
                socket.emit('pinned updated', room.pinnedMessage ? JSON.parse(room.pinnedMessage) : null);
                
                if (!data.isReconnect) {
                    const sysMsg = { id: Date.now().toString(), type: 'system', text: `🚀 ${data.user.name} joined the group` };
                    db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [sysMsg.id, room.id, Date.now(), JSON.stringify(sysMsg)]);
                    io.to(room.id).emit('chat message', sysMsg);
                }
                io.to(room.id).emit('room users', getUsersInRoom(room.id));
            });
        });
    });

    socket.on('update profile', (user) => {
        if(activeUsersById[socket.id]) {
            activeUsersById[socket.id].name = user.name;
            activeUsersById[socket.id].avatar = user.avatar;
            activeUsersById[socket.id].about = user.about;
        }
        db.run("INSERT OR REPLACE INTO users (name, avatar, about, isOnline, lastSeen) VALUES (?, ?, ?, ?, ?)", [user.name, user.avatar, user.about, 1, Date.now()]);
    });

    socket.on('get user info', (username) => {
        db.get("SELECT * FROM users WHERE name = ?", [username], (err, row) => { if (row) socket.emit('user info result', row); });
    });

    socket.on('update group info', (data) => {
        const updates = []; const params = [];
        if (data.name) { updates.push("name = ?"); params.push(data.name); }
        if (data.logo) { updates.push("logo = ?"); params.push(data.logo); }
        if (updates.length > 0) {
            params.push(data.roomId);
            db.run(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`, params, (err) => {
                if (!err) {
                    broadcastRooms();
                    db.get(`SELECT * FROM rooms WHERE id = ?`, [data.roomId], (err, room) => {
                        if (room) io.to(data.roomId).emit('group info updated', { id: room.id, name: room.name, logo: room.logo });
                    });
                }
            });
        }
    });

    socket.on('chat message', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return; 
        data.id = Date.now().toString() + Math.floor(Math.random() * 1000); 
        data.type = 'chat'; data.likes = 0; data.status = 'delivered'; 
        
        if (!data.isGhost) {
            db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [data.id, roomId, Date.now(), JSON.stringify(data)]);
        }
        
        io.to(roomId).emit('chat message', data);
        socket.broadcast.emit('global room alert', roomId);

        const isBotMentioned = data.text && data.text.toLowerCase().includes('@bot');
        const isAiLounge = roomId === 'ai_lounge';

        if (data.user !== '🤖 Bot' && (isBotMentioned || isAiLounge)) {
            socket.to(roomId).emit('user typing', { name: '🤖 Bot', isTyping: true });
            
            setTimeout(async () => {
                let prompt = data.text.replace(/@bot/gi, '').trim();
                if (!prompt) prompt = "Say hello to everyone!";
                
                let botReply = await askSmartBot(prompt);

                const botMsg = {
                    id: Date.now().toString() + 'bot', user: '🤖 Bot',
                    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=ChitChatBot&backgroundColor=00a884',
                    text: botReply, type: 'chat', likes: 0, status: 'delivered',
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    isGhost: false
                };

                io.to(roomId).emit('user typing', { name: '🤖 Bot', isTyping: false });
                db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [botMsg.id, roomId, Date.now(), JSON.stringify(botMsg)]);
                io.to(roomId).emit('chat message', botMsg);
                socket.broadcast.emit('global room alert', roomId);
            }, 1500);
        }
    });

    // 🌟 BLUE TICK LISTENER
    socket.on('mark read', () => {
        const roomId = activeUsersById[socket.id]?.roomId;
        const username = activeUsersById[socket.id]?.name;
        if(roomId && username) {
            db.all("SELECT * FROM history WHERE roomId = ?", [roomId], (err, rows) => {
                if (rows) {
                    rows.forEach(row => {
                        const msg = JSON.parse(row.data);
                        if (msg.user !== username && msg.status !== 'read') {
                            msg.status = 'read';
                            db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), row.id]);
                        }
                    });
                }
            });
            socket.to(roomId).emit('messages read'); 
        }
    });

    socket.on('edit message', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return;
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

    socket.on('typing', (isTyping) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(roomId) socket.to(roomId).emit('user typing', { name: activeUsersById[socket.id].name, isTyping });
    });

    socket.on('like message', (msgId) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return;
        db.get("SELECT data FROM history WHERE id = ?", [msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data); msg.likes += 1;
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
        db.run(`UPDATE rooms SET pinnedMessage = ? WHERE id = ?`, [JSON.stringify(data.msg), roomId], () => { io.to(roomId).emit('pinned updated', data.msg); });
    });

    socket.on('unpin message', () => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return;
        db.run(`UPDATE rooms SET pinnedMessage = NULL WHERE id = ?`, [roomId], () => { io.to(roomId).emit('pinned updated', null); });
    });

    socket.on('disconnect', () => {
        const userData = activeUsersById[socket.id];
        if (userData) {
            db.run(`UPDATE users SET isOnline = 0, lastSeen = ? WHERE name = ?`, [Date.now(), userData.name]);
            if (userData.roomId) {
                delete activeUsersById[socket.id];
                io.to(userData.roomId).emit('room users', getUsersInRoom(userData.roomId));
                io.to(userData.roomId).emit('user typing', { name: userData.name, isTyping: false });
            }
        }
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server running!'));
