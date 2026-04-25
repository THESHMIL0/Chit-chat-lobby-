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
    db.run(`CREATE TABLE IF NOT EXISTS stats (name TEXT PRIMARY KEY, ttt_wins INTEGER DEFAULT 0, dice_highest INTEGER DEFAULT 0, draw_wins INTEGER DEFAULT 0)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_history_roomId_time ON history(roomId, timestamp)`);
    
    db.get(`SELECT id FROM rooms WHERE id = 'lobby'`, (err, row) => {
        if (!row) db.run(`INSERT INTO rooms (id, name, logo, isPrivate, password) VALUES ('lobby', 'Lobby 😸', '', 0, '')`);
    });
    db.get(`SELECT id FROM rooms WHERE id = 'arcade'`, (err, row) => {
        if (!row) db.run(`INSERT INTO rooms (id, name, logo, isPrivate, password) VALUES ('arcade', '🎮 The Arcade', 'https://api.dicebear.com/7.x/shapes/svg?seed=arcade&backgroundColor=53bdeb', 0, '')`);
    });
});

const activeUsersById = {}; 
const activeDrawGames = {};

const DRAW_WORDS = ['cat', 'dog', 'sun', 'house', 'tree', 'car', 'apple', 'pizza', 'robot', 'ghost', 'spider', 'flower', 'fish', 'bird', 'moon'];

function getUsersInRoom(roomId) { return Object.values(activeUsersById).filter(u => u.roomId === roomId).map(u => u.name); }
function broadcastRooms(targetSocket = io) { db.all(`SELECT id, name, logo, isPrivate FROM rooms`, (err, rows) => { if (rows) targetSocket.emit('room list', rows); }); }

function updateLeaderboard(name, game, value) {
    db.get("SELECT * FROM stats WHERE name = ?", [name], (err, row) => {
        if (!row) {
            db.run("INSERT INTO stats (name, ttt_wins, dice_highest, draw_wins) VALUES (?, ?, ?, ?)", [name, game==='ttt'?1:0, game==='dice'?value:0, game==='draw'?1:0]);
        } else {
            if (game === 'ttt') db.run("UPDATE stats SET ttt_wins = ttt_wins + 1 WHERE name = ?", [name]);
            if (game === 'draw') db.run("UPDATE stats SET draw_wins = draw_wins + 1 WHERE name = ?", [name]);
            if (game === 'dice') db.run("UPDATE stats SET dice_highest = MAX(dice_highest, ?) WHERE name = ?", [value, name]);
        }
    });
}

