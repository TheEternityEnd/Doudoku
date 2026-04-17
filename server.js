// Importaciones necesarias
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Configuración inicial del servidor
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos estáticos (HTML, CSS, JS)
app.use(express.static(__dirname));

// Cola de espera para el matchmaking
let jugadorEsperando = null;

// --- LÓGICA DE SUDOKU (Ahora en el backend) ---
function createEmptyBoard() {
    return Array.from({ length: 9 }, () => Array(9).fill(0));
}

function isValid(board, row, col, num) {
    for (let x = 0; x < 9; x++) {
        if (board[row][x] === num || board[x][col] === num) return false;
    }
    let startRow = row - (row % 3);
    let startCol = col - (col % 3);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            if (board[i + startRow][j + startCol] === num) return false;
        }
    }
    return true;
}

function fillBoard(board) {
    for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
            if (board[i][j] === 0) {
                let nums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
                nums.sort(() => Math.random() - 0.5);
                for (let num of nums) {
                    if (isValid(board, i, j, num)) {
                        board[i][j] = num;
                        if (fillBoard(board)) return true;
                        board[i][j] = 0;
                    }
                }
                return false;
            }
        }
    }
    return true;
}

function generarTableroCompleto() {
    let solucion = createEmptyBoard();
    fillBoard(solucion); // Genera tablero resuelto
    
    let puzzle = solucion.map(row => [...row]); // Copia la solución
    let cellsToRemove = 45;
    while (cellsToRemove > 0) {
        let row = Math.floor(Math.random() * 9);
        let col = Math.floor(Math.random() * 9);
        if (puzzle[row][col] !== 0) {
            puzzle[row][col] = 0;
            cellsToRemove--;
        }
    }
    return { puzzle, solucion };
}

// --- LÓGICA DE MULTIJUGADOR Y SOCKETS ---
io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    // MATCHMAKING: Un jugador busca partida
    socket.on('buscarPartida', (nombreUsuario) => {
        socket.nombreJugador = nombreUsuario;

        // Si ya hay alguien esperando, los emparejamos
        if (jugadorEsperando !== null && jugadorEsperando.id !== socket.id) {
            const idSala = `sala_${jugadorEsperando.id}_${socket.id}`;
            
            jugadorEsperando.join(idSala);
            socket.join(idSala);
            
            socket.salaActual = idSala;
            jugadorEsperando.salaActual = idSala;

            // Generamos DOS tableros distintos
            const t1 = generarTableroCompleto();
            const t2 = generarTableroCompleto();

            // NUEVO: Le enviamos a cada jugador SU propio tablero directamente
            // Al jugador 1 le enviamos su tablero y el del rival
            jugadorEsperando.emit('partidaEncontrada', {
                jugador1: jugadorEsperando.nombreJugador,
                jugador2: socket.nombreJugador,
                tableroPropio: t1.puzzle,
                solucionPropia: t1.solucion,
                tableroRival: t2.puzzle
            });

            // Al jugador 2 le enviamos su tablero y el del rival invertidos
            socket.emit('partidaEncontrada', {
                jugador1: socket.nombreJugador,
                jugador2: jugadorEsperando.nombreJugador,
                tableroPropio: t2.puzzle,
                solucionPropia: t2.solucion,
                tableroRival: t1.puzzle
            });

            console.log(`Partida iniciada (Modo Carrera): ${jugadorEsperando.nombreJugador} VS ${socket.nombreJugador}`);
            
            // Limpiamos la cola de espera
            jugadorEsperando = null;
        } else {
            // Si no hay nadie, este jugador se queda en espera
            jugadorEsperando = socket;
            console.log(`${nombreUsuario} está esperando oponente...`);
        }
    });

    // SINCRONIZACIÓN DE JUEGO: Un jugador ingresó un número
    socket.on('movimiento', (datos) => {
        if (socket.salaActual) {
            // Reenviamos el movimiento SOLO al oponente en la misma sala
            socket.to(socket.salaActual).emit('movimientoRival', datos);
        }
    });

    // DESCONEXIÓN
    socket.on('disconnect', () => {
        if (jugadorEsperando && jugadorEsperando.id === socket.id) {
            jugadorEsperando = null;
        }
        if (socket.salaActual) {
            socket.to(socket.salaActual).emit('rivalDesconectado');
            socket.salaActual = null; // Limpieza preventiva
        }
        console.log('Usuario desconectado:', socket.id);
    });

    socket.on('abandonarPartida', () => {
        if (socket.salaActual) {
            // Avisamos al rival que está en la misma sala
            socket.to(socket.salaActual).emit('rivalDesconectado');
            
            // Hacemos que todos los sockets abandonen esta sala de Socket.io
            io.in(socket.salaActual).socketsLeave(socket.salaActual);
            
            // Limpiamos la variable de la sala en este socket
            socket.salaActual = null;
        }
    });

    socket.on('actualizarSalud', (puntos) => {
        if (socket.salaActual) {
            socket.to(socket.salaActual).emit('saludRivalActualizada', puntos);
        }
    });
    
    // El servidor recibe la notificación de un acierto
    socket.on('jugadorAcerto', (datos) => {
        if (socket.salaActual) {
            // 1. Enviamos el daño al oponente
            socket.to(socket.salaActual).emit('recibirAtaque', { 
                cantidad: datos.valorDano 
            });
            
            // 2. Sincronizamos la curación del jugador en la mini-barra del oponente
            socket.to(socket.salaActual).emit('saludRivalActualizada', datos.saludActualizada);
        }
    });
});

// Iniciar el servidor
const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => {
    console.log(`Servidor de Sudoku corriendo en http://localhost:${PUERTO}`);
});