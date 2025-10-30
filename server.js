const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 🎮 ゲームの状態管理 ---
let players = {}; // 接続している全プレイヤーのデータを格納するオブジェクト
let nextPlayerId = 1; // プレイヤーに割り当てるID (P1, P2...)

// コース上の障害物（箱）やボーナスアイテムの位置を定義
const obstacles = [
    { type: 'box', x: 100, y: 0, z: -100, points: 5, width: 20, height: 20, depth: 20 },
    { type: 'box', x: -150, y: 0, z: -300, points: 5, width: 20, height: 20, depth: 20 },
    { type: 'bonus', x: 0, y: 0, z: -500, effect: 'speed_x2' } // 例：加速度2倍ボーナス
];
// ---

// publicフォルダ以下の静的ファイルを配信 [cite: 345]
app.use(express.static('public'));

/**
 * 簡易的な衝突判定関数 (プレイヤーと箱の衝突)
 * 実際にはより厳密な3D衝突判定が必要ですが、ここでは簡略化しています。
 */
function checkCollision(player, obs) {
    const distanceThreshold = 30; // 衝突とみなす距離
    const dist = Math.sqrt(
        Math.pow(player.x - obs.x, 2) + 
        Math.pow(player.z - obs.z, 2) // ゲームをXZ平面として扱う
    );
    return dist < distanceThreshold;
}

/**
 * リアルタイムでゲームロジックを更新する関数
 * センサーデータが届くたびに実行されます
 */
function updateGameLogic(clientId, data) {
    const player = players[clientId];
    if (!player) return;

    // --- センサーデータの処理 ---
    const beta = parseFloat(data.b); // 左右の傾き（Roll）
    const gamma = parseFloat(data.g); // 前後の傾き（Pitch）

    // devicemotionデータ（スマホの振り）が送信されている場合、ゲキトツ力をチャージ
    if (data.accelerationZ > 15) { // 加速度Z軸のしきい値は調整が必要
        player.gekitotsuForce = Math.min(player.gekitotsuForce + 1, 10); // 上限10でチャージ
    }

    // --- 速度と位置の更新 ---
    // 傾きを左右移動に利用
    const moveSpeed = 0.5;
    player.x += beta * moveSpeed; 
    
    // 基本速度とゲキトツ力による速度調整
    player.speed = 2 + (player.gekitotsuForce * 0.2); 
    player.z -= player.speed; // 前進

    // --- 衝突判定とロジック ---
    obstacles.forEach((obs, index) => {
        if (checkCollision(player, obs)) {
            // 衝突が発生した場合
            console.log(`${clientId} collided with ${obs.type} at ${index}`);
            
            // 衝突時のゲキトツ力による加速度上昇（ゲキトツ！の表現）
            player.speed += player.gekitotsuForce * 0.5;
            player.gekitotsuForce = 0; // ゲキトツ後は力をリセット

            if (obs.type === 'box') {
                player.points += obs.points; // ポイント加算
            } else if (obs.type === 'bonus' && obs.effect === 'speed_x2') {
                // ボーナス効果処理（例：一時的な速度倍増フラグをセット）
            }
            // 衝突した箱は消去するか、位置をリセットする処理
        }
    });

    // プレイヤー間の衝突判定（ここでは簡略化。詳細は実装フェーズで検討）
    for (const otherId in players) {
        if (otherId !== clientId) {
            const otherPlayer = players[otherId];
            // 衝突判定...
            // 衝突した場合、両者にゲキトツ力を加算
            // if (playerCollision) {
            //     player.gekitotsuForce += 2; 
            //     otherPlayer.gekitotsuForce += 2;
            // }
        }
    }

    // --- ラップと順位の更新ロジックをここに記述 ---
    // 例：Z座標が特定の値を通過したらラップ数を増やす
}


// --- Socket.io 接続処理 ---
io.on('connection', (socket) => {
    // 接続時に一意のクライアントIDを取得
    const clientId = socket.handshake.query.clientId || `P${nextPlayerId++}`;
    socket.clientId = clientId;
    console.log(`Client ${clientId} connected`);

    // 新規プレイヤーの初期化
    if (!players[clientId]) {
        players[clientId] = {
            id: clientId,
            x: 0, 
            y: 0, 
            z: 0, // 初期位置
            speed: 0,
            gekitotsuForce: 0,
            points: 0,
            lap: 0,
            status: 'connected'
        };
    }

    // 1. ルーム参加機能 (PC側が"game"ルームに参加) [cite: 482-485]
    socket.on('join', (room) => {
        socket.join(room);
        console.log(`Client ${clientId} joined room: ${room}`);

        // 参加したクライアントに現在の全プレイヤーデータを送信
        socket.emit('player data', players);

        // 他の全員に新しいプレイヤーが参加したことを通知
        socket.broadcast.emit('user joined', players[clientId]);
    });

    // 2. センサーデータ受信 (スマホから送信)
    socket.on('sensor', (data) => {
        // ゲームロジックを更新
        updateGameLogic(socket.clientId, data);
        
        // 更新された全プレイヤーデータと障害物データを 'game' ルームにいるPCに送信
        io.to('game').emit('game state', { 
            players: players, 
            obstacles: obstacles 
        });
    });

    // 3. 切断処理 [cite: 335-341]
    socket.on('disconnect', () => {
        console.log(`Client ${socket.clientId} disconnected`);
        
        // プレイヤーデータから削除
        delete players[socket.clientId];

        // 他のクライアントに切断を通知
        io.emit('user left', socket.clientId);
    });

});
// ---

// サーバーをポート8080で起動 [cite: 342-344]
server.listen(8080, () => {
    console.log('listening on *:8080');
});