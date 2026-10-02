<?php
// Copy this file to config.php and fill in real values. config.php is gitignored.
// Keep config.php outside the webroot if you can, and never serve it publicly.
return [
    // Base URL of the ITFlow install (no trailing slash).
    'ITFLOW_BASE'          => 'https://itflow.cas2013.local',

    // API key created in ITFlow under Admin > API. Stays server-side only.
    'ITFLOW_API_KEY'       => 'PASTE_API_KEY_HERE',

    // Verify ITFlow's TLS certificate. Set false only for a self-signed host.
    'ITFLOW_VERIFY_TLS'    => false,

    // Shared secret the time-tracker sends as the X-Bridge-Token header.
    // Generate with: openssl rand -hex 32
    'BRIDGE_TOKEN'         => 'PASTE_A_LONG_RANDOM_SECRET',

    // Optional. Set to the PWA origin to allow cross-origin calls during dev,
    // e.g. http://localhost:8080. Leave empty for same-origin only.
    'ALLOWED_ORIGIN'       => '',

    // Optional default Income category id for created invoices (0 = none).
    'DEFAULT_CATEGORY_ID'  => 0,

    // HTTP timeout in seconds for calls to ITFlow.
    'HTTP_TIMEOUT'         => 30,
];
