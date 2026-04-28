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
            
            // Registro para revanchas y muerte súbita
            salasActivas[idSala] = {
                jugador1: jugadorEsperando.id,
                jugador2: socket.id,
                inicioTimestamp: Date.now(),
                intervaloMuerte: null,
                muerteSubita: false,
                revancha: {
                    [jugadorEsperando.id]: false,
                    [socket.id]: false
                }
            };

            iniciarChequeoMuerteSubita(idSala);

            // Limpiamos la cola de espera
            jugadorEsperando = null;
        } else {
            // Si no hay nadie, este jugador se queda en espera
            jugadorEsperando = socket;
            console.log(`${nombreUsuario} está esperando oponente...`);
        }
    });

    socket.on('cancelarBusqueda', () => {
        if (jugadorEsperando && jugadorEsperando.id === socket.id) {
            jugadorEsperando = null;
            console.log(`${socket.nombreJugador || 'Un usuario'} ha cancelado la búsqueda.`);
        }
    });

    // SINCRONIZACIÓN DE JUEGO: Un jugador ingresó un número
    socket.on('movimiento', (datos) => {
        if (socket.salaActual) {
            // Reenviamos el movimiento SOLO al oponente en la misma sala
            socket.to(socket.salaActual).emit('movimientoRival', datos);
        }
    });

    socket.on('buscarPartidaBot', (dificultad) => {
        iniciarPartidaBot(socket, dificultad);
    });

    // SISTEMA REVANCHAS
    socket.on('pedirRevancha', () => {
        const salaID = socket.salaActual;
        if (socket.salaActual && salasActivas[socket.salaActual]) {
            let sala = salasActivas[socket.salaActual];
            if (sala.isBotRoom) {
               // Bot automatically accepts
               limpiarSala(socket.salaActual); 
               iniciarPartidaBot(socket, sala.dificultadBot, socket.salaActual);
               return;
            }

            salasActivas[salaID].revancha[socket.id] = true;
            
            let rivalId = salasActivas[salaID].jugador1 === socket.id ? 
                          salasActivas[salaID].jugador2 : salasActivas[salaID].jugador1;

            if (salasActivas[salaID].revancha[rivalId]) {
                // Ambos quieren revancha
                console.log(`Revancha aceptada en la sala ${salaID}`);
                
                // Limpiamos el estado viejo de la sala
                limpiarSala(salaID);
                
                // Reiniciamos sala state
                salasActivas[salaID] = {
                    jugador1: socket.id,
                    jugador2: rivalId,
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

                    sock1.emit('partidaEncontrada', {
                        jugador1: sock1.nombreJugador,
                        jugador2: sock2.nombreJugador,
                        tableroPropio: t1.puzzle,
                        solucionPropia: t1.solucion,
                        tableroRival: t2.puzzle
                    });

                    sock2.emit('partidaEncontrada', {
                        jugador1: sock2.nombreJugador,
                        jugador2: sock1.nombreJugador,
                        tableroPropio: t2.puzzle,
                        solucionPropia: t2.solucion,
                        tableroRival: t1.puzzle
                    });

                    iniciarChequeoMuerteSubita(salaID);
                }
            }
        }
    });

    // DESCONEXIÓN
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
        console.log('Usuario desconectado:', socket.id);
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

    socket.on('actualizarSalud', (puntos) => {
        if (socket.salaActual) {
            socket.to(socket.salaActual).emit('saludRivalActualizada', puntos);
        }
    });
    
    // El servidor recibe la notificación de un acierto
    socket.on('jugadorAcerto', (datos) => {
        if (socket.salaActual && salasActivas[socket.salaActual]) {
            let sala = salasActivas[socket.salaActual];
            if (sala.isBotRoom && sala.bot) {
               sala.bot.salud = Math.max(0, sala.bot.salud - datos.valorDano);
               socket.emit('saludRivalActualizada', sala.bot.salud);
            } else {
               // 1. Enviamos el daño al oponente
               socket.to(socket.salaActual).emit('recibirAtaque', { 
                   cantidad: datos.valorDano,
                   flotante: true // Indicamos que es un ataque de jugador para mostrar daño
               });
               
               // 2. Sincronizamos la curación del jugador en la mini-barra del oponente
               socket.to(socket.salaActual).emit('saludRivalActualizada', datos.saludActualizada);
            }
        }
    });

    socket.on('actualizarSalud', (puntos) => {
        if (socket.salaActual && salasActivas[socket.salaActual]) {
            let sala = salasActivas[socket.salaActual];
            if (!sala.isBotRoom) {
                socket.to(socket.salaActual).emit('saludRivalActualizada', puntos);
            }
        }
    });
});

// Función para gestionar la Muerte Súbita
function iniciarChequeoMuerteSubita(salaID) {
    // 180000 = 3 minutos
    setTimeout(() => {
        if (salasActivas[salaID]) {
            salasActivas[salaID].muerteSubita = true;
            io.to(salaID).emit('muerteSubitaActivada');

            // Intervalo para restar 1 hp por segundo
            salasActivas[salaID].intervaloMuerte = setInterval(() => {
                if(salasActivas[salaID]) {
                   io.to(salaID).emit('recibirAtaque', { cantidad: 1, flotante: false });

                   if (salasActivas[salaID].isBotRoom && salasActivas[salaID].bot) {
                       salasActivas[salaID].bot.salud = Math.max(0, salasActivas[salaID].bot.salud - 1);
                       let sock = io.sockets.sockets.get(salasActivas[salaID].jugador1);
                       if (sock) {
                           sock.emit('saludRivalActualizada', salasActivas[salaID].bot.salud);
                       }
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

// ------ LÓGICA DE JUEGO CONTRA IA ------
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
        solucionPropia: tPlayer.solucion,
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
             s.bot.puzzle[spot.r][spot.c] = val; 
             
             if (realPlayerSocket) {
                 realPlayerSocket.emit('movimientoRival', { fila: spot.r, columna: spot.c, valor: val });
                 realPlayerSocket.emit('recibirAtaque', { cantidad: dano, flotante: true });
                 realPlayerSocket.emit('saludRivalActualizada', s.bot.salud);
             }
         } else {
             s.bot.combo = 0;
             s.bot.salud = Math.max(0, s.bot.salud - 10);
             
             if (realPlayerSocket) {
                 realPlayerSocket.emit('movimientoRival', { fila: spot.r, columna: spot.c, valor: val });
                 setTimeout(() => {
                     // Solo limpiar si todavia está vacío en el estado interno
                     if (salasActivas[salaID] && salasActivas[salaID].bot && salasActivas[salaID].bot.puzzle[spot.r][spot.c] === 0) {
                        realPlayerSocket.emit('movimientoRival', { fila: spot.r, columna: spot.c, valor: '' });
                     }
                 }, 500);
                 
                 realPlayerSocket.emit('saludRivalActualizada', s.bot.salud);
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

// Iniciar el servidor
const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => {
    console.log(`Servidor de Sudoku corriendo en http://localhost:${PUERTO}`);
});