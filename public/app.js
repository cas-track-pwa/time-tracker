let db;
const dbRequest = indexedDB.open("TimeTrackerDB", 4);

dbRequest.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("logs")) {
        const logsStore = db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
        logsStore.createIndex("byClientId", "clientId", { unique: true });
    } else {
        // Version 4: add the byClientId index used for cross-device sync lookups.
        const logsStore = e.target.transaction.objectStore("logs");
        if (!logsStore.indexNames.contains("byClientId")) {
            logsStore.createIndex("byClientId", "clientId", { unique: true });
        }
    }
    if (!db.objectStoreNames.contains("timerState")) {
        db.createObjectStore("timerState", { keyPath: "id" });
    }
};

dbRequest.onsuccess = (e) => { db = e.target.result; renderLogs(); restoreTimerState(); checkConnectivity(); if (isAuthenticated()) { performSync(); } if (localStorage.getItem('invoicingMode') === 'true' && window.matchMedia('(min-width: 768px)').matches) { enterInvoicingMode(); } };
dbRequest.onerror = () => alert("Database failure. Allow local storage permissions.");

let timerInterval = null, startTime = null, isRunning = false, arrivalTime = null, startMileage = null, arrivalMileage = null, travelMileage = null, editingLogId = null, pendingResumeLogId = null, requestMileage = localStorage.getItem('requestMileage') === 'true', isRemote = false, currentJobType = 'travel';

// Helper function to robustly check if a log entry is remote work
function isRemoteLog(log) {
    if (!log) return false;
    const val = log.isRemote;
    if (val === true || val === 1 || val === '1') return true;
    if (typeof val === 'string' && val.toLowerCase() === 'true') return true;
    return false;
}

// Helper to format Job Type for active timer label display
function getJobTypeLabel(type) {
    if (type === 'remote') return 'Remote Work';
    if (type === 'onsite') return 'On-Site';
    return 'Travel';
}

// Generate a v4 UUID for a log's stable cross-device identity (clientId).
function generateUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

// Save timer state to IndexedDB
function saveTimerState() {
    if (!db) return;
    if (!db.objectStoreNames.contains("timerState")) return;
    const transaction = db.transaction(["timerState"], "readwrite");
    const store = transaction.objectStore("timerState");
    const state = {
        id: "current",
        startTime: startTime,
        isRunning: isRunning,
        arrivalTime: arrivalTime,
        startMileage: startMileage,
        arrivalMileage: arrivalMileage,
        travelMileage: travelMileage,
        client: clientInput.value.trim(),
        isRemote: isRemote,
        jobType: currentJobType,
        resumeLogId: pendingResumeLogId
    };
    store.put(state);
}

