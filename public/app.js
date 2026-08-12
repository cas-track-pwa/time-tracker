let db;
const dbRequest = indexedDB.open("TimeTrackerDB", 2);

dbRequest.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("logs")) {
        db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
    }
    if (!db.objectStoreNames.contains("timerState")) {
        db.createObjectStore("timerState", { keyPath: "id" });
let db;
const dbRequest = indexedDB.open("TimeTrackerDB", 2);

dbRequest.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("logs")) {
        db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
    }
    if (!db.objectStoreNames.contains("timerState")) {
        db.createObjectStore("timerState", { keyPath: "id" });
    }
};

dbRequest.onsuccess = (e) => { db = e.target.result; renderLogs(); restoreTimerState(); checkConnectivity(); if (isAuthenticated()) { performSync(); } };
dbRequest.onerror = () => alert("Database failure. Allow local storage permissions.");

let timerInterval = null, startTime = null, isRunning = false, arrivalTime = null, startMileage = null, arrivalMileage = null, travelMileage = null, editingLogId = null, requestMileage = localStorage.getItem('requestMileage') === 'true', isRemote = false;

// Helper function to robustly check if a log entry is remote work
function isRemoteLog(log) {
    if (!log) return false;
    const val = log.isRemote;
    if (val === true || val === 1 || val === '1') return true;
    if (typeof val === 'string' && val.toLowerCase() === 'true') return true;
    return false;
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
        client: clientInput.value.trim(),
        isRemote: isRemote
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
        isRemote = isRemoteLog(state);
        toggleRemote.checked = isRemote;
        toggleRemote.disabled = true;
        toggleMileage.disabled = isRemote;
        isRunning = true;
        clientInput.value = state.client;
        clientInput.disabled = true;
        activeClientLabel.textContent = "Tracking: " + state.client;

        btnAction.textContent = "End Timer";
        btnAction.classList.remove('start');
        btnAction.classList.add('stop');
        liveTimer.classList.add('running');
        btnMarkArrival.classList.toggle('hidden', isRemote);
        arrivalBadge.classList.add('hidden');

        // If arrival time was set, show the badge
        if (arrivalTime) {
            const travelMs = arrivalTime - startTime;
            const timeString = new Date(arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            arrivalBadge.textContent = "✓ Arrived at " + timeString + " (Travel: " + formatDuration(travelMs) + ")";
            arrivalBadge.classList.remove('hidden');
            btnMarkArrival.classList.add('hidden');
        }

        timerInterval = setInterval(updateLiveDisplay, 1000);

        // Show appropriate modal based on state - but only if mileage
        // tracking is currently enabled. Previously this ignored the
        // "Request Mileage" toggle, so a user who turned mileage
        // tracking off would still get re-prompted for it on every
        // reload of an in-progress timer.
        if (!isRemote && requestMileage && startMileage === null) {
            startMileageInput.value = '';
            startMileageModal.classList.remove('hidden');
            startMileageInput.focus();
        } else if (!isRemote && requestMileage && arrivalMileage === null && arrivalTime) {
            arrivalMileageInput.value = '';
            arrivalMileageModal.classList.remove('hidden');
            arrivalMileageInput.focus();                        }
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
const btnAction = document.getElementById('btnAction');
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
const toggleRemote = document.getElementById('toggleRemote');

const btnOpenReport = document.getElementById('btnOpenReport');
const btnLogout = document.getElementById('btnLogout');
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
        const editRemote = document.getElementById('editRemote');
    const editBillableTime = document.getElementById('editBillableTime');
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
        const addRemote = document.getElementById('addRemote');
    const btnCancelAdd = document.getElementById('btnCancelAdd');
    const btnSaveAdd = document.getElementById('btnSaveAdd');

const btnAddEntry = document.getElementById('btnAddEntry');

// Auth modal elements
const authModal = document.getElementById('authModal');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authBtn = document.getElementById('authBtn');
const authError = document.getElementById('authError');
const tabLoginAuth = document.getElementById('tabLoginAuth');
const tabRegisterAuth = document.getElementById('tabRegisterAuth');
const btnCloseAuth = document.getElementById('btnCloseAuth');
let isLoginMode = true;

const partsModal = document.getElementById('partsModal');
const partsInput = document.getElementById('partsInput');
const btnSaveParts = document.getElementById('btnSaveParts');
const btnSkipParts = document.getElementById('btnSkipParts');

btnAction.addEventListener('click', () => {
if (!isRunning) {
    const clientName = clientInput.value.trim();
    if (!clientName) { alert("Please input a Client Name first."); return; }

    isRunning = true;
    startTime = Date.now();
    arrivalTime = null;
    startMileage = null;
    arrivalMileage = null;
    travelMileage = null;
    isRemote = !!toggleRemote.checked;
    toggleRemote.disabled = true;
    clientInput.disabled = true;
    activeClientLabel.textContent = "Tracking: " + clientName;

    btnAction.textContent = "End Timer";
    btnAction.classList.remove('start');
    btnAction.classList.add('stop');
    liveTimer.classList.add('running');

    btnMarkArrival.classList.toggle('hidden', isRemote);
    arrivalBadge.classList.add('hidden');

    timerInterval = setInterval(updateLiveDisplay, 1000);

    // Save timer state for persistence
    saveTimerState();

    // Show start mileage modal if mileage is requested
    if (!isRemote && requestMileage) {
        startMileageInput.value = '';
        startMileageModal.classList.remove('hidden');
        startMileageInput.focus();
    } else {
        startMileage = null;
    }
    } else {
        clearInterval(timerInterval);
        isRunning = false;
        clearTimerState();
        btnAction.textContent = "Start Timer";
        btnAction.classList.remove('stop');
        btnAction.classList.add('start');
        liveTimer.classList.remove('running');
        clientInput.disabled = false;
        activeClientLabel.textContent = "";
        notesModal.classList.remove('hidden');
        notesInput.focus();
        }
    });

      // Mileage toggle
      toggleMileage.addEventListener('change', () => {
          requestMileage = toggleMileage.checked;
          localStorage.setItem('requestMileage', requestMileage.toString());
      });

      // Initialize mileage toggle from localStorage
      toggleMileage.checked = requestMileage;

      toggleRemote.addEventListener('change', () => {
          // Remote work has no travel leg, so do not ask for mileage.
          toggleMileage.disabled = toggleRemote.checked;
      });

      toggleMileage.disabled = toggleRemote.checked;

      btnMarkArrival.addEventListener('click', () => {
          if (!isRunning || isRemote || arrivalTime) return;
          arrivalTime = Date.now();
          btnMarkArrival.classList.add('hidden');

          const travelMs = arrivalTime - startTime;
          const timeString = new Date(arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          arrivalBadge.textContent = "✓ Arrived at " + timeString + " (Travel: " + formatDuration(travelMs) + ")";
          arrivalBadge.classList.remove('hidden');

          // Show arrival mileage modal if mileage is requested
          if (requestMileage) {
              arrivalMileageInput.value = '';
              arrivalMileageModal.classList.remove('hidden');
              arrivalMileageInput.focus();
          } else {
              arrivalMileage = null;
          }
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
    partsInput.value = '';
    partsModal.classList.remove('hidden');
    partsInput.focus();
});

function finalizeAndSaveLog(partsText) {
    const durationMs = pendingEndTime - startTime;
    let formattedArrivalTime = null;

    if (arrivalTime) {
        formattedArrivalTime = new Date(arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const newLog = {
        client: clientInput.value.trim(),
        start: new Date(startTime).toLocaleString(),
        end: new Date(pendingEndTime).toLocaleString(),
        // Raw epoch-ms values, stored alongside the locale-formatted
        // display strings above. Re-parsing a toLocaleString() string
        // with `new Date(...)` is locale/browser dependent and fragile,
        // so date math (reports, edit-modal prefill, etc.) should use
        // these ms fields instead of re-parsing the display strings.
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
        isRemote: isRemote
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
            input.checked = false;
        }

        btnAction.textContent = "Start Timer";
        btnAction.classList.remove('stop');
        btnAction.classList.add('start');
        liveTimer.classList.remove('running');

        btnMarkArrival.classList.add('hidden');
        arrivalBadge.classList.add('hidden');
        arrivalTime = null;
        startMileage = null;
        arrivalMileage = null;
        travelMileage = null;
        isRemote = false;
        toggleRemote.checked = false;
        toggleRemote.disabled = false;
        toggleMileage.disabled = false;

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
        const logs = request.result.filter(log => !log._deleted).reverse();
        if (logs.length === 0) {
            logHistory.innerHTML = '<div class="empty-state">No logged hours found.</div>';
            btnClear.classList.add('hidden');
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
            html += '<p class="log-timestamp">' + log.start + '</p></div>';
            html += '<span class="duration-pill">' + log.duration + ' (' + log.decimalHours + 'h)</span>';
            html += '</div>';

            if (!isRemoteEntry && log.travelDurationMs && log.onSiteDurationMs) {
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
            html += '<button class="btn-action start" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;" onclick="editLog(' + log.id + ')">Edit</button>';
            html += '<button class="btn-action stop" style="padding: 0.5rem 0.75rem; font-size: 0.875rem;" onclick="deleteLog(' + log.id + ')">Delete</button>';
            html += '</div>';
            html += '</div>';
        });
        logHistory.innerHTML = html;
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
        const remoteVal = isRemoteLog(log);
        editRemote.checked = remoteVal;
        editMileage.value = (!remoteVal && log.travelMileage !== null && log.travelMileage !== undefined) ? log.travelMileage : '';
        setRemoteEntryFields(remoteVal, editArrivalTime, editMileage);

        // Prefer the raw epoch-ms fields when present - they're
        // unambiguous. Fall back to parsing the locale-formatted
        // display strings for older entries saved before those
        // fields existed.
        const startDate = (log.startMs !== null && log.startMs !== undefined)
            ? new Date(log.startMs)
            : parseToDate(log.start);
        editStartTime.value = formatDateTimeLocal(startDate);

        if (log.arrivalMs !== null && log.arrivalMs !== undefined) {
            editArrivalTime.value = formatDateTimeLocal(new Date(log.arrivalMs));
        } else if (log.arrivalTime && log.arrivalTime.trim() !== '') {
            // Legacy fallback: reconstruct the arrival Date from the
            // "h:mm AM/PM" display string plus the start date.
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

// Delete log function - opens the custom confirmation modal
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

    // Soft-delete: mark the log with _deleted: true so it gets synced to the server
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

    // Validate required fields and chronological sanity up front,
    // before touching the database - previously Start/End Time could
    // be left blank or reversed, which produced NaN durations
    // ("NaN:NaN:NaN") that were silently saved.
    const clientVal = editClient.value.trim();
    if (!clientVal || !editStartTime.value || !editEndTime.value) {
        alert("Client Name, Start Time, and End Time are required.");
        return;
    }

    const start = new Date(editStartTime.value);
    const end = new Date(editEndTime.value);
    const isRemoteEntry = editRemote.checked;
    const arrival = !isRemoteEntry && editArrivalTime.value ? new Date(editArrivalTime.value) : null;

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
        log.travelMileage = editMileage.value !== '' ? parseFloat(editMileage.value) : null;
        log.isRemote = isRemoteEntry;

        log.start = start.toLocaleString();
        log.end = end.toLocaleString();
        log.startMs = start.getTime();
        log.endMs = end.getTime();

        if (isRemoteEntry) {
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

function setRemoteEntryFields(isRemoteEntry, arrivalInput, mileageInput) {
    arrivalInput.disabled = isRemoteEntry;
    mileageInput.disabled = isRemoteEntry;
    if (isRemoteEntry) {
        arrivalInput.value = '';
        mileageInput.value = '';
    }
}

editRemote.addEventListener('change', () => {
    setRemoteEntryFields(editRemote.checked, editArrivalTime, editMileage);
});

addRemote.addEventListener('change', () => {
    setRemoteEntryFields(addRemote.checked, addArrivalTime, addMileage);
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
    addRemote.checked = false;
    setRemoteEntryFields(false, addArrivalTime, addMileage);
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

let selectedBillableTime = addBillableTime.value || '1';

const start = new Date(startTimeVal);
const end = new Date(endTimeVal);
const isRemoteEntry = addRemote.checked;
const arrival = !isRemoteEntry && arrivalTimeVal ? new Date(arrivalTimeVal) : null;

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

if (!isRemoteEntry && arrival) {
    formattedArrivalTime = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    travelDurationMs = arrival - start;
    onSiteDurationMs = end - arrival;
}

let selectedTravelMileage = null;
if (!isRemoteEntry && addMileage.value.trim() !== '') {
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
    isRemote: isRemoteEntry
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
    // Remove BOM if present
    const csvContent = content.replace(/\ufeff/, '');
    const lines = parseCsvLines(csvContent);

if (lines.length < 2) {
    alert('Invalid CSV file. File must have headers and at least one data row.');
    btnImportCsv.value = '';
    return;
}

// Parse header to verify format. The legacy export had 15 columns;
// the current export adds 3 trailing ISO-timestamp columns for
// reliable round-tripping. Accept either so older exports still import.
const headers = lines[0].split(',');
const legacyHeaderCount = 15;
const currentHeaderCount = 19;

if (headers.length !== legacyHeaderCount && headers.length !== currentHeaderCount) {
    alert('Invalid CSV format. Expected ' + legacyHeaderCount + ' or ' + currentHeaderCount + ' columns, found ' + headers.length + '.');
    btnImportCsv.value = '';
    return;
}

// Parse data rows
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

    // Determine if this is a legacy 15-column CSV or the current 19-column format.
    // The "Remote" column was inserted at index 13, shifting Notes/Parts/ISO columns.
    const isLegacy = row.length === 15;
    const notesIdx = isLegacy ? 13 : 14;
    const partsIdx = isLegacy ? 14 : 15;
    const startIsoIdx = isLegacy ? null : 16;
    const endIsoIdx = isLegacy ? null : 17;
    const arrivalIsoIdx = isLegacy ? null : 18;
    const remoteIdx = isLegacy ? null : 13;

    // Prefer the ISO timestamp columns (present in 19-column exports)
    // for unambiguous parsing; fall back to the locale display
    // strings for legacy 15-column CSVs.
    const startIso = startIsoIdx !== null && row[startIsoIdx] ? row[startIsoIdx].replace(/^\"|\"$/g, '') : '';
    const endIso = endIsoIdx !== null && row[endIsoIdx] ? row[endIsoIdx].replace(/^\"|\"$/g, '') : '';
    const arrivalIso = arrivalIsoIdx !== null && row[arrivalIsoIdx] ? row[arrivalIsoIdx].replace(/^\"|\"$/g, '') : '';

    const startMs = startIso ? new Date(startIso).getTime() : new Date(startStr).getTime();
    const endMs = endIso ? new Date(endIso).getTime() : new Date(endStr).getTime();
    const arrivalMs = arrivalIso ? new Date(arrivalIso).getTime() : (arrivalStr ? new Date(arrivalStr).getTime() : NaN);

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
        isRemote: remoteIdx !== null ? (row[remoteIdx].replace(/^\"|\"$/g, '').toLowerCase() === 'true') : false
    };
    newLogs.push(log);
    }
}

if (newLogs.length === 0) {
    alert('No valid entries found in CSV file.');
    btnImportCsv.value = '';
    return;
}

// Save to database
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

// Helper function to parse CSV text into logical lines (respecting quotes)
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

// Helper function to parse CSV row (handles quoted fields)
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

// Build the printable report into #printArea - a plain, always-static
// element parented directly under <body>, completely outside the
// on-screen modal (position:fixed) and flex-layout app shell.
//
// iOS Safari's print engine is unreliable at re-paginating content
// that ever lived inside a fixed-position / flex ancestor: even once
// @media print flips those ancestors to static/block, it often just
// renders whatever fit on the first "page" of the pre-print layout
// and silently drops the rest. Printing from a dedicated
// static container sidesteps that bug entirely.
//
// Splitting into one <table> per page (each with its own <thead>) is
// also required separately, since iOS Safari ignores
// display:table-header-group for print header repetition.
const ROWS_PER_PAGE = 10;

function buildPrintArea() {
    const table = reportContent.querySelector('table.report-table');
    if (!table) {
        printArea.innerHTML = '';
        return;
    }

    const thead = table.querySelector('thead');
    const theadHtml = thead ? thead.outerHTML : '';
    const colgroup = table.querySelector('colgroup');
    const colgroupHtml = colgroup ? colgroup.outerHTML : '';
    const rows = Array.from(table.querySelectorAll('tbody tr'));

    let tablesHtml = '';
    for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
        const chunk = rows.slice(i, i + ROWS_PER_PAGE);
        const pageBreak = i > 0 ? ' report-page-break' : '';
        tablesHtml += '<table class="report-table' + pageBreak + '">';
        tablesHtml += colgroupHtml + theadHtml + '<tbody>';
        chunk.forEach(row => { tablesHtml += row.outerHTML; });
        tablesHtml += '</tbody></table>';
    }

    printArea.innerHTML = '<div class="print-report-title">Billing Summary</div>' + tablesHtml;
    const summaryDiv = reportContent.querySelector('.report-summary-container');
    if (summaryDiv) {
        printArea.innerHTML += summaryDiv.outerHTML;
        alert('Failed to load logs for the report.');
    };
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- Cloud Sync (Offline-First Backup) ---

// API base URL — update this to your actual Worker URL before deployment.
// In production, this should match your deployed Worker URL (e.g. https://time-tracker.your-subdomain.workers.dev)
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

async function syncToCloud() {
    if (!isAuthenticated() || !db) return { success: false, error: 'Not authenticated' };
    try {
        const store = db.transaction(['logs'], 'readonly').objectStore('logs');
        const request = store.getAll();
        const logs = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        console.log('syncToCloud: pushing', logs.length, 'logs to server');
        const response = await fetch(`${API_BASE}/api/sync`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ logs })
        });
        if (!response.ok) {
            const error = await response.json();
            console.error('syncToCloud failed:', error);
            return { success: false, error: error.error || 'Sync failed' };
        }
        const result = await response.json();
        setLastSyncTime(result.serverTime);

        // Clean up locally soft-deleted records that were successfully synced to the server
        const deletedIds = result.upserted
            .filter(u => u.action === 'deleted')
            .map(u => u.id);
        if (deletedIds.length > 0 && db) {
            const tx = db.transaction(['logs'], 'readwrite');
            const store = tx.objectStore('logs');
            deletedIds.forEach(id => store.delete(id));
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
            return { success: false, error: error.error || 'Fetch failed' };
        }
        const data = await response.json();
        const serverLogs = data.logs || [];
        console.log('syncFromCloud: received', serverLogs.length, 'logs from server');
        const tx = db.transaction(['logs'], 'readwrite');
        const store = tx.objectStore('logs');
        for (const log of serverLogs) {
            await new Promise((resolve, reject) => {
                const req = store.put(log);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }
        setLastSyncTime(data.serverTime);
        return { success: true, count: serverLogs.length };
    } catch (error) {
        console.error('syncFromCloud error:', error);
        return { success: false, error: error.message };
    }
}

async function performSync() {
    if (!isAuthenticated()) return;
    syncStatusEl.classList.remove('hidden');
    updateSyncStatus('syncing');
    const since = getLastSyncTime();
    await syncToCloud();
    await syncFromCloud(since);
    checkConnectivity();
    renderLogs();
}

function syncAfterWrite() {
    if (isAuthenticated()) {
        syncStatusEl.classList.remove('hidden');
        updateSyncStatus('syncing');
        setTimeout(() => {
            syncToCloud().then(result => {
                if (!result.success) {
                    console.log('Background sync failed:', result.error);
                }
                checkConnectivity();
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
    const colors = { online: '#10b981', syncing: '#f59e0b', offline: '#ef4444', idle: '#6b7280' };
    syncStatusEl.textContent = status;
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
    authBtn.textContent = 'Login';
}

function hideAuthModal() {
    authModal.classList.add('hidden');
}

tabLoginAuth.addEventListener('click', () => {
    isLoginMode = true;
    tabLoginAuth.classList.add('active');
    tabRegisterAuth.classList.remove('active');
    authBtn.textContent = 'Login';
    authError.style.display = 'none';
});

tabRegisterAuth.addEventListener('click', () => {
    isLoginMode = false;
    tabRegisterAuth.classList.add('active');
    tabLoginAuth.classList.remove('active');
    authBtn.textContent = 'Register';
    authError.style.display = 'none';
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

// Show auth modal on page load if not authenticated
if (!isAuthenticated()) {
    showAuthModal();
}

// Logout handler
btnLogout.addEventListener('click', async () => {
    if (!isAuthenticated()) return;
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

// --- Dark mode toggle ---

// Dark mode toggle
const btnDarkMode = document.getElementById('btnDarkMode');

// Dark mode already initialized inline in <head>
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
                // Notify user if a new service worker is waiting to activate
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

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, 10000);
}
