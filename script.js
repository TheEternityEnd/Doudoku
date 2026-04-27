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
let comboCount = 0; // Para el sistema de combos

let notesMode = false;
let notesData = {}; // Guarda qué notas de lápiz hay en cada celda

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
    document.getElementById('lobby-buttons').style.display = 'block';
}

// Evento de Modo Notas
const toggleNotesBtn = document.getElementById('toggle-notes-btn');
if (toggleNotesBtn) {
    toggleNotesBtn.addEventListener('click', () => {
        notesMode = !notesMode;
        toggleNotesBtn.classList.toggle('active', notesMode);
        toggleNotesBtn.innerText = notesMode ? "✏️ Notas: ON" : "✏️ Notas: OFF";
    });
}

function renderNotes(r, c) {
    const overlay = document.getElementById(`notes-${r}-${c}`);
    if (!overlay) return;
    overlay.innerHTML = '';
    
    for (let i = 1; i <= 9; i++) {
        let div = document.createElement('div');
        div.className = 'note-item';
        if (notesData[`${r},${c}`].has(i)) {
            div.innerText = i;
        }
        overlay.appendChild(div);
    }
}

function toggleNote(r, c, val) {
    const key = `${r},${c}`;
    if (!notesData[key]) notesData[key] = new Set();
    
    if (notesData[key].has(val)) {
        notesData[key].delete(val);
    } else {
        notesData[key].add(val);
    }
    renderNotes(r, c);
}

// --- RENDERIZADO DEL TABLERO ---
function renderBoard(board) {
    boardElement.innerHTML = ''; 
    inputsTablero = Array.from({ length: 9 }, () => Array(9).fill(null));
    notesData = {};

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            notesData[`${r},${c}`] = new Set();

            let wrapper = document.createElement('div');
            wrapper.className = 'cell-wrapper';
            if (c === 2 || c === 5) wrapper.classList.add('border-right');
            if (r === 2 || r === 5) wrapper.classList.add('border-bottom');

            let input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 1;
            input.className = 'cell';
            
            let notesOverlay = document.createElement('div');
            notesOverlay.className = 'notes-overlay';
            notesOverlay.id = `notes-${r}-${c}`;

            if (board[r][c] !== 0) {
                // Números iniciales fijos
                input.value = board[r][c];
                input.readOnly = true;
                input.classList.add('readonly');
                wrapper.classList.add('readonly');
            } else {
                // Casillas jugables
                input.addEventListener('keydown', (e) => {
                    let val = parseInt(e.key);
                    if (notesMode && !isNaN(val) && val >= 1 && val <= 9) {
                        e.preventDefault(); 
                        toggleNote(r, c, val);
                    } else if (notesMode && (e.key === 'Backspace' || e.key === 'Delete')) {
                        e.preventDefault();
                        notesData[`${r},${c}`].clear();
                        renderNotes(r, c);
                    }
                });

                input.addEventListener('input', (e) => {
                    if (notesMode) {
                        e.target.value = '';
                        return;
                    }

                    let val = parseInt(e.target.value);
                    let fila = r;
                    let col = c;

                    if (!isNaN(val)) {
                        if (val === solucionActual[fila][col]) {
                            // Limpiar notas visualmente si la celda se acierta
                            document.getElementById(`notes-${r}-${c}`).innerHTML = '';
                            
                            // --- SISTEMA COMBO ---
                            comboCount++;
                            actualizarComboUI();

                            // --- NUEVA MECÁNICA DE COMBATE ---
                            let multiplicadorDano = comboCount >= 3 ? 1.5 : 1;
                            const danoAlRival = Math.ceil(val * multiplicadorDano);
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
                            // ERROR: Pierde el combo y recibe daño
                            comboCount = 0;
                            actualizarComboUI();
                            
                            saludPropia = Math.max(0, saludPropia - 10);
                            actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);
                            socket.emit('actualizarSalud', saludPropia);
                            
                            animarShake();

                            if (saludPropia <= 0) {
                                socket.emit('actualizarSalud', 0); // Asegurar que el rival lo ve a 0
                                mostrarModalGameOver("¡Has perdido!", "Te has quedado sin puntos de salud.");
                            }
                        }
                    }
                    // Enviar movimiento visual al oponente
                    socket.emit('movimiento', { fila, columna: col, valor: e.target.value });
                });
            }
            
            inputsTablero[r][c] = input; // Guardamos el input para actualizarlo después
            wrapper.appendChild(input);
            wrapper.appendChild(notesOverlay);
            boardElement.appendChild(wrapper);
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
    document.getElementById('lobby-buttons').style.display = 'block';
    document.getElementById('game-over-modal').style.display = 'none';
    desactivarMuerteSubita(); // Resetea la muerte súbita visualmente
}

function actualizarComboUI() {
    const comboEl = document.getElementById('player-combo');
    if (comboCount >= 2) {
        comboEl.style.display = 'block';
        comboEl.innerText = `Combo x${comboCount}!`;
        // Reiniciar animación
        comboEl.classList.remove('active');
        void comboEl.offsetWidth; 
        comboEl.classList.add('active');
    } else {
        comboEl.style.display = 'none';
    }
}

function animarShake() {
    const wrapper = document.getElementById('boards-wrapper');
    wrapper.classList.add('shake');
    setTimeout(() => {
        wrapper.classList.remove('shake');
    }, 300);
}

