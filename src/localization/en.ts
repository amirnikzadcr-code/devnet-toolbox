export const en = {
  home_title: '💻 <b>DevNet Toolbox</b>',
  home_tagline: '<i>A professional developer, network & utility toolbox — right inside Telegram.</i>',
  home_body:
    '▫️ <b>{count}</b> ready-to-use tools across <b>4</b> categories\n' +
    '▫️ No installs, no sign-up, no ads\n' +
    '▫️ Running on the edge (Cloudflare Workers)',
  home_hint: '👇 Pick a section below',

  btn_toolbox: '🧰 Toolbox',
  btn_quick: '⚡ Quick Tools',
  btn_profile: '👤 Profile',
  btn_settings: '⚙️ Settings',
  btn_help: '❓ Help',
  btn_about: 'ℹ️ About',
  btn_home: '🏠 Home',
  btn_back: '◀️ Back',
  btn_stats: '📊 Statistics',
  btn_my_tools: '🧰 My Tools',
  btn_language: '🌐 Language',
  btn_run: '▶️ Run tool',
  btn_again: '🔄 Run again',
  btn_prev: '⬅️ Prev',
  btn_next: 'Next ➡️',
  btn_cancel: '✖️ Cancel',
  btn_global_stats: '🌍 Global stats',

  toolbox_title: '🧰 <b>Toolbox</b>',
  toolbox_body: 'Choose a category. <b>{count}</b> tools available in total.',
  cat_programming: '💻 Programming',
  cat_network: '🌐 Network',
  cat_security: '🔐 Security',
  cat_utilities: '🛠 Utilities',
  cat_quick: '⚡ Quick Tools',
  category_body: '{count} tools in this category — page {page} of {pages}',

  tool_desc_label: '📄 <b>Description</b>',
  tool_usage_label: '🎯 <b>Usage</b>',
  tool_example_label: '🧪 <b>Example</b>',
  tool_limits_label: '⚠️ <b>Limitations</b>',
  tool_prompt: '✍️ Send your input as a normal message.',
  tool_no_input: 'This tool needs no input — just press “Run tool”.',
  tool_waiting: '⏳ Waiting for your input for <b>{tool}</b> …\n\nPress “Cancel” to abort.',
  tool_processing: '⏳ Processing…',
  tool_result_title: '✅ <b>{tool}</b>',
  tool_cancelled: '✖️ Operation cancelled.',

  // ─── Phase 3: file-based tools & attachments ────────────
  tool_file_prompt: '📎 Send the file as a <b>Document</b>.',
  tool_file_waiting: '⏳ Waiting for your file for <b>{tool}</b> …\n\nPress “Cancel” to abort.',
  tool_file_needed: 'This tool needs a file; please send a Document rather than text.',
  tool_file_too_large: 'The file exceeds the {size} limit.',
  tool_file_download_failed: 'Could not fetch the file from Telegram. Please try again.',
  tool_file_bad_type: 'That file type is not suitable for the selected tool.',
  tool_file_downloading: '⬇️ Downloading the file…',
  tool_file_second: '📥 First file recorded. Now send the second one.',
  tool_attachment_sent: '📎 The full output was sent as a file.',
  tool_attachment_failed: '⚠️ The attachment could not be sent; the summary above still applies.',
  tool_text_needed: 'This tool expects text input, not a file.',
  btn_copy_hint: '💡 Tap the text inside a code block to copy it.',

  profile_title: '👤 <b>Your Profile</b>',
  profile_name: '🏷 Name',
  profile_username: '🔖 Username',
  profile_id: '🆔 User ID',
  profile_joined: '📅 Member since',
  profile_last_seen: '🕒 Last activity',
  profile_requests: '📨 Requests',
  profile_tool_runs: '⚙️ Tool runs',
  profile_distinct: '🧩 Tools used',
  profile_favorite: '⭐ Favourite tool',
  profile_lang: '🌐 Language',
  profile_none: '—',

  my_tools_title: '🧰 <b>My Tools</b>',
  my_tools_empty: 'You have not used any tool yet. Start from the Toolbox.',

  stats_title: '📊 <b>Statistics</b>',
  stats_total_requests: '📨 Total requests',
  stats_total_runs: '⚙️ Total tool runs',
  stats_total_users: '👥 Users',
  stats_distinct_tools: '🧩 Active tools',
  stats_top: '🏆 <b>Most used tools</b>',
  stats_today: '📆 Today',
  stats_your_share: '👤 Your share',
  stats_empty: 'No data recorded yet.',

  settings_title: '⚙️ <b>Settings</b>',
  settings_body: 'Manage your preferences.',
  settings_lang_title: '🌐 <b>Choose language</b>',
  settings_lang_body: 'Select the bot interface language.',
  settings_lang_saved: '✅ Language switched to English.',
  settings_current: 'Current language',

  help_title: '❓ <b>Help</b>',
  help_body:
    '<b>1) What does this bot do?</b>\n' +
    'It gives you a curated set of programming, network, security and utility tools without leaving Telegram.\n\n' +
    '<b>2) How to use it</b>\n' +
    '1. “🧰 Toolbox” → pick a category → pick a tool\n' +
    '2. Press “▶️ Run tool”\n' +
    '3. Send your input as a normal message\n' +
    '4. The result is returned as a copy-friendly code block\n\n' +
    '<b>3) Shortcuts</b>\n' +
    '<code>/tool id</code> opens a tool directly, e.g. <code>/tool json_format</code>.\n' +
    '<code>/tools</code> lists everything, <code>/id</code> shows your Telegram ID.\n\n' +
    '<b>4) Limits</b>\n' +
    '• Max input size: <b>{maxInput}</b> characters\n' +
    '• Tool executions: <b>{toolRate}</b> per minute\n' +
    '• Network tools: <b>{netRate}</b> per minute and <b>{netDaily}</b> per day\n' +
    '• Network request timeout: <b>{timeout}</b> seconds\n\n' +
    '<b>5) Network tools</b>\n' +
    'They only target public hosts. Loopback, private and link-local addresses are blocked, and port checking is limited to a short list of standard ports under strict rate limits. This bot is not a scanner or an attack tool.',

  about_title: 'ℹ️ <b>About DevNet Toolbox</b>',
  about_body:
    '<b>Version:</b> <code>{version}</code>\n' +
    '<b>Tools:</b> {count} across 4 categories\n' +
    '<b>Environment:</b> {env}\n\n' +
    '<b>🧱 Stack</b>\n' +
    '• Cloudflare Workers (edge runtime)\n' +
    '• TypeScript (strict)\n' +
    '• Cloudflare D1 — profiles & statistics\n' +
    '• Cloudflare KV — state & rate limiting\n' +
    '• Telegram Bot API — webhook mode\n' +
    '• Vitest — automated tests / GitHub Actions — CI-CD\n\n' +
    '<b>🔐 Privacy</b>\n' +
    'Only your ID, display name, language and usage counters are stored. Tool input content is never persisted.',
  about_credits: '👨‍💻 Built with ❤️ for developers',

  // ─── 🛡️ Advanced Security (Phase 2) ─────────────────────
  btn_security: '🛡️ Advanced Security',
  btn_sec_apk: '📱 APK Analysis',
  btn_sec_url: '🎣 Phishing Check',
  btn_sec_privacy: '🔒 File Privacy',
  btn_sec_secret: '🔑 Secret Scanner',
  btn_sec_deps: '📦 Dependency Security',
  btn_sec_ioc: '🕸️ IOC Correlation',
  btn_sec_history: '📊 Scan History',
  btn_sec_dashboard: '📈 Security Dashboard',
  btn_sec_full: '📄 Full report',
  btn_sec_iocs: '🕸️ Indicators',
  btn_sec_score: '🧮 Score detail',

  sec_title: '🛡️ <b>Advanced Security</b>',
  sec_body:
    'Security analysis tools for files and web addresses. Every report includes a risk level, evidence, a confidence figure, and actionable advice.\n\n' +
    '⚠️ All analysis is <b>static</b>: nothing is executed. The result is an evidence-based assessment, not a verdict.',
  sec_privacy_note:
    '🔐 Your file is processed in memory and discarded immediately. Only a fingerprint (hash) and a summary of the result are kept in history.',

  sec_apk_prompt: '📱 Send the APK as a <b>Document</b> (max {size}).',
  sec_url_prompt: '🎣 Send the full address (including http:// or https://).',
  sec_privacy_prompt: '🔒 Send a photo or file as a <b>Document</b> to inspect its metadata.\n<i>Note: if you send an image as a Photo, Telegram strips the metadata itself.</i>',
  sec_secret_prompt: '🔑 Send text, a code snippet, or a config file. Actual values are never displayed.',
  sec_deps_prompt: '📦 Send the contents of package.json, requirements.txt, go.mod, Cargo.toml or composer.json.',
  sec_ioc_prompt: '🕸️ Send text containing IPs, domains, URLs or hashes to extract and assess them.',

  sec_scanning: '🔍 Analysing… this may take a few seconds.',
  sec_downloading: '⬇️ Downloading the file…',
  sec_no_file: 'This tool requires you to send a file.',
  sec_file_too_large: 'The file exceeds the allowed size ({size}).',
  sec_download_failed: 'Could not fetch the file from Telegram. Please try again.',
  sec_cached_result: '♻️ This file was already analysed on {date} (scan {id}).',
  sec_scan_saved: '🗂 Scan id: <code>{id}</code>',

  sec_history_title: '📊 <b>Scan History</b>',
  sec_history_empty: 'No scans recorded yet. Start from “🛡️ Advanced Security”.',
  sec_history_body: '<b>{count}</b> scans total — page {page} of {pages}\n<i>Raw files and input content are not stored; only a hash and a summary.</i>',
  sec_dashboard_title: '📈 <b>Security Dashboard</b>',
  sec_dashboard_empty: 'No data to display yet.',
  sec_recent_findings: '🔎 <b>Recent scans</b>',

  // ─── Phase 4: 🧰 Everyday Tools ──────────────────────────
  cat_everyday: '🧰 Everyday Tools',
  everyday_group_calculators: '📐 Calculators',
  everyday_group_documents: '📄 Documents',
  everyday_group_images: '🖼️ Images',
  everyday_group_media: '🎵 Media',
  everyday_group_productivity: '🧠 Productivity',
  everyday_group_information: '🌍 Information',
  everyday_group_favorites: '⭐ Favorites',

  btn_favorites: '⭐ My Favorites',
  btn_fav_add: '⭐ Add to favorites',
  btn_fav_remove: '💔 Remove from favorites',
  fav_title: '⭐ <b>My Favorites</b>',
  fav_empty:
    'You have not starred any tool yet.\nOpen any tool and press “⭐ Add to favorites” to see it here.',
  fav_body: '{count} saved tools • page {page} of {pages}',
  fav_added: '⭐ Added to favorites',
  fav_removed: '💔 Removed from favorites',
  fav_full: 'Your favorites are full (max {max} tools). Remove one first.',
  fav_error: 'Could not save the favorite. Please try again.',

  err_title: '❌ <b>Operation failed.</b>',
  err_generic: 'An unexpected error occurred. Please try again later.',
  err_rate_limited: '🚦 Too many requests. Please wait {seconds} seconds.',
  err_unknown_action: 'This action is no longer valid. Start again from “🏠 Home”.',
  err_unknown_tool: 'Tool not found.',
  err_no_pending: 'Pick a tool first and press “Run tool”.',
  err_private_only: 'This bot only works in private chats.',
  ok_answered: 'Done ✅',
  toast_loading: '⏳ …',
} as const;
