// Conectar con el servidor Socket.io
const socket = io();

// Elementos del DOM
const lobbyContainer = document.getElementById('lobby-container');
const gameContainer = document.getElementById('game-container');
const usernameInput = document.getElementById('username-input');
const saveUserBtn = document.getElementById('save-user-btn');
const welcomeMsg = document.getElementById('welcome-msg');
const displayName = document.getElementById('display-name');
const findMatchBtn = document.getElementById('find-match-btn');
const statusMsg = document.getElementById('status-msg');
const p1Name = document.getElementById('player1-name');
const p2Name = document.getElementById('player2-name');
const boardElement = document.getElementById('sudoku-board');
const leaveMatchBtn = document.getElementById('leave-match-btn');
const opponentBoardElement = document.getElementById('opponent-board');


let miNombre = "";
let inputsTablero = []; // Matriz para guardar referencias de los inputs HTML y actualizarlos más rápido
let inputsOponente = [];
let saludPropia = 150;
let saludRival = 150;
let solucionActual = [];

// --- SISTEMA DE COOKIES ---
function setCookie(nombre, valor, dias) {
    let fecha = new Date();
    fecha.setTime(fecha.getTime() + (dias * 24 * 60 * 60 * 1000));
    document.cookie = `${nombre}=${valor};expires=${fecha.toUTCString()};path=/`;
}

function getCookie(nombre) {
    let nombreC = nombre + "=";
    let decodificado = decodeURIComponent(document.cookie);
    let ca = decodificado.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1);
        if (c.indexOf(nombreC) == 0) return c.substring(nombreC.length, c.length);
    }
    return "";
}

function checkUser() {
    let guardado = getCookie("sudoku_user");
    if (guardado !== "") {
        miNombre = guardado;
        mostrarLobbyPreparado();
    }
}

saveUserBtn.addEventListener('click', () => {
    let nombre = usernameInput.value.trim();
    if (nombre.length > 0) {
        setCookie("sudoku_user", nombre, 30); // Guardamos por 30 días
        miNombre = nombre;
        mostrarLobbyPreparado();
    }
});

function mostrarLobbyPreparado() {
    document.getElementById('username-section').style.display = 'none';
    welcomeMsg.style.display = 'block';
    displayName.innerText = miNombre;
    findMatchBtn.style.display = 'inline-block';
}

// --- RENDERIZADO DEL TABLERO ---
function renderBoard(board) {
    boardElement.innerHTML = ''; 
    inputsTablero = Array.from({ length: 9 }, () => Array(9).fill(null));

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            let input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 1;
            input.className = 'cell';
            
            // Bordes estéticos para los cuadrantes
            if (c === 2 || c === 5) input.classList.add('border-right');
            if (r === 2 || r === 5) input.classList.add('border-bottom');

            if (board[r][c] !== 0) {
                // Números iniciales fijos
                input.value = board[r][c];
                input.readOnly = true;
                input.classList.add('readonly');
            } else {
                // Casillas jugables
                input.addEventListener('input', (e) => {
                    let val = parseInt(e.target.value);
                    let fila = r;
                    let col = c;

                    if (!isNaN(val)) {
                        if (val === solucionActual[fila][col]) {
                            // --- NUEVA MECÁNICA DE COMBATE ---
                            const danoAlRival = val;
                            const curacionPropia = Math.ceil(val / 2);

                            // 1. Aplicar curación propia
                            saludPropia = Math.min(150, saludPropia + curacionPropia);
                            actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);

                            // 2. Notificar al servidor: "He acertado, daña al rival y actualiza mi vida en su pantalla"
                            socket.emit('jugadorAcerto', { 
                                valorDano: danoAlRival, 
                                saludActualizada: saludPropia 
                            });

                            // Bloquear la celda para que no se pueda volver a usar para atacar/curar
                            e.target.readOnly = true;
                            e.target.classList.add('readonly');
                            
                        } else {
                            // ERROR: Restar 15 de vida (lo que ya tenías)
                            saludPropia = Math.max(0, saludPropia - 15);
                            actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);
                            socket.emit('actualizarSalud', saludPropia);
                            
                            if (saludPropia <= 0) {
                                alert("¡Te has quedado sin vida! Fin del juego.");
                                socket.emit('abandonarPartida');
                                volverAlLobby();
                            }
                        }
                    }
                    // Enviar movimiento visual al oponente
                    socket.emit('movimiento', { fila, columna: col, valor: e.target.value });
                });
            }
            
            inputsTablero[r][c] = input; // Guardamos el input para actualizarlo después
            boardElement.appendChild(input);
        }
    }
}

