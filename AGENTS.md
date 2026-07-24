# Time Tracker - Agent Guidelines

## Project Overview

A progressive web app (PWA) for time tracking that allows users to:
- Track work time with a live timer
- Log manual time entries
- Track travel time and on-site duration separately
- Record mileage for travel
- Generate billing reports
- Export/import data to/from CSV

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
- `exportToCSV()`: Exports logs to CSV file with UTF-8 BOM
- `generateReportForDateRange()`: Generates billing report for date range
- `parseDurationToMs(durationStr)`: Converts "HH:MM:SS" string to milliseconds
- `parseCsvRow(row)`: Parses CSV row handling quoted fields

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
3. User fills in: Client, Start Time, Arrival Time (optional), End Time, Notes, Billable Time, Travel Miles
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

### Data Field Names
- **Duration fields**: `travelDurationMs`, `onSiteDurationMs`, `durationMs` (milliseconds)
- **Formatted duration**: `duration` (HH:MM:SS string)
- **Mileage fields**: `startMileage`, `arrivalMileage`, `travelMileage`

### Styling
- CSS variables defined in `:root` for colors and spacing
- Mobile-first responsive design
- Print styles hide unnecessary elements

## PWA Configuration

### Android Support
- Manifest linked via `icons/manifest.json`
- Icons: 192x192, 512x512, and maskable variants
- Theme color meta tag for Android Chrome
- Standalone display mode

### iOS Support
- Apple touch icons (180x180)
- Apple mobile web app meta tags
- Standalone display mode

## Common Tasks

### Adding a New Field to Manual Entry Modal
1. Add `<input>` element in `#addEntryModal` after existing fields
2. Add `const` declaration for the new element
3. Update `btnSaveAdd` handler to read and process the value
4. Include the value in the `newLog` object
5. Update CSV export headers and row data

### Modifying Data Model
1. Update the object structure in `btnSaveLog` handler
2. Update the object structure in `btnSaveAdd` handler
3. Update `renderLogs()` if displaying the new field
4. Update CSV export headers and row data
5. Update report generation if needed

### CSV Import/Export
- Export includes UTF-8 BOM for Excel compatibility
- Import parses duration strings (HH:MM:SS) to milliseconds
- Header format: ID, Client, Start Time, Arrival Time, End Time, Total Duration, Travel Duration, On-Site Duration, Decimal Hours, Billable Time, Start Mileage, Arrival Mileage, Travel Miles, Notes

## File Structure
```
time-tracker/
├── index.html          # Main application (HTML/CSS/JS)
├── manifest.webapp     # PWA manifest (iOS focused)
├── icons/
│   ├── icon.svg                    # SVG app icon
│   ├── icon-16.png                   # 16x16 favicon
│   ├── icon-24.png                   # 24x24 favicon
│   ├── icon-32.png                   # 32x32 favicon
│   ├── icon-48.png                   # 48x48 Android icon
│   ├── icon-72.png                   # 72x72 Android icon
│   ├── icon-96.png                   # 96x96 Android icon
│   ├── icon-128.png                  # 128x128 Android icon
│   ├── icon-144.png                  # 144x144 Android icon
│   ├── icon-152.png                  # 152x152 iOS icon
│   ├── icon-180.png                  # 180x180 Apple touch icon
│   ├── icon-192.png                  # 192x192 Android icon
│   ├── icon-256.png                  # 256x256 Android icon
│   ├── icon-384.png                  # 384x384 Android icon
│   ├── icon-512.png                  # 512x512 Android icon
│   ├── icon-maskable-192.png         # 192x192 maskable (Android adaptive)
│   ├── icon-maskable-512.png         # 512x512 maskable (Android adaptive)
│   ├── apple-touch-icon.png            # Apple touch icon
│   ├── browserconfig.xml             # IE11 tile config
│   ├── mstile-150x150.png             # Windows tile
│   ├── safari-pinned-tab.svg         # Safari pinned tab
│   ├── manifest.json                 # Standard web app manifest (Android)
│   └── site.webmanifest              # Alternative manifest
```

## Known Issues & Fixes

### Entries Not Showing in Main Display
- **Cause**: `renderLogs()` was checking `log.travelDuration` and `log.onSiteDuration` but the data model stores `log.travelDurationMs` and `log.onSiteDurationMs`
- **Fix**: Updated to check `log.travelDurationMs` and `log.onSiteDurationMs`, then format using `formatDuration()`

### Report Button Not Working
- **Cause**: Same field name mismatch as above
- **Fix**: Updated `renderLogs()` to use correct field names

### CSV Import Billable Time Incorrect
- **Cause**: `parseDurationToMs()` was defined after it was used, and duration strings weren't being parsed correctly
- **Fix**: Moved function definition earlier, added proper duration string parsing

### Print Report Cutoff
- **Cause**: Missing page-break CSS for table elements
- **Fix**: Added `page-break-inside: avoid` to table and table rows