async function fetchLinkPreview(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500); 
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        const text = await res.text();
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) return { title: titleMatch[1].trim(), url: url };
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

    socket.on('get leaderboard', () => {
        db.all("SELECT name, ttt_wins FROM stats WHERE ttt_wins > 0 ORDER BY ttt_wins DESC LIMIT 5", (err, ttt) => {
            db.all("SELECT name, dice_highest FROM stats WHERE dice_highest > 0 ORDER BY dice_highest DESC LIMIT 5", (err, dice) => {
                db.all("SELECT name, draw_wins FROM stats WHERE draw_wins > 0 ORDER BY draw_wins DESC LIMIT 5", (err, draw) => {
                    socket.emit('leaderboard data', { ttt: ttt||[], dice: dice||[], draw: draw||[] });
                });
            });
        });
    });

    socket.on('chat message', async (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        const playerName = activeUsersById[socket.id]?.name;
        if(!roomId || !playerName) return; 

        const liveDraw = activeDrawGames[roomId];
        if (liveDraw && liveDraw.isActive && data.text && data.text.toLowerCase().trim() === liveDraw.word) {
            liveDraw.isActive = false; 
            
            db.get("SELECT data FROM history WHERE id = ?", [liveDraw.msgId], (err, row) => {
                if(row) {
                    const msg = JSON.parse(row.data);
                    msg.winner = playerName;
                    msg.state = 'finished';
                    db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), liveDraw.msgId]);
                    io.to(roomId).emit('game updated', msg);
                    
                    updateLeaderboard(playerName, 'draw', 1);

                    const sysMsg = { id: Date.now().toString(), type: 'system', text: `🎉 ${playerName} guessed the word: ${liveDraw.word.toUpperCase()}!`, roomId };
                    io.to(roomId).emit('chat message', sysMsg);
                    db.run("INSERT INTO history (id, roomId, timestamp, data) VALUES (?, ?, ?, ?)", [sysMsg.id, roomId, Date.now(), JSON.stringify(sysMsg)]);
                }
            });
            return; 
        }

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

    socket.on('create game session', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        const hostName = activeUsersById[socket.id]?.name;
        if(!roomId || !hostName) return;

        const gameMsg = {
            id: Date.now().toString(), type: 'game_session', roomId: roomId, 
            user: hostName, avatar: activeUsersById[socket.id].avatar,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            gameType: data.gameType, state: 'waiting', players: [hostName], gameState: {}, status: 'delivered', reactions: {}
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
                        if (msg.gameType === 'tictactoe' && msg.players.length >= 2) return; 
                        msg.players.push(playerName);
                    }
                } 
                else if (data.action === 'start') {
                    if (msg.user === playerName && msg.players.length >= (msg.gameType === 'tictactoe' ? 2 : (msg.gameType === 'draw' ? 2 : 1))) {
                        msg.state = 'playing';
                        if (msg.gameType === 'tictactoe') {
                            msg.gameState = { board: ['','','','','','','','',''], turn: msg.players[0], winner: null };
                        } else if (msg.gameType === 'dice') {
                            msg.gameState = { rolls: {}, winner: null };
                        } else if (msg.gameType === 'draw') {
                            const word = DRAW_WORDS[Math.floor(Math.random() * DRAW_WORDS.length)];
                            msg.gameState = { word: word, drawingImage: null };
                            activeDrawGames[roomId] = { msgId: msg.id, word: word, host: msg.user, isActive: true };
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
                                    msg.gameState.winner = playerName; msg.state = 'finished'; 
                                    updateLeaderboard(playerName, 'ttt', 1);
                                    break;
                                }
                            }
                            if(!msg.gameState.winner && !msg.gameState.board.includes('')) { msg.gameState.winner = 'Draw'; msg.state = 'finished'; }
                            if(!msg.gameState.winner) { msg.gameState.turn = msg.gameState.turn === msg.players[0] ? msg.players[1] : msg.players[0]; }
                        }
                    } 
                    else if (msg.gameType === 'dice' && !msg.gameState.winner) {
                        if (!msg.gameState.rolls[playerName]) {
                            msg.gameState.rolls[playerName] = Math.floor(Math.random() * 100) + 1; 
                            
                            if (Object.keys(msg.gameState.rolls).length === msg.players.length) {
                                let highestScore = 0; let winners = [];
                                for (const [p, score] of Object.entries(msg.gameState.rolls)) {
                                    if (score > highestScore) { highestScore = score; winners = [p]; }
                                    else if (score === highestScore) { winners.push(p); }
                                }
                                msg.gameState.winner = winners.length > 1 ? "It's a Tie!" : winners[0];
                                msg.state = 'finished';
                                if (winners.length === 1) updateLeaderboard(winners[0], 'dice', highestScore);
                            }
                        }
                    }
                }

                db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                io.to(roomId).emit('game updated', msg);
            }
        });
    });

    socket.on('draw stroke', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        if(roomId) socket.to(roomId).emit('draw stroke', data); 
    });
    
    socket.on('save drawing', (data) => {
        db.get("SELECT data FROM history WHERE id = ?", [data.msgId], (err, row) => {
            if(row) {
                const msg = JSON.parse(row.data);
                if (msg.gameType === 'draw' && msg.state === 'playing') {
                    msg.gameState.drawingImage = data.image;
                    db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                }
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

    socket.on('react message', (data) => {
        const roomId = activeUsersById[socket.id]?.roomId;
        const playerName = activeUsersById[socket.id]?.name;
        if(!roomId || !playerName) return;
        db.get("SELECT data FROM history WHERE id = ?", [data.msgId], (err, row) => {
            if (row) {
                const msg = JSON.parse(row.data); 
                msg.reactions = msg.reactions || {};
                for (let e in msg.reactions) {
                    msg.reactions[e] = msg.reactions[e].filter(name => name !== playerName);
                    if (msg.reactions[e].length === 0) delete msg.reactions[e];
                }
                msg.reactions[data.emoji] = msg.reactions[data.emoji] || [];
                msg.reactions[data.emoji].push(playerName);
                db.run("UPDATE history SET data = ? WHERE id = ?", [JSON.stringify(msg), data.msgId]);
                io.to(roomId).emit('update reactions', { id: data.msgId, reactions: msg.reactions });
            }
        });
    });

    socket.on('mark read', () => { /* Logic hidden to keep clean */ });
    socket.on('delete message', (msgId) => { db.run("DELETE FROM history WHERE id = ?", [msgId]); });
    socket.on('disconnect', () => {
        const userData = activeUsersById[socket.id];
        if (userData) {
            db.run(`UPDATE users SET isOnline = 0, lastSeen = ? WHERE name = ?`, [Date.now(), userData.name]);
            if (userData.roomId) {
                delete activeUsersById[socket.id];
                io.to(userData.roomId).emit('room users', getUsersInRoom(userData.roomId));
            }
        }
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server running!'));