// Restore timer state from IndexedDB
function restoreTimerState() {
    if (!db) return;
    if (!db.objectStoreNames.contains("timerState")) return;
    const transaction = db.transaction(["timerState"], "readonly");
    const store = transaction.objectStore("timerState");
    const request = store.get("current");

    request.onsuccess = () => {
        const state = request.result;
        if (!state || !state.isRunning) return;

        startTime = state.startTime;
        arrivalTime = state.arrivalTime;
        startMileage = state.startMileage;
        arrivalMileage = state.arrivalMileage;
        travelMileage = state.travelMileage ?? (startMileage !== null && arrivalMileage !== null ? arrivalMileage - startMileage : null);
        currentJobType = state.jobType || (isRemoteLog(state) ? 'remote' : 'travel');
        isRemote = (currentJobType === 'remote');
        pendingResumeLogId = (state.resumeLogId !== null && state.resumeLogId !== undefined) ? state.resumeLogId : null;
        isRunning = true;
        clientInput.value = state.client;
        clientInput.disabled = true;
        activeClientLabel.textContent = "Tracking (" + getJobTypeLabel(currentJobType) + "): " + state.client;

        const hasTravel = (currentJobType === 'travel');

        if (hasTravel) {
            if (arrivalTime) {
                updateTimerButtons('travel-arrived');
            } else {
                updateTimerButtons('travel-need-arrival');
            }
        } else {
            updateTimerButtons('running-onsite');
        }
        liveTimer.classList.add('running');

        arrivalBadge.classList.add('hidden');

        // If arrival time was set, show the badge
        if (arrivalTime) {
            const travelMs = arrivalTime - startTime;
            const timeString = new Date(arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            arrivalBadge.textContent = "✓ Arrived at " + timeString + " (Travel: " + formatDuration(travelMs) + ")";
            arrivalBadge.classList.remove('hidden');
        }

        timerInterval = setInterval(updateLiveDisplay, 1000);

        if (hasTravel && requestMileage && startMileage === null) {
            startMileageInput.value = '';
            startMileageModal.classList.remove('hidden');
            startMileageInput.focus();
        } else if (hasTravel && requestMileage && arrivalMileage === null && arrivalTime) {
            arrivalMileageInput.value = '';
            arrivalMileageModal.classList.remove('hidden');
            arrivalMileageInput.focus();
        }
    };
}

// Clear timer state from IndexedDB
function clearTimerState() {
    if (!db) return;
    if (!db.objectStoreNames.contains("timerState")) return;
    const transaction = db.transaction(["timerState"], "readwrite");
    const store = transaction.objectStore("timerState");
    store.delete("current");
}

const clientInput = document.getElementById('clientInput');
const liveTimer = document.getElementById('liveTimer');
const activeClientLabel = document.getElementById('activeClientLabel');
const startButtonsGroup = document.getElementById('startButtonsGroup');
const btnStartRemote = document.getElementById('btnStartRemote');
const btnStartOnSite = document.getElementById('btnStartOnSite');
const btnStartTravel = document.getElementById('btnStartTravel');
const btnEndTimer = document.getElementById('btnEndTimer');
const notesModal = document.getElementById('notesModal');
const notesInput = document.getElementById('notesInput');
const btnSaveLog = document.getElementById('btnSaveLog');
const billableInputs = document.getElementsByName('billableTime');
const logHistory = document.getElementById('logHistory');
const btnCsv = document.getElementById('btnCsv');
const csvModal = document.getElementById('csvModal');
const btnCsvExport = document.getElementById('btnCsvExport');
const btnCsvImport = document.getElementById('btnCsvImport');
const btnClear = document.getElementById('btnClear');
const clearConfirmModal = document.getElementById('clearConfirmModal');
const btnCancelClear = document.getElementById('btnCancelClear');
const btnConfirmClear = document.getElementById('btnConfirmClear');
const deleteConfirmModal = document.getElementById('deleteConfirmModal');
const btnCancelDelete = document.getElementById('btnCancelDelete');
const btnConfirmDelete = document.getElementById('btnConfirmDelete');
let pendingDeleteId = null;
const btnMarkArrival = document.getElementById('btnMarkArrival');
const arrivalBadge = document.getElementById('arrivalBadge');
const toggleMileage = document.getElementById('toggleMileage');

const btnOpenReport = document.getElementById('btnOpenReport');
const btnUserMenu = document.getElementById('btnUserMenu');
const userDropdown = document.getElementById('userDropdown');
const btnChangePasswordDropdown = document.getElementById('btnChangePasswordDropdown');
const btnLogoutDropdown = document.getElementById('btnLogoutDropdown');
const userMenuWrapper = document.getElementById('userMenuWrapper');
const reportModal = document.getElementById('reportModal');
const btnCloseReport = document.getElementById('btnCloseReport');
const reportContent = document.getElementById('reportContent');
const btnPrintReportAction = document.getElementById('btnPrintReportAction');
const printArea = document.getElementById('printArea');

const reportRangeModal = document.getElementById('reportRangeModal');
const btnCancelReportRange = document.getElementById('btnCancelReportRange');
const btnGenerateReport = document.getElementById('btnGenerateReport');
const reportRangeInputs = document.getElementsByName('reportRange');
const customRangeInputs = document.getElementById('customRangeInputs');
const reportStartDate = document.getElementById('reportStartDate');
const reportEndDate = document.getElementById('reportEndDate');

const startMileageModal = document.getElementById('startMileageModal');
const startMileageInput = document.getElementById('startMileageInput');
const btnCancelStartMileage = document.getElementById('btnCancelStartMileage');
const btnSaveStartMileage = document.getElementById('btnSaveStartMileage');

const arrivalMileageModal = document.getElementById('arrivalMileageModal');
const arrivalMileageInput = document.getElementById('arrivalMileageInput');
const btnCancelArrivalMileage = document.getElementById('btnCancelArrivalMileage');
const btnSaveArrivalMileage = document.getElementById('btnSaveArrivalMileage');

const editModal = document.getElementById('editModal');
    const editClient = document.getElementById('editClient');
    const editStartTime = document.getElementById('editStartTime');
    const editArrivalTime = document.getElementById('editArrivalTime');
    const editEndTime = document.getElementById('editEndTime');
    const editNotes = document.getElementById('editNotes');
    const editParts = document.getElementById('editParts');
    const editMileage = document.getElementById('editMileage');
    const editJobTypeInputs = document.getElementsByName('editJobType');
    const editBillableTime = document.getElementById('editBillableTime');
    const editInvoiceNumber = document.getElementById('editInvoiceNumber');
    const btnCancelEdit = document.getElementById('btnCancelEdit');
    const btnSaveEdit = document.getElementById('btnSaveEdit');

const addEntryModal = document.getElementById('addEntryModal');
    const addClient = document.getElementById('addClient');
    const addStartTime = document.getElementById('addStartTime');
    const addEndTime = document.getElementById('addEndTime');
    const addArrivalTime = document.getElementById('addArrivalTime');
    const addNotes = document.getElementById('addNotes');
    const addParts = document.getElementById('addParts');
    const addBillableTime = document.getElementById('addBillableTime');
    const addMileage = document.getElementById('addMileage');
    const addJobTypeInputs = document.getElementsByName('addJobType');
    const btnCancelAdd = document.getElementById('btnCancelAdd');
    const btnSaveAdd = document.getElementById('btnSaveAdd');

const btnAddEntry = document.getElementById('btnAddEntry');

// Invoicing mode elements
const btnInvoicingMode = document.getElementById('btnInvoicingMode');
const invoicingContainer = document.getElementById('invoicingContainer');
const invoicingGridBody = document.getElementById('invoicingGridBody');
const invoicingGrid = document.getElementById('invoicingGrid');
const btnExitInvoicing = document.getElementById('btnExitInvoicing');
const recentLogsSection = document.getElementById('recentLogsSection');
let isInvoicingMode = false;

// Auth modal elements
const authModal = document.getElementById('authModal');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authBtn = document.getElementById('authBtn');
const authError = document.getElementById('authError');
const tabLoginAuth = document.getElementById('tabLoginAuth');
const tabRegisterAuth = document.getElementById('tabRegisterAuth');
const tabChangePasswordAuth = document.getElementById('tabChangePasswordAuth');
const changePasswordSection = document.getElementById('changePasswordSection');
const changeCurrentPassword = document.getElementById('changeCurrentPassword');
const changeNewPassword = document.getElementById('changeNewPassword');
const changeConfirmPassword = document.getElementById('changeConfirmPassword');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const changePasswordError = document.getElementById('changePasswordError');
const changePasswordSuccess = document.getElementById('changePasswordSuccess');
const btnCloseAuth = document.getElementById('btnCloseAuth');
let isLoginMode = true;

const partsModal = document.getElementById('partsModal');
const partsInput = document.getElementById('partsInput');
const btnSaveParts = document.getElementById('btnSaveParts');
const btnSkipParts = document.getElementById('btnSkipParts');

function updateTimerButtons(state) {
    if (state === 'idle') {
        if (startButtonsGroup) startButtonsGroup.classList.remove('hidden');
        if (btnEndTimer) btnEndTimer.classList.add('hidden');
        btnMarkArrival.classList.add('hidden');
        arrivalBadge.classList.add('hidden');
    } else if (state === 'running-onsite') {
        if (startButtonsGroup) startButtonsGroup.classList.add('hidden');
        if (btnEndTimer) btnEndTimer.classList.remove('hidden');
        btnMarkArrival.classList.add('hidden');
    } else if (state === 'travel-need-arrival') {
        if (startButtonsGroup) startButtonsGroup.classList.add('hidden');
        if (btnEndTimer) btnEndTimer.classList.add('hidden');
        btnMarkArrival.classList.remove('hidden');
        arrivalBadge.classList.add('hidden');
    } else if (state === 'travel-arrived') {
        if (startButtonsGroup) startButtonsGroup.classList.add('hidden');
        if (btnEndTimer) btnEndTimer.classList.remove('hidden');
        btnMarkArrival.classList.add('hidden');
    }
}

function startTimer(type) {
    const clientName = clientInput.value.trim();
    if (!clientName) { alert("Please input a Client Name first."); return; }

    currentJobType = type;
    isRemote = (type === 'remote');
    const hasTravel = (type === 'travel');

    isRunning = true;
    startTime = Date.now();
    arrivalTime = null;
    startMileage = null;
    arrivalMileage = null;
    travelMileage = null;

    clientInput.disabled = true;
    activeClientLabel.textContent = "Tracking (" + getJobTypeLabel(type) + "): " + clientName;

    if (hasTravel) {
        updateTimerButtons('travel-need-arrival');
    } else {
        updateTimerButtons('running-onsite');
    }
    liveTimer.classList.add('running');

    timerInterval = setInterval(updateLiveDisplay, 1000);

    saveTimerState();

    if (hasTravel && requestMileage) {
        startMileageInput.value = '';
        startMileageModal.classList.remove('hidden');
        startMileageInput.focus();
    } else {
        startMileage = null;
    }
}

if (btnStartRemote) btnStartRemote.addEventListener('click', () => startTimer('remote'));
if (btnStartOnSite) btnStartOnSite.addEventListener('click', () => startTimer('onsite'));
if (btnStartTravel) btnStartTravel.addEventListener('click', () => startTimer('travel'));

// Resume timer against an existing log (remote entries only).
// Loads the existing entry, starts a new remote session, and on End Timer
// merges the new session's duration into the existing entry instead of
// creating a separate log.
window.resumeTimer = function(id) {
    if (isRunning) {
        alert('A timer is already running. End the current timer before starting another.');
        return;
    }
    if (!db) return;

    const transaction = db.transaction(["logs"], "readonly");
    const store = transaction.objectStore("logs");
    const request = store.get(id);

    request.onsuccess = () => {
        const log = request.result;
        if (!log) {
            alert('Could not find that log entry.');
            return;
        }
        if (!isRemoteLog(log)) {
            alert('Only remote entries can be resumed.');
            return;
        }

        pendingResumeLogId = id;
        clientInput.value = log.client;
        startTimer('remote');
    };

    request.onerror = () => {
        alert('Failed to load the log entry to resume.');
    };
};

if (btnEndTimer) {
    btnEndTimer.addEventListener('click', () => {
        clearInterval(timerInterval);
        isRunning = false;
        clearTimerState();
        updateTimerButtons('idle');
        liveTimer.classList.remove('running');
        clientInput.disabled = false;
        activeClientLabel.textContent = "";
        for (const input of billableInputs) {
            input.checked = (input.value === '1');
        }
        notesModal.classList.remove('hidden');
        notesInput.focus();
    });
}

// Mileage toggle
toggleMileage.addEventListener('change', () => {
    requestMileage = toggleMileage.checked;
    localStorage.setItem('requestMileage', requestMileage.toString());
});

// Initialize mileage toggle from localStorage
toggleMileage.checked = requestMileage;

btnMarkArrival.addEventListener('click', () => {
    if (!isRunning || currentJobType !== 'travel' || arrivalTime) return;
    arrivalTime = Date.now();
    btnMarkArrival.classList.add('hidden');

    const travelMs = arrivalTime - startTime;
    const timeString = new Date(arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    arrivalBadge.textContent = "✓ Arrived at " + timeString + " (Travel: " + formatDuration(travelMs) + ")";
    arrivalBadge.classList.remove('hidden');

    // After arrival, show the End Timer button
    if (btnEndTimer) btnEndTimer.classList.remove('hidden');

    // Show arrival mileage modal if mileage is requested
    if (requestMileage) {
        arrivalMileageInput.value = '';
        arrivalMileageModal.classList.remove('hidden');
        arrivalMileageInput.focus();
    } else {
        arrivalMileage = null;
    }

    saveTimerState();
});

function updateLiveDisplay() {
    const elapsedMs = Date.now() - startTime;
    liveTimer.textContent = formatDuration(elapsedMs);
}

function formatDuration(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const hrs = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
    const mins = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');
    return hrs + ":" + mins + ":" + secs;
}

function formatDecimalQuarter(ms) {
    const totalMinutes = ms / 1000 / 60;
    const quarterHours = Math.ceil(totalMinutes / 15) * 15 / 60;
    return quarterHours.toFixed(2).replace(/\.00$/, '');
}

function formatBillableTime(travelMs, onSiteMs, durationMs) {
    let totalMs;
    if (travelMs && onSiteMs) {
        totalMs = travelMs + onSiteMs;
    } else if (durationMs) {
        totalMs = durationMs;
    } else {
        return '1';
    }
    const totalMinutes = totalMs / 1000 / 60;
    const quarterHours = Math.max(1, Math.ceil(totalMinutes / 15) * 15 / 60);
    return quarterHours.toFixed(2).replace(/\.00$/, '');
}

let pendingEndTime = null;
let pendingNotes = "";
let pendingBillableTime = "1";

btnSaveLog.addEventListener('click', () => {
    pendingEndTime = Date.now();

    let selectedBillableTime = '1';
    for (const input of billableInputs) {
        if (input.checked) {
            selectedBillableTime = input.value;
            break;
        }
    }

    pendingNotes = notesInput.value.trim() || "No notes provided.";
    pendingBillableTime = selectedBillableTime;

    notesModal.classList.add('hidden');

    if (isRemote) {
        if (pendingResumeLogId !== null) {
            mergeResumeIntoLog();
        } else {
            finalizeAndSaveLog("");
        }
    } else {
        partsInput.value = '';
        partsModal.classList.remove('hidden');
        partsInput.focus();
    }
});

function finalizeAndSaveLog(partsText) {
    const durationMs = pendingEndTime - startTime;
    let formattedArrivalTime = null;

    if (arrivalTime) {
        formattedArrivalTime = new Date(arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const now = Date.now();
    const newLog = {
        client: clientInput.value.trim(),
        start: new Date(startTime).toLocaleString(),
        end: new Date(pendingEndTime).toLocaleString(),
        startMs: startTime,
        endMs: pendingEndTime,
        arrivalMs: arrivalTime || null,
        duration: formatDuration(durationMs),
        durationMs: durationMs,
        decimalHours: (durationMs / (1000 * 60 * 60)).toFixed(2),
        notes: pendingNotes,
        parts: partsText || "",
        billableTime: pendingBillableTime,
        arrivalTime: formattedArrivalTime,
        travelDurationMs: arrivalTime ? arrivalTime - startTime : null,
        onSiteDurationMs: arrivalTime ? pendingEndTime - arrivalTime : null,
        startMileage: startMileage,
        arrivalMileage: arrivalMileage,
        travelMileage: travelMileage,
        isRemote: isRemote,
        invoiceNumber: "",
        clientId: generateUuid(),
        updatedAt: now,
        lastSyncedUpdatedAt: null
    };

    btnSaveParts.disabled = true;
    btnSkipParts.disabled = true;

    const transaction = db.transaction(["logs"], "readwrite");
    const store = transaction.objectStore("logs");
    store.add(newLog);

    transaction.oncomplete = () => {
        btnSaveParts.disabled = false;
        btnSkipParts.disabled = false;

        isRunning = false;
        clearInterval(timerInterval);
        clearTimerState();
        liveTimer.textContent = "00:00:00";
        activeClientLabel.textContent = "";
        clientInput.value = "";
        clientInput.disabled = false;
        notesInput.value = "";
        partsInput.value = "";

        for (const input of billableInputs) {
            input.checked = (input.value === '1');
        }

        updateTimerButtons('idle');
        liveTimer.classList.remove('running');

        arrivalTime = null;
        startMileage = null;
        arrivalMileage = null;
        travelMileage = null;
        isRemote = false;
        currentJobType = 'travel';

        partsModal.classList.add('hidden');
        renderLogs();
        syncAfterWrite();
    };

    transaction.onerror = () => {
        btnSaveParts.disabled = false;
        btnSkipParts.disabled = false;
        alert('Failed to save the time log. Please try again.');
    };
}

// Mark an existing log entry as locally mutated:
// - lastSyncedUpdatedAt = null reuses the "never confirmed by the server" marker
//   (the same one used for brand-new entries and CSV imports), so the row is
//   ALWAYS included in the next syncToCloud push — an edit always produces a
//   network request, no matter how recent or clock-skewed the last ack was.
// - updatedAt is bumped to at least 'lastSyncedUpdatedAt + 1s' so the push
//   passes the server's strict conflict check even when the server-confirmed
//   timestamp is ahead of the local clock (the worker truncates the timestamp
//   to '.000', so +1s guarantees a strictly-greater value).
function markLogDirty(log) {
    const now = Date.now();
    const lastConfirmed = (typeof log.lastSyncedUpdatedAt === 'number' && log.lastSyncedUpdatedAt > 0) ? log.lastSyncedUpdatedAt : 0;
    log.updatedAt = Math.max(now, lastConfirmed + 1000);
    log.lastSyncedUpdatedAt = null;
}

// Merge a resumed remote session's timing into the existing log entry
// instead of creating a new one. Extends endMs / durationMs by the new
// session length and appends the new session's notes.
function mergeResumeIntoLog() {
    if (pendingResumeLogId === null || !db) return;

    const resumeId = pendingResumeLogId;
    const sessionDurationMs = pendingEndTime - startTime;

    btnSaveLog.disabled = true;

    const transaction = db.transaction(["logs"], "readwrite");
    const store = transaction.objectStore("logs");
    const request = store.get(resumeId);

    request.onsuccess = () => {
        const log = request.result;
        if (!log) {
            btnSaveLog.disabled = false;
            pendingResumeLogId = null;
            alert('Could not find the original log entry to merge into.');
            return;
        }

        const newEnd = pendingEndTime;
        const newDurationMs = (log.durationMs || 0) + sessionDurationMs;

        log.end = new Date(newEnd).toLocaleString();
        log.endMs = newEnd;
        log.durationMs = newDurationMs;
        log.duration = formatDuration(newDurationMs);
        log.decimalHours = (newDurationMs / (1000 * 60 * 60)).toFixed(2);

        const sessionNote = pendingNotes;
        if (sessionNote && sessionNote !== 'No notes provided.') {
            const existing = (log.notes && log.notes !== 'No notes provided.') ? log.notes : '';
            log.notes = existing ? (existing + ' | ' + sessionNote) : sessionNote;
        }

        if (pendingBillableTime && pendingBillableTime !== '1') {
            const existingBillable = parseFloat(log.billableTime);
            const newBillable = parseFloat(pendingBillableTime);
            if (!isNaN(existingBillable) && !isNaN(newBillable)) {
                const combined = (existingBillable + newBillable).toFixed(2);
                log.billableTime = combined.replace(/\.00$/, '');
            } else {
                log.billableTime = pendingBillableTime;
            }
        }

        markLogDirty(log);

        const putRequest = store.put(log);
        putRequest.onerror = () => {
            btnSaveLog.disabled = false;
            pendingResumeLogId = null;
            alert('Failed to merge the resumed session into the log entry.');
        };
    };

    request.onerror = () => {
        btnSaveLog.disabled = false;
        pendingResumeLogId = null;
        alert('Failed to load the log entry to merge into.');
    };

    transaction.oncomplete = () => {
        btnSaveLog.disabled = false;
        pendingResumeLogId = null;

        isRunning = false;
        clearInterval(timerInterval);
        clearTimerState();
        liveTimer.textContent = "00:00:00";
        activeClientLabel.textContent = "";
        clientInput.value = "";
        clientInput.disabled = false;
        notesInput.value = "";

        for (const input of billableInputs) {
            input.checked = (input.value === '1');
        }

        updateTimerButtons('idle');
        liveTimer.classList.remove('running');

        arrivalTime = null;
        startMileage = null;
        arrivalMileage = null;
        travelMileage = null;
        isRemote = false;
        currentJobType = 'travel';

        renderLogs();
        syncAfterWrite();
    };

    transaction.onerror = () => {
        btnSaveLog.disabled = false;
        pendingResumeLogId = null;
        alert('Failed to merge the resumed session into the log entry.');
    };
}

btnSaveParts.addEventListener('click', () => {
    finalizeAndSaveLog(partsInput.value.trim());
});

btnSkipParts.addEventListener('click', () => {
    finalizeAndSaveLog("");
});

btnCancelStartMileage.addEventListener('click', () => {
    startMileageModal.classList.add('hidden');
});

btnSaveStartMileage.addEventListener('click', () => {
    const startValue = startMileageInput.value.trim();
    if (startValue && parseFloat(startValue) >= 0) {
        startMileage = parseFloat(startValue);
    } else {
        startMileage = null;
    }
    startMileageModal.classList.add('hidden');
    saveTimerState();
});

btnCancelArrivalMileage.addEventListener('click', () => {
    arrivalMileageModal.classList.add('hidden');
});

btnSaveArrivalMileage.addEventListener('click', () => {
    const arrivalValue = arrivalMileageInput.value.trim();
    if (arrivalValue && parseFloat(arrivalValue) >= 0) {
        arrivalMileage = parseFloat(arrivalValue);
        if (startMileage !== null && arrivalMileage !== null) {
            travelMileage = arrivalMileage - startMileage;
        }
    } else {
        arrivalMileage = null;
        travelMileage = null;
    }
    arrivalMileageModal.classList.add('hidden');
    saveTimerState();
});

btnClear.addEventListener('click', () => {
    clearConfirmModal.classList.remove('hidden');
});

btnCancelClear.addEventListener('click', () => {
    clearConfirmModal.classList.add('hidden');
});

btnConfirmClear.addEventListener('click', () => {
    if (!db) return;
    const transaction = db.transaction(["logs"], "readwrite");
    const store = transaction.objectStore("logs");
    const getAllRequest = store.getAll();

    getAllRequest.onsuccess = () => {
        const logs = getAllRequest.result;
        let pending = logs.length;
        if (pending === 0) {
            clearConfirmModal.classList.add('hidden');
            renderLogs();
            return;
        }
        logs.forEach(log => {
            log._deleted = true;
            const putRequest = store.put(log);
            putRequest.onsuccess = () => {
                pending--;
                if (pending === 0) {
                    clearConfirmModal.classList.add('hidden');
                    renderLogs();
                    syncAfterWrite();
                }
            };
            putRequest.onerror = () => {
                pending--;
                if (pending === 0) {
                    clearConfirmModal.classList.add('hidden');
                    renderLogs();
                    syncAfterWrite();
                }
            };
        });
    };
    getAllRequest.onerror = () => {
        alert("Failed to clear database logs.");
    };
});

function renderLogs() {
    if (!db) return;
    const store = db.transaction(["logs"], "readonly").objectStore("logs");
    const request = store.getAll();

    request.onsuccess = () => {
        const logs = request.result.filter(log => !log._deleted).sort((a, b) => {
            const aTime = (a.startMs != null) ? a.startMs : parseToDate(a.start)?.getTime();
            const bTime = (b.startMs != null) ? b.startMs : parseToDate(b.start)?.getTime();
            return (bTime || 0) - (aTime || 0);
        });
        if (logs.length === 0) {
            logHistory.innerHTML = '<div class="empty-state">No logged hours found.</div>';
            btnClear.classList.add('hidden');
            if (isInvoicingMode) renderInvoicingMode();
            return;
        }

        btnClear.classList.remove('hidden');
        let html = "";
        logs.forEach(log => {
            const isRemoteEntry = isRemoteLog(log);
            html += '<div class="log-card">';
            html += '<div class="log-card-header">';
            html += '<div><h4 class="log-client-name">' + escapeHtml(log.client) + '</h4>';
            if (isRemoteEntry) {
                html += '<span class="remote-badge">Remote</span>';
            }
            html += '<p class="log-timestamp">' + escapeHtml(log.start) + '</p></div>';
            html += '<span class="duration-pill">' + escapeHtml(log.duration) + ' (' + escapeHtml(log.decimalHours) + 'h)</span>';
            html += '</div>';

            if (!isRemoteEntry && log.travelDurationMs !== null && log.travelDurationMs !== undefined && log.onSiteDurationMs !== null && log.onSiteDurationMs !== undefined) {
                const travelDur = formatDuration(log.travelDurationMs);
                const onSiteDur = formatDuration(log.onSiteDurationMs);
                html += '<div class="log-travel-details">';
                html += '<span>🚗 Travel: ' + escapeHtml(travelDur) + '</span>';
                html += '<span>💼 Client: ' + escapeHtml(onSiteDur) + '</span>';
                html += '</div>';
            }

            if (!isRemoteEntry && log.travelMileage !== null && log.travelMileage !== undefined) {
                html += '<div class="log-travel-details"><span>🚗 Travel Miles: ' + log.travelMileage + ' mi</span></div>';
            }

            if (log.billableTime && log.billableTime !== '1') {
                const billableDisplay = log.billableTime === 'sales call' ? log.billableTime : log.billableTime + 'h';
                html += '<p class="log-notes"><strong>Billable:</strong> ' + escapeHtml(billableDisplay) + ' | "' + escapeHtml(log.notes) + '"</p>';
            } else {
                html += '<p class="log-notes">"' + escapeHtml(log.notes) + '"</p>';
            }

            if (log.parts && log.parts.trim() !== '') {
                html += '<p class="log-notes" style="margin-top: 0.25rem;"><strong>Parts Used:</strong> ' + escapeHtml(log.parts) + '</p>';
            }
            html += '<div class="flex-row-gap" style="margin-top: 0.5rem;">';
            if (isRemoteEntry) {
                const disabledAttr = isRunning ? ' disabled' : '';
                const disabledTitle = isRunning ? ' title="A timer is already running"' : '';
                html += '<button class="btn-action start-remote" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;" onclick="resumeTimer(' + log.id + ')"' + disabledAttr + disabledTitle + '>Resume</button>';
            }
            html += '<button class="btn-action start" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;" onclick="editLog(' + log.id + ')">Edit</button>';
            html += '<button class="btn-action stop" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;" onclick="deleteLog(' + log.id + ')">Delete</button>';
            html += '</div>';
            html += '</div>';
        });
        logHistory.innerHTML = html;
        if (isInvoicingMode) renderInvoicingMode();
    };

    request.onerror = () => {
        logHistory.innerHTML = '<div class="empty-state">Failed to load logs.</div>';
    };
}

// Helper function to safely parse a date string or timestamp
function parseToDate(dateVal) {
    if (!dateVal) return null;
    let d = new Date(dateVal);
    return isNaN(d.getTime()) ? null : d;
}

// Helper function to format Date object into YYYY-MM-DDTHH:mm for datetime-local input
function formatDateTimeLocal(d) {
    if (!d || isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function setJobTypeEntryFields(jobType, arrivalInput, mileageInput) {
    const isTravel = (jobType === 'travel');
    const isRemote = (jobType === 'remote');
    arrivalInput.disabled = isRemote;
    mileageInput.disabled = !isTravel;
    if (isRemote) {
        arrivalInput.value = '';
        mileageInput.value = '';
    } else if (!isTravel) {
        mileageInput.value = '';
    }
}

for (const input of editJobTypeInputs) {
    input.addEventListener('change', () => {
        setJobTypeEntryFields(input.value, editArrivalTime, editMileage);
    });
}

for (const input of addJobTypeInputs) {
    input.addEventListener('change', () => {
        setJobTypeEntryFields(input.value, addArrivalTime, addMileage);
    });
}

// Edit log function
window.editLog = function(id) {
    const transaction = db.transaction(["logs"], "readwrite");
    const store = transaction.objectStore("logs");
    const request = store.get(id);

    request.onsuccess = () => {
        const log = request.result;
        if (!log) return;

        editingLogId = id;

        editClient.value = log.client;
        editNotes.value = log.notes;
        editParts.value = log.parts || '';
        editBillableTime.value = log.billableTime;
        editInvoiceNumber.value = log.invoiceNumber || '';

        const isRemoteVal = isRemoteLog(log);
        let jobType = 'travel';
        if (isRemoteVal) {
            jobType = 'remote';
        } else if (!log.arrivalTime && (log.travelMileage === null || log.travelMileage === undefined)) {
            jobType = 'onsite';
        }

        for (const input of editJobTypeInputs) {
            input.checked = (input.value === jobType);
        }

        editMileage.value = (jobType === 'travel' && log.travelMileage !== null && log.travelMileage !== undefined) ? log.travelMileage : '';
        setJobTypeEntryFields(jobType, editArrivalTime, editMileage);

        const startDate = (log.startMs !== null && log.startMs !== undefined)
            ? new Date(log.startMs)
            : parseToDate(log.start);
        editStartTime.value = formatDateTimeLocal(startDate);

        if (log.arrivalMs !== null && log.arrivalMs !== undefined) {
            editArrivalTime.value = formatDateTimeLocal(new Date(log.arrivalMs));
        } else if (log.arrivalTime && log.arrivalTime.trim() !== '') {
            const timeMatch = log.arrivalTime.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch && startDate) {
                let hours = parseInt(timeMatch[1], 10);
                const minutes = timeMatch[2];

                if (log.arrivalTime.includes('PM') && hours !== 12) {
                    hours += 12;
                }
                if (log.arrivalTime.includes('AM') && hours === 12) {
                    hours = 0;
                }

                const arrivalDate = new Date(startDate.getTime());
                arrivalDate.setHours(hours, parseInt(minutes, 10), 0, 0);
                editArrivalTime.value = formatDateTimeLocal(arrivalDate);
            } else {
                editArrivalTime.value = '';
            }
        } else {
            editArrivalTime.value = '';
        }

        const endDate = (log.endMs !== null && log.endMs !== undefined)
            ? new Date(log.endMs)
            : parseToDate(log.end);
        editEndTime.value = formatDateTimeLocal(endDate);

        editModal.classList.remove('hidden');
    };

    request.onerror = () => {
        alert('Failed to load the log entry for editing.');
    };
    transaction.onerror = () => {
        alert('Database error while loading log entry for editing.');
    };
};

// Delete log function
window.deleteLog = function(id) {
    pendingDeleteId = id;
    deleteConfirmModal.classList.remove('hidden');
};

btnCancelDelete.addEventListener('click', () => {
    pendingDeleteId = null;
    deleteConfirmModal.classList.add('hidden');
});

btnConfirmDelete.addEventListener('click', () => {
    if (pendingDeleteId === null || !db) {
        deleteConfirmModal.classList.add('hidden');
        return;
    }

    btnConfirmDelete.disabled = true;
    const transaction = db.transaction(["logs"], "readwrite");
    const store = transaction.objectStore("logs");

    const getRequest = store.get(pendingDeleteId);
    getRequest.onsuccess = () => {
        const log = getRequest.result;
        if (!log) {
            btnConfirmDelete.disabled = false;
            pendingDeleteId = null;
            deleteConfirmModal.classList.add('hidden');
            return;
        }
        log._deleted = true;
        const putRequest = store.put(log);
        putRequest.onsuccess = () => {
            btnConfirmDelete.disabled = false;
            pendingDeleteId = null;
            deleteConfirmModal.classList.add('hidden');
            renderLogs();
            syncAfterWrite();
        };
        putRequest.onerror = () => {
            btnConfirmDelete.disabled = false;
            deleteConfirmModal.classList.add('hidden');
            alert('Failed to delete log entry.');
        };
    };
    getRequest.onerror = () => {
        btnConfirmDelete.disabled = false;
        deleteConfirmModal.classList.add('hidden');
        alert('Failed to delete log entry.');
    };
});

// Save edit
btnSaveEdit.addEventListener('click', () => {
    if (!editingLogId) return;

    const clientVal = editClient.value.trim();
    if (!clientVal || !editStartTime.value || !editEndTime.value) {
        alert("Client Name, Start Time, and End Time are required.");
        return;
    }

    let selectedJobType = 'travel';
    for (const input of editJobTypeInputs) {
        if (input.checked) { selectedJobType = input.value; break; }
    }

    const start = new Date(editStartTime.value);
    const end = new Date(editEndTime.value);
    const isRemoteEntry = (selectedJobType === 'remote');
    const arrival = editArrivalTime.value ? new Date(editArrivalTime.value) : null;

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || (arrival && isNaN(arrival.getTime()))) {
        alert("One of the date/time fields is invalid.");
        return;
    }
    if (end <= start) {
        alert("End Time must be after Start Time.");
        return;
    }
    if (arrival && (arrival < start || arrival > end)) {
        alert("Arrival Time must be between Start Time and End Time.");
        return;
    }

    btnSaveEdit.disabled = true;

    const transaction = db.transaction(["logs"], "readwrite");
    const store = transaction.objectStore("logs");
    const request = store.get(editingLogId);

    request.onsuccess = () => {
        const log = request.result;
        if (!log) { btnSaveEdit.disabled = false; return; }

        let selectedBillableTime = editBillableTime.value ? editBillableTime.value : '1';

        log.client = clientVal;
        log.notes = editNotes.value.trim() || "No notes provided.";
        log.parts = editParts.value ? editParts.value.trim() : '';
        log.billableTime = selectedBillableTime;
        log.invoiceNumber = editInvoiceNumber.value.trim();
        log.travelMileage = (selectedJobType === 'travel' && editMileage.value !== '') ? parseFloat(editMileage.value) : null;
        log.isRemote = isRemoteEntry;

        log.start = start.toLocaleString();
        log.end = end.toLocaleString();
        log.startMs = start.getTime();
        log.endMs = end.getTime();

        if (selectedJobType === 'remote') {
            log.arrivalTime = null;
            log.arrivalMs = null;
            log.travelDurationMs = null;
            log.onSiteDurationMs = null;
            log.startMileage = null;
            log.arrivalMileage = null;
            log.travelMileage = null;
        } else if (arrival) {
            log.arrivalTime = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            log.arrivalMs = arrival.getTime();
            log.travelDurationMs = arrival - start;
            log.onSiteDurationMs = end - arrival;
        } else {
            log.arrivalTime = null;
            log.arrivalMs = null;
            log.travelDurationMs = null;
            log.onSiteDurationMs = null;
        }

        log.durationMs = end - start;
        log.decimalHours = (log.durationMs / (1000 * 60 * 60)).toFixed(2);
        log.duration = formatDuration(log.durationMs);
        markLogDirty(log);

        const putRequest = store.put(log);
        putRequest.onsuccess = () => {
            btnSaveEdit.disabled = false;
            editModal.classList.add('hidden');
            editingLogId = null;
            renderLogs();
            syncAfterWrite();
        };
        putRequest.onerror = () => {
            btnSaveEdit.disabled = false;
            alert('Failed to save changes. Please try again.');
        };
    };

    request.onerror = () => {
        btnSaveEdit.disabled = false;
        alert('Failed to load the log entry for editing.');
    };
});

btnCancelEdit.addEventListener('click', () => {
    editModal.classList.add('hidden');
    editingLogId = null;
});

// Add entry modal
btnAddEntry.addEventListener('click', () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const currentTime = now.toTimeString().slice(0, 8);

    addStartTime.value = today + 'T' + currentTime;
    addEndTime.value = today + 'T' + currentTime;
    addArrivalTime.value = '';
    addClient.value = '';
    addNotes.value = '';
    addParts.value = '';
    addBillableTime.value = '';
    addMileage.value = '';
    for (const input of addJobTypeInputs) {
        input.checked = (input.value === 'travel');
    }
    setJobTypeEntryFields('travel', addArrivalTime, addMileage);
    addEntryModal.classList.remove('hidden');
});

btnCancelAdd.addEventListener('click', () => {
    addEntryModal.classList.add('hidden');
});

btnSaveAdd.addEventListener('click', () => {
    const client = addClient.value.trim();
    const startTimeVal = addStartTime.value;
    const endTimeVal = addEndTime.value;
    const arrivalTimeVal = addArrivalTime.value;
    const notes = addNotes.value.trim() || "No notes provided.";

    if (!client || !startTimeVal || !endTimeVal) {
        alert("Please fill in all required fields.");
        return;
    }

    let selectedJobType = 'travel';
    for (const input of addJobTypeInputs) {
        if (input.checked) { selectedJobType = input.value; break; }
    }

    let selectedBillableTime = addBillableTime.value || '1';

    const start = new Date(startTimeVal);
    const end = new Date(endTimeVal);
    const isRemoteEntry = (selectedJobType === 'remote');
    const hasTravel = (selectedJobType === 'travel');
    const arrival = hasTravel && arrivalTimeVal ? new Date(arrivalTimeVal) : null;

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || (arrival && isNaN(arrival.getTime()))) {
        alert("One of the date/time fields is invalid.");
        return;
    }
    if (end <= start) {
        alert("End Time must be after Start Time.");
        return;
    }
    if (arrival && (arrival < start || arrival > end)) {
        alert("Arrival Time must be between Start Time and End Time.");
        return;
    }

    const durationMs = end - start;

    let formattedArrivalTime = null;
    let travelDurationMs = null;
    let onSiteDurationMs = null;

    if (hasTravel && arrival) {
        formattedArrivalTime = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        travelDurationMs = arrival - start;
        onSiteDurationMs = end - arrival;
    }

    let selectedTravelMileage = null;
    if (hasTravel && addMileage.value.trim() !== '') {
        const mileageVal = parseFloat(addMileage.value);
        if (isNaN(mileageVal) || mileageVal < 0) {
            alert('Travel Miles must be a non-negative number.');
            return;
        }
        selectedTravelMileage = mileageVal;
    }

    const newLog = {
        client: client,
        start: start.toLocaleString(),
        end: end.toLocaleString(),
        startMs: start.getTime(),
        endMs: end.getTime(),
        arrivalMs: arrival ? arrival.getTime() : null,
        duration: formatDuration(durationMs),
        durationMs: durationMs,
        decimalHours: (durationMs / (1000 * 60 * 60)).toFixed(2),
        notes: notes,
        parts: addParts.value ? addParts.value.trim() : '',
        billableTime: selectedBillableTime,
        arrivalTime: formattedArrivalTime,
        travelDurationMs: travelDurationMs,
        onSiteDurationMs: onSiteDurationMs,
        travelMileage: selectedTravelMileage,
        isRemote: isRemoteEntry,
        invoiceNumber: "",
        clientId: generateUuid(),
        updatedAt: Date.now(),
        lastSyncedUpdatedAt: null
    };

    btnSaveAdd.disabled = true;

    const transaction = db.transaction(["logs"], "readwrite");
    const store = transaction.objectStore("logs");
    store.add(newLog);

    transaction.oncomplete = () => {
        btnSaveAdd.disabled = false;
        addEntryModal.classList.add('hidden');
        renderLogs();
        syncAfterWrite();
    };

    transaction.onerror = () => {
        btnSaveAdd.disabled = false;
        alert('Failed to save the entry. Please try again.');
    };
});

btnCsv.addEventListener('click', () => {
    csvModal.classList.remove('hidden');
});

btnCsvExport.addEventListener('click', () => {
    csvModal.classList.add('hidden');
    exportToCSV();
});

btnCsvImport.addEventListener('click', () => {
    csvModal.classList.add('hidden');
    btnImportCsv.click();
});

btnOpenReport.addEventListener('click', () => {
    reportRangeModal.classList.remove('hidden');
});

// Helper function to parse duration string to milliseconds
function parseDurationToMs(durationStr) {
    if (!durationStr || durationStr.trim() === '') return null;
    const parts = durationStr.split(':');
    if (parts.length === 3) {
        const hrs = parseInt(parts[0], 10);
        const mins = parseInt(parts[1], 10);
        const secs = parseInt(parts[2], 10);
        return (hrs * 3600 + mins * 60 + secs) * 1000;
    }
    return null;
}

// Import CSV functionality
const btnImportCsv = document.getElementById('btnImportCsv');

btnImportCsv.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

const reader = new FileReader();
reader.onload = function(e) {
    const content = e.target.result;
    const csvContent = content.replace(/\ufeff/, '');
    const lines = parseCsvLines(csvContent);

if (lines.length < 2) {
    alert('Invalid CSV file. File must have headers and at least one data row.');
    btnImportCsv.value = '';
    return;
}

    const headers = lines[0].split(',');
    const legacyHeaderCount = 15;
    const currentHeaderCount = 19;
    const invoiceHeaderCount = 20;
    const updatedAtHeaderCount = 21;

    if (headers.length !== legacyHeaderCount && headers.length !== currentHeaderCount && headers.length !== invoiceHeaderCount && headers.length !== updatedAtHeaderCount) {
        alert('Invalid CSV format. Expected ' + legacyHeaderCount + ', ' + currentHeaderCount + ', ' + invoiceHeaderCount + ', or ' + updatedAtHeaderCount + ' columns, found ' + headers.length + '.');
        btnImportCsv.value = '';
        return;
    }

const newLogs = [];
for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(lines[i]);
    if (row.length >= 14) {
    const durationStr = row[5].replace(/^\"|\"$/g, '');
    const travelDurStr = row[6].replace(/^\"|\"$/g, '');
    const onSiteDurStr = row[7].replace(/^\"|\"$/g, '');
    const startStr = row[2].replace(/^\"|\"$/g, '');
    const endStr = row[4].replace(/^\"|\"$/g, '');
    const arrivalStr = row[3].replace(/^\"|\"$/g, '') || null;

    const isLegacy = row.length === 15;
    const hasInvoice = row.length === 20;
    const hasUpdatedAt = row.length === 21;
    const notesIdx = isLegacy ? 13 : 14;
    const partsIdx = isLegacy ? 14 : 15;
    const startIsoIdx = isLegacy ? null : 16;
    const endIsoIdx = isLegacy ? null : 17;
    const arrivalIsoIdx = isLegacy ? null : 18;
    const remoteIdx = isLegacy ? null : 13;
    const invoiceIdx = hasInvoice ? 19 : null;
    const updatedAtIdx = hasUpdatedAt ? 20 : null;

    const startIso = startIsoIdx !== null && row[startIsoIdx] ? row[startIsoIdx].replace(/^\"|\"$/g, '') : '';
    const endIso = endIsoIdx !== null && row[endIsoIdx] ? row[endIsoIdx].replace(/^\"|\"$/g, '') : '';
    const arrivalIso = arrivalIsoIdx !== null && row[arrivalIsoIdx] ? row[arrivalIsoIdx].replace(/^\"|\"$/g, '') : '';
    const updatedAtIso = updatedAtIdx !== null && row[updatedAtIdx] ? row[updatedAtIdx].replace(/^\"|\"$/g, '') : '';

    const startMs = startIso ? new Date(startIso).getTime() : new Date(startStr).getTime();
    const endMs = endIso ? new Date(endIso).getTime() : new Date(endStr).getTime();
    const arrivalMs = arrivalIso ? new Date(arrivalIso).getTime() : (arrivalStr ? new Date(arrivalStr).getTime() : NaN);
    const updatedAtMs = updatedAtIso ? new Date(updatedAtIso).getTime() : NaN;

const log = {
        client: row[1].replace(/^\"|\"$/g, ''),
        start: startStr,
        startMs: isNaN(startMs) ? null : startMs,
        arrivalTime: arrivalStr,
        arrivalMs: isNaN(arrivalMs) ? null : arrivalMs,
        end: endStr,
        endMs: isNaN(endMs) ? null : endMs,
        duration: durationStr,
        durationMs: parseDurationToMs(durationStr),
        decimalHours: row[8] || '0',
        notes: row[notesIdx].replace(/^\"|\"$/g, ''),
        parts: row[partsIdx] ? row[partsIdx].replace(/^\"|\"$/g, '') : '',
        billableTime: row[9].replace(/^\"|\"$/g, '') || '1',
        travelDurationMs: parseDurationToMs(travelDurStr),
        onSiteDurationMs: parseDurationToMs(onSiteDurStr),
        startMileage: row[10] !== '' ? parseFloat(row[10]) : null,
        arrivalMileage: row[11] !== '' ? parseFloat(row[11]) : null,
        travelMileage: row[12] !== '' ? parseFloat(row[12]) : null,
         isRemote: remoteIdx !== null ? (row[remoteIdx].replace(/^\"|\"$/g, '').toLowerCase() === 'true') : false,
         invoiceNumber: invoiceIdx !== null ? row[invoiceIdx].replace(/^\"|\"$/g, '') : "",
         clientId: generateUuid(),
         updatedAt: isNaN(updatedAtMs) ? null : updatedAtMs,
         lastSyncedUpdatedAt: null
    };
    newLogs.push(log);
    }
}

if (newLogs.length === 0) {
    alert('No valid entries found in CSV file.');
    btnImportCsv.value = '';
    return;
}

const transaction = db.transaction(["logs"], "readwrite");
const store = transaction.objectStore("logs");
newLogs.forEach(log => store.add(log));

transaction.oncomplete = () => {
    alert('Successfully imported ' + newLogs.length + ' entries.');
    btnImportCsv.value = '';
    renderLogs();
};

transaction.onerror = () => {
    alert('Error importing CSV file.');
    btnImportCsv.value = '';
};
};

reader.onerror = () => {
    alert('Error reading file.');
    btnImportCsv.value = '';
};

reader.readAsText(file);
});

function parseCsvLines(csvText) {
    const lines = [];
    let currentLine = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        if (char === '"') {
            inQuotes = !inQuotes;
            currentLine += char;
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && csvText[i + 1] === '\n') {
                i++;
            }
            if (currentLine.trim() !== '') {
                lines.push(currentLine);
            }
            currentLine = '';
        } else {
            currentLine += char;
        }
    }
    if (currentLine.trim() !== '') {
        lines.push(currentLine);
    }
    return lines;
}

function parseCsvRow(row) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
        const char = row[i];

        if (char === '"' && !inQuotes) {
            inQuotes = true;
        } else if (char === '"' && inQuotes) {
            if (row[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = false;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

btnCloseReport.addEventListener('click', () => {
    reportModal.classList.add('hidden');
});

let originalTitle = document.title;

const ROWS_PER_PAGE_ONSITE = 12;
const ROWS_PER_PAGE_REMOTE = 16;

function buildPrintArea() {
    const sections = reportContent.querySelectorAll('.report-section');
    if (sections.length === 0) {
        printArea.innerHTML = '';
        return;
    }

    // Multi-section approach: each section has a title and a table
    const firstTable = sections[0].querySelector('table.report-table');
    if (!firstTable) {
        printArea.innerHTML = '';
        return;
    }
    const thead = firstTable.querySelector('thead');
    const theadHtml = thead ? thead.outerHTML : '';

    let tablesHtml = '';
    let isFirstSection = true;

    sections.forEach((section) => {
        const titleEl = section.querySelector('.report-section-title');
        const titleHtml = titleEl ? titleEl.outerHTML : '';
        const rows = Array.from(section.querySelectorAll('table.report-table tbody tr'));
        if (rows.length === 0) return;

        const isRemoteSection = section.classList.contains('report-section-remote');
        const rowsPerPage = isRemoteSection ? ROWS_PER_PAGE_REMOTE : ROWS_PER_PAGE_ONSITE;

        for (let i = 0; i < rows.length; i += rowsPerPage) {
            const chunk = rows.slice(i, i + rowsPerPage);

            // Add title before the first page of each section
            if (i === 0 && titleHtml) {
                if (!isFirstSection) {
                    tablesHtml += '<div class="report-page-break"></div>';
                }
                tablesHtml += titleHtml;
                isFirstSection = false;
            }

            const pageBreak = i > 0 ? ' report-page-break' : '';
            tablesHtml += '<table class="report-table' + pageBreak + '">';
            tablesHtml += theadHtml + '<tbody>';
            chunk.forEach(row => { tablesHtml += row.outerHTML; });
            tablesHtml += '</tbody></table>';
        }
    });

    printArea.innerHTML = '<div class="print-report-title">Billing Summary</div>' + tablesHtml;
    const summaryDiv = reportContent.querySelector('.report-summary-container');
    if (summaryDiv) {
        printArea.innerHTML += summaryDiv.outerHTML;
    }
}

function setPrintTitle() {
    originalTitle = document.title;
    const todayStr = new Date().toISOString().slice(0, 10);
    document.title = "billing-report-" + todayStr;
}

function restorePrintTitle() {
    document.title = originalTitle || "Time Tracker";
}

window.addEventListener('beforeprint', () => {
    if (reportModal && !reportModal.classList.contains('hidden')) {
        setPrintTitle();
        buildPrintArea();
    }
});

window.addEventListener('afterprint', () => {
    restorePrintTitle();
    printArea.innerHTML = '';
});

btnPrintReportAction.addEventListener('click', () => {
    if (!reportModal.classList.contains('hidden')) {
        setPrintTitle();
        buildPrintArea();
    }
    setTimeout(() => {
        window.print();
    }, 100);
});

function exportToCSV() {
    if (!db) return;
    const store = db.transaction(["logs"], "readonly").objectStore("logs");
    const request = store.getAll();

    request.onsuccess = function(e) {
        const logs = e.target.result.filter(log => !log._deleted);
        if (logs.length === 0) {
            alert("There is no data recorded to export.");
            return;
        }

        const headers = ["ID", "Client", "Start Time", "Arrival Time", "End Time", "Total Duration", "Travel Duration", "On-Site Duration", "Decimal Hours", "Billable Time", "Start Mileage", "Arrival Mileage", "Travel Miles", "Remote", "Notes", "Parts Used", "Start ISO", "End ISO", "Arrival ISO", "Invoice Number", "Updated At"];
        const csvRows = [headers.join(",")];

        const mi = (v) => (v !== null && v !== undefined) ? v : "";

        logs.forEach(log => {
            const row = [
                log.id,
                '"' + log.client.replace(/"/g, '""') + '"',
                '"' + log.start + '"',
                '"' + (log.arrivalTime || "") + '"',
                '"' + log.end + '"',
                '"' + log.duration + '"',
                '"' + (log.travelDurationMs !== null && log.travelDurationMs !== undefined ? formatDuration(log.travelDurationMs) : "") + '"',
                '"' + (log.onSiteDurationMs !== null && log.onSiteDurationMs !== undefined ? formatDuration(log.onSiteDurationMs) : "") + '"',
                log.decimalHours,
                '"' + (log.billableTime || "") + '"',
                mi(log.startMileage),
                mi(log.arrivalMileage),
                mi(log.travelMileage),
                isRemoteLog(log) ? "true" : "false",
                formatNotesForCsv(log.notes),
                formatNotesForCsv(log.parts || ""),
                (log.startMs !== null && log.startMs !== undefined) ? new Date(log.startMs).toISOString() : "",
                (log.endMs !== null && log.endMs !== undefined) ? new Date(log.endMs).toISOString() : "",
                (log.arrivalMs !== null && log.arrivalMs !== undefined) ? new Date(log.arrivalMs).toISOString() : "",
                log.invoiceNumber || "",
                (log.updatedAt !== null && log.updatedAt !== undefined) ? new Date(log.updatedAt).toISOString() : ""
            ];
            csvRows.push(row.join(","));
        });

        const csvString = csvRows.join("\r\n");
        const bom = '\ufeff';
        const blob = new Blob([bom + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "billing_export_" + new Date().toISOString().slice(0,10) + ".csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    request.onerror = () => {
        alert('Failed to read logs for export.');
    };
}

function formatNotesForCsv(notes) {
    if (!notes || notes.trim() === '') return '""';
    const sentences = notes.trim().split(/(?<=[.!?])\s+|\r?\n+/).filter(s => s.trim() !== '');
    if (sentences.length === 0) return '""';
    const formatted = sentences.map(sentence => sentence.trim()).join("\r\n");
    return '"' + formatted.replace(/"/g, '""') + '"';
}

function formatNotesDisplay(notes) {
    if (!notes || notes.trim() === '') return '&mdash;';
    const sentences = notes.trim().split(/(?<=[.!?])\s+|\r?\n+/).filter(s => s.trim() !== '');
    if (sentences.length === 0) return '&mdash;';
    return sentences.map(s => escapeHtml(s.trim())).join('<br>');
}

btnCancelReportRange.addEventListener('click', () => {
    reportRangeModal.classList.add('hidden');
    for (const input of reportRangeInputs) {
        input.checked = false;
    }
    reportRangeInputs[0].checked = true;
    customRangeInputs.style.display = 'none';
    reportStartDate.value = '';
    reportEndDate.value = '';
});

for (const input of reportRangeInputs) {
    input.addEventListener('change', () => {
        if (input.value === 'custom') {
            customRangeInputs.style.display = 'flex';
            const today = new Date().toISOString().split('T')[0];
            reportStartDate.value = today;
            reportEndDate.value = today;
        } else {
            customRangeInputs.style.display = 'none';
            reportStartDate.value = '';
            reportEndDate.value = '';
        }
    });
}

btnGenerateReport.addEventListener('click', () => {
    let selectedRange = 'day';
    for (const input of reportRangeInputs) {
        if (input.checked) {
            selectedRange = input.value;
            break;
        }
    }

    let startDate = new Date();
    let endDate = new Date();

    if (selectedRange === 'day') {
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
    } else if (selectedRange === 'week') {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const thisMonday = new Date(today);
        thisMonday.setDate(today.getDate() - daysSinceMonday);
        startDate = new Date(thisMonday);
        startDate.setDate(thisMonday.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 4);
        endDate.setHours(23, 59, 59, 999);
    } else if (selectedRange === 'custom') {
        const startVal = reportStartDate.value;
        const endVal = reportEndDate.value;
        if (!startVal || !endVal) {
            alert('Please select both start and end dates.');
            return;
        }
        startDate = new Date(startVal);
        endDate = new Date(endVal);
        endDate.setHours(23, 59, 59, 999);
        if (startDate > endDate) {
            alert('Start date cannot be after end date.');
            return;
        }
    }

    generateReportForDateRange(startDate, endDate);
    reportRangeModal.classList.add('hidden');
});

// Helper function to build a report table for a set of logs (no Remote column)
function buildReportTable(logs, hasMileage) {
    let tableHtml = '<table class="report-table">';
    if (hasMileage) {
        tableHtml += '<thead><tr><th style="width: 15%;">Date</th><th style="width: 20%;">Client</th><th style="width: 15%;">Invoice #</th><th style="width: 28%;">Timeline</th><th style="width: 12%;">Billable Time</th><th style="width: 10%;">Mileage</th></tr></thead>';
    } else {
        tableHtml += '<thead><tr><th style="width: 15%;">Date</th><th style="width: 30%;">Client</th><th style="width: 15%;">Invoice #</th><th style="width: 28%;">Timeline</th><th style="width: 12%;">Billable Time</th></tr></thead>';
    }
    tableHtml += '<tbody>';

    logs.forEach(log => {
        const startDateObj = (log.startMs !== null && log.startMs !== undefined) ? new Date(log.startMs) : new Date(log.start);
        const endDateObj = (log.endMs !== null && log.endMs !== undefined) ? new Date(log.endMs) : new Date(log.end);
        const dateOnly = startDateObj.toLocaleDateString();
        const startTimeStr = startDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endTimeStr = endDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isRemote = isRemoteLog(log);

        let timelineHtml = "";
        let breakdownHtml = "";

        let billableDecimal;
        if (log.billableTime && log.billableTime !== '1') {
            billableDecimal = log.billableTime;
        } else {
            billableDecimal = formatBillableTime(isRemote ? null : log.travelDurationMs, isRemote ? null : log.onSiteDurationMs, log.durationMs);
        }

        if (!isRemote && log.travelDurationMs !== null && log.travelDurationMs !== undefined && log.onSiteDurationMs !== null && log.onSiteDurationMs !== undefined && log.arrivalTime) {
            timelineHtml = 'Start: ' + escapeHtml(startTimeStr) + '<br>Arrived: ' + escapeHtml(log.arrivalTime) + '<br>End: ' + escapeHtml(endTimeStr);
            breakdownHtml = escapeHtml(billableDecimal);
        } else {
            timelineHtml = 'Start: ' + escapeHtml(startTimeStr) + '<br>End: ' + escapeHtml(endTimeStr);
            breakdownHtml = escapeHtml(billableDecimal);
        }

        tableHtml += '<tr>';
        tableHtml += '<td>' + escapeHtml(dateOnly) + '</td>';
        tableHtml += '<td><strong>' + escapeHtml(log.client) + '</strong></td>';
        tableHtml += '<td style="font-size: 0.8rem; color: var(--text-muted);">' + escapeHtml(log.invoiceNumber || '-') + '</td>';
        tableHtml += '<td style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.3;">' + timelineHtml + '</td>';
        tableHtml += '<td style="font-family: monospace; font-size: 0.85rem; line-height: 1.3;">' + breakdownHtml + '</td>';
        if (hasMileage) {
            tableHtml += '<td>' + ((log.travelMileage !== null && log.travelMileage !== undefined) ? log.travelMileage + ' mi' : '-') + '</td>';
        }
        tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table>';
    return tableHtml;
}

function generateReportForDateRange(startDate, endDate) {
    if (!db) return;
    const store = db.transaction(["logs"], "readonly").objectStore("logs");
    const request = store.getAll();

    request.onsuccess = function(e) {
        const logs = e.target.result.filter(log => !log._deleted);

        const filteredLogs = logs.filter(log => {
            const logDate = (log.startMs !== null && log.startMs !== undefined)
                ? new Date(log.startMs)
                : new Date(log.start);
            return logDate >= startDate && logDate <= endDate;
        });

        if (filteredLogs.length === 0) {
            alert('No data found for the selected date range.');
            return;
        }

        // Split into on-site/travel and remote groups
        const onSiteLogs = filteredLogs.filter(log => !isRemoteLog(log));
        const remoteLogs = filteredLogs.filter(log => isRemoteLog(log));

        // Determine if any non-remote log has mileage (shared column structure)
        const hasMileage = onSiteLogs.some(log => log.travelMileage !== null && log.travelMileage !== undefined);

        let totalBillableHours = 0;
        let totalMileageSum = 0;
        const totalEntriesCount = filteredLogs.length;
        const totalRemoteCount = remoteLogs.length;

        filteredLogs.forEach(log => {
            const isRemote = isRemoteLog(log);

            let billableDecimal;
            if (log.billableTime && log.billableTime !== '1') {
                billableDecimal = log.billableTime;
            } else {
                billableDecimal = formatBillableTime(isRemote ? null : log.travelDurationMs, isRemote ? null : log.onSiteDurationMs, log.durationMs);
            }

            const parsedVal = parseFloat(billableDecimal);
            if (!isNaN(parsedVal)) {
                totalBillableHours += parsedVal;
            }

            if (!isRemote && log.travelMileage !== null && log.travelMileage !== undefined) {
                totalMileageSum += log.travelMileage;
            }
        });

        let reportHtml = '';

        // On-Site Jobs section
        if (onSiteLogs.length > 0) {
            reportHtml += '<div class="report-section">';
            reportHtml += '<h3 class="report-section-title">On-Site Jobs (' + onSiteLogs.length + ')</h3>';
            reportHtml += buildReportTable(onSiteLogs, hasMileage);
            reportHtml += '</div>';
        }

        // Remote Jobs section (starts on a new page in print)
        if (remoteLogs.length > 0) {
            reportHtml += '<div class="report-section report-section-remote">';
            reportHtml += '<h3 class="report-section-title">Remote Jobs (' + remoteLogs.length + ')</h3>';
            reportHtml += buildReportTable(remoteLogs, hasMileage);
            reportHtml += '</div>';
        }

        // Combined summary
        let summaryHtml = '<div class="report-summary-container">';
        summaryHtml += '<div><strong>Total Jobs:</strong> ' + totalEntriesCount + ' (' + totalRemoteCount + ' Remote)</div>';
        summaryHtml += '<div><strong>Total Billable Hours:</strong> ' + totalBillableHours.toFixed(2) + 'h</div>';
        if (hasMileage) {
            summaryHtml += '<div><strong>Total Mileage:</strong> ' + totalMileageSum.toFixed(1) + ' mi</div>';
        }
        summaryHtml += '</div>';

        reportContent.innerHTML = reportHtml + summaryHtml;

        reportModal.classList.remove('hidden');
    };

    request.onerror = () => {
        alert('Failed to load logs for the report.');
    };
}

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- Cloud Sync (Offline-First Backup) ---

const API_BASE = 'https://time-tracker.alexs-cas.workers.dev';

function isAuthenticated() {
    return !!localStorage.getItem('authToken');
}

function getAuthHeaders() {
    const token = localStorage.getItem('authToken');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

function getLastSyncTime() {
    const ts = localStorage.getItem('lastSyncTime');
    return ts ? parseInt(ts, 10) : 0;
}

function setLastSyncTime(ts) {
    localStorage.setItem('lastSyncTime', ts.toString());
}

// Schema-version flag. Bumped whenever a change to the local log schema requires a
// one-time full pull to repopulate per-row sync state. On the first sync after the
// bump, the client passes since=0 to syncFromCloud, then clears the flag.
//
// v4: per-log clientId (UUID) cross-device identity. The full pull lets legacy
// rows adopt the server's client_id (matched by the old id) and assigns fresh
// UUIDs to rows that were never synced, before any push can run.
const LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION = 4;
function needsFullPullForSchemaUpgrade() {
    return parseInt(localStorage.getItem('lastSyncedUpdatedAtSchemaVersion') || '0', 10) < LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION;
}
function markSchemaUpgradeComplete() {
    localStorage.setItem('lastSyncedUpdatedAtSchemaVersion', LAST_SYNCED_UPDATED_AT_SCHEMA_VERSION.toString());
}

async function syncToCloud() {
    if (!isAuthenticated() || !db) return { success: false, error: 'Not authenticated' };
    try {
        const store = db.transaction(['logs'], 'readonly').objectStore('logs');
        const request = store.getAll();
        const allLogs = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        // Backfill updatedAt / lastSyncedUpdatedAt / clientId for legacy entries.
        // - updatedAt: use startMs as the fallback since that's when the entry was created
        // - lastSyncedUpdatedAt: null means "never confirmed by server" — include in push
        // - clientId: rows without one predate the per-log UUID identity. Assign a
        //   fresh UUID now UNLESS a schema-upgrade full pull is still pending — in
        //   that case the pull is about to adopt the server's client_id for rows that
        //   were previously synced, and pushing a random UUID first would create a
        //   duplicate server row. Rows without a clientId are simply skipped below
        //   until that pull has run.
        const schemaUpgradePending = needsFullPullForSchemaUpgrade();
        const now = Date.now();
        let needsBackfill = false;
        for (const log of allLogs) {
            if (log.updatedAt === null || log.updatedAt === undefined) {
                log.updatedAt = log.startMs || now;
                needsBackfill = true;
            }
            if (log.lastSyncedUpdatedAt === undefined) {
                log.lastSyncedUpdatedAt = null;
                needsBackfill = true;
            }
            if (!log.clientId && !schemaUpgradePending) {
                log.clientId = generateUuid();
                needsBackfill = true;
            }
        }
        if (needsBackfill && db) {
            const tx = db.transaction(['logs'], 'readwrite');
            const store2 = tx.objectStore('logs');
            allLogs.forEach(log => store2.put(log));
            await new Promise(resolve => { tx.oncomplete = resolve; });
        }

        // Snapshot per-log updatedAt at the moment we read the logs to push. This is the
        // value the push payload actually contained; we'll write the server-confirmed
        // updatedAt into lastSyncedUpdatedAt after the ack, but only if the local value
        // hasn't changed in the meantime. Otherwise a concurrent local edit would be
        // silently marked as already-synced.
        const pushedUpdatedAtByClientId = new Map();
        for (const log of allLogs) {
            if (log.clientId) {
                pushedUpdatedAtByClientId.set(log.clientId, log.updatedAt);
            }
        }

        // Only push rows whose local updatedAt is strictly newer than what the server
        // last confirmed. This skips the no-op re-pushes that previously caused the
        // "server had newer data" log on every sync. Rows without a clientId are
        // skipped (they can't be addressed by the server) — the schema-upgrade full
        // pull resolves them.
        const logsToPush = allLogs.filter(log => {
            if (log._deleted) return true;
            if (!log.clientId) return false;
            if (log.id === undefined || log.id === null) return true;
            if (log.lastSyncedUpdatedAt === null || log.lastSyncedUpdatedAt === undefined) return true;
            return log.updatedAt > log.lastSyncedUpdatedAt;
        });

        if (logsToPush.length === 0) {
            // No local changes to push. Do NOT advance the pull cursor to
            // Date.now(): that would leap past rows another device just created,
            // and the incremental pull would skip them. The pull seals its own
            // cursor from the server's response (serverTime / received rows).
            return { success: true, upserted: [], errors: [] };
        }

        console.log('syncToCloud: pushing', logsToPush.length, 'of', allLogs.length, 'logs to server');
        const response = await fetch(`${API_BASE}/api/sync`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ logs: logsToPush })
        });
        if (!response.ok) {
            const error = await response.json();
            console.error('syncToCloud failed:', error);
            if (response.status === 401) {
                localStorage.removeItem('authToken');
                localStorage.removeItem('userId');
                localStorage.removeItem('userEmail');
                localStorage.removeItem('lastSyncTime');
                syncStatusEl.classList.add('hidden');
                alert('Your session has expired. Please log in again.');
                showAuthModal();
            }
            return { success: false, error: error.error || 'Sync failed' };
        }
        const result = await response.json();
        if (result.errors && result.errors.length > 0) {
            console.error('syncToCloud: server reported errors:', result.errors);
            updateSyncStatus('error');
            syncStatusEl.title = 'Sync errors: ' + result.errors.map(e => e.error || e).join('; ');
            return { success: false, error: result.errors, upserted: result.upserted };
        }
        setLastSyncTime(result.serverTime);

        // Update local logs with server's confirmed updatedAt and record it as the
        // lastSyncedUpdatedAt so the next sync skips re-pushing these rows. We only
        // touch rows that the server actually wrote (action 'updated' or 'created' or
        // 'deleted'); rows the server rejected (action 'conflict') keep their existing
        // lastSyncedUpdatedAt so a future local edit will still be pushed.
        //
        // Race protection: only update lastSyncedUpdatedAt if the local updatedAt is
        // still the value we pushed (stored in pushedUpdatedAtByClientId). If a
        // concurrent local edit happened during the round-trip, local updatedAt is now
        // greater than what we pushed, and we must NOT mark it as synced.
        const upsertedConfirmed = result.upserted.filter(u => u.updatedAt && (u.action === 'updated' || u.action === 'created' || u.action === 'deleted'));
        if (upsertedConfirmed.length > 0 && db) {
            const tx = db.transaction(['logs'], 'readwrite');
            const store = tx.objectStore('logs');
            const clientIndex = store.index('byClientId');
            for (const u of upsertedConfirmed) {
                const getReq = clientIndex.get(u.clientId);
                getReq.onsuccess = () => {
                    const log = getReq.result;
                    if (!log) return;
                    // Skip tombstones that have already been hard-deleted locally.
                    if (u.action === 'deleted' && !log._deleted) {
                        // Server confirmed a delete we didn't request. This shouldn't
                        // happen via /api/sync POST — server tombstones come back in
                        // serverTombstones. Treat defensively: do nothing.
                        return;
                    }
                    // D1 returns updated_at as a UTC 'YYYY-MM-DD HH:MM:SS.SSS'
                    // string. Append 'Z' so it parses as UTC, not local time
                    // (otherwise the resulting epoch ms is offset by the local
                    // timezone, which then leaks into lastSyncedUpdatedAt and
                    // suppresses the next legitimate push).
                    const serverUpdatedAtMs = new Date(String(u.updatedAt).replace(' ', 'T') + 'Z').getTime();
                    // Only adopt the server timestamp if no concurrent local edit
                    // landed during the round-trip.
                    const pushedAt = pushedUpdatedAtByClientId.get(u.clientId);
                    if (pushedAt !== undefined && log.updatedAt !== pushedAt) {
                        // Local edited during the push. Do not mark as synced; the next
                        // sync will pick it up because updatedAt > lastSyncedUpdatedAt.
                        return;
                    }
                    if (u.action !== 'deleted') {
                        log.updatedAt = serverUpdatedAtMs;
                    }
                    log.lastSyncedUpdatedAt = serverUpdatedAtMs;
                    store.put(log);
                };
            }
        }

        // Hard-delete locally any entries the server confirmed as deleted via our push.
        const deletedClientIds = result.upserted
            .filter(u => u.action === 'deleted')
            .map(u => u.clientId);
        if (deletedClientIds.length > 0 && db) {
            const tx = db.transaction(['logs'], 'readwrite');
            const store = tx.objectStore('logs');
            const clientIndex = store.index('byClientId');
            deletedClientIds.forEach(clientId => {
                const getReq = clientIndex.get(clientId);
                getReq.onsuccess = () => {
                    if (getReq.result) store.delete(getReq.result.id);
                };
            });
        }

        // Apply server tombstones: entries that were deleted on another device
        // but still exist locally because this device hadn't synced yet.
        // Mark them _deleted in IndexedDB so renderLogs() hides them immediately.
        const tombstones = result.serverTombstones || [];
        if (tombstones.length > 0 && db) {
            const tx2 = db.transaction(['logs'], 'readwrite');
            const store2 = tx2.objectStore('logs');
            const clientIndex2 = store2.index('byClientId');
            for (const tombstone of tombstones) {
                await new Promise((resolve) => {
                    const getReq = clientIndex2.get(tombstone.clientId);
                    getReq.onsuccess = () => {
                        const log = getReq.result;
                        if (log) {
                            log._deleted = true;
                            store2.put(log);
                        }
                        resolve();
                    };
                    getReq.onerror = () => resolve(); // non-fatal
                });
            }
            console.log('syncToCloud: applied', tombstones.length, 'server tombstones locally');
        }

        // Handle conflicts - log entries where server had newer data
        const conflicts = result.upserted.filter(u => u.action === 'conflict');
        if (conflicts.length > 0) {
            console.log('syncToCloud: server had newer data for', conflicts.length, 'entries (conflicts)');
        }

        return { success: true, upserted: result.upserted, errors: result.errors };
    } catch (error) {
        console.error('syncToCloud error:', error);
        return { success: false, error: error.message };
    }
}

async function syncFromCloud(sinceOverride) {
    if (!isAuthenticated() || !db) return { success: false, error: 'Not authenticated' };
    try {
        const since = sinceOverride !== undefined ? sinceOverride : getLastSyncTime();
        const response = await fetch(`${API_BASE}/api/sync?since=${since}`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) {
            const error = await response.json();
            console.error('syncFromCloud failed:', error);
            if (response.status === 401) {
                localStorage.removeItem('authToken');
                localStorage.removeItem('userId');
                localStorage.removeItem('userEmail');
                localStorage.removeItem('lastSyncTime');
                syncStatusEl.classList.add('hidden');
                alert('Your session has expired. Please log in again.');
                showAuthModal();
            }
            return { success: false, error: error.error || 'Fetch failed' };
        }
        const data = await response.json();
        const serverLogs = data.logs || [];
        console.log('syncFromCloud: received', serverLogs.length, 'logs from server');

        // Capture the raw server updated_at timestamps BEFORE the processing loop
        // below mutates each log object (it deletes log.updated_at after parsing).
        // Rows can carry client-authored updated_at values that are ahead of the
        // server's real clock (a fast client clock, or legacy timestamp contamination
        // baked into D1). The server's incremental pull uses a strict
        // `updated_at > since` filter, so a cursor pinned to real time is re-served
        // those skewed rows on EVERY pull and never converges. Sealing the cursor
        // past each received row makes the filter exclude it on the next pull.
        let newestReceivedMs = 0;
        for (const log of serverLogs) {
            if (log.updated_at) {
                const ms = new Date(String(log.updated_at).replace(' ', 'T') + 'Z').getTime();
                if (!isNaN(ms) && ms > newestReceivedMs) newestReceivedMs = ms;
            }
        }

        const tx = db.transaction(['logs'], 'readwrite');
        const store = tx.objectStore('logs');
        const clientIndex = store.index('byClientId');
        const isSchemaUpgradePull = sinceOverride === 0;

        for (const serverRow of serverLogs) {
            await new Promise((resolve, reject) => {
                // Normalize server-side fields to local names.
                // client_id is the stable cross-device identity for this log.
                if (serverRow.client_id) {
                    serverRow.clientId = serverRow.client_id;
                }
                delete serverRow.client_id;
                // Normalize server-side updated_at (a 'YYYY-MM-DD HH:MM:SS.SSS'
                // UTC string) to a Unix epoch ms number. D1 stores DATETIME
                // values as UTC (the worker writes them via toISOString()),
                // so we must append 'Z' before parsing — otherwise
                // new Date() interprets the string as local time and
                // produces a value offset by the local timezone, which
                // then gets stored as lastSyncedUpdatedAt and incorrectly
                // suppresses the next legitimate push.
                if (serverRow.updated_at) {
                    const serverUpdatedAtMs = new Date(String(serverRow.updated_at).replace(' ', 'T') + 'Z').getTime();
                    if (typeof serverRow.updatedAt !== 'number' || serverRow.updatedAt !== serverUpdatedAtMs) {
                        serverRow.updatedAt = serverUpdatedAtMs;
                    }
                }
                delete serverRow.updated_at;

                const finishRow = (local) => {
                    if (serverRow.deleted_at) {
                        // Server has tombstoned this row — soft-delete it locally
                        // if we have a copy. Never create a phantom tombstone
                        // keyed by the server's id (it can collide with a
                        // different local row's id).
                        if (local) {
                            local._deleted = true;
                            const putReq = store.put(local);
                            putReq.onsuccess = () => resolve();
                            putReq.onerror = () => reject(putReq.error);
                        } else {
                            resolve();
                        }
                        return;
                    }
                    if (!local) {
                        // Brand-new row from another device. Do NOT trust the
                        // server's id as our local key (ids collide across
                        // devices) — let IndexedDB assign a fresh local id.
                        delete serverRow.id;
                        serverRow.lastSyncedUpdatedAt = (typeof serverRow.updatedAt === 'number' && isFinite(serverRow.updatedAt))
                            ? serverRow.updatedAt : Date.now();
                        const addReq = store.add(serverRow);
                        addReq.onsuccess = () => resolve();
                        addReq.onerror = () => reject(addReq.error);
                        return;
                    }
                    // Local copy exists — apply the conflict-resolution rules.
                    if (local.lastSyncedUpdatedAt === null || local.lastSyncedUpdatedAt === undefined) {
                        // Local row has unsynced edits (marked dirty by
                        // markLogDirty). The server copy for this row is stale,
                        // so never clobber the local edit with it — regardless of
                        // the server's timestamp (which may be shifted ahead of
                        // the local clock). The next syncToCloud push will upload
                        // the local version and restore lastSyncedUpdatedAt.
                        resolve();
                        return;
                    }
                    if (!isSchemaUpgradePull && typeof local.updatedAt === 'number' &&
                        local.updatedAt > serverRow.updatedAt) {
                        // Local row is newer than the server's copy — there is a
                        // pending local edit that has not yet been confirmed by the
                        // server (either still in the debounce window or the push
                        // ack hasn't landed). Do NOT overwrite local content with
                        // the stale server data. We keep the local row entirely
                        // intact so the next syncToCloud push can upload it.
                        //
                        // If lastSyncedUpdatedAt was set by a previous push that
                        // the server already confirmed (for an older version), keep
                        // it as-is — the next push will be triggered because
                        // local.updatedAt > local.lastSyncedUpdatedAt.
                        resolve();
                        return;
                    }
                    if (!isSchemaUpgradePull && typeof local.lastSyncedUpdatedAt === 'number' &&
                        local.lastSyncedUpdatedAt > serverRow.updatedAt) {
                        // Local has already pushed a newer value to the server
                        // (or has a pending in-flight push). Keep the local
                        // updatedAt and lastSyncedUpdatedAt; the next push will
                        // upload the local change.
                        serverRow.updatedAt = local.updatedAt;
                        serverRow.lastSyncedUpdatedAt = local.lastSyncedUpdatedAt;
                    } else {
                        // Record the server's confirmed updatedAt as lastSyncedUpdatedAt
                        // so the next syncToCloud treats this row as already in sync.
                        serverRow.lastSyncedUpdatedAt = serverRow.updatedAt;
                    }
                    // Keep the local key (id) so we never clobber a different row.
                    serverRow.id = local.id;
                    const req = store.put(serverRow);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                };

                const getByClientIdReq = clientIndex.get(serverRow.clientId || '__no_client_id__');
                getByClientIdReq.onsuccess = () => {
                    if (getByClientIdReq.result) {
                        finishRow(getByClientIdReq.result);
                        return;
                    }
                    // Legacy adoption: only during the schema-upgrade full pull.
                    // Rows created before per-log UUIDs were stored on the server
                    // under the originating device's local autoincrement id, with
                    // a backfilled client_id of 'legacy-<id>'. If a local row
                    // shares that old id and has no clientId yet, it IS this row —
                    // adopt the server's clientId so subsequent pushes address it
                    // correctly and no duplicate is created.
                    if (isSchemaUpgradePull && serverRow.clientId && serverRow.clientId.indexOf('legacy-') === 0) {
                        const getByIdReq = store.get(serverRow.id);
                        getByIdReq.onsuccess = () => {
                            const byId = getByIdReq.result;
                            if (byId && !byId.clientId) {
                                byId.clientId = serverRow.clientId;
                                finishRow(byId);
                            } else {
                                finishRow(null);
                            }
                        };
                        getByIdReq.onerror = () => reject(getByIdReq.error);
                    } else {
                        finishRow(null);
                    }
                };
                getByClientIdReq.onerror = () => reject(getByClientIdReq.error);
            });
        }

        // Assign clientIds to any remaining local rows that have no server
        // counterpart (never-synced entries created before this schema change).
        // They need a UUID so the next push can address them uniquely instead of
        // colliding with another device's row. Runs during the schema-upgrade full
        // pull; incremental pulls never encounter clientId-less rows.
        if (isSchemaUpgradePull) {
            const backfillTx = db.transaction(['logs'], 'readwrite');
            const backfillStore = backfillTx.objectStore('logs');
            const allReq = backfillStore.getAll();
            await new Promise((resolve, reject) => {
                allReq.onsuccess = () => {
                    for (const r of allReq.result) {
                        if (!r.clientId) {
                            r.clientId = generateUuid();
                            backfillStore.put(r);
                        }
                    }
                    resolve();
                };
                allReq.onerror = () => reject(allReq.error);
            });
        }
        // Seal the pull cursor past any future-timestamped rows just received (see
        // the computation above, which captured the raw timestamps before the
        // processing loop deleted them) plus the server clock and prior cursor.
        setLastSyncTime(Math.max(getLastSyncTime() || 0, data.serverTime || 0, newestReceivedMs));
        return { success: true, count: serverLogs.length };
    } catch (error) {
        console.error('syncFromCloud error:', error);
        return { success: false, error: error.message };
    }
}

let syncInFlight = null;

async function performSync() {
    if (!isAuthenticated()) return;
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
        syncStatusEl.classList.remove('hidden');
        updateSyncStatus('syncing');
        // On the first sync after a schema upgrade, force a full pull so every server
        // row gets a chance to populate lastSyncedUpdatedAt. Without this, legacy rows
        // whose server-side updated_at is older than the current lastSyncTime would
        // never come back in the incremental pull, leaving lastSyncedUpdatedAt=null and
        // causing every push to be reported as a conflict.
        const needsFullPull = needsFullPullForSchemaUpgrade();
        let upResult, downResult;
        if (needsFullPull) {
            // Schema upgrade: pull first so lastSyncedUpdatedAt gets populated before
            // the push runs (otherwise legacy rows would all be reported as conflicts).
            downResult = await syncFromCloud(0);
            upResult = await syncToCloud();
            markSchemaUpgradeComplete();
        } else {
            // Normal sync: push FIRST, then pull. Doing the pull first would race with
            // a pending syncAfterWrite from a recent local edit — the pull would
            // bring back the un-edited server row and overwrite the local edit before
            // the push got a chance to upload it. Pushing first guarantees any pending
            // local changes are on the server before we ingest anything.
            upResult = await syncToCloud();
            downResult = await syncFromCloud(getLastSyncTime());
        }
        if (!upResult.success || !downResult.success) {
            const upErr = upResult.success ? '' : (upResult.error || 'upload failed');
            const downErr = downResult.success ? '' : (downResult.error || 'fetch failed');
            syncStatusEl.title = [upErr, downErr].filter(Boolean).join('; ');
            updateSyncStatus('error');
        } else {
            syncStatusEl.title = '';
            setLastSyncTime(Math.max(getLastSyncTime(), Date.now()));
            checkConnectivity();
        }
        renderLogs();
    })();
    try {
        await syncInFlight;
    } finally {
        syncInFlight = null;
    }
}

function syncAfterWrite() {
    if (isAuthenticated()) {
        syncStatusEl.classList.remove('hidden');
        updateSyncStatus('syncing');
        setTimeout(() => {
            syncToCloud().then(result => {
                if (!result.success) {
                    syncStatusEl.title = result.error || 'Background sync failed';
                    updateSyncStatus('error');
                } else {
                    syncStatusEl.title = '';
                    checkConnectivity();
                }
            });
        }, 1000);
    }
}

const syncStatusEl = document.getElementById('syncStatus');

syncStatusEl.addEventListener('click', () => {
    if (isAuthenticated()) {
        performSync();
    }
});

function updateSyncStatus(status) {
    const colors = { online: '#10b981', syncing: '#f59e0b', offline: '#ef4444', idle: '#6b7280', error: '#ef4444' };
    syncStatusEl.textContent = status === 'error' ? 'sync failed' : status;
    syncStatusEl.style.background = colors[status] + '20';
    syncStatusEl.style.color = colors[status];
}

function checkConnectivity() {
    if (!isAuthenticated()) {
        updateSyncStatus('idle');
        syncStatusEl.classList.add('hidden');
        return;
    }
    syncStatusEl.classList.remove('hidden');
    if (navigator.onLine) {
        updateSyncStatus('online');
    } else {
        updateSyncStatus('offline');
    }
}

window.addEventListener('online', checkConnectivity);
window.addEventListener('offline', checkConnectivity);

// --- Auth Modal ---

function showAuthModal() {
    if (isAuthenticated()) return;
    authModal.classList.remove('hidden');
    authError.style.display = 'none';
    authError.textContent = '';
    isLoginMode = true;
    tabLoginAuth.classList.add('active');
    tabRegisterAuth.classList.remove('active');
    tabChangePasswordAuth.classList.remove('active');
    tabChangePasswordAuth.style.display = 'none';
    changePasswordSection.style.display = 'none';
    authBtn.textContent = 'Login';
}

function hideAuthModal() {
    authModal.classList.add('hidden');
}

tabLoginAuth.addEventListener('click', () => {
    isLoginMode = true;
    tabLoginAuth.classList.add('active');
    tabRegisterAuth.classList.remove('active');
    tabChangePasswordAuth.classList.remove('active');
    tabChangePasswordAuth.style.display = 'inline-flex';
    authBtn.textContent = 'Login';
    changePasswordSection.style.display = 'none';
    authError.style.display = 'none';
});

tabRegisterAuth.addEventListener('click', () => {
    isLoginMode = false;
    tabRegisterAuth.classList.add('active');
    tabLoginAuth.classList.remove('active');
    tabChangePasswordAuth.classList.remove('active');
    tabChangePasswordAuth.style.display = 'inline-flex';
    authBtn.textContent = 'Register';
    changePasswordSection.style.display = 'none';
    authError.style.display = 'none';
});

tabChangePasswordAuth.addEventListener('click', () => {
    tabChangePasswordAuth.classList.add('active');
    tabLoginAuth.classList.remove('active');
    tabRegisterAuth.classList.remove('active');
    changePasswordSection.style.display = 'block';
    authError.style.display = 'none';
    changePasswordError.style.display = 'none';
    changePasswordSuccess.style.display = 'none';
});

btnCloseAuth.addEventListener('click', hideAuthModal);

authBtn.addEventListener('click', async () => {
    const email = authEmail.value;
    const password = authPassword.value;

    if (!email || !password) {
        authError.textContent = 'Please enter both email and password';
        authError.style.display = 'block';
        return;
    }

    try {
        const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.token) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('userEmail', data.email);
            hideAuthModal();
            checkConnectivity();
            performSync();
        } else {
            authError.textContent = data.error || 'Authentication failed';
            authError.style.display = 'block';
        }
    } catch (e) {
        authError.textContent = 'Network error';
        authError.style.display = 'block';
    }
});

authPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') authBtn.click();
});

changePasswordBtn.addEventListener('click', async () => {
    const currentPassword = changeCurrentPassword.value;
    const newPassword = changeNewPassword.value;
    const confirmPassword = changeConfirmPassword.value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        changePasswordError.textContent = 'Please fill in all fields';
        changePasswordError.style.display = 'block';
        changePasswordSuccess.style.display = 'none';
        return;
    }

    if (newPassword !== confirmPassword) {
        changePasswordError.textContent = 'New passwords do not match';
        changePasswordError.style.display = 'block';
        changePasswordSuccess.style.display = 'none';
        return;
    }

    if (newPassword.length < 8) {
        changePasswordError.textContent = 'New password must be at least 8 characters';
        changePasswordError.style.display = 'block';
        changePasswordSuccess.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/password`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            changePasswordSuccess.textContent = 'Password updated successfully!';
            changePasswordSuccess.style.display = 'block';
            changePasswordError.style.display = 'none';
            changeCurrentPassword.value = '';
            changeNewPassword.value = '';
            changeConfirmPassword.value = '';
        } else {
            changePasswordError.textContent = data.error || 'Failed to update password';
            changePasswordError.style.display = 'block';
            changePasswordSuccess.style.display = 'none';
        }
    } catch (e) {
        changePasswordError.textContent = 'Network error';
        changePasswordError.style.display = 'block';
        changePasswordSuccess.style.display = 'none';
    }
});

// Show auth modal on page load if not authenticated
if (!isAuthenticated()) {
    showAuthModal();
}

// User menu dropdown toggle
btnUserMenu.addEventListener('click', () => {
    userDropdown.classList.toggle('hidden');
});

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!userMenuWrapper.contains(e.target)) {
        userDropdown.classList.add('hidden');
    }
});

// Change Password handler
btnChangePasswordDropdown.addEventListener('click', () => {
    if (!isAuthenticated()) return;
    userDropdown.classList.add('hidden');
    authModal.classList.remove('hidden');
    authError.style.display = 'none';
    authError.textContent = '';
    // Switch to the change password tab
    tabLoginAuth.classList.remove('active');
    tabRegisterAuth.classList.remove('active');
    tabChangePasswordAuth.classList.add('active');
    tabChangePasswordAuth.style.display = 'inline-flex';
    changePasswordSection.style.display = 'block';
    changePasswordError.style.display = 'none';
    changePasswordError.textContent = '';
    changePasswordSuccess.style.display = 'none';
    changePasswordSuccess.textContent = '';
    changeCurrentPassword.value = '';
    changeNewPassword.value = '';
    changeConfirmPassword.value = '';
});

// Logout handler
btnLogoutDropdown.addEventListener('click', async () => {
    if (!isAuthenticated()) return;
    userDropdown.classList.add('hidden');
    try {
        await fetch(`${API_BASE}/api/auth/logout`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
    } catch (e) {
        console.log('Logout request failed:', e);
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('lastSyncTime');
    syncStatusEl.classList.add('hidden');
    showAuthModal();
});

/* ==================== Invoicing Mode ==================== */

function getBillableDisplay(log) {
    if (log.billableTime && log.billableTime !== '1') {
        return log.billableTime;
    }
    const isRemote = isRemoteLog(log);
    return formatBillableTime(
        isRemote ? null : log.travelDurationMs,
        isRemote ? null : log.onSiteDurationMs,
        log.durationMs
    );
}

function enterInvoicingMode() {
    isInvoicingMode = true;
    localStorage.setItem('invoicingMode', 'true');
    document.body.classList.add('invoicing-active');
    recentLogsSection.classList.add('hidden');
    invoicingContainer.classList.remove('hidden');
    btnInvoicingMode.textContent = 'Exit Invoice Mode';
    renderInvoicingMode();
}

function exitInvoicingMode() {
    isInvoicingMode = false;
    localStorage.removeItem('invoicingMode');
    document.body.classList.remove('invoicing-active');
    invoicingContainer.classList.add('hidden');
    recentLogsSection.classList.remove('hidden');
    btnInvoicingMode.textContent = 'Invoice Mode';
    renderLogs();
}

if (btnInvoicingMode) {
    btnInvoicingMode.addEventListener('click', () => {
        if (isInvoicingMode) {
            exitInvoicingMode();
        } else {
            enterInvoicingMode();
        }
    });
}

if (btnExitInvoicing) {
    btnExitInvoicing.addEventListener('click', () => {
        exitInvoicingMode();
    });
}

let invoSortCol = null;
let invoSortDir = 'asc';

function renderInvoicingMode() {
    if (!db || !isInvoicingMode) return;
    const store = db.transaction(["logs"], "readonly").objectStore("logs");
    const request = store.getAll();

    request.onsuccess = () => {
        let logs = request.result.filter(log => !log._deleted);

        if (invoSortCol) {
            logs.sort((a, b) => {
                const aVal = getInvoSortVal(a, invoSortCol);
                const bVal = getInvoSortVal(b, invoSortCol);
                if (aVal < bVal) return invoSortDir === 'asc' ? -1 : 1;
                if (aVal > bVal) return invoSortDir === 'asc' ? 1 : -1;
                return 0;
            });
        } else {
            logs.sort((a, b) => {
                const aTime = (a.startMs != null) ? a.startMs : parseToDate(a.start)?.getTime() || 0;
                const bTime = (b.startMs != null) ? b.startMs : parseToDate(b.start)?.getTime() || 0;
                return (bTime || 0) - (aTime || 0);
            });
        }

        if (logs.length === 0) {
            invoicingGridBody.innerHTML = '<tr><td colspan="8" class="empty-state">No logged hours found.</td></tr>';
            return;
        }

        let html = '';
        logs.forEach(log => {
            const billableDisplay = getBillableDisplay(log);
            const invoiceVal = log.invoiceNumber || '';
            const logDate = (log.startMs !== null && log.startMs !== undefined) ? new Date(log.startMs) : new Date(log.start);
            const dateStr = logDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            html += '<tr class="invoicing-row" data-log-id="' + log.id + '">';
            html += '<td class="inv-cell-remote">' + (log.isRemote ? '<span class="remote-badge">Yes</span>' : '<span class="remote-badge" style="background-color:var(--bg-secondary, #f3f4f6); color:var(--text-muted, #6b7280);">No</span>') + '</td>';
            html += '<td class="inv-cell-date">' + dateStr + '</td>';
            html += '<td class="inv-cell-client">' + escapeHtml(log.client) + '</td>';
            html += '<td class="inv-cell-billable" contenteditable="true" data-field="billableTime" data-id="' + log.id + '" data-original="' + escapeHtml(billableDisplay) + '" title="Click to edit billable hours">' + escapeHtml(billableDisplay) + '</td>';
            html += '<td class="inv-cell-notes" contenteditable="true" data-field="notes" data-id="' + log.id + '" data-original="' + escapeHtml(log.notes || '') + '" title="Click to edit notes">' + (log.notes && log.notes.trim() ? formatNotesDisplay(log.notes) : '<em style="color:var(--text-muted, #9ca3af);">No notes</em>') + '</td>';
            html += '<td class="inv-cell-parts">' + (log.parts ? escapeHtml(log.parts) : '') + '</td>';
            html += '<td class="inv-cell-invoice" contenteditable="true" data-field="invoiceNumber" data-id="' + log.id + '" data-original="' + escapeHtml(invoiceVal) + '" title="Click to add invoice number">' + (invoiceVal ? escapeHtml(invoiceVal) : '') + '</td>';
            html += '<td class="inv-cell-actions"><button class="btn-inv-edit" onclick="editLog(' + log.id + ')">Edit</button></td>';
            html += '</tr>';
        });

        invoicingGridBody.innerHTML = html;
        updateInvoSortIndicators();
    };

    request.onerror = () => {
        invoicingGridBody.innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load logs.</td></tr>';
    };
}

function getInvoSortVal(log, col) {
    switch (col) {
        case 'client': return log.client.toLowerCase();
        case 'billableTime': return parseFloat(getBillableDisplay(log)) || 0;
        case 'notes': return (log.notes || '').toLowerCase();
        case 'parts': return (log.parts || '').toLowerCase();
        case 'invoiceNumber': return (log.invoiceNumber || '').toLowerCase();
        case 'isRemote': return log.isRemote ? '1' : '0';
        case 'date': return (log.startMs !== null && log.startMs !== undefined) ? log.startMs : (parseToDate(log.start)?.getTime() || 0);
        default: return '';
    }
}

function updateInvoSortIndicators() {
    invoicingGrid.querySelectorAll('th[data-col]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.getAttribute('data-col') === invoSortCol) {
            th.classList.add(invoSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
}

invoicingGrid.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (invoSortCol === col) {
            invoSortDir = invoSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            invoSortCol = col;
            invoSortDir = 'asc';
        }
        renderInvoicingMode();
    });
});

invoicingGridBody.addEventListener('keydown', (e) => {
    const cell = e.target;
    if (!cell.hasAttribute('contenteditable')) return;

    if (e.key === 'Enter') {
        e.preventDefault();
        cell.blur();
    }

    if (e.key === 'Escape') {
        e.preventDefault();
        const original = cell.getAttribute('data-original') || '';
        cell.textContent = original;
        cell.blur();
    }
});

invoicingGridBody.addEventListener('blur', function(e) {
    const cell = e.target;
    if (!cell.hasAttribute('contenteditable')) return;
    saveInvoicingCell(cell);
}, true);

async function saveInvoicingCell(cell) {
    const field = cell.getAttribute('data-field');
    const id = parseInt(cell.getAttribute('data-id'));
    const value = cell.textContent.trim();

    if (!field || isNaN(id)) return;

    cell.setAttribute('data-original', value);
    cell.classList.add('inv-row-saving');

    try {
        const tx = db.transaction(['logs'], 'readwrite');
        const store = tx.objectStore('logs');
        const log = await new Promise((resolve, reject) => {
            const getReq = store.get(id);
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => reject(getReq.error);
        });

        if (!log) {
            cell.classList.remove('inv-row-saving');
            alert('Log entry not found.');
            return;
        }

        if (field === 'invoiceNumber') {
            log.invoiceNumber = value;
        } else if (field === 'billableTime') {
            log.billableTime = (value === 'sales call' || isNaN(parseFloat(value)) || parseFloat(value) <= 0) ? '1' : value;
        } else if (field === 'notes') {
            log.notes = value;
        }

        markLogDirty(log);

        await new Promise((resolve, reject) => {
            const putReq = store.put(log);
            putReq.onsuccess = () => resolve();
            putReq.onerror = () => reject(putReq.error);
        });

        cell.classList.remove('inv-row-saving');
        syncAfterWrite();
    } catch (err) {
        cell.classList.remove('inv-row-saving');
        alert('Failed to save: ' + err.message);
    }
}

/* ==================== End Invoicing Mode ==================== */

// --- Dark mode toggle ---

const btnDarkMode = document.getElementById('btnDarkMode');

const isDarkMode = document.documentElement.classList.contains('dark');
btnDarkMode.textContent = isDarkMode ? '☀️' : '🌙';

btnDarkMode.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    btnDarkMode.textContent = isDark ? '☀️' : '🌙';
});

// Service Worker registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
                if (registration.waiting) {
                    showUpdateAvailablePrompt();
                }
                registration.addEventListener('updatefound', () => {
                    const installingWorker = registration.installing;
                    if (installingWorker) {
                        installingWorker.addEventListener('statechange', () => {
                            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                showUpdateAvailablePrompt();
                            }
                        });
                    }
                });
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

function showUpdateAvailablePrompt() {
    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = 'Reload';
    reloadBtn.style.cssText = 'margin-left: 0.5rem; padding: 0.25rem 0.5rem; border: none; border-radius: 0.25rem; background: var(--primary); color: white; cursor: pointer; font-size: 0.75rem;';
    reloadBtn.onclick = () => location.reload();

    const banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.style.cssText = 'position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 0.5rem; padding: 0.5rem 1rem; box-shadow: var(--shadow-lg); font-size: 0.875rem; color: var(--text-main); z-index: 1000; display: flex; align-items: center; gap: 0.5rem;';
    banner.innerHTML = '<span>New version available!</span>';
    banner.appendChild(reloadBtn);
    document.body.appendChild(banner);

    setTimeout(() => {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, 10000);
}
