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
const themeToggle = document.getElementById('theme-toggle');
const cancelMatchBtn = document.getElementById('cancel-match-btn');

let miNombre = "";
let inputsTablero = []; 
let wrappersTablero = [];
let saludPropia = 150;
let saludRival = 150;
let lastSaludRival = 150;
let solucionActual = [];
let comboCount = 0;

let notesMode = false;
let notesData = {}; 
let selectedCell = null; // {r, c}
let moveHistory = []; // Historial para deshacer

// --- THEME TOGGLE ---
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
        themeToggle.innerText = "☀️ Claro";
    } else {
        themeToggle.innerText = "🌙 Oscuro";
    }
});

// --- TOAST NOTIFICATIONS ---
function showToast(message) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 3000);
}

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
        setCookie("sudoku_user", nombre, 30); 
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

// --- CONTROLES Y HERRAMIENTAS ---
const toggleNotesBtn = document.getElementById('toggle-notes-btn');
if (toggleNotesBtn) {
    toggleNotesBtn.addEventListener('click', () => {
        notesMode = !notesMode;
        toggleNotesBtn.classList.toggle('active', notesMode);
        toggleNotesBtn.innerText = notesMode ? "✏️ Notas (ON)" : "✏️ Notas";
    });
}

const eraseBtn = document.getElementById('erase-btn');
if (eraseBtn) {
    eraseBtn.addEventListener('click', () => {
        if (selectedCell) {
            handleInput(selectedCell.r, selectedCell.c, '');
        }
    });
}

const undoBtn = document.getElementById('undo-btn');
if (undoBtn) {
    undoBtn.addEventListener('click', () => {
        if (moveHistory.length > 0) {
            let lastMove = moveHistory.pop();
            let input = inputsTablero[lastMove.r][lastMove.c];
            if (!input.classList.contains('readonly')) {
                input.value = lastMove.oldVal;
                updateHighlights();
                socket.emit('movimiento', { fila: lastMove.r, columna: lastMove.c, valor: lastMove.oldVal });
            }
        }
    });
}

// Numpad Virtual
document.querySelectorAll('.numpad-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (selectedCell) {
            let val = e.target.getAttribute('data-val');
            handleInput(selectedCell.r, selectedCell.c, val);
        }
    });
});

// Teclado Físico
document.addEventListener('keydown', (e) => {
    if (selectedCell && gameContainer.style.display !== 'none') {
        let val = parseInt(e.key);
        if (!isNaN(val) && val >= 1 && val <= 9) {
            handleInput(selectedCell.r, selectedCell.c, val.toString());
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            handleInput(selectedCell.r, selectedCell.c, '');
        }
    }
});

function handleInput(r, c, val) {
    let input = inputsTablero[r][c];
    if (input.classList.contains('readonly')) return; // Si ya está fija o acierto

    if (notesMode && val !== '') {
        toggleNote(r, c, parseInt(val));
        return;
    } else if (notesMode && val === '') {
        notesData[`${r},${c}`].clear();
        renderNotes(r, c);
        return;
    }

    // Guardar para deshacer
    moveHistory.push({ r, c, oldVal: input.value });
    
    input.value = val;
    updateHighlights();
    procesarJugada(r, c, val, input);
}

// --- LOGICA DE NOTAS ---
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

// --- HIGHLIGHTS ---
function updateHighlights() {
    // Limpiar clases
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if(wrappersTablero[r][c]) {
                wrappersTablero[r][c].classList.remove('highlight', 'highlight-same', 'selected');
            }
        }
    }

    if (!selectedCell) return;

    let sr = selectedCell.r;
    let sc = selectedCell.c;
    let selectedVal = inputsTablero[sr][sc].value;

    // Resaltar fila, columna y bloque
    let startRow = sr - (sr % 3);
    let startCol = sc - (sc % 3);

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (!wrappersTablero[r][c]) continue;

            if (r === sr || c === sc || (r >= startRow && r < startRow + 3 && c >= startCol && c < startCol + 3)) {
                wrappersTablero[r][c].classList.add('highlight');
            }
            // Resaltar números iguales
            if (selectedVal && selectedVal !== '' && inputsTablero[r][c].value === selectedVal) {
                wrappersTablero[r][c].classList.add('highlight-same');
            }
        }
    }
    
    if(wrappersTablero[sr][sc]) {
        wrappersTablero[sr][sc].classList.add('selected');
    }
}

