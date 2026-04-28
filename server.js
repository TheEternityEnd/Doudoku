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

// Gestor de salas activas para la muerte súbita y revanchas
const salasActivas = {};

// SANEAMIENTO DE NOMBRES
function sanitizeName(name) {
    if (!name || typeof name !== 'string') return "Jugador";
    name = name.replace(/<[^>]*>?/gm, ''); 
    name = name.trim().substring(0, 15);
    return name || "Jugador";
}

// RATE LIMIT CHECK
function checkRateLimit(socket) {
    const now = Date.now();
    if (socket.lastMatchRequest && (now - socket.lastMatchRequest) < 3000) {
        return false; // rate limited
    }
    socket.lastMatchRequest = now;
    return true;
}

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
    fillBoard(solucion); 
    
    let puzzle = solucion.map(row => [...row]); 
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

    socket.on('buscarPartida', (nombreUsuario) => {
        if (!checkRateLimit(socket)) return;

        socket.nombreJugador = sanitizeName(nombreUsuario);

        if (jugadorEsperando !== null && jugadorEsperando.id !== socket.id) {
            const idSala = `sala_${jugadorEsperando.id}_${socket.id}`;
            
            jugadorEsperando.join(idSala);
            socket.join(idSala);
            
            socket.salaActual = idSala;
            jugadorEsperando.salaActual = idSala;

            const t1 = generarTableroCompleto();
            const t2 = generarTableroCompleto();

            salasActivas[idSala] = {
                isBotRoom: false,
                jugador1: jugadorEsperando.id,
                jugador2: socket.id,
                solucion1: t1.solucion,
                solucion2: t2.solucion,
                salud1: 150,
                salud2: 150,
                combo1: 0,
                combo2: 0,
                inicioTimestamp: Date.now(),
                intervaloMuerte: null,
                muerteSubita: false,
                revancha: {
                    [jugadorEsperando.id]: false,
                    [socket.id]: false
                }
            };

            jugadorEsperando.emit('partidaEncontrada', {
                jugador1: jugadorEsperando.nombreJugador,
                jugador2: socket.nombreJugador,
                tableroPropio: t1.puzzle,
                tableroRival: t2.puzzle
            });

            socket.emit('partidaEncontrada', {
                jugador1: socket.nombreJugador,
                jugador2: jugadorEsperando.nombreJugador,
                tableroPropio: t2.puzzle,
                tableroRival: t1.puzzle
            });

            console.log(`Partida iniciada: ${jugadorEsperando.nombreJugador} VS ${socket.nombreJugador}`);
            iniciarChequeoMuerteSubita(idSala);
            jugadorEsperando = null;
        } else {
            jugadorEsperando = socket;
            console.log(`${socket.nombreJugador} está esperando oponente...`);
        }
    });

    socket.on('cancelarBusqueda', () => {
        if (jugadorEsperando && jugadorEsperando.id === socket.id) {
            jugadorEsperando = null;
            console.log(`${socket.nombreJugador || 'Un usuario'} ha cancelado la búsqueda.`);
        }
    });

    // EVALUACIÓN DE MOVIMIENTOS EN EL SERVIDOR
    socket.on('enviarMovimiento', (datos) => {
        const salaID = socket.salaActual;
        if (!salaID || !salasActivas[salaID]) return;
        
        let sala = salasActivas[salaID];
        let val = parseInt(datos.valorIngresado);
        
        if (!sala.isBotRoom) {
            socket.to(salaID).emit('movimientoRival', { fila: datos.fila, columna: datos.columna, valor: datos.valorIngresado });
        }

        if (isNaN(val)) return; // Fue un borrado visual
        
        let esJugador1 = (sala.jugador1 === socket.id);
        
        if (sala.isBotRoom) {
            let solucion = sala.solucionJugador;
            if (val === solucion[datos.fila][datos.columna]) {
                sala.comboJugador++;
                let mult = sala.comboJugador >= 3 ? 1.5 : 1;
                let dano = Math.ceil(val * mult);
                let curacion = Math.ceil(val / 2);
                
                sala.saludJugador = Math.min(150, sala.saludJugador + curacion);
                sala.bot.salud = Math.max(0, sala.bot.salud - dano);
                
                socket.emit('movimientoCorrecto', { fila: datos.fila, columna: datos.columna, curacion, danoAlRival: dano });
                socket.emit('estadoActualizado', { miSalud: sala.saludJugador, saludRival: sala.bot.salud, combo: sala.comboJugador });
            } else {
                sala.comboJugador = 0;
                sala.saludJugador = Math.max(0, sala.saludJugador - 10);
                
                socket.emit('movimientoIncorrecto', { fila: datos.fila, columna: datos.columna });
                socket.emit('estadoActualizado', { miSalud: sala.saludJugador, saludRival: sala.bot.salud, combo: 0 });
            }
        } else {
            let solucion = esJugador1 ? sala.solucion1 : sala.solucion2;
            let miSaludKey = esJugador1 ? 'salud1' : 'salud2';
            let saludRivalKey = esJugador1 ? 'salud2' : 'salud1';
            let miComboKey = esJugador1 ? 'combo1' : 'combo2';

            if (val === solucion[datos.fila][datos.columna]) {
                sala[miComboKey]++;
                let mult = sala[miComboKey] >= 3 ? 1.5 : 1;
                let dano = Math.ceil(val * mult);
                let curacion = Math.ceil(val / 2);

                sala[miSaludKey] = Math.min(150, sala[miSaludKey] + curacion);
                sala[saludRivalKey] = Math.max(0, sala[saludRivalKey] - dano);

                socket.emit('movimientoCorrecto', { fila: datos.fila, columna: datos.columna, curacion, danoAlRival: dano });
                
                // Avisar al oponente que recibio ataque
                let sockRival = io.sockets.sockets.get(esJugador1 ? sala.jugador2 : sala.jugador1);
                if (sockRival) {
                    sockRival.emit('recibirAtaqueServidor', { cantidad: dano });
                }

                io.sockets.sockets.get(sala.jugador1)?.emit('estadoActualizado', { miSalud: sala.salud1, saludRival: sala.salud2, combo: sala.combo1 });
                io.sockets.sockets.get(sala.jugador2)?.emit('estadoActualizado', { miSalud: sala.salud2, saludRival: sala.salud1, combo: sala.combo2 });
            } else {
                sala[miComboKey] = 0;
                sala[miSaludKey] = Math.max(0, sala[miSaludKey] - 10);

                socket.emit('movimientoIncorrecto', { fila: datos.fila, columna: datos.columna });
                io.sockets.sockets.get(sala.jugador1)?.emit('estadoActualizado', { miSalud: sala.salud1, saludRival: sala.salud2, combo: sala.combo1 });
                io.sockets.sockets.get(sala.jugador2)?.emit('estadoActualizado', { miSalud: sala.salud2, saludRival: sala.salud1, combo: sala.combo2 });
            }
        }
    });

    socket.on('buscarPartidaBot', (dificultad) => {
        if (!checkRateLimit(socket)) return;
        socket.nombreJugador = sanitizeName(socket.nombreJugador);
        iniciarPartidaBot(socket, dificultad);
    });

    socket.on('pedirRevancha', () => {
        const salaID = socket.salaActual;
        if (socket.salaActual && salasActivas[socket.salaActual]) {
            let sala = salasActivas[socket.salaActual];
            if (sala.isBotRoom) {
               limpiarSala(socket.salaActual); 
               iniciarPartidaBot(socket, sala.dificultadBot, socket.salaActual);
               return;
            }

            salasActivas[salaID].revancha[socket.id] = true;
            let rivalId = salasActivas[salaID].jugador1 === socket.id ? salasActivas[salaID].jugador2 : salasActivas[salaID].jugador1;

            if (salasActivas[salaID].revancha[rivalId]) {
                limpiarSala(salaID);
                
                salasActivas[salaID] = {
                    isBotRoom: false,
                    jugador1: socket.id,
                    jugador2: rivalId,
                    salud1: 150,
                    salud2: 150,
                    combo1: 0,
                    combo2: 0,
                    inicioTimestamp: Date.now(),
                    intervaloMuerte: null,
                    muerteSubita: false,
                    revancha: {
                        [socket.id]: false,
                        [rivalId]: false
                    }
                };

                const sock1 = io.sockets.sockets.get(socket.id);
                const sock2 = io.sockets.sockets.get(rivalId);

                if (sock1 && sock2) {
                    const t1 = generarTableroCompleto();
                    const t2 = generarTableroCompleto();
                    
                    salasActivas[salaID].solucion1 = t1.solucion;
                    salasActivas[salaID].solucion2 = t2.solucion;

                    sock1.emit('partidaEncontrada', {
                        jugador1: sock1.nombreJugador,
                        jugador2: sock2.nombreJugador,
                        tableroPropio: t1.puzzle,
                        tableroRival: t2.puzzle
                    });

                    sock2.emit('partidaEncontrada', {
                        jugador1: sock2.nombreJugador,
                        jugador2: sock1.nombreJugador,
                        tableroPropio: t2.puzzle,
                        tableroRival: t1.puzzle
                    });

                    iniciarChequeoMuerteSubita(salaID);
                }
            }
        }
    });

    socket.on('disconnect', () => {
        if (jugadorEsperando && jugadorEsperando.id === socket.id) {
            jugadorEsperando = null;
        }
        if (socket.salaActual) {
            socket.to(socket.salaActual).emit('rivalDesconectado');
            socket.to(socket.salaActual).emit('revanchaRechazada');
            limpiarSala(socket.salaActual);
            socket.salaActual = null; 
        }
    });

    socket.on('abandonarPartida', () => {
        if (socket.salaActual) {
            socket.to(socket.salaActual).emit('rivalDesconectado');
            socket.to(socket.salaActual).emit('revanchaRechazada');
            limpiarSala(socket.salaActual);
            io.in(socket.salaActual).socketsLeave(socket.salaActual);
            socket.salaActual = null;
        }
    });
});

