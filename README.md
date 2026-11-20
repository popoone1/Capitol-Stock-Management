# Capitol Stock Management

A local-first desktop inventory and requisition app for Capitol. It combines stock inventory, receiving, issuing, adjustments, department requisitions, expiry/spoilage entries, a persistent water tracker, user/admin access, reporting, CSV export and Gmail delivery.

## Requirements and first launch

- Windows 10 or later
- For end users, install **Capitol-Stock-Management-Setup.exe**; it bundles the app, local server, Node.js runtime and required libraries. No separate Node.js or browser installation is needed.
- Internet access is needed only for optional Gmail delivery.

Run the installer, then launch Capitol Stock Management from the desktop or Start menu shortcut. The installed desktop app starts its private local server automatically and opens in its own application window. No cloud account or remote database is used.

The Windows installer can be built from the project folder on Windows with Node.js 24.15 or newer and internet access by running `npm install` followed by `npm run package:win`. The finished setup executable is written to `dist`. The packaging step downloads the official Node.js 24.22.1 Windows runtime and verifies its SHA-256 checksum before bundling it.

The installer is not code-signed, so Windows may show a publisher or SmartScreen warning. Only install it if you trust its source.

The SQLite database and server log are stored in `%APPDATA%\Capitol Stock Management\data` and `%APPDATA%\Capitol Stock Management\logs`. They are kept outside the installation directory, so app updates and uninstalling do not remove user data. Back up the `data` folder regularly.

For development only, `npm start` starts the local web server and `start.bat` opens it in a browser. Development mode requires Node.js 24.15 or newer.

On first use, create the administrator in the setup screen. There is no default password. New accounts and password resets require a four-digit numeric PIN. Existing accounts keep their current password and may continue using it until an administrator resets it. Admins can create, edit, disable, reset, and delete accounts, and assign standard user, administrator, or read-only auditor access.

## Supabase cloud deployment

The app can run in local SQLite mode or in cloud mode. Cloud mode uses the Supabase PostgreSQL database through the Node API in this repository; the desktop client never receives a database password or a Supabase service-role key. Render is configured as the free pilot API host in `render.yaml`. Its free web service can sleep while idle, so the first request after inactivity may take a little time to wake up.

To migrate the supplied local data and bring the API online:

1. In the Supabase dashboard, open **SQL Editor** and run `supabase/migrations/20261120133000_initial_schema.sql`. The migration creates the app's tables, case-insensitive indexes, and row-level-security protections. Run it once in the new, empty project.
2. Before deploying the API, import the existing local database. Open PowerShell and first change to the project folder. Paste the entire block below; when prompted, paste the complete PostgreSQL **Session pooler URI** and press Enter:

   ```powershell
   Set-Location -LiteralPath 'C:\Users\Windows User\Desktop\Grok\CApitol STock Management'
   if (-not (Test-Path -LiteralPath '.\package.json')) { throw 'Open PowerShell in the project folder before importing.' }
   npm.cmd ci
   $secret = Read-Host 'Supabase session-pooler DATABASE_URL (input is hidden)' -AsSecureString
   $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
   try {
     $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
     npm.cmd run import:cloud
   } finally {
     Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
     $secret.Dispose()
   }
   ```

   In Supabase, open **Connect → Connection string → Session pooler** and copy the URI. It must start with `postgresql://` (or `postgres://`) and contain your database password; the `https://<project-ref>.supabase.co` project URL is not the database URI. Replace any `[YOUR-DATABASE-PASSWORD]` placeholder before copying. Do not paste the URI after the PowerShell block has finished, and never share it in chat. If you have lost the database password, reset it in Supabase first; this may invalidate other clients using the old password.

   Close the desktop app before importing. The importer reads `data/capitol-stock.sqlite` (including its SQLite WAL/SHM files) from this project folder. It refuses to write if any target data table is non-empty, checks source SQLite integrity and foreign keys, imports in one transaction, verifies every source row against PostgreSQL, and prints table counts only. Keep the SQLite database and its WAL/SHM files as the backup.
3. Only after the import reports all tables verified, sign in to Render with GitHub, choose **New → Blueprint**, and select `popoone1/Capitol-Stock-Management`. When prompted, paste the same URI into the secret `DATABASE_URL` field. Render deploys the `capitol-stock-management` service from `render.yaml`; the free instance may sleep and take a short time to wake.

4. After Render reports the service is live, open `https://<your-service>.onrender.com/api/health`. Confirm it returns `{"ok":true,"database":"postgres","sqlite":false}`, then visit the service root and confirm the sign-in page loads. Imported accounts are marked to require a password change. On each user's first cloud sign-in, they enter their existing PIN once, then immediately set a unique password of at least 12 characters with uppercase and lowercase letters and a number. The PIN is never accepted for a completed cloud sign-in. Failed attempts are limited and persisted in PostgreSQL. Do not share the hosted URL until the administrator has completed this reset.

5. Update `assets/cloud-config.json` with Render's exact HTTPS URL, commit and push that one-file change, then run `npm.cmd run package:win` to create the desktop installer configured for the hosted app. Install and test the new installer before distributing it.

