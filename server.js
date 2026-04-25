const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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
        if (!row) db.run(`INSERT INTO rooms (id, name, logo, isPrivate, password) VALUES ('lobby', 'Lobby 😸', '', 0, '')`);
    });
    db.get(`SELECT id FROM rooms WHERE id = 'arcade'`, (err, row) => {
        if (!row) db.run(`INSERT INTO rooms (id, name, logo, isPrivate, password) VALUES ('arcade', '🎮 The Arcade', 'https://api.dicebear.com/7.x/shapes/svg?seed=arcade&backgroundColor=53bdeb', 0, '')`);
    });
});

const activeUsersById = {}; 
function getUsersInRoom(roomId) { return Object.values(activeUsersById).filter(u => u.roomId === roomId).map(u => u.name); }
function broadcastRooms(targetSocket = io) { db.all(`SELECT id, name, logo, isPrivate FROM rooms`, (err, rows) => { if (rows) targetSocket.emit('room list', rows); }); }

async function fetchLinkPreview(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500); 
        const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'WhatsAppBot/1.0' } });
        clearTimeout(timeoutId);
        const text = await res.text();
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = text.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) || text.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
        const imgMatch = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
        if (titleMatch) return { title: titleMatch[1].trim(), desc: descMatch ? descMatch[1].trim() : '', img: imgMatch ? imgMatch[1].trim() : '', url: url };
    } catch (e) { } return null;
}

