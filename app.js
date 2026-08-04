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

dbRequest.onsuccess = (e) => { db = e.target.result; renderLogs(); restoreTimerState(); };
dbRequest.onerror = () => alert("Database failure. Allow local storage permissions.");

let timerInterval = null, startTime = null, isRunning = false, arrivalTime = null, startMileage = null, arrivalMileage = null, travelMileage = null, editingLogId = null, requestMileage = localStorage.getItem('requestMileage') === 'true';

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
        client: clientInput.value.trim()
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
        isRunning = true;
        clientInput.value = state.client;
        clientInput.disabled = true;
        activeClientLabel.textContent = "Tracking: " + state.client;

        btnAction.textContent = "End Timer";
        btnAction.classList.remove('start');
        btnAction.classList.add('stop');
        liveTimer.classList.add('running');
        btnMarkArrival.classList.remove('hidden');
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
        if (requestMileage && startMileage === null) {
            startMileageInput.value = '';
            startMileageModal.classList.remove('hidden');
            startMileageInput.focus();
        } else if (requestMileage && arrivalMileage === null && arrivalTime) {
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
const btnExport = document.getElementById('btnExport');
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
    const btnCancelAdd = document.getElementById('btnCancelAdd');
    const btnSaveAdd = document.getElementById('btnSaveAdd');

const btnAddEntry = document.getElementById('btnAddEntry');

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
    clientInput.disabled = true;
    activeClientLabel.textContent = "Tracking: " + clientName;

    btnAction.textContent = "End Timer";
    btnAction.classList.remove('start');
    btnAction.classList.add('stop');
    liveTimer.classList.add('running');

    btnMarkArrival.classList.remove('hidden');
    arrivalBadge.classList.add('hidden');

    timerInterval = setInterval(updateLiveDisplay, 1000);

    // Save timer state for persistence
    saveTimerState();

    // Show start mileage modal if mileage is requested
    if (requestMileage) {
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

      btnMarkArrival.addEventListener('click', () => {
          if (!isRunning || arrivalTime) return;
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
        travelMileage: travelMileage
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

        partsModal.classList.add('hidden');
        renderLogs();
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
    const request = store.clear();

    request.onsuccess = () => {
        clearConfirmModal.classList.add('hidden');
        renderLogs();
    };
    request.onerror = () => {
        alert("Failed to clear database logs.");
    };
});

function renderLogs() {
    if (!db) return;
    const store = db.transaction(["logs"], "readonly").objectStore("logs");
    const request = store.getAll();

    request.onsuccess = () => {
        const logs = request.result.reverse();
        if (logs.length === 0) {
            logHistory.innerHTML = '<div class="empty-state">No logged hours found.</div>';
            btnClear.classList.add('hidden');
            return;
        }

        btnClear.classList.remove('hidden');
        let html = "";
        logs.forEach(log => {
            html += '<div class="log-card">';
            html += '<div class="log-card-header">';
            html += '<div><h4 class="log-client-name">' + escapeHtml(log.client) + '</h4>';
            html += '<p class="log-timestamp">' + log.start + '</p></div>';
            html += '<span class="duration-pill">' + log.duration + ' (' + log.decimalHours + 'h)</span>';
            html += '</div>';

            if (log.travelDurationMs && log.onSiteDurationMs) {
                const travelDur = formatDuration(log.travelDurationMs);
                const onSiteDur = formatDuration(log.onSiteDurationMs);
                html += '<div class="log-travel-details">';
                html += '<span>🚗 Travel: ' + escapeHtml(travelDur) + '</span>';
                html += '<span>💼 Client: ' + escapeHtml(onSiteDur) + '</span>';
                html += '</div>';
            }

            if (log.travelMileage !== null && log.travelMileage !== undefined) {
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
        editMileage.value = (log.travelMileage !== null && log.travelMileage !== undefined) ? log.travelMileage : '';

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
    const request = store.delete(pendingDeleteId);

    request.onsuccess = () => {
        btnConfirmDelete.disabled = false;
        pendingDeleteId = null;
        deleteConfirmModal.classList.add('hidden');
        renderLogs();
    };
    request.onerror = () => {
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
        log.travelMileage = editMileage.value !== '' ? parseFloat(editMileage.value) : null;

        log.start = start.toLocaleString();
        log.end = end.toLocaleString();
        log.startMs = start.getTime();
        log.endMs = end.getTime();

        if (arrival) {
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
const arrival = arrivalTimeVal ? new Date(arrivalTimeVal) : null;

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

if (arrival) {
    formattedArrivalTime = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    travelDurationMs = arrival - start;
    onSiteDurationMs = end - arrival;
}

let selectedTravelMileage = null;
if (addMileage.value.trim() !== '') {
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
    travelMileage: selectedTravelMileage
};

btnSaveAdd.disabled = true;

const transaction = db.transaction(["logs"], "readwrite");
const store = transaction.objectStore("logs");
store.add(newLog);

transaction.oncomplete = () => {
    btnSaveAdd.disabled = false;
    addEntryModal.classList.add('hidden');
    renderLogs();
    };

transaction.onerror = () => {
    btnSaveAdd.disabled = false;
    alert('Failed to save the entry. Please try again.');
};
});

btnExport.addEventListener('click', () => {
    exportToCSV();
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
const btnImport = document.getElementById('btnImport');
const btnImportCsv = document.getElementById('btnImportCsv');

btnImport.addEventListener('click', () => {
    btnImportCsv.click();
});

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
const currentHeaderCount = 18;

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
    const durationStr = row[5].replace(/^"|"$/g, '');
    const travelDurStr = row[6].replace(/^"|"$/g, '');
    const onSiteDurStr = row[7].replace(/^"|"$/g, '');
    const startStr = row[2].replace(/^"|"$/g, '');
    const endStr = row[4].replace(/^"|"$/g, '');
    const arrivalStr = row[3].replace(/^"|"$/g, '') || null;

    // Prefer the ISO timestamp columns (present in 18-column exports)
    // for unambiguous parsing; fall back to the locale display
    // strings for legacy 15-column CSVs.
    const startIso = row[15] ? row[15].replace(/^"|"$/g, '') : '';
    const endIso = row[16] ? row[16].replace(/^"|"$/g, '') : '';
    const arrivalIso = row[17] ? row[17].replace(/^"|"$/g, '') : '';

    const startMs = startIso ? new Date(startIso).getTime() : new Date(startStr).getTime();
    const endMs = endIso ? new Date(endIso).getTime() : new Date(endStr).getTime();
    const arrivalMs = arrivalIso ? new Date(arrivalIso).getTime() : (arrivalStr ? new Date(arrivalStr).getTime() : NaN);

    const log = {
        client: row[1].replace(/^"|"$/g, ''),
        start: startStr,
        startMs: isNaN(startMs) ? null : startMs,
        arrivalTime: arrivalStr,
        arrivalMs: isNaN(arrivalMs) ? null : arrivalMs,
        end: endStr,
        endMs: isNaN(endMs) ? null : endMs,
        duration: durationStr,
        durationMs: parseDurationToMs(durationStr),
        decimalHours: row[8] || '0',
        notes: row[13].replace(/^"|"$/g, ''),
        parts: row[14] ? row[14].replace(/^"|"$/g, '') : '',
        billableTime: row[9].replace(/^"|"$/g, '') || '1',
        travelDurationMs: parseDurationToMs(travelDurStr),
        onSiteDurationMs: parseDurationToMs(onSiteDurStr),
        startMileage: row[10] !== '' ? parseFloat(row[10]) : null,
        arrivalMileage: row[11] !== '' ? parseFloat(row[11]) : null,
        travelMileage: row[12] !== '' ? parseFloat(row[12]) : null
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
        const logs = e.target.result;
        if (logs.length === 0) {
            alert("There is no data recorded to export.");
            return;
        }

        const headers = ["ID", "Client", "Start Time", "Arrival Time", "End Time", "Total Duration", "Travel Duration", "On-Site Duration", "Decimal Hours", "Billable Time", "Start Mileage", "Arrival Mileage", "Travel Miles", "Notes", "Parts Used", "Start ISO", "End ISO", "Arrival ISO"];
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
                '"' + (log.travelDurationMs ? formatDuration(log.travelDurationMs) : "") + '"',
                '"' + (log.onSiteDurationMs ? formatDuration(log.onSiteDurationMs) : "") + '"',
                log.decimalHours,
                '"' + (log.billableTime || "") + '"',
                mi(log.startMileage),
                mi(log.arrivalMileage),
                mi(log.travelMileage),
                formatNotesForCsv(log.notes),
                formatNotesForCsv(log.parts || ""),
                (log.startMs !== null && log.startMs !== undefined) ? new Date(log.startMs).toISOString() : "",
                (log.endMs !== null && log.endMs !== undefined) ? new Date(log.endMs).toISOString() : "",
                (log.arrivalMs !== null && log.arrivalMs !== undefined) ? new Date(log.arrivalMs).toISOString() : ""
            ];
            csvRows.push(row.join(","));
        });

        const csvString = csvRows.join("\r\n");
        // Add UTF-8 BOM for Excel compatibility
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

// Helper function to format notes with CRLF between sentences wrapped in quotes
function formatNotesForCsv(notes) {
    if (!notes || notes.trim() === '') return '""';
    const sentences = notes.trim().split(/(?<=[.!?])\s+|\r?\n+/).filter(s => s.trim() !== '');
    if (sentences.length === 0) return '""';
    const formatted = sentences.map(sentence => sentence.trim()).join("\r\n");
    return '"' + formatted.replace(/"/g, '""') + '"';
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
        // Previous week: Monday to Friday
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

function generateReportForDateRange(startDate, endDate) {
    if (!db) return;
    const store = db.transaction(["logs"], "readonly").objectStore("logs");
    const request = store.getAll();

    request.onsuccess = function(e) {
        const logs = e.target.result;

        // Prefer the raw startMs field (unambiguous, locale-independent).
        // Fall back to re-parsing the display string for older entries
        // that predate the startMs field.
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

        let hasMileage = filteredLogs.some(log => log.travelMileage !== null && log.travelMileage !== undefined);
        let tableHtml = '<table class="report-table">';
        if (hasMileage) {
            tableHtml += '<thead><tr><th style="width: 15%;">Date</th><th style="width: 25%;">Client</th><th style="width: 12%;">Invoice #</th><th style="width: 25%;">Timeline</th><th style="width: 13%;">Billable Time</th><th style="width: 10%;">Mileage</th></tr></thead>';
        } else {
            tableHtml += '<thead><tr><th style="width: 15%;">Date</th><th style="width: 25%;">Client</th><th style="width: 12%;">Invoice #</th><th style="width: 30%;">Timeline</th><th style="width: 15%;">Billable Time</th></tr></thead>';
        }
        tableHtml += '<tbody>';

        filteredLogs.forEach(log => {
            const startDateObj = (log.startMs !== null && log.startMs !== undefined) ? new Date(log.startMs) : new Date(log.start);
            const endDateObj = (log.endMs !== null && log.endMs !== undefined) ? new Date(log.endMs) : new Date(log.end);
            const dateOnly = startDateObj.toLocaleDateString();
            const startTimeStr = startDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTimeStr = endDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let timelineHtml = "";
            let breakdownHtml = "";

            let billableDecimal;
            if (log.billableTime && log.billableTime !== '1') {
                billableDecimal = log.billableTime;
            } else {
                billableDecimal = formatBillableTime(log.travelDurationMs, log.onSiteDurationMs, log.durationMs);
            }

            if (log.travelDurationMs && log.onSiteDurationMs && log.arrivalTime) {
                const travelDecimal = formatDecimalQuarter(log.travelDurationMs);
                const onSiteDecimal = formatDecimalQuarter(log.onSiteDurationMs);
                timelineHtml = `Start: ${escapeHtml(startTimeStr)}<br>Arrived: ${escapeHtml(log.arrivalTime)}<br>End: ${escapeHtml(endTimeStr)}`;
                breakdownHtml = `${escapeHtml(billableDecimal)}`;
            } else {
                timelineHtml = `Start: ${escapeHtml(startTimeStr)}<br>End: ${escapeHtml(endTimeStr)}`;
                breakdownHtml = `${escapeHtml(billableDecimal)}`;
            }

            tableHtml += '<tr>';
            tableHtml += `<td>${escapeHtml(dateOnly)}</td>`;
            tableHtml += `<td><strong>${escapeHtml(log.client)}</strong></td>`;
            tableHtml += `<td style="font-size: 0.8rem; color: var(--text-muted);">-</td>`;
            tableHtml += `<td style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.3;">${timelineHtml}</td>`;
            tableHtml += `<td style="font-family: monospace; font-size: 0.85rem; line-height: 1.3;">${breakdownHtml}</td>`;
            if (hasMileage) {
                tableHtml += `<td>${(log.travelMileage !== null && log.travelMileage !== undefined) ? log.travelMileage + ' mi' : ''}</td>`;
            }
            tableHtml += '</tr>';
        });

        tableHtml += '</tbody></table>';

        reportContent.innerHTML = tableHtml;

        reportModal.classList.remove('hidden');
    };

    request.onerror = () => {
        alert('Failed to load logs for the report.');
    };
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

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
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });

        async function login(email) {
          const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const data = await response.json();
          if (data.token) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userEmail', data.email);
          }
          return data;
        }
    });
}
