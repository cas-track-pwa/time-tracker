<?php
declare(strict_types=1);

/*
 * Time Tracker -> ITFlow bridge
 * POST JSON
 *
 * Sits between the time-tracker PWA and ITFlow so the ITFlow API key never
 * reaches the browser, and so the browser never has to talk to ITFlow's API
 * cross-origin (ITFlow sends no CORS headers and answers OPTIONS with 405).
 *
 * Request body:
 *   {
 *     "client":    "Ravenwood Dental Group",   // exact ITFlow client name
 *     "client_id": 2,                          // alternative to "client"
 *     "date":      "2026-09-30",               // invoice date (default: today)
 *     "scope":     "September 2026 support",    // optional invoice scope
 *     "reference": "INV-1042",                 // optional time-tracker invoice #
 *     "entries": [
 *       { "date":"2026-09-02", "hours":4.5, "start":"09:00", "end":"13:30",
 *         "notes":"...", "remote":false }
 *     ]
 *   }
 *
 * Response:
 *   {"success":true,"invoice_id":471,"client_id":2,"client":"...","rate":145,
 *    "total_hours":4.5,"items_created":1}
 *
 * Auth: X-Bridge-Token header (or Authorization: Bearer <token>).
 */

header('Content-Type: application/json; charset=utf-8');

$config = require __DIR__ . '/config.php';

// --- Optional CORS, only for cross-origin dev (same-origin needs nothing) ---
$allowedOrigin = trim((string) ($config['ALLOWED_ORIGIN'] ?? ''));
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($allowedOrigin !== '' && $origin !== '' && hash_equals($allowedOrigin, $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Headers: Content-Type, X-Bridge-Token');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

// --- Auth -----------------------------------------------------------------
$expectedToken = (string) ($config['BRIDGE_TOKEN'] ?? '');
if ($expectedToken !== '') {
    $provided = (string) ($_SERVER['HTTP_X_BRIDGE_TOKEN'] ?? '');
    if ($provided === '' && isset($_SERVER['HTTP_AUTHORIZATION'])
        && preg_match('/^Bearer\s+(.+)$/i', (string) $_SERVER['HTTP_AUTHORIZATION'], $m)) {
        $provided = trim($m[1]);
    }
    if (!hash_equals($expectedToken, $provided)) {
        respond(401, ['success' => false, 'error' => 'Unauthorized']);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['success' => false, 'error' => 'POST required']);
}

// --- Input ----------------------------------------------------------------
$input = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($input)) {
    respond(400, ['success' => false, 'error' => 'Invalid JSON body']);
}

$clientName = trim((string) ($input['client'] ?? ''));
$clientId   = intval($input['client_id'] ?? 0);
$date       = trim((string) ($input['date'] ?? ''));
$scope      = trim((string) ($input['scope'] ?? ''));
$reference  = trim((string) ($input['reference'] ?? ''));
$entries    = is_array($input['entries'] ?? null) ? $input['entries'] : [];

if ($clientName === '' && $clientId <= 0) {
    respond(400, ['success' => false, 'error' => 'client (name) or client_id is required']);
}
if ($entries === []) {
    respond(400, ['success' => false, 'error' => 'entries[] is required']);
}
if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    respond(400, ['success' => false, 'error' => 'date must be YYYY-MM-DD']);
}

$base   = rtrim((string) ($config['ITFLOW_BASE'] ?? ''), '/');
$apiKey = (string) ($config['ITFLOW_API_KEY'] ?? '');
if ($base === '' || $apiKey === '') {
    respond(500, ['success' => false, 'error' => 'Bridge is not configured']);
}

$verifyTls = (bool) ($config['ITFLOW_VERIFY_TLS'] ?? true);
$timeout   = intval($config['HTTP_TIMEOUT'] ?? 30);

function httpRequest(string $method, string $url, array $headers, ?string $body, bool $verifyTls, int $timeout): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_SSL_VERIFYPEER => $verifyTls,
            CURLOPT_SSL_VERIFYHOST => $verifyTls ? 2 : 0,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $resp   = curl_exec($ch);
        $status = intval(curl_getinfo($ch, CURLINFO_HTTP_CODE));
        if ($resp === false) {
            $err = curl_error($ch);
            curl_close($ch);
            respond(502, ['success' => false, 'error' => 'HTTP request failed: ' . $err]);
        }
        curl_close($ch);
        return ['status' => $status, 'body' => (string) $resp];
    }

    // No curl extension: fall back to the streams wrapper.
    $opts = [
        'http' => [
            'method'        => $method,
            'header'        => implode("\r\n", $headers),
            'timeout'       => $timeout,
            'ignore_errors' => true,
        ],
    ];
    if ($body !== null) {
        $opts['http']['content'] = $body;
    }
    if (!$verifyTls) {
        $opts['ssl'] = ['verify_peer' => false, 'verify_peer_name' => false];
    }
    $resp   = @file_get_contents($url, false, stream_context_create($opts));
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) {
        $status = intval($m[1]);
    }
    if ($resp === false) {
        respond(502, ['success' => false, 'error' => 'HTTP request failed']);
    }
    return ['status' => $status, 'body' => $resp];
}