function renderOpponentBoard(board) {
    opponentBoardElement.innerHTML = ''; 
    inputsOponente = Array.from({ length: 9 }, () => Array(9).fill(null));

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            let input = document.createElement('input');
            input.type = 'text';
            input.className = 'cell readonly'; 
            input.readOnly = true;
            
            // Mantenemos los bordes gruesos en la miniatura
            if (c === 2 || c === 5) input.classList.add('border-right');
            if (r === 2 || r === 5) input.classList.add('border-bottom');

            if (board[r][c] !== 0) {
                input.value = board[r][c];
            }
            
            inputsOponente[r][c] = input;
            opponentBoardElement.appendChild(input);
        }
    }
}

function volverAlLobby() {
    gameContainer.style.display = 'none';
    lobbyContainer.style.display = 'block';
    statusMsg.innerText = '';
    findMatchBtn.style.display = 'inline-block';
}

function actualizarUIBarraVida(idBarra, idTexto, salud) {
    const barra = document.getElementById(idBarra);
    const porcentaje = (salud / 150) * 100;
    barra.style.width = porcentaje + "%";
    
    if (idTexto) document.getElementById(idTexto).innerText = salud;

    // Cambiar colores
    if (porcentaje <= 30) {
        barra.classList.add('hp-low');
    } else if (porcentaje <= 60) {
        barra.classList.add('hp-mid');
    } else {
        barra.classList.remove('hp-low', 'hp-mid');
    }
}

// --- LÓGICA DE SOCKET.IO Y MATCHMAKING ---

// Botón buscar partida
findMatchBtn.addEventListener('click', () => {
    findMatchBtn.style.display = 'none';
    statusMsg.innerText = "Buscando oponente...";
    socket.emit('buscarPartida', miNombre);
});

// Botón abandonar partida
leaveMatchBtn.addEventListener('click', () => {
    if (confirm('¿Estás seguro de que deseas abandonar la partida?')) {
        // Le avisamos al servidor
        socket.emit('abandonarPartida');
        // Regresamos a nuestra pantalla principal
        volverAlLobby();
    }
});

// El servidor encontró una partida
socket.on('partidaEncontrada', (datos) => {
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'block';
    
    // Asignamos los nombres
    p1Name.innerText = datos.jugador1; // Tu nombre siempre a la izquierda
    p2Name.innerText = datos.jugador2; // Nombre del rival a la derecha
    
    // Dibujamos ambos tableros
    renderBoard(datos.tableroPropio);
    renderOpponentBoard(datos.tableroRival);
});

// Recibir movimiento del rival (Modo Carrera)
socket.on('movimientoRival', (datos) => {
    const inputOponente = inputsOponente[datos.fila][datos.columna];
    
    if (inputOponente) {
        inputOponente.value = datos.valor;
        
        // Efecto visual rápido para notar que el rival escribió
        inputOponente.style.backgroundColor = '#f1c40f'; // Amarillo brillante
        setTimeout(() => {
            inputOponente.style.backgroundColor = '#ecf0f1'; // Vuelve al gris tenue
        }, 500);
    }
});

// El rival abandonó la partida
socket.on('rivalDesconectado', () => {
    alert("¡Tu oponente ha abandonado la partida! Has ganado por abandono.");
    volverAlLobby();
});

// Escuchar actualizaciones de salud del rival
socket.on('saludRivalActualizada', (nuevaSaludRival) => {
    saludRival = nuevaSaludRival;
    actualizarUIBarraVida('opponent-hp-bar', null, saludRival);
    
    if (saludRival <= 0) {
        alert("¡El rival se ha quedado sin vida! ¡Has ganado!");
        volverAlLobby();
    }
});

// Recibir daño porque el rival colocó un número correcto
socket.on('recibirAtaque', (datos) => {
    saludPropia = Math.max(0, saludPropia - datos.cantidad);
    actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);
    
    // Importante: Notificar al rival nuestra nueva salud para sincronizar su mini-barra
    socket.emit('actualizarSalud', saludPropia);

    if (saludPropia <= 0) {
        alert("¡El rival te ha derrotado con sus aciertos! Fin del juego.");
        socket.emit('abandonarPartida');
        volverAlLobby();
    }
});

// Ejecutar revisión de cookie al cargar la página
checkUser();