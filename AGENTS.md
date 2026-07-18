# Time Tracker - Agent Guidelines

## Project Overview

A progressive web app (PWA) for time tracking that allows users to:
- Track work time with a live timer
- Log manual time entries
- Track travel time and on-site duration separately
- Record mileage for travel
- Generate billing reports
- Export data to CSV

## Architecture

### Single-File Application
- **index.html**: Contains all HTML, CSS, and JavaScript in a single file
- Uses IndexedDB (`TimeTrackerDB`) for data persistence
- No external dependencies or frameworks

### Data Model

Each log entry in the `logs` store contains:
```javascript
{
  id: number,           // Auto-incremented primary key
  client: string,       // Client name
  start: string,        // Start datetime (localized string)
  end: string,          // End datetime (localized string)
  duration: string,       // Formatted duration (HH:MM:SS)
  durationMs: number,     // Duration in milliseconds
  decimalHours: string,   // Duration in decimal hours
  notes: string,        // Work notes
  billableTime: string,   // Billable time (decimal hours or "sales call")
  arrivalTime: string,    // Arrival time (HH:MM format)
  travelDurationMs: number,  // Travel duration in ms
  onSiteDurationMs: number,  // On-site duration in ms
  startMileage: number, // Starting odometer reading
  arrivalMileage: number, // Arrival odometer reading
  travelMileage: number // Calculated travel distance
}
```

### Modal Components

| Modal | ID | Purpose |
|-------|-----|---------|
| Job Complete | `notesModal` | Save timer logs with notes and billable time |
| Start Mileage | `startMileageModal` | Enter starting odometer reading |
| Arrival Mileage | `arrivalMileageModal` | Enter arrival odometer reading |
| Add Manual Entry | `addEntryModal` | Create manual time entries |
| Edit Log | `editModal` | Edit existing log entries |
| Clear Confirm | `clearConfirmModal` | Confirm clearing all data |
| Billing Summary | `reportModal` | View billing report |
| Report Range | `reportRangeModal` | Select date range for reports |

### Key Functions

- `formatDuration(ms)`: Converts milliseconds to HH:MM:SS format
- `formatDecimalQuarter(ms)`: Converts ms to quarter-hour increments
- `formatBillableTime()`: Calculates billable time from durations
- `renderLogs()`: Renders all logs from IndexedDB
- `exportToCSV()`: Exports logs to CSV file
- `generateReportForDateRange()`: Generates billing report for date range

### Timer Flow

1. User enters client name and clicks "Start Timer"
2. Start mileage modal appears → user enters odometer reading
3. User clicks "Mark Arrival" when arriving → arrival time recorded
4. Arrival mileage modal appears → user enters odometer reading
5. User clicks "End Timer" → notes modal appears
6. User saves → log entry created with all timing data

### Manual Entry Flow

1. User clicks "Add Entry" button
2. Modal opens with current time pre-filled for start/end
3. User fills in: Client, Start Time, End Time, **Arrival Time** (optional), Notes, Billable Time, Travel Miles
4. User clicks "Save Entry" → log entry created

## Coding Conventions

### HTML Structure
- All modals use `.modal-overlay.hidden` pattern for visibility
- Form fields use `.form-group` wrapper with `.label-title` labels
- Buttons use `.flex-row-gap` container for action buttons

### JavaScript Patterns
- Use `const` for element references
- Use `addEventListener` for event handling
- Use IndexedDB transactions for data operations
- Format times using `toLocaleTimeString()` with 2-digit options

### Styling
- CSS variables defined in `:root` for colors and spacing
- Mobile-first responsive design
- Print styles hide unnecessary elements

## Common Tasks

### Adding a New Field to Manual Entry Modal
1. Add `<input>` element in `#addEntryModal` after existing fields
2. Add `const` declaration for the new element
3. Update `btnSaveAdd` handler to read and process the value
4. Include the value in the `newLog` object

### Modifying Data Model
1. Update the object structure in `btnSaveLog` handler
2. Update the object structure in `btnSaveAdd` handler
3. Update `renderLogs()` if displaying the new field
4. Update CSV export headers and row data
5. Update report generation if needed

## File Structure
```
time-tracker/
├── index.html          # Main application (HTML/CSS/JS)
├── manifest.webapp     # PWA manifest
└── icons/
    ├── icon.svg        # App icon
    ├── icon-192.png    # 192px icon
    └── icon-512.png    # 512px icon
```