// --- Resolve the ITFlow client and its hourly rate -------------------------
$lookupQuery = $clientId > 0
    ? 'client_id=' . $clientId
    : 'client_name=' . rawurlencode($clientName);

$lookup = httpRequest(
    'GET',
    $base . '/api/v1/clients/read.php?api_key=' . rawurlencode($apiKey) . '&' . $lookupQuery,
    [],
    null,
    $verifyTls,
    $timeout
);

if ($lookup['status'] !== 200) {
    respond(502, ['success' => false, 'error' => 'ITFlow client lookup failed', 'http_status' => $lookup['status']]);
}

$lookupData = json_decode($lookup['body'], true);
if (!is_array($lookupData) || ($lookupData['success'] ?? 'False') !== 'True' || empty($lookupData['data'])) {
    respond(404, ['success' => false, 'error' => 'No ITFlow client matched: ' . ($clientName !== '' ? $clientName : '#' . $clientId)]);
}

$client    = $lookupData['data'][0];
$clientId  = intval($client['client_id'] ?? 0);
$rate      = floatval($client['client_rate'] ?? 0);
$resolved  = (string) ($client['client_name'] ?? $clientName);

if ($clientId <= 0) {
    respond(502, ['success' => false, 'error' => 'ITFlow returned a client without an id']);
}

// --- Build one line item per log entry ------------------------------------
$items = [];
$order = 0;
$totalHours = 0.0;

foreach ($entries as $entry) {
    if (!is_array($entry)) {
        continue;
    }

    $hours = floatval($entry['hours'] ?? 0);
    if ($hours <= 0) {
        continue;
    }

    $remote = !empty($entry['remote']);
    $edate  = trim((string) ($entry['date'] ?? ''));
    $start  = trim((string) ($entry['start'] ?? ''));
    $end    = trim((string) ($entry['end'] ?? ''));
    $notes  = trim((string) ($entry['notes'] ?? ''));

    $descParts = [];
    if ($edate !== '') {
        $descParts[] = $edate;
    }
    if ($start !== '' || $end !== '') {
        $descParts[] = trim($start . '-' . $end, '-');
    }
    if ($notes !== '') {
        $descParts[] = $notes;
    }

    $items[] = [
        'name'        => $remote ? 'Remote support' : 'On-site support',
        'description' => implode(' · ', $descParts),
        'qty'         => $hours,
        'price'       => $rate,
        'item_order'  => $order++,
    ];

    $totalHours += $hours;
}

if ($items === []) {
    respond(400, ['success' => false, 'error' => 'entries[] contained no billable hours']);
}

if ($scope === '') {
    $scope = 'Support' . ($reference !== '' ? ' - ' . $reference : '');
}

// --- Create the invoice in ITFlow -----------------------------------------
$payload = [
    'api_key'     => $apiKey,
    'client_id'   => $clientId,
    'date'        => $date !== '' ? $date : date('Y-m-d'),
    'scope'       => $scope,
    'category_id' => intval($config['DEFAULT_CATEGORY_ID'] ?? 0),
    'items'       => $items,
];

$create = httpRequest(
    'POST',
    $base . '/api/v1/invoices/create.php',
    ['Content-Type: application/json'],
    json_encode($payload),
    $verifyTls,
    $timeout
);

$createData = json_decode($create['body'], true);
if ($create['status'] !== 200 || !is_array($createData) || ($createData['success'] ?? 'False') !== 'True') {
    respond(502, [
        'success'     => false,
        'error'       => 'ITFlow invoice create failed',
        'http_status' => $create['status'],
        'itflow'      => $createData,
    ]);
}

$invoiceId = intval($createData['data'][0]['insert_id'] ?? 0);

respond(200, [
    'success'       => true,
    'invoice_id'    => $invoiceId,
    'client_id'     => $clientId,
    'client'        => $resolved,
    'rate'          => $rate,
    'total_hours'   => round($totalHours, 2),
    'items_created' => count($items),
]);
