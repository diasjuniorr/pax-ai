PAX - personal Windows telemetry test

1. Extract the complete ZIP into a folder you own, such as Documents\PAX.
   Do not run files from inside the ZIP. Keep all files together.
2. Double-click Check-Runtime.cmd. It verifies the package hashes and loads
   both SimConnect runtime libraries. No simulator or access key is needed.
3. Double-click Start-PAX.cmd. Press Enter for the default Render URL.
   Paste PAX_BRIDGE_TOKEN from Render's Environment settings when asked.
   Input is hidden and is not saved. This is not PAX_DASHBOARD_TOKEN.
4. Leave the console open. Start MSFS 2024 and enter a flight.
5. Open https://pax-ai-2zo8.onrender.com and sign in with PAX_DASHBOARD_TOKEN.
   Check Bridge, MSFS and live telemetry. The first hosted connection can
   take about a minute while the free service wakes up.
6. Close the console or press Ctrl+C to stop. There is no background service.

No compilation, Node, Git, SDK, Developer Pack or administrator launch is
required. The launcher uses built-in Windows PowerShell for this process
only; it does not change the computer's persistent execution policy.

The app targets x64 Windows and .NET Framework 4.8 (included on Windows 11).
Native runtime requirements are recorded in native-dependencies.txt.
The application is unsigned. If Windows blocks it, record the exact message;
do not disable Windows security or install development tools to work around it.

This is a personal test package assembled from your PAX build and the official
Microsoft SDK archive. Microsoft runtime files are unchanged and remain subject
to the included MSFS-SDK-EULA.pdf. This is not a public redistribution release.
Do not upload this complete ZIP to the public GitHub repository or releases.

Missing DLL / runtime check failure: preserve the console error and manifest.
Server unavailable: check the website is Live, URL, agent key, and internet.
Waiting for MSFS: enter the cockpit; report the message if it stays disconnected.
No keys should be pasted into chat or committed to Git.

Live simulator behavior and clean gaming-laptop prerequisites remain to be
verified on the target machine. CI checks are not a live flight acceptance.