function iniciarChequeoMuerteSubita(salaID) {
    setTimeout(() => {
        if (salasActivas[salaID]) {
            salasActivas[salaID].muerteSubita = true;
            io.to(salaID).emit('muerteSubitaActivada');

            salasActivas[salaID].intervaloMuerte = setInterval(() => {
                if(salasActivas[salaID]) {
                   let sala = salasActivas[salaID];
                   if (sala.isBotRoom) {
                       sala.bot.salud = Math.max(0, sala.bot.salud - 1);
                       sala.saludJugador = Math.max(0, sala.saludJugador - 1);
                       let sock = io.sockets.sockets.get(sala.jugador1);
                       if (sock) {
                           sock.emit('recibirAtaqueServidor', { cantidad: 1, silencio: true });
                           sock.emit('estadoActualizado', { miSalud: sala.saludJugador, saludRival: sala.bot.salud, combo: sala.comboJugador });
                       }
                   } else {
                       sala.salud1 = Math.max(0, sala.salud1 - 1);
                       sala.salud2 = Math.max(0, sala.salud2 - 1);
                       
                       io.to(salaID).emit('recibirAtaqueServidor', { cantidad: 1, silencio: true });
                       io.sockets.sockets.get(sala.jugador1)?.emit('estadoActualizado', { miSalud: sala.salud1, saludRival: sala.salud2, combo: sala.combo1 });
                       io.sockets.sockets.get(sala.jugador2)?.emit('estadoActualizado', { miSalud: sala.salud2, saludRival: sala.salud1, combo: sala.combo2 });
                   }
                }
            }, 1000);
        }
    }, 180000); 
}