// --- RENDERIZADO DEL TABLERO ---
function renderBoard(board) {
    boardElement.innerHTML = ''; 
    inputsTablero = Array.from({ length: 9 }, () => Array(9).fill(null));
    wrappersTablero = Array.from({ length: 9 }, () => Array(9).fill(null));
    notesData = {};
    selectedCell = null;
    moveHistory = [];

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            notesData[`${r},${c}`] = new Set();

            let wrapper = document.createElement('div');
            wrapper.className = 'cell-wrapper';
            
            let input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 1;
            input.className = 'cell';
            input.readOnly = true; // Todo manejado por click y virtual numpad
            
            let notesOverlay = document.createElement('div');
            notesOverlay.className = 'notes-overlay';
            notesOverlay.id = `notes-${r}-${c}`;

            if (board[r][c] !== 0) {
                input.value = board[r][c];
                input.classList.add('readonly');
                wrapper.classList.add('readonly');
            } else {
                input.style.cursor = 'pointer';
            }

            // Manejo de clicks para seleccionar celda
            wrapper.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectedCell = { r, c };
                updateHighlights();
            });
            input.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectedCell = { r, c };
                updateHighlights();
            });
            
            inputsTablero[r][c] = input;
            wrappersTablero[r][c] = wrapper;
            wrapper.appendChild(input);
            wrapper.appendChild(notesOverlay);
            boardElement.appendChild(wrapper);
        }
    }
}

// --- LOGICA DE JUGADAS ---
function procesarJugada(r, c, valStr, input) {
    if (valStr === '') {
        socket.emit('movimiento', { fila: r, columna: c, valor: '' });
        return;
    }

    let val = parseInt(valStr);
    if (!isNaN(val)) {
        if (val === solucionActual[r][c]) {
            // Acierto
            document.getElementById(`notes-${r}-${c}`).innerHTML = '';
            
            comboCount++;
            actualizarComboUI();

            let multiplicadorDano = comboCount >= 3 ? 1.5 : 1;
            const danoAlRival = Math.ceil(val * multiplicadorDano);
            const curacionPropia = Math.ceil(val / 2);

            saludPropia = Math.min(150, saludPropia + curacionPropia);
            actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);

            mostrarFlotante(curacionPropia, 'curacion', true);
            mostrarFlotante(danoAlRival, 'dano', false);

            socket.emit('jugadorAcerto', { 
                valorDano: danoAlRival, 
                saludActualizada: saludPropia 
            });

            input.readOnly = true;
            input.classList.add('readonly');
            wrappersTablero[r][c].classList.add('readonly');
            
            // Re-evaluar highlights si cambian los números visualmente
            updateHighlights();
            
        } else {
            // Error
            comboCount = 0;
            actualizarComboUI();
            
            saludPropia = Math.max(0, saludPropia - 10);
            actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);
            socket.emit('actualizarSalud', saludPropia);
            
            mostrarFlotante(10, 'dano', true);
            
            animarErrorCelda(r, c);

            if (saludPropia <= 0) {
                socket.emit('actualizarSalud', 0);
                mostrarModalGameOver("¡Has perdido!", "Te has quedado sin puntos de salud.");
            }
        }
    }
    socket.emit('movimiento', { fila: r, columna: c, valor: valStr });
}

function animarErrorCelda(r, c) {
    const wrapper = wrappersTablero[r][c];
    wrapper.classList.add('cell-error');
    setTimeout(() => {
        wrapper.classList.remove('cell-error');
    }, 400);
}

function animarShakeGeneral() {
    const board = document.getElementById('sudoku-board');
    board.classList.add('board-damage');
    setTimeout(() => {
        board.classList.remove('board-damage');
    }, 400);
}

function volverAlLobby() {
    gameContainer.style.display = 'none';
    lobbyContainer.style.display = 'block';
    statusMsg.innerText = '';
    document.getElementById('lobby-buttons').style.display = 'block';
    document.getElementById('game-over-modal').style.display = 'none';
    desactivarMuerteSubita(); 
}

function actualizarComboUI() {
    const comboEl = document.getElementById('player-combo');
    if (comboCount >= 2) {
        comboEl.style.display = 'block';
        comboEl.innerText = `Combo x${comboCount}!`;
        comboEl.classList.remove('active');
        void comboEl.offsetWidth; 
        comboEl.classList.add('active');
    } else {
        comboEl.style.display = 'none';
    }
}

