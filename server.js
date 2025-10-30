const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- ⚙️ ゲーム定数 (パラメータ) ---
const MAX_LAP = 2; // レースの周回数 (FirstRap, FinalRap)
const COURSE_LENGTH_Z = 1000; // コースの長さ (Z座標の絶対値)
const TRACK_WIDTH_X = 250; // コースの左右の幅 (±250)
const GEKITOTSU_CHARGE_MAX = 10; // ゲキトツ力の最大値
const ACCEL_Z_THRESHOLD = 20; // ゲキトツ力チャージに必要な加速度Zの閾値 (G単位)
const PLAYER_COLLISION_RADIUS = 40; // プレイヤー間の衝突半径

// --- 🎮 ゲームの状態管理 ---
let players = {}; // 接続している全プレイヤーのデータを格納するオブジェクト
let nextPlayerId = 1; // プレイヤーに割り当てるID (P1, P2...)

// コース上の障害物（箱）やボーナスアイテムの位置を定義
const obstacles = [
    // type: 'box', x: 左右位置, z: 奥行き位置, points: 獲得ポイント, size: 箱の一辺
    { type: 'box', x: 100, y: 0, z: -100, points: 5, size: 30 },
    { type: 'box', x: -150, y: 0, z: -350, points: 5, size: 30 },
    { type: 'box', x: 50, y: 0, z: -600, points: 5, size: 30 },
    { type: 'box', x: -200, y: 0, z: -850, points: 5, size: 30 },
    // type: 'bonus', effect: 'speed_x2' (加速度2倍)
    { type: 'bonus', x: 0, y: 0, z: -500, effect: 'speed_x2', size: 20 }
];
// ---

// publicフォルダ以下の静的ファイルを配信
app.use(express.static('public'));

/**
 * プレイヤー間の距離を計算
 */
function getDistance(p1, p2) {
    return Math.sqrt(
        Math.pow(p1.x - p2.x, 2) +
        Math.pow(p1.z - p2.z, 2)
    );
}

/**
 * 簡易的な衝突判定関数 (プレイヤーと箱の衝突)
 */
function checkCollision(player, obs) {
    // 衝突とみなす距離をプレイヤーサイズと障害物サイズの平均から設定
    const distanceThreshold = 25 + (obs.size / 2); 
    const dist = getDistance(player, obs);
    return dist < distanceThreshold;
}

/**
 * リアルタイムでゲームロジックを更新する関数
 */
function updateGameLogic(clientId, data) {
    const player = players[clientId];
    if (!player || player.status !== 'playing') return;

    // --- センサーデータの処理 ---
    const beta = parseFloat(data.b) || 0; // 左右の傾き（Roll）
    // const gamma = parseFloat(data.g) || 0; // 前後の傾き（Pitch）

    // devicemotionデータ（スマホの振り）が送信されている場合、ゲキトツ力をチャージ
    const currentAccelZ = Math.abs(parseFloat(data.accelerationZ) || 0);

    if (currentAccelZ > ACCEL_Z_THRESHOLD) { 
        player.gekitotsuForce = Math.min(player.gekitotsuForce + 2, GEKITOTSU_CHARGE_MAX); // 2ポイントチャージ
    }

    // --- 速度と位置の更新 ---
    const moveSpeed = 1.0; // 左右移動速度を上げる
    const maxSpeed = 5;
    
    // 左右の傾きに応じたX座標の更新 (減衰をかける)
    player.x += beta * moveSpeed * 0.1;
    // X座標のコース幅制限
    player.x = Math.max(-TRACK_WIDTH_X, Math.min(TRACK_WIDTH_X, player.x));
    
    // 基本速度とゲキトツ力による速度調整
    player.baseSpeed = 3; // 基本前進速度
    if (player.effects.speed_x2_active) {
        player.speed = player.baseSpeed * 2; // ボーナス適用時
    } else {
        player.speed = player.baseSpeed + (player.gekitotsuForce * 0.2);
    }
    
    player.z -= player.speed; // 前進（Z座標を減らす）

    // --- 衝突判定とロジック ---
    obstacles.forEach((obs, index) => {
        if (checkCollision(player, obs)) {
            // 衝突が発生した場合、障害物を一時的に無効化
            if (obs.collided === true) return;
            obs.collided = true; 
            
            console.log(`${clientId} collided with ${obs.type} at ${index}`);
            
            // 衝突時のゲキトツ力による速度上昇（ゲキトツ！）
            player.speed += player.gekitotsuForce * 0.7; // ゲキトツ力が高いほど加速
            player.gekitotsuForce = 0; // ゲキトツ後は力をリセット

            if (obs.type === 'box') {
                player.points += obs.points; // ポイント加算
                // 箱は一定時間後に復活
                setTimeout(() => { obs.collided = false; }, 3000); 
            } else if (obs.type === 'bonus' && obs.effect === 'speed_x2') {
                // 加速度2倍ボーナス処理
                player.effects.speed_x2_active = true;
                player.points += 20;
                // 5秒後にボーナス効果終了
                setTimeout(() => { player.effects.speed_x2_active = false; }, 5000);
            }
        }
    });

    // --- マルチプレイ専用: プレイヤー間の衝突判定 ---
    if (player.mode === 'multi') {
        for (const otherId in players) {
            const otherPlayer = players[otherId];
            // 自身ではない、かつ、相手もマルチプレイ中でプレイ中の場合
            if (otherId !== clientId && otherPlayer.mode === 'multi' && otherPlayer.status === 'playing') {
                if (getDistance(player, otherPlayer) < PLAYER_COLLISION_RADIUS) {
                    console.log(`${clientId} clashed with ${otherId}`);
                    // ゲキトツ力加算
                    player.gekitotsuForce = Math.min(player.gekitotsuForce + 2, GEKITOTSU_CHARGE_MAX);
                    otherPlayer.gekitotsuForce = Math.min(otherPlayer.gekitotsuForce + 2, GEKITOTSU_CHARGE_MAX);
                    
                    // 衝突時の速度低下ペナルティ
                    player.speed = Math.max(1, player.speed * 0.8);
                }
            }
        }
    }
    
    // --- ラップ判定 ---
    // コース終端（Z < -COURSE_LENGTH_Z）に到達したら、ラップ数が増え、Z座標がリセットされる
    if (player.z < -COURSE_LENGTH_Z) {
        player.lap++;
        player.z += COURSE_LENGTH_Z; // Z座標をコースの始点に戻す
        
        if (player.lap >= MAX_LAP) {
            player.status = 'finished';
            player.finishTime = Date.now(); // ゴールタイムを記録
            console.log(`${clientId} finished the race.`);
        }
    }
    
    // 常にプレイヤーデータを最新に保つ
    players[clientId] = player;
}