io.on('connection', (socket) => {
    broadcastRooms(socket);

    socket.on('create room', (data) => {
        const roomId = 'room_' + Date.now();
        const isPrivateInt = data.isPrivate ? 1 : 0;
        db.run(`INSERT INTO rooms (id, name, logo, isPrivate, password) VALUES (?, ?, ?, ?, ?)`, [roomId, data.name, '', isPrivateInt, data.password], (err) => { if (!err) broadcastRooms(); });
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
            db.run("INSERT OR REPLACE INTO users (name, avatar, about, isOnline, lastSeen, bubbleColor) VALUES (?, ?, ?, ?, ?, ?)", [data.user.name, data.user.avatar, data.user.about, 1, Date.now(), data.user.color || '#dcf8c6']);

            db.all("SELECT data FROM history WHERE roomId = ? ORDER BY timestamp ASC LIMIT 50", [room.id], (err, rows) => {
                const history = rows ? rows.map(row => JSON.parse(row.data)) : [];
                socket.emit('chat history', { room: { id: room.id, name: room.name, logo: room.logo, isPrivate: room.isPrivate === 1 }, history: history });
                socket.emit('pinned updated', room.pinnedMessage ? JSON.parse(room.pinnedMessage) : null);
                
                if (!data.isReconnect) {
                    const sysMsg = { id: Date.now().toString(), type: 'system', text: `🚀 ${data.user.name} joined the chat`, roomId: room.id };
                    io.to(room.id).emit('chat message', sysMsg);
                }
                io.to(room.id).emit('room users', getUsersInRoom(room.id));
            });
        });
    });

    socket.on('leave room', () => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if (roomId) {
            socket.leave(roomId);
            delete activeUsersById[socket.id].roomId;
            io.to(roomId).emit('room users', getUsersInRoom(roomId));
        }
    });

    socket.on('update profile', (user) => {
        if(activeUsersById[socket.id]) {
            activeUsersById[socket.id].name = user.name;
            activeUsersById[socket.id].avatar = user.avatar;
            activeUsersById[socket.id].about = user.about;
        }
        db.run("INSERT OR REPLACE INTO users (name, avatar, about, isOnline, lastSeen, bubbleColor) VALUES (?, ?, ?, ?, ?, ?)", [user.name, user.avatar, user.about, 1, Date.now(), user.color || '#dcf8c6']);
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

    socket.on('chat message', async (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(!roomId) return; 
        data.id = Date.now().toString() + Math.floor(Math.random() * 1000); 
        data.type = 'chat'; data.reactions = {}; data.status = 'delivered'; data.roomId = roomId;
        
        if (data.text) {
            const urls = data.text.match(/(https?:\/\/[^\s]+)/g);
            if (urls && urls.length > 0) {
                const preview = await fetchLinkPreview(urls[0]);
                if (preview) data.linkPreview = preview;
            }
        }
        
        if (!data.isGhost) db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [data.id, roomId, Date.now(), JSON.stringify(data)]);
        io.to(roomId).emit('chat message', data);
        socket.broadcast.emit('global room alert', roomId);
    });

    // 🌟 THE NEW MASTER GAME ENGINE
    socket.on('create game session', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        const hostName = activeUsersById[socket.id]?.name;
        if(!roomId || !hostName) return;

        const gameMsg = {
            id: Date.now().toString(), type: 'game_session', roomId: roomId, 
            user: hostName, avatar: activeUsersById[socket.id].avatar,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            gameType: data.gameType, // 'tictactoe' or 'dice'
            state: 'waiting', // waiting, playing, finished
            players: [hostName], 
            gameState: {}, 
            status: 'delivered', reactions: {}
        };

        db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [gameMsg.id, roomId, Date.now(), JSON.stringify(gameMsg)]);
        io.to(roomId).emit('chat message', gameMsg);
    });

    socket.on('game action', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        const playerName = activeUsersById[socket.id]?.name;
        if(!roomId || !playerName) return;

        db.get("SELECT data FROM history WHERE id = ?", [data.msgId], (err, row) => {
            if(row) {
                const msg = JSON.parse(row.data);
                if(msg.type !== 'game_session') return;

                if (data.action === 'join') {
                    if (msg.state === 'waiting' && !msg.players.includes(playerName)) {
                        if (msg.gameType === 'tictactoe' && msg.players.length >= 2) return; // Full
                        msg.players.push(playerName);
                    }
                } 
                else if (data.action === 'start') {
                    if (msg.user === playerName && msg.players.length >= (msg.gameType === 'tictactoe' ? 2 : 1)) {
                        msg.state = 'playing';
                        if (msg.gameType === 'tictactoe') {
                            msg.gameState = { board: ['','','','','','','','',''], turn: msg.players[0], winner: null };
                        } else if (msg.gameType === 'dice') {
                            msg.gameState = { rolls: {}, winner: null };
                        }
                    }
                }
                else if (data.action === 'move' && msg.state === 'playing') {
                    if (!msg.players.includes(playerName)) return;

                    if (msg.gameType === 'tictactoe' && !msg.gameState.winner) {
                        if (msg.gameState.turn !== playerName) return;
                        if (msg.gameState.board[data.payload.index] === '') {
                            msg.gameState.board[data.payload.index] = msg.gameState.turn;
                            
                            const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
                            for(let line of lines) {
                                const [a,b,c] = line;
                                if(msg.gameState.board[a] && msg.gameState.board[a] === msg.gameState.board[b] && msg.gameState.board[a] === msg.gameState.board[c]) {
                                    msg.gameState.winner = playerName; msg.state = 'finished'; break;
                                }
                            }
                            if(!msg.gameState.winner && !msg.gameState.board.includes('')) {
                                msg.gameState.winner = 'Draw'; msg.state = 'finished';
                            }
                            if(!msg.gameState.winner) {
                                msg.gameState.turn = msg.gameState.turn === msg.players[0] ? msg.players[1] : msg.players[0];
                            }
                        }
                    } 
                    else if (msg.gameType === 'dice' && !msg.gameState.winner) {
                        if (!msg.gameState.rolls[playerName]) {
                            msg.gameState.rolls[playerName] = Math.floor(Math.random() * 6) + 1; // Roll 1-6
                            
                            // Check if everyone rolled
                            if (Object.keys(msg.gameState.rolls).length === msg.players.length) {
                                let highestScore = 0;
                                let winners = [];
                                for (const [p, score] of Object.entries(msg.gameState.rolls)) {
                                    if (score > highestScore) { highestScore = score; winners = [p]; }
                                    else if (score === highestScore) { winners.push(p); }
                                }
                                msg.gameState.winner = winners.length > 1 ? "It's a Tie!" : winners[0];
                                msg.state = 'finished';
                            }
                        }
                    }
                }

                db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                io.to(roomId).emit('game updated', msg);
            }
        });
    });

    socket.on('vote poll', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        const voterName = activeUsersById[socket.id]?.name;
        if(!roomId || !voterName) return;
        db.get("SELECT data FROM history WHERE id = ?", [data.msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data);
                if (msg.poll) {
                    msg.poll.options.forEach(opt => {
                        const index = opt.votes.indexOf(voterName);
                        if (index > -1) opt.votes.splice(index, 1);
                    });
                    msg.poll.options[data.optionIndex].votes.push(voterName);
                    db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                    io.to(roomId).emit('poll updated', msg);
                }
            }
        });
    });

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

    socket.on('react message', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        const playerName = activeUsersById[socket.id]?.name;
        if(!roomId || !playerName) return;
        db.get("SELECT data FROM history WHERE id = ?", [data.msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data); 
                msg.reactions = msg.reactions || {};
                
                // Remove player's old reaction if they click a new one
                for (let e in msg.reactions) {
                    msg.reactions[e] = msg.reactions[e].filter(name => name !== playerName);
                    if (msg.reactions[e].length === 0) delete msg.reactions[e];
                }
                
                // Add new reaction
                msg.reactions[data.emoji] = msg.reactions[data.emoji] || [];
                msg.reactions[data.emoji].push(playerName);
                
                db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                io.to(roomId).emit('update reactions', { id: data.msgId, reactions: msg.reactions });
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