function mostrarFlotante(cantidad, tipo, isPlayer) {
    const wrapperSelector = isPlayer ? '.player-progress' : '.opponent-progress';
    const wrapper = document.querySelector(wrapperSelector);
    if (!wrapper) return;
    
    const floating = document.createElement('div');
    floating.className = `floating-text ${tipo === 'dano' ? 'floating-dano' : 'floating-curacion'}`;
    floating.innerText = tipo === 'dano' ? `-${cantidad}` : `+${cantidad}`;
    
    floating.style.left = Math.floor(Math.random() * 40) + 30 + '%';
    floating.style.top = '0px';
    
    wrapper.appendChild(floating);

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
    
    const porcentaje = Math.max(0, (salud / 150) * 100);
    barra.style.width = porcentaje + "%";
    
    if (idTexto) document.getElementById(idTexto).innerText = salud;

    barra.classList.remove('hp-mid', 'hp-low', 'hp-critical');

    if (salud <= 25) {
        barra.classList.add('hp-critical');
    } else if (salud <= 50) {
        barra.classList.add('hp-low');
    } else if (salud <= 100) {
        barra.classList.add('hp-mid');
    }
}

// --- LÓGICA DE SOCKET.IO Y MATCHMAKING ---

findMatchBtn.addEventListener('click', () => {
    document.getElementById('lobby-buttons').style.display = 'none';
    statusMsg.innerText = "Buscando oponente...";
    if (cancelMatchBtn) cancelMatchBtn.style.display = 'inline-block';
    socket.emit('buscarPartida', miNombre);
});

if (cancelMatchBtn) {
    cancelMatchBtn.addEventListener('click', () => {
        socket.emit('cancelarBusqueda');
        statusMsg.innerText = '';
        cancelMatchBtn.style.display = 'none';
        document.getElementById('lobby-buttons').style.display = 'block';
    });
}

document.querySelectorAll('.bot-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        let dif = e.target.getAttribute('data-dif');
        document.getElementById('lobby-buttons').style.display = 'none';
        statusMsg.innerText = "Instanciando IA (" + dif + ")...";
        socket.emit('buscarPartidaBot', dif);
    });
});

leaveMatchBtn.addEventListener('click', () => {
    if (confirm('¿Estás seguro de que deseas abandonar la partida?')) {
        socket.emit('abandonarPartida');
        volverAlLobby();
    }
});

socket.on('partidaEncontrada', (datos) => {
    lobbyContainer.style.display = 'none';
    gameContainer.style.display = 'block';
    if (cancelMatchBtn) cancelMatchBtn.style.display = 'none';
    
    p1Name.innerText = datos.jugador1; 
    p2Name.innerText = datos.jugador2; 
    
    solucionActual = datos.solucionPropia;
    saludPropia = 150;
    saludRival = 150;
    lastSaludRival = 150;
    comboCount = 0;
    actualizarComboUI();
    desactivarMuerteSubita();

    actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);
    actualizarUIBarraVida('opponent-hp-bar', null, saludRival);
    
    document.getElementById('game-over-modal').style.display = 'none';
    document.getElementById('rematch-btn').style.display = 'inline-block';

    renderBoard(datos.tableroPropio);
    showToast("¡La partida ha comenzado!");
});

socket.on('movimientoRival', (datos) => {
    // No hacemos nada para no saturar
});

socket.on('rivalDesconectado', () => {
    showToast("¡Tu oponente ha abandonado!");
    volverAlLobby();
});

socket.on('saludRivalActualizada', (nuevaSaludRival) => {
    if (nuevaSaludRival > lastSaludRival) {
        mostrarFlotante(nuevaSaludRival - lastSaludRival, 'curacion', false);
    } else if (nuevaSaludRival < lastSaludRival) {
        // El daño que nosotros le hacemos ya se muestra localmente. 
        // Pero si fue un error de ellos, se muestran -10 de daño.
        if (lastSaludRival - nuevaSaludRival === 10) {
            mostrarFlotante(10, 'dano', false);
        }
    }
    saludRival = nuevaSaludRival;
    lastSaludRival = nuevaSaludRival;
    
    actualizarUIBarraVida('opponent-hp-bar', null, saludRival);
    
    if (saludRival <= 0) {
        mostrarModalGameOver("¡Has ganado!", "El rival se ha quedado sin vida.");
    }
});

socket.on('recibirAtaque', (datos) => {
    saludPropia = Math.max(0, saludPropia - datos.cantidad);
    actualizarUIBarraVida('player-hp-bar', 'player-hp-val', saludPropia);
    
    animarShakeGeneral();
    
    if(datos.flotante) { 
       mostrarFlotante(datos.cantidad, 'dano', true);
       showToast("¡El rival ha acertado un número!");
    }
    
    socket.emit('actualizarSalud', saludPropia);

    if (saludPropia <= 0) {
        mostrarModalGameOver("¡Has perdido!", "El rival te ha derrotado con sus aciertos.");
    }
});

socket.on('muerteSubitaActivada', () => {
    showToast("¡Modo Muerte Súbita activado!");
    activarMuerteSubita();
});

socket.on('revanchaRechazada', () => {
    showToast("El oponente ha cancelado la partida.");
    volverAlLobby();
});

// Inicializar
checkUser();