/**
 * ランキング計算関数 (全員がゴールした、またはゲームが終了した場合に計算)
 */
function calculateRanking() {
    // プレイ中のプレイヤーのみを対象とする
    const activePlayers = Object.values(players).filter(p => p.mode === 'multi' && p.status !== 'lobby');

    // 順位付けロジック：
    // 1. finishTimeがある（ゴール済み）プレイヤーを優先し、早い順
    // 2. ゴールしていないプレイヤーは、ラップ数が多い順
    // 3. ラップ数が同じ場合は、Z座標（より奥に進んでいるか）が大きい順
    activePlayers.sort((a, b) => {
        if (a.status === 'finished' && b.status !== 'finished') return -1;
        if (a.status !== 'finished' && b.status === 'finished') return 1;
        if (a.status === 'finished' && b.status === 'finished') return a.finishTime - b.finishTime; // ゴールタイムが早い順
        
        if (a.lap !== b.lap) return b.lap - a.lap; // ラップ数が多い順
        return a.z - b.z; // Z座標（前進距離）が大きい順 (Zがマイナスなので、小さい方が奥)
    });

    // 順位ポイントの計算と総合ポイントの更新（暫定）
    activePlayers.forEach((player, index) => {
        const rankPoint = (activePlayers.length - index) * 100; // 1位が高ポイント
        player.finalRank = index + 1;
        player.totalPoints = player.points + rankPoint;
    });

    return activePlayers;
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
            x: 0, y: 0, z: 0, // Z: 0がスタートライン
            speed: 0,
            baseSpeed: 3,
            gekitotsuForce: 0,
            points: 0,
            lap: 0,
            status: 'lobby', 
            mode: null,
            effects: { speed_x2_active: false },
            finishTime: null,
            totalPoints: 0
        };
    }

    // 1. ルーム参加とモード選択機能 ('join_game' イベント)
    socket.on('join_game', (data) => {
        const { room, mode } = data; // モード情報
        
        socket.join(room);
        console.log(`Client ${clientId} joined room: ${room} as ${mode}`);

        // プレイヤーの状態を更新し、初期位置に戻す
        players[clientId].status = 'playing';
        players[clientId].mode = mode;
        players[clientId].z = 0; 
        players[clientId].lap = 0;
        players[clientId].points = 0;
        players[clientId].gekitotsuForce = 0;
        players[clientId].finishTime = null;
        
        // 全クライアントにゲームの状態をブロードキャスト
        io.to(room).emit('game state', { 
            players: players, 
            obstacles: obstacles,
            maxLap: MAX_LAP
        });
    });

    // 2. センサーデータ受信 (スマホから送信)
    socket.on('sensor', (data) => {
        // 'playing' 状態のプレイヤーのみ更新を許可
        if (players[clientId] && players[clientId].status === 'playing') {
            updateGameLogic(socket.clientId, data);
            
            // 更新された全プレイヤーデータと障害物データを 'game' ルームにいるPCに送信
            io.to('game').emit('game state', { 
                players: players, 
                obstacles: obstacles,
                maxLap: MAX_LAP
            });
        }
    });

    // 3. 切断処理
    socket.on('disconnect', () => {
        console.log(`Client ${socket.clientId} disconnected`);
        
        // プレイヤーデータから削除
        delete players[socket.clientId];

        // 他のクライアントに切断を通知
        io.emit('user left', socket.clientId);
    });
});

// ---

// サーバーをポート8080で起動
server.listen(8080, () => {
    console.log('listening on *:8080');
});