The source migration and importer do not upload the SQLite snapshot automatically. The importer cannot be rerun after success unless the target data tables are emptied first; keep the verified SQLite snapshot as the backup. Never put the connection URI or its password in Git, an installer, or chat.

Standard users can create department requisitions and water requests. Auditors can review inventory, stock movements (including voids and reversals), water history, and the audit log, but cannot change records. Admins can manage users, requesters, categories, stores, catalog items, water records, historical stock movements, shared appearance settings, and email settings. Stock movement corrections reconcile linked batches; voids keep the original entry and add a same-date compensating movement to preserve the historical audit trail. Stores are disabled rather than hard-deleted when they have history.

Use the theme button in the top bar to switch between light and dark themes. The preference is saved in this browser on this PC. Administrators can choose a shared glass or classic surface, Inter or Manrope typography, accent color and standard or large text under **Admin → Appearance**. Bootstrap styles and scripts and the licensed font files are bundled locally, so the interface does not need a network connection.

The bundled Inter and Manrope font files are distributed under the SIL Open Font License; their license texts are in `assets/fonts`. Bootstrap is distributed under the MIT license; its license is included with the packaged Bootstrap files.

## Stock operations

- Create and edit the item catalog with SKU, category/store, unit, optional expiry date and low-stock threshold. Selecting a store automatically selects its matching category and stock location.
- Inventory is grouped into Dry, Chemical, Protein, Fruit and Vegetable stores. Each store shows previous-month stock, stock received this month, current quantity (previous-month plus received), removed quantity, remainder and a color-coded remaining percentage. Issues and other stock-outs accumulate in Removed for the month.
- Admins can add, rename, disable or delete custom inventory columns under Admin → Inventory columns. Custom values are collected when an item is added or edited and appear in inventory and store-specific Stock Updates Reports; required stock columns remain fixed.
- Admins can add, rename or delete stores under Admin → Locations. Store changes are reflected in item assignments, issue locations and store-specific stock update reports; deletion is blocked until remaining stock and active item assignments are cleared.
- The Requests page lists issued requisitions under All Stock Requests and each active store, combining stock drawn from multiple batches into one request line. Administrators can correct the issue date, quantity, requester or issuer; removal is recorded as an auditable reversal and updates inventory and reports.
- Record receipts by quantity, supplier, purchase reference, unit cost, batch number and optional expiry. Inventory tracks received batches and uses earliest-expiring stock first when issuing.
- Record department requisitions with lines from multiple stores in one submission. The app validates each line against stock at its selected location and will not issue negative inventory.
- Administrators can edit an item's previous-month opening quantity; corrections are recorded as auditable movements and cannot reduce stock below the amount already on hand.
- Remove an item from the active inventory with its row action. Items with stock or movement history are archived to preserve their balance and audit trail; items with no history are deleted.
- Admins can add or remove stock using a reasoned, auditable adjustment. Spoilage and expiry are recorded as their own stock-out movement types.
- The dashboard and inventory list highlight low/zero stock and batches approaching expiry.
- Archive items that have history; a stock item with history cannot be hard-deleted. All changes and movements remain traceable.

## Water Tracker

Water tracking is a separate section in the same local app and SQLite database. It includes Rooms 1–41 and Gardeners, Weeders, Kelvin, Regina and Mess. Staff and Rooms 28, 29, 30, 31, 32, 36, 38 and 39 can receive water daily (exempt rooms ask for confirmation); other rooms can receive water again after three full days. Mixed selections issue eligible locations and skip standard rooms still cooling down.

## Reports and email

Generate all-store or store-specific requisition reports, stock-entry reports, all-movement reports and selected-store current-stock reports (including received stock and active custom inventory columns), plus water reports for a day, range or month. Stock activity reports support a day or date range. Reports can be exported to CSV or printed / saved as PDF. To send a generated report by Gmail:

1. In **Admin → Email**, enter the sender's Gmail address and a Google **App Password** (not the Google account password). Enable 2-Step Verification and create an App Password in your Google Account security settings first.
2. The sender address is stored in the local database; the App Password is kept **in server memory only** and must be entered again after restarting the app.
3. Generate a report, enter the destination email and choose **Email report**. The report is attached as a CSV.

Gmail delivery needs an internet connection and a valid App Password. If mailing is not configured, report generation and local export still work.

Administrators can use **Admin → Clear All** to reset inventory and other system records while retaining user accounts. The five default stores, default categories and standard requester lists are recreated, custom inventory columns and values are removed, custom Gmail settings are cleared, and the reset is recorded in the audit log. The action requires explicit typed confirmation.

## Database and privacy

In local mode the SQLite database is `data/capitol-stock.sqlite`; the server binds to `127.0.0.1` only. In hosted mode the server uses `DATABASE_URL` and binds to the host-provided interface. Passwords are stored as salted scrypt hashes; active sessions are held in server memory and end on restart. The app uses same-origin HTTP-only cookies, CSRF checks, and requires HTTPS for cloud desktop URLs. Back up the local database before migration and the Supabase project regularly after going online.

The supplied Apps Script endpoint redirected to Google sign-in in the available browser. The implementation uses the source code and requirements provided in the request; it does not connect to that Google Sheet.