function limpiarSala(salaID) {
    if (salasActivas[salaID]) {
        if (salasActivas[salaID].intervaloMuerte) {
            clearInterval(salasActivas[salaID].intervaloMuerte);
        }
        if (salasActivas[salaID].isBotRoom && salasActivas[salaID].bot && salasActivas[salaID].bot.timer) {
            clearTimeout(salasActivas[salaID].bot.timer);
        }
        delete salasActivas[salaID];
    }
}

function iniciarPartidaBot(socket, dificultad, idSalaExistente) {
    const idSala = idSalaExistente || `sala_bot_${socket.id}`;
    if (!idSalaExistente) {
        socket.join(idSala);
        socket.salaActual = idSala;
    }

    const tPlayer = generarTableroCompleto();
    const tBot = generarTableroCompleto();

    let difLabel = dificultad === 'facil' ? 'Fácil' : (dificultad === 'medio' ? 'Medio' : 'Difícil');

    salasActivas[idSala] = {
        isBotRoom: true,
        dificultadBot: dificultad,
        jugador1: socket.id,
        saludJugador: 150,
        comboJugador: 0,
        solucionJugador: tPlayer.solucion,
        bot: {
            nombre: `IA (${difLabel})`,
            puzzle: tBot.puzzle,
            solucion: tBot.solucion,
            salud: 150,
            combo: 0,
            timer: null
        },
        inicioTimestamp: Date.now(),
        intervaloMuerte: null,
        muerteSubita: false
    };

    socket.emit('partidaEncontrada', {
        jugador1: socket.nombreJugador,
        jugador2: salasActivas[idSala].bot.nombre,
        tableroPropio: tPlayer.puzzle,
        tableroRival: tBot.puzzle
    });

    iniciarBotLoop(idSala, dificultad);
    iniciarChequeoMuerteSubita(idSala);
}

