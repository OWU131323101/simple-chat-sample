const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path'); // ファイルパス操作のためにpathモジュールを追加

// ----------------------------------------------------------------------
// 1. 静的ファイルの設定
// ----------------------------------------------------------------------

// サーバーのルートディレクトリを静的ファイル提供元とします
// これにより、bowling_game_simple.html や bowling_controller.html が読み込まれます
app.use(express.static(path.join(__dirname))); 

// ルートパス ('/') へのアクセスで案内ページ (sample.html) を返す
app.get('/', (req, res) => {
    // 最初にアクセスするページとしてsample.htmlを提供します
    res.sendFile(path.join(__dirname, 'sample.html'));
});

// /bowling_game_simple.html へのアクセスでゲーム本体を返す (既存の静的ファイル提供で処理されるが明示的に定義)
app.get('/bowling_game_simple.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'bowling_game_simple.html'));
});

// /controller へのアクセスでコントローラーを返す (スマホ用)
app.get('/controller', (req, res) => {
    res.sendFile(path.join(__dirname, 'bowling_controller.html'));
});


// ----------------------------------------------------------------------
// 2. Socket.io 接続とイベントハンドリング (元の構造を維持)
// ----------------------------------------------------------------------

io.on('connection', (socket) => {
  // Chat functionality (元のコードの原型を維持)
  socket.on('user connected', (clientId) => {
    socket.clientId = clientId;
    console.log(clientId + ' connected');
    socket.emit('welcome', clientId);
    socket.broadcast.emit('user joined', clientId);
  });

  socket.on('chat message', (msg) => {
    // ボーリングゲームでは未使用だが、原型維持のため残す
    io.emit('chat message', msg);
  });
  
  // Room functionality (センサーアプリとゲーム本体の接続に使用)
  socket.on('join', (room) => {
    socket.join(room);
    console.log(`Client ${socket.id} joined room: ${room}`);
  });
  
  // Sensor data handling (ボーリングゲームの核となる中継機能)
  socket.on('sensor', (data) => {
    // センサーデータを 'game' ルームにいる他のクライアント（ゲーム本体）に送信する
    // データには { id, b, g, ... } が含まれる
    socket.to('game').emit('sensor', data);
  });

  socket.on('disconnect', () => {
    if (socket.clientId) {
      console.log(socket.clientId + ' disconnected');
      io.emit('user left', socket.clientId);
    } else {
      console.log('Client disconnected');
    }
  });
});

// ----------------------------------------------------------------------
// 3. サーバーの起動
// ----------------------------------------------------------------------

server.listen(8080, () => {
  console.log('listening on *:8080. Access http://localhost:8080');
});