function mostrarDanoFlotante(dano) {
    const miniatura = document.getElementById('opponent-section');
    const floating = document.createElement('div');
    floating.className = 'floating-damage';
    floating.innerText = `-${dano}`;
    
    // Posicionar aleatoriamente sobre el área del rival
    floating.style.left = Math.floor(Math.random() * 80) + 20 + 'px';
    floating.style.top = Math.floor(Math.random() * 50) + 20 + 'px';
    
    miniatura.appendChild(floating);

    // Iniciar animación (subir y desvanecerse)
    setTimeout(() => {
        floating.style.transform = 'translateY(-30px)';
        floating.style.opacity = '0';
    }, 50);

    // Eliminar del DOM después de 1 segundo
    setTimeout(() => {
        if(floating.parentElement) {
            floating.remove();
        }
    }, 1000);
}

// Modal functions
function mostrarModalGameOver(titulo, mensaje) {
    document.getElementById('game-over-title').innerText = titulo;
    document.getElementById('game-over-message').innerText = mensaje;
    document.getElementById('game-over-modal').style.display = 'flex';
}

document.getElementById('rematch-btn').addEventListener('click', () => {
    document.getElementById('game-over-title').innerText = "Esperando al rival...";
    document.getElementById('game-over-message').innerText = "Has pedido revancha.";
    document.getElementById('rematch-btn').style.display = 'none';
    socket.emit('pedirRevancha');
});

document.getElementById('lobby-btn').addEventListener('click', () => {
    socket.emit('abandonarPartida');
    volverAlLobby();
});

// Funciones Muerte Súbita Visual
let textMuerteSubita = null;
function activarMuerteSubita() {
    document.body.classList.add('sudden-death-bg');
    if (!textMuerteSubita) {
        textMuerteSubita = document.createElement('div');
        textMuerteSubita.className = 'sudden-death-text';
        textMuerteSubita.innerText = "¡MUERTE SÚBITA!";
        gameContainer.insertBefore(textMuerteSubita, gameContainer.firstChild);
    }
}

function desactivarMuerteSubita() {
    document.body.classList.remove('sudden-death-bg');
    if (textMuerteSubita) {
        textMuerteSubita.remove();
        textMuerteSubita = null;
    }
}

function actualizarUIBarraVida(idBarra, idTexto, salud) {
    const barra = document.getElementById(idBarra);
    
    // Calculamos el porcentaje para el ancho de la barra (evitando que sea menor a 0)
    const porcentaje = Math.max(0, (salud / 150) * 100);
    barra.style.width = porcentaje + "%";
    
    if (idTexto) document.getElementById(idTexto).innerText = salud;

    // 1. Limpiamos cualquier color o animación anterior
    barra.classList.remove('hp-mid', 'hp-low', 'hp-critical');

    // 2. Aplicamos la clase correcta según la cantidad de vida restante
    if (salud <= 25) {
        barra.classList.add('hp-critical'); // Por debajo de 25: Parpadea en rojo y rosa
    } else if (salud <= 50) {
        barra.classList.add('hp-low');      // 50 o menos: Rojo sólido
    } else if (salud <= 100) {
        barra.classList.add('hp-mid');      // 100 o menos: Amarillo sólido
    }
    // Si la salud es mayor a 100, se queda con su color verde por defecto
}

// --- LÓGICA DE SOCKET.IO Y MATCHMAKING ---

// Botón buscar partida 1v1
findMatchBtn.addEventListener('click', () => {
    document.getElementById('lobby-buttons').style.display = 'none';
    statusMsg.innerText = "Buscando oponente...";
    socket.emit('buscarPartida', miNombre);
});

// Botones para jugar contra Bot
document.querySelectorAll('.bot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        let dif = e.target.getAttribute('data-dif');
        document.getElementById('lobby-buttons').style.display = 'none';
        statusMsg.innerText = "Instanciando IA (" + dif + ")...";
        socket.emit('buscarPartidaBot', dif);
    });
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
    
    // Configuración limpia
    solucionActual = datos.solucionPropia;
    saludPropia = 150;
    saludRival = 150;
    comboCount = 0;
    actualizarComboUI();
    desactivarMuerteSubita();

    actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);
    actualizarUIBarraVida('opponent-hp-bar', null, saludRival);
    
    // Ocultar modal y reestablecer botones
    document.getElementById('game-over-modal').style.display = 'none';
    document.getElementById('rematch-btn').style.display = 'inline-block';

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
        mostrarModalGameOver("¡Has ganado!", "El rival se ha quedado sin vida.");
    }
});

// Recibir daño porque el rival colocó un número correcto o daño externo
socket.on('recibirAtaque', (datos) => {
    saludPropia = Math.max(0, saludPropia - datos.cantidad);
    actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);
    
    animarShake();
    if(datos.flotante) { // Si viene del rival directamente
       mostrarDanoFlotante(datos.cantidad);
    }
    
    socket.emit('actualizarSalud', saludPropia);

    if (saludPropia <= 0) {
        mostrarModalGameOver("¡Has perdido!", "El rival te ha derrotado con sus aciertos.");
    }
});

// Eventos nuevos
socket.on('muerteSubitaActivada', () => {
    activarMuerteSubita();
});

socket.on('revanchaRechazada', () => {
    alert("El oponente ha abandonado o cancelado la partida.");
    volverAlLobby();
});

// Ejecutar revisión de cookie al cargar la página
checkUser();