function iniciarBotLoop(salaID, dif) {
   let sala = salasActivas[salaID];
   if (!sala || !sala.isBotRoom) return;

   let delayMin, delayMax, errorRate;
   if (dif === 'facil') { delayMin = 7000; delayMax = 12000; errorRate = 0.3; }
   else if (dif === 'medio') { delayMin = 4000; delayMax = 8000; errorRate = 0.15; }
   else if (dif === 'dificil') { delayMin = 2000; delayMax = 4000; errorRate = 0.05; }

   function botTurn() {
      let s = salasActivas[salaID];
      if (!s || !s.isBotRoom || s.bot.salud <= 0) return;

      let emptySpots = [];
      for(let r=0; r<9; r++) {
         for(let c=0; c<9; c++) {
            if(s.bot.puzzle[r][c] === 0) emptySpots.push({r,c});
         }
      }

      if (emptySpots.length > 0) {
         let spot = emptySpots[Math.floor(Math.random() * emptySpots.length)];
         let isError = Math.random() < errorRate;
         let val = isError ? (Math.floor(Math.random() * 9) + 1) : s.bot.solucion[spot.r][spot.c];

         if (isError && val === s.bot.solucion[spot.r][spot.c]) {
            val = (val % 9) + 1;
         }

         let realPlayerSocket = io.sockets.sockets.get(s.jugador1);

         if (val === s.bot.solucion[spot.r][spot.c]) {
             s.bot.combo++;
             let multiplicador = s.bot.combo >= 3 ? 1.5 : 1;
             let dano = Math.ceil(val * multiplicador);
             let curacion = Math.ceil(val / 2);
             
             s.bot.salud = Math.min(150, s.bot.salud + curacion);
             s.saludJugador = Math.max(0, s.saludJugador - dano);
             s.bot.puzzle[spot.r][spot.c] = val; 
             
             if (realPlayerSocket) {
                 realPlayerSocket.emit('movimientoRival', { fila: spot.r, columna: spot.c, valor: val });
                 realPlayerSocket.emit('recibirAtaqueServidor', { cantidad: dano });
                 realPlayerSocket.emit('estadoActualizado', { miSalud: s.saludJugador, saludRival: s.bot.salud, combo: s.comboJugador });
             }
         } else {
             s.bot.combo = 0;
             s.bot.salud = Math.max(0, s.bot.salud - 10);
             
             if (realPlayerSocket) {
                 realPlayerSocket.emit('movimientoRival', { fila: spot.r, columna: spot.c, valor: val });
                 setTimeout(() => {
                     if (salasActivas[salaID] && salasActivas[salaID].bot && salasActivas[salaID].bot.puzzle[spot.r][spot.c] === 0) {
                        realPlayerSocket.emit('movimientoRival', { fila: spot.r, columna: spot.c, valor: '' });
                     }
                 }, 500);
                 
                 realPlayerSocket.emit('estadoActualizado', { miSalud: s.saludJugador, saludRival: s.bot.salud, combo: s.comboJugador });
             }
         }
      }

      if (s && s.bot && s.bot.salud > 0) {
          let nextDelay = Math.random() * (delayMax - delayMin) + delayMin;
          s.bot.timer = setTimeout(botTurn, nextDelay);
      }
   }

   let nextDelay = Math.random() * (delayMax - delayMin) + delayMin;
   sala.bot.timer = setTimeout(botTurn, nextDelay);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});